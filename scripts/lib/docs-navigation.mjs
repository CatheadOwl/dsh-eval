// Generic docs-navigation engine: every markdown file under root must be
// reachable from the entry page via in-tree links, all in-tree links must
// resolve, and the package README must link the entry page.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

function stripFencedBlocks(markdown) {
  return markdown.replace(/```[\s\S]*?```/gu, '')
}

function markdownLinks(markdown) {
  const links = []
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) links.push(match[1])
  return links
}

function collectMarkdownFiles(root, result = []) {
  if (!existsSync(root)) return result
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === '.runs' || entry === '.git') continue
    const path = join(root, entry)
    if (statSync(path).isDirectory()) collectMarkdownFiles(path, result)
    else if (entry.endsWith('.md')) result.push(path)
  }
  return result
}

function normalizePath(path) {
  return path.replaceAll('\\', '/')
}

export function verifyDocsNavigation(options) {
  const violations = []
  const entryPath = resolve(options.entry)
  const rootPath = resolve(options.root)
  if (!existsSync(entryPath)) return [`navigation entry not found: ${options.entry}`]
  if (!existsSync(rootPath)) return [`navigation root not found: ${options.root}`]

  const reachable = new Set([entryPath])
  const queue = [entryPath]
  while (queue.length > 0) {
    const current = queue.pop()
    for (const link of markdownLinks(stripFencedBlocks(readFileSync(current, 'utf8')))) {
      if (/^[a-z]+:\/\//iu.test(link) || link.startsWith('#') || link.startsWith('mailto:')) continue
      const target = resolve(dirname(current), link.split('#', 1)[0])
      if (!target.endsWith('.md')) continue
      if (!target.startsWith(rootPath + '/') && !target.startsWith(rootPath + '\\')) continue
      if (!existsSync(target)) {
        violations.push(`broken markdown link ${normalizePath(relative(process.cwd(), current))} -> ${normalizePath(link)}`)
        continue
      }
      if (!reachable.has(target)) {
        reachable.add(target)
        queue.push(target)
      }
    }
  }

  for (const file of collectMarkdownFiles(rootPath)) {
    if (!reachable.has(file)) {
      violations.push(`markdown file is not reachable from navigation entry: ${normalizePath(relative(process.cwd(), file))}`)
    }
  }

  if (options.packageReadme !== undefined) {
    const packageReadmePath = resolve(options.packageReadme)
    if (!existsSync(packageReadmePath)) violations.push(`package README not found: ${options.packageReadme}`)
    else {
      const expected = normalizePath(relative(dirname(packageReadmePath), entryPath))
      const text = stripFencedBlocks(readFileSync(packageReadmePath, 'utf8'))
      if (!text.includes(`(${expected}`)) violations.push(`package README does not link navigation entry ${expected}`)
    }
  }
  return violations
}
