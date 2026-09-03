// Per-package config for the blueprint-propagated verify entries (consumer-
// owned; the entries themselves are byte-copies of the gate blueprint and are
// never edited here — change the blueprint, re-propagate).
export default {
  ownName: '@catheadowl/dsh-eval',
  devDepNonRegistryScopes: ['@catheadowl/'],
  layout: 'root',
  srcDirs: ['src', 'bin'],
  docsRoots: ['docs'],
  hostClosureCheck: false,
  rulesSeed: null,
  manifestFace: {
    docsRoots: ['docs'],
    // Facade exports consumed via the CLIs or as runner internals: consumers
    // write cases and matchers, not runners — exempt from the docs drift
    // guard.
    internalExports: [
      'runEvalCase', 'buildOverlayYaml', 'looksLikeDshRepo', 'stageProfileStore', 'FRAMEWORK_ROOT',
      'parseSessionLog', 'buildTrace', 'loadTraceDir',
      'createDshHeadlessReviewExecutor', 'resolveDshCli', 'runDshReviewExperiment',
      'validateToolBoundary', 'renderToolBoundaryEvidence',
    ],
  },
}
