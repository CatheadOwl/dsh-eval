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
  toolResultIsError,
  toolResultSucceeded,
  toolResultTextIncludes,
  finalTextIncludes,
  finalTextMatches,
  assistantTextIncludes,
  systemPromptIncludes,
  toolMounted,
  userMessageTextIncludes,
  userMessageTextExcludes,
  subagentDispatched,
  subagentCompleted,
} from '../src/assertions.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const trace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'sample-session.jsonl'), 'utf8'))])
const headerTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'header-session.jsonl'), 'utf8'))])
const errorTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'error-session.jsonl'), 'utf8'))])
const steerTrace = buildTrace([parseSessionLog(readFileSync(join(FIXTURES, 'steer-session.jsonl'), 'utf8'))])
const subagentTrace = buildTrace([
  parseSessionLog(readFileSync(join(FIXTURES, 'packed-parent.jsonl'), 'utf8')),
  parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child.jsonl'), 'utf8')),
  parseSessionLog(readFileSync(join(FIXTURES, 'subagent-child-pending.jsonl'), 'utf8')),
])

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

describe('toolResultIsError', () => {
  it('passes when a matching call produced an error result', () => {
    assert.equal(toolResultIsError('bash').check(errorTrace).ok, true)
  })

  it('fails when matching calls all succeeded', () => {
    const outcome = toolResultIsError('read').check(errorTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /isError/)
  })

  it('fails when the tool was never called', () => {
    const outcome = toolResultIsError('nonexistent').check(errorTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /expected a/)
  })

  it('supports regex matchers', () => {
    assert.equal(toolResultIsError(/^bash$/).check(errorTrace).ok, true)
    assert.equal(toolResultIsError(/^read$/).check(errorTrace).ok, false)
  })

  it('fails when the call has no result', () => {
    const orphan = { ...errorTrace, toolResults: [] }
    const outcome = toolResultIsError('bash').check(orphan)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /no tool\/result arrived/)
  })
})

describe('toolResultSucceeded', () => {
  it('passes when a matching call produced a success result', () => {
    assert.equal(toolResultSucceeded('read').check(errorTrace).ok, true)
  })

  it('passes when isError is false (sample-session)', () => {
    assert.equal(toolResultSucceeded('coggit_status').check(trace).ok, true)
  })

  it('fails when all matching calls produced error results', () => {
    const outcome = toolResultSucceeded('bash').check(errorTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /isError: true/)
  })

  it('fails when the tool was never called', () => {
    const outcome = toolResultSucceeded('nonexistent').check(errorTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /expected a/)
  })
})

describe('toolResultTextIncludes', () => {
  it('passes when a matching result text contains the substring', () => {
    assert.equal(toolResultTextIncludes('bash', 'permission denied').check(errorTrace).ok, true)
    assert.equal(toolResultTextIncludes('read', 'file contents').check(errorTrace).ok, true)
  })

  it('fails when no matching result text contains the substring', () => {
    const outcome = toolResultTextIncludes('bash', 'success').check(errorTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /texts seen/)
  })

  it('fails when the tool was never called', () => {
    const outcome = toolResultTextIncludes('nonexistent', 'anything').check(errorTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /expected a/)
  })

  it('supports the existing sample trace', () => {
    assert.equal(toolResultTextIncludes('coggit_status', '3 tracked nodes').check(trace).ok, true)
    assert.equal(toolResultTextIncludes('coggit_add', 'created cognition').check(trace).ok, true)
  })

  it('fails when the call has no result', () => {
    const orphan = { ...errorTrace, toolResults: [] }
    const outcome = toolResultTextIncludes('bash', 'denied').check(orphan)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /no tool\/result arrived/)
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

describe('assistantTextIncludes', () => {
  it('matches a substring of any assistant text, including non-final ones', () => {
    // 'intermediate' appears in an earlier assistant text but not the final
    // one — the exact shape a turn-close gate splice produces.
    assert.equal(assistantTextIncludes('cognition created').check(trace).ok, true)
    assert.equal(assistantTextIncludes('intermediate').check(trace).ok, true)
  })

  it('fails with the observed texts when no assistant text matches', () => {
    const outcome = assistantTextIncludes('bash output').check(trace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /no assistant text includes/)
    assert.match(outcome.message, /texts seen/)
  })

  it('fails on an empty trace', () => {
    const outcome = assistantTextIncludes('anything').check(buildTrace([]))
    assert.equal(outcome.ok, false)
  })
})

describe('systemPromptIncludes', () => {
  it('matches a substring of any request header system prompt', () => {
    assert.equal(systemPromptIncludes('subagent_at tool when a task must run').check(headerTrace).ok, true)
    assert.equal(systemPromptIncludes('Use the read tool').check(headerTrace).ok, false)
  })

  it('fails with an explanation when no request/header event exists', () => {
    const outcome = systemPromptIncludes('anything').check(trace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /request\/header event/)
  })
})

describe('toolMounted', () => {
  it('matches a mounted tool name in the request header', () => {
    assert.equal(toolMounted('subagent_at').check(headerTrace).ok, true)
    assert.equal(toolMounted('bash').check(headerTrace).ok, false)
  })

  it('fails with an explanation when no request/header event exists', () => {
    const outcome = toolMounted('anything').check(trace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /request\/header event/)
  })
})

describe('userMessageTextIncludes', () => {
  it('matches a plugin-sourced user message by plugin name', () => {
    assert.equal(userMessageTextIncludes('gates', 'task-a.md').check(steerTrace).ok, true)
    assert.equal(userMessageTextIncludes('gates', 'task-b.md').check(steerTrace).ok, false)
  })

  it('does not match the task prompt (kind: user) when scoped to a plugin', () => {
    assert.equal(userMessageTextIncludes('gates', 'write task-a.md').check(steerTrace).ok, false)
  })

  it('supports regex and predicate source matchers', () => {
    assert.equal(userMessageTextIncludes(/^gate/, 'task-a.md').check(steerTrace).ok, true)
    assert.equal(userMessageTextIncludes(source => source.kind === 'user', 'write task-a.md').check(steerTrace).ok, true)
  })

  it('fails when no message from the source exists', () => {
    const outcome = userMessageTextIncludes('nonexistent', 'anything').check(steerTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /produced none/)
  })
})

describe('userMessageTextExcludes', () => {
  it('passes when no source message contains the substring', () => {
    assert.equal(userMessageTextExcludes('gates', 'task-b.md').check(steerTrace).ok, true)
  })

  it('fails when a source message contains the substring', () => {
    assert.equal(userMessageTextExcludes('gates', 'task-a.md').check(steerTrace).ok, false)
  })

  it('passes vacuously when no message from the source exists', () => {
    assert.equal(userMessageTextExcludes('nonexistent', 'anything').check(steerTrace).ok, true)
  })
})

describe('subagentDispatched', () => {
  it('matches child labels by exact string, regexp, and predicate', () => {
    assert.equal(subagentDispatched('gates:fix:doc-link').check(subagentTrace).ok, true)
    assert.equal(subagentDispatched(/^gates:fix:/).check(subagentTrace).ok, true)
    assert.equal(subagentDispatched(child => child.mode === 'one-shot' && child.delegationDepth === 1).check(subagentTrace).ok, true)
    assert.equal(subagentDispatched('gates:fix:missing').check(subagentTrace).ok, false)
  })

  it('lists observed labels on failure', () => {
    const outcome = subagentDispatched('other').check(subagentTrace)
    assert.match(outcome.message, /gates:fix:doc-link, gates:fix:coggit-misplaced/)
  })

  it('fails with no children at all', () => {
    const outcome = subagentDispatched(/^gates:/).check(trace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /no subagent children/)
  })
})

describe('subagentCompleted', () => {
  it('passes only for children that produced an answer text', () => {
    assert.equal(subagentCompleted('gates:fix:doc-link').check(subagentTrace).ok, true)
    assert.equal(subagentCompleted(/^gates:fix:doc/).check(subagentTrace).ok, true)
  })

  it('fails for a dispatched child that stayed silent', () => {
    const outcome = subagentCompleted('gates:fix:coggit-misplaced').check(subagentTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /produced no assistant text/)
  })

  it('fails when no matching child was dispatched at all', () => {
    const outcome = subagentCompleted('never-dispatched').check(subagentTrace)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /expected a dispatched subagent/)
  })
})
