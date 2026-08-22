import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stageProfileStore } from '../src/runner.mjs'

let realHome
let tmpHome
const junctions = []

beforeEach(() => {
  realHome = mkdtempSync(join(tmpdir(), 'dsh-eval-stage-real-'))
  tmpHome = mkdtempSync(join(tmpdir(), 'dsh-eval-stage-tmp-'))
})

after(() => {
  // Junctions must drop before their parent trees are removed.
  for (const junction of junctions.splice(0)) {
    try { unlinkSync(junction) } catch { /* already gone */ }
  }
})

/** Clean both scratch homes after each test (junctions unlinked in `after`). */
function cleanup() {
  rmSync(realHome, { recursive: true, force: true })
  rmSync(tmpHome, { recursive: true, force: true })
}

/** Build a realistic store: shared node_modules plus one profile with its own. */
function seedStore(profileName) {
  const profiles = join(realHome, 'profiles')
  mkdirSync(join(profiles, 'node_modules', '@deepseek-ai'), { recursive: true })
  writeFileSync(join(profiles, 'node_modules', '@deepseek-ai', 'marker.txt'), 'shared')
  const profile = join(profiles, profileName)
  mkdirSync(join(profile, 'node_modules', '@catheadowl'), { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{"name":"dsh-profile-x"}\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profile, 'node_modules', '@catheadowl', 'marker.txt'), 'plugin')
  return profile
}

describe('stageProfileStore', () => {
  it('copies the booted profile without node_modules and junctions only its own node_modules', () => {
    seedStore('coggit-headless')
    junctions.push(...stageProfileStore(realHome, tmpHome, 'coggit-headless'))

    const staged = join(tmpHome, 'profiles', 'coggit-headless')
    assert.equal(readFileSync(join(staged, 'package.json'), 'utf8'), '{"name":"dsh-profile-x"}\n')
    assert.equal(readFileSync(join(staged, 'cordis.patch.yml'), 'utf8'), '[]\n')
    // The profile's own node_modules junction resolves to the real module tree.
    assert.equal(readFileSync(join(staged, 'node_modules', '@catheadowl', 'marker.txt'), 'utf8'), 'plugin')
    // The shared fallback is NOT staged: boot rebuilds it fresh in the tmp home.
    assert.equal(existsSync(join(tmpHome, 'profiles', 'node_modules')), false)
    assert.equal(junctions.length, 1)
    cleanup()
  })

  it('keeps boot-time profile writes inside the staged copy', () => {
    seedStore('coggit-headless')
    junctions.push(...stageProfileStore(realHome, tmpHome, 'coggit-headless'))

    // Simulate prepareProfile's unconditional cordis.yml rewrite.
    const stagedPatch = join(tmpHome, 'profiles', 'coggit-headless', 'cordis.yml')
    writeFileSync(stagedPatch, '# rewritten by boot\n')
    const realPatch = join(realHome, 'profiles', 'coggit-headless', 'cordis.yml')
    assert.equal(existsSync(realPatch), false, 'the write must not leak into the real store')
    cleanup()
  })

  it('stages nothing for an absent profile (boot initializes templates in the tmp home)', () => {
    mkdirSync(join(realHome, 'profiles'), { recursive: true })
    const made = stageProfileStore(realHome, tmpHome, 'headless')
    assert.equal(existsSync(join(tmpHome, 'profiles', 'headless')), false)
    assert.equal(made.length, 0)
    cleanup()
  })

  it('tolerates a missing real store entirely', () => {
    const made = stageProfileStore(realHome, tmpHome, 'anything')
    assert.ok(existsSync(join(tmpHome, 'profiles')))
    assert.equal(made.length, 0)
    cleanup()
  })
})
