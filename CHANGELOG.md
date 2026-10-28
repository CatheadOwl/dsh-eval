---
description: Release history of @catheadowl/dsh-eval — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-eval` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [0.5.4] — 2026-10-29

### Added

- **Turn-death diagnosis rides the failure line.** A case whose dsh CLI
  exits non-zero now carries the last stderr line in the failure itself
  (`dsh CLI exited with code N (the turn did not complete): <death line>`),
  and the `NO_ADAPTER: no adapter registered for provider "X"` signature
  earns a stage-gap hint (recorded in the case's failures and printed on
  stderr): the sandbox home stages the profile directory and managed
  credentials only — the machine-level home-layer patch never enters the
  sandbox — so a provider whose adapter row lives there must be restated
  into the profile patch (docs/host-wiring/model-selection.md); the
  home-layer row of the same id wins on real runs, so an equal-value
  restatement changes no real behavior. Motivated by the 2026-10-28
  glm-e2e incident where the failure line said only "the turn did not
  complete" while the death sat in `artifacts/stderr.txt`.

## [0.5.3] — 2026-10-27

### Changed

- **Consumer-pilot frictions answered in the docs.** environment.md
  staging boundary now states the mechanism facts: junctions are
  recreated as links and never followed (no expansion-through-copy), the
  profile's own `node_modules` is re-junctioned to the real store
  (same-machine invariant), and staged homes need no home-level runtime
  materialization (the driven CLI injects its install closure into the
  resolvers at boot). cli-resolution.md and both READMEs: pin
  `@deepseek-ai/dsh` to the same version as the CLI your profiles run
  on — a driving-vs-production generation mismatch silently produces
  false verdicts. README: pnpm-workspace projects give eval its own
  npm-managed directory instead of installing into the workspace.

## [0.5.2] — 2026-10-26

### Changed

- **Install face: npm host co-install is the default, zero peer wiring.**
  Requirements now read `npm i -D @deepseek-ai/dsh @catheadowl/dsh-eval` —
  the host's dependency tree ships a same-generation `dsh-llm`, so the
  peer is satisfied without any manual wiring. The built checkout
  (previously stated as required) is an optional host source via
  `--repo`; manual peer wiring applies only to eval-only installs with
  no host in the tree (npm then auto-installs an incompatible antique
  `latest` of `@deepseek-ai/dsh-llm`). Verified 2026-10-26: two-line
  cold install + shipped `headless` profile passes a mock case end to
  end. Config example drops the legacy `repo` key; the real-run example
  leads with the install-tree CLI resolution.
- **Cold-start path completed**: the quickstart now carries the one-time
  plugin-install step (`dsh plugin add` forwards to pnpm — prerequisite
  stated with the corepack/npm remedy), `npx` invocation for the local
  bins, the `mode` default (`'real'`), and a link to a complete
  real-case example ([docs/intent-cases.md](docs/intent-cases.md) gains
  a minimal full example). credentials.md names the env var
  (`DEEPSEEK_API_KEY` for the default deepseek route), the default home
  (`~/.dsh`), and Node `^22.19 || >=24` is stated in the README.

## [0.5.1] — 2026-10-25

### Fixed

- **Review blank-environment lockdown tracks the host 0.2.1-rc.3 base
  template.** The static disabled-row list gains `tool-working-directory` —
  a new base row mounting a model-visible `working_directory` tool that
  would fail the tool-boundary check on every review run — and drops rows
  the host no longer ships (`tool-ralph`, `tool-str-replace-editor`,
  `tool-subagent-report`).

### Changed

- **Docs face: `docs/host-wiring.md` is now the `docs/host-wiring/` topic
  folder** (peer resolution, CLI resolution, host contracts, model
  selection, and credentials as per-topic pages) and a new
  `docs/environment.md` page covers experiment-environment discipline;
  follow the README docs table for the new paths.

## [0.5.0] — 2026-10-02

### Added

- **`mountedToolSchema` / `trace.mountedTools`: the wiring face for tool
  schemas.** The raw request-header tool entries (`{ name, description,
  parameters }` — the schema face the model sees) are now projected as a
  name-deduped mounted catalog (later headers override), and
  `mountedToolSchema(name, predicate)` asserts a mounted tool's schema shape
  without scripting any tool call. Registration-time schema violations
  already kill the boot (the run goes red); this covers the
  boots-but-drifted class — raw-layer vocabulary drift, parameter-set drift.
- **`systemPromptExcludes` / `promptBefore`: prompt-face negative and ordering
  matchers.** `systemPromptExcludes(substring)` asserts the assembled system
  prompt does NOT contain a substring (the conditional-injection discipline —
  an empty section is dropped, not injected as a stub) while refusing an
  absent prompt surface exactly like `systemPromptIncludes`, so it has no
  vacuous-pass path and is a positive-polarity evidence anchor rather than a
  negative matcher. `promptBefore(before, after)` asserts the first occurrence
  of `before` precedes the first occurrence of `after` in the effective prompt
  (section-ordering contracts of injection-style plugins); a missing operand
  fails loudly naming it, and an empty-string operand is rejected at factory
  time (it would otherwise pass vacuously as `indexOf('') === 0`).
- **`dsh-review --judge`: machine first-pass grading for comprehension review.**
  One extra dispatch through the same blank-environment executor sees the hidden
  rubric (which the blind reviewers never saw), the byte-identical observations,
  and every successful reviewer's answer, then prefills the report's three
  human columns under a fixed four-section contract (`Verdicts` / `Intentional
  design hits` / `New red flags` / `Next step`). Judge output is evidence,
  never an exit-code gate; contract-violating output is recorded loudly as
  `unparsed` (`judge.txt` raw + `judge.json` accounting, `run.json` judge field
  with profile + judgedAt). The three human-judgment sections remain the
  authoritative record — the judge narrows what a human must read. Programmatic
  primitives on the `experimental` subpath (`buildJudgeTask` /
  `executeReviewJudge` / `parseJudgeOutput` / `loadRubricText` /
  `JUDGE_OUTPUT_SECTIONS`).

### Changed

- **Session-log parsing tracks the host's current format generation (v4).**
  `KNOWN_SESSION_FORMAT_VERSIONS` moves from v3 to v4 together with the
  six-projection re-verification; stale v3 artifacts no longer parse (fresh
  runs are unaffected — eval only reads the artifacts its own runs write
  through the staged host).
- **Source matchers and injection classification read v4 producer-owned
  sources.** `userMessageTextIncludes` / `userMessageTextExcludes` match
  `source.kind` (e.g. `'gates'`, `'enrichment'`) instead of the retired
  `source.plugin` wrapper; `answerText` cuts at the first formless non-user
  injection landing after the first substantive assistant text (declared
  context forms and pre-answer setup no longer cut the answer chain); the
  mock-determinism hint names formless injectors the same way.
  Migrating: string/RegExp source matchers keep working where the producer's
  `kind` equals its former plugin id (e.g. `'gates'`); predicates over the
  full `source` object must switch from `.plugin` to `.kind`.
- **Review tasks ride stdin** (`-` positional, natively supported by the host
  headless app) instead of the command line: the judge dispatch's task — rubric
  + observations + every successful reviewer's answer — exceeds the Windows
  command-line ceiling and dies `ENAMETOOLONG` before the CLI even boots.
  `spawnHeadlessDsh` gains an optional `input`; reviewer and judge dispatches
  now share one path.

### Fixed

- **Review runs no longer fail the tool-boundary check on host 0.1.6 plan
  mode.** The base template's `plan-mode` row keeps `exit_plan_mode` in the
  request tool catalog "across modes for request-cache stability", and the
  blank-environment static disable list (host template rows never appear in
  the out-of-tree enumeration) did not cover it — on such hosts every review
  run died as a tool-boundary violation. The list now includes `plan-mode`.

## [0.4.2] — 2026-09-19

### Fixed

- **Review runs no longer degrade to a constant `not-executed` tool-boundary
  verdict on zstd-writing hosts.** The review adapter's blank-environment
  overlay never pinned the session-log config, so the host default (zstd
  compression) wrote `session.vN.jsonl.zstd`, which the artifact collector
  cannot match — every run reported `tool boundary: NOT EXECUTED on run(s) N`. Both eval
  overlays (behavior and review) now share one `overlaySessionLogRow` that
  pins `root` to the collection root and `compression: none`; the pin
  applies in `--keep-plugin-rows` mode too.

## [0.4.1] — 2026-09-14

### Changed

- **Session-log parsing is format-v3 only.** `KNOWN_SESSION_FORMAT_VERSIONS`
  collapses to `v3`: older generations (v0–v2) are refused at the
  `parseSessionLog` admission exactly like unknown ones — no legacy-format
  compatibility is carried (the repo's no-legacy-compat design rule). The
  pre-v3 read channels are gone with them: `requestHeaders[].system` is
  removed from the trace shape (read `systemMessages` / `systemPrompt`),
  `systemPromptIncludes` loses its pre-v3 fallback, and the census gap
  `headerWithoutSystem` (a pre-v3 moved-field signal) is removed —
  `promptSurfaceAbsent` is the prompt-channel signal. **Migrating a consumer
  that read `requestHeaders[].system`**: switch to `trace.systemPrompt`.

### Fixed

- **`systemPromptIncludes` was dead on format-v3 hosts.** The matcher read
  only the pre-v3 `request/header.system` channel, which v3 dropped by design
  (the prompt moved to streaming `system/message` surface events), so any
  prompt-surface guard could never pass on a v3 session. It now reads the
  folded v3 surface and, when no prompt surface exists at all, fails loud as
  a channel absence instead of reading as "the prompt lacks the substring".

### Added

- **`EvalTrace.systemMessages` / `EvalTrace.systemPrompt`: the format-v3
  system-prompt surface.** Surviving `system/message` nodes folded over
  append/replace surface ops (surface order), plus the effective prompt (the
  newest non-empty node). Census gains the channel-level `promptSurfaceAbsent`
  gap: requests exist yet no `system/message` nodes do — the "cannot see the
  prompt at all" shape.

## [0.4.0] — 2026-09-14

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
  generation; the seam is now documented in `docs/host-wiring/host-contracts.md` with a
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

[0.5.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.5.0
[0.4.2]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.4.2
[0.4.1]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.4.1
[0.3.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.3.0
[0.2.1]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.1
[0.2.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.2.0
[0.1.0]: https://github.com/CatheadOwl/dsh-eval/releases/tag/v0.1.0
