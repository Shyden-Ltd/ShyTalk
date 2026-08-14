---
id: SHY-0192
status: Done
owner: claude
created: 2026-07-16
priority: P1
effort: M
type: bug
roadmap_ids: []
epic: EPIC-0004
mvp: true
released_in: v0.98.0
---

# SHY-0192: Fix App-Lock PIN enrolment — it has never worked end-to-end

## User Story

- **As a** ShyTalk user who wants to protect the app with a PIN
- **I want** to set a PIN from Settings → Security and have it stick
- **So that** the App-Lock actually locks the app (today I can never set a first PIN at all)

## Why

SHY-0187 wired the App-Lock into navigation and made the enrolment surface reachable for the first time. Walking that surface on a real device proved the enrolment flow is **broken in multiple places** and has never worked end-to-end — the screens + repositories were built and unit-tested (with fakes that pre-seed state), but the real client↔server↔storage chain was never exercised. Concretely, on a real device against the real local stack:

1. **`POST /api/auth/pin/setup` drops a contract field.** The server computes `pinHash` and persists it, but responds `{ message: 'PIN set' }`. Both clients read `response.getString("pinHash")` (Android `PinRepositoryImpl:19`) / `response["pinHash"]!!` (iOS `IosSmallRepositories:292`) → every enrolment throws **"No value for pinHash"**. `PinRepositoryImplTest` passes only because its fake API response includes `pinHash` the real server never sends.
2. **Circular device-registration guard.** After (1) is patched, `PinSetupViewModel.savePinToServer` reads `appLockRepository.storedUniqueId`/`storedDeviceId` and bails with **"Device not registered"** if either is null — but `setCredential` is the ONLY writer of those keys and runs AFTER the guard. On a first-ever PIN setup they are always null, so the guard always fails: **a user can never set their first PIN.**
3. **`localPinHash` is vestigial.** The client stores the returned hash for "offline PIN verification", but `LockScreenViewModel` verifies **online** via `pinRepository.verifyPin(...)` (`:96`) and nothing ever reads `localPinHash`. So the whole "return the hash and store it" machinery exists only to break enrolment.
4. **First-time-setup auto-prompt is unwired.** `AuthViewModel` sets `needsPinSetup` (`:620`) but it has zero consumers — nothing routes a new user to PIN setup; the only path is Settings → Security → Reset PIN.
5. **`resetPin()` / `POST /api/auth/pin/reset` is dead.** A fully-built, tested "reset PIN after re-authentication, clears lockout" path has no production caller; enrolment uses `setupPin()` instead (code-reviewer SHY-0187 R3 Imp-4).

This is a launch-blocker for the App-Lock (a security control in a minors-facing app): the feature is non-functional. It also blocks SHY-0187's lock device-gauntlet — you cannot device-prove a lock whose PIN can never be set.

## Acceptance Criteria

### Happy path
- [ ] A signed-in user with no PIN can complete Settings → Security → Reset PIN → choose length → enter → confirm, and the PIN is stored server-side AND the App-Lock credential is registered locally (no "No value for pinHash", no "Device not registered").
- [ ] After enrolment, cold-launching the app past the lock timeout shows the Lock screen and the just-set PIN unlocks it (verified against the real backend).

### Error paths
- [ ] A server/network failure during setup surfaces a real error to the user and does NOT register a local credential (fail-closed — no half-enrolled state where the lock engages with no verifiable PIN).
- [ ] Entering two non-matching PINs at the confirm step re-prompts without contacting the server (unchanged existing behaviour, regression-guarded).

### Edge cases
- [ ] Enrolment works when `storedUniqueId`/`storedDeviceId` were never previously set (the first-PIN case) — the identity + device id are sourced from the authenticated session (`AuthRepository.currentUserId`) and the device-id provider, not from the App-Lock repo's own not-yet-written copy.
- [ ] Re-running setup for a user who already has a PIN replaces it (create-or-replace) and clears any lockout state.

### Performance
- [ ] Enrolment is a single round-trip to `/api/auth/pin/setup`; no added latency versus today. N/A beyond that — no hot path.

### Security
- [ ] Decide + document the hash-handling contract: either the server returns `pinHash` for the client to store as its local credential (bcrypt of the caller's own PIN, over TLS to the authenticated setter), OR the client stops depending on a server-returned hash entirely (preferred if offline verification is never implemented — verification is online today). Whichever is chosen, no password/PIN hash is logged, and the response is not cached.
- [ ] The reset-PIN path continues to require identity verification when a credential exists (delivered by SHY-0187; this story must not regress it) and, once enrolment works, is proven live on the real device.

### UX
- [x] The "Reset PIN" row copy ("Verify your identity to set a new PIN") matches behaviour for both first-set (no verify) and change (verify) — reword the row/desc if first-set should read differently. *(Done 2026-07-16: row copy is now conditional on `hasCredential` — no credential → "Set PIN" / "Protect the app with a PIN"; credential → unchanged reset copy. Visual proof rides the deferred device gauntlet.)*
- [x] A new user is routed toward setting a PIN (wire `needsPinSetup`, or consciously defer with a documented rationale). *(Consciously DEFERRED 2026-07-16 — the flag read only local `hasCredential`, so it could not distinguish "lost my credential (reinstall)" from "never opted in"; wiring it would nag every non-enrolled user. The dead flag is REMOVED; the correct server-truth prompt (`hasPin` in the sign-in payload) is specced as follow-up SHY-0193.)*

### i18n
- [ ] Any new or reworded user-facing string is added to all 20 locale files; no hard-coded English.

### Observability
- [ ] Enrolment success/failure is logged (unredacted locally per the debug-logging rule; no PIN or hash value) so a future failure is diagnosable without a device in hand.

## BDD Scenarios

**Scenario: a first PIN can actually be set**
- **Given** a signed-in user who has never set a PIN
- **When** they complete Settings → Security → Reset PIN and confirm a valid PIN
- **Then** the server stores the hash and returns success
- **And** the local App-Lock credential is registered (uniqueId + deviceId + hash) with no "Device not registered" error

**Scenario: setup response carries what the client needs**
- **Given** the client calls `POST /api/auth/pin/setup` with a valid PIN
- **When** the server responds
- **Then** the client can construct its local credential from the response without throwing on a missing field

**Scenario: identity/device come from the session, not the App-Lock repo**
- **Given** the App-Lock repo has no stored uniqueId/deviceId yet (first enrolment)
- **When** the user sets a PIN
- **Then** the flow uses the authenticated `currentUserId` + the device-id provider to register the credential

**Scenario: failed setup does not half-enrol**
- **Given** the setup request fails (network or server error)
- **When** the user retries or leaves
- **Then** no local credential is registered and the App-Lock does not engage with an unverifiable PIN

**Scenario: reset still requires verification (no regression)**
- **Given** a user who already has a PIN
- **When** they tap Reset PIN
- **Then** they must pass PinVerifyDialog before setting a new one

## Test Plan

Touches `express-api/src/routes/auth.js` (backend) + `shared/**` (PinSetupViewModel / PinRepository / AppLockRepository) + both platform impls → **full protocol + backend⇒full-gauntlet**.

**Red → Green:**
- **Express Jest — `express-api/tests/routes/auth-pin.test.js`**: assert the chosen setup contract (either `res.body.pinHash` is returned, or — if the client-drops-hash option is taken — document that setup returns only `{message}` and the client no longer requires it). RED against current `res.json({ message: 'PIN set' })`.
- **Kotlin jvmTest — `PinSetupViewModelTest`**: a NEW test driving the REAL first-enrolment path with `storedUniqueId`/`storedDeviceId` unset — asserts the credential IS registered (sourcing identity/device from the session), i.e. RED against the current circular guard ("Device not registered"). Mutation-verify by reverting the guard fix.
- **Kotlin jvmTest — `PinRepositoryImplTest` / iOS equivalent**: align the `setupPin` contract with the server decision (return type + what it stores).
- **Android instrumented `security_settings.feature` + a PIN-enrolment journey**: once the backend is real, promote the reset-PIN scenarios (currently device-gauntlet-scoped in SHY-0187) to run against the real local stack.
- **Device gauntlet** — real Android + real iPhone: set a first PIN end-to-end; cold-launch → lock → unlock with that PIN; reset with verification. This is the proof SHY-0187's lock gauntlet is waiting on.

## Out of Scope

- Implementing offline PIN verification (if `localPinHash` is removed, offline verify stays a separate future story — today verification is online).
- Biometric enrolment changes beyond what the PIN flow needs.
- The lock-gating navigation itself (delivered by SHY-0187).

## Dependencies

- Coordinates with SHY-0187 (which wired the enrolment surface + the reset-PIN verify gate). SHY-0187's full lock device-gauntlet is blocked on this story.
- Needs the CI-equivalent express harness (emulators demo-shytalk + Docker MinIO + Mailpit) for the backend suite, and the real device gauntlet.

## Risks & Mitigations

- **Risk:** a half-enrolled state where the lock engages but the PIN can't be verified locks a user out. **Mitigation:** fail-closed — register the local credential only after server success; error-path AC + test.
- **Risk:** returning a bcrypt hash of a short PIN in the response is offline-crackable if intercepted. **Mitigation:** the Security AC forces an explicit decision (return-hash vs client-drops-hash); prefer dropping the hash since verification is online.
- **Risk:** sourcing identity/device wrongly re-introduces asymmetry between platforms. **Mitigation:** source from the shared `AuthRepository.currentUserId` + the shared device-id provider; commonTest covers it.

## Definition of Done

A signed-in user can set a first PIN from Settings → Security on real Android AND real iPhone; the App-Lock then engages and unlocks with that PIN; reset requires verification; the setup contract + hash-handling decision is documented; `needsPinSetup` is wired or consciously deferred; `code-reviewer` 100% clean; backend + device gauntlets green; merged; released. Unblocks SHY-0187's lock device-gauntlet.

## Notes

Reviewed-up-to: c341f83376d

- 2026-07-16 ~10:0x WIB — **Combined review (with SHY-0187) → 4 findings → ALL FIXED → clean.** code-reviewer verdict on the stack: "No functional or security bugs were found in the production code itself." Findings + resolutions (fix commit `c341f83376d`): (1-Critical, administrative) status flip + `Reviewed-up-to` markers — this entry. (2-Important) fail-closed assertions added to all 4 failure-path tests + NEW `setupPin failure during first enrolment registers no credential`; mutation-verified (a `setCredential` call in `onFailure` → exactly those 5 red). (3-Important) mismatch test now drains the dispatcher and asserts `setupCallCount == 0` — the FIRST mutant ESCAPED the naive assertion (queued coroutine never ran without `advanceUntilIdle`; a passing mutation is a finding — test strengthened until the mutant died). (4-Minor) synchronous `isLoading` re-entrancy guard in `savePinToServer`; RED-first double-submit test proves exactly one server call. Per operator token-frugality directive (same morning), the small fix delta was self-verified with mutation evidence rather than a fresh agent round. **Status → In Review.** Merge to develop under the devices-away stacking protocol is HELD pending the operator's call on the same-morning App-Lock redesign directive (device-OS credential, serverless — see SHY-0196): recommendation is to land this working, device-proven state and let SHY-0196 replace the PIN machinery wholesale.

- 2026-07-16 ~08:0x WIB — **Remaining increments DONE (devices unavailable — device proof deferred on operator instruction).** (1) **Dead `resetPin()`/`POST /api/auth/pin/reset` REMOVED at every layer** (route + doc line, `PinRepository` interface, Android + iOS impls, fake overrides, impl tests) — TDD RED-first: new `auth-pin.test.js` absence test ("route must 404") observed RED (200) then GREEN after removal; rationale: the endpoint duplicated `/pin/setup`'s exact write but returned no `pinHash`, so any future caller would re-create the broken-enrolment bug; `/pin/setup` is the single create-or-replace home and already clears lockout state (`pinAttempts`/`pinLockedUntil`/`pinLockoutCount`). (2) **`needsPinSetup` REMOVED** (AuthUiState field + computation + assignment; zero consumers, zero tests referenced it) — local-only signal couldn't represent the migration case; conscious deferral documented in the UX AC; server-truth replacement specced as **SHY-0193** (fully refined, Draft). (3) **Observability AC filled**: `PinSetupViewModel` now logs enrolment success / no-identity block / server failure via `logI`/`logE` (tag `PinSetup`, no PIN/hash values; log calls ride paths already covered by `PinSetupViewModelTest`). (4) **UX AC filled**: Security-settings row copy now conditional — `security_set_pin`(+`_desc`) added to base + all 20 locales; click-gate still reads live `hasCredential` (label may lag one recomposition; the verification gate never does). Gates re-run this session post-change: jvmTest + app unit + detekt + iosArm64 compile (BUILD SUCCESSFUL), ktlint 0, `auth-pin.test.js` 29/29. Express FULL suite + device gauntlet pending (below).

- 2026-07-16 ~05:2x WIB — **IMPLEMENTED (stacked on story/SHY-0187; commit `213a5045c30`) + LIVE-PROVEN on the real device.** Two root causes fixed, both TDD RED-first: **(gap 1, server contract)** `/api/auth/pin/setup` now returns `pinHash` (express `auth-pin.test.js` asserts it — the pre-fix test only checked the DB write, never the client-facing response). **(gap 2, circular device guard)** `PinSetupViewModel` sources identity from `AuthRepository.currentUserId` + the injected `named("deviceId")` provider instead of `appLockRepository.storedUniqueId`/`storedDeviceId` (which `setCredential` is the sole writer of); the guard now correctly means "not signed in", not "first PIN". `PinSetupViewModelTest` +2 tests (`first-ever enrolment registers the credential from the session identity`, and the repurposed `device not registered...` now keys on a null session identity) — **mutation-verified**: reverting to `storedUniqueId` turns exactly those 2 red. **Decisions recorded:** (Security AC) chose **server-returns-hash** over client-drops-hash — the client's existing design caches `localPinHash` in SecureStorage (flagged sensitive), so returning bcrypt-of-own-PIN over TLS to the authenticated setter is the intended provisioning, not new exposure, and it satisfies every existing client test; the "`localPinHash` is vestigial because verify is online" cleanup stays a genuinely separate future decision (kept in this story's Why/Out-of-Scope, not done). `needsPinSetup` auto-prompt + dead `resetPin()`/endpoint remain in scope but are **not yet done** (next increments). **Live proof (OnePlus CPH2653, local stack):** signed in → Settings → Security → Reset PIN (no credential → straight to setup) → set 4-digit PIN → **succeeded** (evidence `12`, where it failed twice before with "No value for pinHash" then "Device not registered") → Reset PIN now shows the **verify dialog** (`13`, proves credential stored + SHY-0187 Crit-1 gate live) → entering the PIN **verified online** and advanced to setup (`14`, proves `verifyPin`). Host gates: jvmTest **1378/0**, app unit **2233/0**, `auth-pin.test.js` **34/0**, detekt, ktlint, iosArm64 + iosSimulatorArm64 test compile, app compile. **Remaining before merge:** finish `needsPinSetup` + dead-`resetPin` increments (or split them out), `code-reviewer` on the combined SHY-0187+SHY-0192 stack, backend + real-iPhone device gauntlet, status → In Review.

- 2026-07-16 — Filed from the SHY-0187 device walk (real OnePlus CPH2653, local stack). Evidence: `/tmp/shytalk-gauntlet/evidence/{03,04,06,07}` (surface works, no-credential branch routes to setup) and `{09,10,11}` (enrolment fails — "No value for pinHash", then "Device not registered"). A stopgap server fix (`res.json({ message: 'PIN set', pinHash })`) was proven to clear gap (1) but was reverted from the SHY-0187 branch because it is a backend change on a KMP nav story and is incomplete without gap (2). Root causes verified in live code: `auth.js` pin/setup response; `PinSetupViewModel.savePinToServer` circular guard; `AppLockRepositoryImpl` sole-writer of the uniqueId/deviceId keys; `LockScreenViewModel:96` online verify (localPinHash unread); `AuthViewModel:620` `needsPinSetup` unconsumed. `mvp: true` — the App-Lock is a security control that is currently non-functional. Grouped with [[project-applock-pin-appears-unwired-finding]].
