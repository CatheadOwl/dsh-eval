#!/usr/bin/env node
/**
 * Execute model-independent `*.review.mjs` experiments through dsh headless.
 *
 * Dry-run materializes live observations without touching dsh. Real runs write
 * the shared task plus each independent review answer beside the experiment:
 * `.runs/<experiment id>/`.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { materializeReviewExperiment, executeReviewExperiment, executeReviewJudge } from '../src/experiment/review.mjs'
import { createDshHeadlessReviewExecutor } from '../src/adapters/dsh/review.mjs'
import { discoverFiles } from '../src/discovery.mjs'
import { loadEvalConfig } from '../src/config.mjs'
import { resolveDshCliChain } from '../src/cli.mjs'
import { renderReviewReport } from '../src/review-report.mjs'

function usage(error) {
  const message = [
    'usage: dsh-review [--dry-run] [--judge] [--runs N] [--profile NAME (default: headless) --repo DIR] [--timeout MS] [--keep-plugin-rows] <*.review.mjs or directories...>',
    '       --profile/--repo may come from a dsh-eval.config.mjs found upward from cwd; flags override it.',
    '       blank environment by default: every out-of-tree plugin row in the staged profile is disabled;',
    '       --keep-plugin-rows opts back into the host profile plugin face (e.g. reviewing a plugin\'s own gates).',
    '       --judge adds a machine first-pass grading dispatch (one more model run that sees the rubric,',
    '       the observations, and every reviewer answer); it prefills the report, never gates the exit code.',
  ].join('\n')
  if (error) process.stderr.write(`${error}\n${message}\n`)
  else process.stdout.write(`${message}\n`)
  process.exit(error ? 2 : 0)
}

function parseArgs(argv) {
  const options = { dryRun: false, judge: false, runs: undefined, timeoutMs: undefined, profile: undefined, repo: undefined, keepPluginRows: false }
  const paths = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--judge') { options.judge = true; continue }
    if (arg === '--runs') { options.runs = Number(argv[++index]); continue }
    if (arg === '--profile') { options.profile = argv[++index]; continue }
    if (arg === '--repo') { options.repo = argv[++index]; continue }
    if (arg === '--timeout') { options.timeoutMs = Number(argv[++index]); continue }
    if (arg === '--keep-plugin-rows') { options.keepPluginRows = true; continue }
    if (arg === '-h' || arg === '--help') usage()
    paths.push(arg)
  }
  if (paths.length === 0) usage('error: at least one review experiment path is required')
  if (options.judge && options.dryRun) usage('error: --judge requires a real run (dry-run invokes no model)')
  if (options.runs !== undefined && (!Number.isInteger(options.runs) || options.runs < 1)) usage('error: --runs must be a positive integer')
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1)) usage('error: --timeout must be a positive integer')
  return { options, paths }
}

function discover(path) {
  return discoverFiles(path, '.review.mjs')
}

async function loadExperiment(file) {
  const module = await import(pathToFileURL(file).href)
  const experiment = module.default
  if (experiment?.kind !== 'review') {
    throw new Error(`${file}: default export must come from defineReviewExperiment(...)`)
  }
  return { ...experiment, __file: file }
}

function artifactDir(experiment) {
  return join(dirname(experiment.__file), '.runs', experiment.id)
}

function writeMaterialized(experiment, materialized, extra = {}, reviewResult = undefined, judge = undefined) {
  const output = artifactDir(experiment)
  // Fresh-run semantics: wipe before writing, so an execution with fewer runs
  // never leaves a previous execution's run-N files looking current. The dir
  // holds generated artifacts only (review rule: 生成物不做 SSOT).
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'task.txt'), materialized.task, 'utf8')
  writeFileSync(join(output, 'observations.md'), materialized.observations, 'utf8')
  writeFileSync(join(output, 'run.json'), JSON.stringify({
    experimentId: experiment.id,
    summary: experiment.summary,
    rubric: String(experiment.rubric),
    ...extra,
  }, null, 2), 'utf8')
  writeFileSync(join(output, 'review-report.md'), renderReviewReport({
    experiment,
    result: reviewResult,
    observations: materialized.observations,
    adapter: extra.adapter,
    profile: extra.profile,
    judge,
  }), 'utf8')
  return output
}

const { options, paths } = parseArgs(process.argv.slice(2))

// Config merge: flags win over a `dsh-eval.config.mjs` found
// upward from cwd; profile falls back to the sterile default `headless`.
const { config } = await loadEvalConfig(process.cwd())
const profile = options.profile ?? config.profile ?? 'headless'
// CLI resolution (C6): `--repo` flag > resolution layer (node_modules) >
// config repo key (legacy). Dry-run never boots the CLI, so resolve lazily.
let cli = { cliPath: undefined }
if (!options.dryRun) {
  try {
    const resolved = resolveDshCliChain({ repoFlag: options.repo, configRepo: config.repo })
    cli = { cliPath: resolved.cli }
  } catch (error) {
    usage(`error: ${error.message}`)
  }
}

for (const path of paths) {
  if (!existsSync(resolve(path))) usage(`error: no such experiment path: ${path}`)
}
const files = paths.flatMap(path => discover(path)).sort()
if (files.length === 0) usage('error: no *.review.mjs experiment files found')

let failures = 0
for (const file of files) {
  let experiment
  try {
    experiment = await loadExperiment(file)
    if (options.dryRun) {
      const materialized = await materializeReviewExperiment(experiment)
      const output = writeMaterialized(experiment, materialized, { adapter: null, dryRun: true })
      process.stdout.write(`DRY  ${experiment.id}: ${output}\n`)
      continue
    }

    process.stdout.write(`RUN  ${experiment.id} (${options.runs ?? experiment.defaultRuns} reviews)...\n`)
    // One executor instance serves the reviewer dispatches AND the judge
    // dispatch (same blank environment, same profile — the judge differs
    // only in what it sees: the rubric, which the reviewers never saw).
    const executor = createDshHeadlessReviewExecutor({
      profile,
      cliPath: cli.cliPath,
      timeoutMs: options.timeoutMs,
      keepPluginRows: options.keepPluginRows,
    })
    const result = await executeReviewExperiment(experiment, executor, { runs: options.runs })

    // Machine first-pass judge (EVAL-033): one more dispatch through the
    // same executor, seeing rubric + observations + every successful
    // answer. Judge trouble is ACCOUNTED, never exit-code-relevant: the
    // verdict is evidence (review never gates CI), and "the judge pass did
    // not produce a prefill" must look exactly like that in the artifacts.
    let judge
    let judgeRaw
    if (options.judge) {
      const answers = result.attempts.filter(attempt => attempt.ok)
        .map(attempt => attempt.result?.answer ?? attempt.result?.stdout ?? '')
        .filter(answer => answer !== '')
      if (answers.length === 0) {
        judge = { status: 'not-executed', reason: 'no successful reviewer run to grade' }
      } else {
        try {
          const judgeRun = await executeReviewJudge(experiment, executor, {
            observations: result.observations,
            answers,
          })
          judge = { ...judgeRun.parsed, profile, judgedAt: judgeRun.judgedAt }
          judgeRaw = judgeRun.raw
        } catch (error) {
          judge = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
        }
      }
      if (judge.status !== 'judged') {
        process.stderr.write(`WARN ${experiment.id}: judge pass ${judge.status}`
          + (judge.missing ? ` (missing sections: ${judge.missing.join(', ')})` : '')
          + (judge.error ? ` (${judge.error})` : '')
          + (judge.reason ? ` (${judge.reason})` : '') + '\n')
      }
    }

    const output = writeMaterialized(experiment, result, {
      adapter: 'dsh-headless',
      profile,
      runs: result.runs,
      // Machine-readable judge accounting: judged / unparsed / failed /
      // not-executed — same shape the report renders in prose.
      ...(judge === undefined ? {} : { judge: { status: judge.status, profile, ...(judge.judgedAt ? { judgedAt: judge.judgedAt } : {}) } }),
      // Machine-readable boundary accounting per run: `checked` (the request
      // headers were inspected) vs `not-executed` (no session artifact, so the
      // reviewer's tool face was never verified) — the report and run-N.txt
      // carry the same fact in prose (EVAL-021).
      toolBoundaries: result.attempts.map(attempt => ({
        run: attempt.index,
        status: attempt.result?.toolValidation?.status ?? 'not-reported',
        ...(attempt.result?.traceGap === undefined ? {} : { reason: attempt.result.traceGap }),
      })),
    }, result, judge)
    // Parsed judge prefill lands in run artifacts beside the raw output:
    // judge.json is what a triage consumer reads first, judge.txt the
    // verbatim instrument output behind it (written after writeMaterialized —
    // it wipes the artifact dir on entry).
    if (judge !== undefined) {
      writeFileSync(join(output, 'judge.json'), JSON.stringify(judge, null, 2), 'utf8')
      if (judgeRaw !== undefined) writeFileSync(join(output, 'judge.txt'), judgeRaw, 'utf8')
    }
    for (const attempt of result.attempts) {
      const payload = attempt.result ?? {}
      // run-N.txt is the reviewer's ANSWER (trace-derived, splice-proof),
      // falling back to stdout for executors/trace-less runs; the raw final
      // message stays in run-N.stdout.txt when it differs from the answer,
      // the full session transcript in run-N.stderr.txt. A run whose tool
      // boundary was never verified says so at the TOP of this file: it is
      // what a grader opens first, and its answer is the fallback one.
      const boundaryNotice = payload.toolValidation?.status === 'not-executed'
        ? `[tool-boundary: NOT EXECUTED — ${payload.traceGap ?? 'no session trace materialized'}]\n\n`
        : ''
      if (payload.answer !== undefined) writeFileSync(join(output, `run-${attempt.index}.txt`), boundaryNotice + payload.answer, 'utf8')
      else if (payload.stdout !== undefined) writeFileSync(join(output, `run-${attempt.index}.txt`), boundaryNotice + payload.stdout, 'utf8')
      if (payload.stdout !== undefined && payload.answer !== undefined && payload.stdout !== payload.answer) {
        writeFileSync(join(output, `run-${attempt.index}.stdout.txt`), payload.stdout, 'utf8')
      }
      if (payload.stderr) writeFileSync(join(output, `run-${attempt.index}.stderr.txt`), payload.stderr, 'utf8')
      if (payload.toolBoundaryEvidence) writeFileSync(join(output, `run-${attempt.index}.tool-boundary-evidence.json`), payload.toolBoundaryEvidence, 'utf8')
      if (!attempt.ok) {
        failures += 1
        writeFileSync(join(output, `run-${attempt.index}.error.txt`), attempt.error, 'utf8')
        process.stderr.write(`FAIL ${experiment.id} run ${attempt.index}: ${attempt.error}\n`)
      }
    }
    if (result.attempts.every(attempt => attempt.ok)) process.stdout.write(`DONE ${experiment.id}: ${output}\n`)
  } catch (error) {
    failures += 1
    process.stderr.write(`FAIL ${file}: ${error.message}\n`)
  }
}

process.exit(failures === 0 ? 0 : 1)
