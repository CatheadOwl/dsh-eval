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

/** Render the trace's call sequence for failure messages. */
function callList(trace) {
  const names = trace.toolCalls.map(call => call.name)
  return names.length === 0 ? '(no tool calls)' : `[${names.join(', ')}]`
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
      const callIds = new Set(
        trace.toolCalls.filter(call => nameMatches(matcher, call.name)).map(call => call.callId),
      )
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
