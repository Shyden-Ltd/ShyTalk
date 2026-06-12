---
id: SHY-0024
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: L
type: refactor
roadmap_ids: [G028]
pr:
mvp: true
---

# SHY-0024: Migrate Android to SharedNavGraph + delete NavGraph.kt

## User Story

As the ShyTalk operator, I want **Android to use the same `SharedNavGraph.kt` that iOS already uses**, so that the tri-platform policy holds, the silent `AgeVerificationSubmit` parity bug is closed, and every future navigation feature lands once instead of twice.

## Why

ShyTalk currently has **two parallel navigation files** doing essentially the same job:

- `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt` (979 lines) — Android-only, called from `MainActivity.kt:476` and from `NavGraphTestHelper.kt` in 11 androidTest journey files.
- `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/SharedNavGraph.kt` (806 lines) — KMP-friendly, called from `iosMain/.../MainViewController.kt:150` for iOS production.

Both files wire up the same `Screen.X.route` set via `composable(Screen.X.route) { ... }`. The 173-line delta is Android-specific platform plumbing (FCM token registration, `ActivityResultContracts` image picker, push-permission `notifyPushPermissionPrompted`, billing service injection) which `SharedNavGraph` already factors out into two port files:

- `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/PlatformNavCallbacks.kt` (13 hooks)
- `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/PlatformScreens.kt` (35 hooks)

iOS provides Swift-backed implementations of these ports via `MainViewController.kt`. Android currently _does not_ — Android skips the port pattern entirely and inlines its platform calls directly in `NavGraph.kt`.

**The drift is already a live bug.** Diffing the two route sets:

```
SharedNavGraph routes (18): SignIn, EmailSignIn, ProfileSetup, RequiredDOB,
  AgeVerificationSubmit, Splash, Main, Settings, Wallet, Transactions,
  NewMessage, ReportReview, Warning, LegalAcceptance, CommunityStandards,
  CyberBullyingPolicy, PrivacyPolicy, TermsAndConditions

NavGraph routes (17): same set MINUS AgeVerificationSubmit
```

`AgeVerificationSubmit` was added to `SharedNavGraph.kt` in commit `3345af70cb8` ("feat(age-verif): PR 9 — user verification submit screen"). The Android `NavGraph.kt` never got the same route. Android users cannot currently navigate to the age-verification submit flow — a silent feature-parity failure that violates the tri-platform policy in `CLAUDE.md` line 6 ("ALL work must ship on desktop (web), iOS, and Android simultaneously").

Operator approved Option 1 (migrate Android → SharedNavGraph; delete `NavGraph.kt`) on 2026-06-07 ~20:25 BST after reviewing 4 options (keep both with rulebook, reverse direction, gradual feature-flag — all rejected with reasons in SHY-0032 Notes).

Roadmap row G028 (line 104 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt` (979 lines). Android uses Android-specific NavGraph.kt; iOS uses SharedNavGraph.kt; duplication or wrong-graph use. Fix: Audit: migrate Android to SharedNavGraph OR document coexistence prominently. **May need operator checkpoint**. Scope: M.

The operator's decision elevates this from M-scope-with-checkpoint to L-scope-decided.

## Acceptance Criteria

### Happy path

- [ ] `app/src/main/java/com/shyden/shytalk/MainActivity.kt:476` no longer references `NavGraph(...)` — it instantiates `SharedNavGraph(navController, startDestination, ..., platformCallbacks = androidNavCallbacks, platformScreens = androidPlatformScreens)`.
- [ ] A new file `app/src/main/java/com/shyden/shytalk/navigation/AndroidPlatformAdapters.kt` (or equivalent) provides Android implementations of every `PlatformNavCallbacks` hook (13) and every `PlatformScreens` hook (35), wiring the Android-specific calls previously inlined in `NavGraph.kt`.
- [ ] `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt` is deleted (979 LOC removed).
- [ ] `app/src/androidTest/java/com/shyden/shytalk/util/NavGraphTestHelper.kt:16` (currently `NavGraph(...)`) is updated to `SharedNavGraph(...)` with test-double implementations of the platform ports (or production adapters where journey tests need the real behaviour).
- [ ] All 11 androidTest journey files that call `composeTestRule.launchNavGraph(...)` continue to pass without test-code changes (the helper change is invisible to call sites): `WarningAcknowledgmentTest`, `SettingsNavigationTest`, `AuthFlowTest`, `ProfileTest`, `GroupChatCreationTest`, `LegalAcceptanceTest`, `GiftWallJourneyTest`, `LinkedAccountsTest`, `FollowListJourneyTest`, `WalletAndTransactionsTest`, `PushPermissionSteps`-driven scenarios.
- [ ] `./gradlew assembleDevDebug` produces a working APK.
- [ ] `./gradlew :shared:compileKotlinIosArm64` still passes (no iOS regression).
- [ ] `./gradlew connectedDevDebugAndroidTest` passes on a real Android device against local stack.
- [ ] On a launched dev build, navigating from the `AgeRestrictionDialog` (Gacha gate) reaches the `AgeVerificationSubmit` screen on Android (previously blocked).
- [ ] On a launched dev build, all 17 existing routes still navigate correctly (verify via the `ios_parity_navigation.feature` journey corpus, run against Android).

### Error paths

- [ ] If `AndroidPlatformAdapters` is missing a hook implementation, `./gradlew compileDevDebugKotlin` fails with a clear compile-error naming the missing override (Kotlin will catch this via interface implementation contract).
- [ ] If `SharedNavGraph` is launched on Android with `platformCallbacks = null` (regression scenario), the app crashes at startup with a NullPointerException naming the missing parameter — verified by a unit test in `app/src/test/.../SharedNavGraphLaunchTest.kt` that constructs the graph without callbacks.
- [ ] If the migration accidentally drops a route (e.g. typo in the adapter for `PlatformScreens.profileSetupScreen`), Android startup hits the missing route and surfaces a `NavController` "route not found" error — verified by an instrumented test that navigates to every route in `Screen.kt`.
- [ ] If the migration breaks the existing FCM token registration (was inlined at `NavGraph.kt:120-145`), the registration moves to the Android adapter; an integration test asserts `FirebaseMessaging.getInstance().token` is fetched on first launch.
- [ ] If the migration breaks the image-picker `PickVisualMedia` launcher, the relevant Profile/Conversation screens fail-loudly with a logged `IllegalStateException` rather than silently no-oping.

### Edge cases

- [ ] Process-death recovery: kill the Android app via `adb shell am kill com.shyden.shytalk`; relaunch; the back-stack restores to the same route (Compose Navigation saves `currentBackStackEntry` to bundle, but the migration must not break this — instrumented test required).
- [ ] Rotation during navigation: rotate the device mid-navigation between two screens; the destination resolves correctly post-rotation (instrumented test).
- [ ] Deep-link from a notification into a route that requires authenticated state: the SharedNavGraph's `LaunchedEffect(Unit) { navController.currentBackStackEntryFlow.collect { currentUserId = ... } }` block (line 105-109 of `SharedNavGraph.kt`) must re-sync `currentUserId` correctly on Android — verified by an integration test that launches via deep-link.
- [ ] Sign-out during navigation: the existing `onSignOut` callback propagation must continue to work through the port adapter — verified by an instrumented test that signs out from `AppSettings` and asserts navigation lands at `SignIn`.
- [ ] Suspension overlay (real-time, via `observeUserFlags`): the existing `if (uid != null) { ... }` block in `SharedNavGraph.kt` (line 114-120) must continue to trigger on Android when a user is server-side suspended mid-session.

### Performance

- [ ] Android cold-start time (from launch to first `Main` screen render) does not regress vs the pre-migration baseline. Baseline must be captured before the migration begins; post-migration must be within ±5% of baseline. Measured via 10 cold-launch runs on the dev Pixel 7 with `adb shell am start -W com.shyden.shytalk/.MainActivity`.
- [ ] Navigation transition time between any two routes does not regress — verified by an instrumented test that times 5 navigations and asserts each completes within 200ms.
- [ ] APK size delta is within −80kb ±10kb (we expect a small reduction from removing 979 lines of Kotlin code).
- [ ] Memory profile (heap usage at the `Main` screen after navigating through 5 routes) does not regress vs baseline.

### Security

- [ ] All `Intent` construction previously in `NavGraph.kt` (e.g. open-settings intent for push permission) moves into the Android adapter; the adapter validates intent destinations to prevent intent-redirection attacks.
- [ ] FCM token handling moves unchanged — token is never logged, never embedded in URL, never sent to non-`shytalk.com` domains.
- [ ] No new exported activities or intent filters introduced (the migration is internal-only; manifest unchanged).
- [ ] Firestore security rules untouched (this is a client-side refactor only).
- [ ] No fall-through to a deprecated WebView surface (PlatformWebView injection point in `SharedNavGraph.kt:32` continues to be wired only via the explicit port; Android adapter does not create rogue WebViews).

### UX

- [ ] No visible UX change to the user. Routes, transitions, back-button behaviour, and screen content remain identical post-migration.
- [ ] The `BackHandler` integration (used by several screens to intercept back-press) continues to work — verified by an instrumented test on the `Room` screen that asserts the leave-confirmation dialog appears on back-press.
- [ ] The `keep-screen-on` behaviour on the `Room` screen (driven by `KeepScreenOn` expect/actual) continues to work post-migration.

### i18n

- [ ] No new user-facing strings introduced. Existing string resource references (e.g. `Res.string.back` in `SharedNavGraph.kt:71`) continue to resolve in all 20 locales.
- [ ] N/A for translation updates — this is a structural refactor only.

### Observability

- [ ] `Log.d`/`Log.w`/`Log.e` calls previously in `NavGraph.kt` (e.g. for FCM token errors) preserved in the Android adapter; same log tags so existing logcat filters keep working.
- [ ] Add structured-logging breadcrumb on Android adapter init: `Log.i("SharedNavGraph", "Android adapter initialized with N callbacks, M screens")` so post-deploy regression can be confirmed at app startup.
- [ ] No new Crashlytics non-fatals introduced; existing non-fatal-report sites preserved.
- [ ] Sonar coverage on the new `AndroidPlatformAdapters.kt` ≥80% (every callback + screen hook must have a unit test).

## BDD Scenarios

**Scenario: Android startup uses SharedNavGraph**

- **Given** the migrated app is launched on Android
- **When** `MainActivity.onCreate` finishes
- **Then** the navigation host renders content from `SharedNavGraph(...)` (not `NavGraph(...)`)
- **And** the start destination resolves to `Screen.SignIn.route` for a signed-out user OR `Screen.Main.route` for an authenticated user with completed onboarding
- **And** logcat contains a single line: `SharedNavGraph: Android adapter initialized with 13 callbacks, 35 screens`

**Scenario: AgeVerificationSubmit route is now reachable from Android**

- **Given** the migrated Android app is running with a signed-in user under 18
- **And** the user taps the Gacha card on `Home`
- **When** the `AgeRestrictionDialog` appears and the user taps "Verify my age"
- **Then** navigation lands on `Screen.AgeVerificationSubmit.route`
- **And** the `AgeVerificationSubmitScreen` composable renders
- **And** the previously-impossible deep-link `shytalk://age-verify/submit` resolves correctly

**Scenario: Existing journey tests pass without modification**

- **Given** all 11 androidTest journey files
- **When** `./gradlew connectedDevDebugAndroidTest` runs against a local stack
- **Then** every test passes
- **And** the only file modified in the helper is `NavGraphTestHelper.kt:16` (`NavGraph(...)` → `SharedNavGraph(...)` with adapter wiring)
- **And** no journey-test assertion text needed updating

**Scenario: NavGraph.kt is deleted with no surviving references**

- **Given** the migration commit
- **When** `git grep -n "NavGraph\\b\\|NavGraph(" -- '*.kt' '*.swift'` runs
- **Then** the only matches are for `SharedNavGraph(...)` and references to the cross-platform graph type, NOT to the deleted `NavGraph.kt`
- **And** `find . -name NavGraph.kt -not -path '*/node_modules/*'` returns no results

**Scenario: iOS production unchanged**

- **Given** the migration PR
- **When** `git diff main -- shared/src/iosMain` is inspected
- **Then** the iOS code path has zero diff (the migration is Android-only)
- **And** `./gradlew :shared:compileKotlinIosArm64` passes in CI

**Scenario: Compile fails loudly if an adapter hook is missing**

- **Given** a regression where one `PlatformNavCallbacks` hook is removed from `AndroidPlatformAdapters.kt`
- **When** `./gradlew compileDevDebugKotlin` runs
- **Then** the build fails with a clear message naming the missing override
- **And** the error references the interface contract, not a runtime crash

**Scenario: PlatformNavCallbacks port may need expansion**

- **Given** the migration audit identifies an Android-specific call in `NavGraph.kt` that has no corresponding hook in `PlatformNavCallbacks` or `PlatformScreens` (e.g. a billing-flow callback)
- **When** the migration commits
- **Then** the missing hook is added to the port file (in `shared/.../PlatformNavCallbacks.kt` or `PlatformScreens.kt`)
- **And** the iOS implementation in `MainViewController.kt` provides a Swift-backed implementation of the new hook (even if it's a no-op marker for now with an explicit `TODO(iOS): wire <feature>` line)
- **And** the architect agent has validated that the port expansion is necessary, not a refactor smell

## Test Plan (TDD)

### Red

1. Add `app/src/androidTest/java/com/shyden/shytalk/migration/SharedNavGraphAndroidLaunchTest.kt`:
   - Asserts `MainActivity` instantiates `SharedNavGraph` (verified by reflection on the bound composable type OR by a feature-flag-style check)
   - Currently FAILS because `MainActivity:476` still calls `NavGraph(...)`
2. Add `app/src/androidTest/java/com/shyden/shytalk/migration/AgeVerificationReachabilityTest.kt`:
   - Launches the Gacha gate; taps verify-age; asserts current route is `Screen.AgeVerificationSubmit.route`
   - Currently FAILS because `NavGraph.kt` has no `AgeVerificationSubmit` route
3. Add `app/src/test/java/com/shyden/shytalk/navigation/AndroidPlatformAdaptersTest.kt`:
   - Asserts every method on `PlatformNavCallbacks` and `PlatformScreens` has a non-`TODO()` implementation in `AndroidPlatformAdapters`
   - Currently FAILS because `AndroidPlatformAdapters` doesn't exist yet
4. Run `./gradlew connectedDevDebugAndroidTest --tests "*migration*"` — all 3 RED.

### Green

1. **Audit**: enumerate every Android-specific call in `NavGraph.kt` (FCM, image picker, push permission, billing, intent construction). For each, identify whether `PlatformNavCallbacks`/`PlatformScreens` already has a hook (most do, per the 13+35 count).
2. **Port expansion (if needed)**: for any Android-specific call without an existing hook, add the hook to the port file and a `TODO(iOS): wire <feature>` no-op in `MainViewController.kt`. Architect agent validates each port expansion.
3. **Create `AndroidPlatformAdapters.kt`**: implement every hook by extracting the relevant code block from `NavGraph.kt` and wrapping it in the port-method signature.
4. **Update `MainActivity.kt:476`**: replace `NavGraph(navController, ...)` with `SharedNavGraph(navController, ..., platformCallbacks = androidNavCallbacks, platformScreens = androidPlatformScreens)`.
5. **Update `NavGraphTestHelper.kt:16`**: replace `NavGraph(...)` with `SharedNavGraph(...)` using test-friendly adapter implementations (real adapters where the journey test needs real behaviour; fakes where it just needs a port).
6. **Delete `NavGraph.kt`**.
7. **Re-run** `./gradlew compileDevDebugKotlin` + `:shared:compileKotlinIosArm64` + `connectedDevDebugAndroidTest`. Iterate until all 3 RED tests + 11 existing journey tests pass.
8. **Cold-start perf baseline check**: run 10 cold-launches pre + post; assert ±5% delta.
9. **Manual smoke on dev device**: navigate through every route in `Screen.kt`; verify Gacha → AgeVerificationSubmit reaches the destination.
10. **Sonar coverage check**: `AndroidPlatformAdapters.kt` ≥80%.

## Out of Scope

- **Option 2 (coexistence rulebook)** — rejected by operator on 2026-06-07.
- **Option 3 (reverse migration — iOS to NavGraph)** — rejected; violates tri-platform policy.
- **Option 4 (gradual feature-flag migration)** — rejected; pre-public release doesn't need the safety margin.
- **Refactoring `SharedNavGraph.kt` itself** — internal structure unchanged; this SHY is purely "Android adopts the existing shared graph".
- **Adding new routes** — route set is preserved exactly (17 → 18 on Android by acquiring `AgeVerificationSubmit` from the shared set; iOS unchanged at 18).
- **Migrating other Android-only navigation patterns** (e.g. `AppLockRepository` intercept in `MainActivity`) — covered by SHY-0009.
- **iOS-side cleanup of any unused `MainViewController` code** — iOS already at canonical state.

## Dependencies

- **SHY-0032** (this batch) — provides the meta-context; refined alongside.
- **SHY-0009** (Lock/PinSetup/SecuritySettings nav coverage) — DEPENDS ON SHY-0024 (must be picked up AFTER this migration completes; otherwise SHY-0009's AC has to hedge on which graph to test against).
- `shared/.../PlatformNavCallbacks.kt` + `PlatformScreens.kt` + `SharedNavGraph.kt` + `Screen.kt` — unchanged contracts; this SHY extends them only if port expansion is required.
- `app/.../MainActivity.kt` — single line change (line 476).
- `app/src/androidTest/.../NavGraphTestHelper.kt` — single line change (line 16) + adapter import.
- Operator decision (2026-06-07 ~20:25 BST): migrate, don't coexist.

## Risks & Mitigations

- **Risk:** Port expansion is needed for an Android-specific call (e.g. `ActivityResultContracts.PickVisualMedia`) that has no `PlatformScreens` analog. **Mitigation:** the SHY explicitly authorises port expansion in `### Error paths` AC bullet; architect validates each expansion is genuine, not refactor-smell.
- **Risk:** Parallel Android feature work (other SHYs touching screens/nav) merges into main mid-refactor, creating large conflict surface. **Mitigation:** freeze other Android nav-touching PRs while SHY-0024 is in flight; if unavoidable, rebase + reconcile route-set explicitly. Operator already aware via SHY-0032 priority bump.
- **Risk:** A subtle behaviour difference between `NavGraph` and `SharedNavGraph` (e.g. the order of `LaunchedEffect`s in the user-suspension observer block) regresses an existing flow. **Mitigation:** the 11 journey tests are the primary regression net; manual smoke on dev device for paths not covered (Wallet, Gacha, Backpack); reviewer agent does diff-by-diff comparison of the two graphs' contents.
- **Risk:** Cold-start perf regresses because the port-adapter indirection adds layers. **Mitigation:** ±5% baseline check is part of AC; if regression > 5%, profile + optimise (likely inlining a hot adapter call rather than reverting the migration).
- **Risk:** Process-death back-stack restoration breaks due to a subtle Compose Navigation save-state difference. **Mitigation:** instrumented test in `### Edge cases` AC bullet exercises kill + relaunch.
- **Risk:** The `NavGraphTestHelper.kt` update accidentally changes journey test semantics (e.g. the Android-test-only callbacks behave differently from production). **Mitigation:** prefer real production adapters in the helper where possible; only use fakes where the test genuinely needs deterministic substitution; reviewer agent verifies each fake.

## Definition of Done

- [ ] `NavGraph.kt` deleted (979 LOC removed).
- [ ] `AndroidPlatformAdapters.kt` (or equivalent) provides all 13+35 hook implementations.
- [ ] `MainActivity.kt:476` instantiates `SharedNavGraph`.
- [ ] `NavGraphTestHelper.kt:16` updated; all 11 journey tests pass.
- [ ] `assembleDevDebug` + `:shared:compileKotlinIosArm64` + `connectedDevDebugAndroidTest` all green.
- [ ] AgeVerificationSubmit route reachable on Android (verified by new test).
- [ ] Cold-start perf within ±5% of pre-migration baseline.
- [ ] Sonar coverage on the adapter ≥80%.
- [ ] Architect agent reports no port-expansion smell.
- [ ] Code-reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied: auto-merge arms once CI is green (per CLAUDE.md `refactor` lifecycle). Post-merge, operator verifies the Gacha→AgeVerificationSubmit path on a dev device (not a merge blocker; it's a post-merge confirmation step). `status: Done` is set only after that post-merge smoke confirms the previously-impossible Android navigation now works.
- [ ] PR merged via auto-merge.
- [ ] `status: Done` set; `pr:` populated; merge timestamp + dev smoke outcome in Notes log.

## Notes (running log)

- 2026-06-07 ~20:25 BST — Operator approved Option 1 (migrate, not coexist) after 4-option AskUserQuestion. Bumped to P0; Tier 1 unblocker. SHY-0009 (Lock/PinSetup nav) declared blocked on this.
- 2026-06-07 ~20:30 BST — Refined under SHY-0032 (this PR). Drift bug confirmed: `AgeVerificationSubmit` missing from `NavGraph.kt` since commit `3345af70cb8` (PR 9 of age-verif cluster). Port count verified: 13 callbacks + 35 screens.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-I1` (roadmap_ids: G028).
