---
description: Contributor guide for @catheadowl/dsh-eval — publishable-unit and framework-genericity ground rules, pnpm test entry (including verify gates), and docs conventions
---

# Contributing to @catheadowl/dsh-eval

Thanks for your interest! 中文简介：欢迎 issue 与 PR；提交前请跑 `pnpm test`（含三道发布自检闸）。

## Ground rules

- This package is a **publishable unit**: README/docs links must stay inside the
  package root; external evidence is cited by name, never by path. The
  `pnpm verify:publish` gate enforces this mechanically.
- The framework stays **generic**: no plugin-specific knowledge (row ids,
  fixture shapes) may leak into `src/` — gates and plugins are consumers, not
  built-ins.
- `src/index.mjs` is a pure in-package re-export facade; the exported face is
  frozen and mechanically checked by `pnpm verify:face` (docs drift included).
- Machine-level wiring (junctions, local `file:` paths) never gets committed —
  wiring is a deployment prerequisite (`docs/host-wiring.md`); the
  `pnpm verify:publish` gate checks the manifest and artifact face.

## Before you submit

```sh
pnpm install        # node >= 22
pnpm test           # unit suite + verify:publish + verify:face + verify:experimental
```

A few review-adapter tests spawn the dsh CLI; they need a built host checkout
resolvable via the resolution chain (see `docs/host-wiring/README.md`). The sandboxed
environments where spawning is denied should run the suite from a normal
terminal rather than skipping tests.

## Documentation

Docs are Chinese-first; the README is English-only. New docs files enter the
`docs/README.md` index with a frontmatter `description` (md-metadata gate);
cross-doc links use relative paths. Version bumps add a `changelogs/v<semver>.md`
file named after the release tag (one bucketed entry set per version,
consumer-perspective wording; release-workflow, internal-gate, and docs-only
changes stay out of the release face).
