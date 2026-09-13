import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseSessionLog, buildTrace, isSessionLogFilename, collectSessionTrace, KNOWN_SESSION_FORMAT_VERSIONS } from '../src/trace.mjs'

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

  // The header stamp is the host's declaration of the artifact's generation.
  // An unknown one is seam drift: refuse it here so the projection never
  // degrades to empty arrays silently (EVAL-020).
  it('accepts every known generation and refuses an unknown one by its number', () => {
    const header = version => `{"type":"session","version":${version},"id":"s"}\n`
    for (const version of KNOWN_SESSION_FORMAT_VERSIONS) {
      assert.doesNotThrow(() => parseSessionLog(header(version)), `v${version} must be accepted`)
    }
    assert.throws(
      () => parseSessionLog(header(4)),
      /session header version v4 is not a known generation \(known: v0, v1, v2, v3\); the host session format may have changed generation/,
    )
  })

  it('refuses a session header with no generation stamp', () => {
    assert.throws(
      () => parseSessionLog('{"type":"session","id":"s"}\n'),
      /session header version \(null\) is not a known generation/,
    )
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

  it('projects subagent children with descriptor identity and their own answer', () => {
    const parent = parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8'))
    const child = parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child.jsonl'), 'utf8'))
    const pending = parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child-pending.jsonl'), 'utf8'))
    const merged = buildTrace([parent, child, pending])
    assert.equal(merged.subagentChildren.length, 2)
    const answered = merged.subagentChildren.find(c => c.sessionId === 'session-child')
    assert.equal(answered.label, 'gates:fix:doc-link')
    assert.equal(answered.mode, 'one-shot')
    assert.equal(answered.provider, 'subagent-in-process')
    assert.equal(answered.parentSession, 'session-parent')
    assert.equal(answered.delegationDepth, 1)
    assert.equal(answered.finalText, 'fixed the doc link')
    const silent = merged.subagentChildren.find(c => c.sessionId === 'session-child-pending')
    assert.equal(silent.label, 'gates:fix:coggit-misplaced')
    assert.equal(silent.finalText, '')
  })

  it('projects an empty subagentChildren list without child logs', () => {
    assert.deepEqual(trace.subagentChildren, [])
  })

  // The census exists so that "the host log carried no such event" and "the
  // projection dropped it" are different facts on the report surface. It never
  // judges which one it is (EVAL-022 / ADR 0005).
  it('census lines up the main log event counts with the projection lengths', () => {
    assert.equal(trace.census.eventTypeCounts['tool/call'], 2)
    assert.equal(trace.census.eventTypeCounts['assistant/message'], 2)
    assert.equal(trace.census.eventTypeCounts['turn/start'], 1)
    assert.deepEqual(trace.census.projectionLengths, {
      toolCalls: 2,
      toolResults: 2,
      assistantTexts: 2,
      userMessages: 0,
      requestHeaders: 0,
    })
    assert.deepEqual(trace.census.projectionSkipped, { main: {}, children: {} })
    assert.equal(trace.census.subagent.supportedDescriptors, 0)
    assert.deepEqual(trace.census.subagent.children, [])
  })

  it('census separates an empty main log from the child logs it projected', () => {
    const parent = parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8'))
    const child = parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child.jsonl'), 'utf8'))
    const merged = buildTrace([parent, child])
    assert.equal(merged.census.subagent.projectionLength, 1)
    assert.equal(merged.census.subagent.supportedDescriptors, 1)
    assert.deepEqual(merged.census.subagent.children, [{
      sessionId: 'session-child',
      parentSession: 'session-parent',
      delegationDepth: 1,
      descriptorEvents: 1,
      supportedDescriptors: 1,
    }])
  })

  it('census reports main-log drops, dropped child identity and unprojected event types apart', () => {
    const main = '{"type":"session","version":3,"id":"session-main"}'
      + '\n{"seq":1,"type":"user/message","data":{"message":{"role":"user","content":[]}}}'
      + '\n{"seq":2,"type":"tool/call","data":{"turn":1,"step":1,"callId":"call-1","toolName":"renamed"}}'
      + '\n{"seq":3,"type":"step/end","data":{"turn":1,"step":1}}'
    const child = '{"type":"session","version":3,"id":"session-child","parentSession":"session-main"}'
      + '\n{"seq":1,"type":"subagent/descriptor","data":{"version":2,"label":"legacy"}}'
    const census = buildTrace([parseSessionLog(main), parseSessionLog(child)]).census

    // Empty text drops by design, yet the count still differs — the census says
    // the difference exists, not whether it is legal.
    assert.equal(census.eventTypeCounts['user/message'], 1)
    assert.equal(census.projectionLengths.userMessages, 0)
    assert.deepEqual(census.projectionSkipped.main, { userMessages: 1 })

    // The identity-loss path the five main-log projections cannot see: the
    // child entered `subagentChildren` with no label, mode or provider.
    assert.deepEqual(census.projectionSkipped.children, { withoutIdentity: 1 })
    assert.deepEqual(census.subagent.children, [{
      sessionId: 'session-child',
      parentSession: 'session-main',
      delegationDepth: undefined,
      descriptorEvents: 1,
      supportedDescriptors: 0,
    }])

    // An event type no projection reads still shows up in the count.
    assert.equal(census.eventTypeCounts['step/end'], 1)
    // The child log's descriptor is not a MAIN-log event: it belongs to the
    // subagent census, not to `eventTypeCounts`.
    assert.equal(census.subagent.mainLogDescriptorEvents, 0)
    assert.equal('subagent/descriptor' in census.eventTypeCounts, false)
  })

  it('keeps the census on the run trace only, never on a nested session log', () => {
    const parent = parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8'))
    const merged = buildTrace([parent])
    assert.ok(merged.census !== undefined)
    assert.equal(merged.sessions.every(session => session.census === undefined), true)
  })
})

describe('collectSessionTrace — collection', () => {
  it('returns nothing for an absent root', () => {
    assert.equal(collectSessionTrace(join(FIXTURES, 'does-not-exist')).trace, undefined)
  })

  it('returns nothing when no session artifact exists', () => {
    assert.equal(collectSessionTrace(FIXTURES).trace, undefined)
  })

  // The host names each immutable format generation: v0 keeps `session.jsonl`,
  // later generations add `vN` (`session.v3.jsonl`). Matching only the v0 name
  // finds no trace at all after a format bump.
  it('discovers a versioned generation artifact (session.vN.jsonl)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-trace-'))
    try {
      writeFileSync(join(dir, 'session.v3.jsonl'), readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8'))
      assert.equal(collectSessionTrace(dir).trace?.sessionId, 'session-fixture-1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores migration temporaries and non-generation names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-trace-'))
    try {
      const text = readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8')
      writeFileSync(join(dir, 'session.migration.abc123.jsonl.tmp'), text)
      writeFileSync(join(dir, 'session.v3.jsonl.zstd'), text)
      assert.equal(collectSessionTrace(dir).trace, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('collectSessionTrace — diagnosis', () => {
  it('returns the trace and no gap when a generation artifact is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-collect-'))
    try {
      writeFileSync(join(dir, 'session.v3.jsonl'), readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8'))
      const { trace, gap } = collectSessionTrace(dir)
      assert.equal(trace?.sessionId, 'session-fixture-1')
      assert.equal(gap, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The empty-collection diagnosis must name what was actually there: a host
  // that renamed its artifact otherwise reads as "the parser is broken" (the
  // 2026-09-12 format-v3 incident, EVAL-019/EVAL-020).
  it('names session-like candidate files when no artifact matches the naming rule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-collect-'))
    try {
      writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'not a plaintext artifact')
      writeFileSync(join(dir, 'metadata.json'), '{}')
      const { trace, gap } = collectSessionTrace(dir)
      assert.equal(trace, undefined)
      assert.match(gap, /no session trace materialized/)
      assert.match(gap, /session-like file\(s\) under it: session\.v4\.jsonl\.zstd/)
      assert.match(gap, /the host artifact naming may have changed generation/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to every file name, and reports an empty root as such', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-collect-'))
    const empty = mkdtempSync(join(tmpdir(), 'dsh-eval-collect-'))
    try {
      writeFileSync(join(dir, 'conversation.v4.jsonl'), 'x')
      const renamed = collectSessionTrace(dir)
      assert.match(renamed.gap, /file\(s\) under it: conversation\.v4\.jsonl/)
      assert.match(renamed.gap, /the host artifact naming may have changed generation/)
      assert.match(collectSessionTrace(empty).gap, /the root holds no files \(missing or empty\)/)
      assert.match(
        collectSessionTrace(join(FIXTURES, 'does-not-exist')).gap,
        /the root holds no files \(missing or empty\)/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('reports an artifact refused by the parse boundary instead of a bare undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-collect-'))
    try {
      writeFileSync(join(dir, 'session.v9.jsonl'), '{"type":"session","version":9,"id":"s"}\n')
      const { trace, gap } = collectSessionTrace(dir)
      assert.equal(trace, undefined)
      assert.match(gap, /session artifact\(s\) failed to parse — session\.v9\.jsonl: session header version v9 is not a known generation/)
      assert.match(gap, /the host session format may have changed generation/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('isSessionLogFilename', () => {
  it('accepts every committed generation name and rejects everything else', () => {
    for (const name of ['session.jsonl', 'session.v3.jsonl', 'session.v12.jsonl']) {
      assert.equal(isSessionLogFilename(name), true, name)
    }
    for (const name of ['session.v3.jsonl.zstd', 'session.migration.abc.jsonl.tmp', 'sample-session.jsonl', 'session.v3.jsonl.bak']) {
      assert.equal(isSessionLogFilename(name), false, name)
    }
  })
})
