/**
 * The eval run driver. One eval case = one `dsh --profile <p> --patch
 * <generated-overlay> "<task>"` headless run in an isolated `DSH_HOME`, so
 * the session JSONL trace lands alone under a per-run persistence root and
 * needs no teardown of shared state. The overlay is generated per run
 * (see overlay.mjs):
 *
 * - always: `session-persistence-jsonl` re-rooted to the run dir, plaintext
 *   one-event-per-line layout (config override is whole-replace, so every
 *   field the backend needs is restated);
 * - optional case persona: `system-prompt` persona override;
 * - optional `disableRows: ['<row-id>', ...]` case declaration: the listed
 *   loader rows are disabled, so e.g. a turn-close blocking gate plugin
 *   cannot splice feedback steps past the script's terminal step (the
 *   disableRows × turn-close gate boundary contract);
 * - optional `rowConfig: { '<row-id>': { key: value } }` case declaration:
 *   per-row config overrides in this run's overlay. The overlay REPLACES
 *   the row's whole config (cordis patch semantics), so restate any keys
 *   the row still needs — the arm-style A/B use case disables one
 *   provider via `disabledProviders` while restating the row's other
 *   config keys explicitly;
 * - mock mode: `agent-default-model` re-pointed at the `eval-mock` provider
 *   plus an insert mounting the scripted adapter plugin by `file://` URL
 *   (relative plugin names resolve against the PROFILE dir, not the overlay
 *   file, so an absolute URL is the portable reference).
 *
 * Isolation mechanics (home staging, junction-safe teardown, spawn/timeout)
 * live in sandbox.mjs; overlay serialization lives in overlay.mjs. This
 * module is the orchestration only.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync, cpSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTraceDir } from './trace.mjs'
import { validateRowConfig, validateDisableRows, validateFollowups } from './discovery.mjs'
import { CLI_RELATIVE_PATH } from './cli.mjs'
import { buildOverlayYaml } from './overlay.mjs'
import { resolveRealDshHome, stageSandboxHome, teardownSandbox, spawnHeadlessDsh } from './sandbox.mjs'

/** This framework's root directory (the eval package dir). */
const FRAMEWORK_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Run one eval case end to end.
 *
 * Case shape: `{ id, task, mode?: 'real' | 'mock', expect: Matcher[],
 * script?: { steps: ChunkStep[] }, persona?: string, disableRows?: string[],
 * rowConfig?: Record<string, Record<string, unknown>>,
 * followups?: string[], settleTimeoutMs?: number,
 * prepare?: (workspace: string) => void | Promise<void>,
 * inspect?: (workspace: string, helpers: { trace }) => void | Promise<void>,
 * timeoutMs?: number }`
 *
 * `followups` opts into cross-turn driving: the overlay swaps the one-shot
 * `headless-runner` row for the eval multi-turn driver, which — before each
 * followup — waits for background subagent children to settle (bounded by
 * `settleTimeoutMs`), keeping the process alive so fire-and-forget children
 * (turn-close defer fixers) can run to completion between turns.
 *
 * @param {object} evalCase - the case under test.
 * @param {object} options
 * @param {string} options.profile - the dsh profile booting the run (plugin installed there).
 * @param {string} [options.dshRepoDir] - the deepseek-harness checkout (legacy CLI
 *   location; ignored when cliPath is given).
 * @deprecated options.dshRepoDir — pass the C6 chain result via cliPath
 *   instead; this legacy option is removed in the next minor release.
 * @param {string} [options.cliPath] - explicit compiled CLI entry (C6 chain result;
 *   takes precedence over dshRepoDir).
 * @param {'real' | 'mock'} [options.mode] - force a mode over the case's own.
 * @param {string} [options.artifactsDir] - copy stdout/stderr/trace/session logs here (created).
 * @returns {Promise<EvalRunResult>}
 */
export async function runEvalCase(evalCase, options) {
  const mode = options.mode ?? evalCase.mode ?? 'real'
  const binPath = options.cliPath !== undefined
    ? resolve(options.cliPath)
    : join(resolve(options.dshRepoDir), ...CLI_RELATIVE_PATH.split(/[\\/]/))
  const timeoutMs = evalCase.timeoutMs ?? 180_000

  const runDir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
  // Everything past this point is wrapped in try/finally so the temp dir
  // (and any junctions) are cleaned up even when `prepare`, profile
  // staging, or spawn throw.  Previously only the normal exit path
  // cleaned up — a `prepare` failure leaked the entire runDir.
  try {
    const dshHome = join(runDir, 'dsh-home')
    const workspace = join(runDir, 'workspace')
    const sessionsRoot = join(runDir, 'sessions')
    mkdirSync(workspace, { recursive: true })
    await evalCase.prepare?.(workspace)

    // Profiles resolve under $DSH_HOME/profiles, and eval overwrites DSH_HOME
    // for session/settings isolation (staging + teardown mechanics in
    // sandbox.mjs — the booted profile is copied so boot's unconditional
    // cordis.yml rewrite stays inside the temporary home; only the profile's
    // read-only node_modules stays linked, and the shared fallback is rebuilt
    // by boot inside the temporary home).
    const realHome = resolveRealDshHome()
    stageSandboxHome(realHome, dshHome, options.profile)

    const env = {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
    }
    if (mode === 'mock') {
      if (evalCase.script === undefined) {
        throw new Error(`case '${evalCase.id}': mock mode requires a script`)
      }
      const scriptPath = join(runDir, 'mock-script.json')
      writeFileSync(scriptPath, JSON.stringify(evalCase.script))
      env.DSH_EVAL_MOCK_SCRIPT = scriptPath
    }
    if (evalCase.followups !== undefined) {
      const planPath = join(runDir, 'driver-plan.json')
      writeFileSync(planPath, JSON.stringify({
        task: evalCase.task,
        followups: evalCase.followups,
        ...(evalCase.settleTimeoutMs === undefined ? {} : { settleTimeoutMs: evalCase.settleTimeoutMs }),
      }))
      env.DSH_EVAL_DRIVER_PLAN = planPath
    }

    if (evalCase.disableRows !== undefined) {
      validateDisableRows(evalCase.disableRows, `case '${evalCase.id}'`)
    }
    if (evalCase.rowConfig !== undefined) {
      validateRowConfig(evalCase.rowConfig, `case '${evalCase.id}'`)
    }
    if (evalCase.followups !== undefined) {
      validateFollowups(evalCase.followups, `case '${evalCase.id}'`)
    }
    const overlayPath = join(runDir, 'eval-overlay.yml')
    writeFileSync(overlayPath, buildOverlayYaml({
      sessionsRoot,
      persona: evalCase.persona,
      disableRows: evalCase.disableRows,
      rowConfig: evalCase.rowConfig,
      mock: mode === 'mock',
      ...(evalCase.followups === undefined ? {} : { followups: evalCase.followups }),
    }))

    const { stdout, stderr, exitCode, timedOut } = await spawnHeadlessDsh({
      cli: binPath,
      cliArgs: ['--profile', options.profile, '--patch', overlayPath, evalCase.task],
      cwd: workspace,
      env,
      timeoutMs,
    })

    const trace = loadTraceDir(sessionsRoot)
    const sessionLogs = collectSessionLogTexts(sessionsRoot)

    // Workspace assertions live HERE, before the run dir cleanup: a case's
    // `inspect(workspace, { trace })` may throw; the failure text rides the
    // result instead of leaking past cleanup.
    let inspectError
    if (typeof evalCase.inspect === 'function') {
      try {
        await evalCase.inspect(workspace, { trace })
      } catch (error) {
        inspectError = error instanceof Error ? error.message : String(error)
      }
    }

    if (options.artifactsDir !== undefined) {
      mkdirSync(options.artifactsDir, { recursive: true })
      writeFileSync(join(options.artifactsDir, 'stdout.txt'), stdout)
      writeFileSync(join(options.artifactsDir, 'stderr.txt'), stderr)
      writeFileSync(join(options.artifactsDir, 'trace.json'), JSON.stringify({
        caseId: evalCase.id,
        mode,
        task: evalCase.task,
        exitCode,
        timedOut,
        trace,
      }, undefined, 2))
      try {
        cpSync(sessionsRoot, join(options.artifactsDir, 'sessions'), { recursive: true })
      } catch { /* no session materialized — nothing to copy */ }
    }

    return {
      caseId: evalCase.id, mode, task: evalCase.task, exitCode, timedOut,
      stdout, stderr, trace, sessionLogs, inspectError, runDir,
    }
  } finally {
    teardownSandbox(runDir, { keep: process.env.DSH_EVAL_KEEP_TMP === '1' })
  }
}

/** Read every session artifact under the root as text (best-effort, pre-cleanup). */
function collectSessionLogTexts(sessionsRoot) {
  const texts = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'session.jsonl') texts.push(readFileSync(path, 'utf8'))
    }
  }
  walk(sessionsRoot)
  return texts
}

/**
 * @typedef {object} EvalRunResult
 * @property {string} caseId
 * @property {'real' | 'mock'} mode
 * @property {string} task
 * @property {number} exitCode - the headless CLI's exit code (0 = turn completed).
 * @property {boolean} timedOut
 * @property {string} stdout - printed final assistant text (plus any startup chatter).
 * @property {string} stderr
 * @property {import('./trace.mjs').EvalTrace | undefined} trace
 * @property {string[]} sessionLogs - raw session artifact texts, pre-cleanup.
 * @property {string | undefined} inspectError - the case's `inspect` failure text, when it threw.
 * @property {string} runDir - removed unless DSH_EVAL_KEEP_TMP=1.
 */

/** Re-exported so bin can resolve the framework without guessing paths. */
export { FRAMEWORK_ROOT }

/** Whether a candidate dsh repo dir looks like one (the CLI artifact exists). */
export function looksLikeDshRepo(dir) {
  if (!isAbsolute(dir)) return false
  return existsSync(join(dir, ...CLI_RELATIVE_PATH.split(/[\\/]/)))
}
