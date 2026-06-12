---
id: SHY-0088
status: Draft
owner: claude
created: 2026-06-12
priority: P1
effort: M
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0088: Instrument + cache the 29-minute iOS `xcodebuild archive` (CocoaPods compile)

## User Story

As the ShyTalk operator releasing to prod,
I want the 29-minute `xcodebuild archive` step in `deploy-ios-prod` instrumented and then cached,
So that the dominant non-link chunk of the 56-min iOS deploy is quantified by sub-phase and the recompile-everything-from-source waste (CocoaPods: LiveKit / WebRTC / SwiftProtobuf) is removed.

## Why

- **SHY-0086 profiling (run 27388236740):** `Build and archive iOS app` (`xcodebuild archive`, Release) = **29m04s**, the single largest step of the 56-min iOS deploy (51%), even after the KMP framework is pre-linked in a separate 22m49s step so xcodebuild's nested gradle phase finds it UP-TO-DATE.
- **Strong suspect:** the 29 min is dominated by compiling the CocoaPods dependencies (LiveKit, WebRTC, SwiftProtobuf) from source on every archive, with **no Pods/DerivedData cache** between runs (the workflow caches only `~/.konan` and gradle, not `iosApp/Pods` or xcodebuild's build products). `pod install` itself is a separate 2m20s step; the *compilation* of those pods is inside the 29 min.
- **Two-step approach (instrument, then cache):** the exact Swift-app-compile vs pod-compile vs sign/package split isn't yet measured — `xcodebuild` doesn't emit per-target timings by default. Add `-showBuildTimingSummary` first to size each sub-phase, *then* cache the largest fixable one. Caching blind risks caching the wrong thing or a correctness bug (stale pod binaries).
- This attacks the largest fixable chunk after SHY-0087's parallelism win; together they target the SHY-0086 goal of a < 60-min post-approval iOS path.

## Acceptance Criteria

### Happy path

- [ ] `xcodebuild archive` in `deploy-ios-prod` runs with `-showBuildTimingSummary`; the per-phase breakdown (per-target compile times, especially the Pods targets) is captured in the job log and the headline split (app-Swift vs Pods vs sign/package) recorded in this story's `## Notes`.
- [ ] A cache is added for the CocoaPods build products (`iosApp/Pods` and/or the relevant `DerivedData` build-products dir), keyed on `hashFiles('iosApp/Podfile.lock')` (+ Xcode/runner-image version component to avoid ABI mismatch), using split `actions/cache/restore` + tail `actions/cache/save` (the ios-tests.yml PR #951 pattern, so a slow cache backend can't hang past `timeout-minutes`).
- [ ] On a warm-cache run, the `xcodebuild archive` step's wall-clock is **measurably lower** than the 29m04s cold baseline, with the saving quantified in `## Notes` from `gh api .../jobs` step timings.
- [ ] The produced IPA is byte-functionally equivalent (uploads to App Store Connect successfully; `altool` accepts it) — caching must not corrupt the signed archive.

### Error paths

- [ ] A cache MISS (cold or key change) still produces a correct archive in ≤ the current cold time (cache restore failure is non-fatal — `continue-on-error` on save, restore miss just rebuilds). No release is ever blocked by a cache problem.
- [ ] A stale/poisoned pod cache (e.g. Xcode minor bump changing ABI) is prevented by including a runner-image/Xcode version segment in the cache key so a toolchain change forces a clean rebuild rather than linking incompatible objects.

### Edge cases

- [ ] `Podfile.lock` change (pod added/upgraded) busts the cache key → full clean pod compile (correctness over speed).
- [ ] The cache interacts correctly with the existing `cleanup-ios-signing` pre/post steps — cached pod *build products* must not include signing material, and the signing steps must still run on a cache hit.
- [ ] Cold-cache worst case stays within the job's `timeout-minutes: 100` (the cache only *adds* a restore step on miss; it must not push a cold run over budget).

### Performance

- [ ] Quantified saving on the `xcodebuild archive` step recorded in `## Notes`; combined with SHY-0087 the post-approval iOS path target is < 60 min. If instrumentation shows the 29 min is NOT pod-compile-dominated (e.g. it's app-Swift or LTO), record that and re-scope the cache target accordingly (the instrument step is the gate on the cache design).

### Security

- N/A for the cache contents (build products only, no secrets) — BUT the AC explicitly forbids caching any signing material; the cache key + path must exclude the keychain / provisioning artifacts handled by `setup-ios-signing` / `cleanup-ios-signing`.

### UX

- N/A — CI-facing. Consumer = operator; deliverable = a faster, still-correct iOS deploy.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The `-showBuildTimingSummary` output remains in the job log on every run (repeatable measurement), so the saving can be re-confirmed after future pod/Xcode changes.

## BDD Scenarios

**Scenario: the 29-minute archive is split by sub-phase**
- **Given** `deploy-ios-prod`'s archive step with `-showBuildTimingSummary`
- **When** a release runs
- **Then** the job log shows per-target build times and `## Notes` records the app-Swift vs Pods-compile vs sign/package shares

**Scenario: warm pod cache shortens the archive**
- **Given** a prior run populated the `Podfile.lock`-keyed pod build cache
- **When** the next release runs with an unchanged `Podfile.lock`
- **Then** the `xcodebuild archive` step is measurably faster and the IPA still uploads successfully

**Scenario: Podfile.lock change forces a clean rebuild**
- **Given** a pod is upgraded (Podfile.lock changes)
- **When** the release runs
- **Then** the cache key misses and pods are compiled cleanly, producing a correct archive

**Scenario: a cache failure never blocks a release**
- **Given** the GitHub cache backend is unavailable or the key is absent
- **When** the archive step runs
- **Then** it rebuilds from source (≤ cold baseline) and the release proceeds; the save step's `continue-on-error` swallows save failures

## Test Plan

- **RED:** add YAML-assertion cases to `express-api/tests/scripts/deploy-prod-single-gate-and-smoke.test.js` (or a new sibling) asserting: (a) the archive step's `run` contains `-showBuildTimingSummary`; (b) a pod-cache `restore` step exists keyed on `Podfile.lock`; (c) the paired `save` step is `continue-on-error: true` with `timeout-minutes`; (d) the cache key includes a runner-image/Xcode version segment; (e) no cached path overlaps the signing-material paths. Fail against current YAML.
- **GREEN:** edit `deploy-prod.yml` (and mirror the instrument-only change into `deploy-dev.yml`'s `distribute-ios` if it shares the archive step, for parity). Re-run suite → green.
- **Live verification:** two real releases (cold then warm) recorded in `## Notes` with `gh api .../jobs` step timings showing the warm-run saving + a successful `altool` upload both times.
- **Local instrumented build (optional, for the instrument phase):** `xcodebuild archive … -showBuildTimingSummary` on a Mac, cold vs warm `iosApp/Pods`, to pre-size the cache target before the CI change.

## Out of Scope

- The K/N framework link time (22m49s) — that is SHY-0089.
- The serial iOS-smoke chain — that is SHY-0087.
- Switching pods to pre-built binary frameworks / SPM migration of LiveKit/WebRTC — a larger architectural change; if instrumentation shows pod *source* compilation is unavoidable, file a separate SHY for that, don't expand this one.

## Dependencies

- Builds on SHY-0086. Independent of SHY-0087 (compose freely) and SHY-0089. The instrument sub-step is an internal gate: its output decides the cache design, but it ships in the same PR (instrument + cache together, since instrument alone adds CI time with no benefit).

## Risks & Mitigations

- **Cached pod binaries cause subtle runtime corruption / ABI mismatch.** *Mitigation:* version-segmented cache key (runner image + Xcode); the AC requires a successful `altool` upload + (via SHY-0087's parallel smoke) a boot check on the same commit; bust on `Podfile.lock`.
- **Instrumentation reveals the 29 min is NOT pod-compile (e.g. app-Swift or whole-module-optimisation).** *Mitigation:* the AC makes the cache target conditional on the instrument result; re-scope rather than ship an ineffective cache.
- **A combined POST cache-save hangs past timeout (the #951 incident class).** *Mitigation:* split restore/save with explicit `timeout-minutes` + `continue-on-error` on save.

## Definition of Done

- `xcodebuild archive` instrumented with `-showBuildTimingSummary`; sub-phase split recorded in `## Notes`.
- Pod build-product cache added (version-segmented, `Podfile.lock`-keyed, split restore/save, save non-fatal); no signing material cached.
- Two real releases (cold + warm) recorded showing the warm saving + successful uploads; YAML-assertion tests green.
- PR merged; `released_in: vX.Y.Z` set once verified on a real deploy.

## Notes (running log)

- 2026-06-12 — Filed by SHY-0086. Origin: `xcodebuild archive` = 29m04s = 51% of the 56-min iOS deploy, with no Pods/DerivedData cache; LiveKit/WebRTC/SwiftProtobuf are the prime recompile suspects. Instrument-then-cache (don't cache blind). Second-priority after SHY-0087's parallelism win.
