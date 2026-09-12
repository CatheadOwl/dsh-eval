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

/**
 * Session format generations this parser accepts. Mirror of the generation
 * chain the vendored host ships codecs for
 * (`session-format-catalog/src/generated.ts`: codecs v0–v3,
 * `currentVersion: 3` = `SESSION_FORMAT_VERSION` in
 * `core/session/src/types.ts`). The projection is written and verified
 * against the current generation; older ones parse tolerantly. A stamp
 * outside this set means the host moved to a generation whose payload this
 * projection was never verified against — fail at the seam instead of
 * projecting empty fields, and bump this set only together with the
 * re-verification the docs' maintenance trigger describes.
 */
export const KNOWN_SESSION_FORMAT_VERSIONS = new Set([0, 1, 2, 3])

/** Known generations rendered for an error message: `v0, v1, v2, v3`. */
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
  let label
  let mode
  let provider
  for (const event of log.events) {
    if (event.type !== 'subagent/descriptor') continue
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    if (label !== undefined || mode !== undefined || provider !== undefined) break
    if (data.version !== 3) continue
    if (typeof data.label === 'string') label = data.label
    if (typeof data.mode === 'string') mode = data.mode
    if (typeof data.provider === 'string') provider = data.provider
  }
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
  const subagentChildren = logs
    .filter(log => log.header.origin === 'subagent' || log.header.parentSession !== undefined)
    .map(projectChild)

  const toolCalls = []
  const toolResults = []
  const assistantEntries = []
  const userMessages = []
  const requestHeaders = []
  for (const event of events) {
    if (event.type === 'request/header') {
      // The assembled model request header: system prompt + mounted tool
      // schemas. What the model is told it can do and how — the "did my
      // plugin's section inject?" projection.
      requestHeaders.push({
        seq: event.seq,
        reason: event.data?.reason,
        system: event.data?.header?.system ?? '',
        toolNames: Array.isArray(event.data?.header?.tools)
          ? event.data.header.tools.map(tool => tool?.name).filter(name => typeof name === 'string')
          : [],
      })
    } else if (event.type === 'tool/call') {
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

  return {
    sessions: logs,
    sessionId: main?.header.id,
    toolCalls,
    toolResults,
    assistantTexts,
    answerText,
    userMessages,
    requestHeaders,
    subagentChildren,
    finalText: assistantTexts.at(-1) ?? '',
  }
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
 * @property {{ seq: number, reason: string, system: string, toolNames: string[] }[]} requestHeaders
 *   - projected `request/header` events (assembled system prompt + mounted tools).
 * @property {{ sessionId: string | undefined, parentSession: string | undefined, delegationDepth: number | undefined, label: string | undefined, mode: string | undefined, provider: string | undefined, assistantTexts: string[], finalText: string }[]} subagentChildren
 *   - one record per subagent child log (`origin: 'subagent'` header, or a
 *     header carrying `parentSession`). Identity comes from the first
 *     version-3 `subagent/descriptor` event; `finalText` is the child's own
 *     last assistant text ('' when it produced none — dispatched but not
 *     answered).
 * @property {string} finalText - the last assembled assistant text ('' when none).
 */
