/**
 * @catheadowl/dsh-eval stable SDK surface — what eval/review case authors
 * import: assertion matchers, mock-script step builders, the review
 * experiment DSL, and the programmatic case runner.
 *
 * Mechanism primitives (sandbox/overlay/trace, review executors, CLI chain)
 * live behind the `./experimental` subpath with no compatibility promise;
 * everything else is bin-internal.
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
  assistantTextIncludes,
  systemPromptIncludes,
  toolMounted,
  userMessageTextIncludes,
  userMessageTextExcludes,
} from './assertions.mjs'

export { toolCallStep, textStep } from './mock/script.mjs'

export { runEvalCase } from './runner.mjs'

export { defineReviewExperiment } from './experiment/review.mjs'
