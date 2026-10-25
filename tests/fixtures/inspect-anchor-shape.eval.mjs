/**
 * The corpus shape for the evidence-anchor rule: every assertion lives in
 * an inspect hook reading raw session events, so `expect` stays empty and
 * the explicit `evidence: 'inspect'` declaration is what vouches for the
 * case.
 */
import { textStep } from '../../src/index.mjs'

export default {
  id: 'inspect-anchor-shape-fixture',
  mode: 'mock',
  task: 'answer without touching any tool',
  evidence: 'inspect',
  script: { steps: [textStep('done')] },
  async inspect() {},
  expect: [],
}
