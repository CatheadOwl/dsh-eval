// Generic generated-region engine: render a markdown API reference table from
// the exported declarations of a TypeScript entry, and regenerate or check a
// fenced generated region inside an existing markdown file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'

export const START_MARKER = '<!-- generated: ts-api-reference:start -->'
export const END_MARKER = '<!-- generated: ts-api-reference:end -->'

function resolveSourceSpecifier(fromPath, specifier) {
  if (!specifier.startsWith('.') || extname(specifier) === '') return undefined
  const withoutExtension = join(dirname(fromPath), specifier.slice(0, -extname(specifier).length))
  for (const extension of ['.ts', '.tsx', '.mts', '.cts']) {
    const candidate = `${withoutExtension}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function declarationName(node) {
  return node.name?.text
}

function declarationKind(ts, node) {
  if (ts.isFunctionDeclaration(node)) return 'function'
  if (ts.isClassDeclaration(node)) return 'class'
  if (ts.isInterfaceDeclaration(node)) return 'interface'
  if (ts.isTypeAliasDeclaration(node)) return 'type'
  if (ts.isEnumDeclaration(node)) return 'enum'
  return undefined
}

function jsDocSummary(ts, sourceFile, node) {
  let summary = ''
  for (const comment of ts.getJSDocCommentsAndTags(node)) {
    if (comment.kind !== ts.SyntaxKind.JSDocComment) continue
    const text = sourceFile.text.slice(comment.pos, comment.end)
    summary = text
      .split('\n')
      .map(line => line.replace(/^\/\*\*+/, '').replace(/\*\/$/, '').trim().replace(/^\* ?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return summary.match(/^.*?[.。!？](?:\s|$)/u)?.[0].trim() ?? summary
}

function markdownEscape(value) {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function directRows(ts, sourcePath, packageRoot) {
  const text = readFileSync(sourcePath, 'utf8')
  const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true)
  const rows = []
  for (const statement of source.statements) {
    const name = declarationName(statement)
    const kind = declarationKind(ts, statement)
    if (name === undefined || kind === undefined) continue
    if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) !== true) continue
    rows.push({
      name,
      kind,
      source: relative(resolve(packageRoot), sourcePath).replaceAll('\\', '/'),
      summary: jsDocSummary(ts, source, statement),
    })
  }
  return { source, rows }
}

function findNamedExportRows(ts, sourcePath, packageRoot, names) {
  const wanted = new Set(names)
  const { rows } = directRows(ts, sourcePath, packageRoot)
  return rows.filter(row => wanted.has(row.name))
}

async function renderApiReference(options, ts) {
  const sourcePath = resolve(options.source)
  if (!existsSync(sourcePath)) throw new Error(`source not found: ${options.source}`)
  const { source, rows } = directRows(ts, sourcePath, options.packageRoot)

  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause?.elements === undefined) continue
    const targetPath = statement.moduleSpecifier === undefined
      ? sourcePath
      : resolveSourceSpecifier(sourcePath, statement.moduleSpecifier.text)
    if (targetPath === undefined) throw new Error(`cannot resolve re-export ${statement.moduleSpecifier?.text} in ${options.source}`)
    const names = statement.exportClause.elements.map(element => element.name.text)
    rows.push(...findNamedExportRows(ts, targetPath, options.packageRoot, names))
  }

  rows.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const header = '| Symbol | Kind | Source | Summary |\n|---|---|---|---|'
  const body = rows.map(row =>
    `| ${markdownEscape(row.name)} | ${row.kind} | ${markdownEscape(row.source)} | ${markdownEscape(row.summary || 'No JSDoc summary.')} |`
  )
  return [START_MARKER, header, ...body, END_MARKER].join('\n')
}

export async function generateApiReference(options, ts) {
  const outputPath = resolve(options.output)
  if (!existsSync(outputPath)) throw new Error(`output not found: ${options.output}`)
  const oldText = readFileSync(outputPath, 'utf8')
  const startIndex = oldText.indexOf(START_MARKER)
  const endIndex = oldText.indexOf(END_MARKER)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`generated region markers are missing or out of order in ${options.output}`)
  }
  const generated = await renderApiReference(options, ts)
  const newText = `${oldText.slice(0, startIndex)}${generated}${oldText.slice(endIndex + END_MARKER.length)}`
  if (options.check === true) return { changed: newText !== oldText }
  if (newText !== oldText) writeFileSync(outputPath, newText, 'utf8')
  return { changed: newText !== oldText }
}
