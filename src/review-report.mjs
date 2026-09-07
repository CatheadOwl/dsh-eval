/**
 * Human-graded review report renderer (product-review P4).
 *
 * A review experiment's value lives in the HUMAN judgment applied after the
 * runs: which reviewer flags are already-accepted trade-offs (intentional
 * design), which are new red flags, and what to do next. Without a stable
 * output shape that judgment stays ephemeral — "asking a model ad hoc" —
 * and cannot be archived, compared across rounds, or audited by a third
 * party.
 *
 * This renderer fills every machine-knowable field (experiment, adapter,
 * profile, run count, observations fingerprint, rubric identity, each
 * reviewer's verbatim answer) and leaves three explicit human sections as
 * checklists. It deliberately does NOT score or summarize the answers:
 * compressing fresh-model output into an automatic verdict would fake the
 * very judgment this layer exists to preserve (product-review risk R3).
 */

import { createHash } from 'node:crypto'

/** Short hex fingerprint of the materialized observations (byte-stable). */
export function observationsFingerprint(observations) {
  return createHash('sha256').update(observations, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Render the review report markdown.
 *
 * @param {object} parts
 * @param {object} parts.experiment - the frozen definition (id, summary, rubric).
 * @param {object} [parts.result] - executeReviewExperiment output; absent for a
 *   dry run (no reviewer was invoked).
 * @param {string} [parts.observations] - the materialized observations text,
 *   when available outside `result` (dry run).
 * @param {string} [parts.adapter] - adapter label (e.g. 'dsh-headless'); absent
 *   for a dry run.
 * @param {string} [parts.profile] - the profile the reviewers ran under.
 * @returns {string} markdown report.
 */
export function renderReviewReport(parts) {
  const { experiment } = parts
  const result = parts.result
  const dry = result === undefined
  const observations = parts.observations ?? result?.observations ?? ''
  const rubric = experiment.rubric instanceof URL
    ? experiment.rubric.href
    : String(experiment.rubric)
  const lines = []
  lines.push(`# Review report — ${experiment.id}`)
  lines.push('')
  if (experiment.summary) lines.push(`> ${experiment.summary}`)
  lines.push('')
  lines.push(`- experiment: \`${experiment.id}\``)
  lines.push(`- adapter: ${parts.adapter ?? 'none (dry run)'}`)
  if (parts.profile !== undefined) lines.push(`- profile: \`${parts.profile}\``)
  lines.push(`- runs: ${dry ? '0 (dry run — observations materialized only)' : result.runs}`)
  lines.push(`- observations: \`observations.md\` (sha256:${observationsFingerprint(observations)})`)
  lines.push(`- rubric: ${rubric.includes('\n') ? '(inline string — see experiment definition)' : `\`${rubric}\``}`)
  lines.push('')

  lines.push('## Reviewer conclusions')
  lines.push('')
  if (dry) {
    lines.push('_Dry run: no reviewer was invoked. Verify the materialized observations look right, then run for real._')
    lines.push('')
  } else {
    for (const attempt of result.attempts) {
      if (attempt.ok) {
        lines.push(`### run ${attempt.index} — ok`)
        lines.push('')
        // The answer, not the raw final message: adapters derive an
        // answer that survives tail interactions (gate splices); stdout
        // is the fallback for executors without trace-derived answers.
        lines.push('```text', (attempt.result?.answer ?? attempt.result?.stdout ?? '').trimEnd(), '```')
        // Traceability: the grader can always recover the full conversation
        // from the persisted per-run artifacts.
        lines.push('')
        lines.push(`- transcript: \`run-${attempt.index}.stderr.txt\`${attempt.result?.answer !== undefined && attempt.result.answer !== attempt.result.stdout ? ' (answer differs from the final message — see `run-' + attempt.index + '.stdout.txt`)' : ''}`)
      } else {
        lines.push(`### run ${attempt.index} — FAIL`)
        lines.push('')
        lines.push('```text', String(attempt.error).trimEnd(), '```')
      }
      lines.push('')
    }
  }

  lines.push('## Intentional design hits (human judgment)')
  lines.push('')
  lines.push('Reviewer flags that match an already-accepted trade-off. Cite the run and quote the flag.')
  lines.push('')
  lines.push('- [ ] ')
  lines.push('')
  lines.push('## New red flags (human judgment)')
  lines.push('')
  lines.push('Flags NOT covered by the rubric or the intentional-design list. These are the actual findings.')
  lines.push('')
  lines.push('- [ ] ')
  lines.push('')
  lines.push('## Next step (pick one)')
  lines.push('')
  lines.push('- [ ] change plugin output')
  lines.push('- [ ] change rubric')
  lines.push('- [ ] add / adjust a behavior case')
  lines.push('- [ ] no action (record why)')
  lines.push('')
  return lines.join('\n')
}
