---
id: SHY-0186
status: Draft
owner: claude
created: 2026-07-14
priority: P1
type: infra
effort: M
roadmap_ids: []
epic: EPIC-0003
mvp: false
---

# SHY-0186: Execute the shared unit suite on the Kotlin/Native runtime (unblock `iosSimulatorArm64Test`)

## User Story

**As** an engineer shipping shared `commonMain` logic to a Kotlin/Native iOS app,
**I want** the `commonTest` suite to actually RUN on the Kotlin/Native runtime (not only the JVM),
**So that** K/N-specific behaviour (string/UTF-16 handling, integer widths, coroutine dispatch, memory model, `expect`/`actual` selection) is proven on the runtime the app really ships on, instead of assumed from a JVM-only pass.

## Why

Discovered during SHY-0182 review (`reference` note in that story): `./gradlew :shared:iosSimulatorArm64Test` **does not compile** — `commonTest` uses **41** backtick test-function names containing `(`, `)` or `,` across **11 files** (e.g. `BuildVariantTest`, `SafetyGateTest`, `CohortUtilTest`, `DevPersonasTest`, `ConversationBusinessTest`, `EffectiveCohortTest`, `FirebaseCallTest`, `WebUrlsTest`), which Kotlin/Native's ObjC-symbol rules reject (`Name contains illegal characters: "()"`). Because the K/N test binary can't link, **none** of the ~1400 shared unit tests has EVER executed on Kotlin/Native — locally or in CI (`pr-checks.yml` runs `testDevDebugUnitTest :shared:jvmTest :shared:testAndroidHostTest`; the iOS jobs only `link*Framework*`, never `*Test`). `:shared:compileKotlinIosArm64` proves the production code compiles for-device, but proves nothing about test *behaviour* on K/N. This is a real hole in a tri-platform app's test integrity ([[feedback-local-testing-parallel-and-cross-platform]] — "any bug → re-run the exact test on ALL targets"; [[feedback-no-stubs-mocks-fakes-real-only]] — real runtime, not a JVM proxy).

## Acceptance Criteria

### Happy path
- [ ] `./gradlew :shared:iosSimulatorArm64Test` **compiles and runs green** — every `commonTest` class executes on the Kotlin/Native simulator runtime.
- [ ] The full `commonTest` count that runs on K/N equals the count that runs on `:shared:jvmTest` (no class silently excluded).

### Error paths
- [ ] A test whose name still contains a K/N-illegal character fails the build LOUDLY (compile error) rather than being silently skipped — verified by a guard (below).

### Edge cases
- [ ] Renames introduce NO duplicate test names within a class (two names that differed only by punctuation would collide) — the rename is verified to keep every name unique.
- [ ] `:shared:jvmTest` + `:shared:testAndroidHostTest` stay 100% green after the renames (a rename must not change a test's meaning or drop it).

### Performance
- [ ] `iosSimulatorArm64Test` wall-clock is bounded (simulator boot + run); it runs in CI on the existing macOS runner without a paid upgrade ([[feedback-no-self-hosted-runners]]).

### Security
- N/A — test-only; no runtime/product surface, no data flow.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — test method names are developer-facing identifiers, not user strings.

### Observability
- [ ] CI surfaces the K/N test result by name (a required check or a clearly-named job) so a K/N-only regression is visible, not buried.

## BDD Scenarios

**Scenario: the K/N test binary links and runs**
- **Given** the shared module with the renamed `commonTest` names
- **When** `./gradlew :shared:iosSimulatorArm64Test` runs
- **Then** it exits 0
- **And** the test report lists every `commonTest` class (same class set as `:shared:jvmTest`)

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

- **Rename:** convert each K/N-illegal backtick name to a legal, still-readable, still-unique form (drop `(`/`)`, replace `,` with a dash/space), across the 11 `commonTest` files. A one-shot script scoped to `fun \`…\`` declarations, with a collision report.
- **Green gate (all three targets):** `:shared:iosSimulatorArm64Test` (new — must compile + pass), `:shared:jvmTest` (unchanged count, green), `:shared:testAndroidHostTest` (unchanged count, green).
- **Guard:** a `commonTest`-scoped lint check (shell or a `check-*.sh` wired into `lint.yml`) that fails if any `commonTest` `fun \`…\`` name contains a K/N-illegal character — so the debt can't regrow. Fixture-tested per [[feedback-detector-must-report-not-guess]].
- **CI:** add `:shared:iosSimulatorArm64Test` to the iOS CI path (or `pr-checks.yml`) so K/N execution is enforced going forward, surfaced by name ([[feedback-warnings-are-failures]] discipline).

## Out of Scope

- Adding NEW shared tests (this is execution-enablement of the existing suite).
- Migrating any test to real services (that is the EPIC-0003 per-domain stories).
- iOS `iosApp/iosAppTests` (XCTest) — a separate suite; this story is `shared/commonTest` on K/N.
- Renaming androidTest/instrumented names (they run on a device via a different toolchain that permits these names).

## Dependencies

- None blocking. Independent of the device gauntlet. Touches only `shared/src/commonTest/**` + a CI/lint guard.
- Coordinate with any in-flight `commonTest`-touching story to avoid a rename/merge conflict.

## Risks & Mitigations

- **Risk:** a rename collides two names within a class (silent test loss). **Mitigation:** the collision guard + comparing per-class test counts jvm-vs-K/N.
- **Risk:** K/N surfaces a genuine behaviour difference (a test green on JVM, red on K/N). **Mitigation:** that is the POINT — treat it as a real product/test bug, fix per [[feedback-think-like-qa-real-fixes]]; do not paper over by excluding the test.
- **Risk:** simulator boot flakiness in CI. **Mitigation:** reuse the existing macOS runner setup; bounded retry only on infra (not on assertion) failure.

## Definition of Done

`:shared:iosSimulatorArm64Test` compiles + runs green with the full `commonTest` class set; `:shared:jvmTest` + `:shared:testAndroidHostTest` unchanged-count green; the illegal-name guard is wired into `lint.yml` (fixture-tested) and CI runs the K/N suite by name; `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-07-14 — Filed from a SHY-0182 code-review finding (F6). Verified: `./gradlew :shared:iosSimulatorArm64Test` fails to compile; `grep -rE 'fun \`[^\`]*[(),][^\`]*\`' shared/src/commonTest` → 41 matches across 11 files. The K/N-illegal set may include chars beyond `()`/`,` (e.g. `.`/`:`) — the fix must iterate the compiler to zero, not just handle `()`/`,`. Parent EPIC-0003 (operational, real-only test apparatus): this makes the shared unit suite real on the K/N runtime, not a JVM stand-in.
