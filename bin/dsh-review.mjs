#!/usr/bin/env node
/**
 * Execute model-independent `*.review.mjs` experiments through dsh headless.
 *
 * Dry-run materializes live observations without touching dsh. Real runs write
 * the shared task plus each independent review answer beside the experiment:
 * `.runs/<experiment id>/`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { materializeReviewExperiment } from '../src/experiment/review.mjs'
import { runDshReviewExperiment } from '../src/adapters/dsh/review.mjs'
import { discoverFiles } from '../src/discovery.mjs'
import { loadEvalConfig } from '../src/config.mjs'
import { resolveDshCliChain } from '../src/cli.mjs'
import { renderReviewReport } from '../src/review-report.mjs'

function usage(error) {
  const message = [
    'usage: dsh-review [--dry-run] [--runs N] [--profile NAME (default: headless) --repo DIR] [--timeout MS] <*.review.mjs or directories...>',
    '       --profile/--repo may come from a dsh-eval.config.mjs found upward from cwd; flags override it.',
  ].join('\n')
  if (error) process.stderr.write(`${error}\n${message}\n`)
  else process.stdout.write(`${message}\n`)
  process.exit(error ? 2 : 0)
}

function parseArgs(argv) {
  const options = { dryRun: false, runs: undefined, timeoutMs: undefined, profile: undefined, repo: undefined }
  const paths = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (arg === '--runs') { options.runs = Number(argv[++index]); continue }
    if (arg === '--profile') { options.profile = argv[++index]; continue }
    if (arg === '--repo') { options.repo = argv[++index]; continue }
    if (arg === '--timeout') { options.timeoutMs = Number(argv[++index]); continue }
    if (arg === '-h' || arg === '--help') usage()
    paths.push(arg)
  }
  if (paths.length === 0) usage('error: at least one review experiment path is required')
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

function writeMaterialized(experiment, materialized, extra = {}, reviewResult = undefined) {
  const output = artifactDir(experiment)
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
  }), 'utf8')
  return output
}

const { options, paths } = parseArgs(process.argv.slice(2))

// Config merge (EVAL-008): flags win over a `dsh-eval.config.mjs` found
// upward from cwd; profile falls back to the sterile default `headless`.
const { config } = await loadEvalConfig(process.cwd())
const profile = options.profile ?? config.profile ?? 'headless'
// CLI resolution (C6): `--repo` flag > resolution layer (node_modules) >
// config repo key (legacy). Dry-run never boots the CLI, so resolve lazily.
let cli = { cliPath: undefined, repoDir: undefined }
if (!options.dryRun) {
  try {
    const resolved = resolveDshCliChain({ repoFlag: options.repo, configRepo: config.repo })
    cli = { cliPath: resolved.cli, repoDir: resolved.repo }
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
    const result = await runDshReviewExperiment(experiment, {
      profile,
      cliPath: cli.cliPath,
      dshRepoDir: cli.repoDir,
      runs: options.runs,
      timeoutMs: options.timeoutMs,
    })
    const output = writeMaterialized(experiment, result, {
      adapter: 'dsh-headless',
      profile,
      runs: result.runs,
    }, result)
    for (const attempt of result.attempts) {
      const payload = attempt.result ?? {}
      if (payload.stdout !== undefined) writeFileSync(join(output, `run-${attempt.index}.txt`), payload.stdout, 'utf8')
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
