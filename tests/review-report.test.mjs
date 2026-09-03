import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { observationsFingerprint, renderReviewReport } from '../src/review-report.mjs'

const experiment = {
  id: 'my-output-comprehension',
  summary: 'Can a fresh model infer the next action?',
  rubric: '/repo/plugin/eval/comprehension/rubric.md',
}

describe('observationsFingerprint', () => {
  it('is byte-stable and short', () => {
    const a = observationsFingerprint('observations text')
    assert.equal(a, observationsFingerprint('observations text'))
    assert.equal(a.length, 16)
    assert.notEqual(a, observationsFingerprint('different text'))
  })
})

describe('renderReviewReport', () => {
  it('fills machine fields and leaves the three human sections as checklists', () => {
    const markdown = renderReviewReport({
      experiment,
      result: {
        runs: 2,
        observations: 'obs',
        attempts: [
          { index: 1, ok: true, result: { stdout: 'reviewer answer one' } },
          { index: 2, ok: false, error: 'dsh reviewer exited with code 1' },
        ],
      },
      adapter: 'dsh-headless',
      profile: 'headless',
    })
    assert.match(markdown, /# Review report — my-output-comprehension/)
    assert.match(markdown, /adapter: dsh-headless/)
    assert.match(markdown, /profile: `headless`/)
    assert.match(markdown, /runs: 2/)
    assert.match(markdown, /observations\.md` \(sha256:[0-9a-f]{16}\)/)
    assert.match(markdown, /rubric: `\/repo\/plugin\/eval\/comprehension\/rubric\.md`/)
    assert.match(markdown, /### run 1 — ok[\s\S]*reviewer answer one/)
    assert.match(markdown, /### run 2 — FAIL[\s\S]*dsh reviewer exited with code 1/)
    for (const section of ['Intentional design hits', 'New red flags', 'Next step']) {
      assert.match(markdown, new RegExp(`## ${section}`))
    }
    assert.match(markdown, /- \[ \] change plugin output/)
  })

  it('renders a dry-run report that marks zero runs and names no adapter', () => {
    const markdown = renderReviewReport({ experiment, observations: 'obs text' })
    assert.match(markdown, /adapter: none \(dry run\)/)
    assert.match(markdown, /runs: 0 \(dry run/)
    assert.match(markdown, /Dry run: no reviewer was invoked/)
    // the fingerprint reflects the materialized observations, not an empty string
    assert.ok(!markdown.includes(`sha256:${observationsFingerprint('')}`))
    assert.ok(markdown.includes(`sha256:${observationsFingerprint('obs text')}`))
  })

  it('labels inline-string rubrics without dumping the rubric body', () => {
    const markdown = renderReviewReport({
      experiment: { ...experiment, rubric: 'line one\nline two' },
    })
    assert.match(markdown, /inline string — see experiment definition/)
    assert.ok(!markdown.includes('line one'))
  })
})
