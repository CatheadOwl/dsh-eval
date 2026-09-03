// Resolve the TypeScript compiler for the verification scripts.
//
// Resolution order:
//   1. DSH_TYPESCRIPT_PATH env var pointing at a typescript.js (explicit override)
//   2. a normal `typescript` install resolvable from this package (own
//      devDependency install, or the dev-repo junction convention)
//
// No hardcoded sibling-checkout paths here: the dev repository wires the host
// compiler in through the filesystem (node_modules/typescript junction), the
// same convention used for the @deepseek-ai/* peer junctions.
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
export async function loadTypeScript() {
  const override = process.env.DSH_TYPESCRIPT_PATH
  if (override) {
    // Absolute paths (the common case: an explicit pointer) must go through
    // pathToFileURL — `new URL('D:\...')` mis-parses the drive letter as a
    // URL scheme on Windows.
    const href = isAbsolute(override)
      ? pathToFileURL(override).href
      : new URL(override, `file://${process.cwd()}/`).href
    return import(href)
  }
  try {
    return await import('typescript')
  }
  catch (error) {
    throw new Error(
      `cannot resolve typescript from the extras package; install dev dependencies, link a node_modules/typescript junction, or set DSH_TYPESCRIPT_PATH (${error.message})`,
    )
  }
}
