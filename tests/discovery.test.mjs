import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { discoverFiles, validateEvalCase, validateEvidenceAnchor, evidenceAnchorKind, detectDuplicateIds } from '../src/discovery.mjs'
import { toolNotCalled, userMessageTextExcludes, subagentDispatchCount } from '../src/assertions.mjs'

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

  it('accepts disableRows (empty = explicit none) and rejects malformed values plus the removed gates field', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'rows-1', task: 'test', expect: [validMatcher], disableRows: ['gates'],
    }, file))
    // An explicit empty list is legal: it overrides a config-level default
    // ("disable nothing here"), e.g. gate-interaction cases.
    assert.doesNotThrow(() => validateEvalCase({
      id: 'rows-empty-ok', task: 'test', expect: [validMatcher], disableRows: [],
    }, file))
    assert.throws(() => validateEvalCase({
      id: 'rows-bad', task: 'test', expect: [validMatcher], disableRows: 'gates',
    }, file), /disableRows must be a string\[\]/)
    assert.throws(() => validateEvalCase({
      id: 'rows-bad-item', task: 'test', expect: [validMatcher], disableRows: [''],
    }, file), /disableRows must be a string\[\]/)
    assert.throws(() => validateEvalCase({
      id: 'gates-legacy', task: 'test', expect: [validMatcher], gates: 'off',
    }, file), /'gates' field was removed/)
  })

  it('accepts rowConfig with scalar / scalar-array leaves and rejects nested shapes', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'rowconfig-ok', task: 'test', expect: [validMatcher],
      rowConfig: { prompt: { disabledProviders: ['a-enricher'], totalTimeoutMs: 5000, flag: false } },
    }, file))
    assert.throws(() => validateEvalCase({
      id: 'rowconfig-not-object', task: 'test', expect: [validMatcher], rowConfig: ['prompt'],
    }, file), /rowConfig must be an object/)
    assert.throws(() => validateEvalCase({
      id: 'rowconfig-not-config', task: 'test', expect: [validMatcher], rowConfig: { prompt: 'off' },
    }, file), /must be a config object/)
    assert.throws(() => validateEvalCase({
      id: 'rowconfig-nested', task: 'test', expect: [validMatcher], rowConfig: { prompt: { a: { b: 1 } } },
    }, file), /scalar or scalar array/)
    assert.throws(() => validateEvalCase({
      id: 'rowconfig-array-object', task: 'test', expect: [validMatcher], rowConfig: { prompt: { a: [{}] } },
    }, file), /array of scalars/)
  })

  it('accepts followups with optional settleTimeoutMs and rejects malformed values', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'followups-ok', task: 'test', expect: [validMatcher],
      followups: ['rescan now'], settleTimeoutMs: 30_000,
    }, file))
    assert.throws(() => validateEvalCase({
      id: 'followups-empty', task: 'test', expect: [validMatcher], followups: [],
    }, file), /followups must be a non-empty string\[\]/)
    assert.throws(() => validateEvalCase({
      id: 'followups-bad-item', task: 'test', expect: [validMatcher], followups: [''],
    }, file), /followups must be a non-empty string\[\]/)
    assert.throws(() => validateEvalCase({
      id: 'followups-bad-timeout', task: 'test', expect: [validMatcher], followups: ['go'], settleTimeoutMs: -1,
    }, file), /settleTimeoutMs must be a positive finite number/)
  })

  it('rejects a non-object', () => {
    assert.throws(() => validateEvalCase(null, file), /case must be an object/)
    assert.throws(() => validateEvalCase('string', file), /case must be an object/)
  })

  it('rejects empty or missing id', () => {
    assert.throws(() => validateEvalCase({ id: '', task: 'x', expect: [validMatcher] }, file), /non-empty string/)
    assert.throws(() => validateEvalCase({ task: 'x', expect: [validMatcher] }, file), /non-empty string/)
  })

  it('rejects missing task', () => {
    assert.throws(() => validateEvalCase({ id: 'a', expect: [validMatcher] }, file), /task must be a string/)
  })

  it('rejects invalid mode', () => {
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', mode: 'bogus', expect: [validMatcher] }, file),
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
      () => validateEvalCase({ id: 'a', task: 'x', mode: 'mock', expect: [validMatcher] }, file),
      /mock mode requires script\.steps/,
    )
    assert.throws(
      () => validateEvalCase({ id: 'a', task: 'x', mode: 'mock', expect: [validMatcher], script: {} }, file),
      /mock mode requires script\.steps/,
    )
  })

  // A case whose whole expect passes on an empty projection reports "nothing
  // was measured" as "passed" — the loader refuses that shape up front
  // (EVAL-022 / ADR 0005).
  it('rejects an expect set with no evidence anchor, naming the negative matchers', () => {
    const outcome = () => validateEvalCase({
      id: 'anchor-1', task: 'x',
      expect: [toolNotCalled(/^coggit_/), userMessageTextExcludes('gates', 'task-b.md')],
    }, file)
    assert.throws(outcome, /no evidence anchor/)
    assert.throws(outcome, /tool not called: \/\^coggit_\//)
    assert.throws(outcome, /add one assertion that requires evidence/)
    assert.throws(outcome, /requiresEvidence: false/)
  })

  it('accepts an anchor in any position, including a parameter-dependent count matcher', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'anchor-2', task: 'x',
      expect: [toolNotCalled(/^coggit_/), validMatcher],
    }, file))
    assert.doesNotThrow(() => validateEvalCase({
      id: 'anchor-3', task: 'x',
      expect: [validMatcher, toolNotCalled(/^coggit_/)],
    }, file))
    // `subagentDispatchCount(m, 0)` asserts absence; `(m, 1)` asks for presence
    // and therefore anchors the case.
    assert.throws(() => validateEvalCase({
      id: 'anchor-4', task: 'x', expect: [subagentDispatchCount(/^gates:/, 0)],
    }, file), /no evidence anchor/)
    assert.doesNotThrow(() => validateEvalCase({
      id: 'anchor-5', task: 'x', expect: [subagentDispatchCount(/^gates:/, 1)],
    }, file))
  })

  it('treats an unmarked custom matcher as an anchor and a self-reported one as negative', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'anchor-6', task: 'x',
      expect: [toolNotCalled('read'), { describe: 'custom', check: () => ({ ok: true, message: '' }) }],
    }, file))
    assert.throws(() => validateEvalCase({
      id: 'anchor-7', task: 'x',
      expect: [{ describe: 'custom negative', check: () => ({ ok: true, message: '' }), requiresEvidence: false }],
    }, file), /no evidence anchor/)
  })

  // A case can anchor in its own `inspect` hook instead: the hook receives the
  // workspace and the trace (undefined when nothing materialized), so its own
  // checks are the evidence surface. The repo's wiring-smoke case is this
  // shape — rejecting it was a regression the ADR's survey missed.
  it('accepts an empty expect when the case asserts in an inspect hook', () => {
    assert.doesNotThrow(() => validateEvalCase({
      id: 'anchor-8', task: 'x', expect: [],
      inspect: () => {},
    }, file))
    assert.doesNotThrow(() => validateEvalCase({
      id: 'anchor-9', task: 'x',
      expect: [toolNotCalled('read')],
      inspect: () => {},
    }, file))
    // Empty expect WITHOUT an inspect hook is a case that cannot fail at all.
    assert.throws(() => validateEvalCase({
      id: 'anchor-10', task: 'x', expect: [],
    }, file), /no evidence anchor — every matcher passes vacuously on an empty projection \(expect is empty\)/)
  })

  it('validateEvidenceAnchor reports the same rule when called directly', () => {
    assert.doesNotThrow(() => validateEvidenceAnchor([validMatcher], 'case x'))
    assert.throws(
      () => validateEvidenceAnchor([subagentDispatchCount('a', 0)], 'case x'),
      /^Error: case x: no evidence anchor/,
    )
    assert.doesNotThrow(
      () => validateEvidenceAnchor([], 'case x', { inspect: () => {} }),
      'an inspect hook anchors the case',
    )
    assert.throws(
      () => validateEvidenceAnchor([], 'case x', { inspect: 'not a function' }),
      /\(expect is empty\)/,
    )
  })

  // The rule must load the repo's own corpus: a wiring smoke that asserts only
  // inside its inspect hook (`expect: []`) is the shape that made a first cut of
  // this rule reject a shipped case.
  it('loads the repo case that asserts in its inspect hook with an empty expect', async () => {
    const fromEval = fileURLToPath(new URL('../../extras/modules/prompt/eval/behavior/mock/injection-smoke.eval.mjs', import.meta.url))
    const loaded = (await import(pathToFileURL(fromEval).href)).default
    assert.deepEqual(loaded.expect, [])
    assert.equal(typeof loaded.inspect, 'function')
    assert.doesNotThrow(() => validateEvalCase(loaded, fromEval))
  })

  // Which channel anchors a case is a fact the report carries: a matcher anchor
  // is verified by the guard, an inspect anchor is only DECLARED (nothing can
  // audit a hook), and the two must not read alike on the record (EVAL-022 C).
  it('names the anchoring channel, with inspect as the declared one', () => {
    assert.equal(evidenceAnchorKind({ expect: [validMatcher] }), 'matcher')
    assert.equal(evidenceAnchorKind({ expect: [toolNotCalled('read')] }), 'none')
    assert.equal(evidenceAnchorKind({ expect: [], inspect: () => {} }), 'inspect')
    assert.equal(evidenceAnchorKind({ expect: [toolNotCalled('read')], inspect: () => {} }), 'inspect')
    // A matcher anchor always wins, whatever else the case carries.
    assert.equal(evidenceAnchorKind({ expect: [validMatcher], inspect: () => {} }), 'matcher')
    assert.equal(evidenceAnchorKind({}), 'none')
    assert.equal(evidenceAnchorKind(undefined), 'none')
  })

  // The anchor rule is the catch-all, so a structural mistake must be what the
  // author hears about first: an empty expect used to mask `script.steps`.
  it('reports a structural error before the missing anchor', () => {
    assert.throws(
      () => validateEvalCase({ id: 'order-1', task: 'x', mode: 'mock', expect: [] }, file),
      /mock mode requires script\.steps/,
    )
    assert.throws(
      () => validateEvalCase({ id: 'order-2', task: 'x', mode: 'mock', expect: [], inspect: () => {} }, file),
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
