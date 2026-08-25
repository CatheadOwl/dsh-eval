import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runEvalCase } from '../src/runner.mjs'

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
