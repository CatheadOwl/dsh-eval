/**
 * Session-trace parsing for dsh agent eval. The evidence source is the JSONL
 * session artifact written by `@deepseek-ai/dsh-session-persistence-jsonl`
 * (configured `compression: none`, `packChunks: false` by the eval overlay):
 * one `type: 'session'` header line, then one JSON record per `SessionEvent`.
 * Event shapes follow `deepseek-harness/packages/core/session/src/types.ts`
 * (`SessionEventMap`); packed `*-chunks` storage rows are tolerated and
 * skipped — they only carry `assistant/chunk` deltas eval never asserts on.
 *
 * Both seam directions carry an explicit boundary: an artifact whose header
 * stamp is not a known generation is refused here (`parseSessionLog`), and a
 * collection that finds no artifact yields a named diagnosis rather than an
 * unexplained `undefined` (`collectSessionTrace`). See docs/host-wiring.md.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** Storage row types that pack `assistant/chunk` delta runs (see chunk-rows.ts). */
const CHUNK_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/** Projection field name per projected event type. */
const PROJECTED_FIELD_BY_EVENT_TYPE = new Map([
  ['tool/call', 'toolCalls'],
  ['tool/result', 'toolResults'],
  ['assistant/message', 'assistantTexts'],
  ['user/message', 'userMessages'],
  ['request/header', 'requestHeaders'],
  // The one fold-shaped projection: a shadowed node is dropped by design
  // (surface semantics), so a count − length difference here is structural,
  // like the empty-text drops of the message projections.
  ['system/message', 'systemMessages'],
])

/**
 * Session format generations this parser accepts. The host's generation
 * chain ships codecs v0–v3 (`session-format-catalog/src/generated.ts`,
 * `currentVersion: 3` = `SESSION_FORMAT_VERSION` in
 * `core/session/src/types.ts`); this projection is format-v3 ONLY — older
 * generations are rejected exactly like unknown ones, no legacy-format
 * compatibility is carried (the repo's no-legacy-compat design rule). A
 * stamp outside this set means the log's payload this projection was never
 * verified against — fail at the seam instead of projecting empty fields,
 * and bump this set only together with the re-verification the docs'
 * maintenance trigger describes.
 */
export const KNOWN_SESSION_FORMAT_VERSIONS = new Set([3])

/** Known generations rendered for an error message: `v3`. */
function knownGenerationsLabel() {
  return [...KNOWN_SESSION_FORMAT_VERSIONS].sort((a, b) => a - b).map(version => `v${version}`).join(', ')
}

/** One header version stamp, rendered compactly for a diagnostic. */
function headerVersionLabel(version) {
  if (typeof version === 'number') return `v${version}`
  return `(${JSON.stringify(version ?? null)})`
}

/**
 * Parse one uncompressed JSONL session artifact.
 * @param {string} text - the artifact's full text (header line first).
 * @returns {{ header: object, events: object[] }} header plus event records in log order.
 */
export function parseSessionLog(text) {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) throw new Error('empty session log')
  const header = JSON.parse(lines[0])
  if (header.type !== 'session') throw new Error('first line is not a session header')
  // Generation gate: the header stamp is the host's own declaration of the
  // artifact's logical layout. An unknown one is a seam drift, not a parse
  // detail — say so here rather than degrade every projection to empty.
  if (!KNOWN_SESSION_FORMAT_VERSIONS.has(header.version)) {
    throw new Error(
      `session header version ${headerVersionLabel(header.version)} is not a known generation`
      + ` (known: ${knownGenerationsLabel()}); the host session format may have changed generation`,
    )
  }
  const events = []
  for (const line of lines.slice(1)) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue // torn or partial tail line: keep the decodable prefix
    }
    if (record === null || typeof record !== 'object') continue
    if (CHUNK_ROW_TYPES.has(record.type)) continue
    events.push(record)
  }
  return { header, events }
}

/** Concatenate the text blocks of one assembled assistant message. */
function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Fold one event into the surviving system-prompt nodes. Format v3 persists
 * the assembled prompt as streaming `system/message` surface events: an
 * append adds a node; a replace (`surfaceOp: { startSeq, endSeq }`, carried
 * by ANY surface event type — tool-result rewrites and compaction included)
 * shadows the node range it covers while the replacing event takes over at
 * the end (`core/session/src/surface.ts`; surface order is seq order). The
 * first request always commits node 0 (`SystemPromptProjection` in
 * `core/agent-loop`), even for an empty prompt. Logs of older generations
 * are refused at admission — this fold only ever sees v3 payloads.
 * @param {{ seq: number, text: string }[]} nodes - surviving nodes so far, in surface order.
 * @param {object} event - one parsed event record.
 * @returns {void} mutates `nodes`.
 */
function foldSystemPromptSurface(nodes, event) {
  const op = event.surfaceOp
  if (op !== undefined && op !== 'append'
    && Number.isSafeInteger(op.startSeq) && Number.isSafeInteger(op.endSeq)) {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].seq >= op.startSeq && nodes[i].seq <= op.endSeq) nodes.splice(i, 1)
    }
  }
  if (event.type === 'system/message') {
    nodes.push({ seq: event.seq, text: messageText(event.data?.message) })
  }
}

/**
 * Extract the visible text of one tool-result message. Real messages are
 * user-role with a single wrapping `tool-result` block whose `content` holds
 * the actual blocks (see `createToolResultMessage` in
 * `deepseek-harness/packages/llm/llm/src/message.ts`); a bare block list is
 * tolerated for hand-built fixtures.
 */
function toolResultText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const wrapper = content.find(block => block?.type === 'tool-result')
  const inner = wrapper !== undefined ? wrapper.content : content
  if (!Array.isArray(inner)) return ''
  return inner
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Extract the `isError` flag from a tool-result message's wrapper block.
 * Returns `undefined` when the flag is absent (treated as success by
 * matchers — see `toolResultSucceeded`).
 */
function toolResultIsError(message) {
  const content = message?.content
  if (!Array.isArray(content)) return undefined
  const wrapper = content.find(block => block?.type === 'tool-result')
  return wrapper?.isError
}

/** Best-effort parse of a tool call's raw JSON arguments string. */
function parseArguments(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Fold one child log's descriptor events exactly once: the identity
 * `projectChild` asserts on, plus the counts the census reports. Single source
 * on purpose — `projectChild` and `censusForChild` must agree on which
 * descriptor established the identity, and the "supported" predicate must match
 * the fold (a log whose only descriptors are unsupported yields both an empty
 * identity and `supportedDescriptors: 0`, which is the census signal).
 * @param {{ events: object[] }} log - one parsed child log.
 * @returns {{ label: string | undefined, mode: string | undefined, provider: string | undefined, descriptorEvents: number, supportedDescriptors: number }}
 */
function foldChildDescriptor(log) {
  let label
  let mode
  let provider
  let descriptorEvents = 0
  let supportedDescriptors = 0
  for (const event of log.events) {
    if (event.type !== 'subagent/descriptor') continue
    descriptorEvents += 1
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    if (data.version === 3) supportedDescriptors += 1
    if (label !== undefined || mode !== undefined || provider !== undefined) continue
    if (data.version !== 3) continue
    if (typeof data.label === 'string') label = data.label
    if (typeof data.mode === 'string') mode = data.mode
    if (typeof data.provider === 'string') provider = data.provider
  }
  return { label, mode, provider, descriptorEvents, supportedDescriptors }
}

/**
 * Project one subagent child log into an assertable record. The durable
 * identity (`label` / `mode` / `provider`) comes from the FIRST
 * `subagent/descriptor` event whose payload carries the descriptor version
 * this projection supports (3) — mirroring `foldSubagentDescriptor` in
 * `deepseek-harness/packages/subagent/subagent/src/descriptor.ts`, where the
 * establishing provider appends exactly one authoritative descriptor and
 * later events cannot rewrite it. Completion is the child's own last
 * assistant text — a child that produced none may have been dispatched but
 * never ran to an answer (turn/end reasons are not consulted).
 */
function projectChild(log) {
  const { label, mode, provider } = foldChildDescriptor(log)
  const assistantTexts = log.events
    .filter(event => event.type === 'assistant/message')
    .map(event => messageText(event.data.message))
    .filter(text => text !== '')
  return {
    sessionId: log.header.id,
    parentSession: log.header.parentSession,
    delegationDepth: log.header.delegationDepth,
    label,
    mode,
    provider,
    assistantTexts,
    finalText: assistantTexts.at(-1) ?? '',
  }
}

/**
 * Count events by type, plug-in event types included (the only live registry is
 * `SessionEventMap`, so no closed list exists).
 * @param {object[]} events - parsed event records.
 * @returns {Record<string, number>} count per event type, insertion-ordered.
 */
function countEventTypes(events) {
  // Null-prototype accumulator: a plug-in event type may name an
  // `Object.prototype` member (`constructor`, `toString`, `__proto__`), and
  // `counts['constructor'] ?? 0` would otherwise read the inherited function
  // and string-concatenate, while `__proto__` would be swallowed by its setter.
  const counts = Object.create(null)
  for (const event of events) {
    if (typeof event?.type !== 'string') continue
    counts[event.type] = (counts[event.type] ?? 0) + 1
  }
  return counts
}

/**
 * Census for one candidate child log: whether its `subagent/descriptor`
 * events exist, how many, and how many carry the supported descriptor
 * version, plus the folded identity itself. `label` is the field the
 * subagent-count matchers key on, so `label: undefined` with a non-zero
 * `descriptorEvents` is exactly the shape whose `*Count(label, 0)` assertion
 * is green only because there was nothing to match — the identity-loss
 * degradation the census exists to make visible.
 * @param {{ header: object, events: object[] }} log - one parsed child candidate.
 * @returns {{ sessionId: string | undefined, parentSession: string | undefined, delegationDepth: number | undefined, descriptorEvents: number, supportedDescriptors: number, label: string | undefined, mode: string | undefined, provider: string | undefined }}
 */
function censusForChild(log) {
  return {
    sessionId: log.header.id,
    parentSession: log.header.parentSession,
    delegationDepth: log.header.delegationDepth,
    ...foldChildDescriptor(log),
  }
}

/**
 * Projection census for one built trace (see {@link EvalTrace.census}).
 * Numbers only: this reports what the raw logs contained against what the
 * projections kept, and never decides whether the difference is a defect.
 *
 * Three signals, because one number cannot cover three shapes: length
 * differences (`projectionSkipped.main`) see records the projection dropped,
 * `projectionFieldGaps` sees records it kept while a field went missing
 * (`tool/call` and friends project 1:1, so their count − length is structurally
 * zero), and the subagent block sees the child-log data source, which no main-log
 * count can reach.
 *
 * @param {object[]} events - the MAIN log's events (the projection input).
 * @param {EvalTrace} trace - the built trace, read for projection lengths.
 * @param {object[]} childLogs - candidate child logs entering `subagentChildren`.
 * @param {Record<string, number>} projectionFieldGaps - gaps the projection loop
 *   recorded while reading fields, keyed by what was missing.
 * @returns {object} the census record.
 */
function buildCensus(events, trace, childLogs, projectionFieldGaps) {
  const eventTypeCounts = countEventTypes(events)
  const projectionLengths = {
    toolCalls: trace.toolCalls.length,
    toolResults: trace.toolResults.length,
    assistantTexts: trace.assistantTexts.length,
    userMessages: trace.userMessages.length,
    requestHeaders: trace.requestHeaders.length,
    systemMessages: trace.systemMessages.length,
  }
  const projectionSkipped = { main: {}, children: {} }
  for (const [type, field] of PROJECTED_FIELD_BY_EVENT_TYPE) {
    const missing = (eventTypeCounts[type] ?? 0) - projectionLengths[field]
    if (missing > 0) projectionSkipped.main[field] = missing
  }
  const children = childLogs.map(censusForChild)
  const supportedDescriptors = children.reduce((total, child) => total + child.supportedDescriptors, 0)
  // Two degradation shapes, different signals: `withoutIdentity` is a child
  // that folded no identity at all; `withoutLabel` is one that folded some
  // identity but no label — the only field the `subagent*Count` matchers can
  // match on, so its zero-count assertions are the vacuous ones.
  //
  // The child set is the parentSession heuristic (any log whose header carries
  // `parentSession`, which the host also writes for fork/resume/seed logs), so a
  // non-subagent fork log shows up here as an identity-less child. The census
  // reports the set it was given; it cannot re-derive the host's agent-chain
  // ownership check from a log alone.
  const withoutIdentity = children.filter(
    child => child.label === undefined && child.mode === undefined && child.provider === undefined,
  ).length
  const withoutLabel = children.filter(child => child.label === undefined).length
  if (withoutIdentity > 0) projectionSkipped.children.withoutIdentity = withoutIdentity
  if (withoutLabel > 0) projectionSkipped.children.withoutLabel = withoutLabel
  return {
    eventTypeCounts,
    projectionLengths,
    projectionSkipped,
    projectionFieldGaps,
    subagent: {
      mainLogDescriptorEvents: eventTypeCounts['subagent/descriptor'] ?? 0,
      supportedDescriptors,
      children,
    },
  }
}

/**
 * Build one assertable trace from parsed session logs. Child sessions surface
 * only through the parent's tool events, so the MAIN log (no `origin:
 * 'subagent'` header) owns the tool/final-text projections; subagent children
 * project separately under `subagentChildren`; all logs stay available under
 * `sessions`. A log carrying `parentSession` without `origin: 'subagent'`
 * (non-subagent fork/resume shape) counts as a child record here but remains
 * a main candidate too — the host-side ownership check walks the agent chain,
 * which the log alone cannot reproduce.
 * @param {{ header: object, events: object[] }[]} logs - parsed session logs.
 * @returns {EvalTrace}
 */
export function buildTrace(logs) {
  const mains = logs.filter(log => log.header.origin !== 'subagent')
  const main = [...mains].sort((a, b) => b.events.length - a.events.length)[0]
  const events = main?.events ?? []
  const childLogs = logs
    .filter(log => log.header.origin === 'subagent' || log.header.parentSession !== undefined)
  const subagentChildren = childLogs.map(projectChild)

  const toolCalls = []
  const toolResults = []
  const assistantEntries = []
  const userMessages = []
  const requestHeaders = []
  const systemNodes = []
  const gaps = {}
  const recordGap = key => { gaps[key] = (gaps[key] ?? 0) + 1 }
  for (const event of events) {
    foldSystemPromptSurface(systemNodes, event)
    if (event.type === 'request/header') {
      // The assembled model request header: mounted tool schemas. What the
      // model is told to do lives in the system/message fold (`systemPrompt`)
      // — format v3 dropped the header `system` field by design.
      if (Array.isArray(event.data?.header?.tools)
        && !event.data.header.tools.some(tool => typeof tool?.name === 'string')) {
        recordGap('headerWithoutToolNames')
      }
      requestHeaders.push({
        seq: event.seq,
        reason: event.data?.reason,
        toolNames: Array.isArray(event.data?.header?.tools)
          ? event.data.header.tools.map(tool => tool?.name).filter(name => typeof name === 'string')
          : [],
      })
    } else if (event.type === 'tool/call') {
      if (typeof event.data?.name !== 'string') recordGap('toolCallWithoutName')
      if (typeof event.data?.callId !== 'string') recordGap('toolCallWithoutCallId')
      toolCalls.push({
        seq: event.seq,
        turn: event.data.turn,
        step: event.data.step,
        callId: event.data.callId,
        name: event.data.name,
        arguments: event.data.arguments,
        parsedArguments: parseArguments(event.data.arguments),
      })
    } else if (event.type === 'tool/result') {
      if (typeof event.data?.message?.source?.callId !== 'string') recordGap('toolResultWithoutCallId')
      toolResults.push({
        seq: event.seq,
        turn: event.data.turn,
        step: event.data.step,
        callId: event.data.message?.source?.callId,
        text: toolResultText(event.data.message),
        error: event.data.error,
        isError: toolResultIsError(event.data.message),
      })
    } else if (event.type === 'assistant/message') {
      const text = messageText(event.data.message)
      if (text !== '') assistantEntries.push({ seq: event.seq, text })
    } else if (event.type === 'user/message') {
      // The user-role model-visible surface: the task prompt (kind 'user'),
      // plugin steering, or injected context. `source` tells them apart —
      // steer has no dedicated event type (the legacy `steering/message` was
      // migrated to `user/message`), so the matcher side filters by `source`.
      const text = messageText(event.data)
      if (text !== '') {
        userMessages.push({
          seq: event.seq,
          source: event.data?.source,
          text,
        })
      }
    }
  }

  // Channel-level gap: requests happened, yet no prompt surface exists.
  // Every v3 request commits at least one system/message node, so this is the
  // "cannot see the prompt at all" shape — not "the prompt lacks something".
  if (requestHeaders.length > 0 && systemNodes.length === 0) {
    recordGap('promptSurfaceAbsent')
  }

  // The effective assembled prompt under the host's admission semantics: the
  // newest non-empty surviving node is what the model reads (SystemPromptProjection
  // normalizes node 0 on incapable routes and appends newer prompts in history);
  // '' when every node is empty or none exist.
  const systemPrompt = systemNodes.reduce(
    (effective, node) => node.text !== '' ? node.text : effective, '',
  )

  const assistantTexts = assistantEntries.map(entry => entry.text)
  // The answer to the task, as opposed to the last message: once a
  // plugin-sourced injection (kind 'plugin' — a turn-close gate splice, an
  // infra complaint) enters the conversation, every assistant message after
  // it responds to the injection, not to the task. The answer is therefore
  // the last assistant text BEFORE the first plugin injection; without one
  // it degenerates to finalText (the task was the reviewer's last business).
  const firstInjectionSeq = userMessages.find(
    message => message.source?.kind === 'plugin',
  )?.seq
  const answerEntries = firstInjectionSeq === undefined
    ? assistantEntries
    : assistantEntries.filter(entry => entry.seq < firstInjectionSeq)
  const answerText = answerEntries.at(-1)?.text ?? ''

  const result = {
    sessions: logs,
    sessionId: main?.header.id,
    toolCalls,
    toolResults,
    assistantTexts,
    answerText,
    userMessages,
    requestHeaders,
    systemMessages: systemNodes,
    systemPrompt,
    subagentChildren,
    finalText: assistantTexts.at(-1) ?? '',
    census: undefined,
  }
  result.census = buildCensus(events, result, childLogs, gaps)
  return result
}

/**
 * Session artifact basenames: format v0 keeps `session.jsonl`, every later
 * generation carries a `vN` component (`session.v3.jsonl` — the host's
 * `generationLogFilename`). Matching the v0 name alone finds no trace at all
 * once the host bumps the format, which surfaces as "no session trace
 * materialized" rather than as a parse error.
 */
const SESSION_LOG_FILENAME = /^session(?:\.v\d+)?\.jsonl$/u

/**
 * Whether one file basename is a session JSONL artifact of any format generation.
 * @param {string} name - the file basename to test.
 * @returns {boolean} true for `session.jsonl` and `session.vN.jsonl`.
 */
export function isSessionLogFilename(name) {
  return SESSION_LOG_FILENAME.test(name)
}

/** Recursively list files under `dir`; an unreadable directory contributes nothing. */
function listFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(path, out)
    else out.push(path)
  }
  return out
}

/**
 * Every session artifact under `sessionsRoot` (any generation, see
 * `isSessionLogFilename`) as absolute paths — the collection half of the
 * seam, shared by the trace builder and by the raw-log capture the behavior
 * runner does before cleanup.
 * @param {string} sessionsRoot - the run's `session-persistence-jsonl` root.
 * @returns {string[]} artifact paths, in directory order.
 */
export function listSessionLogFiles(sessionsRoot) {
  return listFiles(sessionsRoot).filter(path => isSessionLogFilename(basename(path)))
}

/** Most candidate names one gap diagnostic lists before it truncates. */
const GAP_NAME_LIMIT = 10

/**
 * Why a collection produced no artifact, phrased for a failure message: the
 * candidate names actually seen (a renamed artifact is the likeliest host
 * drift) plus the generation suspicion. Never returns an empty string — an
 * empty root is itself the fact to report.
 */
function traceGapMessage(sessionsRoot, files) {
  const names = [...new Set(files.map(file => basename(file)))]
  const lookalikes = names.filter(name => name.toLowerCase().startsWith('session'))
  const pool = lookalikes.length > 0 ? lookalikes : names
  const shown = pool.slice(0, GAP_NAME_LIMIT)
  const rest = pool.length - shown.length
  const scan = shown.length === 0
    ? 'the root holds no files (missing or empty)'
    : `${lookalikes.length > 0 ? 'session-like file(s)' : 'file(s)'} under it: `
      + `${shown.join(', ')}${rest > 0 ? ` (+${rest} more)` : ''}`
  return 'no session trace materialized: no session artifact'
    + ` (session.jsonl / session.vN.jsonl) under '${sessionsRoot}' — ${scan}`
    + '; the host artifact naming may have changed generation'
}

/**
 * Collect one run's session trace and, when there is none, the seam
 * diagnosis for it.
 *
 * The `gap` string exists so that "the host's artifact/session layout moved"
 * surfaces as that sentence in the behavior runner's failure text and in the
 * review adapter's accounting, instead of as a bare `undefined` the reader
 * has to trace back through the parser (see docs/host-wiring.md).
 *
 * @param {string} sessionsRoot - the run's `session-persistence-jsonl` root.
 * @returns {{ trace: EvalTrace | undefined, gap: string | undefined }} the
 *   trace, or `undefined` plus the reason no trace could be built.
 */
export function collectSessionTrace(sessionsRoot) {
  const files = listFiles(sessionsRoot)
  const artifacts = files.filter(file => isSessionLogFilename(basename(file)))
  if (artifacts.length === 0) {
    return { trace: undefined, gap: traceGapMessage(sessionsRoot, files) }
  }
  const logs = []
  const broken = []
  for (const artifact of artifacts) {
    try {
      logs.push(parseSessionLog(readFileSync(artifact, 'utf8')))
    } catch (error) {
      broken.push(`${basename(artifact)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (broken.length > 0) {
    return {
      trace: undefined,
      gap: `session artifact(s) failed to parse — ${broken.join('; ')}`
        + '; the host session format may have changed generation',
    }
  }
  return { trace: buildTrace(logs), gap: undefined }
}

/**
 * @typedef {object} EvalTrace
 * @property {{ header: object, events: object[] }[]} sessions - every parsed log.
 * @property {string | undefined} sessionId - the main session's id.
 * @property {{ seq: number, turn: number, step: number, callId: string, name: string, arguments: string, parsedArguments: unknown }[]} toolCalls
 * @property {{ seq: number, turn: number, step: number, callId: string, text: string, error: object | undefined, isError: boolean | undefined }[]} toolResults
 * @property {string[]} assistantTexts - non-empty assembled assistant messages, log order.
 * @property {string} answerText - the last assistant text BEFORE the first
 *   plugin-sourced user message (gate splice / injected complaint); equals
 *   finalText when no plugin injection intervened ('' when none at all).
 *   The "answer to the task", as opposed to the possibly-hijacked last message.
 * @property {{ seq: number, source: object, text: string }[]} userMessages
 *   - non-empty `user/message` events (task prompt, plugin steer, injected
 *     context) with their verbatim `source` (`kind` + plugin-specific fields),
 *     in log order. Steer has no dedicated event type; matchers filter by
 *     `source`.
 * @property {{ seq: number, reason: string, toolNames: string[] }[]} requestHeaders
 *   - projected `request/header` events: mounted tool schemas and the request
 *     reason. The assembled prompt is NOT here — format v3 dropped the header
 *     `system` field (the prompt lives in streaming system/message events,
 *     see `systemMessages` / `systemPrompt`).
 * @property {{ seq: number, text: string }[]} systemMessages
 *   - the SURVIVING `system/message` nodes of the format-v3 system-prompt
 *     surface, folded in surface (seq) order: appends add a node, a replace
 *     surfaceOp (any event type) shadows its range.
 * @property {string} systemPrompt
 *   - the effective assembled prompt: the newest non-empty surviving system
 *     node ('' when none).
 * @property {{ sessionId: string | undefined, parentSession: string | undefined, delegationDepth: number | undefined, label: string | undefined, mode: string | undefined, provider: string | undefined, assistantTexts: string[], finalText: string }[]} subagentChildren
 *   - one record per subagent child log (`origin: 'subagent'` header, or a
 *     header carrying `parentSession`). Identity comes from the first
 *     version-3 `subagent/descriptor` event; `finalText` is the child's own
 *     last assistant text ('' when it produced none — dispatched but not
 *     answered).
 * @property {string} finalText - the last assembled assistant text ('' when none).
 * @property {object | undefined} census - what the raw logs contained against
 *   what the projections kept (numbers only, never a verdict). Two data
 *   sources: `eventTypeCounts` counts the MAIN log's events by type (any type,
 *   plug-in ones included), and `subagent` censuses the child logs that enter
 *   `subagentChildren` (their `subagent/descriptor` event counts and how many
 *   carry the supported `version === 3`). `projectionLengths` are the six
 *   main-log projections' lengths after empty-text drops (systemMessages
 *   after surface shadowing); `projectionSkipped`
 *   records where count minus length is positive, per projection, plus the two
 *   child-identity counters. Undefined only on a hand-built trace; a nested log
 *   under `sessions` carries none because the parsers never add one.
 * @property {Record<string, number>} census.projectionFieldGaps
 *   - events the projection kept while a field it reads went missing, keyed by
 *     what was missing (`toolCallWithoutName`, `toolCallWithoutCallId`,
 *     `toolResultWithoutCallId`, `headerWithoutToolNames`).
 *     This is the 1:1-projection signal: for `tool/call`, `tool/result` and
 *     `request/header`, count − length is structurally zero, so a moved field
 *     shows up only here. An absent `request/header.tools` array is NOT counted
 *     (it projects to the same empty list as an empty one).
 *     `promptSurfaceAbsent` is the channel-level companion: requests exist yet
 *     no system/message events do — the "cannot see the prompt at all" shape.
 * @property {{ mainLogDescriptorEvents: number, supportedDescriptors: number, children: object[] }} census.subagent
 *   - the child-log data source the main-log counts cannot reach.
 *     `mainLogDescriptorEvents` counts `subagent/descriptor` events in the MAIN
 *     log itself (the current host writes them into the child log, so this is
 *     usually 0); `supportedDescriptors` sums the per-child counts below, i.e.
 *     it counts DESCRIPTOR EVENTS, not child sessions — one child may fold its
 *     identity from a single descriptor while logging several.
 * @property {{ sessionId: string | undefined, parentSession: string | undefined, delegationDepth: number | undefined, descriptorEvents: number, supportedDescriptors: number, label: string | undefined, mode: string | undefined, provider: string | undefined }[]} census.subagent.children
 *   - the accepted child logs, each with the identity `projectChild` folded
 *     from them; `descriptorEvents === 0` means the log states no identity at
 *     all, and a non-zero count with `supportedDescriptors === 0` means every
 *     descriptor was outside the supported version.
 * @property {Record<string, number>} census.projectionSkipped.children
 *   - `withoutIdentity` counts children that folded no identity field at all;
 *     `withoutLabel` counts children whose `label` is absent — the field the
 *     `subagent*Count` matchers match on, so those are the records whose
 *     zero-count assertions pass only because there was nothing to match.
 */
