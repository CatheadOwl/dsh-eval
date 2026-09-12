import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateToolBoundary, renderToolBoundaryEvidence } from '../src/tool-validation.mjs'

describe('validateToolBoundary', () => {
  // A missing trace is NOT a pass: the check did not run. The result says so
  // in `status`, and `ok` is false so that no caller can read the skip as a
  // green boundary by accident (EVAL-021).
  it('reports an explicit not-executed status when trace is undefined', () => {
    const result = validateToolBoundary(undefined)
    assert.equal(result.status, 'not-executed')
    assert.equal(result.ok, false)
    assert.deepEqual(result.unexpected, [])
    assert.deepEqual(result.actual, [])
    assert.deepEqual(result.allowed, [])
  })

  it('reports the same explicit status for a null trace', () => {
    const result = validateToolBoundary(null)
    assert.equal(result.status, 'not-executed')
    assert.equal(result.ok, false)
  })

  it('reports a checked boundary when trace has no request headers', () => {
    const trace = { requestHeaders: [], toolCalls: [], toolResults: [], assistantTexts: [], sessions: [], finalText: '' }
    const result = validateToolBoundary(trace)
    assert.equal(result.status, 'checked')
    assert.equal(result.ok, true)
    assert.deepEqual(result.actual, [])
  })

  it('fails when trace contains unexpected tools', () => {
    const trace = {
      requestHeaders: [
        { seq: 0, reason: 'initial', system: 's', toolNames: ['coggit_status', 'subagent_at'] },
      ],
      toolCalls: [], toolResults: [], assistantTexts: [], sessions: [], finalText: '',
    }
    const result = validateToolBoundary(trace)
    assert.equal(result.status, 'checked')
    assert.equal(result.ok, false)
    assert.deepEqual(result.unexpected, ['coggit_status', 'subagent_at'])
    assert.deepEqual(result.actual, ['coggit_status', 'subagent_at'])
  })

  it('passes when every mounted tool is in the allowed set', () => {
    const trace = {
      requestHeaders: [
        { seq: 0, reason: 'initial', system: 's', toolNames: ['read'] },
      ],
      toolCalls: [], toolResults: [], assistantTexts: [], sessions: [], finalText: '',
    }
    const result = validateToolBoundary(trace, { allowedTools: new Set(['read']) })
    assert.equal(result.status, 'checked')
    assert.equal(result.ok, true)
    assert.deepEqual(result.unexpected, [])
    assert.deepEqual(result.actual, ['read'])
    assert.deepEqual(result.allowed, ['read'])
  })

  it('deduplicates tools across multiple request headers', () => {
    const trace = {
      requestHeaders: [
        { seq: 0, reason: 'initial', system: 's', toolNames: ['read', 'write'] },
        { seq: 5, reason: 'tool-change', system: 's', toolNames: ['read', 'coggit_status'] },
      ],
      toolCalls: [], toolResults: [], assistantTexts: [], sessions: [], finalText: '',
    }
    const result = validateToolBoundary(trace, { allowedTools: new Set(['read', 'write']) })
    assert.equal(result.ok, false)
    assert.deepEqual(result.unexpected, ['coggit_status'])
    assert.deepEqual(result.actual, ['coggit_status', 'read', 'write'])
  })

  it('reports only the unexpected subset when some tools are allowed', () => {
    const trace = {
      requestHeaders: [
        { seq: 0, reason: 'initial', system: 's', toolNames: ['read', 'leak_tool'] },
      ],
      toolCalls: [], toolResults: [], assistantTexts: [], sessions: [], finalText: '',
    }
    const result = validateToolBoundary(trace, { allowedTools: new Set(['read']) })
    assert.equal(result.ok, false)
    assert.deepEqual(result.unexpected, ['leak_tool'])
    assert.deepEqual(result.actual, ['leak_tool', 'read'])
  })
})

describe('renderToolBoundaryEvidence', () => {
  it('produces a JSON document with violation details', () => {
    const validation = { status: 'checked', ok: false, unexpected: ['coggit_status'], actual: ['coggit_status', 'read'], allowed: ['read'] }
    const text = renderToolBoundaryEvidence(validation, { runDir: '/tmp/r', profile: 'headless' })
    const parsed = JSON.parse(text)
    assert.equal(parsed.status, 'tool-boundary-violation')
    assert.equal(parsed.runDir, '/tmp/r')
    assert.equal(parsed.profile, 'headless')
    assert.deepEqual(parsed.unexpectedTools, ['coggit_status'])
    assert.deepEqual(parsed.actualMounted, ['coggit_status', 'read'])
    assert.deepEqual(parsed.allowedTools, ['read'])
  })
})
