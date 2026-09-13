/**
 * The official programmatic evaluation entry for a case's matcher set.
 *
 * `runEvalCase` executes a case but does NOT evaluate `expect` — matcher
 * aggregation lives in the behavior CLI, so programmatic consumers building
 * their own drivers used to face a tier seam: hand-rolling the `.check(trace)`
 * loop bypassed the evidence-anchor enforcement inside `runEvalCase`. This
 * entry closes that seam by running the same loop WITH the anchor rule
 * inlined, so going programmatic cannot quietly drop the guard.
 */
import { validateEvidenceAnchor } from './discovery.mjs'

/**
 * Evaluate a case's `expect` set against a trace, enforcing the evidence
 * anchor first. Mirrors the behavior CLI's matcher loop: every matcher's
 * `check(trace)` runs, failures collect as `<describe>: <message>` strings.
 * @param {object} evalCase - the case whose `expect` is evaluated (also read
 *   for the anchor rule — its `inspect` declaration and negative matchers).
 * @param {object} trace - the projected trace (from `collectSessionTrace`).
 * @param {string} [label] - error/failure context (defaults to `case '<id>'`).
 * @returns {{ ok: boolean, failures: string[] }} ok is false when any matcher
 *   failed.
 * @throws when `trace` is undefined (a missing trace is a named failure the
 *   CALLER must record — evaluating matchers against nothing is how
 *   "nothing was measured" gets dressed up as "all green") or when the case
 *   has no evidence anchor (see `validateEvidenceAnchor`).
 */
export function evaluateMatchers(evalCase, trace, label = `case '${evalCase?.id}'`) {
  if (trace === undefined || trace === null) {
    throw new Error(`${label}: cannot evaluate matchers without a trace — treat a missing trace as a named failure (carry the trace gap), never as all-green`)
  }
  if (!Array.isArray(evalCase?.expect)) {
    throw new Error(`${label}: evaluateMatchers needs a case with an expect array`)
  }
  validateEvidenceAnchor(evalCase.expect, label, evalCase)
  const failures = []
  for (const matcher of evalCase.expect) {
    const outcome = matcher.check(trace)
    if (!outcome.ok) failures.push(`${matcher.describe}: ${outcome.message}`)
  }
  return { ok: failures.length === 0, failures }
}
