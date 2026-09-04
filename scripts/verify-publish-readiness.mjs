#!/usr/bin/env node
// Publish-readiness clamp — parameterized engine (per-package config in
// scripts/verify.config.mjs beside this entry).
//
// Managed face file: byte-identical across every consumer, edits are made at
// the single source and re-propagated — never edit this copy in place (the
// workspace gate-blueprint-drift rejects divergence).
//
// Rules (independently publishable = host provided at runtime, everything else
// resolvable from a public registry, docs self-contained):
//   1. manifest: no `private: true` (npm publish would refuse).
//   2. dependencies: registry ranges only — no `link:`/`file:`/`workspace:`
//      or path specifiers, and no `@deepseek-ai/*` host packages (those are
//      peerDependencies, provided by the dsh host at runtime).
//   3. devDependencies may use non-registry specifiers only for the scopes the
//      config allows (`devDepNonRegistryScopes`: host packages and/or own
//      dev-time packages); public packages must use registry ranges.
//   4. import coverage: every bare specifier imported from the configured
//      `srcDirs` must be declared in dependencies or peerDependencies.
//   5. docs locality: markdown links in README.md and the configured
//      `docsRoots` must stay inside the package root and must not use
//      absolute repo paths — the published docs cannot reach the dev repo.
//      Plain-text relative path tokens that escape the package root are
//      rejected for the same reason; host checkout borrows
//      (deepseek-harness paths) stay exempt as everywhere else.
//   6. npm scripts locality: path arguments in `scripts` entries must stay
//      inside the package root; borrowing host checkout paths (L0) is allowed.
//   7. meta locality: module sources must not cite dev-repo control-plane
//      terms (ADR/RFC/PRD/SPEC ids, spec docs, dated workunit TODOs) —
//      comments carry functional semantics, design attribution lives in the
//      cognition layer.
//   8. host closure membership (network, opt-in via `hostClosureCheck`):
//      every `@deepseek-ai/*` peerDependency must appear in the dependency
//      closure the dsh CLI ships on some npm dist-tag — a peer outside every
//      closure kills the whole plugin tree on import. Opt out for the whole
//      run with DSH_SKIP_HOST_CLOSURE=1 (offline builds); a registry fetch
//      failure fails loud for the same reason.
//   9. rules seed locality (opt-in via `rulesSeed` path): the package's
//      AGENTS.md must carry the pointer to its rules seed, and the seed must
//      exist.
//  10. docs meta locality: published docs (README.md + configured docsRoots)
//      must not cite dev-repo control-plane ids or lineage verbs —
//      ADR/RFC/PRD ids, workline (W-number) ids, workunit references, and
//      promotion/migration lineage verbs (升格 / 已归档 / 原仓库级 / 薄 shim).
//      Plain-text by-name provenance ("original design record, by name")
//      stays the accepted citation form; fenced code blocks and inline code
//      spans are exempt (fixture / identifier usage).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOST_SCOPE = '@deepseek-ai/'
const NON_REGISTRY_SPECIFIER = /^(link|file|workspace|portal|cat|patch|git\+|https?:\/\/|[A-Za-z]:\\|\/|\.\/|\.\.\/)/u

// Per-package config: scripts/verify.config.mjs beside this entry (consumer-
// owned, not part of the propagated face). Keys used here: ownName,
// devDepNonRegistryScopes, layout ('modules'|'root'), srcDirs, docsRoots,
// hostClosureCheck, rulesSeed.
const CONFIG_PATH = new URL('./verify.config.mjs', import.meta.url)

export async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`missing scripts/verify.config.mjs beside this entry — the publish gate is parameterized and will not run on defaults`)
  }
  const module = await import(pathToFileURL(fileURLToPath(CONFIG_PATH)).href)
  return module.default
}

function manifestRules(manifest, cfg) {
  const violations = []
  if (manifest.private === true) violations.push('package.json has "private": true — remove it before publishing')
  const devScopes = cfg.devDepNonRegistryScopes ?? []
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (typeof specifier !== 'string') continue
      if (field === 'dependencies') {
        if (name.startsWith(HOST_SCOPE)) violations.push(`dependencies must not contain host package ${name} — move it to peerDependencies (runtime is provided by the dsh host)`)
        if (NON_REGISTRY_SPECIFIER.test(specifier)) violations.push(`dependencies.${name} uses non-registry specifier "${specifier}" — publish needs a registry range`)
      }
      else if (NON_REGISTRY_SPECIFIER.test(specifier) && !devScopes.some(scope => name.startsWith(scope))) {
        violations.push(`devDependencies.${name} uses non-registry specifier "${specifier}" — only ${devScopes.join(' / ')} dev-time packages may use link:/path/git specifiers`)
      }
    }
  }
  return violations
}

// Package content roots: layout 'modules' = one per `modules/<name>/`
// directory (bundle layout) plus the bare package root when it carries
// sources/scripts/README of its own; layout 'root' = the bare package root
// (single-package layout).
function contentRoots(root, cfg) {
  if (cfg.layout !== 'modules') return [root]
  const modules = join(root, 'modules')
  const roots = existsSync(modules)
    ? readdirSync(modules, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(root, 'modules', entry.name))
    : []
  if (existsSync(join(root, 'src')) || existsSync(join(root, 'scripts')) || existsSync(join(root, 'README.md'))) roots.push(root)
  return roots
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
  const patterns = [
    /(?:from|import)\s+['"]([^'"]+)['"]/gu,
    /import\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1])
  }
  return found
}

function importCoverage(root, declared, cfg) {
  const violations = []
  for (const contentRoot of contentRoots(root, cfg)) {
    for (const srcDir of cfg.srcDirs ?? ['src']) {
      for (const file of collectFiles(join(contentRoot, srcDir), ['.ts', '.tsx', '.mjs'])) {
        for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
          if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
          const name = packageName(specifier)
          if (cfg.ownName !== undefined && name === cfg.ownName) continue
          // Type-only bare import satisfied by an @types mapping: a type import
          // of bare package `mdast` passes when `@types/mdast` is declared — the
          // same NodeNext resolution the compiler performs.
          if (declared.has(`@types/${name}`)) continue
          if (!declared.has(name)) {
            violations.push(`${relative(root, file).replaceAll('\\', '/')} imports ${name} but it is declared in neither dependencies nor peerDependencies`)
          }
        }
      }
    }
  }
  return violations
}

// Scripts are dev-time code but still part of the shipped repository: their
// imports and new URL(...) path literals must stay inside the package root,
// and bare imports must be node builtins or declared dependencies.
function scriptsLocality(root, declared, cfg, extraScripts = []) {
  const violations = []
  const entries = [
    ...contentRoots(root, cfg).flatMap(contentRoot => collectFiles(join(contentRoot, 'scripts'), ['.mjs', '.js'])),
    ...extraScripts.map(extra => ({ path: join(root, extra.path), text: extra.text })),
  ]
  for (const entry of entries) {
    const file = typeof entry === 'string' ? entry : entry.path
    const text = typeof entry === 'string' ? readFileSync(file, 'utf8') : entry.text
    const displayed = relative(root, file).replaceAll('\\', '/')
    const relativeRefs = new Set(importSpecifiers(text))
    for (const match of text.matchAll(/new URL\(\s*'([^']+)'/gu)) relativeRefs.add(match[1])
    for (const reference of relativeRefs) {
      if (!reference.startsWith('.')) {
        const name = packageName(reference)
        if (!reference.startsWith('node:') && name !== cfg.ownName && !declared.has(name)) {
          violations.push(`${displayed} imports ${name} but it is declared in neither dependencies nor peerDependencies`)
        }
        continue
      }
      const target = resolve(dirname(file), reference)
      if (!target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
        violations.push(`${displayed} references ${reference} which resolves outside the package root`)
      }
    }
  }
  return violations
}

// npm `scripts` entries ship with the package: path arguments in their command
// lines are under the same locality constraint as scripts/*.mjs — they must not
// reach siblings, the shared eval harness, or other dev-repo directories. The
// documented L0 exception (borrowing host .bin / host checkout paths, see
// resolution-ladder) is allowed. Each `&&`-separated segment is scanned with
// the resolution base moved by any preceding `cd <dir> &&` segment (that is
// where the shell actually runs that segment).
function npmScriptsLocality(manifest, root) {
  const violations = []
  // Host-borrow exemption is existence-checked: the sibling checkout location
  // is a machine fact, not an unconditional pass — when the host checkout is
  // not wired at that location, host borrows are real violations and the gate
  // goes red instead of blessing dead paths.
  const hostRoot = resolve(root, '../..', 'deepseek-harness')
  const hostBorrowRoot = existsSync(hostRoot) ? hostRoot : null
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
        const hostOk = hostBorrowRoot !== null && inside(target, hostBorrowRoot)
        if (!inside(target, root) && !hostOk) {
          violations.push(`PKG-2: scripts.${name} references ${token} which resolves outside the package root (and is not a wired L0 host borrow — the deepseek-harness checkout must exist at the sibling location for borrows to pass) — keep dev-repo-only commands out of the shipped manifest`)
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

// Plain-text relative path tokens (`../../../outside-the-package.md`) in published
// docs must resolve to an existing path inside the package root: tokens
// escaping the root are unreachable for published readers, and tokens landing
// on a nonexistent in-package path are dangling pointers (stale dev-repo
// citations that mis-counted their `../` levels). Fenced code blocks and
// markdown link targets are excluded (links have their own pass);
// `deepseek-harness` tokens are the documented host-borrow exemption. This
// is the only citation form mechanically separable from functional example
// data (namespace-shaped tokens double as parser fixtures, so those stay
// judgment-side — see the package AGENTS.md).
function devRepoPathCitations(markdown, base, displayed, root, violations) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/gu, '')
  // Whole markdown links (text + target) are removed: links have their own
  // pass above, and a path-shaped link text (`[../README.md](...)`) is part
  // of that link, not a plain-text citation.
  const withoutLinks = withoutFences.replace(/\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/gu, '')
  for (const match of withoutLinks.matchAll(/(?:\.\.[/\\])+[^\s`'"，。；：））、】》]*/gu)) {
    const token = match[0]
    if (token.includes('deepseek-harness')) continue
    const target = resolve(base, token)
    const insideRoot = target === root || target.startsWith(root + '/') || target.startsWith(root + '\\')
    if (!insideRoot || !existsSync(target)) {
      violations.push(`PKG-1: ${relative(root, displayed).replaceAll('\\', '/')} cites dev-repo path ${token} which does not resolve to an existing in-package path — name the source instead of pathing it`)
    }
  }
}

function docsLocality(root, cfg, extraMarkdown = []) {
  const violations = []
  const targets = [
    ...contentRoots(root, cfg).flatMap(contentRoot => [
      join(contentRoot, 'README.md'),
      ...(cfg.docsRoots ?? ['docs']).flatMap(docsRoot => collectFiles(join(contentRoot, docsRoot), ['.md'])),
    ]),
    ...extraMarkdown.map(entry => ({ path: join(root, entry.path), text: entry.text })),
  ]
  for (const file of targets) {
    const text = typeof file === 'string' ? readFileSync(file, 'utf8') : file.text
    const displayed = typeof file === 'string' ? file : file.path
    for (const link of markdownLinks(text)) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(link) || link.startsWith('#')) continue
      const pathPart = link.split('#', 1)[0]
      if (pathPart === '') continue
      if (pathPart.startsWith('/')) {
        violations.push(`PKG-1: ${relative(root, displayed).replaceAll('\\', '/')} links absolute repo path ${link} — published docs cannot reach the dev repository`)
        continue
      }
      const target = resolve(dirname(String(displayed)), pathPart)
      if (!target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
        violations.push(`PKG-1: ${relative(root, displayed).replaceAll('\\', '/')} links outside the package root: ${link}`)
      }
    }
    devRepoPathCitations(text, dirname(String(displayed)), String(displayed), root, violations)
  }
  return violations
}

// Dev-repo control-plane vocabulary (decision-record ids, spec citations,
// dated workunit TODOs) must not appear in module source code: comments there
// carry functional semantics only, design attribution lives in the cognition
// layer. Scanned on the configured srcDirs of each content root only —
// docs/README may cite dev-repo evidence as plain text, and dev-repo path
// namespaces double as example data in prompt/routes sources, so they stay
// out of scope. Widen the token set by evidence only.
const META_TERMS = [
  /\b(?:ADR|RFC|PRD|SPEC)[ -]?\d+/u,
  /\bspec\s*[§:「]/u,
  /\bspec's\b/u,
  /\bworkunit spec\b/u,
  /\bworkunits\/[a-z0-9-]+ [WT]\d+\b/u,
  /TODO \d{8}/u,
]

// Comment-shaped lines only: `spec` doubles as an ordinary noun / identifier
// (`AtRunSpec`, `spec.dshBin`, "spawn spec"), so the citation forms above are
// matched inside `*`/`//` comment lines, never on code lines.
const COMMENT_LINE = /^\s*(?:\*|\/\/|#)/u

function commentText(text) {
  return text.split(/\r?\n/u).filter(line => COMMENT_LINE.test(line)).join('\n')
}

function metaLocality(root, cfg, extraSources = []) {
  const violations = []
  // Per-package top-level config files ship with the repository and are a
  // prime spot for control-plane narration creep — same rule set as sources.
  const configFaces = ['dsh-eval.config.mjs', 'verify.config.mjs']
  const entries = [
    ...contentRoots(root, cfg).flatMap(contentRoot => [
      ...(cfg.srcDirs ?? ['src']).flatMap(srcDir => collectFiles(join(contentRoot, srcDir), ['.ts', '.tsx', '.js', '.mjs'])),
      ...configFaces.filter(face => existsSync(join(contentRoot, face))).map(face => join(contentRoot, face)),
    ]),
    ...extraSources.map(extra => ({ path: join(root, extra.path), text: extra.text })),
  ]
  for (const entry of entries) {
    const file = typeof entry === 'string' ? entry : entry.path
    const text = typeof entry === 'string' ? readFileSync(file, 'utf8') : entry.text
    const haystack = commentText(text)
    for (const pattern of META_TERMS) {
      pattern.lastIndex = 0
      if (pattern.test(haystack)) {
        violations.push(`PKG-4: ${relative(root, file).replaceAll('\\', '/')} cites control-plane term ${pattern} — keep design attribution in the cognition layer, functional semantics in code`)
      }
    }
  }
  return violations
}

const DSH_HOST_PACKAGE = '@deepseek-ai/dsh'
const REGISTRY = 'https://registry.npmjs.org/'
// Browser-half peers resolve inside the prebuilt web frontend the dsh CLI
// ships (the `dsh-client-*` packages are compiled into the frontend bundle,
// not installed as runtime dependencies), so npm-closure membership is the
// wrong dimension for them — rule 8 judges host-half (Node) peers only.
const CLIENT_FACE_PEER = /^@deepseek-ai\/dsh-client-/u

// Pure half of rule 8 (unit-testable, no network): given the host peers the
// manifest declares and the per-dist-tag dependency closures of the dsh CLI,
// a peer absent from every closure cannot be resolved inside any consumer's
// installed host tree.
export function closureReasons(hostPeers, closuresByTag) {
  const violations = []
  const tags = Object.entries(closuresByTag).map(([tag, deps]) => `${tag} (${deps.size} deps)`)
  if (tags.length === 0) return violations
  for (const peer of hostPeers) {
    const covered = Object.values(closuresByTag).some(deps => deps.has(peer))
    if (!covered) {
      violations.push(`peerDependency ${peer} is not in any ${DSH_HOST_PACKAGE} CLI dependency closure (checked dist-tags: ${tags.join(', ')}) — a published-but-out-of-closure peer kills the whole plugin tree on import for registry consumers`)
    }
  }
  return violations
}

// Network half of rule 8: transitive dependency closure of the dsh CLI per
// dist-tag, walked breadth-first over abbreviated packuments (name-level,
// concurrency-capped). Version pick per node: the exact version named in the
// specifier when the registry has it (host pins publish together, so the
// `^0.1.x-rcN` spec usually names an existing version), else the package's
// `latest` dist-tag, else the newest known version — name-level membership is
// the honest first-pass verdict; exact-version closure walks need a lockfile.
export async function hostClosureViolations(manifest, options = {}) {
  const hostPeers = Object.keys(manifest.peerDependencies ?? {}).filter(name => name.startsWith(HOST_SCOPE) && !CLIENT_FACE_PEER.test(name))
  if (hostPeers.length === 0) return []
  const registry = options.registry ?? REGISTRY
  // Registry access must fail loud, never hang: a fetch without a timeout
  // deadlocks offline/filtered environments until the caller's outer timeout
  // kills the whole gate (observed in a sandboxed session). Abort per request;
  // main() turns the abort into a visible violation with the DSH_SKIP escape.
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 10_000
  const packuments = new Map()
  const packument = async name => {
    if (!packuments.has(name)) {
      const url = new URL(name.replace('/', '%2F'), registry)
      const response = await fetch(url, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      })
      if (!response.ok) throw new Error(`registry fetch failed: ${response.status} ${url}`)
      packuments.set(name, await response.json())
    }
    return packuments.get(name)
  }
  const pickVersion = (document, specifier) => {
    const versions = document.versions ?? {}
    const exact = specifier.replace(/^[~^]/u, '')
    if (versions[exact] !== undefined) return exact
    const latest = document['dist-tags']?.latest
    if (latest !== undefined && versions[latest] !== undefined) return latest
    return Object.keys(versions).at(-1)
  }
  const root = await packument(DSH_HOST_PACKAGE)
  const closuresByTag = {}
  for (const [tag, version] of Object.entries(root['dist-tags'] ?? {})) {
    const deps = root.versions?.[version]?.dependencies
    if (!deps) continue
    const closure = new Set(Object.keys(deps))
    const queue = Object.entries(deps)
    while (queue.length > 0) {
      const batch = queue.splice(0, 8)
      const documents = await Promise.all(batch.map(([name, specifier]) => packument(name).then(document => [name, specifier, document])))
      for (const [name, specifier, document] of documents) {
        const picked = pickVersion(document, specifier)
        for (const [depName, depSpecifier] of Object.entries(document.versions?.[picked]?.dependencies ?? {})) {
          if (!closure.has(depName)) {
            closure.add(depName)
            queue.push([depName, depSpecifier])
          }
        }
      }
    }
    closuresByTag[tag] = closure
  }
  return closureReasons(hostPeers, closuresByTag)
}

// Dev-repo control-plane vocabulary must not appear in published docs
// (README.md + configured docsRoots) either: unlike sources — where comments
// carry functional semantics only — docs MAY cite dev-repo evidence, but only
// via the accepted by-name provenance form. The un-actionable forms are
// rejected mechanically: decision-record ids (ADR/RFC/PRD + number), workline
// ids (W-number), workunit references, and promotion/migration lineage verbs.
// Fenced code blocks and inline code spans are stripped before matching
// (fixture strings and identifiers live there).
const DOC_META_TERMS = [
  { rule: 'PKG-6', pattern: /\b(?:ADR|RFC|PRD)[ -]?\d{2,}\b/u },
  { rule: 'PKG-6', pattern: /\bW\d{1,2}\b/u },
  { rule: 'PKG-6', pattern: /\bworkunits?\b/u },
  { rule: 'PKG-9', pattern: /已归档|原仓库级|薄\s?shim|升格/u },
]

function docsMetaLocality(root, cfg, extraMarkdown = []) {
  const violations = []
  const targets = [
    ...contentRoots(root, cfg).flatMap(contentRoot => [
      join(contentRoot, 'README.md'),
      ...(cfg.docsRoots ?? ['docs']).flatMap(docsRoot => collectFiles(join(contentRoot, docsRoot), ['.md'])),
    ]),
    ...extraMarkdown.map(entry => ({ path: join(root, entry.path), text: entry.text })),
  ]
  for (const file of targets) {
    const text = typeof file === 'string' ? readFileSync(file, 'utf8') : file.text
    const displayed = typeof file === 'string' ? file : file.path
    const haystack = text
      .replace(/```[\s\S]*?```/gu, '')
      .replace(/`[^`\n]*`/gu, '')
    for (const term of DOC_META_TERMS) {
      term.pattern.lastIndex = 0
      if (term.pattern.test(haystack)) {
        violations.push(`${term.rule}: ${relative(root, displayed).replaceAll('\\', '/')} cites control-plane term ${term.pattern} in published docs — cite dev-repo evidence by name (original design record) without ids or lineage verbs`)
      }
    }
  }
  return violations
}

// PKG seed locality (config `rulesSeed`): the package's AGENTS.md must carry
// the pointer to its rules seed, and the seed must exist (AGENTS never carries
// rule bodies — the pointer is the only discovery path for the dot-dir seed).
function rulesSeedLocality(root, cfg) {
  const violations = []
  if (cfg.rulesSeed === undefined || cfg.rulesSeed === null) return violations
  const agentsPath = join(root, 'AGENTS.md')
  const seedRel = cfg.rulesSeed
  if (!existsSync(agentsPath)) return violations
  if (!readFileSync(agentsPath, 'utf8').includes(seedRel)) {
    violations.push(`PKG-seed: AGENTS.md does not point to the rules seed (${seedRel}) — restore the pointer line`)
  }
  if (!existsSync(join(root, seedRel))) {
    violations.push(`PKG-seed: rules seed ${seedRel} referenced from AGENTS.md does not exist`)
  }
  return violations
}

export function check(root, options = {}, cfg = undefined) {
  root = resolve(root)
  if (cfg === undefined || cfg === null) {
    // No weakened-default fallback: a caller that skips the config (e.g. a
    // unit test importing check directly) would silently run weaker rules —
    // a green test would then vouch for a gate that never ran. Load the
    // config with loadConfig() and pass it in.
    throw new Error('check() requires the package config (third argument) — await loadConfig() and pass its result; there is no default')
  }
  const manifest = options.manifestOverride ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const reasons = [
    ...manifestRules(manifest, cfg),
    ...npmScriptsLocality(manifest, root),
    ...importCoverage(root, declared, cfg),
    ...scriptsLocality(root, declared, cfg, options.extraScripts),
    ...docsLocality(root, cfg, options.extraMarkdown),
    ...docsMetaLocality(root, cfg, options.extraMarkdown),
    ...metaLocality(root, cfg, options.extraSources),
    ...rulesSeedLocality(root, cfg),
  ]
  return reasons.map(reason => ({
    reason,
    remedy: {
      kind: 'manual',
      guidance: 'Keep the package independently publishable: host packages as peerDependencies, registry ranges elsewhere, docs self-contained (cite out-of-repo evidence as plain text, not links).',
    },
  }))
}

export async function main() {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const cfg = await loadConfig()
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const violations = check(root, {}, cfg)
  if (cfg.hostClosureCheck === true && process.env.DSH_SKIP_HOST_CLOSURE !== '1') {
    try {
      violations.push(...await hostClosureViolations(manifest))
    }
    catch (error) {
      violations.push(`host closure membership check failed (${error.message}) — fix the registry access or set DSH_SKIP_HOST_CLOSURE=1 only for offline builds; a red closure check must never be silently green`)
    }
  }
  for (const violation of violations) console.error(violation.reason ?? violation)
  return violations.length === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-publish-readiness.mjs')) {
  main().then(code => {
    process.exitCode = code
  })
}
