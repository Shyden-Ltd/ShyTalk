---
id: SHY-0186
status: In Review
owner: claude
created: 2026-07-14
priority: P1
type: infra
effort: M
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1598
epic: EPIC-0003
mvp: false
---

# SHY-0186: Make the shared `commonTest` suite COMPILE on Kotlin/Native (rename the K/N-illegal test names)

## User Story

**As** an engineer shipping shared `commonMain` logic to a Kotlin/Native iOS app,
**I want** the `commonTest` sources to at least COMPILE for the Kotlin/Native test target (today they don't),
**So that** the path to actually RUNNING the shared suite on the runtime the app ships on (SHY-0188) is unblocked, and new K/N-illegal test names can no longer accumulate unnoticed.

## Why

Discovered during SHY-0182 review (`reference` note in that story): `./gradlew :shared:iosSimulatorArm64Test` **does not compile** — `commonTest` uses **41** backtick test-function names containing `(`, `)` or `,` across **11 files** (e.g. `BuildVariantTest`, `SafetyGateTest`, `CohortUtilTest`, `DevPersonasTest`, `ConversationBusinessTest`, `EffectiveCohortTest`, `FirebaseCallTest`, `WebUrlsTest`), which Kotlin/Native's ObjC-symbol rules reject (`Name contains illegal characters: "()"`). Because the K/N test binary can't link, **none** of the ~1400 shared unit tests has EVER executed on Kotlin/Native — locally or in CI (`pr-checks.yml` runs `testDevDebugUnitTest :shared:jvmTest :shared:testAndroidHostTest`; the iOS jobs only `link*Framework*`, never `*Test`). `:shared:compileKotlinIosArm64` proves the production code compiles for-device, but proves nothing about test *behaviour* on K/N. This is a real hole in a tri-platform app's test integrity ([[feedback-local-testing-parallel-and-cross-platform]] — "any bug → re-run the exact test on ALL targets"; [[feedback-no-stubs-mocks-fakes-real-only]] — real runtime, not a JVM proxy).

## Acceptance Criteria

### Happy path
- [ ] `./gradlew :shared:compileTestKotlinIosSimulatorArm64` **compiles green** (was: `Name contains illegal characters`) — zero K/N-illegal backtick test names remain anywhere in `shared/src/commonTest`.
- [ ] Every renamed name still accurately describes what its test asserts (no meaning lost with the punctuation).

### Error paths
- [ ] A test name still containing a K/N-illegal character fails `compileTestKotlinIosSimulatorArm64` LOUDLY (compiler error) — the failure mode is a broken build, never a silently-skipped test.

### Edge cases
- [ ] Renames introduce NO duplicate test names within a class (two names that differed only by punctuation would collide) — the rename is verified to keep every name unique.
- [ ] `:shared:jvmTest` + `:shared:testAndroidHostTest` stay 100% green after the renames **with preserved counts** (a rename must not change a test's meaning or drop it).

### Performance
- [ ] The compile check adds no meaningful wall-clock (it is a compile task on the existing toolchain, no simulator boot).

### Security
- N/A — test-only; no runtime/product surface, no data flow.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — test method names are developer-facing identifiers, not user strings.

### Observability
- [ ] The story `## Notes` record the verified evidence trail (compile green + preserved jvm/androidHost counts + the grep-to-zero of illegal names) so the increment is auditable without re-running it.

## BDD Scenarios

**Scenario: the K/N test binary compiles**
- **Given** the shared module with the renamed `commonTest` names
- **When** `./gradlew :shared:compileTestKotlinIosSimulatorArm64` runs
- **Then** it exits 0 with no `Name contains illegal characters` error

**Scenario: an illegal name is caught, not skipped**
- **Given** a `commonTest` function named with a `(` in its backtick identifier
- **When** the shared module is compiled for `iosSimulatorArm64`
- **Then** the build fails with a `Name contains illegal characters` compile error (never a silent skip)

**Scenario: no rename collision**
- **Given** two pre-existing test names that differed only by punctuation
- **When** the punctuation is stripped by the rename
- **Then** the guard/check reports the collision and the build fails until the names are made distinct

**Scenario: JVM + androidHost stay green**
- **Given** the renamed test names
- **When** `:shared:jvmTest` and `:shared:testAndroidHostTest` run
- **Then** both stay 100% green with the same test counts as before the rename

## Test Plan

**RED first:** `./gradlew :shared:iosSimulatorArm64Test` currently fails to compile (41 names / 11 files) — that IS the failing state this story turns green.

- **Rename:** convert each K/N-illegal backtick name to a legal, still-readable, still-unique form (drop `(`/`)`, replace `,` with a dash/space), across the develop-baseline `commonTest` files. A one-shot transform scoped to `fun \`…\`` declarations, with a collision check.
- **Green gate:** `:shared:compileTestKotlinIosSimulatorArm64` (new — must compile), `:shared:jvmTest` (unchanged count, green), `:shared:testAndroidHostTest` (unchanged count, green) — all forced-execution runs (`--rerun-tasks`), never cache hits.
- **Split out (SHY-0188):** the K/N test EXECUTION (Firebase framework link), the illegal-name guard in `lint.yml`, and the CI wiring — one story = one PR ([[feedback-agile-user-stories]]).
- **Protocol classification (device/browser gauntlet):** the diff is `.project/stories/**` + test-identifier renames inside `shared/src/commonTest/**` only. `commonTest` compiles exclusively into test binaries — zero bytes of it reach any shipped app/web artifact — so there is no user-observable surface for a device/browser journey to exercise (same rationale as the `*.md`-only exemption; SHY-0087/0088 carve-out precedent). All host-side frameworks the change CAN affect (jvmTest, androidHostTest, K/N test compile, ktlint, detekt, story validators) run in full.

## Out of Scope

- **Executing the K/N suite (the Firebase-framework link fix), the illegal-name guard, and the CI wiring — split to [[SHY-0188]]** (1 story = 1 PR; this story is the compile-unblock rename only).
- Adding NEW shared tests (this is execution-enablement of the existing suite).
- Migrating any test to real services (that is the EPIC-0003 per-domain stories).
- iOS `iosApp/iosAppTests` (XCTest) — a separate suite; this story is `shared/commonTest` on K/N.
- Renaming androidTest/instrumented names (they run on a device via a different toolchain that permits these names).
- The ~21 additional illegal names on the in-flight SHY-0182 branch — those are renamed ON that branch by its author before ITS merge (see Notes coordination entry).

## Dependencies

- None blocking. Independent of the device gauntlet. Touches only `shared/src/commonTest/**` + a CI/lint guard.
- Coordinate with any in-flight `commonTest`-touching story to avoid a rename/merge conflict.

## Risks & Mitigations

- **Risk:** a rename collides two names within a class (silent test loss). **Mitigation:** the collision guard + comparing per-class test counts jvm-vs-K/N.
- **Risk:** K/N surfaces a genuine behaviour difference (a test green on JVM, red on K/N). **Mitigation:** that is the POINT — treat it as a real product/test bug, fix per [[feedback-think-like-qa-real-fixes]]; do not paper over by excluding the test.
- **Risk:** simulator boot flakiness in CI. **Mitigation:** reuse the existing macOS runner setup; bounded retry only on infra (not on assertion) failure.

## Definition of Done

`:shared:compileTestKotlinIosSimulatorArm64` green with zero K/N-illegal names remaining in `commonTest`; `:shared:jvmTest` + `:shared:testAndroidHostTest` unchanged-count green on forced execution; renames collision-free and meaning-preserving; SHY-0188 filed fully-refined for execution/guard/CI; `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-07-14 ~17:05 WIB — **code-reviewer R1 (0 code findings; 4 Important + 4 Minor on process/docs) → ALL addressed + story RE-SCOPED to the rename increment.** (Imp-1, 1-story-1-PR) the "increments 2-4 under this SHY" plan violated [[feedback-agile-user-stories]] → this SHY is re-scoped to exactly PR #1598's deliverable (compile-unblock rename; title/AC/BDD/Test Plan/DoD rewritten to the compile bar; effort L→M since the L was the deferred link work) and **SHY-0188 filed fully-refined** for execution + guard + CI (the EPIC-0003 sub-slice pattern). (Imp-2) status → In Review at this push (SHY-0127 Gate 1). (Imp-3, count reconciliation) the filing-time **41 names / 11 files** grep ran on a working tree that included SHY-0182's unmerged additions; the develop-baseline scope this PR delivers is **20 names / 10 files** — the remaining ~21 (incl. `WebUrlsTest.kt`, which does not exist on develop) belong to the SHY-0182 BRANCH and are renamed there by its author before ITS merge (nothing mechanical enforces this until SHY-0188's guard lands — reciprocal note added to SHY-0182's story on its branch). (Imp-4) device/browser-gauntlet classification recorded in Test Plan: test-identifier-only rename, zero shipped-artifact bytes → no journey surface; all host frameworks ran. (Min-5) `pr:` added. (Min-6) EPIC-0003 `child_shys` += SHY-0186/0188. (Min-7, pre-existing WIP drift) SHY-0091 + SHY-0120 file-status reconciled In Progress→In Review with content-on-develop evidence (their INDEX rows already said In Review; squash-merge means branch SHAs never appear in develop history); SHY-0113 left In Progress deliberately (genuinely-open umbrella; forward-only lifecycle forbids parking to Draft) — WIP=1 now holds (0113 only). SHY-INDEX corrected (0181 row was stale In-Progress; 0186/0188 rows added). (Min-8) two terse renames polished in `FirebaseCallTest` ("e g" → "such as"; trailing "etc" list → "like X and Y"). Verification: forced-execution `--rerun-tasks` triple gate green — compileTestKotlinIosSimulatorArm64 ✓, jvmTest **1331/0**, testAndroidHostTest **545/0** (counts preserved); illegal-name grep → 0; per-file duplicate-name check → 0; ktlint (changed files) + detekt clean. Reviewed-up-to: fa7529decdb (R1 base — bump to the R1-fix commit once its delta re-review returns clean).
- 2026-07-14 ~03:30 WIB — **Increment 1 (the rename) DONE + a scope discovery.** Self-validated to In Progress (mechanical infra rename, low architectural risk). Renamed the **20** K/N-illegal backtick test names across 10 `commonTest` files (only `(`/`)`/`,` present; a collision-free, `fun \`…\``-scoped transform — dropped the punctuation, collapsed spaces). Result: **`:shared:compileTestKotlinIosSimulatorArm64` now compiles** (was: `Name contains illegal characters`), and `:shared:jvmTest` (1331/0) + `:shared:testAndroidHostTest` (545/0) stay green with preserved counts. **DISCOVERY — the rename is necessary but NOT sufficient:** `:shared:iosSimulatorArm64Test` (the RUN) fails at LINK — `ld: framework 'FirebaseCore' not found`. The K/N test binary transitively links `iosMain`'s native Firebase dependency, but the standalone gradle test link (unlike the app) has no Firebase framework search path — that comes from CocoaPods. **So the story is a bigger infra effort than M:** increment 2 must wire the CocoaPods/Firebase native frameworks (`FirebaseCore` + deps) into the `linkDebugTestIosSimulatorArm64` search path (or otherwise make the K/N test binary linkable) before the suite can execute. Then the illegal-name guard + CI wiring (increments 3-4). **Coordination:** the in-flight SHY-0182 branch adds ~21 MORE illegal names — those must be renamed too before its merge re-breaks the compile (the guard, once landed, enforces this). **Design decision for increment 2 (why effort bumped M→L):** the K/N test binary links ALL of `iosMain` (even to exercise pure `commonMain` logic), and `iosMain` hard-depends on the gitlive-Firebase native stack (`FirebaseCore`/`FirebaseFirestore`/`FirebaseAuth`/`FirebaseDatabase` + gRPC/BoringSSL/abseil), provided only by the app's CocoaPods — so there's no "just test the pure logic" shortcut. Options: (a) `linkerOpts` the full Pods framework stack into `linkDebugTestIosSimulatorArm64` (works, fragile — framework list drifts with Firebase versions); (b) adopt the KMP `cocoapods{}` plugin so the pod frameworks are provided to the test link natively; (c) a test-only stub-framework shim. Recommend (b). Not attempted here (needs a focused, non-contended session — a parallel session held the Xcode toolchain 2026-07-13/14).
- 2026-07-14 — Filed from a SHY-0182 code-review finding (F6). Verified: `./gradlew :shared:iosSimulatorArm64Test` fails to compile; `grep -rE 'fun \`[^\`]*[(),][^\`]*\`' shared/src/commonTest` → 41 matches across 11 files. The K/N-illegal set may include chars beyond `()`/`,` (e.g. `.`/`:`) — the fix must iterate the compiler to zero, not just handle `()`/`,`. Parent EPIC-0003 (operational, real-only test apparatus): this makes the shared unit suite real on the K/N runtime, not a JVM stand-in.
