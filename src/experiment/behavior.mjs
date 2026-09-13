/**
 * Behavior experiments: arms × repeats, for measuring probabilistic effects
 * (injected content, copy variants) on model behavior.
 *
 * A regression case asserts a deterministic contract ONCE. An experiment
 * instead measures a distribution: the same case run under several arms
 * (case-field overrides), N runs per arm, per-run metrics, a per-run guard,
 * and descriptive aggregation. Judgment stays with the consumer — the
 * definition carries a preregistered `decisionRule` that the report
 * reproduces verbatim beside a definition fingerprint, and the result object
 * never grades the hypothesis (no pass/fail exit-code semantics).
 *
 * Discipline encoded here (the false-green shapes this surface replaces; see
 * the consumer driver it hoists):
 * - a run without a trace is a NAMED row failure, never silently dropped
 *   from its arm's group;
 * - an arm with zero guard-clean runs is INVALID (named, with every failing
 *   row's reason), never rendered as an empty aggregation cell;
 * - arm `rowConfig` overrides DEEP-MERGE onto the case's own declaration, so
 *   writing only the differing keys behaves exactly like restating the whole
 *   config (baseline fidelity at the arm layer — the case-level
 *   whole-replace contract with the profile is unchanged);
 * - every cloned run's `expect` is evaluated through the official entry
 *   (`evaluateMatchers`), which inlines the evidence-anchor enforcement.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateRowConfig } from '../discovery.mjs'
import { runEvalCase } from '../runner.mjs'
import { evaluateMatchers } from '../evaluate.mjs'

/** Case fields an arm may override. `id` (framework-minted), `mode` (one
 * mode per experiment), and removed fields are deliberately absent. */
const ARM_OVERRIDE_KEYS = new Set([
  'task', 'expect', 'prepare', 'rowConfig', 'disableRows', 'followups',
  'settleTimeoutMs', 'timeoutMs',
])

/** Path-safe ids keep artifact paths and minted case ids portable. */
const PATH_SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * Deterministic serialization for the definition fingerprint: object keys
 * sorted recursively, functions rendered as placeholders (the fingerprint
 * covers the preregistered TEXT and arm structure, not function code).
 */
function stableStringify(value) {
  if (typeof value === 'function') return '"<function>"'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** sha256 over the definition's data fields — the preregistration fingerprint. */
function fingerprint(definition) {
  return createHash('sha256').update(stableStringify({
    id: definition.id,
    hypothesis: definition.hypothesis,
    arms: definition.arms,
    runs: definition.runs,
    decisionRule: definition.decisionRule,
  })).digest('hex')
}

/**
 * Deep-merge an arm's `rowConfig` override onto the case's own declaration:
 * rows the arm does not mention pass through untouched; a mentioned row
 * merges recursively, with scalars and arrays whole-replaced. This is the
 * arm-layer baseline-fidelity rule — an override naming only the differing
 * keys ends up byte-identical to restating the whole config.
 * @param {object|undefined} base - the case's `rowConfig`.
 * @param {object|undefined} override - the arm's `rowConfig` override.
 * @returns {object|undefined} the merged mapping (undefined when both are).
 */
export function mergeRowConfig(base, override) {
  if (override === undefined) return base
  const out = { ...(base ?? {}) }
  for (const [rowId, config] of Object.entries(override)) {
    out[rowId] = out[rowId] !== undefined && isPlainObject(out[rowId]) && isPlainObject(config)
      ? mergeConfig(out[rowId], config)
      : config
  }
  return out
}

function mergeConfig(base, override) {
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(out[key]) && isPlainObject(value)
      ? mergeConfig(out[key], value)
      : value
  }
  return out
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Define and validate a behavior experiment.
 * @param {object} definition - `{ id, hypothesis, arms, runs, metrics,
 *   guard?, decisionRule }`:
 *   - `id`: path-safe string (artifact paths and reports key on it);
 *   - `hypothesis`: non-empty string (what the arms are expected to differ in);
 *   - `arms`: non-empty array of `{ id, overrides? }` with unique path-safe
 *     ids; `overrides` may set any of `task` / `expect` / `prepare` /
 *     `rowConfig` / `disableRows` / `followups` / `settleTimeoutMs` /
 *     `timeoutMs` — arm differences ARE case-field overrides, there is no
 *     separate per-arm config channel;
 *   - `runs`: positive integer, runs per arm (preregistered sample size);
 *   - `metrics(trace, context) → object`: consumer-owned numeric/boolean
 *     extraction (semantics stay with the experiment author);
 *   - `guard?(metrics, context) → boolean`: per-run guard — a false verdict
 *     excludes the run from aggregation WITHOUT failing it as an error (the
 *     anti-fake-result discipline: a leak must not read as a treatment
 *     effect, a silent failure as a null result). Absent ⇒ every
 *     trace-bearing run counts as guard-clean;
 *   - `decisionRule`: non-empty string — the judgment criterion, written
 *     BEFORE running (the report reproduces it verbatim beside the
 *     definition fingerprint, so results trace back to preregistered rules).
 * @returns {object} the frozen experiment record, tagged `kind: 'behavior'`,
 *   carrying `definitionSha256`.
 */
export function defineBehaviorExperiment(definition) {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError('behavior experiment must be an object')
  }
  if (!PATH_SAFE_ID.test(definition.id ?? '')) {
    throw new TypeError('behavior experiment id must be a non-empty path-safe string')
  }
  if (typeof definition.hypothesis !== 'string' || definition.hypothesis === '') {
    throw new TypeError(`behavior experiment '${definition.id}': hypothesis must be a non-empty string`)
  }
  if (!Array.isArray(definition.arms) || definition.arms.length === 0) {
    throw new TypeError(`behavior experiment '${definition.id}': arms must be a non-empty array`)
  }
  const seen = new Set()
  for (const arm of definition.arms) {
    if (arm === null || typeof arm !== 'object' || !PATH_SAFE_ID.test(arm.id ?? '')) {
      throw new TypeError(`behavior experiment '${definition.id}': every arm needs a non-empty path-safe id`)
    }
    if (seen.has(arm.id)) {
      throw new TypeError(`behavior experiment '${definition.id}': duplicate arm id '${arm.id}'`)
    }
    seen.add(arm.id)
    if (arm.overrides !== undefined) {
      if (!isPlainObject(arm.overrides)) {
        throw new TypeError(`behavior experiment '${definition.id}' arm '${arm.id}': overrides must be an object`)
      }
      for (const key of Object.keys(arm.overrides)) {
        if (!ARM_OVERRIDE_KEYS.has(key)) {
          throw new TypeError(`behavior experiment '${definition.id}' arm '${arm.id}': '${key}' is not an arm-overridable case field (allowed: ${[...ARM_OVERRIDE_KEYS].sort().join(', ')})`)
        }
      }
    }
  }
  if (!Number.isInteger(definition.runs) || definition.runs < 1) {
    throw new TypeError(`behavior experiment '${definition.id}': runs must be a positive integer (preregistered sample size)`)
  }
  if (typeof definition.metrics !== 'function') {
    throw new TypeError(`behavior experiment '${definition.id}': metrics must be a function (trace, context) => object`)
  }
  if (definition.guard !== undefined && typeof definition.guard !== 'function') {
    throw new TypeError(`behavior experiment '${definition.id}': guard must be a function (metrics, context) => boolean`)
  }
  if (typeof definition.decisionRule !== 'string' || definition.decisionRule === '') {
    throw new TypeError(`behavior experiment '${definition.id}': decisionRule must be a non-empty string (preregistered judgment criterion)`)
  }
  return Object.freeze({ ...definition, kind: 'behavior', definitionSha256: fingerprint(definition) })
}

/**
 * Execute a behavior experiment: every arm × every run gets one fresh
 * `runEvalCase` over a clone whose id the framework mints
 * (`<caseId>:<armId>:<index>` — ids are for records and reports; per-run
 * artifacts file under `<artifactsDir>/<armId>/<index>/`, since minted ids
 * are not path-safe on every platform).
 * @param {object} experiment - a frozen record from `defineBehaviorExperiment`.
 * @param {object} evalCase - the base case (validated per cloned run by
 *   `runEvalCase`; arm `rowConfig` merges are validated up front so a bad
 *   override fails before any spawn).
 * @param {object} options - `runEvalCase` options (`profile` required; give
 *   `cliPath` — a `resolveDshCliChain` result — or legacy `dshRepoDir`;
 *   optional forced `mode`; optional `artifactsDir` for per-run artifacts;
 *   optional `onRow(row)` progress callback).
 * @returns {Promise<object>} the experiment result: `{ experimentId, caseId,
 *   hypothesis, decisionRule, definitionSha256, arms, rows }` — `arms`
 *   carries per-arm aggregation (clean counts, per-metric rate/median,
 *   `invalid` + named `invalidReasons` when zero guard-clean runs), `rows`
 *   the per-run records. The result never grades the hypothesis.
 */
export async function executeBehaviorExperiment(experiment, evalCase, options) {
  if (experiment?.kind !== 'behavior') {
    throw new TypeError('behavior experiment must come from defineBehaviorExperiment')
  }
  if (evalCase === null || typeof evalCase !== 'object' || typeof evalCase.id !== 'string' || evalCase.id === '') {
    throw new TypeError('executeBehaviorExperiment needs a base case with a non-empty string id')
  }
  if (typeof options?.profile !== 'string' || options.profile === '') {
    throw new TypeError('executeBehaviorExperiment needs options.profile')
  }
  if (options.cliPath === undefined && options.dshRepoDir === undefined) {
    throw new TypeError('executeBehaviorExperiment needs options.cliPath (a resolveDshCliChain result) or options.dshRepoDir')
  }

  for (const arm of experiment.arms) {
    const merged = mergeRowConfig(evalCase.rowConfig, arm.overrides?.rowConfig)
    if (merged !== undefined) {
      validateRowConfig(merged, `experiment '${experiment.id}' arm '${arm.id}'`)
    }
  }

  const rows = []
  for (const arm of experiment.arms) {
    for (let index = 1; index <= experiment.runs; index += 1) {
      const clone = {
        ...evalCase,
        ...(arm.overrides ?? {}),
        id: `${evalCase.id}:${arm.id}:${index}`,
        rowConfig: mergeRowConfig(evalCase.rowConfig, arm.overrides?.rowConfig),
      }
      const runOptions = {
        profile: options.profile,
        ...(options.cliPath === undefined ? {} : { cliPath: options.cliPath }),
        ...(options.dshRepoDir === undefined ? {} : { dshRepoDir: options.dshRepoDir }),
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.artifactsDir === undefined ? {} : { artifactsDir: join(options.artifactsDir, arm.id, String(index)) }),
      }
      rows.push(await runBehaviorRow(experiment, clone, arm.id, index, runOptions))
      if (typeof options.onRow === 'function') options.onRow(rows.at(-1))
    }
  }
  return {
    experimentId: experiment.id,
    caseId: evalCase.id,
    hypothesis: experiment.hypothesis,
    decisionRule: experiment.decisionRule,
    definitionSha256: experiment.definitionSha256,
    arms: summarizeBehaviorRows(experiment, rows),
    rows,
  }
}

/** One arm × index run: driver errors, missing traces, metrics/guard throws
 * all become named row failures — the loop never aborts on them. */
async function runBehaviorRow(experiment, clone, armId, index, runOptions) {
  const row = {
    arm: armId,
    index,
    caseId: clone.id,
    exitCode: null,
    timedOut: null,
    ok: false,
    failure: null,
    guardOk: null,
    metrics: null,
    expectOk: null,
    expectFailures: [],
    inspectError: null,
  }
  let result
  try {
    result = await runEvalCase(clone, runOptions)
  } catch (error) {
    row.failure = `run failed: ${error instanceof Error ? error.message : String(error)}`
    return row
  }
  row.exitCode = result.exitCode
  row.timedOut = result.timedOut
  row.inspectError = result.inspectError ?? null
  if (result.trace === undefined || result.trace === null) {
    row.failure = `no trace (${result.traceGap ?? 'collectSessionTrace returned neither trace nor gap'})`
    return row
  }
  try {
    row.metrics = experiment.metrics(result.trace, { arm: armId, index, result })
  } catch (error) {
    row.failure = `metrics threw: ${error instanceof Error ? error.message : String(error)}`
    return row
  }
  const evaluated = evaluateMatchers(clone, result.trace, `case '${clone.id}'`)
  row.expectOk = evaluated.ok
  row.expectFailures = evaluated.failures
  try {
    row.guardOk = experiment.guard === undefined
      ? true
      : experiment.guard(row.metrics, { arm: armId, index, trace: result.trace }) === true
  } catch (error) {
    row.failure = `guard threw: ${error instanceof Error ? error.message : String(error)}`
    return row
  }
  if (row.guardOk !== true) {
    row.failure = 'guard failed (run excluded from aggregation)'
    return row
  }
  row.ok = true
  return row
}

/**
 * Aggregate experiment rows per arm. Pure: the unit-test seam for the
 * false-green discipline. An arm with zero guard-clean rows is `invalid`
 * with every failing row's reason named — never an empty aggregation.
 * @param {object} experiment - the frozen behavior experiment.
 * @param {object[]} rows - rows from `executeBehaviorExperiment`.
 * @returns {object[]} per-arm summaries with per-metric `rate` / `median`
 *   over guard-clean runs only (`rate` over truthiness, `median` over finite
 *   numbers; a metric absent from every clean run keeps `null` stats and
 *   `present: 0`).
 */
export function summarizeBehaviorRows(experiment, rows) {
  return experiment.arms.map((arm) => {
    const armRows = rows.filter(row => row.arm === arm.id)
    const clean = armRows.filter(row => row.ok === true)
    const metricNames = [...new Set(clean.flatMap(row => Object.keys(row.metrics ?? {})))]
    const metrics = {}
    for (const name of metricNames) {
      const values = clean
        .map(row => row.metrics?.[name])
        .filter(value => value !== undefined && value !== null)
      metrics[name] = {
        present: values.length,
        rate: rate(values),
        median: median(values.filter(Number.isFinite)),
      }
    }
    return {
      id: arm.id,
      runs: armRows.length,
      guardClean: clean.length,
      guardFailures: armRows.filter(row => row.ok !== true && row.guardOk === false && row.failure?.startsWith('guard failed')).length,
      errors: armRows.filter(row => row.ok !== true && row.failure !== null && !row.failure.startsWith('guard failed')).length,
      invalid: clean.length === 0,
      invalidReasons: armRows.filter(row => row.ok !== true).map(row => `${row.caseId}: ${row.failure}`),
      metrics,
    }
  })
}

function rate(values) {
  if (values.length === 0) return null
  return values.filter(Boolean).length / values.length
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Render the human-facing experiment summary: hypothesis, the preregistered
 * decision rule verbatim, the definition fingerprint, per-arm status counts,
 * per-metric descriptive stats (guard-clean runs only), and — as sections of
 * their own, impossible to mistake for empty cells — every invalid arm with
 * its named reasons.
 * @param {object} result - a result from `executeBehaviorExperiment`.
 * @returns {string} markdown text.
 */
export function renderBehaviorSummary(result) {
  const lines = []
  lines.push(`# Behavior experiment: ${result.experimentId}`, '')
  lines.push(`- hypothesis: ${result.hypothesis}`)
  lines.push(`- decision rule (preregistered): ${result.decisionRule}`)
  lines.push(`- definition sha256: \`${result.definitionSha256}\``)
  lines.push('')
  lines.push('| arm | runs | guard-clean | guard failures | errors | status |')
  lines.push('|---|---|---|---|---|---|')
  for (const arm of result.arms) {
    lines.push(`| ${arm.id} | ${arm.runs} | ${arm.guardClean} | ${arm.guardFailures} | ${arm.errors} | ${arm.invalid ? '**INVALID**' : 'ok'} |`)
  }
  const metricArms = result.arms.filter(arm => Object.keys(arm.metrics).length > 0)
  if (metricArms.length > 0) {
    lines.push('', 'Metrics aggregate guard-clean runs only.', '')
    lines.push('| arm | metric | present | rate | median |')
    lines.push('|---|---|---|---|---|')
    for (const arm of metricArms) {
      for (const [name, stats] of Object.entries(arm.metrics)) {
        lines.push(`| ${arm.id} | ${name} | ${stats.present} | ${fmt(stats.rate)} | ${fmt(stats.median)} |`)
      }
    }
  }
  const invalid = result.arms.filter(arm => arm.invalid)
  if (invalid.length > 0) {
    lines.push('', '## Invalid arms (zero guard-clean runs — named failures, not empty cells)', '')
    for (const arm of invalid) {
      lines.push(`- **${arm.id}**:`)
      for (const reason of arm.invalidReasons) lines.push(`  - ${reason}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function fmt(value) {
  return value === null || value === undefined ? 'n/a' : String(value)
}

/**
 * Write the experiment artifacts: `results.json` (the full result object)
 * and `summary.md` (the rendered summary) into `dir` (created).
 * @param {object} result - a result from `executeBehaviorExperiment`.
 * @param {string} dir - output directory.
 * @returns {{ resultsPath: string, summaryPath: string }} written paths.
 */
export function writeBehaviorArtifacts(result, dir) {
  mkdirSync(dir, { recursive: true })
  const resultsPath = join(dir, 'results.json')
  const summaryPath = join(dir, 'summary.md')
  writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(summaryPath, renderBehaviorSummary(result))
  return { resultsPath, summaryPath }
}
