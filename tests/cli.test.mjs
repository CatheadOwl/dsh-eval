import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDshCliChain, NO_CLI_GUIDANCE } from '../src/cli.mjs'

/** Minimal fake host checkout: apps/cli/lib/bin.js exists. */
function createFakeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-repo-'))
  mkdirSync(join(dir, 'apps', 'cli', 'lib'), { recursive: true })
  writeFileSync(join(dir, 'apps', 'cli', 'lib', 'bin.js'), '')
  return dir
}

/** Minimal fake resolution layer: node_modules/@deepseek-ai/dsh/lib/bin.js. */
function createFakeLayer() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-layer-'))
  mkdirSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '')
  return dir
}

describe('resolveDshCliChain (C6 host-checkout-resolution)', () => {
  it('flag wins and is validated', () => {
    const repo = createFakeRepo()
    try {
      const { cli, repo: resolvedRepo, source } = resolveDshCliChain({ repoFlag: repo })
      assert.equal(source, 'flag')
      assert.equal(resolvedRepo, repo)
      assert.equal(cli, join(repo, 'apps', 'cli', 'lib', 'bin.js'))
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('flag pointing at a repo without a compiled CLI fails loud', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-empty-'))
    try {
      assert.throws(
        () => resolveDshCliChain({ repoFlag: empty }),
        (error) => error.message.includes('has no apps/cli/lib/bin.js'),
      )
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('resolution layer (node_modules) is hit when no flag is given', () => {
    const layer = createFakeLayer()
    try {
      const { cli, source } = resolveDshCliChain({ startDir: layer })
      assert.equal(source, 'node_modules')
      assert.equal(cli, join(layer, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    } finally {
      rmSync(layer, { recursive: true, force: true })
    }
  })

  it('resolution layer lookup walks up from startDir', () => {
    const layer = createFakeLayer()
    const nested = join(layer, 'modules', 'gates', 'eval')
    mkdirSync(nested, { recursive: true })
    try {
      const { source } = resolveDshCliChain({ startDir: nested })
      assert.equal(source, 'node_modules')
    } finally {
      rmSync(layer, { recursive: true, force: true })
    }
  })

  it('flag beats the resolution layer', () => {
    const repo = createFakeRepo()
    const layer = createFakeLayer()
    try {
      const { source } = resolveDshCliChain({ repoFlag: repo, startDir: layer })
      assert.equal(source, 'flag')
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(layer, { recursive: true, force: true })
    }
  })

  it('config repo is the legacy fallback when the layer misses', () => {
    const repo = createFakeRepo()
    const bare = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-bare-'))
    try {
      const { cli, source } = resolveDshCliChain({ configRepo: repo, startDir: bare })
      assert.equal(source, 'config')
      assert.equal(cli, join(repo, 'apps', 'cli', 'lib', 'bin.js'))
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('a config repo without a compiled CLI is skipped, not fatal', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-empty-'))
    try {
      assert.throws(
        () => resolveDshCliChain({ configRepo: empty }),
        (error) => error.message === NO_CLI_GUIDANCE,
      )
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('whole-chain miss fails with placeholder-only guidance', () => {
    const bare = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-bare-'))
    try {
      assert.throws(
        () => resolveDshCliChain({ startDir: bare }),
        (error) => error.message === NO_CI_PLACEHOLDER_CHECK(error.message),
      )
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

/** Guidance contract: exact text, and never a machine-specific example path. */
function NO_CI_PLACEHOLDER_CHECK(message) {
  assert.equal(message, NO_CLI_GUIDANCE)
  assert.doesNotMatch(message, /[A-Za-z]:\\/u, 'guidance must not contain drive-letter example paths')
  return message
}
