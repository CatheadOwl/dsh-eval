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
    // The root facade is the stable SDK tier (matchers, step builders,
    // defineReviewExperiment, runEvalCase) — every export must be
    // documented, no exemptions. Mechanism primitives live behind
    // ./experimental with their own (package-owned) face gate.
    internalExports: [],
  },
}
