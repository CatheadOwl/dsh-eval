---
description: Release history of @catheadowl/dsh-eval — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-eval` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

### Changed

- `dsh-review` reviewer sessions now boot a **blank environment by default**:
  every out-of-tree plugin row the staged profile composes (out-of-tree
  bundles in `dsh.profile.bundles` plus the profile's own patch rows) is
  disabled via overlay, so host-profile gates/plugins can no longer steer or
  crash a reviewer. Model/session wiring rows are always kept. Pass
  `--keep-plugin-rows` (or executor option `keepPluginRows`) to opt back
  into the host plugin face deliberately (e.g. reviewing a plugin's own
  gates).

### Fixed

- Review artifacts now capture the reviewer's **answer**, not the last
  message: `run-N.txt` and the report's per-run conclusions use the last
  assistant text before any plugin-sourced injection (trace-derived), so a
  tail interaction (e.g. a gate splice) no longer replaces the analysis
  with an infra complaint. The raw final message is kept as
  `run-N.stdout.txt` when it diverges, and each report run cites its
  transcript (`run-N.stderr.txt`).

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

[0.2.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.0
[0.1.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.1.0
