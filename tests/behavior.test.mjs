/**
 * Behavior-experiment surface: definition validation, arm rowConfig deep
 * merge (baseline fidelity), aggregation discipline (zero-guard-clean arms
 * are INVALID with named reasons — never empty cells), summary rendering,
 * artifacts, and an end-to-end pass over a stdlib fake CLI (no dsh checkout)
 * proving arm overrides actually reach the per-run overlay and argv.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { defineBehaviorExperiment, mergeRowConfig, summarizeBehaviorRows, renderBehaviorSummary, executeBehaviorExperiment, writeBehaviorArtifacts } from '../src/experiment/behavior.mjs'
import { evaluateMatchers } from '../src/evaluate.mjs'

const anchor = { describe: 'final text exists', check: trace => ({ ok: trace.finalText !== undefined, message: 'no final text' }) }

function validDefinition(overrides = {}) {
  return {
    id: 'ab-demo',
    hypothesis: 'variant changes behavior',
    arms: [{ id: 'treatment' }, { id: 'control', overrides: { rowConfig: { demo: { flag: false } } } }],
    runs: 3,
    metrics: trace => ({ ok: trace.finalText !== undefined }),
    guard: metrics => metrics.ok === true,
    decisionRule: 'H1 iff treatment rate > control rate',
    ...overrides,
  }
}

describe('defineBehaviorExperiment', () => {
  it('freezes a validated definition with kind and a stable fingerprint', () => {
    const experiment = defineBehaviorExperiment(validDefinition())
    assert.equal(experiment.kind, 'behavior')
    assert.equal(Object.isFrozen(experiment), true)
    assert.match(experiment.definitionSha256, /^[0-9a-f]{64}$/)
    // Same data fields ⇒ same fingerprint; function identity is not hashed.
    const again = defineBehaviorExperiment({ ...validDefinition(), metrics: trace => ({ ok: false }) })
    assert.equal(again.definitionSha256, experiment.definitionSha256)
    const changed = defineBehaviorExperiment({ ...validDefinition(), runs: 4 })
    assert.notEqual(changed.definitionSha256, experiment.definitionSha256)
  })

  it('rejects malformed definitions with named violations', () => {
    assert.throws(() => defineBehaviorExperiment(validDefinition({ id: 'bad id!' })), /path-safe/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ hypothesis: '' })), /hypothesis/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ arms: [] })), /non-empty array/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ arms: [{ id: 'a' }, { id: 'a' }] })), /duplicate arm id 'a'/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ runs: 0 })), /positive integer/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ metrics: null })), /metrics must be a function/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ guard: 'x' })), /guard must be a function/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({ decisionRule: '' })), /decisionRule/)
  })

  it('whitelists arm overrides and rejects framework-owned or removed fields', () => {
    assert.throws(() => defineBehaviorExperiment(validDefinition({
      arms: [{ id: 'a', overrides: { id: 'other' } }],
    })), /'id' is not an arm-overridable/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({
      arms: [{ id: 'a', overrides: { mode: 'mock' } }],
    })), /'mode' is not an arm-overridable/)
    assert.throws(() => defineBehaviorExperiment(validDefinition({
      arms: [{ id: 'a', overrides: { persona: 'x' } }],
    })), /'persona' is not an arm-overridable/)
    assert.doesNotThrow(() => defineBehaviorExperiment(validDefinition({
      arms: [{ id: 'a', overrides: { task: 'other', expect: [anchor], prepare: () => {}, disableRows: [], followups: ['x'], settleTimeoutMs: 1000, timeoutMs: 5000 } }],
    })))
  })
})

describe('mergeRowConfig (arm-layer baseline fidelity)', () => {
  it('merges only differing keys — equivalent to restating the whole config', () => {
    const base = { prompt: { providerTimeoutMs: 2000, totalTimeoutMs: 5000, variant: { form: 'standard', emphasis: 2 } }, other: { keep: true } }
    const diffOnly = mergeRowConfig(base, { prompt: { variant: { emphasis: 3 } } })
    const restated = mergeRowConfig(undefined, { prompt: { providerTimeoutMs: 2000, totalTimeoutMs: 5000, variant: { form: 'standard', emphasis: 3 } }, other: { keep: true } })
    assert.deepEqual(diffOnly, restated)
  })

  it('whole-replaces scalars and arrays, and passes unmentioned rows through', () => {
    const base = { prompt: { a: 1, tags: ['x'] }, gates: { on: true } }
    const merged = mergeRowConfig(base, { prompt: { a: [1, 2] } })
    assert.deepEqual(merged, { prompt: { a: [1, 2], tags: ['x'] }, gates: { on: true } })
    assert.equal(mergeRowConfig(base, undefined), base)
    assert.deepEqual(mergeRowConfig(undefined, base), base)
  })
})

describe('summarizeBehaviorRows (aggregation discipline)', () => {
  const experiment = defineBehaviorExperiment(validDefinition({ arms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], guard: undefined }))

  it('marks a zero-guard-clean arm INVALID with every failing row named', () => {
    const rows = [
      { arm: 'a', index: 1, caseId: 'x:a:1', ok: true, failure: null, guardOk: true, metrics: { hit: true, calls: 3 } },
      { arm: 'a', index: 2, caseId: 'x:a:2', ok: true, failure: null, guardOk: true, metrics: { hit: false, calls: 5 } },
      { arm: 'b', index: 1, caseId: 'x:b:1', ok: false, failure: 'guard failed (run excluded from aggregation)', guardOk: false, metrics: { hit: false } },
      { arm: 'b', index: 2, caseId: 'x:b:2', ok: false, failure: 'no trace (gap text)', guardOk: null, metrics: null },
    ]
    const [a, b, c] = summarizeBehaviorRows(experiment, rows)
    assert.deepEqual(
      [a.guardClean, a.guardFailures, a.errors, a.invalid],
      [2, 0, 0, false],
    )
    assert.deepEqual(a.metrics.hit, { present: 2, rate: 0.5, median: null })
    assert.deepEqual(a.metrics.calls, { present: 2, rate: 1, median: 4 })
    assert.equal(b.invalid, true)
    assert.deepEqual(b.invalidReasons, ['x:b:1: guard failed (run excluded from aggregation)', 'x:b:2: no trace (gap text)'])
    // An arm with zero rows at all is invalid too — never silently absent.
    assert.equal(c.invalid, true)
  })
})

describe('renderBehaviorSummary + writeBehaviorArtifacts', () => {
  it('reproduces the preregistered rule and renders invalid arms as named failures', () => {
    const result = {
      experimentId: 'ab-demo',
      hypothesis: 'variant changes behavior',
      decisionRule: 'H1 iff treatment rate > control rate',
      definitionSha256: 'deadbeef'.repeat(8),
      arms: [
        { id: 'a', runs: 2, guardClean: 2, guardFailures: 0, errors: 0, invalid: false, invalidReasons: [], metrics: { hit: { present: 2, rate: 1, median: null } } },
        { id: 'b', runs: 2, guardClean: 0, guardFailures: 2, errors: 0, invalid: true, invalidReasons: ['x:b:1: guard failed (run excluded from aggregation)'], metrics: {} },
      ],
      rows: [],
    }
    const summary = renderBehaviorSummary(result)
    assert.match(summary, /decision rule \(preregistered\): H1 iff treatment rate > control rate/)
    assert.match(summary, /definition sha256: `deadbeef/)
    assert.match(summary, /\*\*INVALID\*\*/)
    assert.match(summary, /## Invalid arms \(zero guard-clean runs/)
    assert.match(summary, /x:b:1: guard failed/)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-behavior-artifacts-'))
    try {
      const paths = writeBehaviorArtifacts(result, dir)
      assert.equal(JSON.parse(readFileSync(paths.resultsPath, 'utf8')).experimentId, 'ab-demo')
      assert.match(readFileSync(paths.summaryPath, 'utf8'), /INVALID/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('evaluateMatchers', () => {
  it('collects matcher failures and inlines the anchor rule', () => {
    const failures = evaluateMatchers(
      { id: 'c', expect: [anchor, { describe: 'always fails', check: () => ({ ok: false, message: 'boom' }) }] },
      { finalText: 'done' },
    )
    assert.equal(failures.ok, false)
    assert.deepEqual(failures.failures, ['always fails: boom'])
    assert.throws(() => evaluateMatchers({ id: 'c', expect: [anchor] }, undefined), /without a trace/)
    assert.throws(() => evaluateMatchers(
      { id: 'c', expect: [{ describe: 'never', check: () => ({ ok: true, message: '' }), requiresEvidence: false }] },
      { finalText: 'x' },
    ), /no evidence anchor/)
  })
})

/**
 * A fake dsh CLI for the e2e pass: it reads the per-run overlay, extracts the
 * `demo` row's merged config, and echoes it as the assistant text. A task
 * containing "fail-arm" produces no tag — that arm's guard then fails on
 * every run, exercising the INVALID path end to end.
 */
const FAKE_CLI = `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const patchIndex = process.argv.indexOf('--patch')
const overlay = readFileSync(process.argv[patchIndex + 1], 'utf8')
const rawRoot = overlay.match(/^\\s*root:\\s*(.+)$/mu)[1].trim()
const sessionsRoot = rawRoot.replace(/^["']|["']$/gu, '')
const tag = (overlay.match(/- id: "demo"\\s*\\n\\s*config:\\s*\\n\\s*tag: "([^"]+)"/) ?? [])[1]
const keep = (overlay.match(/\\skeep: (\\d+)/) ?? [])[1]
const task = process.argv.at(-1)
const text = task.includes('fail-arm') ? 'no tag here' : 'tag=' + tag + ' keep=' + keep
mkdirSync(sessionsRoot, { recursive: true })
writeFileSync(
  sessionsRoot + '/session.v3.jsonl',
  [
    JSON.stringify({ type: 'session', version: 3, id: 'session-fake' }),
    JSON.stringify({ seq: 1, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } }),
    JSON.stringify({ seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('\\n') + '\\n',
)
`

describe('executeBehaviorExperiment (e2e over a fake CLI)', () => {
  it('runs arms × runs with merged overrides, named failures, and artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-behavior-e2e-'))
    try {
      const cliPath = join(root, 'fake-cli.mjs')
      writeFileSync(cliPath, FAKE_CLI)
      const experiment = defineBehaviorExperiment({
        id: 'e2e-ab',
        hypothesis: 'the tag reaches the overlay per arm',
        arms: [
          { id: 'a', overrides: { rowConfig: { demo: { tag: 'arm-a' } } } },
          { id: 'b', overrides: { rowConfig: { demo: { tag: 'arm-b' } } } },
          { id: 'c', overrides: { task: 'please fail-arm now' } },
        ],
        runs: 2,
        metrics: trace => ({
          tagged: /tag=arm-/.test(trace.finalText ?? ''),
          kept: /keep=1/.test(trace.finalText ?? ''),
        }),
        guard: metrics => metrics.tagged && metrics.kept,
        decisionRule: 'e2e: arms a/b clean, arm c invalid',
      })
      const baseCase = {
        id: 'e2e-base',
        mode: 'mock',
        task: 'go',
        script: { steps: [{ kind: 'text', text: 'x' }] },
        expect: [anchor],
        rowConfig: { demo: { tag: 'base', keep: 1 } },
      }
      const seen = []
      const result = await executeBehaviorExperiment(experiment, baseCase, {
        profile: 'headless',
        cliPath,
        artifactsDir: join(root, 'artifacts'),
        onRow: row => seen.push(row.caseId),
      })
      assert.deepEqual(seen, ['e2e-base:a:1', 'e2e-base:a:2', 'e2e-base:b:1', 'e2e-base:b:2', 'e2e-base:c:1', 'e2e-base:c:2'])

      const [a, b, c] = result.arms
      assert.equal(a.invalid, false)
      assert.equal(a.guardClean, 2)
      assert.deepEqual(a.metrics.tagged, { present: 2, rate: 1, median: null })
      // `keep: 1` survived the arm override — the deep merge carried the
      // case-level key the arm never mentioned.
      assert.deepEqual(a.metrics.kept, { present: 2, rate: 1, median: null })
      assert.equal(b.invalid, false)
      assert.equal(c.invalid, true)
      assert.equal(c.guardClean, 0)
      assert.ok(c.invalidReasons.every(reason => reason.includes('guard failed')))
      assert.ok(result.rows.filter(row => row.arm === 'c').every(row => row.expectOk === true))

      assert.ok(existsSync(join(root, 'artifacts', 'a', '1', 'trace.json')))
      assert.equal(JSON.parse(readFileSync(join(root, 'artifacts', 'a', '1', 'trace.json'), 'utf8')).caseId, 'e2e-base:a:1')

      const paths = writeBehaviorArtifacts(result, join(root, 'out'))
      const summary = readFileSync(paths.summaryPath, 'utf8')
      assert.match(summary, /\*\*INVALID\*\*/)
      assert.match(summary, /decision rule \(preregistered\): e2e: arms a\/b clean, arm c invalid/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
