/**
 * The eval mock-LLM adapter, loaded as a Cordis plugin through the eval
 * overlay (`name: file://...` insert). It registers the keyless `eval-mock`
 * provider and replays a scripted StreamChunk sequence: one script step per
 * model call, so a case controls exactly which tool calls and final text the
 * "model" produces. Pattern precedent:
 * deepseek-harness/examples/headless-agent/tests/fixtures/cli-mock-llm.ts.
 *
 * Deterministic layer purpose: verify the eval runner/trace/assertion
 * pipeline without an API key, and drive the plugin's tool execution path
 * (a scripted tool call runs through the real tool pipeline).
 */

import { readFileSync } from 'node:fs'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Environment variable pointing at this run's mock script JSON. */
const SCRIPT_ENV = 'DSH_EVAL_MOCK_SCRIPT'

/** Adapter that yields one scripted chunk list per stream() call. */
class EvalMockAdapter extends LlmAdapter {
  constructor(script) {
    super()
    this.steps = script.steps ?? []
    this.cursor = 0
  }

  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
        ],
        defaultEffort: 'off',
      },
    }
  }

  async * stream(_options) {
    const step = this.steps[this.cursor]
    this.cursor += 1
    if (step === undefined) {
      // Script exhausted: finish the loop loudly-but-gracefully so the run
      // still produces a trace a case can assert on.
      const text = `eval-mock: script exhausted after ${this.cursor - 1} step(s)`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    for (const chunk of step) yield chunk
  }
}

export const name = 'eval-mock-llm'

export const inject = ['llm']

/** Register the `eval-mock` adapter from the scripted run. */
export function apply(ctx) {
  const scriptPath = process.env[SCRIPT_ENV]
  if (scriptPath === undefined) {
    throw new Error(`eval-mock-llm: ${SCRIPT_ENV} must point at the run's mock script JSON`)
  }
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'))
  ctx.llm.registerAdapter(['eval-mock'], new EvalMockAdapter(script))
}
