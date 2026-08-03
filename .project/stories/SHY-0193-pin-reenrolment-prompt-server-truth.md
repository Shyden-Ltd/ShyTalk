---
id: SHY-0193
status: Cancelled
owner: claude
created: 2026-07-16
priority: P2
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0004
mvp: false
---

# SHY-0193: Re-enrolment prompt when a server-side PIN exists but the device has no App-Lock credential

## User Story

- **As a** ShyTalk user who set an App-Lock PIN and then reinstalled the app (or moved to a new device)
- **I want** the app to notice my protection is no longer active on this device and prompt me to re-enrol
- **So that** my App-Lock doesn't silently vanish after a reinstall while I believe I'm still protected

## Why

The App-Lock gate reads the **local** credential (SecureStorage). After a reinstall or on a new device that credential is gone, so the lock silently disengages even though the server still holds the user's `pinHash` — the user believes they are protected and is not. SHY-0192 removed the old `needsPinSetup` state flag that gestured at this ("migration or new device") because it was computed from **local** state only (`appLockRepository.hasCredential == false`), which is true for every user who never opted in — it could not distinguish "lost my credential" from "never wanted one", had zero consumers, and would have nagged everyone if wired. The correct signal requires server truth: *does this account have a PIN?* This story adds that signal and wires the prompt on it.

## Acceptance Criteria

### Happy path
- [ ] `POST /api/users/sign-in` response includes `hasPin: true` when the user document has a non-null `pinHash`, `hasPin: false` otherwise (never the hash itself).
- [ ] On sign-in resolution, when `hasPin == true` AND the device has no local App-Lock credential, the user sees a one-time, dismissible re-enrolment prompt explaining the lock is inactive on this device, with a direct path to Settings → Security → PIN setup.
- [ ] Completing setup from the prompt registers the local credential and the lock engages again (same enrolment path as SHY-0192 — no separate flow).

### Error paths
- [ ] If the sign-in payload lacks `hasPin` (older server), the client treats it as `false` and shows no prompt — never a crash, never a spurious prompt.
- [ ] Declining the prompt is remembered per device; the app remains usable and the prompt does not re-appear every launch (re-shown at most once per new sign-in session).

### Edge cases
- [ ] A user with `hasPin == false` and no local credential (never enrolled) sees NO prompt — opt-in stays opt-in.
- [ ] A user with `hasPin == true` and a valid local credential sees NO prompt (normal case).
- [ ] A user who re-enrols and then declines a later re-prompt scenario is honoured (no prompt after successful enrolment because a credential now exists).

### Performance
- [ ] `hasPin` derives from the already-read user document in the sign-in handler — zero extra Firestore reads, no measurable sign-in latency change.

### Security
- [ ] Only the boolean `hasPin` crosses the wire in the sign-in payload — never `pinHash` or any derivative (sign-in is pre-PIN-verification; the SHY-0192 hash-return applies only to the authenticated setup response).
- [ ] The prompt itself grants nothing — it only deep-links to the existing verified enrolment surface.

### UX
- [ ] Prompt copy explains WHY re-enrolment is needed (new device / reinstall) in plain language; primary action "Set up PIN", secondary "Not now".
- [ ] The prompt never blocks sign-in completion; it appears after the user lands, not as a gate.

### i18n
- [ ] All new prompt strings added to all 20 locale files; no hard-coded English.

### Observability
- [ ] Client logs (local/dev unredacted per debug-logging rule) when the prompt is shown / accepted / declined; server change is a pure field addition with existing route logging.

## BDD Scenarios

**Scenario: reinstall is detected and the user can re-enrol**

- **Given** a user whose account has a PIN set (`pinHash` present server-side)
- **And** the app is freshly installed (no local App-Lock credential)
- **When** they sign in
- **Then** a prompt explains the App-Lock is not active on this device
- **And** choosing "Set up PIN" lands on the PIN setup screen and completing it re-engages the lock

**Scenario: never-enrolled users are not nagged**

- **Given** a user whose account has no PIN
- **When** they sign in on any device
- **Then** no re-enrolment prompt appears

**Scenario: enrolled-and-intact devices are not prompted**

- **Given** a user with a PIN and a valid local credential
- **When** they sign in
- **Then** no re-enrolment prompt appears

**Scenario: the signal is a boolean, never the hash**

- **Given** any user signs in
- **When** the sign-in response is inspected
- **Then** it contains `hasPin` as a boolean and does not contain `pinHash`

**Scenario: declining is respected**

- **Given** the re-enrolment prompt is shown
- **When** the user taps "Not now"
- **Then** they proceed normally and the prompt is not shown again this session

## Test Plan

Touches `express-api/src/routes/users.js` (sign-in payload) + `shared/**` (sign-in state + prompt) → **full protocol + backend⇒full-gauntlet**.

**Red → Green:**
- **Express Jest — `express-api/tests/routes/identity-core.test.js`**: sign-in response carries `hasPin: true` for a seeded user with `pinHash`, `hasPin: false` without; asserts `pinHash` itself absent from the payload. RED against the current payload (no `hasPin`).
- **Kotlin jvmTest — new `ReEnrolmentPromptTest` (location per final design, alongside `PinSetupViewModelTest.kt`)**: prompt-state derivation truth table — (hasPin, hasCredential) → prompt shown only for (true, false); missing `hasPin` in payload → false. RED before the client parses/derives.
- **Android instrumented — `app/src/androidTest/assets/features/security_settings.feature`**: new scenario "reinstall re-enrolment prompt" driving the real local stack with a pre-seeded pinHash user and cleared app storage.
- **Device gauntlet** — real Android + real iPhone: seed PIN → reinstall app → sign in → prompt appears → re-enrol → lock engages.

## Out of Scope

- Offline PIN verification / `localPinHash` redesign (verification remains online; separate decision).
- Biometric re-enrolment (PIN only; biometric follows its own registration flow).
- Any change to the enrolment surface itself (delivered by SHY-0187/SHY-0192).

## Dependencies

- Builds directly on SHY-0192's working enrolment (merged first); coordinates with EPIC-0004 session-persistence work.
- Needs the CI-equivalent express harness + real-device gauntlet like every backend-touching story.

## Risks & Mitigations

- **Risk:** prompt fatigue / nagging users who consciously declined. **Mitigation:** per-session once semantics + explicit AC; opt-in principle preserved (no prompt when `hasPin` is false).
- **Risk:** leaking PIN material in a pre-auth payload. **Mitigation:** boolean-only AC + explicit payload-absence assertion in the RED tests.
- **Risk:** stale `hasPin` after server-side PIN removal features land later. **Mitigation:** signal derives from the live user doc at sign-in time; no client caching beyond the session.

## Definition of Done

Sign-in exposes `hasPin` (boolean only); the re-enrolment prompt shows exactly for (server PIN ∧ no local credential); decline is respected; all 20 locales carry the strings; `code-reviewer` 100% clean; backend + device gauntlets green; merged; released.

## Notes

- 2026-07-16 ~10:1x WIB — **CANCELLED, same day as filing.** Operator redirected the whole App-Lock architecture: PIN/biometrics must be **device-local and serverless**, using the DEVICE's own credential (OS unlock prompt), never set by the application; "if the app is uninstalled it's lost and needs to be set up again (if the user chooses)". This story's entire premise — a server-truth `hasPin` signal driving a re-enrolment prompt after reinstall — is the exact opposite: uninstall-loses-lock is now INTENDED behaviour, and no PIN state exists server-side to signal from. Superseded by SHY-0196 (OS-credential App-Lock), which includes the first-run OFFER flow the operator specified. No implementation had started.

- 2026-07-16 — Filed from SHY-0192's conscious deferral of the `needsPinSetup` auto-prompt (the removed flag read local-only state and could not represent this case). See SHY-0192 Notes for the removal rationale and the device evidence that motivated the enrolment rework.
