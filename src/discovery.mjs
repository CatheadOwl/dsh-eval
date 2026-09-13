/**
 * Shared case / experiment discovery and validation for the eval CLIs.
 * Both `dsh-eval` and `dsh-review` scan directories recursively; this
 * module ensures they share identical skip rules and validation.
 */

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { requiresEvidence } from './assertions.mjs'
/**
 * Directories never to descend into during discovery. `.runs` holds
 * prior-run artifacts that would be re-discovered as cases; `node_modules`
 * would pull in dependencies that happen to match the suffix.
 */
const SKIP_DIRS = new Set(['.runs', 'node_modules'])

/**
 * Recursively collect files matching `suffix` under `path`.
 * Always skips `.runs` and `node_modules`.
 * @param {string} path - a file or directory path.
 * @param {string} suffix - the filename suffix to match (e.g. '.eval.mjs').
 * @param {string[]} [out] - accumulator (internal).
 * @returns {string[]} list of discovered files (unsorted; callers sort if needed).
 */
export function discoverFiles(path, suffix, out = []) {
  const absolute = resolve(path)
  if (statSync(absolute).isFile()) {
    if (absolute.endsWith(suffix)) out.push(absolute)
    return out
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const full = join(absolute, entry.name)
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      discoverFiles(full, suffix, out)
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Validate a `disableRows` declaration (case-level or ad-hoc): an array of
 * non-empty loader row id strings. An EMPTY array is legal and means
 * "disable nothing, explicitly" — it overrides a `disableRows` default
 * from `dsh-eval.config.mjs`. Throws with `label` context. Shared by
 * `validateEvalCase` (load time) and `runEvalCase` (execution time) so both
 * report the identical message.
 * @param {unknown} disableRows - the value to validate.
 * @param {string} label - error-message context (e.g. `case '<id>'`).
 */
export function validateDisableRows(disableRows, label) {
  if (!Array.isArray(disableRows)
    || disableRows.some(row => typeof row !== 'string' || row === '')) {
    throw new Error(`${label}: disableRows must be a string[] of loader row ids (empty = explicit none, overriding config; got '${JSON.stringify(disableRows)}')`)
  }
}

/**
 * Which channel makes a case's assertions able to fail — the `expect` matcher
 * set (a self-reporting evidence anchor) or the case's own `inspect` hook.
 *
 * `inspect` is the one channel the framework cannot audit: the hook is opaque
 * code that may read raw session events (`trace.sessions[].events`, immune to
 * projection degradation) or nothing at all. The exemption therefore rests on
 * the case EXPLICITLY declaring `evidence: 'inspect'` — vouching that the
 * hook reads raw evidence — not on the hook's mere existence (an empty
 * `inspect: () => {}` must not re-open the vacuous-green door A1 closes).
 * This rule calls such a case `'inspect'` — an anchor that is DECLARED, not
 * verified — and the report carries that on the case record, so a record
 * whose evidence face was never examined is visible in CI instead of looking
 * like any other green case.
 *
 * @param {object} evalCase - the case (its `expect` array, `evidence`
 *   declaration, and `inspect` hook).
 * @returns {'matcher' | 'inspect' | 'none'} the channel, `'none'` when neither
 *   exists (the shape `validateEvidenceAnchor` rejects).
 */
export function evidenceAnchorKind(evalCase) {
  if (Array.isArray(evalCase?.expect)
    && evalCase.expect.some(matcher => requiresEvidence(matcher))) return 'matcher'
  if (evalCase?.evidence === 'inspect' && typeof evalCase?.inspect === 'function') return 'inspect'
  return 'none'
}

/**
 * Validate the evidence anchor of an eval case's `expect` array: at least one
 * matcher must be able to FAIL on an empty projection, unless the case carries
 * an `inspect` hook of its own.
 *
 * The trace projection is tolerant (see `trace.mjs`): a host event whose
 * payload drifts leaves the projection empty instead of throwing. Matchers
 * that assert ABSENCE pass on an empty projection — vacuously. A case whose
 * whole `expect` is such matchers turns "nothing was measured" into "passed".
 * This rule rejects that shape at load time instead of reporting a green case.
 *
 * Polarity comes from the matcher object: a negative matcher self-reports
 * `requiresEvidence: false` (`assertions.mjs`), everything else — including an
 * unknown custom matcher — counts as requiring evidence. Shared by
 * `validateEvalCase` (load time) and `runEvalCase` (execution time) so both
 * report the identical message.
 *
 * `inspect` is the escape hatch for a case whose assertions are about raw
 * evidence: the hook receives the workspace and the trace, and the framework
 * hands it `trace: undefined` when no trace materialized, which is the case's
 * own cue to fail loudly (`extras`' injection smoke reads raw session events
 * this way — a projection-independent channel). The exemption requires the
 * case to DECLARE `evidence: 'inspect'` — the declaration vouches that the
 * hook reads raw evidence, because nothing here can judge what a hook does
 * (it may read raw events or nothing at all, which is why
 * `evidenceAnchorKind` records such a case as DECLARED rather than verified
 * and the report carries that on the case record).
 *
 * @param {object[]} expect - the case's matcher array.
 * @param {string} label - error-message context (e.g. `file: case '<id>'`).
 * @param {object} [evalCase] - the case, read for its `evidence` declaration
 *   and `inspect` hook.
 */
export function validateEvidenceAnchor(expect, label, evalCase) {
  if (expect.some(matcher => requiresEvidence(matcher))) return
  if (evalCase?.evidence === 'inspect' && typeof evalCase?.inspect === 'function') return
  const negative = expect.map(matcher => `'${matcher.describe}'`).join(', ')
  throw new Error(
    `${label}: no evidence anchor — every matcher passes vacuously on an empty projection`
    + `${negative === '' ? ' (expect is empty)' : ` (${negative})`};`
    + ' add one assertion that requires evidence (a positive matcher), mark a custom negative matcher'
    + " with requiresEvidence: false, or declare evidence: 'inspect' and assert in an inspect hook",
  )
}

/**
 * Validate a `followups` declaration (case-level): an array of non-empty
 * strings, one per additional driven turn. Throws with `label` context.
 * @param {unknown} followups - the value to validate.
 * @param {string} label - error-message context (e.g. `case '<id>'`).
 */
export function validateFollowups(followups, label) {
  if (!Array.isArray(followups)
    || followups.length === 0
    || followups.some(text => typeof text !== 'string' || text === '')) {
    throw new Error(`${label}: followups must be a non-empty string[] of followup turn texts (got '${JSON.stringify(followups)}')`)
  }
}

/**
 * Validate one eval case's shape. Throws with a descriptive message on
 * the first violation found. Checks:
 *
 * - `id` is a non-empty string.
 * - `task` is a string.
 * - `mode` (if present) is `'real'` or `'mock'`.
 * - `persona` is **rejected** if present — removed, use `rowConfig` on the
 *   `system-prompt` row (`personaPrefix` / `personaSuffix`) instead; see the
 *   error text for the full migration shape.
 * - `disableRows` (if present) is an array of strings (loader row ids to
 *   disable in this run's overlay). An EMPTY array is legal and means
 *   "disable nothing, explicitly" — it overrides a `disableRows` default
 *   from `dsh-eval.config.mjs`, which is how gate-interaction cases opt
 *   back in inside a package that disables the gate row by default.
 * - `rowConfig` (if present) maps loader row ids to config objects whose
 *   leaves are scalars, arrays of scalars, or nested plain objects of the
 *   same (see `validateRowConfig`). The overlay REPLACES the row's whole
 *   config — restate any keys the row needs, not just the ones being changed.
 * - `followups` (if present) is a non-empty array of followup turn texts
 *   (cross-turn driving; see `validateFollowups`), with optional positive
 *   finite `settleTimeoutMs`.
 * - `expect` is an array; every element has `describe` (string) and `check` (function).
 * - `expect` carries at least one evidence anchor: a matcher that can fail on
 *   an empty projection (see `validateEvidenceAnchor`). Negative matchers
 *   self-report `requiresEvidence: false`; custom matchers default to
 *   requiring evidence. A case whose only anchor is its `inspect` hook must
 *   DECLARE `evidence: 'inspect'` (with the hook present) for the exemption.
 * - mock mode requires a `script` with `steps` array.
 *
 * @param {object} evalCase - the case to validate.
 * @param {string} file - the source file path (for error messages).
 */
export function validateEvalCase(evalCase, file) {
  if (evalCase === null || typeof evalCase !== 'object') {
    throw new Error(`${file}: case must be an object`)
  }
  if (typeof evalCase.id !== 'string' || evalCase.id === '') {
    throw new Error(`${file}: case.id must be a non-empty string`)
  }
  if (typeof evalCase.task !== 'string') {
    throw new Error(`${file}: case '${evalCase.id}': task must be a string`)
  }
  if (evalCase.mode !== undefined && evalCase.mode !== 'real' && evalCase.mode !== 'mock') {
    throw new Error(`${file}: case '${evalCase.id}': mode must be 'real' or 'mock' (got '${evalCase.mode}')`)
  }
  if (evalCase.gates !== undefined) {
    throw new Error(`${file}: case '${evalCase.id}': the 'gates' field was removed — declare disableRows: ['gates'] instead`)
  }
  if (evalCase.persona !== undefined) {
    throw new Error(`${file}: case '${evalCase.id}': the 'persona' field was removed — it emitted a config key the host's SystemPrompt.Config never had (silently inert, and whole-replace dropped the profile's personaPrefix/personaSuffix); declare rowConfig: { 'system-prompt': { personaPrefix, personaSuffix } } instead, restating both keys`)
  }
  if (evalCase.disableRows !== undefined) {
    validateDisableRows(evalCase.disableRows, `${file}: case '${evalCase.id}'`)
  }
  if (evalCase.rowConfig !== undefined) {
    validateRowConfig(evalCase.rowConfig, `case '${evalCase.id}'`)
  }
  if (evalCase.followups !== undefined) {
    validateFollowups(evalCase.followups, `${file}: case '${evalCase.id}'`)
    if (evalCase.settleTimeoutMs !== undefined
      && (typeof evalCase.settleTimeoutMs !== 'number' || !Number.isFinite(evalCase.settleTimeoutMs) || evalCase.settleTimeoutMs <= 0)) {
      throw new Error(`${file}: case '${evalCase.id}': settleTimeoutMs must be a positive finite number (got '${JSON.stringify(evalCase.settleTimeoutMs)}')`)
    }
  }
  if (!Array.isArray(evalCase.expect)) {
    throw new Error(`${file}: case '${evalCase.id}': expect must be a Matcher[]`)
  }
  for (let i = 0; i < evalCase.expect.length; i += 1) {
    const matcher = evalCase.expect[i]
    if (typeof matcher?.describe !== 'string' || typeof matcher?.check !== 'function') {
      throw new Error(`${file}: case '${evalCase.id}': expect[${i}] must have { describe: string, check: function }`)
    }
  }
  if (evalCase.mode === 'mock') {
    if (evalCase.script === undefined || !Array.isArray(evalCase.script?.steps)) {
      throw new Error(`${file}: case '${evalCase.id}': mock mode requires script.steps`)
    }
  }
  // Part of the anchor domain, so it sits directly before the anchor rule:
  // a structural mistake (including a malformed declaration) is what the
  // author hears about first, the catch-all anchor error last.
  if (evalCase.evidence !== undefined) {
    if (evalCase.evidence !== 'inspect') {
      throw new Error(`${file}: case '${evalCase.id}': evidence must be 'inspect' (got '${JSON.stringify(evalCase.evidence)}')`)
    }
    if (typeof evalCase.inspect !== 'function') {
      throw new Error(`${file}: case '${evalCase.id}': evidence: 'inspect' requires an inspect hook — the declaration vouches for the hook's assertions, not for the case`)
    }
  }
  // Last, deliberately: the anchor rule is the catch-all, so a case that is
  // also missing `script.steps` hears about that first instead of about the
  // anchor its empty `expect` happens to lack.
  validateEvidenceAnchor(evalCase.expect, `${file}: case '${evalCase.id}'`, evalCase)
}

/**
 * Validate one rowConfig value at `path` (a dotted key path): a scalar, an
 * array of scalars, or a nested plain object of the same — parameter groups
 * stay expressible as ONE value instead of being flattened into unrelated
 * scalar keys. Throws with `label` context and the offending key path.
 * @param {string} rowId - the row id the config belongs to (error context).
 * @param {string} path - dotted key path within the row's config.
 * @param {unknown} value - the value to validate.
 * @param {string} label - error-message context (e.g. `case '<id>'`).
 */
function validateConfigValue(rowId, path, value, label) {
  const where = `${label}: rowConfig['${rowId}']['${path}']`
  if (Array.isArray(value)) {
    if (value.some(item => item === null || typeof item === 'object')) {
      throw new Error(`${where} must be an array of scalars`)
    }
  } else if (value === null || typeof value === 'object') {
    if (value === null) {
      throw new Error(`${where} must be a scalar, scalar array, or nested object (got null)`)
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key === '') throw new Error(`${label}: rowConfig['${rowId}'] has an empty config key`)
      validateConfigValue(rowId, `${path}.${key}`, nested, label)
    }
  }
}

/**
 * Validate a `rowConfig` mapping (case-level or ad-hoc): keys are loader row
 * ids, values are config objects whose leaves must be scalars (string /
 * number / boolean), arrays of scalars, or nested plain objects of the same
 * (emitted as YAML flow mappings — see `yamlConfigValue`). Throws with
 * `label` context.
 * @param {unknown} rowConfig - the value to validate.
 * @param {string} label - error-message context (e.g. `case '<id>'`).
 */
export function validateRowConfig(rowConfig, label) {
  if (rowConfig === null || typeof rowConfig !== 'object' || Array.isArray(rowConfig)) {
    throw new Error(`${label}: rowConfig must be an object mapping row ids to config objects (got '${JSON.stringify(rowConfig)}')`)
  }
  for (const [rowId, config] of Object.entries(rowConfig)) {
    if (rowId === '') throw new Error(`${label}: rowConfig row id must be a non-empty string`)
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error(`${label}: rowConfig['${rowId}'] must be a config object (got '${JSON.stringify(config)}')`)
    }
    for (const [key, value] of Object.entries(config)) {
      if (key === '') throw new Error(`${label}: rowConfig['${rowId}'] has an empty config key`)
      validateConfigValue(rowId, key, value, label)
    }
  }
}

/**
 * Detect duplicate case ids across a flat case list. Throws on the first
 * duplicate found, naming both source files.
 * @param {{ id: string, __file: string }[]} cases - cases with `__file` attached.
 */
export function detectDuplicateIds(cases) {
  const seen = new Map()
  for (const evalCase of cases) {
    const existing = seen.get(evalCase.id)
    if (existing !== undefined) {
      const locations = existing === evalCase.__file
        ? existing
        : `${existing} and ${evalCase.__file}`
      throw new Error(`duplicate case id '${evalCase.id}' in ${locations}`)
    }
    seen.set(evalCase.id, evalCase.__file)
  }
}
