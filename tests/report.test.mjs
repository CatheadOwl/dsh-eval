import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCaseRecord, summarizeRecords, buildRunReport, reportExitCode } from '../src/report.mjs'

describe('createCaseRecord', () => {
  it('includes only the fields the outcome actually has', () => {
    const pass = createCaseRecord({ id: 'c-1', file: '/x/c.eval.mjs', mode: 'mock', status: 'pass', exitCode: 0, durationMs: 5 })
    assert.deepEqual(Object.keys(pass).sort(),
      ['durationMs', 'exitCode', 'file', 'id', 'mode', 'status'])
    const skip = createCaseRecord({ id: 'c-2', file: '/x/c.eval.mjs', mode: 'real', status: 'skip', skipReason: 'no credential' })
    assert.equal(skip.skipReason, 'no credential')
    assert.ok(!('exitCode' in skip))
  })

  it('omits mode for file-level failures that never resolved to a case', () => {
    const record = createCaseRecord({ id: '/x/broken.eval.mjs', file: '/x/broken.eval.mjs', status: 'fail', failures: ['load error'] })
    assert.ok(!('mode' in record))
    assert.deepEqual(record.failures, ['load error'])
  })
})

describe('summarizeRecords', () => {
  it('derives counts from statuses so they can never disagree', () => {
    const records = [
      { status: 'pass' }, { status: 'pass' }, { status: 'fail' }, { status: 'skip' },
    ]
    assert.deepEqual(summarizeRecords(records), { selected: 4, passed: 2, failed: 1, skipped: 1 })
    assert.deepEqual(summarizeRecords([]), { selected: 0, passed: 0, failed: 0, skipped: 0 })
  })
})

describe('buildRunReport', () => {
  it('anchors the invocation environment and keeps results in execution order', () => {
    const records = [
      { id: 'a', status: 'pass' },
      { id: 'b', status: 'fail', failures: ['x'] },
    ]
    const report = buildRunReport({
      profile: 'headless', repo: 'D:/harness', modeFilter: 'mock', failOnSkip: true,
      startedAt: '2026-09-04T00:00:00.000Z', finishedAt: '2026-09-04T00:00:01.000Z',
      records,
    })
    assert.equal(report.tool, 'dsh-eval')
    assert.equal(report.profile, 'headless')
    assert.equal(report.repo, 'D:/harness')
    assert.equal(report.mode, 'mock')
    assert.equal(report.failOnSkip, true)
    assert.deepEqual(report.summary, { selected: 2, passed: 1, failed: 1, skipped: 0 })
    assert.deepEqual(report.results.map(r => r.id), ['a', 'b'])
    assert.ok(JSON.stringify(report).length > 0)
  })
})

describe('reportExitCode', () => {
  it('fails on any failure, and under --fail-on-skip on an all-skipped selection', () => {
    assert.equal(reportExitCode([{ status: 'pass' }], false), 0)
    assert.equal(reportExitCode([{ status: 'pass' }, { status: 'fail' }], false), 1)
    assert.equal(reportExitCode([{ status: 'skip' }], false), 0)
    assert.equal(reportExitCode([{ status: 'skip' }], true), 1)
    // "never ran but reported success": skip + fail still fails via failed count.
    assert.equal(reportExitCode([{ status: 'skip' }, { status: 'fail' }], true), 1)
    assert.equal(reportExitCode([], true), 0)
  })
})
