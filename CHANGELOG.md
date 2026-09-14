---
description: Release history of @catheadowl/dsh-eval — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-eval` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

### Added

- **Behavior experiment surface (experimental): arms × repeats × guard ×
  aggregation.** `defineBehaviorExperiment` freezes an experiment whose arms
  are case-field overrides (`task` / `expect` / `prepare` / `rowConfig` /
  `disableRows` / `followups` / `settleTimeoutMs` / `timeoutMs` — no separate
  per-arm config channel), `executeBehaviorExperiment` runs every arm × run
  with framework-minted case ids, deep-merging arm `rowConfig` overrides onto
  the case's own declaration (writing only the differing keys behaves exactly
  like restating the whole config), and aggregates per-arm descriptive stats
  over guard-clean runs only. The false-green shapes this replaces are
  structurally impossible here: a run without a trace is a named row failure (never
  silently dropped), and an arm with zero guard-clean runs is **INVALID**
  with every failing row's reason — never an empty aggregation cell. The
  preregistered `decisionRule` and a definition fingerprint ride every
  result and summary; judgment and significance stay with the consumer (no
  pass/fail exit-code semantics). `renderBehaviorSummary` /
  `writeBehaviorArtifacts` produce the `summary.md` + `results.json` pair.
  See `docs/experiments.md`.
- **`evaluateMatchers` (experimental): the official programmatic evaluation
  entry.** Runs a case's `expect` set against a trace with the evidence-anchor
  rule inlined, so hand-rolled drivers no longer bypass the enforcement
  inside `runEvalCase` (the tier seam `run-relates-ab`-style consumers used
  to hit). Throws on a missing trace instead of evaluating against nothing.
- **`rowConfig` values accept nested plain objects.** A parameter group (e.g.
  `variant: { form: 'standard', emphasis: 2 }`) can now be declared as one
  value instead of being flattened into unrelated scalar keys; nested objects
  are emitted as YAML flow mappings, and leaves keep the same scalar /
  scalar-array restriction at every depth. Arrays still reject non-scalar
  items, and `null` leaves are still refused.
- Case records carry `evidenceAnchor: 'inspect'` when the case's assertions rest
  on its `inspect` hook alone — the one evidence channel the framework cannot
  audit (a hook may read raw session events or nothing at all). The field marks a
  case whose evidence face was declared rather than verified, so it is visible in
  `--format json` instead of looking like any other green case; matcher-anchored
  cases omit the field.

### Changed

- **Every case now needs an evidence anchor.** A case whose `expect` contains
  only matchers that pass on an empty projection is refused at load time
  (`no evidence anchor`), because the trace projection is tolerant: when a host
  event payload drifts the projection empties out instead of failing, and
  absence-asserting matchers — `toolNotCalled`, `userMessageTextExcludes`, and
  `subagentDispatchCount` / `subagentCompletedCount` with `expected === 0` —
  then pass vacuously, reporting "nothing was measured" as "passed". Both
  entry points enforce it (`dsh-eval` at load, `runEvalCase` at execution).
  **Migrating a case that trips this**: add one matcher that requires evidence
  (any positive matcher; for a case whose task forbids tool use, a text-existence
  anchor such as `finalTextMatches(/\d/u)` works), or — for a custom matcher
  whose semantics are negative — set `requiresEvidence: false` on the object it
  returns, or declare `evidence: 'inspect'` and assert in an `inspect` hook
  (which receives the workspace and the trace, so a check there is itself the
  evidence — the declaration vouches that the hook reads it). **The `inspect`
  exemption is by explicit declaration, not hook presence**: a case whose only
  anchor is an `inspect` hook must carry `evidence: 'inspect'`; declaring it
  without a hook, or carrying the hook without the declaration (and no matcher
  anchor), is refused. `requiresEvidence(matcher)`
  reports the verdict for a matcher. Cases with an empty `expect` and no
  declared inspect anchor are refused: nothing could make them fail.
  Out of the rule's scope: degenerate arguments (`toolSequence([])`,
  `finalTextIncludes('')`, `finalTextMatches(/.*/u)`), half-degraded
  `requestHeaders`, and a positive assertion about something unrelated to the
  case.

### Removed

- **The case-level `persona` field.** It emitted a `persona` config key the
  host's `SystemPrompt.Config` schema never had, so the key was silently inert
  — and because a row-config override whole-replaces the row, it also dropped
  the profile's `personaPrefix` / `personaSuffix`. A case declaring `persona`
  is now refused at load time. **Migrating a case that trips this**: declare
  `rowConfig: { 'system-prompt': { personaPrefix: '...', personaSuffix: '...' } }`
  instead, restating both keys the row still needs (the headless profile's
  baseline ships a `personaSuffix`).

### Fixed

- **`.runs/` post-mortem artifacts now identify their own run and never mix
  across runs.** Artifact dirs are wiped before each write, so one dir holds
  exactly one run's evidence (previously a run that materialized fewer
  session logs left the previous run's `session-*.jsonl` — or its whole
  `sessions/` tree — mixed into the new post-mortem). `trace.json` carries
  `startedAt`, and `EvalRunResult` exposes it, so evidence says which run it
  belongs to without relying on file mtimes. **Behavior change**: a passing
  run now removes its own stale `.runs/<case id>/` dir (unless
  `--keep-artifacts` is set) — the dir existing means the case's LAST run
  failed or was kept, instead of "some past run failed". `dsh-review` wipes
  its `.runs/<experiment id>/` at the start of each execution for the same
  reason (a shorter rerun no longer leaves stale `run-N.*` files behind).

## [0.3.0] — 2026-09-13

### Added

- **Projection census** on every case that produced a session trace:
  `census.eventTypeCounts` (the main session log's events per type),
  `census.projectionLengths` (the five projection lengths) with
  `census.projectionSkipped` naming where a count exceeds its projection length,
  `census.projectionFieldGaps` naming the events that projected while a field
  they carry went missing (the `tool/call` / `tool/result` / `request/header`
  projections are 1:1, so a moved field never shows up as a length difference),
  and `census.subagent` (the child logs behind `subagentChildren`: their
  `subagent/descriptor` event counts, how many carry the supported descriptor
  version, and the folded identity). The census reports numbers only and never
  decides whether a difference is a defect — it makes "the host log carried no
  such event" and "the projection dropped it" separable in `--format json` and
  in `.runs/<id>/trace.json`. Cases with no trace carry no census.
- Session-seam boundary assertions: `collectSessionTrace` reports which
  candidate artifact files were actually present when no session trace
  materializes (behavior failures name the host artifact naming instead of a
  bare "no session trace materialized"), and `parseSessionLog` refuses a
  `header.version` outside `KNOWN_SESSION_FORMAT_VERSIONS` with the version
  number instead of projecting empty fields. `EvalRunResult.traceGap` carries
  the diagnosis to the CLI failure text.

### Removed

- `loadTraceDir` (experimental): replaced by `collectSessionTrace`, which
  returns the trace together with the reason none was built. Migrate
  `loadTraceDir(root)` to `collectSessionTrace(root).trace`.
- **`options.dshRepoDir`** on `runEvalCase` (and the same legacy option on
  the review executor and `executeBehaviorExperiment`): the CLI location is
  now `options.cliPath` only. **Migrating a case that trips this**: resolve
  once with `resolveDshCliChain` (the `/experimental` export) and pass its
  `cli` result as `cliPath` — the `dsh-eval` / `dsh-review` CLIs already do
  this via `--repo`, the `node_modules` resolution layer, or the config
  `repo` key.

### Fixed

- **Mock mode against host 0.1.5-rc.2: the scripted adapter now carries its
  own `prepareCall`.** The host's LLM service dispatches every model call
  through `registration.adapter.prepareCall(...)`, a wire-contract step the
  adapter's inherited base class did not have — the base resolves from this
  package's `@deepseek-ai/dsh-llm` peer instance, which lagged the host
  runtime (0.0.1-rc.1 vs 0.1.5-rc.2), so every mock run died at startup with
  `registration.adapter.prepareCall is not a function`. The override mirrors
  the host base-class default (`{ model, stream }` bound to one adapter
  generation), making the wire contract independent of the peer instance's
  generation; the seam is now documented in `docs/host-wiring.md` with a
  maintenance trigger.
- `census.eventTypeCounts` counts prototype-named event types correctly: a
  plug-in event type such as `constructor` or `__proto__` used to produce a
  string-concatenated value or vanish from the map entirely, so a field named
  like a count could hold a non-number.
- Session-trace discovery follows the host's **format-generation artifact
  names**: `session.jsonl` for v0 and `session.vN.jsonl` for later
  generations (`session.v3.jsonl` on the current host). Matching only the v0
  name made every behavior case fail with "no session trace materialized"
  after the host bumped the session format.
- The multi-turn driver reads the durable log through
  `Session#snapshotEvents()`; the `session.events` getter it used was removed
  upstream, so any case declaring `followups` aborted the headless run with
  `agent.session.events is not iterable`.
- Review runs no longer fail open when no session artifact materializes:
  `validateToolBoundary` reports `status: 'not-executed'` (not a pass), the
  executor result carries the gap, the report states
  `tool boundary: NOT EXECUTED on run(s) N`, and both `run-N.txt` and
  `run.json` record it — a review whose tool face was never verified no longer
  reads as a normal one.

## [0.2.1] — 2026-09-09

### Added

- Subagent dispatch observability: `subagentChildren` projection plus
  `subagentDispatched` / `subagentCompleted` matchers.
- Multi-turn followups: cross-turn asynchronous driving for review
  experiments, with dispatch/completion count assertions.

### Changed

- `dsh-review` boots a **blank environment by default**: staged out-of-tree
  plugin rows are disabled via overlay, so host-profile gates/plugins can no
  longer steer or crash a reviewer. Pass `--keep-plugin-rows` (or executor
  option `keepPluginRows`) to opt back in deliberately.

### Fixed

- Review artifacts capture the reviewer's **answer**, not the last message:
  conclusions use the last assistant text before any plugin-sourced injection
  (trace-derived); the raw final message is kept as `run-N.stdout.txt` when it
  diverges, and each report run cites its transcript.

## [0.2.0] — 2026-09-06

### Changed

- **BREAKING (0.x minor)**: public API split into two tiers. The root entry
  is now the SDK tier only (assertion DSL, step builders, `runEvalCase`,
  `defineReviewExperiment`); low-level sandbox/overlay/trace primitives and
  review execution moved to the `./experimental` escape-hatch subpath.
- `exports` map added — deep path imports are now mechanically blocked.

## [0.1.0] — 2026-09-05

### Added

- Initial public release: case runner over dsh headless runs,
  session-trace assertions, and a scripted mock-LLM layer for plugin intent
  tests.
- CLI binaries `dsh-eval` (run cases) and `dsh-review` (LLM output review);
  `@deepseek-ai/dsh-llm` is a peerDependency provided by the host
  ecosystem.

[0.3.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.3.0
[0.2.1]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.1
[0.2.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.0
[0.1.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.1.0
