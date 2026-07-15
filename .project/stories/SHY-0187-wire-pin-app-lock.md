---
id: SHY-0187
status: In Review
owner: claude
created: 2026-07-14
priority: P1
type: bug
effort: L
roadmap_ids: []
epic: EPIC-0004
mvp: true
---

# SHY-0187: Wire the PIN/biometric App-Lock into navigation (it is built + tested but never actually locks)

## User Story

**As** a user (often a minor) who set a PIN/biometric App-Lock,
**I want** the app to actually require my PIN/biometric before showing my account after a cold launch or a background-timeout,
**So that** someone with physical access to my unlocked phone cannot open ShyTalk and see/act as me — which is the entire point of the lock I enabled.

## Why

**Confirmed security defect (re-verified 2026-07-14, first surfaced 2026-07-09).** The App-Lock feature is fully built, DI-bound, and unit-tested — but **never wired into navigation, so it never locks**:
- `AuthViewModel` SETS `needsLockScreen = true` (`AuthViewModel.kt:132,146`) when a stored credential + lock is required, but **nothing reads it** (grep: zero consumers outside the declaration).
- `LockScreen(onUnlocked, onReauthRequired, viewModel)` (`LockScreen.kt:37`) + `LockScreenViewModel` exist, are Koin-bound (`ViewModelModule.kt:47`), and jvmTested (`LockScreenViewModelTest`) — but `LockScreen()` has **zero call-sites** and `Screen.Lock` (`Screen.kt:75`) is **never registered** in `SharedNavGraph`.
- So after a cold launch / background-timeout the gate flag flips and **nothing renders** → the app opens straight to Main with no re-auth.

Operator decided 2026-07-09 this is **in MVP scope, a security bug** ("Fix it — wire up App-Lock"). The intended tracking ID (SHY-0168) was later reused for the no-direct-backend ratchet, leaving this untracked — hence this story. Grouped under **EPIC-0005** (enforcement/safety). NB: `isDeviceLocked` (device-BAN, `SignInScreen.kt`) is a SEPARATE, live path — do not conflate.

## Acceptance Criteria

### Happy path
- [ ] On COLD launch, a user with App-Lock enabled + lock-required lands on the Lock screen and must pass PIN/biometric before Main renders.
- [ ] On WARM resume after the background timeout, the Lock screen is shown before the previously-visible content.
- [ ] A correct PIN/biometric unlocks → navigates to Main (Lock removed from the back stack; back-button can't skip it).
- [ ] The enrolment surface is reachable: Settings offers a Security entry on BOTH platforms → App-Lock toggle + timeout; reset-PIN opens PIN setup (the only `setAppLockEnabled`/`setCredential` callers — without them the lock can never be turned on by a user).

### Error paths
- [ ] `requiresReauth` (Firebase session expired) routes to Sign-In, not a dead Lock screen.
- [ ] Repeated wrong PIN follows the existing `LockScreenViewModel` lockout (`isLocked`) — the account-locked state renders.

### Edge cases
- [ ] A user with NO stored credential / lock disabled is never shown the Lock screen (no false gate).
- [ ] iOS and Android resolve the SAME launch destination for the same auth+lock state (no platform asymmetry — the current `MainViewController` hardcodes `Screen.SignIn` while `MainActivity` routes to `Main` directly).

### Performance
- [ ] The launch-destination decision is pure/synchronous (no added network round-trip); the lock gate adds no perceptible cold-start delay beyond rendering the screen.

### Security
- [ ] The lock cannot be bypassed by: back button, deep link, process-death+restore, or rotation — a locked session always re-gates.
- [ ] No PIN/biometric secret is logged; the lock state is local-only (App-Lock does NOT touch the backend, so it's outside [[feedback-no-direct-backend-all-via-api]]).

### UX
- [ ] The lock screen matches the enrolled method (PIN vs biometric) and offers the reauth path when the session (not just the lock) expired.

### i18n
- [ ] Lock strings (`enter_pin`, `account_locked`, …) resolve in all 20 locales (already exist; verify the gate uses them).

### Observability
- [ ] Whether a launch was gated by the lock (and the resolved destination) is logged (unredacted local/dev per [[feedback-comprehensive-default-debug-logging]]); no secret logged.

## BDD Scenarios

**Scenario: cold launch with App-Lock enabled gates entry**
- **Given** a returning user with a stored credential and App-Lock enabled + lock-required
- **When** the app cold-launches
- **Then** the Lock screen renders and Main is not reachable until PIN/biometric passes

**Scenario: warm resume after timeout re-locks**
- **Given** the app was backgrounded past the lock timeout
- **When** it returns to foreground
- **Then** the Lock screen is shown before the prior content

**Scenario: no lock configured → no gate**
- **Given** a user without App-Lock enabled
- **When** the app launches
- **Then** it goes to the normal destination with no Lock screen

**Scenario: same destination on both platforms**
- **Given** identical auth+lock state
- **When** `resolveLaunchDestination` runs on Android and on iOS
- **Then** both yield the same destination (Lock when lock-required)

**Scenario: expired session routes to Sign-In not Lock**
- **Given** the Firebase session expired (reauth required)
- **When** the launch destination is resolved
- **Then** it routes to Sign-In, not the Lock screen

**Scenario: a user can actually turn the App-Lock on**
- **Given** a signed-in user on either platform
- **When** they open Settings → Security
- **Then** the Security screen renders with the App-Lock toggle and lock-timeout options
- **And** the reset-PIN action opens the PIN setup screen so a credential can be stored

## Test Plan

Touches `shared/**` + `app/**` + `iosApp/**` (launch routing) → **full protocol**.

**Red → Green:**
- **Kotlin jvmTest — a NEW pure `resolveLaunchDestination(auth+lock state): Screen` in commonMain** (the design's centerpiece — both platforms + commonTest consume it, killing the asymmetry). Exhaustive matrix: (hasProfile × hasDOB × needsLegalAcceptance × needsLockScreen × requiresReauth) → exact destination; lock-required ALWAYS wins the gate before Main; no-lock → normal route; reauth → Sign-In.
- **Kotlin jvmTest — `onAuthSuccess` decision** now threads `needsLockScreen` (currently not even passed to the `SharedNavGraph.kt:166` when-block).
- **Android instrumented `app/src/androidTest/assets/features/lock_screen.feature` (EXISTS)** — real-device: cold launch + warm-resume gate render + unlock→Main + back-button-can't-skip.
- **iOS** — the `MainViewController` start destination consumes `resolveLaunchDestination` (not a hardcoded `Screen.SignIn`).
- **Device gauntlet** — real Android + real iPhone: enable lock → background past timeout → foreground → must re-auth; cold launch → must re-auth; wrong-PIN lockout renders.
- **Kotlin jvmTest — enrolment-surface pins (added at device-gauntlet pickup)**: `AppLockWiringPinTest` additionally pins the Settings→Security entry (`settings_securityItem` + `onNavigateToSecurity` on both platforms), `composable(Screen.SecuritySettings.route)` + `composable(Screen.PinSetup.route)` registration in BOTH graphs, reset-PIN routing to PinSetup, the iOS params threading, and the absence of the destination-less linked-accounts row — because "enable lock" (the device step above) had no real user path until these screens were reachable.

## Out of Scope

- Re-designing the PIN/biometric enrolment UX (only the missing NAV wiring).
- The device-BAN path (`isDeviceLocked`) — separate, already live.
- Changing the lock-timeout policy.

## Dependencies

- None blocking — `LockScreen` + `LockScreenViewModel` + strings already exist. Pure wiring + a shared destination resolver.
- Coordinate with any in-flight change to `SharedNavGraph` / `MainActivity` / `MainViewController` launch routing.

## Risks & Mitigations

- **Risk:** a wiring bug locks OUT a legitimate user or fails to lock. **Mitigation:** the pure `resolveLaunchDestination` is exhaustively unit-tested; the real-device gauntlet proves the render + unlock both ways.
- **Risk:** platform asymmetry re-introduced. **Mitigation:** BOTH platforms call the single shared resolver; commonTest is the cross-platform proof.
- **Risk:** back-stack lets the user skip the lock. **Mitigation:** navigate with `popUpTo(Lock, inclusive=true)` on unlock + a BDD scenario asserting back can't reach Main while locked.

## Definition of Done

Cold-launch + warm-resume both gate on App-Lock across real Android + real iPhone; unlock→Main with no back-stack bypass; `resolveLaunchDestination` unit-tested exhaustively; iOS/Android parity proven in commonTest; `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-07-16 ~00:4x WIB — **code-reviewer R3 on the enrolment-surface commit `8bcb1923c1a`: 2 Critical / 2 Important / 1 Minor — ALL verified against live code, then fixed in `aed3d8f1289` (R4 delta re-review pending).** (Crit-1, silent PIN reset) `onResetPin` routed straight into PinSetup, so anyone holding the unlocked phone could replace the PIN with NO re-auth — the App-Lock's exact threat model, and the row copy already promised "Verify your identity to set a new PIN". Fix (RED-first pin): the reset row now shows `PinVerifyDialog` first WHEN `appLockRepository.hasCredential`; a first-time set (no credential) passes straight through so a new user isn't locked out. `PinRepository` is resolved lazily inside the dialog branch so the no-credential path renders without the API/Firebase chain. (Crit-2, broken feature file) `security_settings.feature` asserted the `linkedAccountsSetting` tag this story removed → rewritten to the 3 runnable scenarios; reset-PIN behaviour documented as device-gauntlet-scoped (needs the real PIN backend the fake Compose harness can't provide). (Imp-3, no real interaction test) added `SettingsNavigationTest.securityRow_navigatesToSecurityScreen` — a RUNNABLE JUnit4 journey test proving the new Settings→Security row opens the screen (appLockToggle renders), plus real `AppLockRepository`+`BiometricAuth` bindings in `TestKoinModule` so the now-reachable screen constructs. (Imp-4, dead `resetPin()` path + first-set auto-prompt + vestigial `localPinHash`) filed into the enrolment story (see below), not force-wired. (Min-5) removed the orphaned `security_linked_accounts(_desc)` strings across 21 locales. Gates: jvmTest **1377/0**, app unit **2233/0**, detekt, ktlint, iosArm64 + iosSimulatorArm64 test compile, app + **androidTest** compile — all green. *(Reviewer also flagged a stray `get_observations`/`smart_outline` "hook" in its context — that's the local mem-tracking tooling, not a real instruction; correctly ignored.)*

- 2026-07-16 ~00:5x WIB — **⚠️ DEVICE WALK (real OnePlus CPH2653, local stack) proved the enrolment SURFACE works but revealed App-Lock ENROLMENT is broken end-to-end — a pre-existing multi-gap defect this story's nav wiring first made reachable. Filed as SHY-0192; it BLOCKS the lock device-gauntlet (can't set a PIN → can't prove the lock).** Proven live: sign-in → Settings → Security screen renders (App-Lock toggle, timeout dropdown, Reset PIN); Reset PIN with NO stored credential routes straight to PIN setup (the C1 no-credential branch) — screenshots `03/04/06/07`. BLOCKED live: setting a first PIN — (1) `POST /api/auth/pin/setup` returns `{message:'PIN set'}` but both clients do `response.getString("pinHash")` → "No value for pinHash"; (2) after a stopgap server fix, enrolment then fails "Device not registered" because `PinSetupViewModel.savePinToServer` reads `appLockRepository.storedUniqueId`/`storedDeviceId` and bails BEFORE calling `setCredential` — which is the ONLY writer of those keys (circular; first PIN can never be set). Unit tests pass only because their fakes pre-seed that state (the real-only rule's exact rationale). The stopgap server fix was **reverted from this branch** (backend change would balloon this KMP story's gauntlet + the fix is incomplete); the whole enrolment repair (pinHash contract + circular device guard + vestigial `localPinHash` since verify is online + unwired `needsPinSetup` + dead `resetPin()`/endpoint) lives in **SHY-0192**. This story's verify-gate is host-pinned; its full LOCK device-gauntlet (cold-launch gate, warm-resume re-lock, back-bypass, wrong-PIN lockout) is **blocked on SHY-0192** — a real user can't set the PIN the lock needs.

- 2026-07-15 ~23:50 WIB — **Device-gauntlet pickup surfaced the THIRD unwired layer: the enrolment surface. Wired in-scope (R3 delta review pending before push).** Walking the story's own device step ("enable lock → background past timeout") was impossible for a real user: `SecuritySettingsScreen` (the ONLY `setAppLockEnabled` caller) and `PinSetupScreen` (the ONLY `setCredential` caller) had ZERO navigation consumers — `Screen.SecuritySettings` + `Screen.PinSetup` were registered nowhere, so the App-Lock could never be turned on outside tests (tests compose screens directly, which is exactly how all three layers of this defect stayed green). Faking the precondition via prefs injection would violate real-only; the story IS the nav-wiring story → wired here, RED-first: **+5 pins in `AppLockWiringPinTest`** (watched fail: Settings security entry `settings_securityItem`, both graphs register SecuritySettings, both register PinSetup + route reset-PIN to it, IosPlatformScreens threads the callback, no dead linked-accounts row) → then: Security row in `AppSettingsScreen` Main page (Fingerprint icon, reuses `security_title` — present in all 21 locale files, zero new strings), `AppSettingsScreenParams.onNavigateToSecurity` deliberately NON-defaulted (a platform that forgets must fail to compile, not ship a dead row) — the compiler immediately caught 2 constructor sites in `PlatformScreensTest` (updated), both graphs register `composable(Screen.SecuritySettings.route)` (repo + `BiometricAuth.isAvailable()` via koinInject, back = pop, reset-PIN → PinSetup) + `composable(Screen.PinSetup.route)` (`onCompleted` = pop), `IosPlatformScreens` threads the param, `IosPlatformScreens.kt` added to the pin task's declared inputs. **Removed** the Security screen's `onLinkedAccounts` row + param: no `Screen` route or destination exists for it anywhere (linked accounts live INSIDE `AppSettingsScreen` as an internal page) — a visible row that does nothing is a shipped placeholder; a future story re-adds row + route + pin together (pin `security settings carries no dead linked-accounts row` keeps it out til then). Pins 14/14 + params 9/9 verified via result XML. Full host gates + R3 + the device walk (REAL enrolment now) follow.
  **iOS Debug-Local device build root-causes (3, all fixed/documented):** (1) `KOTLIN_FRAMEWORK_BUILD_TYPE=debug` must be passed on the xcodebuild command line for `-Local` configs — the shared `Local.xcconfig` fronts Debug-Local AND Release-Local so it cannot carry the value (`Dev.xcconfig` line 49 documents this asymmetry); (2) `iosApp/Pods/Pods.xcodeproj` was MISSING from the workspace (support files + Manifest.lock intact — partial clean artifact) → every CocoaPods module (`FirebaseCore`/`GoogleSignIn`/`FirebaseMessaging`) failed dependency scanning; `pod install` regenerated it (lockfiles matched, zero version drift); (3) NEVER selectively delete `ModuleCache.noindex`/`ExplicitPrecompiledModules` from a derivedData — the incremental build DB still references the deleted `.scan` artifacts ("Failed to query serialized dependencies"); a SIGKILLed xcodebuild corrupts these caches, and the recovery is deleting the WHOLE derivedData dir, not spot-cleaning. Build DONE; staleness probe: `resolveLaunchDestination` ×2 + `recordAppBackgroundedForAppLock` ×2 present in `iosApp.debug.dylib` (the R1 Imp-5 "first xcodebuild" proof of the AppDelegate observer). Also noted: pod install warns CocoaPods Firebase stops publishing new versions after Oct 2026 — future SPM-migration story for the backlog.

- 2026-07-15 ~05:50 WIB — **code-reviewer R2.1 delta on `7ff85204a70` (same agent, resumed): ZERO FINDINGS — CLEAN.** All four R2 fixes independently confirmed: (Crit-1) only 2 `requestOpenPm` call sites exist repo-wide, both inside the new gated effect; all 4 paths clear the pending state; BOTH race orderings verified gated. (Imp-2) delegation verified byte-for-byte vs the resolver; all 4 call sites pass live auth facts; the 96-combination agreement property "would fail on almost any future regression". (Imp-3) all 12 `authenticateWithBiometric(` call sites 2-arg (zero stale); seams confirmed structurally unshippable (jvmMain has no dependents/distribution); the 10 tests hand-traced against the mutant — 3 independently RED. (Min-4) reciprocal epic links verified. Review-clean → pushed.

- 2026-07-15 ~05:30 WIB — **code-reviewer R2 on `c6c2d21d8eb` (agent ac2848b2ab0bb63e0): 1 Critical / 2 Important / 1 Minor — ALL verified against live code, then addressed; R2.1 delta re-review PENDING before push.** (Crit-1, 4th ungated reveal path) `handleRoomIntent`'s inRoom branch called `requestOpenPm` synchronously from onCreate/onNewIntent — ahead of ON_RESUME's re-lock interpose and with NO push-authz re-check (RoomScreen collects `pendingPmOpen` at ON_START, so the PM sheet could render before the Lock) → now publishes `pendingInRoomPmState`, consumed by a NEW gated LaunchedEffect in composition (lock gate with the real currentRoute → identity gate → `verifyPushNavigation` → `requestOpenPm`; drop-and-log fail-closed at every gate; both race orderings safe — whichever of relock/effect runs first, route==Lock or a due/dead state gates). RED-first pins: androidGates ≥2→≥3, `pendingInRoomPmState` presence, `verifyPushNavigation(` ≥2. (Imp-2, gate blind to rule 4) `isNavigationLockGated` couldn't represent dead-session state → signature gains isAuthenticated+hasResolvedUser and the body now DELEGATES to `resolveLaunchDestination` (gated ⇔ route==Lock ∨ resolver==Lock — the two can never diverge again); all 4 call sites updated (MainActivity ×3, MainViewController ×1); RED-first commonTest: rule-4 gating matrix + 96-combination gate/resolver agreement property + signed-out-not-lock-gated (the identity gate owns that drop). (Imp-3, biometric path zero coverage) the root blocker was `getString(Res…)` suspending on real compose-resource IO inside the VM — parks the host-JVM test scheduler forever (discovered via the first RED run) → prompt strings hoisted to the UI layer (`LockScreen` resolves via `stringResource` and passes into `authenticateWithBiometric(bioTitle, bioDesc)`; the VM does no compose-resource IO — errors stay lazy `UiText`) + `*ForTest` seams on the jvmMain-ONLY BiometricAuth/CryptoKeyPair stubs (never shipped; they exist to host jvmTest) + FakeBiometricRepository made configurable → 10 value-level tests drive the REAL flow (challenge→sign→verify→restore): exact-token + exact-base64-signature asserts, dead-session restore, restore-fail→reauth-never-unlock, live-session-no-resign, timestamp refresh, verify-fail, challenge-fail, null-signature, Fallback, hardware-Error, missing-stored-ids. MUTANT-verified per [[feedback-verify-the-mutant-not-just-the-mutation]]: the verbatim db7de0e7ec4 onSuccess body reapplied → exactly the 3 security tests went RED → restored. (Min-4, epic mismatch) SHY-0187 + SHY-0189 retagged EPIC-0005→EPIC-0004 (persistent-session/cold-start — where the App-Lock was built) + both added to EPIC-0004 `child_shys`; SHY + EPIC validators `--scan` green. Gates after fixes (single invocation): jvmTest **1371/0**, app unit **2233/0**, compileTestKotlinIosSimulatorArm64 ✓, compileKotlinIosArm64 ✓, assembleDevDebug ✓, detekt ✓, ktlint (all 10 touched files) ✓.

Reviewed-up-to: 7ff85204a70

- 2026-07-14 ~18:45 WIB — **code-reviewer R1 on `db7de0e7ec4`: 2 Critical / 4 Important / 3 Minor — ALL addressed in the follow-up commit (R2 delta re-review PENDING — next session runs it BEFORE any further push; laptop-restart handoff).** (Crit-1, deep-link bypass) push/room/chat deep links navigated over/ahead of the Lock on BOTH platforms → new pure `isNavigationLockGated` (Lock-showing OR lock-due; covers the pre-composition intent race) + fail-closed drop-and-log wired at ALL THREE call sites (MainActivity room + chat effects, MainViewController collector), RED-first commonTest ×3 + a pin requiring ≥2 gates in MainActivity + 1 in MVC. (Crit-2, discarded restore token) `LockScreenViewModel` never consumed the `customToken` from PIN/biometric verify → rule-4 unlocks landed on Main with a DEAD session; now `restoreSessionAndUnlock` restores via `authRepository.signInWithCustomToken` when `!isAuthenticated` BEFORE unlocking (both PIN + biometric paths — biometric verify ALSO returns the token), failure → `requiresReauth` (never unlocked), RED-first VM tests ×5 (restore-recorded, restore-fail→reauth, live-session-no-resign, + the two below). (Imp-3, stale clock) success path now writes `updateLastActiveTimestamp` → no immediate re-lock on rotation/next resume; failed restore deliberately does NOT (fail-closed) — both value-tested. (Imp-4) gradle jvmTest inputs += `KoinHelper.kt` + `AppDelegate.swift` (the pin's full read-set). (Imp-5) NEW `iosAppTests/AppLockBridgeTests.swift` — bridge fail-closed-before-Koin + selector-resolves tests (⚠️ NOT yet compiled/run — needs xcodebuild; first exercised at the next device build). (Imp-6 + Min-9) → **SHY-0189 filed fully-refined** (lockout voice-disconnect + audio-under-lock; ⚠️ operator MVP-triage flag). (Min-7) `needsLockScreen` doc-commented as informational-only. (Min-8) pin-test substring limitation documented in its KDoc. Gates after fixes (single invocation): jvmTest **1356/0** (LockScreenViewModelTest 33/0), androidHostTest **558/0**, K/N test compile ✓, iosArm64 ✓, app compile ✓, detekt ✓, ktlint (all touched incl. untracked) ✓.

- 2026-07-14 ~17:50 WIB — **IMPLEMENTED (TDD throughout; architect fitness self-validated Draft→In Progress→In Review; fresh-session pickup as planned).** Pickup fitness surfaced FOUR spec-relevant facts, each verified live before code: **(1) Android does NOT use SharedNavGraph** — MainActivity composes its own near-duplicate `app/.../navigation/NavGraph.kt` (iOS consumes SharedNavGraph via MainViewController) → the wiring lands in BOTH graphs; wiring only the shared one (as the Test Plan's file refs implied) would have fixed iOS and left the Android bug live. **(2) Design deviation — `onAuthSuccess` does NOT thread `needsLockScreen`** (Test Plan had proposed it): the flag is set only in AuthViewModel's INIT (cold state); `onAuthSuccess` fires after an ACTIVE fresh sign-in where the user just proved identity — gating there would double-gate, and the launch-resolver + resume-gate cover every state where the lock must render. `needsLockScreen` is consciously KEPT as state (accurate, may serve UI later) but is superseded as a routing signal. **(3) The resolver mirrors AuthViewModel's init exactly, including the subtle path (b):** credential + DEAD session (even with App-Lock disabled) → Lock — the PIN doubles as the session-restore credential; LockScreenViewModel's `requiresReauth` (now WIRED to `onReauthRequired` → Sign-In `popUpTo(0)`) satisfies the "expired session routes to Sign-In, not a dead Lock" AC through the designed flow. **(4) iOS never recorded the background timestamp** (`updateLastActiveTimestamp` writers were Android's ProcessLifecycleOwner onStop + `setCredential` only) → after one unlock the resume gate would have re-locked iOS on EVERY resume (elapsed measured from an ancient write). Fixed in-scope: `KoinHelper.recordAppBackgroundedForAppLock()` (fail-closed if Koin isn't up) + AppDelegate `didEnterBackgroundNotification` observer — both platforms now measure the timeout as time-in-background.
  **Delivered:** `resolveLaunchDestination` (pure, commonMain) consumed by MainActivity (replacing the lock-blind initialRoute) AND MainViewController (replacing the hardcoded Sign-In — iOS also gains the silent-restore fast path, killing the asymmetry); `shouldRelockOnResume` (pure) + `AppLockResumeGate` mounted in BOTH graphs; `composable(Screen.Lock.route)` registered in BOTH graphs with warm-vs-cold unlock routing (pushed-over-content → pop back; stack-root → Main with Lock popped inclusive) and reauth routing; `PlatformBackHandler` consumes back on the Lock screen; cold-launch destination + resume re-lock decisions logged unredacted (no secret logged — route names + booleans only).
  **TDD evidence (RED watched for every layer):** `LaunchDestinationTest` (commonTest, 10 tests — exhaustive 32-state matrix + per-AC named tests; RED via unresolved reference) with TWO mutations killed (lock-gate→Main: exactly 5 tests red; relock exemption dropped: exactly the no-double-gate test red; both restored green). `AppLockWiringPinTest` (jvmTest, 6 pins; all 6 watched RED pre-wiring — the pin suite IS the "built but never wired" regression guard, one pin per wiring point incl. the iOS timestamp bridge) + `shared/build.gradle.kts` jvmTest input declaration for the 3 out-of-compilation guarded files (MainActivity, app NavGraph, MainViewController). Full gates: jvmTest **1346/0** (+15), testAndroidHostTest **555/0** (+10), `compileTestKotlinIosSimulatorArm64` ✓ (names K/N-legal per SHY-0186), `:shared:compileKotlinIosArm64` ✓, `:app:compileLocalDebugKotlin` ✓, detekt ✓, ktlint ✓ (one import-ordering autocorrected).
  **Instrumented/device layer:** `lock_screen.feature`'s 4 scenarios now exercise the REAL registered destination + the real `onUnlocked`→Main callback (pre-fix they drove an unregistered route through the test harness). The cold-launch / warm-resume / back-bypass ACs are deliberately NOT added as Compose-rule scenarios: the repo's own hard-won note (WalletAndTransactionsTest) documents system back-press dispatch as deterministically flaky under `mainClock.autoAdvance=false`, and cold-launch requires the real MainActivity path the `launchNavGraph` harness bypasses — those three ACs are proven at the real-device gauntlet (journeys drive hardware back + real cold launches), per the MVP device-E2E batching. **Deferred to the batched device gauntlet:** real-Android + real-iPhone cold-launch gate, warm-resume re-lock, back-cannot-skip, wrong-PIN lockout render, and the iOS Swift observer compile (AppDelegate.swift builds only under xcodebuild — first exercised by the next Debug-Dev device build). Pre-existing quirk observed, NOT introduced (out of scope): a cold start that resolves straight to Main leaves `resolvedUniqueId` unset until a screen instantiates AuthViewModel, so a push deep-link in that window is dropped with a warning — Android behaves this way today; iOS now inherits the same (parity includes the quirk).
- 2026-07-14 — Filed from a re-confirmed proactive-QA finding ([[project-applock-pin-appears-unwired-finding]] has the full grep evidence + the operator's 2026-07-09 fix decision + a 6-part wiring design). The earmarked ID SHY-0168 was reused for the no-direct-backend ratchet, so this security defect had NO tracking story until now. `mvp: true` per the operator decision (security bug in MVP scope). Recommended pickup: implement the pure `resolveLaunchDestination` + tests FIRST (host-verifiable, zero behaviour change until wired), then the platform gates (device-batched).
