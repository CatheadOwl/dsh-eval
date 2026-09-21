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

  // A review whose tool face was never verified is weaker evidence: the report
  // header states the boundary status, and the affected run carries the reason
  // next to the answer it qualifies (EVAL-021).
  it('flags runs whose tool boundary check never ran, with the seam diagnosis', () => {
    const gap = 'no session trace materialized: no session artifact (session.jsonl / session.vN.jsonl) '
      + "under '/run/sessions' — the root holds no files (missing or empty); the host artifact naming may have changed generation"
    const markdown = renderReviewReport({
      experiment,
      result: {
        runs: 2,
        observations: 'obs',
        attempts: [
          { index: 1, ok: true, result: { answer: 'a', stdout: 'a', toolValidation: { status: 'checked', ok: true } } },
          {
            index: 2,
            ok: true,
            result: { answer: 'b', stdout: 'b', toolValidation: { status: 'not-executed', ok: false }, traceGap: gap },
          },
        ],
      },
      adapter: 'dsh-headless',
    })
    assert.match(markdown, /- tool boundary: NOT EXECUTED on run\(s\) 2 — no session artifact/)
    assert.match(markdown, /### run 2 — ok[\s\S]*?- \*\*tool-boundary check NOT EXECUTED\*\*: no session trace materialized/)
    assert.ok(!/### run 1[\s\S]*?NOT EXECUTED/.test(markdown.split('### run 2')[0]))
  })

  it('reports a fully checked boundary, and names an executor that reports none', () => {
    const checked = renderReviewReport({
      experiment,
      result: {
        runs: 1,
        observations: 'obs',
        attempts: [{ index: 1, ok: true, result: { stdout: 'x', toolValidation: { status: 'checked', ok: true } } }],
      },
    })
    assert.match(checked, /- tool boundary: checked on every run/)
    const custom = renderReviewReport({
      experiment,
      result: { runs: 1, observations: 'obs', attempts: [{ index: 1, ok: true, result: { stdout: 'x' } }] },
    })
    assert.match(custom, /- tool boundary: not reported by this executor/)
    // A run that failed before validation must not read as "the executor never
    // validates" — the summary says how many runs actually reported a status.
    const partial = renderReviewReport({
      experiment,
      result: {
        runs: 2,
        observations: 'obs',
        attempts: [
          { index: 1, ok: true, result: { stdout: 'x', toolValidation: { status: 'checked', ok: true } } },
          { index: 2, ok: false, error: 'dsh reviewer exited with code 1' },
        ],
      },
    })
    assert.match(partial, /- tool boundary: checked on 1 of 2 run\(s\); the rest reported none/)
  })
})

describe('renderReviewReport · judge first-pass (EVAL-033)', () => {
  const judgedResult = {
    runs: 1,
    observations: 'obs',
    attempts: [{ index: 1, ok: true, result: { answer: 'reviewer answer', stdout: 'reviewer answer' } }],
  }

  it('renders the machine section separately and marks the human columns as prefill-verified', () => {
    const markdown = renderReviewReport({
      experiment,
      result: judgedResult,
      adapter: 'dsh-headless',
      profile: 'headless',
      judge: {
        status: 'judged',
        profile: 'headless',
        judgedAt: '2026-09-21T00:00:00.000Z',
        sections: {
          Verdicts: 'run 1: field semantics understood across runs',
          'Intentional design hits': '- `[truncated: N]` counting — matches list item 1 (run 1)',
          'New red flags': '- none raised',
          'Next step': 'no action — reviewers agreed on every criterion',
        },
      },
    })
    assert.match(markdown, /## Judge first-pass \(machine — prefill, not a verdict gate\)/)
    assert.match(markdown, /status: judged/)
    assert.match(markdown, /instrument: profile `headless`, judged at 2026-09-21T00:00:00\.000Z/)
    assert.match(markdown, /`judge\.txt` · parsed prefill: `judge\.json`/)
    assert.match(markdown, /### Verdicts[\s\S]*field semantics understood/)
    assert.match(markdown, /### Intentional design hits[\s\S]*matches list item 1/)
    // Human columns stay authoritative: prefill note points UP at the machine section.
    assert.match(markdown, /Machine prefill in the judge section above — verify each against the rubric/)
    assert.doesNotMatch(markdown, /Next step \(pick one\)\n\nPick one:/)
  })

  it('renders unparsed judge output as unread, never as a pass', () => {
    const markdown = renderReviewReport({
      experiment,
      result: judgedResult,
      adapter: 'dsh-headless',
      judge: { status: 'unparsed', missing: ['Verdicts', 'Next step'], profile: 'headless' },
    })
    assert.match(markdown, /## Judge first-pass[\s\S]*four-heading contract \(missing: Verdicts, Next step\)/)
    assert.match(markdown, /raw output preserved in `judge\.txt`/)
    // No machine prefill note on the human columns when nothing was parsed.
    assert.doesNotMatch(markdown, /Machine prefill in the judge section above/)
  })

  it('accounts failed and not-executed judge passes without inventing content', () => {
    const failed = renderReviewReport({
      experiment, result: judgedResult, adapter: 'dsh-headless',
      judge: { status: 'failed', error: 'dsh reviewer exited with code 1' },
    })
    assert.match(failed, /Judge dispatch failed: dsh reviewer exited with code 1/)
    const skipped = renderReviewReport({
      experiment, result: judgedResult, adapter: 'dsh-headless',
      judge: { status: 'not-executed', reason: 'no successful reviewer run to grade' },
    })
    assert.match(skipped, /_Not executed: no successful reviewer run to grade\._/)
  })

  it('keeps the pre-judge report shape when no judge pass ran', () => {
    const markdown = renderReviewReport({
      experiment, result: judgedResult, adapter: 'dsh-headless', profile: 'headless',
    })
    assert.doesNotMatch(markdown, /Judge first-pass/)
    assert.match(markdown, /## Next step \(pick one\)[\s\S]*- \[ \] change plugin output/)
  })
})
