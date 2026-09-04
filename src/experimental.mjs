/**
 * Escape-hatch entry: mechanism primitives for ad-hoc diagnostic scripts and
 * self-built execution faces. Reachable as `<pkg>/experimental`.
 *
 * Contract: NO compatibility promise — symbols here may change or move in
 * any minor release. The stable surface for eval/review case authors is the
 * package root entry (src/index.mjs); import from here only when you are
 * building your own runner/driver and accept the follow-up cost.
 */

// --- host CLI resolution (modern three-segment chain) ---
export { resolveDshCliChain } from './cli.mjs'

// --- sandbox / overlay mechanism ---
export { stageProfileStore } from './sandbox.mjs'
export { buildOverlayYaml, overlayDisableRows } from './overlay.mjs'

// --- session-trace primitives ---
export { parseSessionLog, buildTrace, loadTraceDir } from './trace.mjs'

// --- review experiment execution layer ---
export {
  executeReviewExperiment,
  materializeReviewExperiment,
  renderObservationSections,
  OBSERVATIONS_PLACEHOLDER,
} from './experiment/review.mjs'

// --- dsh review executors ---
export {
  createDshHeadlessReviewExecutor,
  runDshReviewExperiment,
} from './adapters/dsh/review.mjs'

// --- tool-boundary validation ---
export {
  validateToolBoundary,
  renderToolBoundaryEvidence,
} from './tool-validation.mjs'
