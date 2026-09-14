import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseSessionLog, buildTrace, isSessionLogFilename, collectSessionTrace, KNOWN_SESSION_FORMAT_VERSIONS } from '../src/trace.mjs'
import { subagentDispatchCount, toolNotCalled } from '../src/assertions.mjs'

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
  // The parser is format-v3 only: an older stamp is refused exactly like an
  // unknown one (EVAL-020 admission + the v3-only design rule — no
  // legacy-format compatibility).
  it('accepts v3 and refuses older or unknown generations by their number', () => {
    const header = version => `{"type":"session","version":${version},"id":"s"}\n`
    for (const version of KNOWN_SESSION_FORMAT_VERSIONS) {
      assert.doesNotThrow(() => parseSessionLog(header(version)), `v${version} must be accepted`)
    }
    for (const version of [0, 1, 2, 4]) {
      assert.throws(
        () => parseSessionLog(header(version)),
        new RegExp(`session header version v${version} is not a known generation \\(known: v3\\); the host session format may have changed generation`),
        `v${version} must be refused`,
      )
    }
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

  it('projects request headers (mounted tools) and drops the removed header system field', () => {
    const headerTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'header-session.jsonl'), 'utf8'))])
    assert.equal(headerTrace.requestHeaders.length, 1)
    assert.equal(headerTrace.requestHeaders[0].reason, 'initial')
    assert.equal('system' in headerTrace.requestHeaders[0], false, 'the pre-v3 header.system channel is gone from the projection')
    assert.deepEqual(headerTrace.requestHeaders[0].toolNames, ['read', 'subagent_at'])
    // The prompt itself is read from the v3 system/message fold.
    assert.ok(headerTrace.systemPrompt.includes('subagent_at'))
  })

  // Format v3 moved the assembled prompt out of request/header into streaming
  // system/message surface events; the projection folds them instead of
  // reading a header field that no longer exists (2026-09-14 seam).
  it('folds v3 system/message nodes and takes the last non-empty as the effective prompt', () => {
    const promptTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'system-prompt-session.jsonl'), 'utf8'))])
    assert.deepEqual(promptTrace.systemMessages.map(node => node.seq), [2])
    assert.ok(promptTrace.systemMessages[0].text.includes('cognition-link directive'))
    assert.equal(promptTrace.systemPrompt, promptTrace.systemMessages[0].text)
    // The v3 header carries no system field and that is NOT a gap.
    assert.equal('system' in promptTrace.requestHeaders[0], false)
    assert.deepEqual(promptTrace.census.projectionFieldGaps, {})
  })

  it('folds an in-history append: the newest non-empty node is the effective prompt', () => {
    const log = '{"type":"session","version":3,"id":"session-history"}'
      + '\n{"seq":1,"type":"system/message","data":{"message":{"role":"system","content":[{"type":"text","text":"prompt v1"}]}},"surfaceOp":"append"}'
      + '\n{"seq":2,"type":"request/header","data":{"reason":"initial","header":{"config":{"provider":"p","model":"m"}}}}'
      + '\n{"seq":4,"type":"system/message","data":{"message":{"role":"system","content":[{"type":"text","text":"prompt v2 with directive"}]}},"surfaceOp":"append"}'
    const built = buildTrace([parseSessionLog(log)])
    assert.deepEqual(built.systemMessages.map(node => node.seq), [1, 4])
    assert.ok(built.systemPrompt.includes('prompt v2'))
  })

  it('folds a replacing system/message: the shadowed node stops surviving', () => {
    const log = '{"type":"session","version":3,"id":"session-replace"}'
      + '\n{"seq":1,"type":"system/message","data":{"message":{"role":"system","content":[{"type":"text","text":"prompt v1"}]}},"surfaceOp":"append"}'
      + '\n{"seq":2,"type":"request/header","data":{"reason":"change","header":{"config":{"provider":"p","model":"m"}}}}'
      + '\n{"seq":4,"type":"system/message","data":{"message":{"role":"system","content":[{"type":"text","text":"prompt v2"}]}},"surfaceOp":{"op":"replace","startSeq":1,"endSeq":1},"sourceEventSeqs":[1]}'
    const built = buildTrace([parseSessionLog(log)])
    assert.deepEqual(built.systemMessages, [{ seq: 4, text: 'prompt v2' }])
    assert.equal(built.systemPrompt, 'prompt v2')
    // The cleared-prompt shape: a replace to empty text leaves the node alive
    // but empty, so the effective prompt degenerates to ''.
    const cleared = buildTrace([parseSessionLog(log.replace('prompt v2', ''))])
    assert.deepEqual(cleared.systemMessages.map(node => node.seq), [4])
    assert.equal(cleared.systemPrompt, '')
  })

  it('folds a compaction replace from a non-system event shadowing a later system node', () => {
    const log = '{"type":"session","version":3,"id":"session-compaction"}'
      + '\n{"seq":1,"type":"system/message","data":{"message":{"role":"system","content":[{"type":"text","text":"node zero"}]}},"surfaceOp":"append"}'
      + '\n{"seq":2,"type":"system/message","data":{"message":{"role":"system","content":[{"type":"text","text":"later in-history node"}]}},"surfaceOp":"append"}'
      + '\n{"seq":3,"type":"user/message","data":{"content":[{"type":"text","text":"task"}],"source":{"kind":"user"},"role":"user"},"surfaceOp":"append"}'
      + '\n{"seq":4,"type":"assistant/message","data":{"message":{"role":"assistant","content":[{"type":"text","text":"summary"}]}},"surfaceOp":{"op":"replace","startSeq":2,"endSeq":3},"sourceEventSeqs":[2,3]}'
    const built = buildTrace([parseSessionLog(log)])
    // Node zero survives (the host protects it from compaction); the later
    // system node was shadowed by the assistant summary.
    assert.deepEqual(built.systemMessages, [{ seq: 1, text: 'node zero' }])
    assert.equal(built.systemPrompt, 'node zero')
  })

  it('census: a v3 run with requests but no prompt surface records promptSurfaceAbsent', () => {
    const log = '{"type":"session","version":3,"id":"session-noprompt"}'
      + '\n{"seq":1,"type":"request/header","data":{"reason":"initial","header":{"config":{"provider":"p","model":"m"}}}}'
    const built = buildTrace([parseSessionLog(log)])
    assert.deepEqual(built.census.projectionFieldGaps, { promptSurfaceAbsent: 1 })
  })

  it('refuses a pre-v3 log at admission instead of projecting it', () => {
    const v0 = '{"type":"session","version":0,"id":"session-v0"}'
      + '\n{"seq":1,"type":"request/header","data":{"reason":"initial","header":{"config":{"provider":"p","model":"m"}}}}'
    assert.throws(() => buildTrace([parseSessionLog(v0)]), /is not a known generation \(known: v3\)/)
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
      systemMessages: 0,
    })
    assert.deepEqual(trace.census.projectionSkipped, { main: {}, children: {} })
    assert.equal(trace.census.subagent.supportedDescriptors, 0)
    assert.deepEqual(trace.census.subagent.children, [])
  })

  it('census separates an empty main log from the child logs it projected', () => {
    const parent = parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8'))
    const child = parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child.jsonl'), 'utf8'))
    const merged = buildTrace([parent, child])
    assert.equal(merged.census.subagent.children.length, 1)
    assert.equal(merged.census.subagent.supportedDescriptors, 1)
    assert.deepEqual(merged.census.projectionFieldGaps, {})
    assert.deepEqual(merged.census.subagent.children, [{
      sessionId: 'session-child',
      parentSession: 'session-parent',
      delegationDepth: 1,
      descriptorEvents: 1,
      supportedDescriptors: 1,
      label: 'gates:fix:doc-link',
      mode: 'one-shot',
      provider: 'subagent-in-process',
    }])
  })

  // The 1:1 projections can never show up in `projectionSkipped.main` — the
  // record lands whatever its fields say — so a moved payload field needs its
  // own signal, or the census stays blind to the rename path it was built for.
  it('census reports a kept record whose field went missing', () => {
    // On v3 a header never carries `system`; the moved-field signals here are
    // the tool-face renames plus the nameless mounted tool entry.
    const log = '{"type":"session","version":3,"id":"session-drift"}'
      + '\n{"seq":1,"type":"tool/call","data":{"turn":1,"step":1,"toolName":"renamed","arguments":"{}"}}'
      + '\n{"seq":2,"type":"tool/result","data":{"turn":1,"step":1,"message":{"role":"user","content":[]}}}'
      + '\n{"seq":3,"type":"request/header","data":{"header":{"reason":"initial","tools":[{"description":"no name"}]}}}'
    const built = buildTrace([parseSessionLog(log)])
    const census = built.census

    assert.deepEqual(census.projectionFieldGaps, {
      toolCallWithoutName: 1,
      toolCallWithoutCallId: 1,
      toolResultWithoutCallId: 1,
      headerWithoutToolNames: 1,
      promptSurfaceAbsent: 1,
    })
    // Length comparison alone sees nothing: every event landed in a projection.
    assert.deepEqual(census.projectionSkipped.main, {})
    assert.equal(census.projectionLengths.toolCalls, 1)
    // The vacuity this signal exists to expose: the call is present, unnamed.
    assert.equal(built.toolCalls[0].name, undefined)
    assert.equal(toolNotCalled('renamed').check(built).ok, true)
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
    assert.deepEqual(census.projectionSkipped.children, { withoutIdentity: 1, withoutLabel: 1 })
    assert.deepEqual(census.subagent.children, [{
      sessionId: 'session-child',
      parentSession: 'session-main',
      delegationDepth: undefined,
      descriptorEvents: 1,
      supportedDescriptors: 0,
      label: undefined,
      mode: undefined,
      provider: undefined,
    }])

    // An event type no projection reads still shows up in the count.
    assert.equal(census.eventTypeCounts['step/end'], 1)
    // The child log's descriptor is not a MAIN-log event: it belongs to the
    // subagent census, not to `eventTypeCounts`.
    assert.equal(census.subagent.mainLogDescriptorEvents, 0)
    assert.equal('subagent/descriptor' in census.eventTypeCounts, false)
  })

  // Partial identity is its own signal: a supported descriptor that carries
  // mode/provider but no label still leaves the child unmatchable by the
  // label-keyed count matchers, so `*Count(label, 0)` stays vacuously green
  // even though `supportedDescriptors` looks healthy.
  it('census flags a child whose label is missing even when other identity fields folded', () => {
    const main = '{"type":"session","version":3,"id":"session-main"}'
    const child = '{"type":"session","version":3,"id":"session-child","parentSession":"session-main"}'
      + '\n{"seq":1,"type":"subagent/descriptor","data":{"version":3,"mode":"one-shot","provider":"p"}}'
    const built = buildTrace([parseSessionLog(main), parseSessionLog(child)])
    const census = built.census

    assert.equal(census.subagent.supportedDescriptors, 1)
    assert.equal(census.projectionSkipped.children.withoutIdentity, undefined)
    assert.equal(census.projectionSkipped.children.withoutLabel, 1)
    assert.equal(census.subagent.children[0].label, undefined)
    assert.equal(census.subagent.children[0].mode, 'one-shot')
    // The fact the census exists to surface: the label assertion is green only
    // because no child carried a label.
    assert.equal(subagentDispatchCount(/^gates:fix:/, 0).check(built).ok, true)
  })

  // A plug-in event type is an open string, and names like `constructor`,
  // `toString` and `__proto__` exist on `Object.prototype`. An accumulator that
  // inherits them either string-concatenates (`?? 0` never fires on an inherited
  // function) or swallows the key through the `__proto__` setter — either way the
  // census stops being numbers about events.
  it('census counts prototype-named event types as numbers', () => {
    const log = '{"type":"session","version":3,"id":"session-proto"}'
      + '\n{"seq":1,"type":"constructor","data":{}}'
      + '\n{"seq":2,"type":"toString","data":{}}'
      + '\n{"seq":3,"type":"__proto__","data":{}}'
      + '\n{"seq":4,"type":"__proto__","data":{}}'
    const census = buildTrace([parseSessionLog(log)]).census
    assert.equal(census.eventTypeCounts.constructor, 1)
    assert.equal(census.eventTypeCounts.toString, 1)
    assert.equal(census.eventTypeCounts.__proto__, 2)
    assert.equal(typeof census.eventTypeCounts.constructor, 'number')
    for (const count of Object.values(census.eventTypeCounts)) assert.equal(typeof count, 'number')
  })

  // `supportedDescriptors` sums the per-child counts, so it counts DESCRIPTOR
  // EVENTS, not child sessions: a child may log several supported descriptors
  // while its identity still folds from the first one only.
  it('census sums descriptor events per child, not child sessions', () => {
    const main = '{"type":"session","version":3,"id":"session-main"}'
    const child = '{"type":"session","version":3,"id":"session-child","parentSession":"session-main"}'
      + '\n{"seq":1,"type":"subagent/descriptor","data":{"version":3,"label":"first"}}'
      + '\n{"seq":2,"type":"subagent/descriptor","data":{"version":3,"label":"second"}}'
    const merged = buildTrace([parseSessionLog(main), parseSessionLog(child)])
    assert.equal(merged.subagentChildren.length, 1)
    assert.equal(merged.subagentChildren[0].label, 'first')
    assert.equal(merged.census.subagent.supportedDescriptors, 2)
    assert.equal(merged.census.subagent.children[0].supportedDescriptors, 2)
  })

  it('leaves the caller logs untouched and keeps the census on the run trace only', () => {
    const parent = parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8'))
    const merged = buildTrace([parent])
    assert.ok(merged.census !== undefined)
    assert.equal(merged.sessions[0], parent)
    assert.equal(merged.sessions.every(session => session.census === undefined), true)
    // The pre-existing input keeps whatever it carried: buildTrace must not
    // mutate the caller's parsed logs.
    const seeded = parseSessionLog(readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8'))
    seeded.census = { injected: true }
    buildTrace([seeded])
    assert.deepEqual(seeded.census, { injected: true })
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
