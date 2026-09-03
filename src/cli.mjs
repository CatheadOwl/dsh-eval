/**
 * Host CLI resolution chain (release-plan C6 / spec host-checkout-resolution).
 *
 * Locating the compiled dsh CLI follows the same two-layer model as package
 * imports: committed files carry no real host-checkout path — the machine's
 * resolution layer (node_modules, junction-built by the relink anchor tool)
 * absorbs it. Precedence, first hit wins:
 *
 *   1. explicit `--repo <dir>` flag — the documented escape hatch;
 *   2. resolution layer — `node_modules/@deepseek-ai/dsh/lib/bin.js`
 *      (the CLI package's own bin target) reachable upward from startDir;
 *   3. config `repo` key (legacy) — kept working for existing checked-in
 *      `dsh-eval.config.mjs` files until the repo split retires them.
 *
 * Every miss fails loud with a fingerprint and placeholder-only guidance —
 * no machine-specific example paths, no silent fallback to guessing.
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Relative location of the compiled CLI entry inside a dsh checkout. */
export const CLI_RELATIVE_PATH = join('apps', 'cli', 'lib', 'bin.js')

/** Package-relative location of the CLI entry inside `@deepseek-ai/dsh`. */
const PACKAGED_CLI_PATH = join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** The fail-loud message when no chain segment can produce a CLI. */
export const NO_CLI_GUIDANCE = [
  'no dsh CLI found. In order:',
  "  1) pass --repo <host-checkout> explicitly;",
  '  2) or make the resolution layer provide it: node_modules/@deepseek-ai/dsh/lib/bin.js',
  '     (run the repo relink script to (re)build the junction tree from DSH_REPO,',
  '     then build the host checkout if lib/ is missing);',
  '  3) or set repo in dsh-eval.config.mjs (legacy, retired at repo split).',
].join('\n')

/** Validate a repo-style candidate: return the CLI path or undefined. */
function cliFromRepoDir(repoDir) {
  const dir = resolve(repoDir)
  return existsSync(join(dir, CLI_RELATIVE_PATH)) ? join(dir, CLI_RELATIVE_PATH) : undefined
}

/** Walk up from startDir looking for the packaged CLI on the resolution layer. */
function cliFromNodeModules(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = join(dir, PACKAGED_CLI_PATH)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Derive the host checkout dir from a resolved CLI path (realpath, then up
 * four levels from `apps/cli/lib/bin.js`). Falls back to undefined when the
 * layout does not look like a checkout (e.g. an installed CLI tree) — repo
 * is report metadata only, never a runtime requirement.
 */
function repoFromCli(cli) {
  try {
    const repo = resolve(realpathSync(cli), '..', '..', '..', '..')
    return existsSync(join(repo, CLI_RELATIVE_PATH)) ? repo : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the compiled dsh CLI through the three-segment chain.
 *
 * @param {object} options
 * @param {string} [options.repoFlag] - explicit `--repo <dir>` value (highest).
 * @param {string} [options.configRepo] - config-file `repo` value (legacy, lowest).
 * @param {string} [options.startDir] - where resolution-layer lookup starts
 *   (default: process.cwd()).
 * @returns {{ cli: string, repo: string | undefined, source: 'flag' | 'node_modules' | 'config' }}
 * @throws {Error} with placeholder-only guidance when a flag/config repo has
 *   no compiled CLI, or when the whole chain misses.
 */
export function resolveDshCliChain(options = {}) {
  if (options.repoFlag !== undefined) {
    const cli = cliFromRepoDir(options.repoFlag)
    if (cli === undefined) {
      throw new Error(
        `repo '${resolve(options.repoFlag)}' has no ${CLI_RELATIVE_PATH.replaceAll('\\', '/')} — pass a built host checkout, or build it first (pnpm build)`
      )
    }
    return { cli, repo: resolve(options.repoFlag), source: 'flag' }
  }
  const fromLayer = cliFromNodeModules(options.startDir ?? process.cwd())
  if (fromLayer !== undefined) {
    return { cli: fromLayer, repo: repoFromCli(fromLayer), source: 'node_modules' }
  }
  if (options.configRepo !== undefined) {
    const cli = cliFromRepoDir(options.configRepo)
    if (cli !== undefined) {
      return { cli, repo: resolve(options.configRepo), source: 'config' }
    }
  }
  throw new Error(NO_CLI_GUIDANCE)
}
