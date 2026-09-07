import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseSessionLog, buildTrace, loadTraceDir } from '../src/trace.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

describe('parseSessionLog', () => {
  it('parses the header and events of a plain log', () => {
    const text = readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8')
    const { header, events } = parseSessionLog(text)
    assert.equal(header.type, 'session')
    assert.equal(header.id, 'session-fixture-1')
    assert.equal(events.length, 9)
    assert.equal(events[0].type, 'turn/start')
  })

  it('skips packed chunk rows', () => {
    const text = readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8')
    const { events } = parseSessionLog(text)
    assert.ok(!events.some(event => event.type === 'text-chunks'))
    assert.equal(events.filter(event => event.type === 'tool/call').length, 1)
  })

  it('rejects a log without a session header', () => {
    assert.throws(() => parseSessionLog('{"seq":0,"type":"turn/start","data":{}}\n'))
    assert.throws(() => parseSessionLog(''))
  })

  it('keeps the decodable prefix past a torn tail line', () => {
    const text = `${readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8')}{"seq":9,"type":"tur`
    const { events } = parseSessionLog(text)
    assert.equal(events.length, 9)
  })
})

describe('buildTrace', () => {
  const text = readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8')
  const trace = buildTrace([parseSessionLog(text)])

  it('projects tool calls with parsed arguments', () => {
    assert.deepEqual(trace.toolCalls.map(call => call.name), ['coggit_status', 'coggit_add'])
    assert.deepEqual(trace.toolCalls[1].parsedArguments, { sourcePath: 'src/example.ts', overwrite: false })
    assert.equal(trace.toolCalls[0].callId, 'call-1')
  })

  it('projects request/header system prompts and mounted tools', () => {
    const headerTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'header-session.jsonl'), 'utf8'))])
    assert.equal(headerTrace.requestHeaders.length, 1)
    assert.equal(headerTrace.requestHeaders[0].reason, 'initial')
    assert.ok(headerTrace.requestHeaders[0].system.includes('subagent_at'))
    assert.deepEqual(headerTrace.requestHeaders[0].toolNames, ['read', 'subagent_at'])
  })

  it('projects an empty requestHeaders list when no request/header event exists', () => {
    assert.deepEqual(trace.requestHeaders, [])
  })

  it('pairs tool results by callId', () => {
    assert.deepEqual(trace.toolResults.map(result => result.callId), ['call-1', 'call-2'])
    assert.equal(trace.toolResults[0].text, 'status: 3 tracked nodes')
    assert.equal(trace.toolResults[0].error, undefined)
  })

  it('projects isError from the tool-result wrapper block', () => {
    // sample-session: both results have isError: false
    assert.equal(trace.toolResults[0].isError, false)
    assert.equal(trace.toolResults[1].isError, false)
  })

  it('projects isError: true for error results', () => {
    const errorText = readFileSync(join(FIXTURES, 'error-session.jsonl'), 'utf8')
    const errorTrace = buildTrace([parseSessionLog(errorText)])
    const okResult = errorTrace.toolResults.find(r => r.callId === 'call-ok')
    const failResult = errorTrace.toolResults.find(r => r.callId === 'call-fail')
    assert.equal(okResult.isError, false)
    assert.equal(failResult.isError, true)
    assert.equal(failResult.text, 'permission denied: insufficient privileges')
  })

  it('takes the last non-empty assistant text as finalText', () => {
    assert.deepEqual(trace.assistantTexts, ['intermediate note', 'Done: cognition created.'])
    assert.equal(trace.finalText, 'Done: cognition created.')
  })

  it('projects user messages with their source (task prompt vs plugin steer)', () => {
    const steerTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'steer-session.jsonl'), 'utf8'))])
    assert.equal(steerTrace.userMessages.length, 2)
    assert.deepEqual(steerTrace.userMessages[0].source, { kind: 'user' })
    assert.equal(steerTrace.userMessages[0].text, 'write task-a.md')
    assert.deepEqual(steerTrace.userMessages[1].source, { kind: 'plugin', plugin: 'gates' })
    assert.ok(steerTrace.userMessages[1].text.includes('task-a.md'))
  })

  it('derives answerText as the last assistant text before a plugin injection', () => {
    // steer-session: assistant "done" → gates splice → assistant "fixed the
    // link". finalText is the post-splice message; the ANSWER is "done".
    const steerTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'steer-session.jsonl'), 'utf8'))])
    assert.equal(steerTrace.finalText, 'fixed the link')
    assert.equal(steerTrace.answerText, 'done')
  })

  it('degenerates answerText to finalText without plugin injections', () => {
    assert.equal(trace.answerText, trace.finalText)
    assert.equal(trace.answerText, 'Done: cognition created.')
  })

  it('projects an empty userMessages list when no user/message event exists', () => {
    assert.deepEqual(trace.userMessages, [])
  })

  it('selects the main session over subagent logs', () => {
    const parent = parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8'))
    const child = parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child.jsonl'), 'utf8'))
    const merged = buildTrace([child, parent])
    assert.equal(merged.sessionId, 'session-parent')
    assert.deepEqual(merged.toolCalls.map(call => call.callId), ['call-a'])
  })
})

describe('loadTraceDir', () => {
  it('returns undefined for an absent root', () => {
    assert.equal(loadTraceDir(join(FIXTURES, 'does-not-exist')), undefined)
  })

  it('returns undefined when no session artifact exists', () => {
    assert.equal(loadTraceDir(FIXTURES), undefined)
  })
})
