import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildOverlayYaml } from '../src/runner.mjs'
import { toolCallStep, textStep } from '../src/mock/script.mjs'

describe('buildOverlayYaml', () => {
  it('always re-roots persistence to the run dir with a diagnostics-friendly layout', () => {
    const yaml = buildOverlayYaml({ sessionsRoot: 'C:\\tmp\\run\\sessions', mock: false })
    assert.match(yaml, /- id: session-persistence-jsonl/)
    assert.match(yaml, /root: "C:\\\\tmp\\\\run\\\\sessions"/)
    assert.match(yaml, /packChunks: false/)
    assert.match(yaml, /compression: none/)
    assert.ok(!yaml.includes('eval-mock'))
  })

  it('adds the persona override only when a case supplies one', () => {
    const withPersona = buildOverlayYaml({ sessionsRoot: 's', persona: 'You are terse.' })
    assert.match(withPersona, /- id: system-prompt/)
    assert.match(withPersona, /persona: "You are terse\."/)
    assert.ok(!buildOverlayYaml({ sessionsRoot: 's' }).includes('system-prompt'))
  })

  it('mounts the scripted adapter and re-points the default model in mock mode', () => {
    const yaml = buildOverlayYaml({ sessionsRoot: 's', mock: true })
    assert.match(yaml, /provider: eval-mock/)
    assert.match(yaml, /model: eval-mock/)
    assert.match(yaml, /- id: eval-mock-llm/)
    assert.match(yaml, /name: "file:\/\/\/.+mock-adapter\.mjs"/)
  })

  it('disables the gates plugin row only when the case declares gates off', () => {
    const yaml = buildOverlayYaml({ sessionsRoot: 's', gates: 'off' })
    assert.match(yaml, /- id: gates\n  disabled: true/)
    assert.ok(!buildOverlayYaml({ sessionsRoot: 's' }).includes('- id: gates'))
  })
})

describe('mock script builders', () => {
  it('builds a tool-call step that finishes with kind tool-calls', () => {
    const step = toolCallStep('coggit_status', { sourcePath: 'a.ts' })
    assert.equal(step.at(-1).reason.kind, 'tool-calls')
    const block = step.find(chunk => chunk.type === 'block-end').block
    assert.equal(block.name, 'coggit_status')
    assert.deepEqual(JSON.parse(block.arguments), { sourcePath: 'a.ts' })
    assert.equal(block.id, step[1].id)
  })

  it('builds a text step that stops the loop', () => {
    const step = textStep('done')
    assert.equal(step.at(-1).reason.kind, 'stop')
    assert.equal(step.find(chunk => chunk.type === 'block-end').block.text, 'done')
  })

  it('mints distinct call ids across generated steps', () => {
    const first = toolCallStep('a')
    const second = toolCallStep('b')
    assert.notEqual(first[1].id, second[1].id)
  })
})
