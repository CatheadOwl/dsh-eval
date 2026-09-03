/**
 * Shared `dsh-eval.config.mjs` discovery and loading (EVAL-008).
 *
 * Both CLIs (`dsh-eval`, `dsh-review`) repeat `--profile/--repo` wiring in
 * every consumer's package scripts. A per-package config file removes that
 * repetition: discovery walks UP from the working directory (never into
 * `node_modules`), the first `dsh-eval.config.mjs` wins, and CLI flags
 * always override config values — flags stay the escape hatch, config is
 * the default.
 *
 * Config shape (default export):
 *   {
 *     profile?: string,          // dsh profile to boot
 *     repo?: string,             // deepseek-harness checkout, RELATIVE paths
 *                                 // resolve against the config file's dir
 *     mode?: 'real'|'mock'|'all' // behavior CLI --mode default
 *     failOnSkip?: boolean,      // behavior CLI default
 *     report?: string,           // behavior CLI --report default (resolved
 *                                 // against the config file's dir)
 *   }
 * Unknown keys are rejected: a typo'd `profle` must fail loud, not silently
 * fall back to CLI-required mode.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The config file name both CLIs look for. */
export const CONFIG_FILE_NAME = 'dsh-eval.config.mjs'

const ALLOWED_KEYS = new Set(['profile', 'repo', 'mode', 'failOnSkip', 'report'])

/**
 * Walk up from `startDir` looking for the config file. Never crosses into
 * (or searches within) `node_modules`; the first hit wins.
 * @param {string} startDir - absolute directory to search from.
 * @returns {string | undefined} absolute config path, or undefined.
 */
export function findEvalConfigFile(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    if (!dir.split(/[\\/]/).includes('node_modules')) {
      const candidate = join(dir, CONFIG_FILE_NAME)
      if (existsSync(candidate)) return candidate
    }
    const parent = resolve(dir, '..')
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Load and validate the config reachable from `startDir`.
 * @param {string} startDir - absolute directory to search from (usually cwd).
 * @returns {Promise<{ file: string, config: {
 *   profile?: string, repo?: string, mode?: 'real'|'mock'|'all',
 *   failOnSkip?: boolean, report?: string,
 * } }>} `config` is `{}` when no file exists. `repo`/`report` come back
 * absolute (resolved against the config file's directory).
 * @throws {Error} on a malformed config (unknown key, wrong value shape).
 */
export async function loadEvalConfig(startDir) {
  const file = findEvalConfigFile(startDir)
  if (file === undefined) return { file: undefined, config: {} }
  const module = await import(pathToFileURL(file).href)
  const config = module.default ?? {}
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${CONFIG_FILE_NAME}: default export must be a config object`)
  }
  for (const key of Object.keys(config)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`${file}: unknown config key '${key}' (allowed: ${[...ALLOWED_KEYS].join(', ')})`)
    }
  }
  const out = {}
  if (config.profile !== undefined) {
    if (typeof config.profile !== 'string' || config.profile === '') {
      throw new Error(`${file}: profile must be a non-empty string`)
    }
    out.profile = config.profile
  }
  if (config.repo !== undefined) {
    if (typeof config.repo !== 'string' || config.repo === '') {
      throw new Error(`${file}: repo must be a non-empty string (relative to the config file)`)
    }
    out.repo = resolve(file, '..', config.repo)
  }
  if (config.mode !== undefined) {
    if (!['real', 'mock', 'all'].includes(config.mode)) {
      throw new Error(`${file}: mode must be 'real', 'mock', or 'all (got '${config.mode}')`)
    }
    out.mode = config.mode
  }
  if (config.failOnSkip !== undefined) {
    if (typeof config.failOnSkip !== 'boolean') {
      throw new Error(`${file}: failOnSkip must be a boolean`)
    }
    out.failOnSkip = config.failOnSkip
  }
  if (config.report !== undefined) {
    if (typeof config.report !== 'string' || config.report === '') {
      throw new Error(`${file}: report must be a non-empty string (relative to the config file)`)
    }
    out.report = resolve(file, '..', config.report)
  }
  return { file, config: out }
}
