/**
 * Session-trace parsing for dsh agent eval. The evidence source is the JSONL
 * session artifact written by `@deepseek-ai/dsh-session-persistence-jsonl`
 * (configured `compression: none`, `packChunks: false` by the eval overlay):
 * one `type: 'session'` header line, then one JSON record per `SessionEvent`.
 * Event shapes follow `deepseek-harness/packages/core/session/src/types.ts`
 * (`SessionEventMap`); packed `*-chunks` storage rows are tolerated and
 * skipped — they only carry `assistant/chunk` deltas eval never asserts on.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Storage row types that pack `assistant/chunk` delta runs (see chunk-rows.ts). */
const CHUNK_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

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

/** Best-effort parse of a tool call's raw JSON arguments string. */
function parseArguments(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Build one assertable trace from parsed session logs. Child sessions surface
 * only through the parent's tool events, so the MAIN log (no `origin:
 * 'subagent'` header) owns the tool/final-text projections; all logs stay
 * available under `sessions`.
 * @param {{ header: object, events: object[] }[]} logs - parsed session logs.
 * @returns {EvalTrace}
 */
export function buildTrace(logs) {
  const mains = logs.filter(log => log.header.origin !== 'subagent')
  const main = [...mains].sort((a, b) => b.events.length - a.events.length)[0]
  const events = main?.events ?? []

  const toolCalls = []
  const toolResults = []
  const assistantTexts = []
  for (const event of events) {
    if (event.type === 'tool/call') {
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
      })
    } else if (event.type === 'assistant/message') {
      const text = messageText(event.data.message)
      if (text !== '') assistantTexts.push(text)
    }
  }

  return {
    sessions: logs,
    sessionId: main?.header.id,
    toolCalls,
    toolResults,
    assistantTexts,
    finalText: assistantTexts.at(-1) ?? '',
  }
}

/** Recursively collect files named `name` under `dir`. */
function collectFiles(dir, name, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(path, name, out)
    else if (entry.name === name) out.push(path)
  }
  return out
}

/**
 * Load every session log under a persistence root and build one trace.
 * @param {string} sessionsRoot - the run's `session-persistence-jsonl` root.
 * @returns {EvalTrace | undefined} the trace, or `undefined` when no log materialized.
 */
export function loadTraceDir(sessionsRoot) {
  let files
  try {
    files = collectFiles(sessionsRoot, 'session.jsonl')
  } catch {
    return undefined
  }
  if (files.length === 0) return undefined
  const logs = files
    .map(file => readFileSync(file, 'utf8'))
    .map(parseSessionLog)
  return buildTrace(logs)
}

/**
 * @typedef {object} EvalTrace
 * @property {{ header: object, events: object[] }[]} sessions - every parsed log.
 * @property {string | undefined} sessionId - the main session's id.
 * @property {{ seq: number, turn: number, step: number, callId: string, name: string, arguments: string, parsedArguments: unknown }[]} toolCalls
 * @property {{ seq: number, turn: number, step: number, callId: string, text: string, error: object | undefined }[]} toolResults
 * @property {string[]} assistantTexts - non-empty assembled assistant messages, log order.
 * @property {string} finalText - the last assembled assistant text ('' when none).
 */
