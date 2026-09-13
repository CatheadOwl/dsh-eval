---
description: Release history of @catheadowl/dsh-eval — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-eval` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

### Added

- **Projection census** on every case record: `census.eventTypeCounts` (the
  main session log's events per type), `census.projectionLengths` (the five
  projection lengths) with `census.projectionSkipped` naming where a count
  exceeds its projection length, and `census.subagent` (the child logs behind
  `subagentChildren`: their `subagent/descriptor` event counts and how many
  carry the supported descriptor version). The census reports numbers only and
  never decides whether a difference is a defect — it makes "the host log
  carried no such event" and "the projection dropped it" separable in
  `--format json` and in `.runs/<id>/trace.json`.
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

### Fixed

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

[0.2.1]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.1
[0.2.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.0
[0.1.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.1.0
