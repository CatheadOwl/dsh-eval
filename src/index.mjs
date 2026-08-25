/**
 * @catheadowl/dsh-eval public surface — what plugin eval cases import:
 * matchers for the `expect` list and mock-script step builders. The runner
 * and trace parser are bin/runner internals, also exported for ad-hoc use.
 */

export {
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
  systemPromptIncludes,
  toolMounted,
} from './assertions.mjs'

export { toolCallStep, textStep } from './mock/script.mjs'

export { runEvalCase, buildOverlayYaml, looksLikeDshRepo, stageProfileStore, FRAMEWORK_ROOT } from './runner.mjs'

export { parseSessionLog, buildTrace, loadTraceDir } from './trace.mjs'

export {
  defineReviewExperiment,
  executeReviewExperiment,
  materializeReviewExperiment,
  renderObservationSections,
  OBSERVATIONS_PLACEHOLDER,
} from './experiment/review.mjs'

export {
  createDshHeadlessReviewExecutor,
  resolveDshCli,
  runDshReviewExperiment,
} from './adapters/dsh/review.mjs'
