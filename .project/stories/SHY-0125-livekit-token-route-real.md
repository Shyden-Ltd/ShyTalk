---
id: SHY-0125
status: In Progress
owner: claude
created: 2026-06-17
priority: P0
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0125: Migrate the LiveKit token-route tests to real services — real Firestore emulator + real LiveKit SDK (EPIC-0003 · Rooms area / SHY-0113 slice 1)

## User Story

**As** the team executing EPIC-0003's Rooms/Voice/LiveKit migration (the SHY-0113 area),
**I want** the two LiveKit token-route test files (`express-api/tests/routes/livekit.test.js` + `livekit-cohort.test.js`) moved off **all** in-process doubles (`jest.mock('firebase')`, `jest.mock('livekit-server-sdk')`, `jest.mock('livekit-region')`, `jest.mock('log')`) and onto the **real Firestore emulator** + the **real LiveKit SDK** (real local JWT mint) + **real env-driven region resolution** + **real (unasserted) logging**,
**So that** "does `POST /api/livekit/token` actually mint a correctly-scoped token for a cohort-gated room?" is proven by real services — not by mocks that could hide a broken cohort gate or a mis-scoped grant.

## Why

This is the **first concrete slice of SHY-0113** under the operator-chosen "child SHYs, just-in-time" decomposition. The LiveKit token route is the smallest, safest vertical to migrate first: one route, ~38 tests across the two files, **no FCM** and **no RTDB-presence dependency**, so it is **not blocked by SHY-0102/0103** (the room-creation rule bugs). It is therefore the right place to prove the real-emulator + real-SDK pattern before the transactional seat-claim complexity in `room-mutations.test.js` (~90 tests). Crucially, LiveKit **token minting is local crypto** — `AccessToken(key, secret).addGrant({…}).toJwt()` signs a JWT with the API secret and never contacts the LiveKit server — so a real, deterministic token can be minted, decoded and asserted entirely offline. The SDK mock is thus both **unnecessary** and **policy-violating** (the keystone policy permits doubles only in unit tests; this is an integration test exercising the route + Firestore + the SDK). Migrating drains the no-stubs baseline for both files.

## Acceptance Criteria

### Happy path
- [ ] Neither `livekit.test.js` nor `livekit-cohort.test.js` contains a `jest.mock` of `firebase`, `livekit-server-sdk`, `livekit-region`, or `log`, nor a `jest.fn`-based collaborator double; the no-new-stubs baseline shrinks by exactly the removed entries (regenerated + committed).
- [ ] The route is exercised against the **real Firestore emulator**: a real room doc + the caller's real user/cohort state are seeded per-test, and the cohort gate reads real Firestore (not a mocked `db.doc`).
- [ ] A **real LiveKit JWT** is minted via the real `livekit-server-sdk` `AccessToken` (test creds), returned by the route, decoded, and asserted to carry the real grants: `video.roomJoin === true`, `video.room === <roomId>`, `canPublish`/`canSubscribe` exactly per the route contract, `sub` (identity) === the authed `uniqueId`, and `metadata.cohort` === the room's cohort.
- [ ] Region resolution is real: with `LIVEKIT_URL_ASIA`/`LIVEKIT_KEY_ASIA`/`LIVEKIT_SECRET_ASIA` set, the token verifies against the Asia secret; same for EU; with region vars absent it falls back to `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` — asserted as an exact value matrix (each region → expected url/key/secret used).

### Error paths
- [ ] Missing LiveKit creds (resolved region has no key/secret) → real route returns **503**, driven by real region resolution (not a mocked throw).
- [ ] Malformed / empty / over-long `roomName`, and path-traversal-shaped or control-character names → real route returns **400** (server-side contract).
- [ ] Unauthenticated / invalid-auth request → rejected on the real auth path (401/403), asserted on the real response.

### Edge cases
- [ ] Cross-cohort: a caller in cohort A requests a token for a cohort-B room → the **real Firestore cohort gate** returns **404** (existence-hiding) and a **real audit row** is written to the real audit collection (asserted by reading it back).
- [ ] Admin bypass: a real `admin` claim mints a token for any cohort's room (asserted against real state).
- [ ] Room missing the `cohort` field / legacy room shape → defined, asserted behavior (not an unhandled throw).

### Performance
- [ ] Token mint + cohort lookup completes within an asserted bound against the local emulator (e.g. < 500 ms), guarding against accidental extra Firestore round-trips.

### Security
- [ ] A cross-cohort / non-member caller cannot obtain a token for a private room (real cohort gate denies).
- [ ] The minted token's grants are scoped to exactly the requested room (no wildcard `room`); verified by decoding the real JWT.
- [ ] No secret is logged: the resolved API secret / any private key value does **not** appear in captured real log output (assert absence).
- [ ] `roomName` path-traversal / injection shapes are rejected before any Firestore read.

### UX
- [ ] Error responses preserve the exact status + body shape the client depends on (so the app surfaces the correct message), asserted on the real response — not just the status code.

### i18n
- [ ] A `roomName` containing RTL (Arabic) and CJK characters is handled consistently: either round-tripped into the token's `room` grant intact, or rejected by the same validation rule — the chosen contract is asserted (no silent corruption).

### Observability
- [ ] Real logging runs **unmocked** during the tests (exercised, not asserted) — the route's `log`/audit calls execute against the real `log` module; the cross-cohort denial's real **audit row IS asserted** on real state.

## BDD Scenarios

**Scenario: a real cohort member receives a correctly-scoped real token**
- **Given** the Firestore emulator holds a room `room-asia-1` with `cohort: "asia"` and a caller whose real auth claims include `cohort: "asia"`, `uniqueId: "u-100"`
- **When** they `POST /api/livekit/token` for `room-asia-1`
- **Then** the route returns a real JWT that decodes to `video.roomJoin=true`, `video.room="room-asia-1"`, `sub="u-100"`, `metadata.cohort="asia"`, signed by the resolved region's real secret

**Scenario: a cross-cohort caller is denied by the real cohort gate**
- **Given** a room `room-eu-1` with `cohort: "eu"` and a caller with `cohort: "asia"`
- **When** they request a token for `room-eu-1`
- **Then** the real route returns 404 (existence-hiding) and a real audit row is written to the audit collection and asserted by reading it back

**Scenario: missing region creds yields a real 503**
- **Given** no LiveKit key/secret is set for the resolved region (and no fallback)
- **When** a valid cohort member requests a token
- **Then** the real route returns 503 (driven by real region resolution, not a mocked throw)

**Scenario: the token is signed by the resolved region's real secret**
- **Given** `LIVEKIT_SECRET_ASIA` and `LIVEKIT_SECRET_EU` differ
- **When** an Asia-room token is minted
- **Then** verifying the JWT with the Asia secret succeeds and with the EU secret fails

## Test Plan

**RED:** rewrite both files to (1) set `NODE_ENV='local'` *before* requiring `src/utils/firebase` per the SHY-0110 helper pattern — **not** a global `npm test` env override ([[feedback-express-suite-no-node-env-override]]); (2) delete the `firebase` / `livekit-server-sdk` / `livekit-region` / `log` mocks; (3) `assertEmulatorReachable()` + seed real Firestore room/user/cohort in `beforeEach`, `clearCollection` in teardown; (4) set deterministic real LiveKit test env (region + fallback key/secret); (5) decode the real JWT (real verify with the region secret) and assert real grants. The files fail until real seeding + real env + real-decode assertions are wired — run them against the live emulator to confirm genuine RED (no silent green; the mocks are provably gone). Produce a clause→test map (every AC clause → ≥1 named test) at RED.

**GREEN:** wire `beforeEach` seeding (clear + seed room/user/cohort), set the real LiveKit test creds, decode + assert real grants, assert the real audit row on cross-cohort denial. Run **canonically** (`npm test` verbatim, no env decoration) → both files green and the full suite green (no regression). Regenerate + commit the shrunk `scripts/no-stubs-baseline.json`.

**Frameworks:** express Jest (real Firestore emulator + real `livekit-server-sdk`); a JWT decode/verify (real verify with the region secret) for token assertions. **Real backend:** Firestore + Auth emulator (real auth claims — minted custom token through the real middleware if a helper exists / is cheap to add; else the auth-realism level is decided with evidence and raised if it's a policy call) + real LiveKit SDK (local crypto). **Gauntlet:** NOT required (no device/web surface; pure express integration) — judgment-merge, gauntlet-exempt per SHY-0109/0110 precedent.

## Out of Scope
- `room-mutations` / `rooms` / seat / presence / voice-service migrations — sibling SHY-0113 slices.
- The actual LiveKit **server** connection / real audio join (client/device concern; this route only mints tokens — local crypto).
- Reproducing SHY-0102 / SHY-0103 (the rule bugs) — a separate Rooms-area slice via the `@firebase/rules-unit-testing` harness (Admin-SDK express tests bypass rules and cannot surface them).
- FCM (this route sends none) — the FCM-in-integration-tests policy is settled at the `rooms.test.js` slice.

## Dependencies
- **SHY-0113** (Rooms/Voice/LiveKit area umbrella) — this is its first just-in-time child slice.
- **SHY-0112** (keystone) — unit↔integration boundary + policy-aware ratchet (merged, live on main).
- **SHY-0109** (emulator-in-CI) + `express-api/tests/helpers/firebase-emulator.js` (the proven migration helper: `assertEmulatorReachable` / `clearCollection` / `clearCollectionGroup`).
- Local stack UP — Firestore/Auth emulator + real LiveKit (confirmed running: Firestore 8080, Auth 9099, LiveKit 7880).

## Risks & Mitigations
- **Risk:** real auth (a custom token minted via the Auth emulator + the real middleware) is net-new infra for express route tests. **Mitigation:** investigate at RED ([[feedback-never-guess-always-investigate]]); if no helper exists and it would balloon scope, decide the auth-realism level on evidence — keep direct `req.auth` injection **only** if it is genuinely harness *input* (not a mocked collaborator) and raise it to the operator if it is a policy call.
- **Risk:** real LiveKit test env (key/secret/region) is not documented in `local/start.sh`. **Mitigation:** the test sets deterministic creds itself — real `AccessToken` accepts any key/secret and the JWT is verified with the same secret, so there is no external dependency.
- **Risk:** removing the `log` mock floods test output or writes externally. **Mitigation:** let it run (exercised-not-asserted per SHY-0113 Observability); redirect to a temp sink if it writes to a real destination.

## Definition of Done
- Both files are double-free (no `firebase` / `livekit-server-sdk` / `livekit-region` / `log` mocks; no `jest.fn` collaborator); the no-stubs baseline is shrunk for both and committed.
- Real Firestore-emulator cohort gate + real LiveKit JWT mint asserted on real values; the cross-cohort real audit row is asserted on real state.
- Canonical `npm test` green (both files + no regression); lint/prettier clean; `node scripts/check-no-new-stubs.js` exit 0 against the shrunk baseline.
- `code-reviewer` (and `security-reviewer`, since token/secret handling is touched) report zero findings.
- CI green by name (Detect Changes / Analyze JavaScript / PR Gate); judgment-merge (gauntlet-exempt) → In Review → Done on the next release cut.

## Notes (running log)
- **2026-06-17 — created (first just-in-time child slice of SHY-0113).** Operator chose the "child SHYs, just-in-time" decomposition + "rules-harness reproduces SHY-0102/0103 (defer fix)". This slice is the smallest safe vertical (one route, no FCM, no RTDB presence → unblocked by the rule bugs); it proves the real-emulator + real-SDK pattern. Grounded in the pickup-fitness map: both files are currently 100% mock-based; the SHY-0110 emulator template (`NODE_ENV=local` before requiring firebase + `assertEmulatorReachable` + `clearCollection` + real seed/assert) is the copy source; LiveKit token mint is local crypto so the real SDK needs no server. Effort M.
