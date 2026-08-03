---
id: SHY-0214
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: L
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0214: Performance & load testing — API, LiveKit voice, web, mobile cold-start

## User Story

As a ShyTalk user, I want sign-in, room joins, messages, and voice to stay fast under real load, and as the operator I want **automated performance budgets with pass/fail thresholds** on the API, the LiveKit voice path, the website, and mobile cold-start, so a latency or startup regression fails a test before launch instead of being discovered by users on a $0-budget infrastructure that must not fall over.

## Why

The audit confirmed **no performance or load testing** of any kind — no k6/artillery/autocannon for the API, no LiveKit load harness, no Lighthouse budgets for the web, no startup benchmark for the apps. On free-tier/self-hosted infra (Firebase free tier, Oracle Cloud LiveKit VMs), a performance regression or a thundering-herd at launch is an availability risk, not just a UX one. A measurement without a threshold is not a test; this story adds **budgeted, pass/fail** performance gates against the **real** local stack and real devices (per EPIC-0003), registered into SHY-0212's runner, so "Voice rooms are fast ✓" can appear on SHY-0220's public page in plain language.

## Acceptance Criteria

### Happy path

- [ ] **API load (k6):** `perf/api/*.js` k6 scripts drive the REAL local Express API through its hot paths — OTP send/verify, room list, room join/leave, message send — with `thresholds` that FAIL the run when breached: `http_req_duration p(95) < 400ms`, `http_req_failed rate < 0.01`, and a sustained target RPS the free tier must handle. Registered `perf-api` (`stack`, `publicArea: Cross-cutting`).
- [ ] **Voice load (LiveKit load-tester):** `perf/voice/` uses the LiveKit load-test tool against the REAL local LiveKit container to simulate N publishers/subscribers in a room, asserting median join time < 2s and no dropped-connection rate above threshold. Registered `perf-voice` (`stack`, `publicArea: Voice rooms`).
- [ ] **Web (Lighthouse CI):** `@lhci/cli` runs against the locally-served site (public roadmap, sign-in, room list) with `assert` budgets that FAIL on regression: LCP < 2.5s, TBT < 200ms, CLS < 0.1, performance score ≥ 0.9. Registered `perf-web` (`stack`, `publicArea: Sign-in`/`Cross-cutting`).
- [ ] **Mobile cold-start:** Android Macrobenchmark (`androidx.benchmark.macro`) measures TTID/TTFD startup on a real device with a budget gate; iOS uses `XCTApplicationLaunchMetric` in an XCUITest measure block with a budget. Registered `perf-mobile` (`device`, `publicArea: Cross-cutting`).
- [ ] All four register into `scripts/test/framework-registry.mjs` and emit normalized `metadata.json` (SHY-0212 contract) carrying the measured value + budget + pass/fail per metric; `docs/testing/performance.md` explains the budgets in plain language.
- [ ] Budgets are defined ONCE in a reviewed `perf/budgets.json` consumed by every sub-framework so a threshold change is a single diff-reviewed edit.

### Error paths

- [ ] A regression that pushes API p95 over budget FAILS `perf-api` naming the endpoint, the measured p95, and the budget — not a generic fail.
- [ ] A LiveKit config regression that slows joins past budget FAILS `perf-voice` with the measured join time.
- [ ] A web bundle regression that blows the LCP/TBT budget FAILS `perf-web` naming the metric + page.
- [ ] A startup regression past the cold-start budget FAILS `perf-mobile` naming the platform + measured time.
- [ ] If the local stack / LiveKit / device isn't available, the sub-framework FAILS fast naming the missing dependency — never a false green from an unmeasured run ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] k6 runs are seeded/deterministic (fixed VUs, fixed duration, fixed data set) so pass/fail is reproducible, not noise — a documented tolerance band absorbs measurement jitter without hiding a real regression.
- [ ] Cold-start benchmark discards the first (JIT/dex-warm) iteration and reports the stable median over N iterations (standard macrobenchmark practice) — a single cold outlier does not fail the gate.
- [ ] Load scripts respect the free-tier limits they test (they do not, e.g., hammer a real cloud project) — API/voice load runs target the LOCAL stack by default; dev-target runs are opt-in and rate-aware.
- [ ] A page with legitimately-heavy one-time content (e.g. an admin dashboard) has its own budget entry rather than being held to the public-page budget.

### Performance

- [ ] The perf suites themselves are time-bounded (each k6/lighthouse/benchmark run has a max duration in the registry `timeoutMs`) so CI can't hang on a load test.
- [ ] The full `perf` profile run fits a documented CI wall-clock budget; heavy soak/endurance runs are a separate opt-in profile, not the default gate.
- [ ] Results include the raw metric series (as artifacts) plus the summarized pass/fail, so a near-miss trend is visible before it becomes a failure.

### Security

- [ ] Load scripts authenticate through the REAL API auth path (test personas / OTP), never bypassing authz — they exercise the same [[feedback-no-direct-backend-all-via-api]] chokepoint real clients use, so the numbers are honest.
- [ ] No secrets in `perf/` scripts or `budgets.json`; persona credentials sourced from the existing `~/.shytalk/*.env` files, never committed/logged.
- [ ] Perf result artifacts carry no PII (aggregate timings only; belt with SHY-0223).

### UX

- [ ] Failure output states the user-facing meaning ("Joining a voice room now takes 3.1s; budget is 2s") + the metric + the reproduce command — not just a raw threshold breach code.
- [ ] `docs/testing/performance.md` explains each budget in plain terms and how to run each sub-framework with one command.

### i18n

- [ ] N/A — performance metrics (latency, startup, LCP) are language-independent measurements. (Localized-page weight differences, if material, are covered by the per-page web budget, not a separate i18n path.)

### Observability

- [ ] Each sub-framework's `metadata.json` records every metric's measured value + budget + verdict, feeding a plain-language "fast/slow" signal per user area for SHY-0220.
- [ ] Raw k6 summary JSON, Lighthouse reports, and benchmark traces are uploaded as CI artifacts, greppable by `[framework:perf-api|perf-voice|perf-web|perf-mobile]`.
- [ ] A trend file (last N runs per metric) is retained so SHY-0220 can show a simple up/down trend without recomputation.

## BDD Scenarios

**Scenario: API latency regression fails the budget**

- **Given** a change that pushes room-join p95 latency above the 400ms budget
- **When** `perf-api` runs k6 against the real local API
- **Then** the run fails
- **And** the output names the endpoint, the measured p95, and the budget

**Scenario: Voice join-time regression is caught**

- **Given** a LiveKit/config change that slows median room join past 2s
- **When** `perf-voice` runs the LiveKit load-tester against the real local LiveKit
- **Then** the run fails naming the measured join time

**Scenario: Web performance budget breach fails Lighthouse**

- **Given** a web change that raises LCP above 2.5s on the sign-in page
- **When** `perf-web` runs Lighthouse CI against the locally-served site
- **Then** the assertion fails naming LCP and the page

**Scenario: Cold-start regression fails on a real device**

- **Given** an app change that slows Android cold start past its budget
- **When** `perf-mobile` runs the macrobenchmark on a real device (discarding the warm-up iteration)
- **Then** the gate fails with the measured median startup time

**Scenario: Missing dependency fails loudly, not silently**

- **Given** the local LiveKit container is not running
- **When** `perf-voice` runs
- **Then** it fails fast naming LiveKit as unreachable — it does not report a passed run

**Scenario: Perf verdict reaches the public page**

- **Given** a completed perf run across the four sub-surfaces
- **When** SHY-0220's page reads the perf `metadata.json`
- **Then** it can show "Voice rooms: fast ✓" and a simple trend per area

## Test Plan

**Classification:** real-only. k6 hits the REAL local Express API; the LiveKit load-tester hits the REAL local LiveKit container; Lighthouse hits the REAL locally-served site; the mobile benchmarks run on REAL devices. No mocked latency, no simulated media. Host-runnable unit portion: the `budgets.json` parser + the metadata normalizer adapters (fixture-based).

### Red — write failing tests first

- `perf/api/room-join.k6.js`, `otp.k6.js`, `messaging.k6.js` — each with `thresholds` that fail against a deliberately-throttled fixture endpoint (proves the gate bites), then pass against the real API within budget.
- `perf/voice/join-load.js` — asserts median join + drop-rate thresholds; a RED variant with an artificially low budget proves failure.
- `lighthouserc.json` + `perf/web/*.lhci` — assert budgets; a RED fixture page with a huge blocking asset proves failure.
- Android `app/src/androidTest/.../StartupBenchmark.kt` (`androidx.benchmark.macro.junit4`) with a startup budget; iOS `iosAppUITests/LaunchPerformanceTests.swift` with `XCTApplicationLaunchMetric` + budget.
- `express-api/tests/scripts/perf/budgets.test.js` — `it('every sub-framework reads perf/budgets.json')`, `it('metadata records measured+budget+verdict per metric')`.

### Green — implement

1. Add k6 (invoked via the k6 binary, pinned + cached per [[feedback-ci-cache-downloads-version-aware]]) + the API scripts + `perf/budgets.json`.
2. Wire the LiveKit load-tester against local LiveKit.
3. Add `@lhci/cli` + `lighthouserc.json`.
4. Add the Android Macrobenchmark module + the iOS launch-metric test.
5. Register all four; write `docs/testing/performance.md`; add the perf CI job (host-independent parts) + device-gated parts to the device gauntlet.
6. Fix any real regression the budgets surface (real product fixes).

### Gauntlet

Touches backend paths (load hits `express-api`) + app startup (`app/**`, `iosApp/**`) + web → FULL Pre-Merge Testing Protocol; perf-voice/perf-api proven on the real local stack, perf-mobile on real Android + real iOS, before merge.

## Out of Scope

- Long-duration soak/endurance/stress-to-failure testing (a separate opt-in profile + possible follow-up SHY) — this story establishes budgeted regression gates, not capacity planning.
- Production-scale load against real cloud infra (would consume quota / risk the free tier) — default target is the local stack; dev-target is opt-in.
- APM / real-user-monitoring in production (that overlaps SHY-0224 synthetic/uptime).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a perf signal to SHY-0220.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata contract). Uses the existing local stack (`local/start.sh`), local LiveKit Docker, and the real device harnesses.
- **Tooling:** k6 (open-source, $0); LiveKit load-tester (ships with LiveKit); `@lhci/cli` (open-source); `androidx.benchmark.macro`; XCTest launch metrics. All $0.

## Risks & Mitigations

- **Risk:** Perf numbers are noisy → flaky gates. **Mitigation:** Fixed VUs/duration/data, median-over-N with warm-up discard, a documented tolerance band; a flaky result is root-caused as a real perf issue, not retried away ([[feedback-no-auto-retry-workflows]]).
- **Risk:** CI hardware differs from dev, shifting absolute numbers. **Mitigation:** Budgets set with headroom + measured on the CI runner class; the trend file catches drift; device benchmarks run on the same real devices the gauntlet uses.
- **Risk:** Load test accidentally targets real cloud infra and burns quota / trips the free tier. **Mitigation:** Default target is the LOCAL stack; a dev-target run is explicit, rate-aware, and off by default ([[feedback-api-rate-limit-awareness]]).
- **Risk:** k6/Lighthouse binaries slow CI via re-download. **Mitigation:** Version-pinned + cached ([[feedback-ci-cache-downloads-version-aware]]).
- **Risk:** A perf "test" that only measures, never gates. **Mitigation:** Every sub-framework has explicit pass/fail `thresholds`/`assert`; a measurement-only script is a review-blocking finding.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `perf-api`, `perf-voice`, `perf-web`, `perf-mobile` green against the real local stack + real devices, each enforcing budgets from `perf/budgets.json`.
- [ ] All four registered; `docs/testing/performance.md` present + plain-language; `metadata.json` records measured+budget+verdict.
- [ ] Every real regression surfaced during the story is fixed.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0214-performance-load-testing`; PR title `SHY-0214: Performance & load testing — API, LiveKit voice, web, mobile cold-start`; FULL gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator listed performance explicitly). Key design ruling: a perf check is only a test if it has a **budget** — thresholds live once in `perf/budgets.json`, consumed by all four sub-frameworks. Real-only: local Express + local LiveKit + locally-served web + real devices. $0 toolchain (k6 / LiveKit load-tester / Lighthouse-CI / Macrobenchmark / XCTMetric). Soak/stress + prod-scale load deliberately deferred to keep this a regression gate, not capacity planning.
