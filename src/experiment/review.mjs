/**
 * Model-independent review experiment primitives.
 *
 * A review experiment separates four concerns:
 * - frozen inputs owned by the plugin;
 * - live observation/projection of those inputs;
 * - the blind prompt shown to an independent reviewer;
 * - the hidden human rubric used after the run.
 *
 * Nothing in this module knows how a model is invoked. Callers provide an
 * executor (dsh headless is one adapter) when they want to run the assembled
 * task.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OBSERVATIONS_PLACEHOLDER = '{{EVAL_OBSERVATIONS}}'

/** Define and validate a human-graded review experiment. */
export function defineReviewExperiment(definition) {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError('review experiment must be an object')
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(definition.id ?? '')) {
    throw new TypeError('review experiment id must be a non-empty path-safe string')
  }
  if (typeof definition.prompt !== 'string' || definition.prompt.split(OBSERVATIONS_PLACEHOLDER).length !== 2) {
    throw new TypeError(`review experiment '${definition.id}': prompt must contain exactly one ${OBSERVATIONS_PLACEHOLDER}`)
  }
  if (typeof definition.observe !== 'function') {
    throw new TypeError(`review experiment '${definition.id}': observe must be a function`)
  }
  if (!(typeof definition.rubric === 'string' || definition.rubric instanceof URL)) {
    throw new TypeError(`review experiment '${definition.id}': rubric must identify the hidden grading standard`)
  }
  const defaultRuns = definition.defaultRuns ?? 3
  if (!Number.isInteger(defaultRuns) || defaultRuns < 1) {
    throw new TypeError(`review experiment '${definition.id}': defaultRuns must be a positive integer`)
  }
  return Object.freeze({
    ...definition,
    kind: 'review',
    defaultRuns,
  })
}

/** Render the standard observation document consumed by a blind reviewer. */
export function renderObservationSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new TypeError('review observations must contain at least one section')
  }
  const lines = []
  for (const section of sections) {
    if (typeof section?.heading !== 'string' || section.heading.length === 0) {
      throw new TypeError('every observation section needs a heading')
    }
    lines.push(`## ${section.heading}`)
    if (section.introduction) lines.push(String(section.introduction), '')
    for (const entry of section.entries ?? []) {
      if (typeof entry?.heading !== 'string' || entry.heading.length === 0) {
        throw new TypeError(`section '${section.heading}' contains an entry without a heading`)
      }
      lines.push(`### ${entry.heading}`)
      for (const paragraph of entry.paragraphs ?? []) lines.push(String(paragraph))
      if (entry.call !== undefined) lines.push(`Call: ${JSON.stringify(entry.call)}`)
      if (entry.json !== undefined) {
        lines.push('```json', JSON.stringify(entry.json, null, 2), '```')
      }
      lines.push('')
    }
  }
  return lines.join('\n').trimEnd()
}

/** Materialize live observations and assemble the blind reviewer task. */
export async function materializeReviewExperiment(experiment) {
  const sections = await experiment.observe()
  const observations = renderObservationSections(sections)
  return {
    experimentId: experiment.id,
    observations,
    task: experiment.prompt.replace(OBSERVATIONS_PLACEHOLDER, observations),
  }
}

/**
 * Execute the same materialized task through N fresh executor calls.
 * The executor is intentionally generic: `(task, context) => result`.
 */
export async function executeReviewExperiment(experiment, executor, options = {}) {
  if (typeof executor !== 'function') throw new TypeError('review executor must be a function')
  const runs = options.runs ?? experiment.defaultRuns
  if (!Number.isInteger(runs) || runs < 1) throw new TypeError('runs must be a positive integer')

  // Observe once. Every reviewer sees byte-identical evidence, so variance is
  // attributable to interpretation rather than fixture/projection drift.
  const materialized = await materializeReviewExperiment(experiment)
  const attempts = []
  for (let index = 1; index <= runs; index += 1) {
    try {
      const result = await executor(materialized.task, {
        experiment,
        experimentId: experiment.id,
        index,
        runs,
      })
      attempts.push({ index, ok: true, result })
    } catch (error) {
      attempts.push({
        index,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        result: error?.result,
      })
    }
  }
  return { ...materialized, runs, attempts }
}

export { OBSERVATIONS_PLACEHOLDER }

/**
 * Resolve the hidden grading standard into text for the judge pass.
 *
 * The rubric identifier on the experiment definition may be a filesystem
 * path (single-line string naming an existing file), a `file:` URL, or an
 * inline rubric string. Non-file URL protocols are refused loudly: the judge
 * pass must not depend on network fetch semantics.
 */
export function loadRubricText(rubric) {
  if (rubric instanceof URL) {
    if (rubric.protocol !== 'file:') {
      throw new TypeError(`review judge: rubric URL protocol '${rubric.protocol}' is not supported (file: only)`)
    }
    return readFileSync(fileURLToPath(rubric), 'utf8')
  }
  const text = String(rubric)
  if (!text.includes('\n') && existsSync(text)) return readFileSync(text, 'utf8')
  return text
}

/** Section headings the judge output contract requires (exact lines). */
export const JUDGE_OUTPUT_SECTIONS = ['Verdicts', 'Intentional design hits', 'New red flags', 'Next step']

/**
 * Assemble the machine first-pass grading task (EVAL-033).
 *
 * One dispatch sees everything a human grader would: the hidden answer key
 * (which the blind reviewers never saw), the byte-identical observations they
 * answered from, and every successful reviewer's answer. The output contract
 * is four fixed headings so the framework can parse the prefill; the judge is
 * the instrument, the human columns above it stay the authoritative record.
 */
export function buildJudgeTask({ rubricText, observations, answers }) {
  if (typeof rubricText !== 'string' || rubricText.trim() === '') {
    throw new TypeError('review judge: rubricText must be non-empty')
  }
  if (typeof observations !== 'string' || observations.trim() === '') {
    throw new TypeError('review judge: observations must be non-empty')
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new TypeError('review judge: answers must be a non-empty array of reviewer answers')
  }
  const runs = answers.map((answer, index) => `### run ${index + 1}\n${String(answer).trim()}`).join('\n\n')
  const headings = JUDGE_OUTPUT_SECTIONS.map(name => `## ${name}`).join('\n')
  return [
    'You are the grading pass of a plugin-output comprehension review.',
    `${answers.length} independent reviewer(s) (fresh models) answered the same blind task.`,
    'Grade their answers against the answer key below, then prefill the report columns.',
    'You see the answer key; the reviewers did not.',
    '',
    '## Answer key (hidden grading standard — the reviewers never saw this)',
    '',
    rubricText.trim(),
    '',
    '## Observations (the byte-identical evidence every reviewer saw)',
    '',
    observations.trim(),
    '',
    '## Reviewer answers',
    '',
    runs,
    '',
    '## Required output format — use exactly these four headings, in this order',
    '',
    headings,
    '',
    'Verdicts: per reviewer run, which rubric criteria are understood / missed / uncertain,',
    'quoting the reviewer\'s words as evidence; note agreement and divergence across runs.',
    'Intentional design hits: reviewer flags that match the answer key\'s intentional /',
    'accepted-design list — cite the run number, quote the flag, name the list item.',
    'New red flags: flags NOT covered by the rubric or the intentional list — the actual',
    'findings; annotate each with suspected source: fixture | design | unclear.',
    'Next step: pick one — change plugin output / change rubric / add a behavior case /',
    'no action — with a one-line reason.',
    'Output only these four sections.',
  ].join('\n')
}

/**
 * Parse the judge output against the four-heading contract.
 *
 * Returns `{ status: 'judged', sections }` where `sections` maps each heading
 * name to its body text, or `{ status: 'unparsed', missing }` naming every
 * absent heading — a judge output that does not follow the contract is
 * recorded as unread, never treated as a pass (EVAL-021 discipline: what was
 * not verified must look unverified).
 */
export function parseJudgeOutput(raw) {
  const text = String(raw ?? '')
  const missing = []
  const sections = {}
  for (const name of JUDGE_OUTPUT_SECTIONS) {
    const start = text.indexOf(`## ${name}`)
    if (start === -1) {
      missing.push(name)
      continue
    }
    const bodyStart = text.indexOf('\n', start) + 1
    let end = text.length
    for (const other of JUDGE_OUTPUT_SECTIONS) {
      if (other === name) continue
      const otherStart = text.indexOf(`## ${other}`, bodyStart)
      if (otherStart !== -1 && otherStart < end) end = otherStart
    }
    sections[name] = text.slice(bodyStart, end).trim()
  }
  if (missing.length > 0) return { status: 'unparsed', missing }
  return { status: 'judged', sections }
}

/**
 * Run the machine first-pass judge through the same executor that ran the
 * reviewers (one dispatch; the judge sees the rubric, the observations, and
 * every successful answer). Judge failures and unparsed output are statuses,
 * not exceptions: the verdict is evidence and never gates the exit code.
 */
export async function executeReviewJudge(experiment, executor, { observations, answers }) {
  const rubricText = loadRubricText(experiment.rubric)
  const task = buildJudgeTask({ rubricText, observations, answers })
  const result = await executor(task, { experiment, experimentId: experiment.id, judgePass: true })
  const raw = result.answer ?? result.stdout ?? ''
  const parsed = parseJudgeOutput(raw)
  return { task, raw, parsed, judgedAt: new Date().toISOString() }
}
