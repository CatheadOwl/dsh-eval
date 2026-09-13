/**
 * End-to-end coverage for the behavior CLI's machine face: `--format json`
 * stdout plus `--report` on disk, driven over a stdlib fake host (no dsh
 * checkout, no spawn of anything but the fake CLI). This is the only place the
 * bin → report census wiring is exercised — the unit tests cover
 * `createCaseRecord` and `buildTrace` separately, and a mutation dropping
 * `census` from the bin's records is invisible to both.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const BIN = fileURLToPath(new URL('../bin/dsh-eval.mjs', import.meta.url))

/**
 * A fake dsh CLI that stands in for a host whose event payload drifted: the
 * session log it writes has a tool/call whose `name` moved to `toolName`, and an
 * empty-text user message. Both project into records, so length comparison sees
 * nothing — the census's field-level signal is what has to report them.
 */
const FAKE_CLI = `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const patchIndex = process.argv.indexOf('--patch')
const overlay = readFileSync(process.argv[patchIndex + 1], 'utf8')
const rawRoot = overlay.match(/^\\s*root:\\s*(.+)$/mu)[1].trim()
const sessionsRoot = rawRoot.replace(/^["']|["']$/gu, '')
mkdirSync(sessionsRoot, { recursive: true })
writeFileSync(
  sessionsRoot + '/session.v3.jsonl',
  [
    JSON.stringify({ type: 'session', version: 3, id: 'session-fake' }),
    JSON.stringify({ seq: 1, type: 'user/message', data: { message: { role: 'user', content: [] } } }),
    JSON.stringify({ seq: 2, type: 'tool/call', data: { turn: 1, step: 1, toolName: 'renamed', arguments: '{}' } }),
    JSON.stringify({ seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } } }),
    JSON.stringify({ seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('\\n') + '\\n',
)
`

/**
 * One mock case file with an evidence anchor. The matcher is written inline on
 * purpose: the case lives outside this package, so a bare import of
 * `@catheadowl/dsh-eval` would not resolve, and the framework's contract is the
 * `{ describe, check }` object rather than the module it came from.
 */
function writeCase(root) {
  const file = join(root, 'census.eval.mjs')
  writeFileSync(file, `export default {\n`
    + `  id: 'cli-census-wiring',\n`
    + `  mode: 'mock',\n`
    + `  task: 'read something',\n`
    + `  script: { steps: [{ kind: 'text', text: 'done' }] },\n`
    + `  expect: [{\n`
    + `    describe: 'final text includes done',\n`
    + `    check: trace => trace.finalText.includes('done')\n`
    + `      ? { ok: true, message: '' }\n`
    + `      : { ok: false, message: 'final text: ' + JSON.stringify(trace.finalText) },\n`
    + `  }],\n`
    + `}\n`)
  return file
}

describe('dsh-eval run --format json', () => {
  it('carries the projection census into stdout and the report file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-json-'))
    try {
      mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), FAKE_CLI)
      const caseFile = writeCase(root)
      const reportPath = join(root, 'report.json')

      const run = spawnSync(process.execPath, [
        BIN, 'run',
        '--profile', 'headless',
        '--format', 'json',
        '--report', reportPath,
        caseFile,
      ], { cwd: root, encoding: 'utf8' })

      assert.equal(run.status, 0, `stdout: ${run.stdout}\nstderr: ${run.stderr}`)
      const report = JSON.parse(run.stdout)
      const record = report.results[0]
      assert.equal(record.status, 'pass')
      assert.deepEqual(report.summary, { selected: 1, passed: 1, failed: 0, skipped: 0 })
      assert.deepEqual(report.results.map(r => r.id), ['cli-census-wiring'])

      // The census is the point of the assertion: on-disk report and stdout are
      // the same content, and both carry the counters the CLI computed.
      assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report)
      const census = record.census
      assert.ok(census !== undefined, 'case record must carry the projection census')
      assert.deepEqual(census.eventTypeCounts, {
        'user/message': 1,
        'tool/call': 1,
        'assistant/message': 1,
        'turn/end': 1,
      })
      assert.deepEqual(census.projectionLengths, {
        toolCalls: 1,
        toolResults: 0,
        assistantTexts: 1,
        userMessages: 0,
        requestHeaders: 0,
      })
      // A kept record whose field moved, and a legal empty-text drop — the two
      // signals the census keeps apart.
      assert.deepEqual(census.projectionFieldGaps, {
        toolCallWithoutName: 1,
        toolCallWithoutCallId: 1,
      })
      assert.deepEqual(census.projectionSkipped, { main: { userMessages: 1 }, children: {} })
      assert.deepEqual(census.subagent.children, [])
      assert.equal(census.subagent.mainLogDescriptorEvents, 0)

      // Post-mortem artifact for a passing run is opt-in; ask for it and the
      // same census lands in `.runs/<id>/trace.json`.
      const kept = spawnSync(process.execPath, [
        BIN, 'run', '--profile', 'headless', '--keep-artifacts', '--format', 'json', caseFile,
      ], { cwd: root, encoding: 'utf8' })
      assert.equal(kept.status, 0, `stdout: ${kept.stdout}\nstderr: ${kept.stderr}`)
      const keptRecord = JSON.parse(kept.stdout).results[0]
      const traceJson = JSON.parse(readFileSync(join(dirname(caseFile), '.runs', 'cli-census-wiring', 'trace.json'), 'utf8'))
      assert.deepEqual(traceJson.trace.census, keptRecord.census)
      assert.equal(traceJson.trace.sessions.length, 1)
      assert.equal('census' in traceJson.trace.sessions[0], false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails the case when the guard trips, naming the missing anchor', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-cli-anchor-'))
    try {
      mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), FAKE_CLI)
      const file = join(root, 'no-anchor.eval.mjs')
      writeFileSync(file, `export default { id: 'no-anchor', mode: 'mock', task: 'x',\n`
        + `  script: { steps: [{ kind: 'text', text: 'done' }] },\n`
        + `  expect: [{ describe: 'tool not called: read', check: () => ({ ok: true, message: '' }), requiresEvidence: false }] }\n`)

      const run = spawnSync(process.execPath, [
        BIN, 'run', '--profile', 'headless', '--format', 'json', file,
      ], { cwd: root, encoding: 'utf8' })

      assert.equal(run.status, 1)
      const report = JSON.parse(run.stdout)
      assert.equal(report.results[0].status, 'fail')
      assert.match(report.results[0].failures.join('\n'), /no evidence anchor/)
      assert.equal('census' in report.results[0], false, 'no trace means no census')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
