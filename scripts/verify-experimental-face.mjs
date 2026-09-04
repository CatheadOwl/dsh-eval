#!/usr/bin/env node
// Experimental-tier face gate (package-owned, unlike the propagated
// verify-*.mjs managed copies).
//
// The root facade gets the full docs-drift guard from verify-manifest-face
// (every SDK export must be documented). The ./experimental subpath carries
// no compatibility promise, so its doc duty is lighter but not zero:
//   - the exports map declares ./experimental and its target exists;
//   - docs/experimental.md exists and carries the no-warranty warning banner;
//   - every export of src/experimental.mjs appears in that symbol list.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const BANNER_TOKEN = 'experimental-tier-warning'
const violations = []

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entry = manifest.exports?.['./experimental']
if (entry === undefined) {
  violations.push('package.json exports map has no "./experimental" entry')
} else {
  const target = typeof entry === 'string' ? entry : Object.values(entry ?? {}).find(v => typeof v === 'string')
  if (target === undefined || !existsSync(join(root, target))) {
    violations.push(`exports["./experimental"] target does not exist: ${String(target)}`)
  }
}

const experimentalSrc = join(root, 'src', 'experimental.mjs')
const docPath = join(root, 'docs', 'experimental.md')
const exports = new Set()
if (existsSync(experimentalSrc)) {
  const text = readFileSync(experimentalSrc, 'utf8')
  for (const clause of text.matchAll(/export\s*\{([^}]*)\}\s*from/gu)) {
    for (const name of clause[1].split(',')) {
      const trimmed = name.trim().split(/\s+as\s+/u).pop()
      if (trimmed !== '') exports.add(trimmed)
    }
  }
} else {
  violations.push('src/experimental.mjs is missing')
}

if (!existsSync(docPath)) {
  violations.push('docs/experimental.md is missing — the experimental tier needs a warning-banner symbol list')
} else {
  const doc = readFileSync(docPath, 'utf8')
  if (!doc.includes(BANNER_TOKEN)) {
    violations.push(`docs/experimental.md lacks the warning banner token '${BANNER_TOKEN}'`)
  }
  for (const name of exports) {
    if (!doc.includes(name)) {
      violations.push(`docs/experimental.md does not list experimental export '${name}'`)
    }
  }
}

for (const violation of violations) console.error(violation)
process.exitCode = violations.length === 0 ? 0 : 1
