// Host-borrow locality engine — enforces the borrow-vs-install discipline
// (rule 11 of verify-publish-readiness): a borrow that reaches the host
// checkout by relative path may exist ONLY inside the package's declared
// anchor consumers (cfg.hostBorrow.anchorConsumers), and tsconfig files may
// never map host-checkout paths at all (types resolve via the node_modules
// junction layer instead — a tsconfig path table is a hand-written snapshot
// of the resolver's output and drifts with the machine layout).
//
// Opt-in: no cfg.hostBorrow -> no verdicts. The gate judges FORM only (an
// escaping token outside the enumerated anchor points); whether a borrow
// deserves to exist at all (no npm exit, must pair with host source) stays a
// review-side judgment — declaring the anchor consumer IS that judgment made
// explicit.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

const HOST_ESCAPE = (hostToken) =>
  new RegExp(`(?:\\.\\.[/\\\\])+[^\\s'"\`&|;()]*${hostToken}`, 'gu')

const TSCONFIG_NAME = /^tsconfig(\.[^./]+)?\.json$/u
const isTsconfig = (file) => TSCONFIG_NAME.test(file.split(/[\\/]/).pop() ?? '')

const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'dist', 'coverage'])
// Test trees are fixture data, not toolchain surface: their host-checkout
// strings are example tokens (publish-gate fixtures quote real violations on
// purpose). A test file never wires the build, so it cannot smuggle a borrow.
const SKIP_DIRS_B = new Set([...SKIP_DIRS, 'test', 'tests', 'spec', '__tests__'])

function walkFiles(root, dir, extensions, out = [], skipDirs = SKIP_DIRS) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue
      walkFiles(root, join(dir, entry.name), extensions, out, skipDirs)
    }
    else if (extensions.includes(entry.name.split('.').pop() ?? '')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// tsconfig allows comments and trailing commas; strip the comments for a
// tolerant JSON.parse (trailing commas are not expected in these faces).
function parseJsonc(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '')
  return JSON.parse(stripped)
}

const inside = (target, root) => target === root || target.startsWith(root + '/') || target.startsWith(root + '\\')

export function hostBorrowLocality(root, cfg) {
  const violations = []
  const hostBorrow = cfg?.hostBorrow
  if (hostBorrow === undefined || hostBorrow === null) return violations
  const hostToken = hostBorrow.hostToken ?? 'deepseek-harness'
  const anchorConsumers = new Set(
    (hostBorrow.anchorConsumers ?? []).map(path => path.replaceAll('\\', '/')),
  )
  const display = path => relative(root, path).replaceAll('\\', '/')

  // (a) tsconfig host-path snapshots: paths/typeRoots entries resolving
  // outside the package root are violations outright — no allowlist, the
  // junction layer makes them unnecessary everywhere.
  for (const file of walkFiles(root, root, ['json'])) {
    if (!isTsconfig(file)) continue
    let parsed
    try { parsed = parseJsonc(readFileSync(file, 'utf8')) }
    catch { continue } // malformed tsconfig is not this rule's verdict
    const compilerOptions = parsed.compilerOptions ?? {}
    const entries = [
      ...(Array.isArray(compilerOptions.typeRoots) ? compilerOptions.typeRoots : []),
      ...Object.values(compilerOptions.paths ?? {}).flat(),
    ]
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.startsWith('.')) continue
      // tsconfig path entries are relative to the tsconfig's own directory.
      const target = resolve(dirname(file), entry)
      if (!inside(target, root)) {
        violations.push(`PKG-10: ${display(file)} maps "${entry}" outside the package root — tsconfig must not snapshot host-checkout paths; resolve types via the node_modules junction layer instead`)
      }
    }
  }

  // (b) anchor-consumer allowlist: any host-checkout-escaping token in a
  // checked-in code/config file must live in a declared anchor consumer.
  const escapePattern = HOST_ESCAPE(hostToken)
  for (const file of walkFiles(root, root, ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json'], [], SKIP_DIRS_B)) {
    if (isTsconfig(file)) continue // tsconfig form is judged wholly by (a)
    const rel = display(file)
    if (anchorConsumers.has(rel)) continue
    const text = readFileSync(file, 'utf8')
    escapePattern.lastIndex = 0
    const match = escapePattern.exec(text)
    if (match !== null) {
      violations.push(`PKG-10: ${rel} contains host-checkout path token "${match[0]}" but is not a declared anchor consumer (cfg.hostBorrow.anchorConsumers) — a borrow with no npm exit must live only in the enumerated anchor points; an installable tool belongs in devDependencies instead`)
    }
  }
  return violations
}
