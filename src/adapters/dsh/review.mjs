/** dsh-headless execution adapter for model-independent review experiments. */

import { spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { executeReviewExperiment } from '../../experiment/review.mjs'
import { stageProfileStore } from '../../runner.mjs'

/**
 * Model-facing tool rows every shipped dsh profile mounts from `dsh-base`. A
 * blind review must not let the reviewer inspect the real workspace (the
 * "blind review leaks workspace" finding), so the per-run overlay disables the
 * whole host tool catalog and the reviewer reasons from the frozen observations
 * alone. Plugin-registered tools (e.g. `coggit_*`) are not host rows and
 * stay mounted; they query the session workspace's CogGit state, not the file
 * tree, and the reviewer's workspace is the empty run dir.
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
  return REVIEW_DISABLED_TOOL_ROWS.map((id) => `- id: ${id}\n  disabled: true\n`).join('\n')
}

/** Resolve and validate the compiled dsh CLI entry point. */
export function resolveDshCli(dshRepoDir) {
  const repoDir = resolve(dshRepoDir)
  const cli = join(repoDir, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(cli)) {
    throw new Error(`no compiled dsh CLI at '${cli}' (build deepseek-harness first)`)
  }
  return cli
}

/** Create an executor compatible with executeReviewExperiment. */
export function createDshHeadlessReviewExecutor(options) {
  const cli = options.cliPath ? resolve(options.cliPath) : resolveDshCli(options.dshRepoDir)
  const profile = options.profile
  if (typeof profile !== 'string' || profile.length === 0) {
    throw new TypeError('dsh review adapter requires a profile')
  }
  const timeoutMs = options.timeoutMs ?? 300_000

  return async function executeWithDsh(task) {
    // A fresh process alone is not enough: dsh also stores settings, titles,
    // and sessions below DSH_HOME. Reuse the behavior harness's proven profile
    // staging strategy so every reviewer receives an isolated runtime state
    // while retaining the selected profile's model config and plugin links.
    const runDir = mkdtempSync(join(tmpdir(), 'dsh-review-'))
    const dshHome = join(runDir, 'dsh-home')
    const overlayPath = join(runDir, 'review-overlay.yml')
    writeFileSync(overlayPath, buildReviewOverlayYaml(), 'utf8')
    const realHome = options.dshHome
      ?? ((process.env.DSH_HOME ?? '').trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh'))
    mkdirSync(dshHome, { recursive: true })
    const junctions = stageProfileStore(realHome, dshHome, profile)
    const realCredentials = join(realHome, '.credentials.yaml')
    if (existsSync(realCredentials)) {
      const credentialsCopy = join(dshHome, '.credentials.yaml')
      copyFileSync(realCredentials, credentialsCopy)
      try { chmodSync(credentialsCopy, 0o600) } catch { /* best-effort */ }
    }

    try {
      const child = spawn(process.execPath, [cli, '--profile', profile, '--patch', overlayPath, task], {
        cwd: options.cwd ?? runDir,
        env: {
          ...process.env,
          ...options.env,
          DSH_HOME: dshHome,
          DSH_TELEMETRY_DISABLED: '1',
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })

      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
      let exitCode
      try {
        exitCode = await new Promise((resolveExit, reject) => {
          child.on('error', reject)
          child.on('exit', code => resolveExit(code ?? 1))
        })
      } finally {
        clearTimeout(timer)
      }

      const result = { stdout, stderr, exitCode, timedOut, profile, cli, runDir }
      if (exitCode !== 0 || timedOut) {
        const error = new Error(`dsh reviewer exited with code ${exitCode}${timedOut ? ' after timeout' : ''}`)
        error.result = result
        throw error
      }
      return result
    } finally {
      if (process.env.DSH_REVIEW_KEEP_TMP !== '1') {
        for (const junction of junctions) {
          try { unlinkSync(junction) } catch { /* already absent */ }
        }
        rmSync(runDir, { recursive: true, force: true })
      }
    }
  }
}

/** Run a review experiment through fresh dsh headless processes. */
export async function runDshReviewExperiment(experiment, options) {
  const executor = createDshHeadlessReviewExecutor(options)
  return executeReviewExperiment(experiment, executor, { runs: options.runs })
}
