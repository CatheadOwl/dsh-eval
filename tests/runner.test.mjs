import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runEvalCase } from '../src/runner.mjs'
import { toolCalled } from '../src/assertions.mjs'

/**
 * Build a minimal fake deepseek-harness repo — just enough for
 * `looksLikeDshRepo` to accept it. The CLI bin is never actually
 * spawned because `prepare` (or mock validation) throws first.
 */
function createFakeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-fake-repo-'))
  mkdirSync(join(dir, 'apps', 'cli', 'lib'), { recursive: true })
  writeFileSync(join(dir, 'apps', 'cli', 'lib', 'bin.js'), '')
  return dir
}

describe('runEvalCase cleanup', () => {
  it('cleans up runDir when prepare throws', async () => {
    const repoDir = createFakeRepo()
    let capturedRunDir
    const evalCase = {
      id: 'cleanup-test-prepare-fail',
      task: 'test',
      expect: [],
      prepare: async (workspace) => {
        capturedRunDir = join(workspace, '..')
        writeFileSync(join(workspace, 'marker'), 'cleanup-verify')
        throw new Error('prepare exploded')
      },
    }

    try {
      await runEvalCase(evalCase, { profile: 'test', dshRepoDir: repoDir })
      assert.fail('should have thrown')
    } catch (error) {
      assert.match(error.message, /prepare exploded/)
    }

    // runDir must be gone — the marker file is the canary
    assert.equal(existsSync(capturedRunDir), false, 'runDir should be cleaned up after prepare failure')
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('cleans up runDir when mock mode rejects a missing script', async () => {
    const repoDir = createFakeRepo()
    let capturedRunDir
    const evalCase = {
      id: 'cleanup-test-mock-no-script',
      task: 'test',
      expect: [],
      // prepare succeeds — marker proves workspace existed
      prepare: async (workspace) => {
        capturedRunDir = join(workspace, '..')
        writeFileSync(join(workspace, 'marker'), 'alive')
      },
      // no script → mock validation throws inside the try block
    }

    try {
      await runEvalCase(evalCase, { profile: 'test', dshRepoDir: repoDir, mode: 'mock' })
      assert.fail('should have thrown')
    } catch (error) {
      assert.match(error.message, /mock mode requires a script/)
    }

    assert.equal(existsSync(capturedRunDir), false, 'runDir should be cleaned up after mock validation failure')
    rmSync(repoDir, { recursive: true, force: true })
  })
})

// The runner owns the seam diagnosis the CLI prints: a run that produced no
// session artifact must hand back WHY, so the failure text names the host
// artifact naming instead of pointing at the parser (EVAL-020).
describe('runEvalCase session seam diagnosis', () => {
  it('carries the collection gap on the result when nothing materializes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-eval-home-'))
    const cliPath = join(home, 'fake-cli.mjs')
    // A CLI that exits 0 without writing any session artifact — the shape a
    // host artifact-naming change produces.
    writeFileSync(cliPath, 'process.exit(0)\n')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const result = await runEvalCase(
        { id: 'seam-gap-test', task: 'test', expect: [toolCalled('never-called')] },
        { profile: 'test', cliPath },
      )
      assert.equal(result.trace, undefined)
      assert.match(result.traceGap, /no session trace materialized/)
      assert.match(result.traceGap, /the host artifact naming may have changed generation/)
      assert.deepEqual(result.sessionLogs, [])
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })
})
