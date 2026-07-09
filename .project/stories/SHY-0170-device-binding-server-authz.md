---
id: SHY-0170
status: In Review
owner: claude
created: 2026-07-09
priority: P0
effort: M
type: bug
roadmap_ids: []
pr:
mvp: true
epic: EPIC-0006
---

# SHY-0170: Move the device-lock decision server-side (device-binding via API, not direct Firestore)

## User Story

As a ShyTalk safety stakeholder, I want the **device-lock / ban-evasion decision made by the Express API, not by the client reading Firestore directly**, so that a tampered or reverse-engineered client cannot bypass the "one device ↔ one account" anti-abuse control — closing a real client-side-authorization hole and taking the first write-path cluster of [[EPIC-0006]] fully behind the API.

## Why

[[feedback-no-direct-backend-all-via-api]]: clients must never touch Firestore directly; the API is the single authorization layer. The audit (`.project/audit/direct-backend-access-audit-2026-07-09.md` §3.8, §4) found `DeviceRepositoryImpl` (Android) + `IosSmallRepositories` (iOS) read and write `deviceBindings/{deviceId}` directly. Investigation of the callers (`AuthViewModel.kt:303-355`) shows this is not benign telemetry — it is the **device-lock enforcement itself, decided client-side**:

- Existing user signs in and the device is bound to a **different** `uniqueId` → the *client* sets `isDeviceLocked` and signs out (`AuthViewModel.kt:313-321`).
- Device unbound → the *client* writes the binding (`bindDevice`, line 322-324).
- **New** user on an already-bound device → the *client* blocks account creation (line 341-349).

Because the decision and the read both happen on-device, a modified client can simply skip them — defeating ban-evasion / multi-account protection. This is exactly the risk the operator's directive targets ("the API is how we determine who can and cannot do things"). Two further defects surfaced:

1. **Dual-write inconsistency:** the client `bindDevice` writes `{userId, boundAt}`, while the server `POST /api/device-info` writes the richer `{uniqueId, …telemetry…}` — so `getDeviceBinding` defensively reads `uniqueId ?? userId`. Two writers, two shapes, one doc.
2. **Unconditional server rebind:** `device-info.js:107-115` sets `uniqueId: req.auth.uniqueId` with `merge:true` on **every** call — so it would silently rebind a device to whoever calls it, which (if it ran for a second user) contradicts the lock intent. Today it is masked only by the client checking first; once the decision moves server-side this must be made conditional.

Moving the decision server-side fixes the vulnerability AND reconciles both defects.

## Acceptance Criteria

### Happy path

- [ ] A new authorized endpoint (e.g. `POST /api/devices/lock-check`) takes `deviceId` + the caller's authenticated `uniqueId` (from `req.auth`, never the body) and, in one server-side transaction: reads `deviceBindings/{deviceId}`; returns `{ status: "allowed" | "locked", boundToOther: boolean }`; and, when the device is unbound, atomically binds it to the caller.
- [ ] The endpoint's decision matches today's intended behaviour exactly: bound-to-same-user → `allowed`; bound-to-different-user → `locked`; unbound + existing user → bind + `allowed`; unbound + would-be-new-user → the caller (AuthViewModel) still gets the signal it needs to block creation (the endpoint reports `boundToOther`/binding state; the new-vs-existing decision stays in the caller, but is now driven by server-returned state, not a client Firestore read).
- [ ] `DeviceRepository.getDeviceBinding` + `bindDevice` are replaced by a single API-backed operation (e.g. `resolveDeviceLock(deviceId): Resource<DeviceLockResult>`); Android `DeviceRepositoryImpl` and iOS `IosSmallRepositories` call the API (mirroring the existing `checkBanStatus → /api/device-info` pattern) with **zero** Firestore access.
- [ ] `POST /api/device-info` no longer *unconditionally* overwrites `uniqueId` on an already-bound device (make the uniqueId bind conditional/first-write-wins, or delegate binding to the lock-check op) — so telemetry updates never silently re-bind a locked device.
- [ ] The 2 Kotlin files (`DeviceRepositoryImpl.kt`, `IosSmallRepositories.kt`) drop out of `scripts/direct-backend-baseline.json` (ratchet shrinks); no new direct-backend reference is added.
- [ ] `firestore.rules` `deviceBindings` (line ~521) is tightened to deny direct client read AND write (server Admin SDK only) — proven by a rules test.

### Error paths

- [ ] **API unreachable during sign-in:** preserve today's lenient posture with intent — a failed lock-check must NOT silently grant access on the *ban-evasion* path in a way that regresses safety; match the current `Resource.Error → /* lenient */` behaviour deliberately, and document the trade-off (availability vs. strict-deny) as an explicit decision, not an accident. (If strict-deny is chosen, it is a conscious change with its own test.)
- [ ] **Missing/blank `deviceId`** → 400, tested.
- [ ] **Unauthenticated call** → 401 (the endpoint requires `req.auth`; `uniqueId` is never taken from the body — an attacker must not assert someone else's identity).

### Edge cases

- [ ] **Race: two sign-ins bind the same unbound device concurrently** → the atomic server transaction binds exactly one; the second sees `boundToOther`. Proven with a real concurrent test against the emulator.
- [ ] **Legacy docs with `userId` but no `uniqueId`** (the old client-written shape) → the server reads both fields (back-compat) and, on next write, normalises to `uniqueId`; a migration note is filed if legacy docs exist in prod.
- [ ] **`bypassDeviceChecks` (debug builds)** — the AuthViewModel debug bypass (`AuthViewModel.kt:312`) still works; the server endpoint is simply not called in that path (no server-side bypass flag — the bypass is a debug-client concern).

### Performance

- [ ] The lock-check is one Firestore read (+ conditional write) server-side — no worse than today's client read + write, and now on the API's warm Admin SDK connection. No added round-trip beyond the one the client already made.

### Security

- [ ] The core fix: the lock decision is server-authoritative; the client cannot grant itself access by tampering. `uniqueId` is always `req.auth.uniqueId` (identity is proven by the ID token, never asserted in the body). Rules deny direct `deviceBindings` access so the only path is the authorized endpoint. Negative tests (different-user → `locked`, new-user-on-bound → blocked) go RED if the server authz is reverted (per [[feedback-test-must-fail-if-logic-skipped]]).

### UX

- [ ] No user-visible change on the happy path (same sign-in flow, same `isDeviceLocked` screen when locked). The lock screen / block-new-account messaging is unchanged.

### i18n

- [ ] N/A — no new user-facing strings (reuses the existing `account_restricted`/device-locked messaging).

### Observability

- [ ] The endpoint logs each decision (deviceId, decision, boundToOther) at info/warn so ban-evasion attempts are visible server-side (they are currently only a client `logW`, invisible to the backend).

## BDD Scenarios

**Scenario: a device already used by someone else is blocked — decided by the server**
- **Given** a device is bound to user A
- **And** user B signs in on that device
- **When** the app asks the API to check the device lock
- **Then** the API responds that the device is locked to another account
- **And** user B is signed out and shown the device-restricted screen
- **And** the decision was made by the API, not by the app reading the database

**Scenario: a tampered app cannot bypass the lock**
- **Given** the `deviceBindings` data can no longer be read or written directly by a client (rules deny it)
- **When** a client attempts to read another device's binding directly
- **Then** the read is denied
- **And** the only way to obtain the lock decision is the authorized API endpoint

**Scenario: first use of a fresh device binds it to the signing-in user**
- **Given** a device with no existing binding
- **When** an existing user signs in and the API performs the lock-check
- **Then** the API binds the device to that user and returns "allowed"
- **And** a later sign-in by the same user on the same device is still allowed

**Scenario: a new account cannot be created on an already-used device**
- **Given** a device already bound to some user
- **When** a brand-new (not-yet-registered) person tries to create an account on it
- **Then** the API reports the device is already bound
- **And** account creation is blocked

## Test Plan

**True TDD, RED before GREEN, real services (no mocks outside unit locations — [[feedback-no-stubs-mocks-fakes-real-only]]):**

- **Server (Jest, REAL local emulator — the canonical `cd express-api && node --experimental-vm-modules node_modules/.bin/jest`):** new `tests/routes/devices-lock-check.test.js` using `mintRealUser` + a real Firestore emulator. RED cases first: (a) bound-to-different-user → `locked` (goes RED if the server skips the authz check); (b) unbound → binds + `allowed`, and the doc now has `uniqueId` = the caller; (c) bound-to-same-user → `allowed`, no rebind; (d) unauthenticated → 401; (e) missing deviceId → 400; (f) concurrent bind race → exactly one winner; (g) `/api/device-info` no longer rebinds an already-bound device to a new caller. Each negative case must fail if the corresponding server guard is reverted (mutation-checked).
- **Rules (emulator rules test):** direct client read AND write of `deviceBindings/{deviceId}` is DENIED after the tighten; the Admin SDK path still works.
- **Kotlin host tests (`shared/src/jvmTest` / `commonTest` where the logic is platform-agnostic):** the repository's API mapping (JSON → `DeviceLockResult`) and the AuthViewModel branch selection given each server result (allowed / locked / new-user-blocked) — host-JVM, so they also give iOS execution proof via `commonTest` where applicable (avoiding the app-module-only gap noted for the ViewModel-test stories).
- **Client integration (real API):** Android + iOS repo impls hit the real local Express + emulator and get the right decision — no Firestore handle in the impl.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Backend + app change → FULL protocol (NOT exempt).** Touches `express-api/src` (new endpoint + `device-info` change + rules) AND client Kotlin (`app/src/main`, `shared/src/iosMain`, `shared/src/commonMain`). Per the backend⇒full-gauntlet rule (SHY-0127) the whole matrix applies. **MVP sprint flow ([[project-mvp-sprint-state]]):** land the fast layers per-PR (Jest real-emulator + rules + Kotlin host tests + iOS compile `:shared:compileKotlinIosArm64` + detekt/ktlint + eslint + the ratchet shrink), with the **real-device sign-in E2E (device-lock journey on real Android + real iPhone) batched** into the final device gauntlet before release — the sign-in/device-lock path MUST be exercised on real devices there. LOCAL gauntlet green → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet → judgment-merge to develop; NO auto-merge.

## Out of Scope

- The other write-path clusters (users/rooms/PM/seats/room-chat) — their own EPIC-0006 stories.
- Real-time reads / the transport spike ([[SHY-0169]]).
- The admin console's device views (`/admin/devices`) — already server-side (admin-authed); untouched here.
- Removing the DI Firestore binding entirely (the EPIC end-state) — happens once ALL clusters are migrated; this story only removes this repo's usage.

## Dependencies

- [[EPIC-0006]] + the audit. The existing `WorkerApiClient`/`IosApiClient` token path + the `checkBanStatus → /api/device-info` pattern to mirror. `mintRealUser` (`express-api/tests/helpers/real-auth.js`) + the local emulator.
- The [[SHY-0168]] ratchet (already merged) — this story shrinks its baseline.

## Risks & Mitigations

- **Risk: changing `/api/device-info`'s rebind behaviour regresses telemetry or ban binding.** **Mitigation:** a Jest test pins that telemetry fields still update while `uniqueId` is not re-bound on an already-bound device; the ban-check path is unchanged.
- **Risk: making the lock strict (deny on API failure) locks out real users on a backend blip; staying lenient preserves a bypass window.** **Mitigation:** the error-path AC forces an explicit, tested decision on this trade-off (default: preserve today's lenient posture, documented), not a silent one.
- **Risk: legacy `userId`-only binding docs in prod.** **Mitigation:** server reads both fields + normalises on write; a follow-up migration SHY is filed if a prod scan finds legacy docs.

## Definition of Done

- [x] Server endpoint + `device-info` reconcile + rules tighten implemented TDD (RED→GREEN); all Test-Plan layers green against the REAL emulator (9 lock-check + 8 rules + 2 device-info reconcile).
- [x] Android + iOS repo impls call the API with zero Firestore access; the **Android** `DeviceRepositoryImpl.kt` leaves `direct-backend-baseline.json` (34→33); the **iOS** `IosSmallRepositories.kt` stays (its Banner/FunFact/Notification repos are other clusters — device usage removed); the ratchet passes at the lower baseline.
- [x] AuthViewModel drives the lock decision from server-returned state via `resolveDeviceLockOrBlock()`; no behaviour regression (same lock screen when locked, same block-new-account) — proven by 4 new commonTest cases (JVM + iOS).
- [ ] **Pre-Merge Testing Protocol satisfied** (full; device-lock journey batched to the real-device gauntlet) → `code-reviewer` 100% clean → judgment-merge to develop.
- [ ] `released_in: vX.Y.Z` after the release cut; `status: Done`.

## Notes (running log)

- 2026-07-09 — Created as the FIRST write-path remediation of [[EPIC-0006]] (operator: "start write-path remediation"). Chosen as the pilot (smallest write cluster, decision-independent). **Investigation upgraded it from a mechanical migration to a security-bug fix:** the device-lock/ban-evasion decision is currently client-side and bypassable (`AuthViewModel.kt:303-355` reads `deviceBindings` directly + decides on-device); the server `/api/device-info` already binds (`device-info.js:107-115`) but unconditionally, and the client `bindDevice` writes an inconsistent `{userId}` shape. Design: a server-authoritative `lock-check` endpoint (atomic read→decide→conditional-bind) replacing both client ops; reconcile `/device-info`'s rebind; tighten rules. Full evidence + call-sites in the [[project-applock-pin-appears-unwired-finding]]-adjacent handoff + the audit §3.8/§4. Establishes the migration pattern (endpoint + client twin migration + ratchet shrink + rule tighten + real-emulator TDD) reused by the remaining clusters.
- 2026-07-09 — **Implemented, TDD, two increments (server `917f46949d5`, client `183573dd0c7`), pushed.** Server (RED→GREEN, real Firestore/Auth emulator): `POST /api/devices/lock-check` (atomic `runTransaction` read→decide→conditional-bind; identity from `req.auth.uniqueId`, never body; `{status,boundToOther}`) — 9 tests incl. concurrent-race one-winner + legacy `{userId}`; `device-info` no longer unconditionally rebinds a foreign-owned device (2 tests); `firestore.rules deviceBindings` → `allow read, write: if false` (8 real-emulator rules tests: user/admin/anon read + create/update/delete all denied). Client: `DeviceRepository` → `resolveDeviceLock(deviceId): Resource<DeviceLockStatus>` (enum ALLOWED/LOCKED); `AuthViewModel.resolveDeviceLockOrBlock()` unifies both branches (LOCKED→signout+isDeviceLocked; Error→lenient); Android impl drops FirebaseFirestore (baseline 34→33); iOS impl drops the firestore param + DI updated. Tests: **4 new device-lock cases in commonTest (JVM AND iOS)** + rewritten `DeviceRepositoryImplTest` (API-mapping via WorkerApiClient double) + migrated mockk stubs + androidTest fake/journey. **Investigation reconfirmed the security value:** the old flow read `deviceBindings` on-device and let the CLIENT decide the lock — bypassable; now the API decides. Verified: `:shared:jvmTest` 31 green · `:app` device+auth unit green · `:shared:compileKotlinIosArm64` clean · ktlint+detekt clean · 48 ratchet tests green. **Admin console confirmed already server-side** (`/api/admin/devices`) so the rules full-deny is safe. NEXT: `code-reviewer` on `55aa8b900f4..183573dd0c7` → PR develop → full gauntlet (device-lock sign-in journey batched to real-device) → judgment-merge.
