// Per-package config for the verify entries in this directory (consumer-
// owned). The entries are managed copies, byte-identical across every
// consumer — never edited here; the workspace gate-blueprint-drift rejects
// divergence. All per-package differences live in this file only.
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
