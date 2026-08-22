/**
 * Script builders for the eval mock-LLM layer. A mock script is
 * `{ steps: ChunkStep[] }` where each step is the exact StreamChunk list one
 * model call yields (its `finish` chunk included); the adapter consumes one
 * step per stream() call. Cases build steps with these helpers instead of
 * hand-writing chunk JSON.
 */

let autoId = 0

/** Next deterministic call id for generated steps. */
function nextCallId() {
  autoId += 1
  return `eval-mock-call-${autoId}`
}

/**
 * One model call that requests a single tool invocation, then finishes with
 * `kind: 'tool-calls'` so the loop executes the tool and calls back.
 * @param {string} name - the model-facing tool name to call.
 * @param {object} [args] - the tool arguments (serialized as the model's raw JSON).
 * @param {{ id?: string }} [options] - override the generated call id.
 */
export function toolCallStep(name, args = {}, options = {}) {
  const id = options.id ?? nextCallId()
  const json = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * One model call that answers plain text and stops the loop
 * (`kind: 'stop'`).
 * @param {string} text - the assistant reply.
 */
export function textStep(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}
