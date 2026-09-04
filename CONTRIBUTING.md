---
description: Contributor guide for @catheadowl/dsh-eval — publishable-unit and framework-genericity ground rules, pnpm test entry (including verify gates and README i18n pairing), and docs conventions
---

# Contributing to @catheadowl/dsh-eval

Thanks for your interest! 中文简介：欢迎 issue 与 PR；提交前请跑 `pnpm test`（含两道发布自检闸与双语 README 配对校验）。

## Ground rules

- This package is a **publishable unit**: README/docs links must stay inside the
  package root; external evidence is cited by name, never by path. The
  `pnpm verify:publish` gate enforces this mechanically.
- The framework stays **generic**: no plugin-specific knowledge (row ids,
  fixture shapes) may leak into `src/` — gates and plugins are consumers, not
  built-ins.
- `src/index.mjs` is a pure in-package re-export facade; the exported face is
  frozen and mechanically checked by `pnpm verify:face` (docs drift included).

## Before you submit

```sh
pnpm install        # node >= 22
pnpm test           # unit suite + verify:publish + verify:face + README i18n pairing
```

A few review-adapter tests spawn the dsh CLI; they need a built host checkout
resolvable via the resolution chain (see `docs/host-wiring.md`). The sandboxed
environments where spawning is denied should run the suite from a normal
terminal rather than skipping tests.

## Documentation

Docs are Chinese-first with English README pairing: after editing either
README side, bring the other along and re-record the pair
(`node scripts/verify-readme-i18n.mjs --write`, wired into `pnpm test`).
