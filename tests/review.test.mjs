import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDshHeadlessReviewExecutor } from '../src/adapters/dsh/review.mjs'
import {
  buildJudgeTask,
  defineReviewExperiment,
  executeReviewExperiment,
  executeReviewJudge,
  JUDGE_OUTPUT_SECTIONS,
  loadRubricText,
  materializeReviewExperiment,
  parseJudgeOutput,
  renderObservationSections,
} from '../src/experiment/review.mjs'

const prompt = 'Blind review:\n\n{{EVAL_OBSERVATIONS}}\n\nAnswer.'

test('materializes live observations into a stable blind task', async () => {
  let observes = 0
  const experiment = defineReviewExperiment({
    id: 'sample-review',
    prompt,
    rubric: 'rubric.md',
    async observe() {
      observes += 1
      return [{
        heading: 'Cases',
        entries: [{ heading: 'case-1', call: { x: 1 }, json: { ok: true } }],
      }]
    },
  })
  const result = await materializeReviewExperiment(experiment)
  assert.equal(observes, 1)
  assert.match(result.task, /## Cases/)
  assert.match(result.task, /Call: {"x":1}/)
  assert.match(result.task, /"ok": true/)
  assert.doesNotMatch(result.task, /EVAL_OBSERVATIONS/)
})

test('observes once and sends byte-identical evidence to every executor run', async () => {
  let observes = 0
  const tasks = []
  const experiment = defineReviewExperiment({
    id: 'repeat-review',
    prompt,
    rubric: 'rubric.md',
    defaultRuns: 2,
    observe() {
      observes += 1
      return [{ heading: 'Evidence', entries: [{ heading: 'only', json: { value: observes } }] }]
    },
  })
  const result = await executeReviewExperiment(experiment, async task => {
    tasks.push(task)
    return { stdout: 'answer' }
  })
  assert.equal(observes, 1)
  assert.equal(result.attempts.length, 2)
  assert.equal(tasks[0], tasks[1])
})

test('renders paragraphs, calls, and JSON without experiment-specific formatting', () => {
  const rendered = renderObservationSections([{
    heading: 'Tools',
    introduction: 'Visible contract.',
    entries: [{ heading: 'tool_x', paragraphs: ['Description.', 'Parameters: {}'] }],
  }])
  assert.equal(rendered, '## Tools\nVisible contract.\n\n### tool_x\nDescription.\nParameters: {}')
})

test('dsh adapter gives every reviewer an isolated DSH_HOME', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-adapter-test-'))
  try {
    const realHome = join(root, 'real-home')
    const profileDir = join(realHome, 'profiles', 'test-profile')
    mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{"type":"module"}')
    writeFileSync(join(profileDir, 'cordis.yml'), 'plugins: []\n')
    const cli = join(root, 'fake-cli.mjs')
    writeFileSync(cli, [
      'let input = \'\'',
      'for await (const chunk of process.stdin) input += chunk',
      'console.log(JSON.stringify({ home: process.env.DSH_HOME, args: process.argv.slice(2), stdin: input }))',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      profile: 'test-profile',
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const first = await execute('first task')
    const second = await execute('second task')
    const firstOutput = JSON.parse(first.stdout)
    const secondOutput = JSON.parse(second.stdout)

    assert.notEqual(firstOutput.home, secondOutput.home)
    assert.deepEqual(firstOutput.args.slice(0, 3), ['--profile', 'test-profile', '--patch'])
    assert.match(firstOutput.args[3], /[\\/]review-overlay\.yml$/)
    // The task rides stdin (`-` positional) — argv stays under every platform's
    // command-line ceiling no matter how large the task grows.
    assert.equal(firstOutput.args[4], '-')
    assert.equal(firstOutput.stdin, 'first task')
    assert.equal(existsSync(first.runDir), false)
    assert.equal(existsSync(second.runDir), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('defaults to the headless sterile profile when no profile is specified', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-default-test-'))
  try {
    const realHome = join(root, 'real-home')
    mkdirSync(realHome, { recursive: true })
    const cli = join(root, 'fake-cli.mjs')
    writeFileSync(cli, 'console.log(JSON.stringify({ args: process.argv.slice(2) }))\n')

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const result = await execute('task')
    const output = JSON.parse(result.stdout)
    assert.equal(output.args[1], 'headless')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('blank environment by default: staged plugin rows are disabled, wiring rows kept', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-blank-test-'))
  try {
    const realHome = join(root, 'real-home')
    const profileDir = join(realHome, 'profiles', 'test-profile')
    const bundleDir = join(profileDir, 'node_modules', '@catheadowl', 'dsh-extras')
    mkdirSync(bundleDir, { recursive: true })
    // Real composition shape: empty root list, plugins via profile patch
    // rows and via out-of-tree bundles in package.json dsh.profile.bundles.
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test-profile',
      private: true,
      dependencies: { '@catheadowl/dsh-extras': 'link:../../extras' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@catheadowl/dsh-extras'] } },
    }, null, 2))
    writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), [
      '- id: subagent-at',
      '  config:',
      '    profile: sdk',
    ].join('\n'))
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: gates',
      "      name: '@catheadowl/dsh-extras/gates'",
      '    - id: markdown',
      "      name: '@catheadowl/dsh-extras/markdown'",
      // An out-of-tree patch may also override a base wiring row — the
      // whitelist must keep it enabled (reviewer needs its model call).
      '- id: agent-default-model',
      '  config:',
      '    provider: something-else',
    ].join('\n'))
    // Fake CLI prints the overlay it was handed (--patch is argv[4]).
    const cli = join(root, 'fake-cli.mjs')
    writeFileSync(cli, [
      "import { readFileSync } from 'node:fs'",
      "console.log(readFileSync(process.argv[5], 'utf8'))",
      '',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      profile: 'test-profile',
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const overlay = await execute('task')

    assert.match(overlay.stdout, /- id: "subagent-at"\n  disabled: true/)
    assert.match(overlay.stdout, /- id: "gates"\n  disabled: true/)
    assert.match(overlay.stdout, /- id: "markdown"\n  disabled: true/)
    assert.match(overlay.stdout, /- id: "tool-fs"\n  disabled: true/)
    assert.doesNotMatch(overlay.stdout, /- id: "agent-default-model"\n  disabled: true/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pins the session-log artifact shape: root at the collection root, no compression, no chunk packing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-persistence-test-'))
  try {
    const realHome = join(root, 'real-home')
    mkdirSync(realHome, { recursive: true })
    // Fake CLI reports its DSH_HOME AND the overlay it was handed, so the
    // root pin can be asserted against the exact home that will boot.
    const cli = join(root, 'fake-cli.mjs')
    writeFileSync(cli, [
      "import { readFileSync } from 'node:fs'",
      'const overlay = readFileSync(process.argv[5], "utf8")',
      'console.log(JSON.stringify({ home: process.env.DSH_HOME, overlay }))',
      '',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const result = await execute('task')
    const output = JSON.parse(result.stdout)

    // The behavior overlay's determinism contract, now on the review face
    // too: without the pin the host default (zstd) writes
    // session.vN.jsonl.zstd, `isSessionLogFilename` collects nothing, and the
    // tool-boundary check degrades to a constant not-executed.
    assert.match(output.overlay, /- id: session-persistence-jsonl\n  config:\n    root: /)
    assert.match(output.overlay, /compression: none/)
    assert.ok(!output.overlay.includes('packChunks')) // not a host config key
    const pinnedRoot = JSON.parse(output.overlay.match(/    root: ("(?:[^"\\]|\\.)*")/)[1])
    assert.equal(pinnedRoot, join(output.home, 'sessions'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('keepPluginRows opts back into the host plugin face', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-keepprofiles-test-'))
  try {
    const realHome = join(root, 'real-home')
    const profileDir = join(realHome, 'profiles', 'test-profile')
    const bundleDir = join(profileDir, 'node_modules', '@catheadowl', 'dsh-extras')
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@catheadowl/dsh-extras'] } },
    }))
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), "- insert:\n    - id: gates\n      name: '@catheadowl/dsh-extras/gates'\n")
    const cli = join(root, 'fake-cli.mjs')
    writeFileSync(cli, [
      "import { readFileSync } from 'node:fs'",
      "console.log(readFileSync(process.argv[5], 'utf8'))",
      '',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      profile: 'test-profile',
      dshHome: realHome,
      timeoutMs: 10_000,
      keepPluginRows: true,
    })
    const overlay = await execute('task')

    assert.doesNotMatch(overlay.stdout, /- id: "gates"/)
    assert.match(overlay.stdout, /- id: "tool-fs"\n  disabled: true/)
    // The session-log pin is artifact determinism, not part of the plugin
    // face under study — it stays in the keepPluginRows mode too.
    assert.match(overlay.stdout, /- id: session-persistence-jsonl\n  config:\n    root: /)
    assert.match(overlay.stdout, /compression: none/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails on tool boundary violation when session trace shows unexpected tools', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-boundary-test-'))
  try {
    const realHome = join(root, 'real-home')
    mkdirSync(realHome, { recursive: true })
    const cli = join(root, 'fake-cli.mjs')
    // The fake CLI writes a session JSONL with a tool leak, then exits 0.
    writeFileSync(cli, [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "const home = process.env.DSH_HOME",
      "const dir = join(home, 'sessions')",
      "mkdirSync(dir, { recursive: true })",
      "writeFileSync(join(dir, 'session.v3.jsonl'),",
      "  '{\"type\":\"session\",\"version\":3,\"id\":\"s1\"}\\n'",
      "  + '{\"seq\":0,\"type\":\"request/header\",\"data\":{\"reason\":\"initial\",\"header\":{\"system\":\"s\",\"tools\":[{\"name\":\"coggit_status\"}]}}}\\n')",
      '',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    await assert.rejects(
      () => execute('task'),
      (error) => {
        assert.match(error.message, /tool boundary violation/)
        assert.match(error.message, /coggit_status/)
        // Evidence is attached to result for the caller to persist
        // (the adapter's runDir is ephemeral — removed by finally).
        assert.ok(error.result.toolBoundaryEvidence, 'evidence must be attached to result')
        const evidence = JSON.parse(error.result.toolBoundaryEvidence)
        assert.equal(evidence.status, 'tool-boundary-violation')
        assert.deepEqual(evidence.unexpectedTools, ['coggit_status'])
        return true
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('captures the trace-derived answer when a tail interaction hijacks the final message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-answer-test-'))
  try {
    const realHome = join(root, 'real-home')
    mkdirSync(realHome, { recursive: true })
    const cli = join(root, 'fake-cli.mjs')
    // The fake CLI prints the (hijacked) final message to stdout — the host
    // headless behavior — and writes a session log where the analysis
    // precedes a plugin-sourced gate complaint.
    writeFileSync(cli, [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "console.log('cannot fix the gate error')",
      "const dir = join(process.env.DSH_HOME, 'sessions')",
      "mkdirSync(dir, { recursive: true })",
      "writeFileSync(join(dir, 'session.v3.jsonl'),",
      "  '{\"type\":\"session\",\"version\":3,\"id\":\"s1\"}\\n'",
      "  + '{\"seq\":1,\"type\":\"user/message\",\"data\":{\"content\":[{\"type\":\"text\",\"text\":\"analyze\"}],\"source\":{\"kind\":\"user\"}}}\\n'",
      "  + '{\"seq\":2,\"type\":\"assistant/message\",\"data\":{\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"the analysis\"}]}}}\\n'",
      "  + '{\"seq\":3,\"type\":\"user/message\",\"data\":{\"content\":[{\"type\":\"text\",\"text\":\"doc-link failed\"}],\"source\":{\"kind\":\"plugin\",\"plugin\":\"gates\"}}}\\n'",
      "  + '{\"seq\":4,\"type\":\"assistant/message\",\"data\":{\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"cannot fix the gate error\"}]}}}\\n')",
      '',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const result = await execute('task')
    // stdout holds the hijacked final message; the answer is the analysis.
    assert.equal(result.stdout.trim(), 'cannot fix the gate error')
    assert.equal(result.answer, 'the analysis')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accounts for a tool boundary check that could not run (no session log)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-no-trace-test-'))
  try {
    const realHome = join(root, 'real-home')
    mkdirSync(realHome, { recursive: true })
    const cli = join(root, 'fake-cli.mjs')
    // The fake CLI exits 0 without writing any session log — the shape a host
    // artifact-naming change produces. The check cannot run, so the result
    // must SAY that (status + seam diagnosis) instead of reporting a silent
    // pass and an apparently normal answer (EVAL-021).
    writeFileSync(cli, 'console.log("ok")\n')

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const result = await execute('task')
    assert.equal(result.toolValidation.status, 'not-executed')
    assert.equal(result.toolValidation.ok, false)
    assert.match(result.traceGap, /no session trace materialized/)
    assert.match(result.traceGap, /the host artifact naming may have changed generation/)
    // The answer still falls back to stdout's final message — now declared.
    assert.equal(result.answer.trim(), 'ok')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('records a checked tool boundary on the result when the trace exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-checked-test-'))
  try {
    const realHome = join(root, 'real-home')
    mkdirSync(realHome, { recursive: true })
    const cli = join(root, 'fake-cli.mjs')
    writeFileSync(cli, [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "console.log('the answer')",
      "const dir = join(process.env.DSH_HOME, 'sessions')",
      "mkdirSync(dir, { recursive: true })",
      "writeFileSync(join(dir, 'session.v3.jsonl'),",
      "  '{\"type\":\"session\",\"version\":3,\"id\":\"s1\"}\\n'",
      "  + '{\"seq\":0,\"type\":\"request/header\",\"data\":{\"reason\":\"initial\",\"header\":{\"system\":\"s\",\"tools\":[]}}}\\n')",
      '',
    ].join('\n'))

    const execute = createDshHeadlessReviewExecutor({
      cliPath: cli,
      dshHome: realHome,
      timeoutMs: 10_000,
    })
    const result = await execute('task')
    assert.equal(result.toolValidation.status, 'checked')
    assert.equal(result.toolValidation.ok, true)
    assert.equal(result.traceGap, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('review judge primitives (EVAL-033)', () => {
  it('builds a judge task carrying the rubric, the observations, and every answer', () => {
    const task = buildJudgeTask({
      rubricText: '# Answer key\n\ndepth is relative to the anchor.',
      observations: '## Hops\n\nhop-1 output',
      answers: ['first reviewer answer', 'second reviewer answer'],
    })
    assert.match(task, /Answer key \(hidden grading standard — the reviewers never saw this\)[\s\S]*depth is relative to the anchor/)
    assert.match(task, /## Observations[\s\S]*hop-1 output/)
    assert.match(task, /### run 1\nfirst reviewer answer/)
    assert.match(task, /### run 2\nsecond reviewer answer/)
    for (const heading of JUDGE_OUTPUT_SECTIONS) assert.match(task, new RegExp(`## ${heading}`))
  })

  it('refuses judge tasks with empty rubric, observations, or answers', () => {
    assert.throws(() => buildJudgeTask({ rubricText: '', observations: 'o', answers: ['a'] }), /rubricText/)
    assert.throws(() => buildJudgeTask({ rubricText: 'r', observations: ' ', answers: ['a'] }), /observations/)
    assert.throws(() => buildJudgeTask({ rubricText: 'r', observations: 'o', answers: [] }), /answers/)
  })

  it('parses a contract-following judge output into four sections', () => {
    const raw = [
      '## Verdicts', 'run 1: understood depth relativity.', '',
      '## Intentional design hits', '- `[truncated: N]` counting (run 1).', '',
      '## New red flags', '- none.', '',
      '## Next step', 'no action.',
    ].join('\n')
    const parsed = parseJudgeOutput(raw)
    assert.equal(parsed.status, 'judged')
    assert.match(parsed.sections.Verdicts, /understood depth relativity/)
    assert.match(parsed.sections['Intentional design hits'], /truncated/)
    assert.match(parsed.sections['New red flags'], /none/)
    assert.match(parsed.sections['Next step'], /no action/)
  })

  it('reports unparsed output with the missing headings, never as a pass', () => {
    const parsed = parseJudgeOutput('## Verdicts\nfine.\n\n## New red flags\n- none.')
    assert.equal(parsed.status, 'unparsed')
    assert.deepEqual(parsed.missing, ['Intentional design hits', 'Next step'])
  })

  it('loads the rubric from a path, a file URL, or an inline string — and refuses other URL protocols', () => {
    const dir = mkdtempSync(join(tmpdir(), 'judge-rubric-'))
    try {
      const rubricPath = join(dir, 'rubric.md')
      writeFileSync(rubricPath, '# key\ninline file rubric', 'utf8')
      assert.equal(loadRubricText(rubricPath), '# key\ninline file rubric')
      assert.equal(loadRubricText(pathToFileURL(rubricPath)), '# key\ninline file rubric')
      assert.equal(loadRubricText('inline rubric text\nsecond line'), 'inline rubric text\nsecond line')
      assert.throws(() => loadRubricText(new URL('https://example.invalid/rubric.md')), /file: only/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes the judge through the same executor and never throws on unparsed output', async () => {
    const experiment = defineReviewExperiment({
      id: 'judged-review',
      prompt,
      rubric: 'inline key text',
      async observe() { return [{ heading: 'Evidence', entries: [{ heading: 'only', paragraphs: ['x'] }] }] },
    })
    const calls = []
    const judgeRun = await executeReviewJudge(experiment, async (task, context) => {
      calls.push({ task, context })
      return { answer: '## Verdicts\nok\n\n## Intentional design hits\n- none\n\n## New red flags\n- none\n\n## Next step\nno action' }
    }, { observations: 'obs', answers: ['a1'] })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].context.judgePass, true)
    assert.equal(calls[0].context.experimentId, 'judged-review')
    assert.equal(judgeRun.parsed.status, 'judged')
    assert.match(judgeRun.task, /inline key text/)
    assert.ok(judgeRun.judgedAt)
  })
})
