---
id: SHY-0090
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

# SHY-0090: Cache the CocoaPods compile in the iOS `xcodebuild archive` (gated on SHY-0088 measurement)

## User Story

As the ShyTalk operator releasing to prod,
I want the recompile-everything-from-source waste inside the 29-minute `xcodebuild archive` step removed by caching the largest measured sub-phase (suspected: the CocoaPods compile — LiveKit / WebRTC / SwiftProtobuf),
So that the dominant non-link chunk of the 56-min iOS deploy shrinks and, with SHY-0087's parallelism, the post-approval iOS path reaches the SHY-0086 target of < 60 minutes.

## Why

- **SHY-0086 profiling:** `xcodebuild archive` = 29m04s = 51% of the 56-min iOS deploy, with no Pods/DerivedData cache (only `~/.konan` is cached). LiveKit/WebRTC/SwiftProtobuf are the prime recompile-on-every-run suspects.
- **HARD gate on SHY-0088's measurement:** SHY-0088 adds `-showBuildTimingSummary` and records the app-Swift vs Pods-compile vs sign/package split from a real release. This story's cache target + path is chosen from that recorded split — NOT guessed. If the split shows the 29 min is pod-compile-dominated, cache the pod build products; if it shows app-Swift/whole-module-optimisation dominates, re-scope the cache target (or file a separate SHY) accordingly. **Do not begin implementation until SHY-0088's `## Notes` records the breakdown.**
- This is the largest fixable chunk after SHY-0087's parallelism win; together they target < 60-min post-approval iOS.

## Acceptance Criteria

### Happy path

- [ ] A cache is added for the measured-dominant archive sub-phase's build products (expected `iosApp/Pods` and/or the relevant `DerivedData` build-products dir), keyed on `hashFiles('iosApp/Podfile.lock')` plus a runner-image/Xcode version segment, using split `actions/cache/restore` (head of `deploy-ios-prod`) + tail `actions/cache/save` — mirroring the existing `~/.konan` cache's PR #951 pattern in the same job.
- [ ] On a warm-cache run, the `xcodebuild archive` step's wall-clock is **measurably lower** than the 29m04s cold baseline, with the saving quantified in `## Notes` from `gh api .../jobs` step timings.
- [ ] The produced IPA is byte-functionally equivalent (uploads to App Store Connect successfully; `altool` accepts it) — caching must not corrupt the signed archive.

### Error paths

- [ ] A cache MISS (cold or key change) still produces a correct archive in ≤ the current cold time. The save step is `continue-on-error: true` with `timeout-minutes`, and a restore miss simply rebuilds — no release is ever blocked by a cache problem (the PR #951 hang-class is structurally prevented by split restore/save).
- [ ] A stale/poisoned pod cache (e.g. Xcode minor bump changing ABI) is prevented by the runner-image/Xcode version segment in the cache key — a toolchain change forces a clean rebuild rather than linking incompatible objects.

### Edge cases

- [ ] `Podfile.lock` change (pod added/upgraded) busts the cache key → full clean pod compile (correctness over speed).
- [ ] The cache interacts correctly with the existing `cleanup-ios-signing` pre/post steps — cached build products must NOT include signing material, and the signing steps still run on a cache hit.
- [ ] Cold-cache worst case stays within the job's `timeout-minutes` budget (the cache only *adds* a restore step on miss; it must not push a cold run over budget).

### Performance

- [ ] Quantified saving on the `xcodebuild archive` step recorded in `## Notes`; combined with SHY-0087 the post-approval iOS path target is < 60 min. If SHY-0088's measurement showed the 29 min is NOT the assumed sub-phase, the cache target is re-scoped per that data and the rationale recorded here.

### Security

- N/A for the cache *contents* (build products only, no secrets) — BUT this AC explicitly forbids caching any signing material; the cache key + path MUST exclude the keychain / provisioning artifacts handled by `setup-ios-signing` / `cleanup-ios-signing`.

### UX

- N/A — CI-facing. Consumer = operator; deliverable = a faster, still-correct iOS deploy.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The cache `restore` step's `cache-hit` output and the (still-present from SHY-0088) `-showBuildTimingSummary` are both visible in the job log, so a warm vs cold run is distinguishable and the saving re-confirmable after future pod/Xcode changes.

## BDD Scenarios

**Scenario: warm pod cache shortens the archive**
- **Given** a prior run populated the `Podfile.lock`-keyed build-product cache
- **When** the next release runs with an unchanged `Podfile.lock` and unchanged runner image
- **Then** the `xcodebuild archive` step is measurably faster than the 29m04s cold baseline and the IPA still uploads successfully to App Store Connect

**Scenario: Podfile.lock change forces a clean rebuild**
- **Given** a pod is upgraded (Podfile.lock changes)
- **When** the release runs
- **Then** the cache key misses and pods are compiled cleanly, producing a correct archive

**Scenario: a toolchain bump forces a clean rebuild**
- **Given** the runner image / Xcode version changes (its segment is in the cache key)
- **When** the release runs against the old key
- **Then** the key misses and the archive rebuilds from source rather than linking ABI-incompatible cached objects

**Scenario: a cache failure never blocks a release**
- **Given** the GitHub cache backend is unavailable or the key is absent
- **When** the archive step runs
- **Then** it rebuilds from source (≤ cold baseline) and the release proceeds; the save step's `continue-on-error` + `timeout-minutes` swallow save failures/hangs

**Scenario: signing still runs on a cache hit**
- **Given** a warm cache hit on the build products
- **When** the archive + export run
- **Then** `setup-ios-signing` / `cleanup-ios-signing` still execute and no signing material was ever written into the cache

## Test Plan

- **RED:** add YAML-assertion cases to `express-api/tests/scripts/ios-deploy-archive-signing.test.js` (or a new sibling `ios-deploy-pod-cache.test.js`) asserting: (a) a pod-cache `restore` step exists in `deploy-ios-prod` keyed on `Podfile.lock`; (b) the cache key includes a runner-image/Xcode version segment; (c) the paired `save` step is `continue-on-error: true` with `timeout-minutes` and `if: always() && …cache-hit != 'true'`; (d) no cached path overlaps the signing-material paths handled by setup/cleanup-ios-signing. Fail against current YAML.
- **GREEN:** edit `deploy-prod.yml` (`deploy-ios-prod`) to add the split restore/save cache around the archive, with the path/key chosen from SHY-0088's recorded split. Re-run suite → green.
- **Live verification:** two real releases (cold then warm) recorded in `## Notes` with `gh api .../jobs` step timings showing the warm-run saving + a successful `altool` upload both times.

## Out of Scope

- **Instrumentation** — `-showBuildTimingSummary` is SHY-0088 (this story consumes its output).
- The K/N framework link time (22m49s) — that is SHY-0089.
- Switching pods to pre-built binary frameworks / SPM migration of LiveKit/WebRTC — a larger architectural change. If SHY-0088's measurement shows pod *source* compilation is unavoidable and uncacheable safely, file that as a separate SHY rather than expanding this one.

## Dependencies

- **HARD-gated on SHY-0088:** requires SHY-0088's recorded app-Swift vs Pods-compile vs sign/package split before the cache path/key are designed. Implementation must not start until SHY-0088's `## Notes` carries the breakdown from a real release.
- Builds on SHY-0086. Independent of SHY-0087 (shipped) and SHY-0089 (compose freely).

## Risks & Mitigations

- **Cached pod binaries cause subtle runtime corruption / ABI mismatch.** *Mitigation:* version-segmented cache key (runner image + Xcode); a successful `altool` upload + SHY-0087's parallel boot smoke on the same commit gate correctness; bust on `Podfile.lock`.
- **DerivedData is non-portable across runners (absolute-path hashes) and may not actually warm-hit.** *Mitigation:* SHY-0088's measurement + a cold-vs-warm A/B on real releases is the acceptance gate — if the warm run shows no saving, the cache is reverted rather than shipped as dead weight; consider caching only the portable `iosApp/Pods` source/build artifacts the measurement justifies.
- **A combined POST cache-save hangs past timeout (the #951 incident class).** *Mitigation:* split restore/save with explicit `timeout-minutes` + `continue-on-error` on save (the established pattern already used for `~/.konan` in this job).

## Definition of Done

- Pod build-product cache added to `deploy-ios-prod` (version-segmented, `Podfile.lock`-keyed, split restore/save, save non-fatal); no signing material cached.
- YAML-assertion tests green.
- Two real releases (cold + warm) recorded showing the warm saving + successful uploads; if no saving materialises, the cache is reverted and that outcome recorded.
- PR merged; `released_in: vX.Y.Z` set once the warm saving is verified on a real deploy.

## Notes (running log)

- 2026-06-12 — Filed by splitting SHY-0088 per the operator's "Measure first, cache next" decision. SHY-0088 ships the `-showBuildTimingSummary` instrumentation; this story consumes its recorded split to design the cache against real numbers instead of a blind guess. Carries the cache-specific ACs that originally lived in SHY-0088. **Blocked until SHY-0088 records a real-release breakdown.**
- 2026-06-12 — **SPM-vs-CocoaPods cache-key caveat (pickup-fitness discovery on SHY-0088).** `deploy-dev.yml`'s archive already uses SwiftPM (`-clonedSourcePackagesDirPath ../build/ios-spm-packages -parallelizeTargets`) — the #841 migration moved LiveKit CocoaPods→SPM — while `deploy-prod.yml` still runs a `pod install` step. So the 29-min compile may be **SwiftPM**, not CocoaPods. The cache key therefore depends on which it is: `Podfile.lock` for pods vs `Package.resolved` for SPM (the dev/prod archives may even need different keys). SHY-0088's `-showBuildTimingSummary` split settles which dependency system dominates; the AC's `Podfile.lock` keying above is the *expected* case, to be confirmed (or swapped to `Package.resolved`) against that measurement before implementing.
