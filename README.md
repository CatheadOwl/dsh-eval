---
description: '@catheadowl/dsh-eval — a dsh-native agent evaluation layer for plugin authors: behavior cases run against real headless dsh traces, review experiments test whether fresh models understand plugin outputs'
---

# @catheadowl/dsh-eval

English | [中文](README.zh.md)

**A dsh-native agent evaluation layer for plugin authors**: behavior cases run against real headless dsh traces, while review experiments test whether fresh models understand plugin outputs.

It evaluates the **assembled agent harness** (the graph a plugin + profile + patch + tool registry form inside a real dsh headless run), not isolated functions; verdicts come from dsh-native session-trace projections and matchers (contract assertions), not metric scores. It is not a general agent-eval platform (no dashboard / dataset hosting / metric catalog, no benchmark ranking) and not a DeepEval / OpenAI Evals replacement — those projects proved the problem space; this package picks the dsh-native vertical solution.

> Documentation is Chinese-first; deep contracts live in [docs/](docs/README.md) (matchers / boundary contracts / review / report structure / host wiring / known issues).

## Why it exists

| Layer | Question | Verdict | Execution |
|---|---|---|---|
| unit / shape test | are deterministic fields and values correct | automatic | the plugin's own `node:test` |
| behavior real | does natural-language intent pick the right tool | trace matcher | dsh + real model |
| behavior mock | is the tool pipeline and write round-trip stable | trace matcher + workspace inspect | dsh + scripted mock LLM |
| comprehension review | can a fresh model understand the output and the next step | manual rubric, converged over runs | abstract review experiment + replaceable executor |

A dsh plugin is correct when the assembled graph really wires tools, steers, prompts, and gates together — plugin unit tests cover only part of that, and "is the output understandable" is not a string regression at all. This package turns both layers into replayable evidence instead of manual trial runs.

```text
plugin-owned experiment             shared framework
fixtures + prompt + rubric + observe ──► experiment/review.mjs
                                               │ task
                                               ▼
                                        adapters/dsh/review.mjs ──► dsh headless

behavior *.eval.mjs ───────────────────► dsh behavior runner (trace + mock)
```

- `src/experiment/` is the model- and runtime-agnostic experiment layer: blind review, live observation, byte-identical evidence across reviewers. It does not import dsh.
- `src/adapters/dsh/` is the landing layer: hands the abstract task to an isolated dsh headless run.
- Your `eval/` keeps only domain fixtures, projections/observe, prompts, rubrics, and cases — no runner duplication.

## Install

```bash
npm i -D @catheadowl/dsh-eval
```

**Requirements** (wiring details and failure self-diagnostics in [docs/host-wiring.md](docs/host-wiring.md)):

- a built deepseek-harness checkout (`apps/cli/lib/bin.js`);
- the plugin under test installed into a dsh profile;
- the peer dependency `@deepseek-ai/dsh-llm` must be wired manually (npm auto-installs an incompatible antique version; replace it with a link pointing at the host checkout).

## Quickstart

`<plugin>/eval/behavior/mock/smoke.eval.mjs`:

```js
import { firstTool, toolCalled, toolCallStep, textStep } from '@catheadowl/dsh-eval'

export default {
  id: 'my-first-case',
  mode: 'mock',
  task: 'rename guide.md to intro.md',
  async prepare(workspace) { /* seed fixture files */ },
  script: { steps: [toolCallStep('md_rename', { oldPath: 'guide.md', newPath: 'intro.md' }), textStep('done')] },
  expect: [toolCalled('md_rename')],
}
```

```bash
dsh-eval run --mode mock eval/behavior/mock
dsh-review --dry-run eval/comprehension     # model-free dry run of the review layer
```

The command needs to know which dsh profile to use: pass `--profile <name>` explicitly, or drop a `dsh-eval.config.mjs` at the package root (see "Unified config" below).

Real runs use `dsh-eval run --profile <p> --repo <harness checkout> <case path>`; all flags (`--mode/--keep-artifacts/--fail-on-skip/--format/--report`) are documented in [docs/report.md](docs/report.md). Real cases auto-skip without credentials (dsh resolves credentials itself); mock and dry runs need no credentials.

## Canonical layout

```text
<plugin>/eval/
  .gitignore                 # .runs/ (no path prefix)
  README.md
  behavior/                  # optional
    real/*.eval.mjs
    mock/*.eval.mjs
    _fixtures/
  comprehension/             # optional
    <name>.review.mjs
    fixtures.json
    prompt.md
    rubric.md
```

## Unified config dsh-eval.config.mjs

Drop one at the consumer package root; both CLIs walk upward from the working directory, and flags always override config:

```js
export default {
  profile: 'headless',              // dsh profile
  repo: '../../deepseek-harness',   // relative, anchored at the config file's directory
  mode: 'mock',                     // behavior CLI's --mode default (review has none)
  failOnSkip: false,                // behavior CI gate default
  report: 'eval-report.json',       // --report default (anchored at the config dir)
  disableRows: ['gates'],           // plugin rows disabled by default; case-level declarations win
                                     // (explicit [] = all enabled, for gate-interaction cases)
}
```

Unknown keys fail loudly (typos never degrade silently). The `disableRows` semantics and the turn-close gate boundary contract are in [docs/disablerows.md](docs/disablerows.md).

## Docs

| Doc | Topic |
|---|---|
| [host-wiring](docs/host-wiring.md) | peer wiring (incl. the npm antique-peer trap), building the CLI, profiles, credentials, spawn requirements |
| [review](docs/review.md) | comprehension review: experiment definition, sterile profile, artifacts, the six review rules |
| [matchers](docs/matchers.md) | the full trace-matcher and mock-helper set (tool face / text face / model-visible face) |
| [disablerows](docs/disablerows.md) | `disableRows` and the turn-close gate boundary contract |
| [rowconfig](docs/rowconfig.md) | the `rowConfig` per-row config override contract (whole-segment replacement, restate needed keys) |
| [intent-cases](docs/intent-cases.md) | real intent-case spec: when to write one, assertion face, guards, CI semantics |
| [report](docs/report.md) | machine-readable report structure (`--format json` / `--report`) |
| [known-issues](docs/known-issues.md) | known issues and workarounds (e.g. REQUEST_EXTENSION in staged homes) |
| [runner-api](docs/runner-api.md) | programmatic runner API: `runEvalCase` options contract, EvalRunResult fields, crossing tiers for `cliPath` |
| [experimental](docs/experimental.md) | `experimental` subpath symbol list (escape hatch, no compatibility promise) |

## Runtime guarantees

The runner uses `try/finally` so temp directories and links are cleaned up on every path (`prepare` throwing, mock validation failure, spawn errors) — the real profile store is never polluted. The behavior and review CLIs share directory scanning (skipping `.runs` and `node_modules`); the behavior CLI validates case shapes and detects cross-file duplicate ids at load time, failing as early as possible.

License: MIT. The framework's own tests and release self-checks are carried by the repository CI and do not ship with the package.
