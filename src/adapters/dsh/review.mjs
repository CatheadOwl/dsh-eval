/** dsh-headless execution adapter for model-independent review experiments. */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { executeReviewExperiment } from '../../experiment/review.mjs'
import { CLI_RELATIVE_PATH } from '../../cli.mjs'
import { overlayDisableRows } from '../../overlay.mjs'
import {
  resolveRealDshHome, stageSandboxHome, stagedPluginRows, teardownSandbox, spawnHeadlessDsh,
} from '../../sandbox.mjs'
import { loadTraceDir } from '../../trace.mjs'
import { validateToolBoundary, renderToolBoundaryEvidence } from '../../tool-validation.mjs'

/**
 * Model-facing tool rows every shipped dsh profile mounts from `dsh-base`.
 * A static supplementary guard on top of the blank-environment enumeration
 * (host template tool rows never appear in `stagedPluginRows` — they are the
 * sterile baseline, so their ids are enumerated here instead).  Post-run
 * tool boundary validation (see `validateToolBoundary`) detects any residual
 * drift.
 */
const REVIEW_DISABLED_TOOL_ROWS = [
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-skill',
  'tool-todo',
  'tool-goal',
  'tool-ralph',
  'tool-str-replace-editor',
  'tool-web',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-report',
  'tool-workflow',
]

/**
 * Rows the reviewer session must KEEP even when an out-of-tree bundle or the
 * profile patch touches them: model wiring and the session log — without
 * these the reviewer cannot answer at all and the trace (tool boundary
 * check, run artifacts) never materializes.  These ids are host-template
 * rows; an out-of-tree patch row targeting one of them only overrides its
 * config, so keeping it enabled stays safe.
 */
const REVIEW_REQUIRED_ROWS = new Set([
  'agent-default-model',
  'session-title-llm',
  'system-prompt',
  'session-persistence-jsonl',
])

/**
 * Serialize the blank-environment overlay: disable every plugin row the
 * staged profile composes beyond the host templates (`stagedPluginRows` —
 * out-of-tree bundle rows + profile patch rows), UNION the static host tool
 * rows, MINUS the model/session wiring the reviewer needs.  With
 * `keepPluginRows` (explicit opt-in to study the host plugin face itself)
 * the enumeration is skipped and only the static tool lockdown remains.
 */
function buildReviewOverlayYaml(pluginRows, { keepPluginRows }) {
  const disabled = new Set(keepPluginRows ? [] : pluginRows)
  for (const row of REVIEW_DISABLED_TOOL_ROWS) disabled.add(row)
  for (const row of REVIEW_REQUIRED_ROWS) disabled.delete(row)
  return overlayDisableRows([...disabled])
}

/** Resolve and validate the compiled dsh CLI entry point. */
export function resolveDshCli(dshRepoDir) {
  const repoDir = resolve(dshRepoDir)
  const cli = join(repoDir, ...CLI_RELATIVE_PATH.split(/[\\/]/))
  if (!existsSync(cli)) {
    throw new Error(`no compiled dsh CLI at '${cli}' (build deepseek-harness first)`)
  }
  return cli
}

/** The CLI entry for an executor: explicit cliPath (C6 chain result) wins;
 * otherwise fall back to the legacy repo form. Neither being set is a caller
 * bug the CLI bins already catch — this guard serves direct API consumers. */
function executorCli(options) {
  if (options.cliPath !== undefined) return resolve(options.cliPath)
  if (options.dshRepoDir !== undefined) return resolveDshCli(options.dshRepoDir)
  throw new Error('review adapter needs a CLI location: pass cliPath (C6 chain result) or dshRepoDir')
}

/**
 * Create an executor compatible with executeReviewExperiment.
 *
 * The executor boots a blank review environment in an isolated DSH_HOME
 * (staging/teardown mechanics shared with the behavior runner via
 * sandbox.mjs): the staged profile's every out-of-tree plugin row and every
 * host model-facing tool row is disabled via overlay (blank =
 * dsh-base/dsh-headless templates + model wiring, nothing else — regardless
 * of what the host profile carries), and the tool boundary is validated
 * after the run.
 *
 * @param {object} options
 * @param {string} [options.profile='headless'] - the review profile (host
 *   templates + whatever the host machine carries; plugin rows are disabled
 *   by the overlay anyway).
 * @param {Set<string>} [options.allowedTools] - tool names permitted in the reviewer's session (default: empty).
 * @param {boolean} [options.keepPluginRows=false] - opt back into the host
 *   profile's plugin face (e.g. to review a plugin's own gate behavior);
 *   only the static tool lockdown remains.
 */
export function createDshHeadlessReviewExecutor(options) {
  const cli = executorCli(options)
  const profile = options.profile ?? 'headless'
  if (typeof profile !== 'string' || profile.length === 0) {
    throw new TypeError('dsh review adapter requires a profile')
  }
  const timeoutMs = options.timeoutMs ?? 300_000
  const allowedTools = options.allowedTools ?? new Set()
  const keepPluginRows = options.keepPluginRows ?? false

  return async function executeWithDsh(task) {
    // A fresh process alone is not enough: dsh also stores settings, titles,
    // and sessions below DSH_HOME. Reuse the behavior harness's sandbox
    // (sandbox.mjs) so every reviewer receives an isolated runtime state
    // while retaining the selected profile's model config and plugin links.
    const runDir = mkdtempSync(join(tmpdir(), 'dsh-review-'))
    const dshHome = join(runDir, 'dsh-home')
    stageSandboxHome(options.dshHome ?? resolveRealDshHome(), dshHome, profile)
    // Blank environment by DEFAULT (review-blank-environment TODO): disable
    // every row the staged profile composes beyond the host templates, so a
    // host profile carrying out-of-tree plugins (gates included) can no
    // longer steer or crash the reviewer. `keepPluginRows` opts back into
    // the host plugin face deliberately. Enumeration happens on the STAGED
    // copy, after staging — the staged home is what actually boots.
    const overlayPath = join(runDir, 'review-overlay.yml')
    writeFileSync(overlayPath, buildReviewOverlayYaml(
      stagedPluginRows(dshHome, profile),
      { keepPluginRows },
    ), 'utf8')

    try {
      const { stdout, stderr, exitCode, timedOut } = await spawnHeadlessDsh({
        cli,
        cliArgs: ['--profile', profile, '--patch', overlayPath, task],
        cwd: options.cwd ?? runDir,
        env: {
          ...process.env,
          ...options.env,
          DSH_HOME: dshHome,
          DSH_TELEMETRY_DISABLED: '1',
        },
        timeoutMs,
      })

      const result = { stdout, stderr, exitCode, timedOut, profile, cli, runDir }
      if (exitCode !== 0 || timedOut) {
        const error = new Error(`dsh reviewer exited with code ${exitCode}${timedOut ? ' after timeout' : ''}`)
        error.result = result
        throw error
      }

      // Post-run tool boundary check: parse the session
      // trace, verify no unexpected tools were mounted in the reviewer's
      // session, fail the run on violation.  An absent session log skips
      // the check gracefully (accepted fail-open).
      // Validation inspects the main session only (buildTrace selects
      // non-subagent logs); plugin tools leaking in a subagent session
      // would not be caught — irrelevant in review where the overlay
      // disables every subagent tool row.
      const trace = loadTraceDir(join(dshHome, 'sessions'))
      if (trace) {
        const validation = validateToolBoundary(trace, { allowedTools })
        result.toolValidation = validation
        if (!validation.ok) {
          // Attach evidence for the caller to persist (the adapter's
          // runDir is ephemeral — removed by the finally block).  The
          // bin writes this to `.runs/<id>/tool-boundary-evidence.json`.
          result.toolBoundaryEvidence = renderToolBoundaryEvidence(validation, { runDir, profile })
          const boundaryError = new Error(
            `tool boundary violation: unexpected tools [${validation.unexpected.join(', ')}]`,
          )
          boundaryError.result = result
          throw boundaryError
        }
      }

      return result
    } finally {
      teardownSandbox(runDir, { keep: process.env.DSH_REVIEW_KEEP_TMP === '1' })
    }
  }
}

/** Run a review experiment through fresh dsh headless processes. */
export async function runDshReviewExperiment(experiment, options) {
  const executor = createDshHeadlessReviewExecutor(options)
  return executeReviewExperiment(experiment, executor, { runs: options.runs })
}
