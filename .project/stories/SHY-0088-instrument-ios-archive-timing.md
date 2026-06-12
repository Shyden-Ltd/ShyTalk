---
id: SHY-0088
status: In Progress
owner: claude
created: 2026-06-12
priority: P1
effort: S
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0088: Instrument the 29-minute iOS `xcodebuild archive` (measure before caching)

## User Story

As the ShyTalk operator releasing to prod,
I want the 29-minute `xcodebuild archive` step in `deploy-ios-prod` (and its `deploy-dev.yml` twin) instrumented with `-showBuildTimingSummary`,
So that the dominant non-link chunk of the 56-min iOS deploy is quantified per sub-phase (app-Swift compile vs CocoaPods compile vs sign/package) and the follow-up cache (SHY-0090) targets the *measured* bottleneck instead of a guess.

## Why

- **SHY-0086 profiling (run 27388236740):** `Build and archive iOS app` (`xcodebuild archive`, Release) = **29m04s**, the single largest step of the 56-min iOS deploy (51%), even after the KMP framework is pre-linked in a separate 22m49s step.
- **Pickup-fitness 2026-06-12:** the live `deploy-ios-prod` job caches only `~/.konan` (no `iosApp/Pods` / DerivedData cache) and the archive `xcodebuild` invocation carries no `-showBuildTimingSummary`. Premise confirmed against the workflow as it stands.
- **Measure before caching (operator scope decision 2026-06-12, "Measure first, cache next"):** `xcodebuild` emits no per-target timings by default, so the exact app-Swift vs Pods-compile vs sign/package split is unknown. Caching blind risks caching the wrong thing (e.g. fragile DerivedData) or a correctness bug in the *release* pipeline — the highest-stakes place to be wrong. The well-known big wins (prebuilt binary pods / SPM migration) are out of scope here. So this story ships ONLY the cheap, safe, additive instrumentation; the cache is designed against real numbers in **SHY-0090** once a prod release produces the breakdown.
- `-showBuildTimingSummary` adds negligible wall-clock (a build-log summary table) but high diagnostic value, repeatable on every future run.

## Acceptance Criteria

### Happy path

- [ ] The `xcodebuild … archive` invocation in `deploy-prod.yml`'s `deploy-ios-prod` job runs with `-showBuildTimingSummary`, so the post-build per-phase summary (per-target compile times, especially the Pods targets) is emitted to the job log.
- [ ] The same flag is added to `deploy-dev.yml`'s `distribute-ios` archive invocation for parity (dev is where releases are rehearsed; the measurement should be available there too).
- [ ] The flag is on the `archive` invocation specifically, NOT the separate `-exportArchive` invocation (export does no compilation, so timing it is meaningless).

### Error paths

- [ ] `-showBuildTimingSummary` is diagnostic-only: it changes no build setting, signing, or output artifact, so it cannot fail an otherwise-passing archive. A build that fails for an unrelated reason still fails the same way (no masking).

### Edge cases

- [ ] The flag is unconditional (not gated behind an `if:`/env toggle) so the summary is present on every run, including the very first post-merge release that feeds SHY-0090.
- [ ] Adding the flag does not push the archive step past its existing `timeout-minutes: 50` guard (a log summary costs seconds, not minutes).

### Performance

- [ ] No measurable build-time regression from the flag itself (it reports time already spent; it does not add compilation). The *value* delivered is the measurement, recorded in `## Notes` from the first real release, which then sizes SHY-0090's cache target.

### Security

- N/A — `-showBuildTimingSummary` emits only target names + durations to the build log; no secrets, paths-with-tokens, or signing material are exposed. (Target names like `LiveKit`/`WebRTC` are already public dependencies.)

### UX

- N/A — CI-facing. Consumer = operator; deliverable = a measured archive breakdown that unblocks the cache work.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The `-showBuildTimingSummary` output remains in the job log on every run (unconditional flag), so the split is re-confirmable after future pod/Xcode changes — this is the whole point of the story.

## BDD Scenarios

**Scenario: the archive emits a per-target timing summary**
- **Given** `deploy-ios-prod`'s archive step with `-showBuildTimingSummary` on the `archive` invocation
- **When** a release runs
- **Then** the job log shows the per-target build-timing summary table (incl. the CocoaPods targets) and `## Notes` records the app-Swift vs Pods-compile vs sign/package shares

**Scenario: dev and prod stay in parity**
- **Given** both `deploy-prod.yml` (`deploy-ios-prod`) and `deploy-dev.yml` (`distribute-ios`) archive the iOS app
- **When** the YAML-assertion suite runs
- **Then** both workflows' `archive` invocations contain `-showBuildTimingSummary` and neither's `-exportArchive` invocation does

**Scenario: instrumentation never breaks a release**
- **Given** the diagnostic flag is the only change to the archive invocation
- **When** an archive runs (passing or failing for unrelated reasons)
- **Then** the flag alters no artifact/signing/exit behaviour — a green archive stays green, a red one fails identically

## Test Plan

- **RED:** add a new `describe('iOS deploy archive timing instrumentation (SHY-0088)')` block to `express-api/tests/scripts/ios-deploy-archive-signing.test.js` (the archive-focused home that already runs `test.each(['deploy-dev.yml','deploy-prod.yml'])` with the comment-stripping helper). Assertions: (a) for each workflow, isolate the `xcodebuild … archive` invocation (lazy match terminating at the bare `archive` subcommand, not `-exportArchive`) and assert it contains `-showBuildTimingSummary`; (b) assert the flag is NOT present on the `-exportArchive` invocation. Fails against current YAML (flag absent).
- **GREEN:** add `-showBuildTimingSummary \` to the `archive` invocation in `deploy-prod.yml` (`deploy-ios-prod`) and `deploy-dev.yml` (`distribute-ios`). Re-run the suite → green.
- **Live verification:** the next real prod release's `deploy-ios-prod` job log shows the timing summary; the app-Swift vs Pods-compile vs sign/package split is recorded in `## Notes`. That recorded split is the input to SHY-0090's cache design.

## Out of Scope

- **The cache itself** — caching the CocoaPods compile / DerivedData build products is now **SHY-0090** (gated on this story's measurement, per the operator's "measure first, cache next" decision).
- The K/N framework link time (22m49s) — that is SHY-0089.
- The serial iOS-smoke chain — that was SHY-0087 (shipped).
- Switching pods to pre-built binary frameworks / SPM migration of LiveKit/WebRTC — a larger architectural change; if the measurement shows pod *source* compilation is the unavoidable bottleneck, SHY-0090 decides whether to file that separately.

## Dependencies

- Builds on SHY-0086 (the spike that found the 29-min archive).
- **Unblocks SHY-0090:** SHY-0090's cache design is HARD-gated on the per-phase split this story measures. SHY-0090 must not start its cache implementation until this story's `## Notes` records the breakdown from a real release.
- Independent of SHY-0087 (shipped) and SHY-0089 (compose freely).

## Risks & Mitigations

- **The measurement reveals the 29 min is NOT pod-compile-dominated (e.g. app-Swift or whole-module-optimisation).** *Mitigation:* that is the explicit *purpose* of measuring first — SHY-0090 reads this story's recorded split and scopes its cache (or re-scopes to a different target) accordingly, rather than this story having shipped an ineffective/fragile cache blind.
- **`-showBuildTimingSummary` output is verbose and clutters the log.** *Mitigation:* it is a single end-of-build summary table, not per-file spam; the diagnostic value far outweighs the log volume, and it is the canonical Apple-supported way to size an archive.
- **Flag placed on the wrong `xcodebuild` invocation (export instead of archive).** *Mitigation:* the RED test isolates the `archive` invocation and asserts the flag is on it and NOT on `-exportArchive`.

## Definition of Done

- `-showBuildTimingSummary` on the `archive` invocation in both `deploy-prod.yml` (`deploy-ios-prod`) and `deploy-dev.yml` (`distribute-ios`); absent from both `-exportArchive` invocations.
- YAML-assertion tests green (`ios-deploy-archive-signing.test.js`).
- One real prod release's `deploy-ios-prod` job log shows the timing summary; the app-Swift vs Pods-compile vs sign/package split recorded in `## Notes`.
- SHY-0090 (cache) filed and refined, gated on the recorded split.
- PR merged; `released_in: vX.Y.Z` set once the split is verified on a real deploy.

## Notes (running log)

- 2026-06-12 — Filed by SHY-0086 (originally "instrument + cache"). Origin: `xcodebuild archive` = 29m04s = 51% of the 56-min iOS deploy, no Pods/DerivedData cache; LiveKit/WebRTC/SwiftProtobuf are the prime recompile suspects.
- 2026-06-12 — **Pickup-fitness + re-scope.** Re-validated against the live `deploy-prod.yml` (modified 19:33 by SHY-0087's smoke parallelization, which did NOT touch the archive): premise confirmed — only `~/.konan` is cached, the archive invocation has no `-showBuildTimingSummary`, `pod install` is its own step, `cleanup-ios-signing` runs `if: always()`. Surfaced the design fork to the operator (the cache target depends on a measurement only a real prod release yields, yet the original DoD shipped both together). **Operator chose "Measure first, cache next."** This story is re-scoped to **instrument-only** (effort M→S; title + filename updated from `cache-cocoapods-instrument-ios-archive`); the cache moves to **SHY-0090**, gated on the breakdown this story records. Rationale: don't ship an unproven/fragile DerivedData cache into the prod release pipeline; the industry big-wins (binary pods / SPM) are out of scope; instrument first is the QA-honest path.
