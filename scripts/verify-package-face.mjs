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
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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
  if (existsSync(facade)) {
    const text = readFileSync(facade, 'utf8')
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      violations.push(`src/index.mjs re-exports from bare specifier '${specifier}' — the facade is a pure in-package re-export surface`)
    }
  }

  return violations.map(reason => ({
    reason,
    remedy: { kind: 'manual', guidance: 'Keep the manifest face (bin/main/exports) and the src/index.mjs facade exactly as designed; new public surface is a deliberate change, not an accident.' },
  }))
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-package-face.mjs')) {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const violations = check(root)
  for (const violation of violations) console.error(violation.reason)
  process.exitCode = violations.length === 0 ? 0 : 1
}
