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
