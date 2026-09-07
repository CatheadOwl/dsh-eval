/**
 * The isolated-DSH_HOME sandbox shared by every headless dsh run this
 * framework performs — the behavior eval runner (runner.mjs) and the dsh
 * review adapter (adapters/dsh/review.mjs). Both need the identical
 * isolation recipe, and this module is the single place it lives:
 *
 * - resolve where the REAL home is (`DSH_HOME` or `~/.dsh`);
 * - stage a profile store into a temporary home (junction-aware copy, see
 *   `stageProfileStore`) and copy the managed credential document in;
 * - spawn the compiled CLI with stdout/stderr capture and a SIGTERM timeout;
 * - tear the temporary run directory down WITHOUT ever descending through
 *   a junction into the real store (see `teardownSandbox`).
 *
 * `DSH_EVAL_KEEP_TMP` / `DSH_REVIEW_KEEP_TMP` are caller concerns: each
 * caller passes `{ keep }` so this module stays policy-free.
 */

import { spawn } from 'node:child_process'
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The profile-local module-fallback directory, rebuilt fresh by boot and never staged. */
const MODULE_FALLBACK_DIR = '.dsh-module-fallback'

/**
 * Where the real Harness home is: an ambient `DSH_HOME` when set (non-blank),
 * otherwise the default `~/.dsh`. The sandbox overrides `DSH_HOME` per run;
 * this resolves the store it stages FROM.
 */
export function resolveRealDshHome(env = process.env) {
  return (env.DSH_HOME ?? '').trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
}

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
 * @returns {string[]} every created junction path (see teardownSandbox).
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

/**
 * Enumerate every loader row id the STAGED profile composes BEYOND the host
 * templates (`@deepseek-ai/*` bundles) — the data source for the review
 * adapter's default blank environment (blank = dsh-base/dsh-headless only,
 * no out-of-tree plugin face regardless of what the host profile carries).
 *
 * Composition-aware, per the host's ordered-layer model: the profile root
 * `cordis.yml` ships as an EMPTY entry list — plugins enter either through
 * the profile's own `cordis.patch.yml` rows or through out-of-tree bundles
 * listed in `package.json`'s `dsh.profile.bundles`, each bundle contributing
 * rows from its own `cordis.patch.yml`/`cordis.yml` under the profile's
 * (junctioned) `node_modules`. All three sources live inside the staged home.
 *
 * A minimal token scan (`- id: <token>` at any indentation, which also
 * covers rows nested under `- insert:`), not a YAML parse (same precedent as
 * the file-history minimal session-log decoder). Entries without an `id` are
 * invisible to id-targeted disables by construction and thus not collected.
 * Unreadable sources contribute nothing — callers keep their static
 * fallback rows.
 * @param {string} tmpHome - the staged temporary home.
 * @param {string} profileName - the staged profile name.
 * @returns {string[]} deduplicated loader row ids beyond the host templates.
 */
export function stagedPluginRows(tmpHome, profileName) {
  const profileDir = join(tmpHome, 'profiles', profileName)
  const rows = []
  const collectIds = (text) => {
    for (const match of text.matchAll(/^[ \t]*-[ \t]+id:[ \t]*"?'?([^\s"']+)/gm)) {
      if (!rows.includes(match[1])) rows.push(match[1])
    }
  }
  const readText = (file) => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return undefined
    }
  }
  // Source 1+2: the profile's own composition files (root list is normally
  // the shipped empty `[]`, but a non-empty one is scanned all the same).
  for (const name of ['cordis.patch.yml', 'cordis.yml']) {
    const text = readText(join(profileDir, name))
    if (text !== undefined) collectIds(text)
  }
  // Source 3: every NON-host bundle in dsh.profile.bundles — host template
  // bundles (`@deepseek-ai/*`) define the sterile baseline and stay.
  let bundles
  try {
    bundles = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))?.dsh?.profile?.bundles
  } catch { /* no package.json → no bundle rows to collect */ }
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    if (typeof bundle !== 'string' || bundle.startsWith('@deepseek-ai/')) continue
    const bundleDir = join(profileDir, 'node_modules', ...bundle.split('/'))
    for (const name of ['cordis.patch.yml', 'cordis.yml']) {
      const text = readText(join(bundleDir, name))
      if (text !== undefined) collectIds(text)
    }
  }
  return rows
}

/**
 * Copy the managed credential document into the temporary home (copy, not
 * junction: single file, best-effort owner-only 0o600 — a no-op beyond the
 * read-only bit on Windows). `dsh-credentials-local` resolves it per request.
 */
function stageCredentials(realHome, dshHome) {
  const realCredentials = join(realHome, '.credentials.yaml')
  if (!existsSync(realCredentials)) return
  const credentialsCopy = join(dshHome, '.credentials.yaml')
  copyFileSync(realCredentials, credentialsCopy)
  try {
    chmodSync(credentialsCopy, 0o600)
  } catch { /* permission tightening is best-effort */ }
}

/**
 * Stage a complete isolated home: create `dshHome`, stage the profile store,
 * copy credentials in. One call replaces the three steps both callers used
 * to repeat inline.
 * @returns {string[]} every created junction path (informational —
 *   `teardownSandbox` re-discovers them by walking, so callers need not
 *   track the list themselves).
 */
export function stageSandboxHome(realHome, dshHome, profile) {
  mkdirSync(dshHome, { recursive: true })
  const junctions = stageProfileStore(realHome, dshHome, profile)
  stageCredentials(realHome, dshHome)
  return junctions
}

/**
 * Remove a run directory without ever descending through a junction into
 * the real profile store: first WALK the tree collecting every symlink
 * (covers staged profile junctions and anything a case's `prepare` created),
 * unlink them all, then `rmSync` the remainder. Robust to errors mid-run:
 * a walk over a not-yet-created directory is a no-op. Skipped entirely when
 * `keep` is true (caller passes its own KEEP_TMP policy flag).
 */
export function teardownSandbox(runDir, { keep = false } = {}) {
  if (keep) return
  const junctions = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) junctions.push(full)
      else if (entry.isDirectory()) walk(full)
    }
  }
  walk(runDir)
  for (const junction of junctions) {
    try { unlinkSync(junction) } catch { /* junction absent — nothing to drop */ }
  }
  rmSync(runDir, { recursive: true, force: true })
}

/**
 * Spawn one headless dsh CLI run with unified stream capture and timeout.
 * A spawn failure (missing binary, EPERM) resolves as `exitCode: 127` with
 * the failure text appended to `stderr` — callers decide whether an exit
 * code is fatal, so the spawn layer never rejects.
 *
 * @param {object} options
 * @param {string} options.cli - the compiled CLI entry (bin.js).
 * @param {string[]} options.cliArgs - CLI arguments (profile/patch/task...).
 * @param {string} options.cwd - working directory for the child.
 * @param {object} options.env - FULL child environment (caller assembles).
 * @param {number} options.timeoutMs - SIGTERM deadline.
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, timedOut: boolean }>}
 */
export async function spawnHeadlessDsh(options) {
  const child = spawn(process.execPath, [options.cli, ...options.cliArgs], {
    cwd: options.cwd,
    env: options.env,
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, options.timeoutMs)

  const exitCode = await new Promise(resolveExit => {
    child.on('error', error => { stderr += `\ndsh sandbox: failed to spawn dsh CLI: ${error.message}\n`; resolveExit(127) })
    child.on('exit', code => resolveExit(code ?? 1))
  })
  clearTimeout(timer)
  return { stdout, stderr, exitCode, timedOut }
}
