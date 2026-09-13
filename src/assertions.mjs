/**
 * Trace matchers for dsh agent eval. Every factory returns a matcher:
 * `{ describe, check(trace) -> { ok, message } }` — a pure function over an
 * `EvalTrace` (see trace.mjs), so matchers unit-test without any dsh run.
 * Intent tests assert tool SELECTION over final text: model wording varies,
 * tool choice is the contract under test.
 */

/** Render a name matcher for diagnostics. */
function describeMatcher(matcher) {
  return matcher instanceof RegExp ? String(matcher) : `'${matcher}'`
}

/** Whether a tool name satisfies a matcher (exact string or RegExp). */
function nameMatches(matcher, name) {
  return matcher instanceof RegExp ? matcher.test(name) : name === matcher
}

/**
 * Whether a message `source` satisfies a source matcher. A string or RegExp
 * matches `source.plugin` (the producer name — e.g. `'gates'` for steer);
 * a function receives the full `source` object (for `kind`-based matching).
 */
function sourceMatches(matcher, source) {
  if (typeof matcher === 'function') return matcher(source) === true
  const plugin = source?.plugin
  if (matcher instanceof RegExp) return typeof plugin === 'string' && matcher.test(plugin)
  return plugin === matcher
}

/** Render a source matcher for diagnostics. */
function describeSource(matcher) {
  if (typeof matcher === 'function') return '<source predicate>'
  return describeMatcher(matcher)
}

/** Render the trace's call sequence for failure messages. */
function callList(trace) {
  const names = trace.toolCalls.map(call => call.name)
  return names.length === 0 ? '(no tool calls)' : `[${names.join(', ')}]`
}

/**
 * Collect the tool results paired with calls matching `matcher`.
 * @returns {{ callIds: Set<string>, results: object[] }}
 *   `callIds` is empty when no call satisfies `matcher`;
 *   `results` is the subset of `trace.toolResults` paired with those calls.
 */
function resultsForMatcher(matcher, trace) {
  const callIds = new Set(
    trace.toolCalls.filter(call => nameMatches(matcher, call.name)).map(call => call.callId),
  )
  const results = callIds.size === 0
    ? []
    : trace.toolResults.filter(r => callIds.has(r.callId))
  return { callIds, results }
}

/** Truncate a string for diagnostics. */
function truncate(text, max = 200) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** A tool matching `matcher` was called at least once. */
export function toolCalled(matcher) {
  return {
    describe: `tool called: ${describeMatcher(matcher)}`,
    check(trace) {
      const hit = trace.toolCalls.some(call => nameMatches(matcher, call.name))
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `expected a ${describeMatcher(matcher)} call; saw ${callList(trace)}` }
    },
  }
}

/** No tool matching `matcher` was ever called. */
export function toolNotCalled(matcher) {
  return {
    describe: `tool not called: ${describeMatcher(matcher)}`,
    check(trace) {
      const hit = trace.toolCalls.find(call => nameMatches(matcher, call.name))
      return hit === undefined
        ? { ok: true, message: '' }
        : { ok: false, message: `expected no ${describeMatcher(matcher)} call; saw one at seq ${hit.seq}` }
    },
  }
}

/** The FIRST tool call matches `matcher`. */
export function firstTool(matcher) {
  return {
    describe: `first tool is: ${describeMatcher(matcher)}`,
    check(trace) {
      const first = trace.toolCalls[0]
      if (first === undefined) {
        return { ok: false, message: `expected first tool ${describeMatcher(matcher)}; the run made no tool calls` }
      }
      return nameMatches(matcher, first.name)
        ? { ok: true, message: '' }
        : { ok: false, message: `expected first tool ${describeMatcher(matcher)}; first was '${first.name}'` }
    },
  }
}

/**
 * The expected names appear as an ORDERED SUBSEQUENCE of the call sequence
 * (other calls may interleave). `names` entries are matchers.
 */
export function toolSequence(names) {
  return {
    describe: `tool sequence: ${names.map(describeMatcher).join(' -> ')}`,
    check(trace) {
      let cursor = 0
      for (const call of trace.toolCalls) {
        const expected = names[cursor]
        if (expected !== undefined && nameMatches(expected, call.name)) cursor += 1
      }
      return cursor === names.length
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `expected subsequence ${names.map(describeMatcher).join(' -> ')}; `
              + `stalled at ${describeMatcher(names[cursor])}; saw ${callList(trace)}`,
          }
    },
  }
}

/**
 * One call of `matcher` satisfies `match` on its arguments: an object checks
 * a shallow subset of the parsed JSON arguments; a function receives
 * `(parsedArguments, rawArguments)` and returns a boolean.
 */
export function toolCallArgs(matcher, match) {
  return {
    describe: `tool ${describeMatcher(matcher)} arguments match`,
    check(trace) {
      const calls = trace.toolCalls.filter(call => nameMatches(matcher, call.name))
      if (calls.length === 0) {
        return { ok: false, message: `expected a ${describeMatcher(matcher)} call to inspect; saw ${callList(trace)}` }
      }
      const satisfied = calls.some(call => {
        if (typeof match === 'function') return match(call.parsedArguments, call.arguments) === true
        const parsed = call.parsedArguments
        if (parsed === null || typeof parsed !== 'object') return false
        return Object.entries(match).every(
          ([key, value]) => JSON.stringify(parsed[key]) === JSON.stringify(value),
        )
      })
      return satisfied
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `no ${describeMatcher(matcher)} call matched the argument predicate; `
              + `arguments seen: ${calls.map(call => call.arguments).join(' | ')}`,
          }
    },
  }
}

/** The call matching `matcher` has a paired `tool/result` in the trace. */
export function toolResultFor(matcher) {
  return {
    describe: `tool result present for: ${describeMatcher(matcher)}`,
    check(trace) {
      const { callIds } = resultsForMatcher(matcher, trace)
      if (callIds.size === 0) {
        return { ok: false, message: `expected a ${describeMatcher(matcher)} call; saw ${callList(trace)}` }
      }
      const hit = trace.toolResults.some(result => callIds.has(result.callId))
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `${describeMatcher(matcher)} was called but no tool/result arrived for it` }
    },
  }
}

/**
 * A call matching `matcher` produced a tool result with `isError === true`.
 * Fails when the tool was never called, never received a result, or every
 * result was a success.
 */
export function toolResultIsError(matcher) {
  return {
    describe: `tool result isError: ${describeMatcher(matcher)}`,
    check(trace) {
      const { callIds, results } = resultsForMatcher(matcher, trace)
      if (callIds.size === 0) {
        return { ok: false, message: `expected a ${describeMatcher(matcher)} call; saw ${callList(trace)}` }
      }
      if (results.length === 0) {
        return { ok: false, message: `${describeMatcher(matcher)} was called but no tool/result arrived for it` }
      }
      const hit = results.some(r => r.isError === true)
      return hit
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `expected ${describeMatcher(matcher)} to produce an error result; `
              + `saw isError: [${results.map(r => String(r.isError)).join(', ')}]`,
          }
    },
  }
}

/**
 * A call matching `matcher` produced a tool result with `isError` NOT true
 * (i.e. `false` or `undefined` — treated as success).
 */
export function toolResultSucceeded(matcher) {
  return {
    describe: `tool result succeeded: ${describeMatcher(matcher)}`,
    check(trace) {
      const { callIds, results } = resultsForMatcher(matcher, trace)
      if (callIds.size === 0) {
        return { ok: false, message: `expected a ${describeMatcher(matcher)} call; saw ${callList(trace)}` }
      }
      if (results.length === 0) {
        return { ok: false, message: `${describeMatcher(matcher)} was called but no tool/result arrived for it` }
      }
      const hit = results.some(r => r.isError !== true)
      return hit
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `expected ${describeMatcher(matcher)} to produce a success result; `
              + `all ${results.length} result(s) had isError: true`,
          }
    },
  }
}

/**
 * A call matching `matcher` produced a tool result whose text contains
 * `substring`. The text is the same projection used by `toolResultFor`
 * (concatenated inner text blocks of the tool-result wrapper).
 */
export function toolResultTextIncludes(matcher, substring) {
  return {
    describe: `tool result text includes: ${describeMatcher(matcher)} → '${substring}'`,
    check(trace) {
      const { callIds, results } = resultsForMatcher(matcher, trace)
      if (callIds.size === 0) {
        return { ok: false, message: `expected a ${describeMatcher(matcher)} call; saw ${callList(trace)}` }
      }
      if (results.length === 0) {
        return { ok: false, message: `${describeMatcher(matcher)} was called but no tool/result arrived for it` }
      }
      const hit = results.some(r => r.text.includes(substring))
      return hit
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `no ${describeMatcher(matcher)} result text includes '${substring}'; `
              + `texts seen: [${results.map(r => JSON.stringify(truncate(r.text))).join(', ')}]`,
          }
    },
  }
}

/** The final assistant text contains `substring`. */
export function finalTextIncludes(substring) {
  return {
    describe: `final text includes: '${substring}'`,
    check(trace) {
      const hit = trace.finalText.includes(substring)
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `final text does not include '${substring}'; final text: ${JSON.stringify(trace.finalText.slice(0, 400))}` }
    },
  }
}

/**
 * Any assembled assistant text contains `substring`. Unlike
 * `finalTextIncludes`, later turns cannot invalidate the assertion — blocking
 * gates that splice feedback after the script ends (turn-close hooks) push
 * their own trailing steps, so a scripted closing line may no longer be the
 * FINAL text even though the script delivered it.
 */
export function assistantTextIncludes(substring) {
  return {
    describe: `assistant text includes: '${substring}'`,
    check(trace) {
      const hit = trace.assistantTexts.some(text => text.includes(substring))
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `no assistant text includes '${substring}'; texts seen: [${trace.assistantTexts.map(t => JSON.stringify(t.slice(0, 120))).join(', ')}]` }
    },
  }
}

/** The final assistant text matches `regex`. */
export function finalTextMatches(regex) {
  return {
    describe: `final text matches: ${String(regex)}`,
    check(trace) {
      const hit = regex.test(trace.finalText)
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `final text does not match ${String(regex)}; final text: ${JSON.stringify(trace.finalText.slice(0, 400))}` }
    },
  }
}

/** The assembled system prompt of a request contains `substring`. */
export function systemPromptIncludes(substring) {
  return {
    describe: `system prompt includes: '${substring}'`,
    check(trace) {
      const headers = trace.requestHeaders
      if (headers.length === 0) {
        return { ok: false, message: 'expected a request/header event; the run produced none' }
      }
      const hit = headers.some(header => header.system.includes(substring))
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `no request/header system prompt contains '${substring}' (${headers.length} header(s) seen)` }
    },
  }
}

/** A tool named `matcher` is mounted in some request header (not merely called). */
export function toolMounted(matcher) {
  return {
    describe: `tool mounted: ${describeMatcher(matcher)}`,
    check(trace) {
      const headers = trace.requestHeaders
      if (headers.length === 0) {
        return { ok: false, message: 'expected a request/header event; the run produced none' }
      }
      const names = [...new Set(headers.flatMap(header => header.toolNames))]
      const hit = names.some(name => nameMatches(matcher, name))
      return hit
        ? { ok: true, message: '' }
        : { ok: false, message: `expected ${describeMatcher(matcher)} among mounted tools; saw [${names.join(', ')}]` }
    },
  }
}

/**
 * Whether a subagent child record satisfies a label matcher: string/RegExp
 * against the child's durable `label` (`subagent/descriptor`), or a predicate
 * over the full child record (mode/provider/delegationDepth-based matching).
 * A child without a label never satisfies a string/RegExp matcher.
 */
function childMatches(matcher, child) {
  if (typeof matcher === 'function') return matcher(child) === true
  if (child.label === undefined) return false
  return matcher instanceof RegExp ? matcher.test(child.label) : child.label === matcher
}

/** Render the label list of a trace's subagent children for diagnostics. */
function childLabelList(trace) {
  const labels = trace.subagentChildren.map(child => child.label ?? '<unlabeled>')
  return labels.length === 0 ? '(no subagent children)' : `[${labels.join(', ')}]`
}

/** At least one subagent child was dispatched with a matching label. */
export function subagentDispatched(matcher) {
  return {
    describe: `subagent dispatched: ${describeMatcher(matcher)}`,
    check(trace) {
      const hit = trace.subagentChildren.some(child => childMatches(matcher, child))
      return hit
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `expected a dispatched subagent matching ${describeMatcher(matcher)}; `
              + `saw ${childLabelList(trace)}`,
          }
    },
  }
}

/**
 * A subagent child with a matching label ran to an answer: its own session
 * log holds at least one non-empty assistant text. Dispatch alone (the child
 * log exists but produced nothing) does not satisfy this matcher.
 */
export function subagentCompleted(matcher) {
  return {
    describe: `subagent completed: ${describeMatcher(matcher)}`,
    check(trace) {
      const children = trace.subagentChildren.filter(child => childMatches(matcher, child))
      if (children.length === 0) {
        return {
          ok: false,
          message: `expected a dispatched subagent matching ${describeMatcher(matcher)}; `
            + `saw ${childLabelList(trace)}`,
        }
      }
      const hit = children.some(child => child.finalText !== '')
      return hit
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `${describeMatcher(matcher)} was dispatched but produced no assistant text`,
          }
    },
  }
}

/**
 * A user message from a source matching `sourceMatcher` contains `substring`.
 * Source matcher: string/RegExp against `source.plugin`, or a predicate over
 * the full `source`. This is how a case asserts plugin steer — a `user/message`
 * with a plugin source — separately from the task prompt (`kind: 'user'`).
 */
export function userMessageTextIncludes(sourceMatcher, substring) {
  return {
    describe: `user message from ${describeSource(sourceMatcher)} includes: '${substring}'`,
    check(trace) {
      const messages = trace.userMessages.filter(message => sourceMatches(sourceMatcher, message.source))
      if (messages.length === 0) {
        return { ok: false, message: `expected a user message from ${describeSource(sourceMatcher)}; the run produced none` }
      }
      const hit = messages.some(message => message.text.includes(substring))
      return hit
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `no ${describeSource(sourceMatcher)} user message includes '${substring}'; `
              + `texts seen: [${messages.map(message => JSON.stringify(truncate(message.text))).join(', ')}]`,
          }
    },
  }
}

/**
 * No user message from a source matching `sourceMatcher` contains `substring`.
 * Passes vacuously when no such message exists — pair it with
 * `userMessageTextIncludes` to also prove the message arrived. This is the
 * "not steered on someone else's file" half of an isolation assertion.
 */
export function userMessageTextExcludes(sourceMatcher, substring) {
  return {
    describe: `user message from ${describeSource(sourceMatcher)} excludes: '${substring}'`,
    check(trace) {
      const messages = trace.userMessages.filter(message => sourceMatches(sourceMatcher, message.source))
      const hit = messages.find(message => message.text.includes(substring))
      return hit === undefined
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `a ${describeSource(sourceMatcher)} user message includes '${substring}': `
              + `${JSON.stringify(truncate(hit.text))}`,
          }
    },
  }
}

/**
 * Exactly `expected` subagent children matching the label matcher were
 * dispatched. The bounded-redispatch assertion ("one dispatch per turn, no
 * more") — pair with cross-turn driving (`followups`), where the count spans
 * every driven turn.
 */
export function subagentDispatchCount(matcher, expected) {
  return {
    describe: `subagent dispatch count: ${describeMatcher(matcher)} × ${expected}`,
    check(trace) {
      const count = trace.subagentChildren.filter(child => childMatches(matcher, child)).length
      return count === expected
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `expected ${expected} dispatched subagent(s) matching ${describeMatcher(matcher)}; `
              + `saw ${count} (${childLabelList(trace)})`,
          }
    },
  }
}

/**
 * Exactly `expected` subagent children matching the label matcher COMPLETED
 * (produced a non-empty assistant text). Unlike `subagentCompleted` (any one
 * suffices), this pins every dispatched child's outcome — "dispatched ⇒
 * observable outcome" for cross-turn cases where a truncated child must fail
 * the case even when its siblings finished.
 */
export function subagentCompletedCount(matcher, expected) {
  return {
    describe: `subagent completed count: ${describeMatcher(matcher)} × ${expected}`,
    check(trace) {
      const children = trace.subagentChildren.filter(child => childMatches(matcher, child))
      const completed = children.filter(child => child.finalText !== '')
      return completed.length === expected
        ? { ok: true, message: '' }
        : {
            ok: false,
            message: `expected exactly ${expected} completed subagent(s) matching ${describeMatcher(matcher)}; `
              + `saw ${completed.length} of ${children.length} dispatched `
              + `(${children.map(child => `${child.label ?? '<unlabeled>'}:${child.finalText !== '' ? 'done' : 'silent'}`).join(', ')})`,
          }
    },
  }
}
