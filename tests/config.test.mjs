import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findEvalConfigFile, loadEvalConfig, CONFIG_FILE_NAME } from '../src/config.mjs'

function tempTree(build) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eval-config-'))
  try {
    build(root)
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
  return root
}

describe('findEvalConfigFile', () => {
  it('finds the config at the start dir and upward, skipping node_modules', () => {
    const root = tempTree(root => {
      writeFileSync(join(root, CONFIG_FILE_NAME), 'export default {}')
      mkdirSync(join(root, 'pkg', 'node_modules', 'dep'), { recursive: true })
      mkdirSync(join(root, 'pkg', 'eval'), { recursive: true })
    })
    try {
      assert.equal(findEvalConfigFile(join(root, 'pkg', 'eval')), join(root, CONFIG_FILE_NAME))
      // inside node_modules: the walk skips searching there but still ascends past it
      assert.equal(findEvalConfigFile(join(root, 'pkg', 'node_modules', 'dep')), join(root, CONFIG_FILE_NAME))
      // first hit wins — a config deeper in the tree shadows the root one
      writeFileSync(join(root, 'pkg', CONFIG_FILE_NAME), 'export default {}')
      assert.equal(findEvalConfigFile(join(root, 'pkg', 'eval')), join(root, 'pkg', CONFIG_FILE_NAME))
      assert.equal(findEvalConfigFile(root), join(root, CONFIG_FILE_NAME))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns undefined when no config exists anywhere upward', () => {
    const root = tempTree(root => { mkdirSync(join(root, 'a'), { recursive: true }) })
    try {
      assert.equal(findEvalConfigFile(join(root, 'a')), undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('loadEvalConfig', () => {
  it('resolves repo/report against the config file dir and passes scalars through', async () => {
    const root = tempTree(root => {
      mkdirSync(join(root, 'pkg'), { recursive: true })
      writeFileSync(join(root, 'pkg', CONFIG_FILE_NAME),
        'export default { profile: "headless", repo: "../../deepseek-harness", mode: "mock", failOnSkip: true, report: "eval-report.json" }')
      mkdirSync(join(root, 'pkg', 'eval'), { recursive: true })
    })
    try {
      const { file, config } = await loadEvalConfig(join(root, 'pkg', 'eval'))
      assert.equal(file, join(root, 'pkg', CONFIG_FILE_NAME))
      assert.equal(config.profile, 'headless')
      assert.equal(config.repo, join(root, '..', 'deepseek-harness'))
      assert.equal(config.mode, 'mock')
      assert.equal(config.failOnSkip, true)
      assert.equal(config.report, join(root, 'pkg', 'eval-report.json'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns an empty config when no file exists', async () => {
    const root = tempTree(root => { mkdirSync(join(root, 'a'), { recursive: true }) })
    try {
      const { file, config } = await loadEvalConfig(join(root, 'a'))
      assert.equal(file, undefined)
      assert.deepEqual(config, {})
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails loud on unknown keys and malformed values', async () => {
    const root = tempTree(root => {
      mkdirSync(join(root, 'typo'), { recursive: true })
      writeFileSync(join(root, 'typo', CONFIG_FILE_NAME), 'export default { profle: "headless" }')
      mkdirSync(join(root, 'badmode'), { recursive: true })
      writeFileSync(join(root, 'badmode', CONFIG_FILE_NAME), 'export default { mode: "fast" }')
      mkdirSync(join(root, 'array'), { recursive: true })
      writeFileSync(join(root, 'array', CONFIG_FILE_NAME), 'export default ["x"]')
    })
    try {
      await assert.rejects(loadEvalConfig(join(root, 'typo')), /unknown config key 'profle'/)
      await assert.rejects(loadEvalConfig(join(root, 'badmode')), /mode must be/)
      await assert.rejects(loadEvalConfig(join(root, 'array')), /must be a config object/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
