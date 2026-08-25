/**
 * Shared case / experiment discovery and validation for the eval CLIs.
 * Both `dsh-eval` and `dsh-review` scan directories recursively; this
 * module ensures they share identical skip rules and validation.
 */

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
 * Validate one eval case's shape. Throws with a descriptive message on
 * the first violation found. Checks:
 *
 * - `id` is a non-empty string.
 * - `task` is a string.
 * - `mode` (if present) is `'real'` or `'mock'`.
 * - `expect` is an array; every element has `describe` (string) and `check` (function).
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
