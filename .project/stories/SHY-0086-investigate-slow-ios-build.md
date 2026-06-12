---
id: SHY-0086
status: Draft
owner: claude
created: 2026-06-12
priority: P1
effort: M
type: spike
roadmap_ids: []
pr:
mvp: false
---

# SHY-0086: Investigate why the iOS build is slow (45+ min) + propose fixes

## User Story

As a ShyTalk developer shipping iOS,
I want the iOS build (KMP framework link + CocoaPods + xcodebuild) profiled so I understand WHERE the 45+ minutes go,
So that we can land targeted follow-up fixes that cut iOS CI/deploy wall-clock instead of guessing.

## Why

- iOS builds dominate every iOS CI/deploy cycle: `deploy-ios-prod` carries `timeout-minutes: 100`, and `smoke-test-ios` was just raised 20→45 (SHY-0084) precisely because the build alone consumed the whole 20-min budget before the boot step ran (prod run 27286731472 was cancelled mid-build). 45+ min per iOS build is a real, compounding cost on every release + every smoke.
- The likely cost centres are KNOWN (from the SHY-0084 work) but UNQUANTIFIED — we don't know which dominates:
  1. **K/N framework link forced serial:** `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64 --max-workers=1` (smoke) and the release link. The `--max-workers=1` is a deliberate workaround for a parallel Kotlin/Native link **deadlock** (commit 1b788059cb0). Serial linking is slow; if the deadlock is now resolvable, parallelising could be the single biggest win.
  2. **Cold `~/.konan` cache:** Kotlin/Native compiles its dependencies; a cold cache is very slow. Cache is split restore/save keyed on `hashFiles('gradle/libs.versions.toml')` — a miss (or a POST-save that hangs past timeout) costs minutes.
  3. **`pod install`** (CocoaPods) — no pods cache today.
  4. **`xcodebuild`** — including the `Compile Kotlin Framework` build phase that **re-invokes gradle** (so the framework may be effectively built twice: once via the explicit link step, once via the xcodebuild build phase).
  5. **GitHub-hosted `macos-latest`** runner baseline (no-self-hosted policy — not changing the runner, but quantify its share).
- This is a **spike**: measure first, then file targeted implementation follow-ups. No production behaviour change in this story.

## Acceptance Criteria

### Happy path

- [ ] A per-phase **time breakdown** of a representative iOS build is captured (from a real `deploy-ios-prod` and/or `smoke-test-ios` run, or a local instrumented run), attributing wall-clock to: konan cache restore, `:shared:link…Framework…`, `pod install`, `xcodebuild`, and the gradle re-invocation inside the `Compile Kotlin Framework` build phase. Numbers (seconds/min per phase) recorded in `## Notes`.
- [ ] The **dominant** cost centre(s) are identified with evidence (the phase(s) accounting for the majority of the 45+ min).
- [ ] Each plausible fix is assessed for **feasibility + estimated saving**, at minimum: (a) re-test whether the K/N parallel-link deadlock still reproduces on the current Kotlin/AGP (→ drop `--max-workers=1` if safe); (b) konan-cache hit-rate + whether the framework is built twice (explicit link step vs xcodebuild build phase) and whether one can be removed; (c) a CocoaPods cache.
- [ ] ≥1 fully-refined **follow-up implementation SHY** is filed for each recommended fix (with the estimated saving), per the spike Definition of Done.

### Error paths

- [ ] If a candidate fix is rejected (e.g. the K/N deadlock STILL reproduces without `--max-workers=1`), the spike records the evidence + the reason it's rejected (so it isn't re-investigated) rather than silently dropping it.

### Edge cases

- [ ] Cold-cache vs warm-cache builds are distinguished in the breakdown (the cold case is the worst case the smoke/deploy must fit; a warm-cache-only measurement would understate the problem).
- [ ] The `Compile Kotlin Framework` xcodebuild build phase's gradle invocation is checked for **redundancy** with the explicit `:shared:link…` step (double-build hypothesis).

### Performance

- [ ] The spike QUANTIFIES the current baseline (total + per-phase) and sets a target for the follow-ups (e.g. "halve cold-build wall-clock"); the spike itself adds no build-time cost (it's measurement + a doc).

### Security

- N/A — investigation/measurement only; no code path, no secrets, no user data.

### UX

- N/A — developer/CI-facing; no end-user surface. (Consumer = the developer waiting on iOS CI; the deliverable is a clear breakdown + actionable follow-ups.)

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The breakdown methodology is repeatable (documented commands / `--profile` flags / step timings) so build-time can be re-measured after the follow-up fixes land (to confirm the saving).

## BDD Scenarios

**Scenario: the 45+ minutes is attributed to phases**
- **Given** a representative iOS build (cold + warm)
- **When** the spike profiles it (gradle `--profile` / xcodebuild timing / CI step durations)
- **Then** `## Notes` contains a per-phase seconds/min breakdown summing to ~the total, identifying the dominant phase(s)

**Scenario: the `--max-workers=1` deadlock is re-tested**
- **Given** the current Kotlin/Native + AGP toolchain
- **When** the K/N framework is linked WITHOUT `--max-workers=1`
- **Then** the result (deadlock reproduces / no longer reproduces, with run evidence) is recorded, and a follow-up SHY is filed iff parallel linking is safe + saves time

**Scenario: each recommended fix becomes a follow-up SHY**
- **Given** the profiling identifies actionable wins
- **When** the spike concludes
- **Then** a fully-refined follow-up SHY exists for each recommended fix (with estimated saving), and the spike is closed with the decision recorded in `## Notes`

## Test Plan

Spike — the "tests" are the measurement methodology + the evidentiary record, not code.

- **Measure:** capture per-phase timings via (a) GitHub Actions step durations on real `deploy-ios-prod` / `smoke-test-ios` runs (`gh run view --json jobs` step timestamps), and (b) a local instrumented build: `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64 --profile` (reads the build scan / profile report), `time pod install`, `xcodebuild -showBuildTimingSummary`.
- **Cold vs warm:** one run with `~/.konan` + gradle caches cleared (cold) and one warm, to bound the range.
- **Deadlock re-test:** a local/CI link WITHOUT `--max-workers=1` to check the deadlock (commit 1b788059cb0 context) still applies.
- **Double-build check:** confirm whether the `Compile Kotlin Framework` xcodebuild build phase re-links the framework already built by the explicit step (compare gradle task execution in both).
- **Deliverable:** the breakdown + recommendations in `## Notes`; follow-up SHYs filed. No automated test added (investigation story).

## Out of Scope

- IMPLEMENTING the speed-ups — each becomes its own follow-up SHY (this story only measures + recommends).
- Switching off GitHub-hosted runners / introducing self-hosted Macs (forbidden by the no-self-hosted policy) — quantify the runner's share, don't change it.
- Android build time (separate concern).

## Dependencies

- None to start. Relates to SHY-0084 (which raised the iOS smoke timeout to 45 as a stop-gap) and the historic `--max-workers=1` K/N-link-deadlock fix (commit 1b788059cb0). UNBLOCKS the follow-up speed-up SHYs.

## Risks & Mitigations

- **Profiling on GitHub-hosted runners is noisy (run-to-run variance).** *Mitigation:* take ≥2 runs per case (cold/warm) and report ranges, not single points.
- **The dominant cost is the runner baseline (unfixable under no-self-hosted).** *Mitigation:* still quantify it so expectations are set; focus follow-ups on the fixable share (caching, double-build, parallel link).
- **Re-testing the K/N parallel-link deadlock burns CI cycles / reintroduces a hang.** *Mitigation:* test on a throwaway branch with a tight `timeout-minutes`; never merge a parallel-link change without the deadlock evidence.

## Definition of Done

- Per-phase iOS-build breakdown (cold + warm) recorded in `## Notes` with the dominant cost(s) identified.
- A feasibility + estimated-saving assessment for each candidate fix (parallel link, konan cache, double-build, pods cache).
- ≥1 fully-refined follow-up implementation SHY filed per recommended fix; rejected candidates recorded with evidence.
- Spike closed (status Done) with the decision summary in `## Notes` (spikes need no release/`released_in` — they ship findings, not code; the follow-up SHYs carry the implementation + release).

## Notes (running log)

- 2026-06-12 ~11:32 BST — Filed at operator request ("investigate why iOS building takes 45+ min — way too long"). Context from SHY-0084: `smoke-test-ios` timeout was raised 20→45 as a stop-gap because the BUILD ate the whole budget. Prime suspects (to quantify, not assume): serial K/N link (`--max-workers=1` deadlock workaround, commit 1b788059cb0), cold `~/.konan` cache, a possible double framework build (explicit `:shared:link…` + the xcodebuild `Compile Kotlin Framework` phase re-invoking gradle), no pods cache. **`mvp: false`** — classified as dev-velocity / CI-efficiency, NOT launch-blocking (the app ships fine regardless of build speed); flag to flip if you consider build-speed launch-scope.
