/**
 * Lightweight bilingual README pairing guard (simplified adaptation of the
 * deepseek-harness verify-translation-pairing idea, mjs + no deps):
 *   1. README.md (English-primary) and README.zh.md must both exist.
 *   2. README.md must carry a language switcher line linking README.zh.md.
 *   3. README.i18n.yaml records the sha256 of each side at the last
 *      confirmed-consistent state; any side drifting from its record turns
 *      this check red. Bring both sides along when editing either, then
 *      re-record with:  node scripts/verify-readme-i18n.mjs --write
 * Translation quality itself stays a review responsibility.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const README = 'README.md'
const README_ZH = 'README.zh.md'
const SIDECAR = 'README.i18n.yaml'

const writeMode = process.argv.includes('--write')

function sha256(file) {
  return createHash('sha256').update(readFileSync(join(pkgRoot, file))).digest('hex')
}

function fail(message) {
  console.error(`verify-readme-i18n: ${message}`)
  process.exitCode = 1
}

for (const file of [README, README_ZH]) {
  if (!existsSync(join(pkgRoot, file))) {
    fail(`${file} is missing — the bilingual README pair must be complete`)
  }
}

const sidecarPath = join(pkgRoot, SIDECAR)
const records = new Map()
if (existsSync(sidecarPath)) {
  for (const line of readFileSync(sidecarPath, 'utf8').split('\n')) {
    const match = line.match(/^(\S+\.md):\s*([0-9a-f]{64})\s*$/)
    if (match) records.set(match[1], match[2])
  }
} else if (!writeMode) {
  fail(`${SIDECAR} is missing — run with --write after confirming pair consistency`)
}

if (existsSync(join(pkgRoot, README))) {
  const head = readFileSync(join(pkgRoot, README), 'utf8').split('\n').slice(0, 10).join('\n')
  if (!/\[.*中文.*\]\(README\.zh\.md\)/.test(head) && !/\[.*Chinese.*\]\(README\.zh\.md\)/.test(head)) {
    fail(`${README} must carry a language switcher line linking ${README_ZH} near the top`)
  }
}

let dirty = false
for (const file of [README, README_ZH]) {
  if (!existsSync(join(pkgRoot, file))) continue
  const actual = sha256(file)
  if (writeMode) {
    records.set(file, actual)
    dirty = true
  } else {
    const recorded = records.get(file)
    if (recorded !== actual) {
      fail(`${file} drifted from ${SIDECAR} (recorded ${recorded ?? '<none>'}, actual ${actual}) — bring the other side along, then re-record with --write`)
    }
  }
}

if (writeMode && dirty) {
  const header = [
    '# Bilingual README pairing record (adapted from deepseek-harness docs/i18n): the sha256 of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority; after',
    '# editing either side, bring the other along and re-record with:',
    '#   node scripts/verify-readme-i18n.mjs --write',
    '',
  ].join('\n')
  const body = [README, README_ZH]
    .filter((file) => records.has(file))
    .map((file) => `${file}: ${records.get(file)}`)
    .join('\n')
  writeFileSync(sidecarPath, `${header}${body}\n`)
  console.log(`verify-readme-i18n: recorded ${[README, README_ZH].filter((f) => records.has(f)).join(', ')}`)
}
