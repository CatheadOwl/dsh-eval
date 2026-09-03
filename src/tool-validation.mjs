/**
 * Post-run tool boundary validation for blind review.
 *
 * After a review run completes, this module inspects the session trace's
 * `request/header` events to verify that no unexpected tools were mounted
 * in the reviewer's session.  This is the detection half of the
 * sterile-profile strategy: the profile prevents plugin tools from being
 * installed, the overlay disables every host tool row, and this check
 * makes any residual drift (a bundle leaking tools through a patch, a host
 * regression, a misconfigured profile) an explicit adapter failure.
 *
 * The module is intentionally pure: it takes an already-parsed trace and
 * returns a plain result object.  File I/O (reading the session log,
 * writing evidence) stays in the calling adapter.
 */

/**
 * Collect every distinct tool name mounted across all `request/header`
 * events in a trace.
 * @param {import('./trace.mjs').EvalTrace} trace
 * @returns {string[]} sorted tool names.
 */
function collectMountedToolNames(trace) {
  const names = new Set()
  for (const header of trace.requestHeaders ?? []) {
    for (const name of header.toolNames ?? []) {
      names.add(name)
    }
  }
  return [...names].sort()
}

/**
 * Check a review trace for tool leakage.
 *
 * Every tool name appearing in any `request/header` event is compared
 * against the allowed set.  An empty allowed set (the review default)
 * means the reviewer must see no tools at all.
 *
 * @param {import('./trace.mjs').EvalTrace | undefined} trace - the parsed trace; `undefined` skips validation.
 * @param {{ allowedTools?: Set<string> }} [options]
 * @returns {{ ok: boolean, unexpected: string[], actual: string[], allowed: string[] }}
 */
export function validateToolBoundary(trace, options = {}) {
  const allowed = options.allowedTools ?? new Set()
  const allowedNames = [...allowed].sort()
  if (trace === undefined || trace === null) {
    return { ok: true, unexpected: [], actual: [], allowed: allowedNames }
  }
  const actual = collectMountedToolNames(trace)
  const unexpected = actual.filter(name => !allowed.has(name))
  return {
    ok: unexpected.length === 0,
    unexpected,
    actual,
    allowed: allowedNames,
  }
}

/**
 * Render a diagnostic evidence document for a tool boundary failure.
 * Suitable for writing to `.runs/<id>/tool-boundary-evidence.json`.
 *
 * @param {{ ok: boolean, unexpected: string[], actual: string[], allowed: string[] }} validation
 * @param {{ runDir: string, profile: string }} context
 * @returns {string}
 */
export function renderToolBoundaryEvidence(validation, context) {
  return JSON.stringify({
    status: 'tool-boundary-violation',
    runDir: context.runDir,
    profile: context.profile,
    unexpectedTools: validation.unexpected,
    actualMounted: validation.actual,
    allowedTools: validation.allowed,
  }, null, 2) + '\n'
}
