---
id: SHY-0188
status: Draft
owner: claude
created: 2026-07-14
priority: P1
type: infra
effort: L
roadmap_ids: []
epic: EPIC-0003
mvp: false
---

# SHY-0188: Execute the shared unit suite on the Kotlin/Native runtime (link, guard, and CI-enforce `iosSimulatorArm64Test`)

## User Story

**As** an engineer shipping shared `commonMain` logic to a Kotlin/Native iOS app,
**I want** the `commonTest` suite to actually RUN on the Kotlin/Native runtime (not only the JVM), with a guard so the compile-unblock can't regress and a CI job so K/N execution is enforced,
**So that** K/N-specific behaviour (string/UTF-16 handling, integer widths, coroutine dispatch, memory model, `expect`/`actual` selection) is proven on the runtime the app really ships on, instead of assumed from a JVM-only pass.

## Why

Successor to [[SHY-0186]] (split per 1-story-1-PR, [[feedback-agile-user-stories]]). SHY-0186 made the K/N test binary COMPILE (renamed the 20 K/N-illegal backtick names on the develop baseline). But compiling is not running: `./gradlew :shared:iosSimulatorArm64Test` still fails at LINK — `ld: framework 'FirebaseCore' not found`. The K/N test binary links ALL of `iosMain` (even to exercise pure `commonMain` logic), and `iosMain` hard-depends on the gitlive-Firebase native stack (`FirebaseCore`/`FirebaseFirestore`/`FirebaseAuth`/`FirebaseDatabase` + gRPC/BoringSSL/abseil) that only the app's CocoaPods provide — the standalone gradle test link has no framework search path for them. So the ~1400 shared unit tests have STILL never executed on Kotlin/Native, locally or in CI (`pr-checks.yml` runs `testDevDebugUnitTest :shared:jvmTest :shared:testAndroidHostTest`; the iOS jobs only `link*Framework*`, never `*Test`). A tri-platform app asserting cross-platform correctness from a JVM-only pass is a real test-integrity hole ([[feedback-local-testing-parallel-and-cross-platform]], [[feedback-no-stubs-mocks-fakes-real-only]] — real runtime, not a JVM proxy). Additionally, nothing yet STOPS a new K/N-illegal test name from landing (SHY-0186's compile gate runs nowhere in CI) — the guard + CI wiring close that loop.

## Acceptance Criteria

### Happy path
- [ ] `./gradlew :shared:iosSimulatorArm64Test` **links, runs, and is green** — every `commonTest` class executes on the Kotlin/Native simulator runtime.
- [ ] The `commonTest` class set that runs on K/N equals the class set on `:shared:jvmTest` (no class silently excluded from the K/N binary).

### Error paths
- [ ] A `commonTest` function name containing a K/N-illegal character (`(`, `)`, `,` — plus any further char the K/N compiler rejects) fails the `lint.yml` guard with a message naming the file + offending name; the guard reports EVERY violation, never just the first, and has an explicit unresolved/parse-failure channel ([[feedback-detector-must-report-not-guess]]).
- [ ] A K/N test failure (assertion red on K/N, green on JVM) fails the CI job loudly by name — treated as a real product/test bug, never excluded to go green ([[feedback-think-like-qa-real-fixes]]).

### Edge cases
- [ ] The Firebase-framework link solution survives a Firebase/pods version bump without hand-maintaining a framework list (the design's decisive criterion — see Notes design decision).
- [ ] `:shared:jvmTest` + `:shared:testAndroidHostTest` counts and results are unchanged by the link/guard/CI work (no test semantics touched).
- [ ] A clean checkout (no prior pod install / DerivedData) can run the K/N suite with documented bootstrap steps — no machine-local implicit state.

### Performance
- [ ] `iosSimulatorArm64Test` wall-clock is bounded (link + simulator-runtime run) and runs on the existing GitHub-hosted macOS runner — no paid runner ([[feedback-no-self-hosted-runners]]), with the download/install steps cached version-aware ([[feedback-ci-cache-downloads-version-aware]]).

### Security
- N/A — test-only infrastructure; no runtime/product surface, no data flow, no secrets beyond existing CI setup.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — test identifiers and CI job names are developer-facing, not user strings.

### Observability
- [ ] CI surfaces the K/N suite result BY NAME (a clearly-named job/step, e.g. `shared-kn-test`) so a K/N-only regression is visible, not buried in a compound job ([[feedback-monitor-branch-protection-aware]] naming discipline).
- [ ] The guard's output lists each violation as `file:line name` so a violator can fix without re-running locally.

## BDD Scenarios

**Scenario: the K/N test binary links and runs**
- **Given** the shared module with SHY-0186's renamed `commonTest` names
- **When** `./gradlew :shared:iosSimulatorArm64Test` runs
- **Then** it exits 0
- **And** the test report lists every `commonTest` class (same class set as `:shared:jvmTest`)

**Scenario: an illegal name is caught by the guard before it can break the compile**
- **Given** a `commonTest` function named with a `(` in its backtick identifier
- **When** the `lint.yml` guard runs
- **Then** it exits non-zero naming the file and the offending identifier
- **And** every other violation in the tree is listed in the same run

**Scenario: the guard's detector is itself tested**
- **Given** the guard's fixture corpus (legal names, one illegal name, several illegal names, an unparseable file)
- **When** the guard's meta-tests run in Jest
- **Then** each fixture yields its exact expected exit code and per-violation output, and the unparseable fixture lands in the unresolved channel (not a silent pass)

**Scenario: CI enforces K/N execution**
- **Given** a PR that makes a `commonTest` test K/N-red (but JVM-green)
- **When** CI runs
- **Then** the K/N job fails by name and the PR cannot be judged merge-ready

**Scenario: JVM + androidHost unaffected**
- **Given** the link/guard/CI changes
- **When** `:shared:jvmTest` and `:shared:testAndroidHostTest` run
- **Then** both stay green with the same counts as before this story

## Test Plan

CI-config + build-plumbing + test-infrastructure story — **no app/backend/web runtime surface** (the tight-boundary check: zero changes under `shared/src/commonMain|androidMain|iosMain`, `app/src/main`, `iosApp/iosApp` runtime, `express-api/src`, `public/`). Device/browser gauntlet therefore exercises nothing this story changes; the full relevant non-device gauntlet runs (below). If implementation DOES end up touching a runtime source set (e.g. an `iosMain` source reorganisation for linkability), this classification is void and the full protocol applies.

**RED first:** `./gradlew :shared:iosSimulatorArm64Test` fails at link (`ld: framework 'FirebaseCore' not found`) — the failing state increment A turns green. The guard's fixture meta-tests are written RED first (fixtures with known violations, exact expected exits). The CI job is proven by a deliberate K/N-red probe commit on a scratch branch (reverted) — verify the job fails BY NAME, per [[feedback-workflow-verify-by-running]].

- **A (link):** make the K/N test binary linkable — evaluate (b) adopting the KMP `cocoapods{}` plugin (recommended; pods provided to the test link natively) vs (a) `linkerOpts` the full Pods framework stack into `linkDebugTestIosSimulatorArm64` (fragile: list drifts with Firebase versions) vs (c) a test-only stub-framework shim (violates real-only spirit for anything it stubs). Decision recorded in Notes before code ([[feedback-quality-explore-alternatives-validate]]). Gate: `:shared:iosSimulatorArm64Test` green locally.
- **B (guard):** `scripts/check-kn-test-names.sh` (or `.js`) + `lint.yml` wiring — scans `shared/src/commonTest` backtick `fun` names for K/N-illegal chars; reports ALL violations `file:line name`; unresolved channel for unparseable input; **fixture-tested via Jest meta-tests** in `express-api/tests/scripts/` (the established pattern of `check-app-web-urls-env-derived` / detector stories).
- **C (CI):** wire `:shared:iosSimulatorArm64Test` into the iOS CI path (`pr-checks.yml` or the iOS workflow) as a named job/step; cache the simulator/toolchain pieces version-aware; grep-first for dependent workflow-structure pin tests before editing YAML ([[feedback-yaml-structure-grep-tests]]).
- **Cross-target regression gate:** forced-execution `:shared:jvmTest` + `:shared:testAndroidHostTest` count-preserved green.

## Out of Scope

- The rename itself — delivered by [[SHY-0186]] (PR #1598).
- Adding NEW shared tests; migrating tests to real services (other EPIC-0003 stories).
- `iosApp/iosAppTests` XCTest and instrumented `androidTest` suites (different toolchains).
- Running K/N tests on a REAL iPhone (`iosArm64Test`) — simulator-runtime execution is this story's bar; on-device K/N unit execution has no established harness and would be its own story if ever needed.

## Dependencies

- **[[SHY-0186]] merged first** (the compile-unblock rename this builds on).
- The in-flight SHY-0182 branch must rename its ~21 illegal names before ITS merge (else the K/N compile — and once this story lands, the guard — goes red on its merge). Reciprocal note recorded in SHY-0182's story.
- Coordinate with any story touching `shared/build.gradle.kts` or the iOS CI workflow while increment A is in flight.

## Risks & Mitigations

- **Risk:** the `cocoapods{}` plugin adoption perturbs the app's existing Xcode/CocoaPods integration (the synthetic-integration breakage class in [[reference-ios-device-build-framework-staleness]]). **Mitigation:** validate `:shared:embedAndSignAppleFrameworkForXcode` + a device build BEFORE merging; keep option (a) `linkerOpts` as the documented fallback.
- **Risk:** K/N run surfaces genuine behaviour differences (green-on-JVM / red-on-K/N). **Mitigation:** that is the point — each is triaged as a real bug (fix product/test properly, never exclude); if one requires deep product work it files its own SHY and this story's green gate counts it explicitly.
- **Risk:** CI macOS-runner simulator flakiness. **Mitigation:** bounded infra-retry only on simulator-boot classes of failure, never on assertion failures; job time budgeted and cached.
- **Risk:** guard false-positives on exotic-but-legal names. **Mitigation:** the guard mirrors the COMPILER's acceptance (fixture parity: every fixture also compiled once against K/N during development), and the fixture corpus pins both directions.

## Definition of Done

`:shared:iosSimulatorArm64Test` links + runs green with the full `commonTest` class set (same class set as jvmTest); the illegal-name guard is wired into `lint.yml`, reports all violations with an unresolved channel, and is fixture-tested; CI runs the K/N suite as a named job (proven by a red-probe dispatch); `:shared:jvmTest` + `:shared:testAndroidHostTest` unchanged-count green; `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-07-14 ~17:05 WIB — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) as the split-out successor to [[SHY-0186]] (code-reviewer R1 Imp-1 on PR #1598: increments 2-4 under one SHY violated 1-story-1-PR; EPIC-0003 sub-slice pattern applied). Carries the execution/guard/CI scope with SHY-0186's discovery baked in: the link failure is `ld: framework 'FirebaseCore' not found` because the K/N test binary transitively links `iosMain`'s gitlive-Firebase native stack (CocoaPods-provided). Design options (a) linkerOpts / **(b) KMP `cocoapods{}` plugin (recommended)** / (c) stub-shim recorded with trade-offs in Test Plan increment A; final decision to be validated + recorded here at pickup. Needs a focused, non-contended session (the Xcode toolchain must be free — 2026-07-13/14 sessions saw multi-hour contention).
