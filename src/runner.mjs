/**
 * The eval run driver. One eval case = one `dsh --profile <p> --patch
 * <generated-overlay> "<task>"` headless run in an isolated `DSH_HOME`, so
 * the session JSONL trace lands alone under a per-run persistence root and
 * needs no teardown of shared state. The overlay is generated per run:
 *
 * - always: `session-persistence-jsonl` re-rooted to the run dir, plaintext
 *   one-event-per-line layout (config override is whole-replace, so every
 *   field the backend needs is restated);
 * - optional case persona: `system-prompt` persona override;
 * - optional `gates: 'off'` case declaration: the `gates` plugin row is
 *   disabled, so turn-close blocking gates cannot splice feedback steps past
 *   the script's terminal step (the eval × gates boundary contract — see
 *   workunits/eval/TODO/20260901-turnclose-gate-eval-interaction.md);
 * - mock mode: `agent-default-model` re-pointed at the `eval-mock` provider
 *   plus an insert mounting the scripted adapter plugin by `file://` URL
 *   (relative plugin names resolve against the PROFILE dir, not the overlay
 *   file, so an absolute URL is the portable reference).
 */

import { spawn } from 'node:child_process'
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadTraceDir } from './trace.mjs'

/** This framework's root directory (the eval package dir). */
const FRAMEWORK_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The scripted mock adapter plugin, referenced from generated overlays. */
const MOCK_ADAPTER_PATH = join(FRAMEWORK_ROOT, 'src', 'mock', 'mock-adapter.mjs')

/**
 * Loader row id of the gates plugin. Authority: the id the gates bundle
 * itself inserts (`dsh-plugin-dev/gates/cordis.patch.yml`, `- id: gates`) —
 * an overlay `- id: gates / disabled: true` patch targets that row, the
 * same cross-layer disable mechanism as `session-title-llm`.
 */
const GATES_PLUGIN_ROW_ID = 'gates'

/** The profile-local module-fallback directory, rebuilt fresh by boot and never staged. */
const MODULE_FALLBACK_DIR = '.dsh-module-fallback'

/**
 * Stage the profile store into a temporary DSH_HOME. The BOOTED profile's
 * directory is COPIED (sans its own `node_modules` and `.dsh-module-fallback`):
 * `prepareProfile` unconditionally rewrites the profile's root cordis.yml on
 * every boot, and copying keeps that write inside the temporary home instead
 * of leaking through a junction into the real store. Only the profile's own
 * `node_modules` stays junctioned — out-of-tree plugin resolution needs it,
 * and a task boot never writes it. The module-fallback directories (the
 * store-level shared `profiles/node_modules` and the profile-local
 * `.dsh-module-fallback`) are deliberately NOT staged: `healProfilesModuleFallback`
 * rebuilds both fresh in the temporary home on every boot, and `.dsh-module-fallback`
 * in particular is full of junctions that a naive recursive copy would follow
 * into the real store. The copy is junction-aware — links are recreated as
 * links, never descended (see `copyProfileEntry`). An absent profile copies
 * nothing: boot initializes shipped templates inside the temporary home.
 * @param {string} realHome - the real Harness home holding `profiles/`.
 * @param {string} tmpHome - the temporary home (created up to `profiles/`).
 * @param {string} profileName - the profile this run boots.
 * @returns {string[]} every created junction path (unlink before rmSync).
 */
export function stageProfileStore(realHome, tmpHome, profileName) {
  const junctions = []
  const tmpProfiles = join(tmpHome, 'profiles')
  mkdirSync(tmpProfiles, { recursive: true })
  const realProfiles = join(realHome, 'profiles')
  if (!existsSync(realProfiles)) return junctions
  const realProfileDir = join(realProfiles, profileName)
  if (!existsSync(join(realProfileDir, 'package.json'))) return junctions
  const tmpProfileDir = join(tmpProfiles, profileName)
  mkdirSync(tmpProfileDir, { recursive: true })
  for (const entry of readdirSync(realProfileDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === MODULE_FALLBACK_DIR) continue
    copyProfileEntry(join(realProfileDir, entry.name), join(tmpProfileDir, entry.name), junctions)
  }
  const profileModules = join(realProfileDir, 'node_modules')
  if (existsSync(profileModules)) {
    const target = join(tmpProfileDir, 'node_modules')
    symlinkSync(profileModules, target, 'junction')
    junctions.push(target)
  }
  return junctions
}

/**
 * Copy one profile entry (file, directory, or link) into the staged profile.
 * A link is recreated as a link (`'junction'` on Windows) instead of being
 * followed: Node's `cpSync` dereferences Windows junctions in recursive mode
 * (no cycle guard), so a junction-bearing tree would recurse into the real
 * store and overflow the native stack. Recreated junctions are appended to
 * `junctions` so callers can unlink them before `rmSync` (which would
 * otherwise descend through them into the real store).
 */
function copyProfileEntry(from, to, junctions) {
  const stat = lstatSync(from)
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(from)
    symlinkSync(target, to, 'junction')
    junctions.push(to)
    return
  }
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const child of readdirSync(from)) {
      copyProfileEntry(join(from, child), join(to, child), junctions)
    }
    return
  }
  copyFileSync(from, to)
}

/** JSON double-quoted strings are valid YAML scalars — enough for this emitter. */
function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

/**
 * Serialize the per-run overlay patch list to YAML.
 * @param {object} parts - overlay ingredients (see runEvalCase).
 * @returns {string} the overlay file text.
 */
export function buildOverlayYaml(parts) {
  const lines = []
  lines.push('- id: session-persistence-jsonl')
  lines.push('  config:')
  lines.push(`    root: ${yamlScalar(parts.sessionsRoot)}`)
  lines.push('    packChunks: false')
  lines.push('    compression: none')
  if (parts.persona !== undefined) {
    lines.push('- id: system-prompt')
    lines.push('  config:')
    lines.push(`    persona: ${yamlScalar(parts.persona)}`)
  }
  if (parts.gates === 'off') {
    lines.push(`- id: ${GATES_PLUGIN_ROW_ID}`)
    lines.push('  disabled: true')
  }
  if (parts.mock) {
    lines.push('- id: agent-default-model')
    lines.push('  config:')
    lines.push('    provider: eval-mock')
    lines.push('    model: eval-mock')
    // The title generator also calls the default provider and would consume
    // script steps; deterministic runs own every model call themselves.
    lines.push('- id: session-title-llm')
    lines.push('  disabled: true')
    lines.push('- insert:')
    lines.push('    - id: eval-mock-llm')
    lines.push(`      name: ${yamlScalar(pathToFileURL(MOCK_ADAPTER_PATH).href)}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Run one eval case end to end.
 *
 * Case shape: `{ id, task, mode?: 'real' | 'mock', expect: Matcher[],
 * script?: { steps: ChunkStep[] }, persona?: string, gates?: 'off',
 * prepare?: (workspace: string) => void | Promise<void>,
 * inspect?: (workspace: string, helpers: { trace }) => void | Promise<void>,
 * timeoutMs?: number }`
 *
 * @param {object} evalCase - the case under test.
 * @param {object} options
 * @param {string} options.profile - the dsh profile booting the run (plugin installed there).
 * @param {string} options.dshRepoDir - the deepseek-harness checkout (CLI runs from it).
 * @param {'real' | 'mock'} [options.mode] - force a mode over the case's own.
 * @param {string} [options.artifactsDir] - copy stdout/stderr/trace/session logs here (created).
 * @returns {Promise<EvalRunResult>}
 */
export async function runEvalCase(evalCase, options) {
  const mode = options.mode ?? evalCase.mode ?? 'real'
  const dshRepoDir = resolve(options.dshRepoDir)
  const binPath = join(dshRepoDir, 'apps', 'cli', 'lib', 'bin.js')
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
    // for session/settings isolation: stage the profile store (see
    // stageProfileStore — the booted profile is copied, so boot's unconditional
    // cordis.yml rewrite stays inside the temporary home; only the profile's
    // read-only node_modules stays linked, and the shared fallback is rebuilt
    // by boot inside the temporary home). The managed credential
    // document is copied in because `dsh-credentials-local` resolves it per
    // request. Falls back to the default `~/.dsh` when the ambient environment
    // sets no home of its own.
    const realHome = (process.env.DSH_HOME ?? '').trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
    mkdirSync(dshHome, { recursive: true })
    stageProfileStore(realHome, dshHome, options.profile)
    const realCredentials = join(realHome, '.credentials.yaml')
    if (existsSync(realCredentials)) {
      const credentialsCopy = join(dshHome, '.credentials.yaml')
      copyFileSync(realCredentials, credentialsCopy)
      try {
        // Best-effort owner-only on POSIX (the harness's own e2e uses 0o600);
        // a no-op beyond the read-only bit on Windows.
        chmodSync(credentialsCopy, 0o600)
      } catch { /* permission tightening is best-effort */ }
    }

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

    const overlayPath = join(runDir, 'eval-overlay.yml')
    if (evalCase.gates !== undefined && evalCase.gates !== 'off') {
      throw new Error(`case '${evalCase.id}': gates must be 'off' when present (got '${evalCase.gates}')`)
    }
    writeFileSync(overlayPath, buildOverlayYaml({
      sessionsRoot,
      persona: evalCase.persona,
      gates: evalCase.gates,
      mock: mode === 'mock',
    }))

    const cliArgs = [
      binPath,
      '--profile', options.profile,
      '--patch', overlayPath,
      evalCase.task,
    ]
    const child = spawn(process.execPath, cliArgs, { cwd: workspace, env })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    const exitCode = await new Promise(resolveExit => {
      child.on('error', error => { stderr += `\ndsh-eval: failed to spawn dsh CLI: ${error.message}\n`; resolveExit(127) })
      child.on('exit', code => resolveExit(code ?? 1))
    })
    clearTimeout(timer)

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
    if (process.env.DSH_EVAL_KEEP_TMP !== '1') {
      // Drop every junction first so cleanup can never descend into the
      // real profile store. Junctions may not exist when the error
      // happened before stageProfileStore ran — readdirSync catches that.
      try {
        const profileJunctions = []
        const walk = (dir) => {
          let entries
          try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
          for (const entry of entries) {
            const full = join(dir, entry.name)
            if (entry.isSymbolicLink()) profileJunctions.push(full)
            else if (entry.isDirectory()) walk(full)
          }
        }
        walk(join(runDir, 'dsh-home'))
        for (const junction of profileJunctions) {
          try { unlinkSync(junction) } catch { /* junction absent — nothing to drop */ }
        }
      } catch { /* dsh-home not created yet */ }
      rmSync(runDir, { recursive: true, force: true })
    }
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
  return existsSync(join(dir, 'apps', 'cli', 'lib', 'bin.js'))
}
