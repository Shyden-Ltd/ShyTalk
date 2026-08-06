---
id: SHY-0143
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: XL
type: feature
roadmap_ids: []
epic: EPIC-0004
pr:
mvp: true
---

# SHY-0143: Persist session → optimistic cold-start to the room list

## User Story

**As** a returning ShyTalk user who is already signed in,
**I want** the app to open straight onto the room-list view — no login screen, no loading/splash screen — with my rooms and messages streaming in a moment later,
**So that** I get instant access every launch (just like every mainstream social app) and never see the login screen again unless my session is genuinely dead — or my device/network is banned, in which case I see the ban screen, never login.

## Why

Today the app shows the SignIn screen on **every** cold start, even when Firebase Auth has already restored the session — because the startup flow blocks on a security-load-bearing **cohort re-resolution** before it trusts the session. `MainActivity:464-474` computes `initialRoute` from `authRepository.isAuthenticated && appLockRepository.hasCredential && authRepository.currentUserId != null`, but `currentUserId` falls back to the raw Firebase UID until `AuthViewModel.resolveProfileState()` (`shared/.../feature/auth/AuthViewModel.kt:498-565`) finishes a backend `checkPmLockOnLogin` round-trip — and that resolved `uniqueId` + cohort are held **in memory only**, never cached, so every cold start re-resolves from scratch and routes through SignIn until it completes.

The fix is **not** "add a session cache" (Firebase already persists the session). It is "make the cohort re-check **non-blocking/optimistic** without weakening cohort security". Cohort segregation — the SHY-0132/0137 cross-cohort-leak boundary — is enforced by custom claims baked into the Firebase JWT and read by Firestore rules on every query. A restored cold-start token carries **last session's** cohort claim, so the security crux is: render the room-list shell instantly, but do not fire any cohort-scoped read until a fresh token has confirmed the cohort is current. The canonical primitive for that is `getIdToken(forceRefresh = true)` (the documented way to pick up updated claims) — fast enough to gate data behind, far cheaper than the full `pm-lock-check`.

**A second class of gate must survive the optimistic path: anti-abuse blocks.** The anti-abuse map (2026-07-01) found the emulator/root gate (`UnsafeDeviceGate.isBlocked()`, `MainActivity:231`, **pre-auth**) and the suspension gate (`SharedNavGraph:116-138`, **reactive** on Main) both already run independently of the route decision — the optimistic path still hits them (safe). **But device bans and network/IP/ASN bans (which are also how VPNs are blocked) run ONLY inside the sign-in flow** — `AuthViewModel.checkAndApplyBan():471-495`, reached only via `signInWithGoogle/Apple()`. The optimistic cold-start skips sign-in → those checks never fire → **a banned device or network would land straight in the room list.** So this story must **hoist the device+network ban check to a pre-routing gate** that runs on every cold-start (with or without a saved session), showing `BanScreen` before *either* Main or SignIn — never the login screen.

Operator decisions (2026-07-01, AskUserQuestion): **instant shell, data streamed behind the cohort gate** (not a "restoring…" beat, not a fully-cached render); **gate = `getIdToken(forceRefresh)` fast-path + full `pm-lock-check` as background reconcile**; **re-login only on no-user / token-refresh-failure / server `forceSignOut` / suspension** (cohort flip ⇒ silent refresh, never logout); **fold the device/network ban pre-routing gate into this story** (the optimistic path creates the bypass, so the fix ships in the same PR). iOS in-app integrity detection is split to a separate story (see Out of Scope / EPIC-0004).

## Acceptance Criteria

### Happy path
- [ ] Cold start with a Firebase `currentUser` **and** a cached identity for that same uid → `startDestination = Screen.Main`, hydrating `AuthRepository.resolvedUniqueId` from the cache so Firestore paths key on the correct `uniqueId` immediately — **no SignIn screen, no FunFact splash** — on **both** real Android and real iPhone.
- [ ] The optimistic route is **additive** to the existing route preconditions — it preserves the `appLockRepository.hasCredential` gate (and any app-lock screen) from `MainActivity:465-470`; the cached identity only short-circuits the *wait on cohort/`uniqueId` resolution*, it does not bypass other gates.
- [ ] The **pre-auth emulator/root gate** (`UnsafeDeviceGate.isBlocked()`, `MainActivity:231`) still runs before the route decision on the optimistic path — a rooted/emulator Android build (prod flavour) shows `UnsafeDeviceScreen`, never Main (regression: the optimistic route must not move, skip, or weaken it).
- [ ] The room-list **shell** (chrome / tabs / empty room list) renders before any network call returns.
- [ ] After the shell, `getIdToken(forceRefresh = true)` resolves → the cohort-scoped Firestore subscriptions start → rooms/DMs populate within a beat.
- [ ] On any successful sign-in or `resolveProfileState()` completion, `{firebaseUid, uniqueId, cohort}` is **written through** to encrypted disk so the next cold start hits the optimistic path.
- [ ] On sign-out (`AuthRepository.signOut()`), the cached identity is **cleared**.

### Error paths
- [ ] Cold start with **no** Firebase `currentUser` → `startDestination = Screen.SignIn` (unchanged behaviour).
- [ ] `getIdToken(forceRefresh)` fails because the refresh token is **expired/revoked** → sign out → SignIn, with **no cohort-scoped data rendered** at any point.
- [ ] The background `checkPmLockOnLogin` reconcile returns `forceSignOut: true` → sign out → SignIn (reuses the existing force-sign-out path).
- [ ] The account is **suspended** → the existing reactive suspension gate (`SharedNavGraph:116-127`) fires: auto-sign-out → SignIn (optimistic routing must not bypass it).
- [ ] A **device ban** (`deviceBans/{deviceId}`) → session invalidated (signed out) → `BanScreen` (device variant), **never** the login screen — on both the has-session and no-session cold-start.
- [ ] A **network ban** — IP / subnet / ASN, the same path that blocks **VPNs** → session invalidated → `BanScreen` (network variant), **never** login — has-session or not.

### Edge cases
- [ ] Firebase `currentUser` present but **no cached identity** (first launch after this feature ships, or cache cleared) → **graceful fallback** to today's resolve-then-route path; the SHY-0139 guard holds (no read keyed on `firebaseUid` instead of `uniqueId`) — no crash, no wrong-cohort read.
- [ ] Cached identity is for a **different uid** than the current Firebase user (account switch / re-install reuse) → cache is **not trusted**; fall back to resolve-then-route.
- [ ] **Cohort flip while offline:** the restored token's cohort claim is stale → `getIdToken(forceRefresh)` returns the new claim → subscriptions start against the **correct** cohort; the user is **not** logged out and **no** stale-cohort data is shown.
- [ ] Corrupted / partial cache entry (missing field, unparseable) → treated as no-cache → graceful fallback (never a half-trusted route).
- [ ] **Banned with no saved session:** a banned device/network cold-starting with **no** Firebase user shows `BanScreen`, **not** the SignIn screen (the ban gate precedes the route decision, so login never appears).
- [ ] **Ban lands on an active session:** a device/network banned while the user is signed in → the next cold-start's pre-routing gate invalidates the session → `BanScreen`.
- [ ] **Ban-check transient error:** preserve the existing lenient-on-error behaviour (`AuthViewModelBanTest` "ban check error is lenient") — a transient ban-service failure does **not** lock out a legitimate user; the outcome is logged as `ban-check-error`.

### Performance
- [ ] The shell renders with **zero** dependency on the heavy cohort-resolve round-trip on the critical path.
- [ ] The data gate is a single `getIdToken(forceRefresh)` (~hundreds of ms typical), not the full `pm-lock-check`; the full reconcile runs **after** the shell is shown, off the critical path.
- [ ] The pre-routing **ban check joins the existing pre-routing phase** (concurrent with the emulator gate + `getStartingScreens()` fetch + health checks at `MainActivity:167-231`) — it does **not** add a new blocking phase; the "instant" win is removing the cohort-resolve block, not the lightweight safety checks.
- [ ] Cache read on launch is one bounded secure-storage read (no full-tree scan, no busy-wait).

### Security
- [ ] **NO cohort-scoped Firestore read is issued before the refreshed token resolves** — the central invariant; proven by a gate-ordering test over the startup sequencer AND on-device verification. This is what prevents a stale-cohort flash/leak.
- [ ] **The device+network ban check is hoisted to run pre-routing** (not sign-in-only), so the optimistic route **cannot bypass** it; a banned device/network is shown `BanScreen` before Main or SignIn, with **no cohort-scoped data rendered**. Proven by a gate-ordering test (ban check precedes routing + subscriptions) + an instrumented banned-device cold-start.
- [ ] Emulator / rooted / modified **Android** devices remain blocked **always** (prod flavour) via the pre-auth `UnsafeDeviceGate` — the optimistic path does not weaken it. (iOS device-integrity is platform-level today; in-app iOS detection is split to its own story — see Out of Scope.)
- [ ] The cached `{firebaseUid, uniqueId, cohort}` is stored **encrypted at rest** — Android `EncryptedSharedPreferences`/DataStore-with-Tink (Keystore-backed); iOS Keychain.
- [ ] The cache is a **routing hint only** — it never grants data access; Firestore rules + the freshly-refreshed JWT remain the sole enforcement of cohort segregation.
- [ ] Sign-out clears the cached identity so no `uniqueId`/cohort is left on disk after logout.

### UX
- [ ] A returning user with a live, unbanned session never sees the login or splash screen — the app opens on the room list every time.
- [ ] When the session is dead/expired/revoked/suspended/banned, the transition is **clean** (no half-rendered room list, no flash of another cohort's content): dead/expired/revoked/suspended → SignIn; device/network banned → `BanScreen`.
- [ ] The "data streaming in" gap between shell and populated list is a normal loading state (existing room-list empty/loading affordance), not a blocking modal.

### i18n
- N/A — no new user-facing strings. The optimistic path reuses the existing room-list (`MainScreen`) and SignIn strings; `BanScreen` / `UnsafeDeviceScreen` reuse their existing localized strings; the chosen design has **no** "restoring…" copy. (SHY-0144 removes the `splash_tagline` strings; this story adds none.)

### Observability
- [ ] The cold-start **routing decision** is logged (cache-hit → Main · no-user → SignIn · no-cache/uid-mismatch → fallback · device-ban → BanScreen · network-ban → BanScreen) and the **gate outcomes** (token-refresh success/failure; ban-gate: device-ban / network-ban / clear / ban-check-error; reconcile: ok / forceSignOut / suspension / cohort-changed), capturable in local + dev builds per [[feedback-comprehensive-default-debug-logging]] so a detached cold-start failure is inspectable without re-running.

## BDD Scenarios

**Scenario: a returning user opens straight to their rooms**
- **Given** a user who is already signed in, whose device and network are in good standing
- **When** they open the app after having closed it
- **Then** their room list appears immediately — no login screen and no loading screen
- **And** the app is on screen right away, before their rooms have finished loading in

**Scenario: private content only appears once the app confirms they're allowed to see it**
- **Given** the app has just opened straight to a returning user's room list
- **When** it checks their access in the background
- **Then** none of their private rooms or messages appear until the app has confirmed they still belong to this group
- **And** once confirmed, their rooms and conversations fill in

**Scenario: a user whose access has ended is taken to the login screen**
- **Given** a returning user whose sign-in is no longer valid — their access was revoked or expired while the app was closed
- **When** they open the app
- **Then** they are taken to the login screen to sign in again
- **And** no private content is shown to them at any point

**Scenario: a user moved to a different group sees the right content without being logged out**
- **Given** a user who was moved to a different group while the app was closed
- **When** they open the app
- **Then** they see their new group's rooms
- **And** they are never shown their old group's content, and they are not made to log in again

**Scenario: the first open after this feature is added still works normally**
- **Given** a signed-in user opening the app for the first time since this feature was added, so nothing is remembered yet
- **When** they open the app
- **Then** the app checks who they are the usual way and then shows their room list
- **And** nothing breaks and no wrong-group content is ever shown

**Scenario: a suspended user is shown the suspension notice, not their rooms**
- **Given** a user whose account has been suspended
- **When** they open the app
- **Then** they are shown the suspension notice instead of the room list

**Scenario: a banned device is stopped before it reaches the rooms**
- **Given** a returning user whose device has been banned
- **When** they open the app
- **Then** they are shown the ban screen — not their room list, and not the login screen
- **And** none of their rooms or messages load

**Scenario: a banned network or blocked VPN is stopped even with nobody signed in**
- **Given** someone on a banned network, or using a blocked VPN, who is not signed in
- **When** they open the app
- **Then** they are shown the ban screen — not the login screen

**Scenario: a tampered or emulated Android device is still blocked**
- **Given** a returning user on a rooted or emulated Android device
- **When** they open the app
- **Then** they are shown the "unsafe device" screen and cannot reach the room list

**Scenario: signing out means the next open shows the login screen**
- **Given** a signed-in user
- **When** they sign out
- **Then** their saved sign-in is cleared from the device
- **And** the next time they open the app, they see the login screen

## Test Plan

App-only Kotlin/Swift change (no `express-api/**` runtime edit; may add an App-Check-gated ban-check path — see Dependencies) → **NOT `*.md`-only → runs the app + real-device legs of the Pre-Merge Testing Protocol** (real Android CPH2653 + real iPhone). No web-portal surface is touched (the consumer room list is Android + iOS only), so the browser leg is N/A for this story. Per CLAUDE.md § No Stubs: device behaviour is proven on the **real** device + real local emulator; only host-JVM (`commonTest`) logic may use doubles, fed real-captured values.

**Red → Green (framework by framework):**
- **Shared host-unit (`commonTest`, Kotlin/JVM)** `./gradlew :shared:testDebugUnitTest`:
  - `SessionCacheContractTest.kt` — drive the new `expect`/`actual SessionCache` via a real in-memory `actual`: write → read returns the same `{firebaseUid, uniqueId, cohort}`; clear → read null; corrupt/partial entry → read null. RED before the interface + write-through exist.
  - `ColdStartRouteDecisionTest.kt` — the pure routing function over `{hasFirebaseUser, hasCache, uidMatches, deviceBanned, networkBanned}` → `{Main | SignIn | Fallback | BanScreen(device) | BanScreen(network)}`: exact-value matrix incl. banned-with-session AND banned-without-session both → BanScreen; ban precedence over the login/Main decision.
  - `ColdStartGateOrderingTest.kt` — drive the startup sequencer with recording doubles of the ban-checker, token refresher, and Firestore subscription starter: assert **the ban check runs before the route decision**, **the token-refresh runs before the first cohort-scoped subscription**, a refresh **failure** records zero subscriptions + sign-out, and a **ban** records zero subscriptions + BanScreen. RED before the gate exists.
- **Ban logic (extend existing, Kotlin/JVM)**: extend `app/src/test/java/com/shyden/shytalk/feature/auth/AuthViewModelBanTest.kt` — the hoisted `checkAndApplyBan()` now runs on the **cold-start pre-routing** path (not only in `signInWithGoogle/Apple`): device ban → BanScreen; network IP/subnet/ASN ban → BanScreen; no-session banned → BanScreen not SignIn; lenient-on-error preserved.
- **Backend (real emulator, existing)**: `express-api/tests/routes/device-info.test.js` already covers `checkBans()` device + network(IP/subnet/ASN) matching + active-only filter — reference/extend if an unauthenticated/App-Check ban-check path is added.
- **Android instrumented (`androidTest`, real device + emulator)** `./gradlew connectedDevDebugAndroidTest`:
  - extend `app/src/androidTest/java/com/shyden/shytalk/journey/AuthFlowTest.kt` (and/or `ColdStartFlowTest.kt`): valid session + cache → Main, no SignIn/Splash, rooms populate; revoked → SignIn no rooms; **seeded device ban → BanScreen on cold-start (no rooms)**; **no-session + seeded network ban → BanScreen not SignIn**; verify cache cleared after in-app sign-out.
  - **emulator/root regression**: `UnsafeDeviceGateTest.kt` (host) + an instrumented assertion that the prod-flavour gate still precedes routing on the optimistic path.
  - `auth.feature` / new `cold-start.feature` Gherkin for returning-instant + banned-device + emulator-gate paths.
- **iOS (`iosApp/iosAppTests`, XCTest on real iPhone)**: cold-start startDestination matrix (incl. ban → BanScreen) + a Keychain `SessionCache` round-trip; on-device cold-start verification. (iOS in-app integrity detection is out of scope — separate story.)
- **Static/quality:** Kotlin lint/detekt 0 warnings; `scripts/check-no-new-stubs.js` clean.
- **Phase 1 LOCAL gauntlet:** real Android + real iPhone cold-start journeys green (returning-instant · revoked-bounce · offline-cohort-flip · no-cache-fallback · **device-ban → BanScreen** · **no-session network-ban → BanScreen** · **emulator/root → UnsafeDeviceScreen**).
- **Phase 2:** `code-reviewer` 100% clean → flip In Review + `Reviewed-up-to:` → push → CI green by name.
- **Phase 3 (DEV):** re-run the cold-start + ban journeys against dev (real `shytalk-dev` Firebase) to prove the cohort AND ban gates behave against the real backend.

## Out of Scope
- Removing the FunFact splash — that is **SHY-0144** (this story routes returning users **around** the splash via the optimistic `startDestination`; first-time sign-in flows still pass through it until SHY-0144 deletes it).
- **iOS in-app jailbreak/emulator/integrity detection** — iOS currently relies on App Store review + platform sandboxing + DeviceCheck (`IosPlatformModule:131` sets `bypassDeviceChecks = true`). Adding in-app iOS integrity detection is split to its own EPIC-0004 story (operator decision 2026-07-01); this story **preserves** the current iOS behaviour and does not regress it.
- The maintenance/announcement **starting-screens** subsystem (separate from the splash; EPIC-0004 leaves it untouched — the ban gate merely runs concurrently within that existing pre-routing phase).
- The **web portal / suggestions** session persistence (separate EPIC-0004 web-surface stories, cross-browser).
- Changing the backend `pm-lock-check` contract — reused as-is for the background reconcile.
- **Authoritative server-side ban enforcement** (API guard + Firestore-rules gate) — that is [[EPIC-0005]] (SHY-0149 / SHY-0150). This story's pre-routing ban gate is the **client-side / UX** layer: it ensures the *honest app's* optimistic path shows the ban screen instead of the room list. It is **not** the sole enforcement — a modified client or a direct API call could skip a client-side check — so the unbypassable enforcement lives server-side + at the rules layer in EPIC-0005. Both ship for the MVP.

## Dependencies
- Firebase Auth session persistence (default-on, Android + iOS) and `getIdToken(forceRefresh = true)` (GitLive Kotlin-Firebase wrapper).
- Existing `AuthRepository` (`isAuthenticated` / `currentUserId` / `resolvedUniqueId` / `signOut`), `AuthViewModel.resolveProfileState()` + `userRepository.checkPmLockOnLogin()`, and the reactive suspension gate in `SharedNavGraph:116-127`.
- **Anti-abuse infra to hoist/reuse:** `AuthViewModel.checkAndApplyBan():471-495` (the device+network ban logic to hoist to pre-routing); `express-api/src/routes/device-info.js` `checkBans()` (deviceBans/networkBans matching incl. subnet/ASN, active-only filter); the `deviceBans` / `networkBans` Firestore collections; `BanScreen` + `UnsafeDeviceScreen` composables; `UnsafeDeviceGate`/`DeviceSecurityChecker` (Android pre-auth gate — must keep firing before routing). If `device-info.js`'s ban check is auth-gated, an **App-Check-protected unauthenticated ban-check path** is needed so the gate works with no saved session.
- Platform secure storage: Android `EncryptedSharedPreferences`/DataStore (Keystore); iOS Keychain — bound via Koin (`AppKoinModule`, `IosPlatformModule`).
- The SHY-0139 `resolvedUniqueId`-not-`firebaseUid` guard (must stay intact; the no-cache fallback relies on it).
- `MainActivity` (Android `initialRoute` + pre-routing phase 167-231) + `iOSApp.swift` (iOS `startDestination`) entry points.

## Risks & Mitigations
- **Risk (the operator-caught bypass):** the optimistic path skips the sign-in-only device/network ban check → a banned device/network gets straight into the app. **Mitigation:** hoist the ban check to a **pre-routing gate** (this story) + a gate-ordering test proving the ban check precedes both routing and any cohort-scoped read; instrumented banned-device (with + without session) cold-start → BanScreen.
- **Risk:** hoisting the ban check adds a pre-routing network call → erodes "instant". **Mitigation:** it runs **concurrently within the existing** pre-routing phase (emulator + starting-screens + health), not as a new blocking step; lenient-on-error keeps legit users in on a transient failure.
- **Risk:** the cohort gate leaks — a cohort-scoped read fires before the fresh token → stale-cohort flash (the SHY-0132/0137 leak class). **Mitigation:** centralise subscription-start behind the sequencer; `ColdStartGateOrderingTest` asserts ordering + the no-subscription-on-refresh-failure/ban invariant; on-device dev verification against real Firestore rules.
- **Risk:** account-switch / reinstall reuses a stale cache for the wrong uid. **Mitigation:** cache keyed + validated against the live Firebase uid; mismatch → fallback (edge-case test).
- **Risk:** secure-storage key management differs per platform. **Mitigation:** platform-standard backings (Android Keystore via EncryptedSharedPreferences/Tink; iOS Keychain) — no custom crypto; round-trip tested per platform.
- **Risk:** the no-cache fallback regresses the SHY-0139 crash. **Mitigation:** the fallback routes through the existing resolve-then-route path unchanged; the SHY-0139 guard + its test stay; a dedicated no-cache BDD scenario covers it.

## Definition of Done
- [ ] `SessionCache` (`expect`/`actual`) + `AuthRepository` write-through/clear + cold-start route decision + the **cohort gate sequencer + hoisted pre-routing device/network ban gate** + `MainActivity`/`iOSApp.swift` wiring implemented; the pre-auth emulator/root gate preserved.
- [ ] **Pre-Merge Testing Protocol satisfied:** `commonTest` RED→GREEN (cache contract · route-decision matrix incl. ban precedence · gate-ordering incl. ban-before-routing) + extended `AuthViewModelBanTest` + Android instrumented cold-start journeys (returning-instant · revoked · device-ban · no-session network-ban · emulator/root regression) + iOS XCTest, all on the **real** devices + real emulator → LOCAL gauntlet green → `code-reviewer` 100% clean → flip In Review + `Reviewed-up-to:` → push → CI green by name → **DEV gauntlet green** (cohort + ban gates proven against real `shytalk-dev`) → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) from an operator brainstorming session under [[EPIC-0004-persistent-session-instant-coldstart]]. Root cause + design grounded in read-only Explore passes over the startup/auth/routing flow and the anti-abuse gating. Operator chose: instant shell + data behind a cohort gate; gate = `getIdToken(forceRefresh)` + full `pm-lock-check` reconcile; re-login only on no-user / refresh-failure / `forceSignOut` / suspension. **Effort bumped L→XL** when the operator caught that the optimistic path bypasses the sign-in-only device/network ban check — folded a **pre-routing device+network ban gate** into this story (device ban / network IP-subnet-ASN ban / VPN-via-network-ban → BanScreen, works with no session, never shows login, can't be bypassed), plus an emulator/root **regression** guard (pre-auth `UnsafeDeviceGate` still fires) and the honest note that iOS integrity is platform-level today (in-app iOS detection split to its own EPIC-0004 story). Security keystone of the EPIC.
