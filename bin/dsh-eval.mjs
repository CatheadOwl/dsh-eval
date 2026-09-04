#!/usr/bin/env node
/**
 * dsh-eval — the plugin agent-eval case executor.
 *
 * Usage:
 *   dsh-eval run --profile <name> --repo <deepseek-harness dir>
 *                [--mode real|mock|all] [--keep-artifacts] [--fail-on-skip]
 *                [--format text|json] [--report <file>]
 *                <case paths...>
 *
 * A case path is a `*.eval.mjs` file or a directory scanned recursively for
 * them. Each file default-exports one case object (or an array of them):
 * `{ id, task, mode?: 'real'|'mock', expect: Matcher[], script?, persona?,
 * prepare?, timeoutMs? }`. Real cases skip when DEEPSEEK_API_KEY is absent;
 * the exit code is 1 when any run fails. Failures keep their artifacts under
 * `<case file dir>/.runs/<case id>/`.
 *
 * Output formats:
 * - `--format text` (default): unchanged human output on stdout/stderr.
 * - `--format json`: all progress and failure chatter moves to stderr;
 *   stdout receives exactly one JSON report object (see src/report.mjs).
 * - `--report <file>`: additionally write that report object to a file,
 *   in either format — the aggregation/CI consumption path.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runEvalCase } from '../src/runner.mjs'
import { discoverFiles, validateEvalCase, detectDuplicateIds } from '../src/discovery.mjs'
import { createCaseRecord, buildRunReport, reportExitCode, mockDeterminismHint } from '../src/report.mjs'
import { loadEvalConfig } from '../src/config.mjs'
import { resolveDshCliChain } from '../src/cli.mjs'

function usage(error) {
  const text = [
    'usage: dsh-eval run [--profile <name>] [--repo <deepseek-harness>] [--mode real|mock|all] [--keep-artifacts] [--fail-on-skip] [--format text|json] [--report <file>] <case paths...>',
    '       --profile/--repo/--mode/--fail-on-skip/--report may come from a dsh-eval.config.mjs found upward from cwd; flags override it.',
  ].join('\n')
  if (error === undefined) {
    process.stdout.write(`${text}\n`)
    process.exit(0)
  }
  process.stderr.write(`${error}\n${text}\n`)
  process.exit(2)
}

/** Parse argv: known flags, then case paths. Profile/repo/mode/failOnSkip
 * may come from a `dsh-eval.config.mjs` instead of flags (flags win);
 * required-ness is checked after config merging, not here. */
function parseArgs(argv) {
  const options = {
    profile: undefined, repo: undefined, mode: undefined,
    keepArtifacts: false, failOnSkip: undefined, format: 'text', report: undefined,
  }
  const paths = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === 'run') continue
    if (arg === '--profile') { options.profile = argv[++i]; continue }
    if (arg === '--repo') { options.repo = argv[++i]; continue }
    if (arg === '--mode') { options.mode = argv[++i]; continue }
    if (arg === '--keep-artifacts') { options.keepArtifacts = true; continue }
    if (arg === '--fail-on-skip') { options.failOnSkip = true; continue }
    if (arg === '--format') { options.format = argv[++i]; continue }
    if (arg === '--report') { options.report = argv[++i]; continue }
    if (arg === '-h' || arg === '--help') usage()
    paths.push(arg)
  }
  if (!['real', 'mock', 'all'].includes(options.mode ?? 'all')) usage(`error: --mode must be real, mock, or all (got '${options.mode}')`)
  if (!['text', 'json'].includes(options.format)) usage(`error: --format must be text or json (got '${options.format}')`)
  if (paths.length === 0) usage('error: at least one case file or directory is required')
  return { options, paths }
}

/**
 * Line output that respects the format: in `json` mode stdout is reserved
 * for the single report object, so progress lines go to stderr instead.
 */
function say(line) {
  if (jsonFormat) process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}

/** Recursively collect `*.eval.mjs` files from one file or directory path. */
function discoverCaseFiles(path) {
  return discoverFiles(path, '.eval.mjs')
}

/** Import one case file, validate shape, and normalize to a case array. */
async function loadCases(file) {
  const module = await import(pathToFileURL(file).href)
  const exported = module.default
  const list = Array.isArray(exported) ? exported : [exported]
  for (const evalCase of list) {
    validateEvalCase(evalCase, file)
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

const startedAt = new Date().toISOString()
const { options, paths } = parseArgs(process.argv.slice(2))
const jsonFormat = options.format === 'json'

// Config merge: a `dsh-eval.config.mjs` reachable from cwd
// supplies defaults; explicit flags always win. Required-ness is only
// decided after the merge, so config-only invocations work.
const { config } = await loadEvalConfig(process.cwd())
const profile = options.profile ?? config.profile
const modeFilter = options.mode ?? config.mode ?? 'all'
const failOnSkip = options.failOnSkip ?? config.failOnSkip ?? false
if (profile === undefined) usage('error: --profile <name> is required (or set profile in dsh-eval.config.mjs)')
// CLI resolution (C6, spec host-checkout-resolution): `--repo` flag >
// resolution layer (node_modules/@deepseek-ai/dsh) > config repo key (legacy).
// Committed files carry no real host-checkout path.
const { cli: cliPath, repo: repoDir, source: cliSource } = resolveDshCliChain({
  repoFlag: options.repo,
  configRepo: config.repo,
})
const reportRepo = repoDir ?? cliPath

const files = paths.flatMap(path => {
  const absolute = resolve(path)
  if (!existsSync(absolute)) usage(`error: no such case path: ${path}`)
  return discoverCaseFiles(absolute)
})
if (files.length === 0) usage('error: no *.eval.mjs case files found')

const records = []
const seenIds = new Map()

for (const file of files.sort()) {
  let cases
  try {
    cases = await loadCases(file)
  } catch (error) {
    records.push(createCaseRecord({
      id: file, file, status: 'fail',
      failures: [`failed to load cases: ${error.message}`],
    }))
    process.stderr.write(`FAIL ${file}: failed to load cases: ${error.message}\n`)
    continue
  }
  // Intra-file duplicate check
  try {
    detectDuplicateIds(cases)
  } catch (error) {
    records.push(createCaseRecord({
      id: file, file, status: 'fail',
      failures: [error.message],
    }))
    process.stderr.write(`FAIL ${file}: ${error.message}\n`)
    continue
  }
  // Cross-file duplicate check (only add to seenIds after all pass)
  let hasDuplicate = false
  for (const c of cases) {
    if (seenIds.has(c.id)) {
      const message = `duplicate case id '${c.id}' (also in ${seenIds.get(c.id)})`
      records.push(createCaseRecord({
        id: c.id, file, mode: c.mode ?? 'real', status: 'fail',
        failures: [message],
      }))
      process.stderr.write(`FAIL ${file}: ${message}\n`)
      hasDuplicate = true
      break
    }
  }
  if (hasDuplicate) continue
  for (const c of cases) seenIds.set(c.id, file)
  for (const rawCase of cases) {
    // Row-disable precedence: a case's own `disableRows` —
    // including an explicit `[]` ("disable nothing") — overrides the
    // config-level default; only an undeclared field inherits it.
    const evalCase = rawCase.disableRows === undefined && config.disableRows !== undefined
      ? { ...rawCase, disableRows: config.disableRows }
      : rawCase
    const mode = evalCase.mode ?? 'real'
    const skip = skipReason(evalCase, modeFilter)
    if (skip !== undefined) {
      records.push(createCaseRecord({
        id: evalCase.id, file, mode, status: 'skip', skipReason: skip,
      }))
      say(`SKIP ${evalCase.id}: ${skip}`)
      continue
    }
    say(`RUN  ${evalCase.id} (${mode})...`)
    const runStartedAt = Date.now()
    let result
    try {
      result = await runEvalCase(evalCase, { profile, cliPath, dshRepoDir: repoDir, mode })
    } catch (error) {
      records.push(createCaseRecord({
        id: evalCase.id, file, mode, status: 'fail',
        failures: [`runner error: ${error.message}`],
        durationMs: Date.now() - runStartedAt,
      }))
      process.stderr.write(`FAIL ${evalCase.id}: runner error: ${error.message}\n`)
      continue
    }
    const durationMs = Date.now() - runStartedAt

    if (result.trace === undefined) {
      const artifactsDir = writeArtifacts(evalCase, result, mode)
      records.push(createCaseRecord({
        id: evalCase.id, file, mode, status: 'fail',
        failures: [`no session trace materialized (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`],
        exitCode: result.exitCode, timedOut: result.timedOut,
        durationMs, artifactsDir,
      }))
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
      failures.push(`dsh CLI exited with code ${result.exitCode} (the turn did not complete)`)
    }
    for (const matcher of evalCase.expect) {
      const outcome = matcher.check(result.trace)
      if (!outcome.ok) failures.push(`${matcher.describe}: ${outcome.message}`)
    }
    if (result.timedOut) failures.push('run timed out')
    if (result.inspectError !== undefined) failures.push(`workspace inspect failed: ${result.inspectError}`)

    if (failures.length === 0) {
      const artifactsDir = options.keepArtifacts ? writeArtifacts(evalCase, result, mode) : undefined
      records.push(createCaseRecord({
        id: evalCase.id, file, mode, status: 'pass',
        exitCode: result.exitCode, timedOut: result.timedOut,
        durationMs, ...(artifactsDir !== undefined ? { artifactsDir } : {}),
      }))
      say(`PASS ${evalCase.id}`)
    } else {
      const artifactsDir = writeArtifacts(evalCase, result, mode)
      // Self-explaining failure for broken mock determinism: when non-host
      // plugin injections are visible in the
      // trace, the failure names them and the two framework-native exits —
      // consumers stop rediscovering the mechanism from raw traces.
      let hint
      if (mode === 'mock') hint = mockDeterminismHint({ trace: result.trace, failures })
      records.push(createCaseRecord({
        id: evalCase.id, file, mode, status: 'fail', failures: hint ? [...failures, hint] : failures,
        exitCode: result.exitCode, timedOut: result.timedOut,
        durationMs, artifactsDir,
      }))
      process.stderr.write(`FAIL ${evalCase.id} (exit ${result.exitCode}):\n${failures.map(f => `  - ${f}`).join('\n')}\n`)
      if (hint !== undefined) process.stderr.write(`  ! ${hint}\n`)
      process.stderr.write(`     artifacts: ${artifactsDir}\n`)
    }
  }
}

const finishedAt = new Date().toISOString()
const report = buildRunReport({
  profile,
  repo: reportRepo,
  cliSource,
  modeFilter,
  failOnSkip,
  startedAt,
  finishedAt,
  records,
})

const reportTarget = options.report ?? config.report
if (reportTarget !== undefined) {
  const reportPath = isAbsolute(reportTarget) ? reportTarget : resolve(process.cwd(), reportTarget)
  try {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, undefined, 2))
    process.stderr.write(`report: ${reportPath}\n`)
  } catch (error) {
    process.stderr.write(`error: failed to write report '${reportPath}': ${error.message}\n`)
    process.exit(2)
  }
}

if (options.format === 'json') {
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
} else {
  const { summary } = report
  process.stdout.write(`\n${summary.selected} selected, ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped\n`)
}
process.exit(reportExitCode(records, failOnSkip))
