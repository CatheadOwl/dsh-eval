import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { discoverFiles, validateEvalCase, detectDuplicateIds } from '../src/discovery.mjs'

describe('discoverFiles', () => {
  function seed(suffix) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-discover-'))
    // real cases
    writeFileSync(join(root, `a${suffix}`), '')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', `b${suffix}`), '')
    // must-skip directories
    mkdirSync(join(root, '.runs', 'nested'), { recursive: true })
    writeFileSync(join(root, '.runs', `stale${suffix}`), '')
    writeFileSync(join(root, '.runs', 'nested', `deep${suffix}`), '')
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', `dep${suffix}`), '')
    // non-matching file (should not appear)
    writeFileSync(join(root, 'readme.md'), '')
    return root
  }

  it('skips .runs and node_modules for .eval.mjs', () => {
    const root = seed('.eval.mjs')
    const found = discoverFiles(root, '.eval.mjs').sort()
    assert.equal(found.length, 2)
    assert.ok(found.every(f => !f.includes('.runs') && !f.includes('node_modules')))
    rmSync(root, { recursive: true, force: true })
  })

  it('skips .runs and node_modules for .review.mjs', () => {
    const root = seed('.review.mjs')
    const found = discoverFiles(root, '.review.mjs').sort()
    assert.equal(found.length, 2)
    assert.ok(found.every(f => !f.includes('.runs') && !f.includes('node_modules')))
    rmSync(root, { recursive: true, force: true })
  })

  it('accepts a direct file path', () => {
    const root = seed('.eval.mjs')
    const direct = join(root, 'a.eval.mjs')
    const found = discoverFiles(direct, '.eval.mjs')
    assert.equal(found.length, 1)
    assert.equal(found[0], direct)
    rmSync(root, { recursive: true, force: true })
  })

  it('ignores non-matching files', () => {
    const root = seed('.eval.mjs')
    const found = discoverFiles(root, '.review.mjs')
    assert.equal(found.length, 0)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('validateEvalCase', () => {
  const file = 'test.eval.mjs'
  const validMatcher = { describe: 'matcher', check: () => ({ ok: true, message: '' }) }

  it('accepts a valid real case', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'case-1', task: 'do something', expect: [validMatcher],
    }, file))
  })

  it('accepts a valid mock case with script.steps', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'mock-1', task: 'test', mode: 'mock', expect: [validMatcher],
      script: { steps: [{ kind: 'text', text: 'done' }] },
    }, file))
  })

  it('accepts disableRows and rejects malformed values plus the removed gates field', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'rows-1', task: 'test', expect: [validMatcher], disableRows: ['gates'],
    }, file))
    assert.throws(() => validateEvalCase({
      id: 'rows-empty', task: 'test', expect: [validMatcher], disableRows: [],
    }, file), /disableRows must be a non-empty string\[\]/)
    assert.throws(() => validateEvalCase({
      id: 'rows-bad', task: 'test', expect: [validMatcher], disableRows: 'gates',
    }, file), /disableRows must be a non-empty string\[\]/)
    assert.throws(() => validateEvalCase({
      id: 'gates-legacy', task: 'test', expect: [validMatcher], gates: 'off',
    }, file), /'gates' field was removed/)
  })

  it('rejects a non-object', () => {
    assert.throws(() => validateEvalCase(null, file), /case must be an object/)
    assert.throws(() => validateEvalCase('string', file), /case must be an object/)
  })

  it('rejects empty or missing id', () => {
    assert.throws(() => validateEvalCase({ id: '', task: 'x', expect: [] }, file), /non-empty string/)
    assert.throws(() => validateEvalCase({ task: 'x', expect: [] }, file), /non-empty string/)
  })

  it('rejects missing task', () => {
    assert.throws(() => validateEvalCase({ id: 'a', expect: [] }, file), /task must be a string/)
  })

  it('rejects invalid mode', () => {
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', mode: 'bogus', expect: [] }, file),
      /mode must be 'real' or 'mock'/,
    )
  })

  it('rejects non-array expect', () => {
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', expect: 'nope' }, file),
      /expect must be a Matcher\[\]/,
    )
  })

  it('rejects matcher without describe or check', () => {
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', expect: [{ describe: 'x' }] }, file),
      /describe: string, check: function/,
    )
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', expect: [{ check: () => {} }] }, file),
      /describe: string, check: function/,
    )
  })

  it('rejects mock mode without script.steps', () => {
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', mode: 'mock', expect: [] }, file),
      /mock mode requires script\.steps/,
    )
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', mode: 'mock', expect: [], script: {} }, file),
      /mock mode requires script\.steps/,
    )
  })
})

describe('detectDuplicateIds', () => {
  it('passes with unique ids', () => {
    assert.doesNotThrow(() => detectDuplicateIds([
      { id: 'a', __file: 'file1.mjs' },
      { id: 'b', __file: 'file2.mjs' },
    ]))
  })

  it('throws on duplicate ids with file locations', () => {
    assert.throws(
      () => detectDuplicateIds([
        { id: 'dup', __file: 'file1.mjs' },
        { id: 'dup', __file: 'file2.mjs' },
      ]),
      /duplicate case id 'dup' in file1\.mjs and file2\.mjs/,
    )
  })

  it('reports same-file duplicates with a single location', () => {
    assert.throws(
      () => detectDuplicateIds([
        { id: 'dup', __file: 'same.mjs' },
        { id: 'dup', __file: 'same.mjs' },
      ]),
      /duplicate case id 'dup' in same\.mjs$/,
    )
  })

  it('passes with an empty list', () => {
    assert.doesNotThrow(() => detectDuplicateIds([]))
  })
})
