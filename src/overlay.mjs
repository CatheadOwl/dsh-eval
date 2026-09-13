/**
 * Overlay (cordis patch) serialization — the ONLY hand-rolled YAML emitter
 * in the package. Both the behavior runner (buildOverlayYaml) and the dsh
 * review adapter (overlayDisableRows for its tool-less overlay) generate
 * per-run overlay files; sharing one emitter keeps quoting rules and
 * row-patch syntax (`- id: <row>` / `disabled: true`) identical everywhere.
 *
 * YAML strategy: JSON double-quoted strings are valid YAML scalars, so the
 * emitters lean on JSON.stringify — zero dependencies, identical quoting
 * across scalar and array leaves.
 */

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** This framework's root directory (the eval package dir). */
const FRAMEWORK_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The scripted mock adapter plugin, referenced from generated overlays. */
const MOCK_ADAPTER_PATH = join(FRAMEWORK_ROOT, 'src', 'mock', 'mock-adapter.mjs')

/** The multi-turn driver plugin, mounted when a case declares `followups`. */
const MULTI_TURN_DRIVER_PATH = join(FRAMEWORK_ROOT, 'src', 'driver', 'multi-turn-driver.mjs')

/** JSON double-quoted strings are valid YAML scalars — enough for this emitter. */
function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

/**
 * One rowConfig leaf: a scalar, or an array of scalars emitted as a YAML flow
 * sequence (a JSON array is valid YAML flow syntax, and keeps quoting rules
 * identical to `yamlScalar`).
 */
function yamlConfigValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => typeof item === 'string' ? item : String(item)))
  return yamlScalar(value)
}

/**
 * Serialize `- id: <row> / disabled: true` patches for every row id — the
 * cross-layer row-disable mechanism shared by case `disableRows` and the
 * review adapter's host-tool lockdown.
 * @param {string[]} rowIds - loader row ids to disable.
 * @returns {string} overlay entries (each line-terminated).
 */
export function overlayDisableRows(rowIds) {
  return rowIds.map(rowId => `- id: ${yamlScalar(rowId)}\n  disabled: true\n`).join('')
}

/**
 * Serialize the per-run overlay patch list for one eval case.
 * @param {object} parts - overlay ingredients (see runEvalCase):
 *   `sessionsRoot` (required), optional `persona`, `disableRows`,
 *   `rowConfig`, and `mock` (mount the scripted adapter + re-point the
 *   default model).
 * @returns {string} the overlay file text.
 */
export function buildOverlayYaml(parts) {
  const lines = []
  lines.push('- id: session-persistence-jsonl')
  lines.push('  config:')
  lines.push(`    root: ${yamlScalar(parts.sessionsRoot)}`)
  lines.push('    packChunks: false')
  lines.push('    compression: none')
  if (parts.persona !== undefined) {
    lines.push('- id: system-prompt')
    lines.push('  config:')
    lines.push(`    persona: ${yamlScalar(parts.persona)}`)
  }
  if (parts.disableRows !== undefined && parts.disableRows.length > 0) {
    lines.push(overlayDisableRows(parts.disableRows).trimEnd())
  }
  for (const [rowId, config] of Object.entries(parts.rowConfig ?? {})) {
    // Whole-replace semantics: these config keys REPLACE the row's config
    // (cordis patch layer), so the emitter adds to a fresh `- id:` entry —
    // restating keys is the declaring case's responsibility.
    lines.push(`- id: ${yamlScalar(rowId)}`)
    lines.push('  config:')
    for (const [key, value] of Object.entries(config)) {
      lines.push(`    ${key}: ${yamlConfigValue(value)}`)
    }
  }
  if (parts.mock) {
    lines.push('- id: agent-default-model')
    lines.push('  config:')
    lines.push('    provider: eval-mock')
    lines.push('    model: eval-mock')
    // The title generator also calls the default provider and would consume
    // script steps; deterministic runs own every model call themselves.
    lines.push('- id: session-title-llm')
    lines.push('  disabled: true')
    lines.push('- insert:')
    lines.push('    - id: eval-mock-llm')
    lines.push(`      name: ${yamlScalar(pathToFileURL(MOCK_ADAPTER_PATH).href)}`)
  }
  if (parts.followups !== undefined) {
    // Cross-turn driving replaces the one-shot headless runner: it exits at
    // the FIRST idle and aborts every in-process background subagent at
    // teardown, so fire-and-forget children need the driver's longer lifetime.
    lines.push('- id: headless-runner')
    lines.push('  disabled: true')
    lines.push('- insert:')
    lines.push('    - id: eval-multi-turn-driver')
    lines.push(`      name: ${yamlScalar(pathToFileURL(MULTI_TURN_DRIVER_PATH).href)}`)
  }
  return `${lines.join('\n')}\n`
}
