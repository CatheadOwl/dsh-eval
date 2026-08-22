import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseSessionLog, buildTrace } from '../src/trace.mjs'
import {
  toolCalled,
  toolNotCalled,
  firstTool,
  toolSequence,
  toolCallArgs,
  toolResultFor,
  finalTextIncludes,
  finalTextMatches,
} from '../src/assertions.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const trace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8'))])

describe('toolCalled', () => {
  it('matches exact names and regexps', () => {
    assert.equal(toolCalled('coggit_add').check(trace).ok, true)
    assert.equal(toolCalled(/^coggit_/).check(trace).ok, true)
    assert.equal(toolCalled('bash').check(trace).ok, false)
    assert.equal(toolCalled(/^bash$/).check(trace).ok, false)
  })

  it('explains the observed sequence on failure', () => {
    const outcome = toolCalled('bash').check(trace)
    assert.match(outcome.message, /coggit_status, coggit_add/)
  })
})

describe('toolNotCalled', () => {
  it('passes when the tool never ran and fails when it did', () => {
    assert.equal(toolNotCalled('bash').check(trace).ok, true)
    assert.equal(toolNotCalled(/^coggit_/).check(trace).ok, false)
  })
})

describe('firstTool', () => {
  it('checks only the first call', () => {
    assert.equal(firstTool('coggit_status').check(trace).ok, true)
    assert.equal(firstTool('coggit_add').check(trace).ok, false)
  })

  it('fails with a message on an empty trace', () => {
    const empty = buildTrace([])
    const outcome = firstTool('bash').check(empty)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /no tool calls/)
  })
})

describe('toolSequence', () => {
  it('accepts an ordered subsequence', () => {
    assert.equal(toolSequence(['coggit_status', 'coggit_add']).check(trace).ok, true)
    assert.equal(toolSequence(['coggit_status']).check(trace).ok, true)
  })

  it('rejects wrong order and missing members', () => {
    assert.equal(toolSequence(['coggit_add', 'coggit_status']).check(trace).ok, false)
    assert.equal(toolSequence(['coggit_status', 'bash']).check(trace).ok, false)
  })
})

describe('toolCallArgs', () => {
  it('subset-matches parsed arguments', () => {
    assert.equal(toolCallArgs('coggit_add', { sourcePath: 'src/example.ts' }).check(trace).ok, true)
    assert.equal(toolCallArgs('coggit_add', { overwrite: false }).check(trace).ok, true)
    assert.equal(toolCallArgs('coggit_add', { overwrite: true }).check(trace).ok, false)
  })

  it('supports a predicate over parsed and raw arguments', () => {
    const predicate = (parsed, raw) => typeof raw === 'string' && parsed.sourcePath.endsWith('.ts')
    assert.equal(toolCallArgs('coggit_add', predicate).check(trace).ok, true)
  })

  it('fails when the tool was never called', () => {
    assert.equal(toolCallArgs('bash', {}).check(trace).ok, false)
  })
})

describe('toolResultFor', () => {
  it('pairs a call with its result by callId', () => {
    assert.equal(toolResultFor('coggit_status').check(trace).ok, true)
    assert.equal(toolResultFor('bash').check(trace).ok, false)
  })

  it('fails when the call has no result', () => {
    const orphan = { ...trace, toolResults: [] }
    assert.equal(toolResultFor('coggit_status').check(orphan).ok, false)
  })
})

describe('finalText', () => {
  it('includes and matches the last assistant text', () => {
    assert.equal(finalTextIncludes('cognition created').check(trace).ok, true)
    assert.equal(finalTextIncludes('intermediate').check(trace).ok, false)
    assert.equal(finalTextMatches(/^Done:/).check(trace).ok, true)
    assert.equal(finalTextMatches(/^intermediate/).check(trace).ok, false)
  })
})
