/**
 * Machine-readable run reports for the behavior CLI (EVAL-007).
 *
 * One report covers ONE `dsh-eval run` invocation: the selection summary,
 * per-case outcomes, and the invocation's environment anchors (profile /
 * repo / mode filter). Reports exist so multi-plugin consumers and CI can
 * aggregate results without scraping human output; the human `text` format
 * is unchanged and remains the default.
 *
 * Case statuses:
 * - `pass`  — ran, exit 0, every matcher satisfied, inspect clean.
 * - `fail`  — ran but a failure was recorded (non-zero exit, matcher
 *   failure, timeout, inspect error), or the runner threw, or the case
 *   file failed to load / carried a duplicate id.
 * - `skip`  — not run (mode filter or missing credential); `skipReason`
 *   says why, so `--fail-on-skip` audits stay explainable.
 */

/**
 * Build one per-case record. All fields are JSON-stable scalars/arrays.
 * @param {object} parts
 * @param {string} parts.id - case id (a case-file load failure uses the file path).
 * @param {string} parts.file - absolute path of the case file.
 * @param {'real' | 'mock'} [parts.mode] - the mode the case ran (or would have run) in;
 *   absent for file-level failures that never resolved to a case.
 * @param {'pass' | 'fail' | 'skip'} parts.status
 * @param {string[]} [parts.failures] - human-readable failure lines (fail only).
 * @param {string} [parts.skipReason] - why the case was skipped (skip only).
 * @param {number} [parts.exitCode] - the headless CLI's exit code, when it ran.
 * @param {boolean} [parts.timedOut]
 * @param {number} [parts.durationMs] - wall time of the run, when it ran.
 * @param {string} [parts.artifactsDir] - where post-mortem artifacts landed, when written.
 */
export function createCaseRecord(parts) {
  const record = { id: parts.id, file: parts.file }
  if (parts.mode !== undefined) record.mode = parts.mode
  record.status = parts.status
  if (parts.failures !== undefined) record.failures = parts.failures
  if (parts.skipReason !== undefined) record.skipReason = parts.skipReason
  if (parts.exitCode !== undefined) record.exitCode = parts.exitCode
  if (parts.timedOut !== undefined) record.timedOut = parts.timedOut
  if (parts.durationMs !== undefined) record.durationMs = parts.durationMs
  if (parts.artifactsDir !== undefined) record.artifactsDir = parts.artifactsDir
  return record
}

/**
 * Aggregate case records into the selection summary. Counts are derived,
 * never accumulated alongside, so the two can never disagree.
 * @param {object[]} records - case records from one invocation.
 */
export function summarizeRecords(records) {
  return {
    selected: records.length,
    passed: records.filter(r => r.status === 'pass').length,
    failed: records.filter(r => r.status === 'fail').length,
    skipped: records.filter(r => r.status === 'skip').length,
  }
}

/**
 * Build the full invocation report object.
 * @param {object} parts
 * @param {string} parts.profile - the dsh profile that ran the cases.
 * @param {string} parts.repo - absolute deepseek-harness checkout path.
 * @param {'real' | 'mock' | 'all'} parts.modeFilter - the `--mode` selection.
 * @param {object[]} parts.records - per-case records, in execution order.
 * @param {string} parts.startedAt - ISO timestamp of the invocation start.
 * @param {string} parts.finishedAt - ISO timestamp of the invocation end.
 * @param {boolean} parts.failOnSkip - whether skip-only selections were fatal.
 */
export function buildRunReport(parts) {
  return {
    tool: 'dsh-eval',
    profile: parts.profile,
    repo: parts.repo,
    mode: parts.modeFilter,
    failOnSkip: parts.failOnSkip,
    startedAt: parts.startedAt,
    finishedAt: parts.finishedAt,
    summary: summarizeRecords(parts.records),
    results: parts.records,
  }
}

/**
 * The exit code the CLI should use for a finished invocation.
 * @param {object[]} records - case records from one invocation.
 * @param {boolean} failOnSkip - `--fail-on-skip`: an all-skipped non-empty
 *   selection is a failure ("never ran but reported success").
 */
export function reportExitCode(records, failOnSkip) {
  const summary = summarizeRecords(records)
  if (summary.failed > 0) return 1
  if (failOnSkip && summary.selected > 0 && summary.passed + summary.failed === 0) return 1
  return 0
}
