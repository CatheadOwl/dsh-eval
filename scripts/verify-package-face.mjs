#!/usr/bin/env node
// Package-face gate for @catheadowl/dsh-eval (release-plan C4 — copied and
// tailored from the extras gate; no TypeScript layer here, the face is plain
// .mjs).
//
// Checks the manifest face matches the real package:
//   - every `bin` entry points at an existing file inside the package;
//   - `main` (the case/matcher import facade) exists;
//   - if `exports` is declared, it covers `.` and every bin file, and every
//     exports target exists;
//   - the facade src/index.mjs re-exports only in-package modules (no new
//     deep surface may silently grow).
//
// Homepage/docs face (github-homepage-review blockers, mechanized so they
// can never regress):
//   - README's H1 is the package name;
//   - README has ## Install and ## Quickstart sections;
//   - code blocks in README/docs never import via relative paths that
//     escape the package root (published examples must use the package
//     name);
//   - docs/matchers.md mentions every named export of the facade (docs
//     drift guard: a new matcher without documentation fails the gate).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function check(root) {
  root = resolve(root)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const violations = []
  const inside = target => target === root || target.startsWith(root + '/') || target.startsWith(root + '\\')

  for (const [binName, binPath] of Object.entries(manifest.bin ?? {})) {
    const target = resolve(root, binPath)
    if (!inside(target) || !existsSync(target)) {
      violations.push(`bin.${binName} -> ${binPath} does not resolve to an existing file inside the package root`)
    }
  }

  if (manifest.main !== undefined) {
    const mainTarget = resolve(root, manifest.main)
    if (!inside(mainTarget) || !existsSync(mainTarget)) {
      violations.push(`main -> ${manifest.main} does not resolve to an existing file inside the package root`)
    }
  }

  if (manifest.exports !== undefined) {
    const binFiles = new Set(Object.values(manifest.bin ?? {}).map(p => resolve(root, p)))
    for (const [entry, face] of Object.entries(manifest.exports)) {
      const targets = typeof face === 'string' ? [face] : Object.values(face ?? {})
      for (const target of targets) {
        if (typeof target !== 'string') continue
        const absolute = resolve(root, target)
        if (!inside(absolute) || !existsSync(absolute)) {
          violations.push(`exports["${entry}"] -> ${target} does not resolve to an existing file inside the package root`)
        }
      }
    }
    // The CLI entries must stay importable: if an exports map exists, it has
    // to cover the root facade (the documented import surface).
    if (manifest.exports['.'] === undefined) {
      violations.push('exports map exists but has no "." entry — the src/index.mjs facade must stay the public import surface')
    }
    for (const [binName, binPath] of Object.entries(manifest.bin ?? {})) {
      if (!binFiles.has(resolve(root, binPath))) continue
      if (manifest.exports[`./bin/${binName}`] === undefined && manifest.exports['./bin/*'] === undefined) {
        violations.push(`exports map has no entry for bin file ${binPath} — pnpm consumers resolve bins through the exports map`)
      }
    }
  }

  // Facade discipline: src/index.mjs may only re-export from in-package
  // relative modules — anything else belongs behind an explicit design
  // decision, not silent growth.
  const facade = join(root, 'src', 'index.mjs')
  const facadeExports = new Set()
  if (existsSync(facade)) {
    const text = readFileSync(facade, 'utf8')
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      violations.push(`src/index.mjs re-exports from bare specifier '${specifier}' — the facade is a pure in-package re-export surface`)
    }
    for (const clause of text.matchAll(/export\s*\{([^}]*)\}\s*from/gu)) {
      for (const name of clause[1].split(',')) {
        const trimmed = name.trim().split(/\s+as\s+/u).pop()
        if (trimmed !== '') facadeExports.add(trimmed)
      }
    }
  }

  // ---- Homepage/docs face (github-homepage-review round 1 blockers) ----
  const readmePath = join(root, 'README.md')
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8')
    const h1 = /^#\s+(.+)$/mu.exec(readme)?.[1]?.trim()
    if (h1 === undefined || h1 !== manifest.name) {
      violations.push(`README H1 is '${h1 ?? '(none)'}' — the standalone-repo homepage must be titled with the package name '${manifest.name}'`)
    }
    for (const section of ['Install', 'Quickstart']) {
      if (!new RegExp(`^##\\s+.*${section}`, 'mu').test(readme)) {
        violations.push(`README has no '## ${section}' section — a standalone-repo homepage must reach a runnable entry within the first screens`)
      }
    }
  }

  // Published examples must import the package name, never relative paths
  // escaping the package root (round-1 blocker: dev-repo relative imports
  // that cannot work for consumers).
  const markdownFiles = [readmePath, ...collectMarkdown(join(root, 'docs'))]
  for (const file of markdownFiles) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const block of text.matchAll(/```[\w]*\s*\n([\s\S]*?)```/gu)) {
      for (const match of block[1].matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/gu)) {
        const target = resolve(dirname(file), match[1])
        if (!inside(target)) {
          violations.push(`${relative(root, file).replaceAll('\\', '/')} code block imports '${match[1]}' which escapes the package root — published examples must use the bare package name (${manifest.name})`)
        }
      }
    }
  }

  // Docs drift guard: every facade export must appear somewhere in the
  // shipped docs set (README + docs/**). Runner/trace internals are exempt
  // (documented as internals; consumers write cases, not runners).
  const docsSet = markdownFiles.filter(existsSync).map(file => readFileSync(file, 'utf8')).join('\n')
  const internalExports = new Set([
    // runner/trace internals: consumers write cases, not runners
    'runEvalCase', 'buildOverlayYaml', 'looksLikeDshRepo', 'stageProfileStore', 'FRAMEWORK_ROOT',
    'parseSessionLog', 'buildTrace', 'loadTraceDir',
    // dsh adapter / tool-validation internals: consumed via the CLIs
    'createDshHeadlessReviewExecutor', 'resolveDshCli', 'runDshReviewExperiment',
    'validateToolBoundary', 'renderToolBoundaryEvidence',
  ])
  if (docsSet.length > 0 && facadeExports.size > 0) {
    for (const name of facadeExports) {
      if (internalExports.has(name)) continue
      if (!docsSet.includes(name)) {
        violations.push(`no shipped doc mentions facade export '${name}' — every public matcher/helper/API must be documented (code + docs together) when added`)
      }
    }
  }

  return violations.map(reason => ({
    reason,
    remedy: { kind: 'manual', guidance: 'Keep the manifest face (bin/main/exports), the src/index.mjs facade, and the README/docs homepage face exactly as designed; new public surface is a deliberate change (code + docs together), not an accident.' },
  }))
}

function collectMarkdown(dir, result = []) {
  if (!existsSync(dir)) return result
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) collectMarkdown(join(dir, entry.name), result)
    else if (extname(entry.name) === '.md') result.push(join(dir, entry.name))
  }
  return result
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-package-face.mjs')) {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const violations = check(root)
  for (const violation of violations) console.error(violation.reason)
  process.exitCode = violations.length === 0 ? 0 : 1
}
