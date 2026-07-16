---
id: SHY-0196
status: Draft
owner: claude
created: 2026-07-16
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0004
mvp: true
---

# SHY-0196: App-Lock via the device's own credential (OS unlock prompt) — serverless, device-local

## User Story

- **As a** ShyTalk user who wants the app protected on my device
- **I want** the App-Lock to use my device's own unlock method (system PIN / pattern / fingerprint / Face ID) via the OS prompt
- **So that** I don't manage a separate app PIN, nothing about my lock ever leaves my device, and losing the app (uninstall) simply means choosing to set it up again

## Why

Operator redirection, 2026-07-16 (verbatim, four messages):
1. "the pin and biometrics logon method should be server-less. only for the device. if the app is uninstalled it's lost and needs to be set up again (if the user chooses) only the real login needs to be online"
2. "basically, the pin and biometrics login should use the device's own login method, not be set by the application"
3. "which means, if the device has no lock implemented (pin, fingerpring, face ID etc.), then this feature is unavailable. during the first run of the app we still offer it, but if they choose to allow it, then we inform them to set up in thier devices settings before enabling, and tell them how they would enable it in the future."
4. "also, if the user has this and chooses to enable (and confirms their biometric/pin to enable it) we show a success and inform them they will need it to login in the future, and tell them how to disable it (in the app settings)"

This supersedes the app-managed PIN design: PIN setup screens, app PIN entry on the Lock screen, bcrypt hashes, server `/api/auth/pin/*` + biometric-key endpoints, and server lockout state all become obsolete. What SURVIVES from SHY-0187 is the credential-agnostic navigation-gating skeleton (`resolveLaunchDestination` / `shouldRelockOnResume` / `isNavigationLockGated`, the resume gate, the deep-link fail-closed drops, the background-timestamp bridge) — re-keyed from "stored PIN credential" to "App-Lock enabled + OS-auth pending". SHY-0193 (server-truth re-enrolment prompt) is Cancelled — uninstall-loses-lock is now intended behaviour.

## Acceptance Criteria

### Happy path
- [ ] With a device credential present, enabling App-Lock in Settings → Security triggers the OS authentication prompt; on success the app shows a success confirmation that (a) states the device unlock will be required to enter the app from now on and (b) tells the user how to disable it (app Settings → Security). The enabled flag persists locally (SecureStorage) only.
- [ ] With App-Lock enabled: cold launch and warm resume past the lock timeout present a locked screen whose single "Unlock" action invokes the OS prompt (Android `BiometricPrompt` with device-credential fallback; iOS `LocalAuthentication` `deviceOwnerAuthentication`); success proceeds to the gated content, failure/cancel stays on the locked screen with retry.
- [ ] The existing SHY-0187 gate semantics hold unchanged: deep links/pushes are dropped fail-closed while locked; back cannot skip the lock; the lock outranks a restorable session.

### Error paths
- [ ] Device has NO lock configured: the Settings toggle is disabled (not hidden) with copy directing the user to set a device lock in system settings first and explaining how to enable App-Lock here afterwards; attempting to toggle never crashes and never half-enables.
- [ ] The device credential is REMOVED while App-Lock is enabled (OS reports no credential available at unlock time): fail closed into a recovery path — the locked screen explains the situation and offers real (online) account login to get in; App-Lock disarms only after that successful re-authentication.
- [ ] OS prompt errors (too many attempts / hardware unavailable / user cancel) surface the OS's own messaging; the app adds no parallel lockout machinery — the OS owns retry/lockout policy.

### Edge cases
- [ ] Uninstall/reinstall: the enabled flag and everything about the lock are gone; the app behaves as never-enabled (this is BY DESIGN — no server signal, no prompt to re-enrol beyond the normal first-run offer).
- [ ] First-run offer: exactly once during first run, the app offers App-Lock. Decline → normal app, no nagging (Settings remains the home). Accept without a device credential → the device-settings guidance copy (AC above) and how to enable later. Accept with a credential → the OS confirm → success flow.
- [ ] Legacy migration: devices carrying the old app-PIN local credential (SecureStorage from the superseded design) have it cleared on first launch of this version; a previously "enabled" old-style lock maps to disabled + the first-run offer shown once (the old credential cannot gate anything anymore).
- [ ] Biometric enrolment CHANGES (new fingerprint added / face re-enrolled) follow OS behaviour; where the platform invalidates keys on biometric change, the app treats it as the credential-removed recovery path — never a crash, never fail-open.

### Performance
- [ ] The availability check + gate decision add no measurable cold-start latency (synchronous local reads + one OS capability query); no network calls anywhere in the lock path.

### Security
- [ ] ZERO server involvement: no `/api/auth/pin/*` or biometric-key endpoints are called by the lock; those routes + their Firestore fields (`pinHash`, `pinSetAt`, `pinAttempts`, `pinLockedUntil`, `pinLockoutCount`, biometric keys) are removed server-side with 404-absence tests (matching the SHY-0192 pattern), after confirming no other consumer (EPIC-0004 investigation gate). Only real account login is online.
- [ ] Enabling requires a successful OS authentication (proves the person enabling owns the device credential); disabling from Settings also requires a successful OS authentication (prevents a passerby with an unlocked phone from silently stripping the protection).
- [ ] The gate fails CLOSED everywhere: unknown availability, prompt exceptions, and null navigation state all resolve to "locked" (same principle the SHY-0187 review verified).

### UX
- [ ] All copy per the operator spec: unavailable → "set up in device settings first" + how to enable later; enabled → success + "you'll need it to enter the app" + how to disable. Plain, non-technical language (non-technical BDD rule).
- [ ] The locked screen is a minimal veil (app branding + Unlock button + account-login fallback) — no PIN pad, no app-drawn keypad.

### i18n
- [ ] All new strings in the kept locale set (en base + zh + id + vi per the 2026-07-16 four-locale decision; if SHY-0194 has not landed at implementation time, whatever set the completeness gates then enforce).

### Observability
- [ ] Local debug logs (no secrets — log outcomes, never credentials): offer shown/accepted/declined, enable/disable success, unlock success/failure reason category, availability verdicts.

## BDD Scenarios

**Scenario: enabling with a device credential present**
- **Given** a signed-in user whose device has a screen lock configured
- **When** they enable App-Lock in Settings → Security and pass the device's own unlock prompt
- **Then** a success message confirms the lock is on, says the device unlock will be needed to enter the app, and explains how to disable it in app Settings

**Scenario: enabling without any device lock**
- **Given** a device with no PIN/pattern/biometric configured
- **When** the user tries to enable App-Lock (from the first-run offer or Settings)
- **Then** the toggle does not enable and the app explains they must first set a device lock in system settings, and how to enable App-Lock here afterwards

**Scenario: the lock gates entry with the OS prompt**
- **Given** App-Lock is enabled and the lock timeout has passed
- **When** the user cold-launches or resumes the app
- **Then** a locked screen appears and tapping Unlock shows the device's own unlock prompt
- **And** passing it enters the app; cancelling stays locked with the app content never visible

**Scenario: uninstall loses the lock by design**
- **Given** a user with App-Lock enabled uninstalls and reinstalls the app
- **When** they sign in again
- **Then** App-Lock is off, no prompt claims they "had" a lock, and the first-run offer appears once

**Scenario: nothing about the lock touches the network**
- **Given** any enable/unlock/disable interaction
- **When** network traffic is inspected (local stack logs)
- **Then** no request related to PIN or biometrics is made — only real account login calls the server

## Test Plan

Touches `shared/**` + `app/**` + `iosApp/**` + `express-api/src/**` (endpoint removals) → **full protocol + backend⇒full-gauntlet** (device segment per the devices-away batching protocol).

**Red → Green:**
- **commonTest/jvmTest — gate skeleton re-key**: extend `LaunchDestinationTest` truth tables for the new inputs (enabled-flag + OS-auth-pending replace stored-credential); RED against the PIN-keyed signatures.
- **jvmTest — enable/disable/offer state machine** (new `AppLockSettingsViewModel`-equivalent tests): availability × enable-confirm × disable-confirm × first-run-offer-once truth table with exact copy-key assertions; RED before the flows exist.
- **jvmTest source-pin — `AppLockWiringPinTest`**: re-pin that both platforms invoke the OS prompt path (no `PinSetupScreen`/`LockScreen` PIN-pad references remain); RED while the old screens are wired.
- **Express Jest — `auth-pin.test.js` → absence suite**: every `/api/auth/pin/*` and `/api/auth/biometric/*` route returns 404 (the SHY-0192 removal pattern, extended); RED while routes exist. Firestore field-writer greps in a script test.
- **Android instrumented `security_settings.feature`**: rewrite scenarios for toggle-with-OS-prompt (real device gauntlet segment).
- **iOS `AppLockBridgeTests.swift`**: extend for the `LAContext` path fail-closed behaviour.
- **Migration test (jvmTest)**: legacy SecureStorage credential present → cleared + mapped to disabled + offer-eligible on first new-version launch.
- **Behavioural matrix — enabled vs not (operator-mandated, host + device)**: the full state grid gets named tests at the decision layer (jvmTest/commonTest) AND walked cells in the device gauntlet:
  | App-Lock | device credential | event | expected |
  |---|---|---|---|
  | disabled | any | cold launch / resume / deep link | NO gate anywhere, no OS prompt, no locked veil |
  | enabled | present | cold launch | locked veil → OS prompt → pass=content, cancel=stay locked |
  | enabled | present | resume before timeout | no re-lock |
  | enabled | present | resume past timeout | re-lock + prompt |
  | enabled | present | deep link while locked | dropped fail-closed |
  | enabled | REMOVED after enabling | any unlock attempt | recovery path (online login), fail-closed |
  | never-enabled | absent | Settings toggle / first-run accept | guidance copy, never half-enables |
  | first run | any | offer | shown exactly once; decline → never nags |
- **Device gauntlet (real Android + real iPhone, per the devices-away batching protocol)**: walk every matrix row live on BOTH platforms — including the real OS prompts (system PIN and fingerprint/Face ID variants), the enable-confirm → success copy, disable-confirm, uninstall/reinstall → offer-again, and a device-settings round-trip (remove the device lock mid-enabled → recovery). State-verification: SecureStorage flag agrees with UI after every transition; local-stack network capture proves zero lock-related requests.

## Out of Scope

- Account (real) login changes — sign-in flow, session persistence, and cold-start speed are SHY-0143/SHY-0144.
- Re-speccing SHY-0189 (lockout consequences) — the EPIC-0004 investigation amends it for OS-owned lockout (its voice-disconnect-while-locked intent survives).
- Server-side data cleanup migration for historical `pinHash` fields beyond ceasing writes (a follow-up chore if wanted; flagged to operator).

## Dependencies

- **EPIC-0004 investigation first** (operator-mandated): validates this spec against SHY-0143/0144 interplay (first-run offer sits in the reworked boot flow) and confirms the biometric server routes have no non-lock consumer before deletion.
- Builds ON the merged SHY-0187 gating skeleton (+ SHY-0192's fixed state as the migration baseline).
- Coordinates with SHY-0194 for the locale set of the new strings.

## Risks & Mitigations

- **Risk:** deleting server routes another surface quietly consumes. **Mitigation:** repo-wide consumer grep + the EPIC-0004 investigation gate before removal; absence tests document intent.
- **Risk:** OS-prompt behavioural differences (Android device-credential fallback vs iOS passcode fallback) diverge UX. **Mitigation:** shared decision layer stays pure/common; platform shells thin; both proven in the device gauntlet.
- **Risk:** locked-out-of-app scenarios (credential removed, biometric invalidated). **Mitigation:** explicit recovery AC — real online login is always the escape hatch; fail-closed, never fail-open.

## Definition of Done

App-Lock enable/unlock/disable runs entirely on the device's own credential with the specified offer/guidance/success copy; no lock-related server calls remain (absence-tested); legacy app-PIN state migrates cleanly; gate semantics from SHY-0187 hold; `code-reviewer` 100% clean; full gates green (device segment per the devices-away protocol); merged; released.

## Notes

- 2026-07-16 — Filed from the operator's four-message redesign directive (verbatim in Why), superseding the app-managed PIN architecture the same morning SHY-0192 finished fixing it. Sequencing recommendation recorded in SHY-0192 Notes: land the working stack, then this story deletes/replaces the PIN machinery wholesale. SHY-0193 Cancelled (premise inverted). First-run-offer placement intentionally coupled to the EPIC-0004 boot rework.
