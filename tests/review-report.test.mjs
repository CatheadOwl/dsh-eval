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

  it('quotes the splice-proof answer and points at the transcript per run', () => {
    const markdown = renderReviewReport({
      experiment,
      result: {
        runs: 2,
        observations: 'obs',
        attempts: [
          // Hijacked run: answer differs from the raw final message.
          { index: 1, ok: true, result: { answer: 'the analysis', stdout: 'cannot fix the gate error' } },
          // Clean run: answer === stdout, no divergence note.
          { index: 2, ok: true, result: { answer: 'clean answer', stdout: 'clean answer' } },
        ],
      },
      adapter: 'dsh-headless',
    })
    assert.match(markdown, /### run 1 — ok[\s\S]*?```text\nthe analysis\n```/)
    assert.ok(!/### run 1[\s\S]*?cannot fix the gate error/.test(markdown.split('### run 2')[0]))
    assert.match(markdown, /- transcript: `run-1\.stderr\.txt` \(answer differs from the final message — see `run-1\.stdout\.txt`\)/)
    assert.match(markdown, /### run 2 — ok[\s\S]*?```text\nclean answer\n```/)
    assert.match(markdown, /- transcript: `run-2\.stderr\.txt`\n/)
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
