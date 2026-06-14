---
id: SHY-0096
status: In Progress
owner: claude
created: 2026-06-13
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0096: Reliable Android persona-switch — real in-app sign-out (`force-stop` ≠ sign-out)

## User Story

**As** the QA matrix driving multi-journey runs on a real Android device,
**I want** `androidPersonaSignIn` to guarantee a clean signed-out start by performing a **real in-app sign-out** when the app is already signed in,
**So that** every journey after the first can switch personas (today it can't — the app relaunches into the *previous* persona, so the whole multi-journey Android corpus is unmeasurable).

## Why

EPIC-0003 Phase 0 — the linchpin that unblocks the real-device gauntlet (the proof surface for every later phase). Live investigation on the real OnePlus CPH2653 (2026-06-13) established, by evidence not assumption ([[feedback-never-guess-always-investigate]]):

- `androidPersonaSignIn` (android-adb-driver.js:2350-2358) force-stops the app and **assumes** the relaunch lands on the sign-in screen. **Firebase auth survives `am force-stop`** — the process dies but the ID token persists on disk, so the app silently restores the session and lands on `main_*`/a gate screen. `persona_picker_open` never appears → the canonical "could not tap persona_picker_open — already signed in" error. **Confirmed live:** after force-stop + relaunch, the app was still signed in as P-10.
- Both data-wipe shortcuts are **blocked** on this device: `pm clear` → `SecurityException: …CLEAR_APP_USER_DATA`; `run-as rm` → `Permission denied` (OEM/SELinux). So the **only** reliable signed-out reset is the **real in-app UI sign-out** — which is also the No-Stubs/Real-Only-correct path (drive the genuine user flow, not a test-harness wipe).

The real sign-out chain (grounded in source testTags): optional `warning_acknowledgeButton` (if a moderation gate intercepts) → `main_settingsButton` (MainScreen.kt:88) → `settings_signOutButton` (AppSettingsScreen.kt:499, opens confirm dialog) → `settings_signOutConfirmButton` (line 245) → sign-in screen with `persona_picker_open`.

This also closes the operator-flagged gap (the warning-acknowledge button was observed but never behaviourally tested): `androidSignOut`'s acknowledge sub-step exercises `warning_acknowledgeButton` for real, and the j10/j11 gauntlet proves its server-side effect (`hasActiveWarning → false`).

## Acceptance Criteria

### Happy path
- [ ] A new `androidSignOut(target='dev')` driver method performs the real chain — `main_settingsButton` → `settings_signOutButton` → `settings_signOutConfirmButton` — and resolves only after `persona_picker_open` (or `signIn_googleButton`/sign-in screen) is visible, i.e. a genuine signed-out state.
- [ ] `androidPersonaSignIn` launches the app, **classifies the post-launch state** from a real UI dump, and: if `persona_picker_open` is present → proceeds directly (signed-out); if a signed-in indicator (`main_settingsButton`/`main_roomsTab`) or the warning gate (`warning_acknowledgeButton`) is present → calls `androidSignOut` first, then proceeds to the picker.
- [ ] After the existing force-stop, a second consecutive `androidPersonaSignIn` for a *different* persona reaches that persona's `main_roomsTab` (the regression that blocks the corpus today).

### Error paths
- [ ] If `androidSignOut` cannot reach a signed-out state within its budget (sign-out button never appears, confirm dialog never shows, picker never returns), it throws a **specific, actionable** error naming the exact tag that failed and the observed screen — never a silent `false` that lets a stale session leak into the next journey.
- [ ] `androidPersonaSignIn` still rejects a non-`P-NN` persona id (existing guard) and still throws the launch-failure error if the package isn't installed.
- [ ] A warning-acknowledge tap that does not advance (e.g. a genuinely invalid session) surfaces a clear "acknowledge did not clear the gate" error rather than hanging or looping.

### Edge cases
- [ ] State classifier handles: picker-visible, main-screen, warning-gate, and an **unknown/splash** dump (returns `unknown` → the caller waits-and-re-dumps within budget rather than mis-acting).
- [ ] `androidSignOut` is a no-op-success when already on the picker (idempotent — classifying `picker` skips the chain).
- [ ] The settings sign-out is reached regardless of which main tab is focused (the gear `main_settingsButton` is tab-independent).
- [ ] Two transports for one physical device (IP + `_adb-tls-connect`) never cause an unscoped `adb` call — every shell call passes `-s <serial>`.

### Performance
- [ ] `androidSignOut` adds at most one bounded settle per tap (≤ existing per-tap budget); the whole reset completes within ~12s on a warm app or fails loudly — it must not add an unbounded wait to every journey's sign-in.

### Security
- [ ] No credentials, tokens, or persona passwords are logged by the new method (consistent with the driver's existing diagnostics); sign-out is driven purely through UI taps, no token/file manipulation.

### UX
- [ ] N/A — internal QA-driver behaviour; no user-facing surface. (The driver's *consumer* is the runner/next session: the new error messages name the failing tag + observed screen so a failure is diagnosable in <10s without re-running.)

### i18n
- [ ] Sign-out navigation anchors on **testTags**, not visible text, so it is locale-independent (works whatever UI language the persona last set — relevant since P-13/P-14 are RTL/CJK personas).

### Observability
- [ ] Every state-classification decision and each sign-out sub-step logs a single concise diagnostic line to stderr (the runner surfaces it), so a failed reset is traceable to the exact step.

## BDD Scenarios

**Scenario: second persona switch reaches the new persona (the linchpin regression)**
- **Given** the Android app is signed in as P-02 after a prior journey
- **When** `androidPersonaSignIn('P-05', 'rooms', 'local')` runs
- **Then** the driver classifies the launch state as signed-in, performs a real sign-out to the picker, signs in P-05
- **And** the app reaches P-05's `main_roomsTab` (not P-02's)

**Scenario: sign-out from a clean main screen**
- **Given** the app is on `main_roomsTab` signed in
- **When** `androidSignOut('local')` runs
- **Then** it taps `main_settingsButton` → `settings_signOutButton` → `settings_signOutConfirmButton`
- **And** resolves once `persona_picker_open` is visible

**Scenario: sign-out through a warning gate**
- **Given** the app is parked on the warning screen (`warning_acknowledgeButton` visible)
- **When** `androidSignOut('local')` runs
- **Then** it first taps `warning_acknowledgeButton` to reach the main screen
- **And** then completes the settings sign-out chain to the picker

**Scenario: already signed out is idempotent**
- **Given** the app is already on the picker (`persona_picker_open` visible)
- **When** `androidSignOut('local')` runs
- **Then** it returns success without tapping the settings chain

**Scenario: warning-acknowledge has its real server-side effect (operator-flagged gap)**
- **Given** Raul (P-08/UID per registry) has an active first-strike warning and is on the warning screen
- **When** the j11 journey taps `warning_acknowledgeButton` on the real device
- **Then** within 3000ms the Firestore doc `users/<uid>` field `hasActiveWarning` is `false`
- **And** the rooms tab returns

## Test Plan

Touches `.js` driver tooling → **full Pre-Merge Testing Protocol** (CLAUDE.md). Real backends/devices only (No Stubs / Real Only). No new `execSync` mock is added (per the EPIC operating definition: pure logic uses real-captured fixtures; behaviour is proven on the real device).

**Red (before):**
- No `androidSignOut` method exists; `androidPersonaSignIn` has no state classifier — a second persona switch fails with "could not tap persona_picker_open" (reproduced live).
- No unit test asserts auth-state classification from a real UI dump.

**Green (after) — framework by framework:**
- **Express/Node (Jest), pure-logic with real fixtures** — new `express-api/tests/scripts/drivers/android-auth-state.test.js`: a new exported pure helper `classifyAndroidAuthState(dumpXml)` is fed **real device-captured** UI-dump XML fixtures (the picker dump, the `main_*` dump, the warning-gate dump captured 2026-06-13) and asserted to return `picker` / `signed_in` / `warning` / `unknown` with the exact value per fixture. This is test *data*, not a mock collaborator → CI-runnable, No-Stubs-clean. RED before the helper exists, GREEN after.
- **eslint** `cd express-api && npm run lint` → 0 warnings.
- **`--check-drivers`** `node scripts/manual-qa-runner.js --check-drivers --target local` → driver still loads; method surface now includes `androidSignOut`.
- **Device gauntlet (Phase 1 LOCAL), real Android:** `androidSignOut` proven via the four BDD scenarios above on the real device; persona-switching proven by running ≥2 journeys back-to-back with different personas (`--driver all`); the **warning-ack DB-flip** proven by **j10 + j11** reaching green on the real device (the runner asserts `hasActiveWarning` transitions). Plus the existing all-browser web cells unaffected.
- **Phase 2 (review + push):** `code-reviewer` 100% clean (pre-self-review against null/undefined-pin, escTag, `-s` serial-scoping per [[feedback-pre-self-review-before-agent]]) → push → CI required checks green BY NAME (Detect Changes / Analyze JavaScript / PR Gate).
- **Phase 3 (DEV):** re-run the persona-switch + j10/j11 on dev via Deploy-To-Dev `ref` on the unmerged branch.

## Out of Scope

- **Per-persona server-side state reset** (clearing leftover `hasActiveWarning`/`warningCount` so a polluted persona signs in clean) — that is corpus-isolation **G4 / Phase X**; SHY-0096 proves switch + sign-out with clean personas and surfaces a clear error if a persona is polluted. (Filed/handled separately so this story stays the focused linchpin.)
- iOS persona-switch (the Appium path has its own `iosPersonaSignIn`; covered under SHY-0095 / Phase 1).
- Migrating `WarningAcknowledgmentTest.kt` off `FakeAuthRepository` to the real emulator — that androidTest fake migration is **Phase 2**; SHY-0096 proves warning-ack behaviour at the journey level (j10/j11) on the real device.
- Any change to the sign-out *product* UX or testTags (the chain already exists and is correct).

## Dependencies

- The real local stack ([[reference-local-stack-runner-setup]]) + real Android device + correctly-seeded personas (`seed-personas-local.js`, `localdev123`).
- Existing driver primitives: `androidTapByTag`, `waitForTag`, `androidUiDump`, `selectSerial`, `adb()` (`-s`-scoped).
- Source testTags (verified present): `main_settingsButton`, `settings_signOutButton`, `settings_signOutConfirmButton`, `warning_acknowledgeButton`, `persona_picker_open`, `main_roomsTab`.

## Risks & Mitigations

- **Risk:** the warning-acknowledge step can't complete because a session is genuinely invalid (the stale-session artifact seen during investigation after an emulator restart). **Mitigation:** that is an environment artifact, not steady-state (a fresh picker sign-in mints a valid session); the method fails loudly with the observed-screen diagnostic, and a one-time uninstall+reinstall re-baselines the device for the gauntlet.
- **Risk:** classifier mis-reads a splash/transition dump as `unknown` and acts too early. **Mitigation:** `unknown` triggers a bounded wait-and-re-dump loop, never an action; covered by the unknown-dump unit fixture.
- **Risk:** adding sign-out to every sign-in slows the corpus. **Mitigation:** the classifier skips the chain entirely when already on the picker (idempotent no-op), so the cost is paid only when actually signed in.
- **Risk:** unscoped `adb` call fails with "more than one device" (two transports). **Mitigation:** every call routes through the `-s`-scoped `adb()`; an edge-case AC asserts this.

## Definition of Done

- [ ] `androidSignOut` implemented + `androidPersonaSignIn` state-classifier added; the four sign-out BDD scenarios pass on the real device; a back-to-back two-persona switch reaches the second persona.
- [ ] `classifyAndroidAuthState` pure helper + `android-auth-state.test.js` (real-captured fixtures) RED→GREEN; all existing driver Jest/contract/pin tests pass unchanged; eslint 0; `--check-drivers` clean.
- [ ] **Pre-Merge Testing Protocol satisfied:** LOCAL gauntlet green on real Android (persona-switch + j10/j11 warning-ack DB-flip) + all browsers unaffected → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → judgment-merge (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)

- 2026-06-13 — Filed as EPIC-0003 **Phase 0** (the linchpin), born fully-refined ([[feedback-no-skeleton-stories-fully-refined]]). Grounded in live investigation (auth survives `am force-stop`; `pm clear`/`run-as` blocked on the OnePlus CPH2653; sign-out chain testTags verified in source: `main_settingsButton`/`settings_signOutButton`/`settings_signOutConfirmButton`/`warning_acknowledgeButton`) + the verified-correct environment (20 seeded user docs via admin-SDK; the earlier curl "0 docs" was a false measurement). Unblocks the clean corpus re-measure that drives Phase-2/3 story grouping.
- 2026-06-14 — **Real warning-gate fixture wired into the classifier test.** Captured `android-dump-warning.xml` (real uiautomator dump from the OnePlus CPH2653, P-10 Theo with `hasActiveWarning`) and added it to the real-fixture value matrix in `android-auth-state.test.js` (`['android-dump-warning.xml', 'warning']`) — the classifier's `warning` branch is now proven against a real device dump, closing the test-header TODO that deferred it. Synthetic precedence cases retained (a single real dump shows one state; multi-tag tie-breaks need synthetic inputs). **Verified (non-device frameworks):** classifier jest 18/18; full `tests/scripts/drivers/` jest 2519/2519; eslint (project flat-config) clean; prettier clean; `--check-drivers` 5 ok / 0 fail (skips = unconnected devices). **Still PENDING (device-bound, can't run without hardware):** the LOCAL device gauntlet — back-to-back two-persona switch + j10/j11 warning-ack DB-flip on real Android — and `code-reviewer` → push → CI → DEV gauntlet → judgment-merge. **Branch note:** this branch bundles SHY-0096/0097/0098/0099 (device-gauntlet cluster); the `usePrebuiltWDA` aid in `ios-appium-driver.js` is left UNCOMMITTED per SHY-0099's Out-of-Scope ("file as a follow-up if wanted").
- 2026-06-14 — **Bundle split into per-SHY branches** (operator: "split now, then test each" → one PR per SHY). The original device-gauntlet bundle (SHY-0096/0097/0098/0099) was split into five clean branches off `origin/main`. This branch (`story/SHY-0096-android-persona-signout-reset`) now carries ONLY SHY-0096's commits: the real in-app Android sign-out (`androidSignOut` + `classifyAndroidAuthState`), the `AppSettingsScreen.kt` testTag, and the real warning-gate fixture wired into the classifier test. **Supersedes the "this branch bundles SHY-0096/0097/0098/0099" note above** — the warning-acknowledge fix is now SHY-0097, the moderation hard-gate is SHY-0098, the iOS Debug-Local build fix is SHY-0099, and the shared LAN-bind infra became the new standalone SHY-0100. Split verified lossless (union of branches == bundle file-set; content-identical on shared files: `SharedNavGraph`, `android-adb-driver.js`, `users.js`). Bundle preserved as `backup/shy-bundle-pre-split`. Nothing pushed — each SHY runs its own full matrix before its PR.
- 2026-06-14 — **Device-gauntlet run surfaced + closed real apparatus gaps; two new driver primitives added here.** Running the real-device gauntlet (OnePlus CPH2653, local stack) revealed the journey apparatus was authored ahead of its driver methods. Added to this branch: (1) **`androidKillAndRelaunch`** (`am force-stop` + cold `am start` + settle) — the j10/j11 "kills and relaunches the app" step had a runner matcher but no driver method (`android-adb-driver.js` + unit tests; driver jest 1307/1307); (2) **real device sign-in from the generic "is signed in on Android" matcher** — it previously minted only a server `ctx.sessions` token (a FAKE "signed in" on-device), now also drives `androidPersonaSignIn` so the device app genuinely signs in (`manual-qa-runner.js`; runner jest 1904/1904). **Cross-branch finding:** the per-SHY split made each branch individually un-device-testable — the device gauntlet needs the **stacked** 0096+0097+0098 app together (this branch's `settings_signOutConfirmButton` `exposeTestTagsToPlatformDumps` so `androidSignOut`'s reset works, + 0097's acknowledge endpoint, + 0098's popup-over-warning gate). **Result:** the j11 **relaunch scenario is GREEN** on the real device, and **SHY-0097 is device-proven** (real on-device acknowledge tap clears `hasActiveWarning`). **Remaining** full-j11 completion (acknowledge-scenario robustness, `androidSendMessageTo`/`androidOpenConversationWith`, suspension/appeal Givens) is filed as **SHY-0101** (operator decision: bank the proof + apparatus, full j11 as its own story). eslint + prettier clean throughout.
- 2026-06-14 — **LOCAL device gauntlet GREEN on the real OnePlus CPH2653 + `code-reviewer` resolved.** Brought up the local stack (emulators + Express + app) and proved all four sign-out BDD scenarios + the linchpin switch on the real device: **S1** back-to-back two-persona switch (P-02 Alice → P-05 Lena, both reach `main_roomsTab` — the regression fix), **S2** sign-out from clean main → picker, **S4** idempotent sign-out on the picker (all on the SHY-0096-only app), and **S3** sign-out *through* a warning gate → picker (on the stacked 0096+0097+0098 app + 0097's Express: the real `/acknowledge-warning` endpoint cleared `hasActiveWarning`, breaking the real-time `observeUserFlags` re-route loop). **Cross-coupling confirmed:** S3 is un-isolatable — it needs SHY-0096's driver logic + SHY-0097's app client wiring + SHY-0097's Express endpoint together, so 0096+0097 should merge as a coordinated pair (or 0096's Done gates on the stacked proof). **≥2-journeys-back-to-back** corroborated via the real runner (j06 fired 7 real `androidPersonaSignIn` launches; j05 switched P-02→P-15 with no regression error — the scenario-level failures are pre-existing IAP/monetization corpus drift = SHY-0101/EPIC-0003, not SHY-0096). **`code-reviewer` returned 5 Critical + 2 Important; ALL resolved here:** C-1/I-2 — `androidSignOut` now throws a specific error when the warning-ack does not clear the gate / on a `legal_gate` (was a silent fall-through to a blind nav tap); C-4 — `androidKillAndRelaunch(name, target)` resolves the package via `PACKAGE_BY_TARGET` (not hard-coded `.local`) + the runner forwards `ctx.target`; C-2 — `androidSignOut` unit tests (9, every branch + throw); C-3 — `_advancePastLaunchGates`/`_tapByVisibleText`/`_dismissDailyRewardIfPresent` unit tests (12); C-5 — generic-catch-all device-branch runner tests (6); I-1/I-5 — stale comments corrected. I-3 (kill error-structure) reviewer-marked non-blocking; I-4 (mock tension) resolved by operator 2026-06-14 ("only unit tests may use mocks"). **Verified (non-device):** driver jest 1331/1331, runner jest 1910/1910, eslint clean, prettier clean (the C-4 runner change correctly broke 2 pre-existing kill-matcher tests → updated to assert the forwarded target). All new `execSync`/`jest.fn` doubles are confined to unit tests.
