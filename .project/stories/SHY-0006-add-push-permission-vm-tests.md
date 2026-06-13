---
id: SHY-0006
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: S
type: bug
roadmap_ids: [G005, G013, G029]
pr:
mvp: true
---

# SHY-0006: PushPermissionDeniedBanner + HomeScreen + HomeViewModel push tests

## User Story

As the ShyTalk operator, I want **the push-permission denial UX shipped in PR #1010 to have full test coverage across the three layers it spans — the `PushPermissionDeniedBanner` Compose composable, the `HomeScreen` conditional render integration, and the `HomeViewModel` push-state observable — plus the corresponding BDD scenarios in the androidTest suite**, so that the freshly-shipped denial UX cannot silently break in any subsequent refactor.

## Why

PR #1010 (Android-side push permission denial banner, merged 2026-06-06 — commit `04c909f9472`) introduced a non-dismissible banner on Home when push permission is denied + a tap-to-settings flow. The PR shipped without unit or BDD test coverage. Roadmap items G005, G013, G029 enumerate the three gaps.

Roadmap rows G005 (line 30) + G013 (line 39) + G029 (line 40):

> G005: Sev: 🔴 Critical. Test — PR #1010's PushPermissionDeniedBanner. New composable has zero Compose test (testTag visibility, onOpenSettings callback, conditional render, non-dismissible). Fix: Compose UI test in commonTest covering 4 paths. Scope: S.
>
> G013: Sev: 🟠 Important. Test — HomeScreen push integration. HomeScreen renders the banner conditionally on PushPermissionStore state but has zero test. Fix: HomeScreenTest.kt mocking PushPermissionStore states + asserting banner presence. Scope: S.
>
> G029: Sev: 🟠 Important. Test — HomeViewModel push observable. VM observes store, exposes state to UI; flow untested. Fix: HomeViewModelTest.kt: initial state, DENIED propagates, AUTHORIZED propagates, state change. Scope: S.

P1 Tier-3 coverage — closes the loop on a freshly-shipped feature before drift sets in.

**Note**: G006 (the `push_permission.feature` BDD file referenced in roadmap line 31) is a SEPARATE missing G-ID, not bundled here — it's handled by [[SHY-0043]] (rescoped to the single missing cold-start scenario; the other scenarios already shipped via PR #1015). This SHY covers the VM + UI + integration tests only.

## Acceptance Criteria

> **⚠️ No-Stubs supersession** ([[feedback-no-stubs-mocks-fakes-real-only]], operator 2026-06-13): any `Fake*` / `mock-*` / Robolectric-as-real-device named in the AC / BDD / Risks below is a now-banned in-process test double. The `### Pre-Merge Testing Protocol` subsection + the `## Notes` No-Stubs entry govern — implement against the **real local emulator stack / real device**, OR await the flagged 🔴 operator decision on the foundational fake harness. Do NOT implement the named double as written.

### Happy path

**PushPermissionDeniedBanner Compose test (G005):**

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/core/ui/PushPermissionDeniedBannerTest.kt` exists.
- [ ] Test A: banner renders when state is `DENIED`; assert testTag `pushPermissionDeniedBanner` present.
- [ ] Test B: banner does NOT render when state is `AUTHORIZED`; assert testTag absent.
- [ ] Test C: banner does NOT render when state is `NOT_DETERMINED`; assert testTag absent.
- [ ] Test D: tap on the banner's CTA invokes `onOpenSettings` callback exactly once.
- [ ] Test E: banner is non-dismissible (no close button; swiping or tapping outside doesn't dismiss).

**HomeScreen integration test (G013):**

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/home/HomeScreenTest.kt` exists.
- [ ] Test A: Home renders WITHOUT banner when `FakePushPermissionStore` reports AUTHORIZED.
- [ ] Test B: Home renders WITH banner when store reports DENIED.
- [ ] Test C: Home re-renders correctly when store state flips AUTHORIZED → DENIED mid-session.
- [ ] Test D: Home re-renders correctly when store state flips DENIED → AUTHORIZED.
- [ ] Test E: banner appears at the documented position (top of feed, not bottom).

**HomeViewModel push observable test (G029):**

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/home/HomeViewModelPushObservableTest.kt` exists (or extends existing `HomeViewModelTest.kt` from SHY-0010).
- [ ] Test A: initial state of VM reflects store's initial state (default: NOT_DETERMINED).
- [ ] Test B: when store emits DENIED, VM's observable emits DENIED.
- [ ] Test C: when store emits AUTHORIZED, VM's observable emits AUTHORIZED.
- [ ] Test D: VM's observable preserves state ordering (no race between emissions).
- [ ] Test E: VM unsubscribes from store on scope cancellation (no leaked observer).

- [ ] All tests pass via `./gradlew :shared:jvmTest --tests "*PushPermission*"`.
- [ ] Sonar coverage on the 3 files (`PushPermissionDeniedBanner.kt`, `HomeScreen.kt` push integration block, `HomeViewModel.kt` push observable) ≥90%.

### Error paths

- [ ] **Banner**: `onOpenSettings` callback throws → banner does NOT crash; exception is logged + caught.
- [ ] **HomeScreen**: PushPermissionStore throws on subscription → Home still renders (banner just absent); error logged Crashlytics non-fatal.
- [ ] **HomeViewModel**: store emits NULL state (impossible but defensive) → VM treats as NOT_DETERMINED; doesn't crash.
- [ ] **Banner**: tap during state transition (DENIED → AUTHORIZED mid-tap) → no callback fires (banner has unmounted).

### Edge cases

- [ ] **State machine fidelity**: PushPermissionState is a 4-value enum (`NOT_DETERMINED`, `AUTHORIZED`, `DENIED`, `RESTRICTED`); tests cover ALL 4 values (banner rendering decision per value).
- [ ] **API 33+ specific**: on Android 13+, NOT_DETERMINED is the default until first request; tests use the same default; behaviour parity with iOS where NOT_DETERMINED behaves equivalently.
- [ ] **Settings deep-link**: `onOpenSettings` constructs the correct Settings intent for Android (`ACTION_APPLICATION_DETAILS_SETTINGS` + URI for package); verified via Robolectric or instrumented test.
- [ ] **Rapid state flips**: store emits DENIED → AUTHORIZED → DENIED in 50ms → banner toggles cleanly (no flicker); HomeScreen recomposes correctly.
- [ ] **Process death + relaunch**: store recovers state on relaunch; HomeViewModel re-subscribes; banner restored if applicable.

### Performance

- [ ] Each test completes within 100ms (deterministic via TestCoroutineScheduler).
- [ ] Banner recomposition adds <16ms (60fps budget) — verified via Compose benchmark.
- [ ] No memory leak after 1000 state-flip cycles.

### Security

- [ ] Banner's `onOpenSettings` constructs intent ONLY for the app's own settings (not arbitrary settings panels); verified by intent validation in test.
- [ ] No PII in banner text (the displayed copy is generic "Enable notifications to ...").
- [ ] Store state is process-singleton; no leakage across users via global state.

### UX

- [ ] Banner copy in all 20 locales (covered by SHY-0025's locale parity; just verify keys exist).
- [ ] Banner colour scheme respects dark/light theme.
- [ ] Banner appearance animation is non-jarring (test asserts no instant pop-in; uses Compose `AnimatedVisibility`).

### i18n

- [ ] Banner uses `Res.string.notifications_disabled_banner_title` + `..._action`; verified by SHY-0025's `compose-resources-locale-parity.test.js` (cross-reference).
- [ ] All 20 locales have non-empty values for the 2 banner keys.

### Observability

- [ ] Banner shown event logged at INFO: `Log.i("PushBanner", "shown")` (no PII).
- [ ] Banner tap event logged at INFO: `Log.i("PushBanner", "tap_open_settings")`.
- [ ] VM observable subscription/unsubscription logged at DEBUG.
- [ ] Crashlytics non-fatal on store-subscription failure.

## BDD Scenarios

**Scenario: Banner visible when permission denied**

- **Given** the app is open with `FakePushPermissionStore` reporting `DENIED`
- **When** HomeScreen renders
- **Then** the banner is visible (testTag `pushPermissionDeniedBanner` found)
- **And** the banner is non-dismissible (no close button)

**Scenario: Banner hidden when permission granted**

- **Given** `FakePushPermissionStore` reports `AUTHORIZED`
- **When** HomeScreen renders
- **Then** the banner is NOT visible (testTag absent)

**Scenario: Tap opens settings**

- **Given** the banner is visible
- **When** the user taps the CTA
- **Then** `onOpenSettings` is invoked exactly once
- **And** the constructed Intent targets the app's own settings (ACTION_APPLICATION_DETAILS_SETTINGS + correct URI)

**Scenario: State flip mid-session reveals banner**

- **Given** HomeScreen is rendered with AUTHORIZED state (no banner)
- **When** the store emits DENIED (user revoked permission via OS settings)
- **Then** HomeScreen recomposes
- **And** the banner becomes visible within 100ms

**Scenario: HomeViewModel propagates store state to UI observable**

- **Given** `HomeViewModel` subscribed to `FakePushPermissionStore`
- **When** the store emits state transitions: NOT_DETERMINED → DENIED → AUTHORIZED
- **Then** the VM's observable emits the same sequence in the same order
- **And** no emissions are dropped or duplicated

**Scenario: VM unsubscribes on scope cancellation**

- **Given** `HomeViewModel` with active store subscription
- **When** the parent ViewModelScope is cancelled
- **Then** the store subscription is released within 10ms
- **And** no leaked observer remains

**Scenario: All 4 PushPermissionState values handled**

- **Given** the banner renders for each state in sequence
- **When** state is NOT_DETERMINED → banner absent
- **When** state is AUTHORIZED → banner absent
- **When** state is DENIED → banner present
- **When** state is RESTRICTED → banner present (treated as denied for UX purposes)

## Test Plan (TDD)

### Red

1. Locate the three files: `PushPermissionDeniedBanner.kt`, `HomeScreen.kt` (push integration block around line 99), `HomeViewModel.kt`.
2. Locate or create `FakePushPermissionStore` in commonTest.
3. Add the 3 test files.
4. Run `./gradlew :shared:jvmTest --tests "*PushPermission*"` → RED.
5. Expected RED:
   - State-flip test likely RED if HomeScreen doesn't reactively recompose.
   - Unsubscribe test likely RED if VM leaks observer.
   - All 4 state values test likely RED if RESTRICTED is not handled.

### Green

1. For each surfaced bug → minimum fix → re-run → GREEN.
2. Sonar coverage ≥90%.
3. Manual smoke on dev Android device:
   - Deny permission → confirm banner appears on Home.
   - Tap banner → confirm Settings opens to the app's notification panel.
   - Grant in Settings → return to app → confirm banner disappears.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (adds Compose/VM tests + may fix `shared/commonMain` + Android intent code) → the FULL gauntlet applies. The banner is **Android-only** (iOS push UI is [[SHY-0018]]); `PushPermissionDeniedBanner` + `HomeScreen` push block + `HomeViewModel` live in commonMain/Android.

**Frameworks exercised (RED→GREEN before any production fix):**
- ✅ **Kotlin/JVM unit (Compose UI in commonTest)** — `PushPermissionDeniedBannerTest` + `HomeScreenTest` + `HomeViewModelPushObservableTest` (`./gradlew :shared:jvmTest`); all 4 `PushPermissionState` values; the story's primary RED→GREEN.
- ✅ **Android unit (Robolectric)** — the settings-deep-link intent-construction test (`ACTION_APPLICATION_DETAILS_SETTINGS`) where commonTest lacks an Android `Context`.
- ✅ **detekt + ktlint + iOS shared compile-check** — `./gradlew :shared:compileKotlinIosArm64` (commonMain banner state must keep compiling for iOS).
- ✅ **Android instrumented BDD + Manual-QA journey matrix** — deny notifications → banner appears on Home → tap → the app's own notification settings opens → grant → banner disappears, walked on a **real Android device**.
- ⬜ **Web E2E / integration / eslint / Express Jest / iOS XCUITest** — N/A (Android-only banner, no web/API); the iOS app still runs the regression corpus on the real iPhone as the net.
- ✅ **SonarCloud** — coverage gate (≥90% on the 3 files, per AC).

**LOCAL gauntlet:** unit/Compose suite (all 4 states) green → push-banner journey on a real Android device → impact-selected each loop, full corpus at the pre-push gate. Any failure → fix TDD → restart the whole local gauntlet.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; real Android + real iPhone; web = Chrome only. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt.

## Out of Scope

- **The `push_permission.feature` BDD file** — covered by [[SHY-0043]] (G006 — the cold-start scenario; the other scenarios already shipped via PR #1015).
- **iOS push-permission UI** — `IosPushBridge` covered by SHY-0018; this SHY is Android-only.
- **Refactoring PushPermissionStore** — only test coverage.
- **Adding new push features** — only existing.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **PR #1010** (already merged) — the feature being tested.
- **SHY-0010** — HomeViewModel base tests; this SHY adds the push-observable sub-coverage.
- Existing Compose test infrastructure.
- Robolectric or instrumented test runner for intent validation (verify which the project uses).

## Risks & Mitigations

- **Risk:** Compose UI tests in commonTest may not have full instrumented-test capabilities. **Mitigation:** use `ComposeUiTest` from `@OptIn(ExperimentalTestApi::class)`; if not sufficient, fall back to `androidUnitTest` source set.
- **Risk:** Intent validation requires Android-specific Context, not available in commonTest. **Mitigation:** mock with Robolectric in `androidUnitTest` for the intent-construction test; keep state-flip + banner-rendering tests in commonTest.
- **Risk:** PushPermissionStore is a process-singleton; tests interfere. **Mitigation:** koin reset between tests; use injected fakes.
- **Risk:** RESTRICTED state handling may genuinely be missing in PR #1010. **Mitigation:** GOOD outcome — fix in this PR.

## Definition of Done

- [ ] 3 test files exist; ~15 test cases pass.
- [ ] Any surfaced bugs fixed.
- [ ] Sonar coverage ≥90%.
- [ ] Manual smoke on dev Android device passes.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): unit/Compose suite (all 4 push states) green + push-banner journey green on a **real Android device** + iOS regression on real iPhone → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated; smoke outcome in Notes.

## Notes (running log)

- 2026-06-07 ~21:10 BST — Refined under SHY-0032. P1 Tier 3 coverage. Closes the test loop on PR #1010's freshly-shipped feature.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-B1` (roadmap_ids: G005, G013, G029).
- 2026-06-12 ~23:55 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): Android-only push-banner tests → Compose/VM unit (all 4 states) + Robolectric intent test + real-device banner journey. DoD auto-merge → judgment-merge. **Pickup-fitness fix:** corrected stale cross-refs — the `push_permission.feature`/G006 work is [[SHY-0043]] (rescoped to the cold-start scenario), NOT SHY-0033 (the Done 506-branch cleanup).
- 2026-06-13 ~01:55 BST — **No-Stubs flag (review-surfaced)** ([[feedback-no-stubs-mocks-fakes-real-only]]): AC/BDD/Test-Plan name `FakePushPermissionStore` + a Robolectric-mocked intent test — new in-process doubles the rule bans. Same foundational-fake class as [[SHY-0010]]'s VM `FakeRepository` pattern (🔴 operator-decision item on the SHY-0091 handoff). New work should use real emulator/real-device permission state where inducible; the AC/BDD prose is superseded by the No-Stubs banner atop `## Acceptance Criteria` pending operator direction — NOT re-architected here (opportunistic, no big-bang).
