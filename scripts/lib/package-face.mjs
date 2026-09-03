// Generic package-face engine: manifest exports shape + AST export-surface
// checks + forbidden import scan. Parameterized by the caller (gate entry);
// knows nothing about which package it checks.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

function exportedNames(ts, source) {
  const names = new Set()
  for (const statement of source.statements) {
    const isExport = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause?.name !== undefined) names.add(statement.exportClause.name.text)
      if (statement.exportClause?.elements !== undefined) {
        for (const element of statement.exportClause.elements) names.add(element.name.text)
      }
      if (statement.exportClause === undefined) names.add('*')
      continue
    }
    if (!isExport) continue
    if (statement.name !== undefined && statement.name.text !== undefined) names.add(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
    }
  }
  return names
}

function collectFiles(path, result = []) {
  if (!existsSync(path)) return result
  const stat = statSync(path)
  if (stat.isFile()) {
    result.push(path)
    return result
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === '.runs' || entry === '.git') continue
    collectFiles(resolve(path, entry), result)
  }
  return result
}

export async function verifyPackageFace(options) {
  const violations = []
  const packagePath = resolve(options.package)
  const rootPath = resolve(options.rootEntry)
  if (!existsSync(packagePath)) return [`package manifest not found: ${options.package}`]
  if (!existsSync(rootPath)) return [`root entry not found: ${options.rootEntry}`]

  let manifest
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  }
  catch (error) {
    return [`cannot parse package manifest: ${error.message}`]
  }

  // `.` sits in the expected set unless the caller passes `rootExport: null`
  // (bundle-shaped packages whose plugin rows load via relative subpaths and
  // which therefore deliberately expose no `.` export).
  const rootExport = options.rootExport === null ? [] : ['.']
  // `allowedExports` names package faces owned by OTHER modules of the same
  // bundle package — present in the manifest but not the caller's concern.
  const allowed = options.allowedExports ?? []
  const expectedExports = [...rootExport, ...Object.keys(options.subentries ?? {}), ...allowed, './package.json']
  const actualExports = Object.keys(manifest.exports ?? {})
  for (const entry of expectedExports) {
    if (!actualExports.includes(entry) && !allowed.includes(entry)) violations.push(`package exports is missing ${entry}`)
  }
  for (const entry of actualExports) {
    if (!expectedExports.includes(entry)) violations.push(`package exports has unexpected entry ${entry}`)
  }

  for (const entry of [...rootExport, ...Object.keys(options.subentries ?? {})]) {
    const condition = manifest.exports?.[entry]
    if (condition === undefined || typeof condition !== 'object' || condition === null) continue
    if (typeof condition.types !== 'string') violations.push(`package exports ${entry} is missing a string types condition`)
    if (typeof condition.default !== 'string') violations.push(`package exports ${entry} is missing a string default condition`)
  }

  const rootSource = options.ts.createSourceFile(rootPath, readFileSync(rootPath, 'utf8'), options.ts.ScriptTarget.Latest, true)
  const expectedRootExports = new Set(options.rootExports)
  const actualRootExports = exportedNames(options.ts, rootSource)
  for (const name of expectedRootExports) {
    if (!actualRootExports.has(name)) violations.push(`root entry does not export ${name}`)
  }
  for (const name of actualRootExports) {
    if (!expectedRootExports.has(name)) violations.push(`root entry exports non-loader symbol ${name}`)
  }

  for (const [entry, source] of Object.entries(options.subentries ?? {})) {
    const sourcePath = resolve(source)
    if (!existsSync(sourcePath)) {
      violations.push(`subentry ${entry} source not found: ${source}`)
      continue
    }
    const allowlist = options.facadeExports?.[entry]
    if (allowlist === undefined) continue
    const sourceFile = options.ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), options.ts.ScriptTarget.Latest, true)
    const actual = exportedNames(options.ts, sourceFile)
    for (const name of allowlist) {
      if (!actual.has(name)) violations.push(`subentry ${entry} does not export ${name}`)
    }
    for (const name of actual) {
      if (!allowlist.includes(name)) violations.push(`subentry ${entry} exports non-public symbol ${name}`)
    }
  }

  const forbidden = options.forbiddenImports ?? []
  if (forbidden.length > 0) {
    for (const scanPath of options.scanPaths ?? []) {
      for (const file of collectFiles(resolve(scanPath))) {
        if (!['.ts', '.tsx', '.mts', '.cts', '.md', '.mjs', '.js'].includes(extname(file))) continue
        const text = readFileSync(file, 'utf8')
        for (const pattern of forbidden) {
          pattern.lastIndex = 0
          if (pattern.test(text)) {
            violations.push(`forbidden import pattern ${pattern} matches ${relative(process.cwd(), file)}`)
          }
        }
      }
    }
  }
  return violations
}
