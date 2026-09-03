#!/usr/bin/env node
// Publish-readiness clamp for the @catheadowl/dsh-eval package
// (release-plan C1/C4 — copied-and-tailored from the extras gate, not shared).
//
// Rules (independently publishable = docs self-contained, manifest clean,
// nothing reaching back into the dev repository):
//   1. manifest: no `private: true` (npm publish would refuse).
//   2. dependencies: registry ranges only — no `link:`/`file:`/`workspace:`
//      or path specifiers; host packages (`@deepseek-ai/*`) belong in
//      peerDependencies, never in dependencies.
//   3. devDependencies may use non-registry specifiers only for own
//      `@catheadowl/*` dev-time packages (e.g. a local eval checkout).
//   4. import coverage: every bare specifier imported from src/ or bin/ must
//      be declared in dependencies/peerDependencies (node: builtins exempt).
//   5. docs locality: markdown links in README.md and docs/ must stay inside
//      the package root — the published docs cannot reach the dev repository.
//      Plain-text relative path tokens escaping the root are rejected for the
//      same reason; cite out-of-repo evidence by NAME (greppable), not path.
//   6. npm scripts locality: path arguments in `scripts` entries must stay
//      inside the package root (host checkout borrows stay exempt).
//   7. meta locality: src/bin comments must not cite dev-repo control-plane
//      terms (ADR/RFC/SPEC ids, dated workunit TODOs) — comments carry
//      functional semantics, design attribution lives in the cognition layer.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST_SCOPE = '@deepseek-ai/'
const OWN_SCOPE = '@catheadowl/'
const NON_REGISTRY_SPECIFIER = /^(link|file|workspace|portal|cat|patch|git\+|https?:\/\/|[A-Za-z]:\\|\/|\.\/|\.\.\/)/u

function manifestRules(manifest) {
  const violations = []
  if (manifest.private === true) violations.push('package.json has "private": true — remove it before publishing')
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (typeof specifier !== 'string') continue
      if (field === 'dependencies') {
        if (name.startsWith(HOST_SCOPE)) violations.push(`dependencies must not contain host package ${name} — move it to peerDependencies (runtime is provided by the dsh host)`)
        if (NON_REGISTRY_SPECIFIER.test(specifier)) violations.push(`dependencies.${name} uses non-registry specifier "${specifier}" — publish needs a registry range`)
      } else if (NON_REGISTRY_SPECIFIER.test(specifier) && !name.startsWith(OWN_SCOPE)) {
        violations.push(`devDependencies.${name} uses non-registry specifier "${specifier}" — only @catheadowl/* own dev-time packages may use link:/file:/git specifiers`)
      }
    }
  }
  return violations
}

function collectFiles(path, extensions, result = []) {
  if (!existsSync(path)) return result
  const stat = statSync(path)
  if (stat.isFile()) {
    if (extensions.includes(extname(path))) result.push(path)
    return result
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === '.runs' || entry === '.git' || entry === 'lib') continue
    collectFiles(join(path, entry), extensions, result)
  }
  return result
}

function packageName(specifier) {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function importSpecifiers(text) {
  const found = new Set()
  for (const pattern of [/(?:from|import)\s+['"]([^'"]+)['"]/gu, /import\(\s*['"]([^'"]+)['"]\s*\)/gu]) {
    for (const match of text.matchAll(pattern)) found.add(match[1])
  }
  return found
}

// Rule 4 + the scripts/ half of rule 5's spirit: relative imports and
// `new URL('...')` literals in src/ and bin/ and scripts/ must stay inside
// the package root; bare imports must be builtins or declared dependencies.
function codeLocality(root, declared) {
  const violations = []
  const files = [
    ...collectFiles(join(root, 'src'), ['.mjs', '.js']),
    ...collectFiles(join(root, 'bin'), ['.mjs', '.js']),
    ...collectFiles(join(root, 'scripts'), ['.mjs', '.js']),
  ]
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const displayed = relative(root, file).replaceAll('\\', '/')
    const references = new Set(importSpecifiers(text))
    for (const match of text.matchAll(/new URL\(\s*'([^']+)'/gu)) references.add(match[1])
    for (const reference of references) {
      if (!reference.startsWith('.')) {
        if (!reference.startsWith('node:')) {
          const name = packageName(reference)
          if (!declared.has(name)) {
            violations.push(`${displayed} imports ${name} but it is declared in neither dependencies nor peerDependencies`)
          }
        }
        continue
      }
      const target = resolve(dirname(file), reference)
      if (target !== root && !target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
        violations.push(`${displayed} references ${reference} which resolves outside the package root`)
      }
    }
  }
  return violations
}

// Rule 6: npm `scripts` entries ship with the package.
function npmScriptsLocality(manifest, root) {
  const violations = []
  const hostRoot = resolve(root, '../..', 'deepseek-harness')
  const inside = (target, base) => target === base || target.startsWith(base + '/') || target.startsWith(base + '\\')
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (typeof command !== 'string') continue
    let base = root
    for (const segment of command.split('&&')) {
      const cd = /^cd\s+([^\s&|;]+)\s*$/u.exec(segment.trim())?.[1]
      if (cd !== undefined) {
        base = /^[A-Za-z]:\\|^\//u.test(cd) ? resolve(cd) : resolve(base, cd)
        continue
      }
      for (const match of segment.matchAll(/(?:\.\.[/\\])+[^\s'"&|;]+/gu)) {
        const token = match[0]
        const target = resolve(base, token)
        if (!inside(target, root) && !inside(target, hostRoot)) {
          violations.push(`scripts.${name} references ${token} which resolves outside the package root (and is not a host checkout borrow)`)
        }
      }
    }
  }
  return violations
}

function markdownLinks(markdown) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/gu, '').replace(/`[^`\n]*`/gu, '')
  const links = []
  for (const match of withoutFences.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) links.push(match[1])
  return links
}

// Plain-text relative path tokens in published docs must resolve to an
// existing in-package path; tokens escaping the root (dev-repo citations)
// are unreachable for published readers. Fenced code blocks excluded;
// `deepseek-harness` tokens are the documented host-borrow exemption.
function devRepoPathCitations(markdown, base, displayed, root, violations) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/gu, '')
  const withoutLinks = withoutFences.replace(/\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/gu, '')
  for (const match of withoutLinks.matchAll(/(?:\.\.[/\\])+[^\s`'"，。；：））、】》]*/gu)) {
    const token = match[0]
    if (token.includes('deepseek-harness')) continue
    const target = resolve(base, token)
    const insideRoot = target === root || target.startsWith(root + '/') || target.startsWith(root + '\\')
    if (!insideRoot || !existsSync(target)) {
      violations.push(`${relative(root, displayed).replaceAll('\\', '/')} cites dev-repo path ${token} which does not resolve to an existing in-package path — name the source instead of pathing it`)
    }
  }
}

// Self-reference markers that have no legitimate use in PUBLISHED docs: the
// reader of the npm package cannot reach the development repository, so both
// naming it ("开发仓") and citing its control-plane namespaces ("workunits/")
// are meta leaks. (In code comments the META_TERMS pass covers the same idea;
// here the tokens are unambiguous enough to ban outright.)
const DOC_META_MARKERS = [/开发仓/u, /\bworkunits\//u, /\bexplorer\/eval-seams\b/u]

function docsLocality(root) {
  const violations = []
  const targets = [
    join(root, 'README.md'),
    ...collectFiles(join(root, 'docs'), ['.md']),
  ]
  for (const file of targets) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const marker of DOC_META_MARKERS) {
      marker.lastIndex = 0
      if (marker.test(text)) {
        violations.push(`${relative(root, file).replaceAll('\\', '/')} contains dev-repo self-reference ${marker} — published docs must state behavior functionally, not cite an unreachable registry`)
      }
    }
    for (const link of markdownLinks(text)) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(link) || link.startsWith('#')) continue
      const pathPart = link.split('#', 1)[0]
      if (pathPart === '') continue
      if (pathPart.startsWith('/')) {
        violations.push(`${relative(root, file).replaceAll('\\', '/')} links absolute repo path ${link} — published docs cannot reach the dev repository`)
        continue
      }
      const target = resolve(dirname(file), pathPart)
      if (target !== root && !target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
        violations.push(`${relative(root, file).replaceAll('\\', '/')} links outside the package root: ${link}`)
      }
    }
    devRepoPathCitations(text, dirname(file), file, root, violations)
  }
  return violations
}

// Rule 7: comment-shaped lines only — `spec`/`todo` double as ordinary nouns.
const META_TERMS = [
  /\b(?:ADR|RFC|PRD|SPEC)[ -]?\d+/u,
  /\bspec\s*[§:「]/u,
  /\bworkunit spec\b/u,
  /TODO\/\d{8}/u,
  /TODO \d{8}/u,
]
const COMMENT_LINE = /^\s*(?:\*|\/\/|#)/u

function metaLocality(root) {
  const violations = []
  const files = [
    ...collectFiles(join(root, 'src'), ['.mjs', '.js']),
    ...collectFiles(join(root, 'bin'), ['.mjs', '.js']),
  ]
  for (const file of files) {
    const haystack = readFileSync(file, 'utf8').split(/\r?\n/u).filter(line => COMMENT_LINE.test(line)).join('\n')
    for (const pattern of META_TERMS) {
      pattern.lastIndex = 0
      if (pattern.test(haystack)) {
        violations.push(`${relative(root, file).replaceAll('\\', '/')} cites control-plane term ${pattern} — keep design attribution in the cognition layer, functional semantics in code`)
      }
    }
  }
  return violations
}

export function check(root) {
  root = resolve(root)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  return [
    ...manifestRules(manifest),
    ...npmScriptsLocality(manifest, root),
    ...codeLocality(root, declared),
    ...docsLocality(root),
    ...metaLocality(root),
  ].map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: 'Keep the package independently publishable: docs self-contained (cite out-of-repo evidence by greppable name, not links), manifest clean, code inside the package root.',
    },
  }))
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-publish-readiness.mjs')) {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const violations = check(root)
  for (const violation of violations) console.error(violation.reason)
  process.exitCode = violations.length === 0 ? 0 : 1
}
