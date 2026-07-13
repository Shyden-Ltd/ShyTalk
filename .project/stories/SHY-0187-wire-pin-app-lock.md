---
id: SHY-0187
status: Draft
owner: claude
created: 2026-07-14
priority: P1
type: bug
effort: L
roadmap_ids: []
epic: EPIC-0005
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

## Test Plan

Touches `shared/**` + `app/**` + `iosApp/**` (launch routing) → **full protocol**.

**Red → Green:**
- **Kotlin jvmTest — a NEW pure `resolveLaunchDestination(auth+lock state): Screen` in commonMain** (the design's centerpiece — both platforms + commonTest consume it, killing the asymmetry). Exhaustive matrix: (hasProfile × hasDOB × needsLegalAcceptance × needsLockScreen × requiresReauth) → exact destination; lock-required ALWAYS wins the gate before Main; no-lock → normal route; reauth → Sign-In.
- **Kotlin jvmTest — `onAuthSuccess` decision** now threads `needsLockScreen` (currently not even passed to the `SharedNavGraph.kt:166` when-block).
- **Android instrumented `app/src/androidTest/assets/features/lock_screen.feature` (EXISTS)** — real-device: cold launch + warm-resume gate render + unlock→Main + back-button-can't-skip.
- **iOS** — the `MainViewController` start destination consumes `resolveLaunchDestination` (not a hardcoded `Screen.SignIn`).
- **Device gauntlet** — real Android + real iPhone: enable lock → background past timeout → foreground → must re-auth; cold launch → must re-auth; wrong-PIN lockout renders.

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

- 2026-07-14 — Filed from a re-confirmed proactive-QA finding ([[project-applock-pin-appears-unwired-finding]] has the full grep evidence + the operator's 2026-07-09 fix decision + a 6-part wiring design). The earmarked ID SHY-0168 was reused for the no-direct-backend ratchet, so this security defect had NO tracking story until now. `mvp: true` per the operator decision (security bug in MVP scope). Recommended pickup: implement the pure `resolveLaunchDestination` + tests FIRST (host-verifiable, zero behaviour change until wired), then the platform gates (device-batched).
