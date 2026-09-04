/** dsh-headless execution adapter for model-independent review experiments. */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { executeReviewExperiment } from '../../experiment/review.mjs'
import { CLI_RELATIVE_PATH } from '../../cli.mjs'
import { overlayDisableRows } from '../../overlay.mjs'
import {
  resolveRealDshHome, stageSandboxHome, teardownSandbox, spawnHeadlessDsh,
} from '../../sandbox.mjs'
import { loadTraceDir } from '../../trace.mjs'
import { validateToolBoundary, renderToolBoundaryEvidence } from '../../tool-validation.mjs'

/**
 * Model-facing tool rows every shipped dsh profile mounts from `dsh-base`.
 * The overlay disables all host tool rows as a supplementary guard; the
 * primary isolation comes from the sterile review profile (dsh-base +
 * dsh-headless only, no out-of-tree plugins).  Post-run tool boundary
 * validation (see `validateToolBoundary`) detects any residual drift.
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

/** Serialize the tool-less overlay: disable every host model-facing tool row. */
function buildReviewOverlayYaml() {
  return overlayDisableRows(REVIEW_DISABLED_TOOL_ROWS)
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
 * The executor boots a sterile review profile (default: the host's
 * `headless` template, bundles = dsh-base + dsh-headless, no out-of-tree
 * plugins) in an isolated DSH_HOME (staging/teardown mechanics shared with
 * the behavior runner via sandbox.mjs), disables every host tool row via
 * overlay, and validates the tool boundary after the run.  `options.profile`
 * must name a profile whose installed plugin set is empty or review-safe.
 *
 * @param {object} options
 * @param {string} [options.profile='headless'] - the sterile review profile.
 * @param {Set<string>} [options.allowedTools] - tool names permitted in the reviewer's session (default: empty).
 */
export function createDshHeadlessReviewExecutor(options) {
  const cli = executorCli(options)
  const profile = options.profile ?? 'headless'
  if (typeof profile !== 'string' || profile.length === 0) {
    throw new TypeError('dsh review adapter requires a profile')
  }
  const timeoutMs = options.timeoutMs ?? 300_000
  const allowedTools = options.allowedTools ?? new Set()

  return async function executeWithDsh(task) {
    // A fresh process alone is not enough: dsh also stores settings, titles,
    // and sessions below DSH_HOME. Reuse the behavior harness's sandbox
    // (sandbox.mjs) so every reviewer receives an isolated runtime state
    // while retaining the selected profile's model config and plugin links.
    const runDir = mkdtempSync(join(tmpdir(), 'dsh-review-'))
    const dshHome = join(runDir, 'dsh-home')
    const overlayPath = join(runDir, 'review-overlay.yml')
    writeFileSync(overlayPath, buildReviewOverlayYaml(), 'utf8')
    stageSandboxHome(options.dshHome ?? resolveRealDshHome(), dshHome, profile)

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
