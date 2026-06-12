---
id: SHY-0089
status: Draft
owner: claude
created: 2026-06-12
priority: P2
effort: M
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0089: Build-cache the 22-minute Kotlin/Native iOS framework link

## User Story

As the ShyTalk operator releasing to prod,
I want the 22-minute `linkReleaseFrameworkIosArm64` / `linkDebugFrameworkIosArm64` step reused across jobs and runs via a gradle build cache,
So that the second-largest chunk of the 56-min iOS deploy stops being re-paid from cold on every release and every iOS job.

## Why

- **SHY-0086 profiling (run 27388236740):** `Build KMP shared framework for iOS` (`linkReleaseFrameworkIosArm64` + `linkDebugFrameworkIosArm64`, `--max-workers=1`) = **22m49s** (40% of the iOS deploy). The simulator-target link in `smoke-test-ios` adds a further **15m03s**. The shared `~/.konan` cache restored in <1s yet the link still took 22 min — confirming `~/.konan` holds the *compiler/stdlib* layer, **not** the project's own link outputs.
- **Hypothesis to validate:** a gradle **build cache** (Gradle's task-output cache, backed by a GitHub Actions cache so it persists across runners/runs) could let the K/N link tasks restore their outputs when inputs are unchanged, instead of relinking from scratch. This is distinct from the gradle *dependency*/configuration cache already provided by `setup-gradle`.
- **Explicitly feasibility-gated (P2, lower confidence than SHY-0087/0088):** K/N link outputs are large; a cache that takes nearly as long to restore as the link takes to run is net-negative. And K/N relinking is sensitive to the full classpath — the cache hit-rate across release commits (where `:shared` source changes) may be low. This SHY must *measure* hit-rate + restore-time before committing, and is allowed to conclude "not worth it" with evidence (per the SHY-0086 rejected-candidate discipline).

## Acceptance Criteria

### Happy path

- [ ] Gradle build caching is enabled for the `:shared` K/N link tasks (`org.gradle.caching=true` + a GitHub-Actions-backed remote/local build cache, e.g. `gradle/actions/setup-gradle`'s cache or `actions/cache` over the gradle build-cache dir), keyed so outputs survive across the iOS jobs and across consecutive releases.
- [ ] On a run where `:shared` inputs are UNCHANGED from a cached run, the link step restores from cache and its wall-clock is **materially** below the 22m49s cold baseline (target: a cache restore + up-to-date check that is a large fraction faster), quantified in `## Notes` from `gh api .../jobs` timings.
- [ ] The cache is shared so the `smoke-test-ios` simulator-target link also benefits where its inputs overlap (or a documented finding that device vs simulator targets share no cacheable link output, in which case the cache scope is device-only).

### Error paths

- [ ] A cache miss or a corrupt/incompatible cache entry falls back to a clean link (≤ cold baseline) — never a broken framework. Build-cache correctness is guaranteed by gradle's input-hashing; a poisoned entry can only occur on a gradle/K/N version change, which changes the task fingerprint and misses cleanly.
- [ ] Cache save failure is non-fatal (`continue-on-error` + `timeout-minutes` on any explicit save step, per the #951 hang-class).

### Edge cases

- [ ] A `:shared` source change (the common case on a release commit) busts the relevant task outputs → relink only the changed tasks (gradle incremental), not a guaranteed full cold link — measure the *partial-change* case, not just the no-change case.
- [ ] A gradle or Kotlin version bump (changes the K/N compiler) invalidates the build-cache fingerprint → clean relink (correctness preserved).
- [ ] Interaction with `--max-workers=1` (the parallel-K/N-link deadlock workaround, commit 1b788059cb0): the build cache must not reintroduce the deadlock; if a cache hit removes the need to link at all, the workaround is moot for that run, but a partial miss still links under `--max-workers=1`.

### Performance

- [ ] **Net-positive gate:** the AC requires `(cold_link_time − warm_link_time) > cache_restore_time` on the measured warm run, with all three numbers in `## Notes`. If the cache restore costs more than it saves (large K/N outputs), the SHY is closed as **rejected with evidence** rather than shipped.
- [ ] Measured hit-rate across ≥3 consecutive real release commits recorded — if hit-rate is near-zero because `:shared` changes every release, that is the rejection evidence.

### Security

- N/A — build-output cache only; no secrets. (Build caches can in principle leak source via outputs, but this repo's cache is private to the repo's Actions cache scope — no cross-repo exposure.)

### UX

- N/A — CI-facing.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] Gradle build-cache hit/miss is logged (`--build-cache` info / `BUILD SUCCESSful ... N tasks from cache`) on every run so hit-rate is continuously visible.

## BDD Scenarios

**Scenario: unchanged shared source restores the link from cache**
- **Given** a prior release populated the gradle build cache and `:shared` is unchanged
- **When** the next iOS deploy runs
- **Then** the K/N link tasks report `FROM-CACHE` and the link step is materially faster than 22m49s

**Scenario: a shared-source change relinks only what changed**
- **Given** a release commit that edits `:shared`
- **When** the link runs with the build cache enabled
- **Then** only the affected K/N tasks relink (gradle incremental) and the timing is recorded for the partial-change case

**Scenario: the cache is net-negative and the SHY is rejected with evidence**
- **Given** measurements show cache restore time ≥ the link-time saved (large outputs) or near-zero hit-rate across releases
- **When** the spike-like evaluation concludes
- **Then** the build cache is NOT shipped, and `## Notes` records the numbers + the rejection so it isn't re-attempted

## Test Plan

- **RED (if shipped):** YAML/gradle-config assertions — `org.gradle.caching=true` present (gradle.properties or CI flag); the iOS link steps run under `--build-cache`; any explicit cache-save step is `continue-on-error` + `timeout-minutes`.
- **GREEN:** enable build caching for the K/N link tasks; wire the GitHub-Actions-backed cache; re-run.
- **Measurement (the real deliverable):** ≥3 consecutive real releases recorded in `## Notes` — cold link time, warm link time, cache restore time, hit-rate. Decision (ship vs reject) follows from the net-positive gate.
- **Local pre-check:** `./gradlew :shared:linkReleaseFrameworkIosArm64 --profile --build-cache` twice (cold then warm) on a Mac to size the saving + cache footprint before the CI change.

## Out of Scope

- The `xcodebuild archive` / pod compile (SHY-0088) and the iOS-smoke serial chain (SHY-0087).
- Removing `--max-workers=1` (the deadlock workaround) — parked by SHY-0086; only revisit if a near-100% cache hit makes the link a non-event.
- A self-hosted / persistent build-cache node (forbidden by the $0 / no-self-hosted policy) — must use GitHub's free Actions cache.

## Dependencies

- Builds on SHY-0086. Lower priority than SHY-0087 (parallelism) and SHY-0088 (pod cache) — tackle after those, since this is the highest-uncertainty win. Independent of both (composes).

## Risks & Mitigations

- **K/N link outputs are large → cache restore ≈ link time (net-zero).** *Mitigation:* the net-positive AC gate; reject with evidence if so.
- **Low hit-rate because `:shared` changes every release.** *Mitigation:* measure hit-rate across real commits before committing; the device-vs-simulator cross-job benefit may still justify it even at low cross-release hit-rate.
- **Build cache masks a real miscompile (false up-to-date).** *Mitigation:* gradle input-hashing is sound; the parallel iOS smoke (SHY-0087) boots the same commit as an independent correctness check.

## Definition of Done

- Either: build caching enabled for the K/N iOS link with a measured net-positive saving recorded in `## Notes` (cold/warm/restore times + hit-rate), PR merged, `released_in: vX.Y.Z` after a real-deploy verify;
- Or: closed as **rejected** with the measurement evidence in `## Notes` (cache net-negative / hit-rate near-zero), no workflow change shipped.

## Notes (running log)

- 2026-06-12 — Filed by SHY-0086. Origin: the K/N framework link = 22m49s (deploy) + 15m03s (smoke), and `~/.konan` caches only the compiler layer not the project link. Highest-uncertainty of the three follow-ups — explicitly feasibility-gated with a net-positive measurement requirement and an allowed "reject with evidence" outcome. Do after SHY-0087 + SHY-0088.
