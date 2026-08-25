#!/usr/bin/env node
/**
 * dsh-eval — the plugin agent-eval case executor.
 *
 * Usage:
 *   dsh-eval run --profile <name> --repo <deepseek-harness dir>
 *                [--mode real|mock|all] [--keep-artifacts] [--fail-on-skip]
 *                <case paths...>
 *
 * A case path is a `*.eval.mjs` file or a directory scanned recursively for
 * them. Each file default-exports one case object (or an array of them):
 * `{ id, task, mode?: 'real'|'mock', expect: Matcher[], script?, persona?,
 * prepare?, timeoutMs? }`. Real cases skip when DEEPSEEK_API_KEY is absent;
 * the exit code is 1 when any run fails. Failures keep their artifacts under
 * `<case file dir>/.runs/<case id>/`.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runEvalCase, looksLikeDshRepo } from '../src/runner.mjs'

function usage(error) {
  const text = [
    'usage: dsh-eval run --profile <name> --repo <deepseek-harness> [--mode real|mock|all] [--keep-artifacts] [--fail-on-skip] <case paths...>',
  ].join('\n')
  if (error === undefined) {
    process.stdout.write(`${text}\n`)
    process.exit(0)
  }
  process.stderr.write(`${error}\n${text}\n`)
  process.exit(2)
}

/** Parse argv: known flags, then case paths. */
function parseArgs(argv) {
  const options = { profile: undefined, repo: undefined, mode: 'all', keepArtifacts: false, failOnSkip: false }
  const paths = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === 'run') continue
    if (arg === '--profile') { options.profile = argv[++i]; continue }
    if (arg === '--repo') { options.repo = argv[++i]; continue }
    if (arg === '--mode') { options.mode = argv[++i]; continue }
    if (arg === '--keep-artifacts') { options.keepArtifacts = true; continue }
    if (arg === '--fail-on-skip') { options.failOnSkip = true; continue }
    if (arg === '-h' || arg === '--help') usage()
    paths.push(arg)
  }
  if (options.profile === undefined) usage('error: --profile <name> is required')
  if (options.repo === undefined) usage('error: --repo <deepseek-harness dir> is required')
  if (!['real', 'mock', 'all'].includes(options.mode)) usage(`error: --mode must be real, mock, or all (got '${options.mode}')`)
  if (paths.length === 0) usage('error: at least one case file or directory is required')
  return { options, paths }
}

/** Recursively collect `*.eval.mjs` files from one file or directory path. */
function discoverCaseFiles(path, out = []) {
  const absolute = resolve(path)
  if (statSync(absolute).isFile()) {
    if (absolute.endsWith('.eval.mjs')) out.push(absolute)
    return out
  }
  for (const item of readdirSync(absolute, { withFileTypes: true })) {
    const full = join(absolute, item.name)
    if (item.isDirectory()) discoverCaseFiles(full, out)
    else if (item.name.endsWith('.eval.mjs')) out.push(full)
  }
  return out
}

/** Import one case file and normalize its default export to a case array. */
async function loadCases(file) {
  const module = await import(pathToFileURL(file).href)
  const exported = module.default
  const list = Array.isArray(exported) ? exported : [exported]
  for (const evalCase of list) {
    if (typeof evalCase?.id !== 'string' || typeof evalCase?.task !== 'string' || !Array.isArray(evalCase?.expect)) {
      throw new Error(`${file}: case must export { id, task, expect: Matcher[] }`)
    }
  }
  return list.map(evalCase => ({ ...evalCase, __file: file }))
}

/**
 * Whether a model credential is available to a real run: the process
 * environment, or the managed `$DSH_HOME/.credentials.yaml` document that
 * `dsh-credentials-local` resolves per request. The key's VALUE is never
 * read here — presence is the gate.
 */
function credentialAvailable() {
  if (process.env.DEEPSEEK_API_KEY !== undefined) return true
  const home = (process.env.DSH_HOME ?? '').trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return existsSync(join(home, '.credentials.yaml'))
}

/** Why a case is skipped, or undefined when it should run. */
function skipReason(evalCase, modeFilter) {
  const mode = evalCase.mode ?? 'real'
  if (modeFilter !== 'all' && mode !== modeFilter) return `--mode ${modeFilter}`
  if (mode === 'real' && !credentialAvailable()) {
    return 'no credential (DEEPSEEK_API_KEY unset and no $DSH_HOME/.credentials.yaml)'
  }
  return undefined
}

/**
 * Persist one run's post-mortem artifacts under `.runs/<case id>/` next to
 * the case file: the in-memory streams/trace plus the raw session logs
 * captured before the run dir cleanup.
 */
function writeArtifacts(evalCase, result, mode) {
  const artifactsDir = join(dirname(evalCase.__file), '.runs', evalCase.id)
  try {
    mkdirSync(artifactsDir, { recursive: true })
    writeFileSync(join(artifactsDir, 'stdout.txt'), result.stdout)
    writeFileSync(join(artifactsDir, 'stderr.txt'), result.stderr)
    writeFileSync(join(artifactsDir, 'trace.json'), JSON.stringify({
      caseId: evalCase.id, mode, task: evalCase.task,
      exitCode: result.exitCode, timedOut: result.timedOut, trace: result.trace,
    }, undefined, 2))
    result.sessionLogs.forEach((text, index) => {
      writeFileSync(join(artifactsDir, `session-${index}.jsonl`), text)
    })
  } catch { /* artifact persistence is best-effort */ }
  return artifactsDir
}

const { options, paths } = parseArgs(process.argv.slice(2))
const repoDir = isAbsolute(options.repo) ? options.repo : resolve(process.cwd(), options.repo)
if (!looksLikeDshRepo(repoDir)) {
  usage(`error: --repo '${repoDir}' has no apps/cli/lib/bin.js — build the dsh CLI first (pnpm build) or pass the deepseek-harness checkout`)
}

const files = paths.flatMap(path => {
  const absolute = resolve(path)
  if (!existsSync(absolute)) usage(`error: no such case path: ${path}`)
  return discoverCaseFiles(absolute)
})
if (files.length === 0) usage('error: no *.eval.mjs case files found')

let passed = 0
let failed = 0
let skipped = 0
let selected = 0

for (const file of files.sort()) {
  let cases
  try {
    cases = await loadCases(file)
  } catch (error) {
    failed += 1
    process.stderr.write(`FAIL ${file}: failed to load cases: ${error.message}\n`)
    continue
  }
  for (const evalCase of cases) {
    selected += 1
    const skip = skipReason(evalCase, options.mode)
    if (skip !== undefined) {
      skipped += 1
      process.stdout.write(`SKIP ${evalCase.id}: ${skip}\n`)
      continue
    }
    const mode = evalCase.mode ?? 'real'
    process.stdout.write(`RUN  ${evalCase.id} (${mode})...\n`)
    let result
    try {
      result = await runEvalCase(evalCase, { profile: options.profile, dshRepoDir: repoDir, mode })
    } catch (error) {
      failed += 1
      process.stderr.write(`FAIL ${evalCase.id}: runner error: ${error.message}\n`)
      continue
    }

    if (result.trace === undefined) {
      failed += 1
      const artifactsDir = writeArtifacts(evalCase, result, mode)
      process.stderr.write(
        `FAIL ${evalCase.id}: no session trace materialized (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})\n`
        + `     artifacts: ${artifactsDir}\n--- stderr ---\n${result.stderr}\n`,
      )
      continue
    }

    const failures = []
    if (result.exitCode !== 0) {
      // Headless SSOT: exit 0 iff the turn completed. A run that errored out
      // must not pass on coincidentally satisfied matchers.
      failures.push(`  - dsh CLI exited with code ${result.exitCode} (the turn did not complete)`)
    }
    for (const matcher of evalCase.expect) {
      const outcome = matcher.check(result.trace)
      if (!outcome.ok) failures.push(`  - ${matcher.describe}: ${outcome.message}`)
    }
    if (result.timedOut) failures.push('  - run timed out')
    if (result.inspectError !== undefined) failures.push(`  - workspace inspect failed: ${result.inspectError}`)

    if (failures.length === 0) {
      passed += 1
      process.stdout.write(`PASS ${evalCase.id}\n`)
      if (options.keepArtifacts) writeArtifacts(evalCase, result, mode)
    } else {
      failed += 1
      const artifactsDir = writeArtifacts(evalCase, result, mode)
      process.stderr.write(`FAIL ${evalCase.id} (exit ${result.exitCode}):\n${failures.join('\n')}\n`)
      process.stderr.write(`     artifacts: ${artifactsDir}\n`)
    }
  }
}

process.stdout.write(`\n${selected} selected, ${passed} passed, ${failed} failed, ${skipped} skipped\n`)
const exitFail = failed > 0 || (options.failOnSkip && selected > 0 && passed + failed === 0)
process.exit(exitFail ? 1 : 0)
