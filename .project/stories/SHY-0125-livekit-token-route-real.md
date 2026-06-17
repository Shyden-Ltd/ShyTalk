---
id: SHY-0125
status: In Review
owner: claude
created: 2026-06-17
priority: P0
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1469
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
- **Given** the Firestore emulator holds a room `room-adult-1` with `cohort: "adult"` (age-segregation cohort — orthogonal to LiveKit region) and a caller whose real Firebase ID token carries `cohort: "adult"` and resolves to `uniqueId: 60000001` via a seeded `users` doc
- **When** they `POST /api/livekit/token` for `room-adult-1`
- **Then** the route returns a real JWT that decodes to `video.roomJoin=true`, `video.room="room-adult-1"`, `sub="60000001"`, `metadata` parsing to `{ cohort: "adult" }`, signed by the resolved region's real secret (asia by default)

**Scenario: a cross-cohort caller is denied by the real cohort gate**
- **Given** a room `room-minor-1` with `cohort: "minor"` and a caller whose real token carries `cohort: "adult"`
- **When** they request a token for `room-minor-1`
- **Then** the real route returns 404 (existence-hiding, byte-identical to the room-missing 404) and a real `segregationEvents` row is written (`sourceCohort: "adult"`, `targetCohort: "minor"`, `targetRoomId`, `surface: "/api/livekit/token"`, `action: "blocked"`) and asserted by polling the real collection

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
- **Risk:** real auth (a custom token minted via the Auth emulator + the real middleware) was net-new infra for express route tests. **Resolved:** the operator directed **real auth now and in the future** ([[feedback-real-auth-in-integration-tests]]); a reusable `express-api/tests/helpers/real-auth.js` was built (`mintRealUser` seeds a real `users` doc + mints a real ID token via `createCustomToken` → Auth-emulator `signInWithCustomToken` exchange; `mintTokenWithoutUserDoc`; `clearAuthCaches`). The real `authMiddleware` sits ahead of the router; **no `req.auth` injection, no `synthetic:` tokens** anywhere in these tests. The cohort/admin claims ride on the real token; `uniqueId` resolves from the seeded Firestore doc.
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
- **2026-06-17 — design corrections during RED.** (A) Conflated cohort (adult/minor — age segregation) with region (asia/eu — LiveKit routing); they are orthogonal axes. Room cohort = `cohortOverride || cohort` via `effectiveCohort` (allow-list {adult,minor}, fail-closed minor); region = `cf-ipcountry` header via `getRegion`. Corrected the BDD examples above. (B) Real-auth obligation: operator "yes i want real now and in the future" → built `tests/helpers/real-auth.js`; the auth-deferral risk language is removed (see Risks).
- **2026-06-17 — GREEN (both files migrated, real services, zero doubles).** Commits `710f8ccd645` (pickup + decompose), `ba8fab4522d` (livekit.test.js → real Firestore + real SDK), `b8d812c1d7c` (real auth wired + reusable real-auth.js helper). `livekit.test.js` 21/21 green; `livekit-cohort.test.js` 23/23 green (real auth + real cohort gate + real `segregationEvents` row polled back); NEW `tests/unit/livekit-region.test.js` 28/28 (pure url/region/fallback value matrix — unit location, no double, ratchet-exempt). **Un-inducible-error decisions (escalate-not-mock, per CLAUDE.md escape hatch):** the route's catch-all 500, the cross-cohort audit-write-failure path, and the room-lookup-throw 500 cannot be triggered against the real emulator without re-introducing a double (real `toJwt` does not throw on a short secret; the emulator does not reject the route-built audit doc; the dev logger is a no-op counter) — left as defensive code with no faked test; the behavioural guarantee (cross-cohort always returns the same opaque 404 regardless of the fire-and-forget audit outcome) is structural and covered by the opaque-404 + audit-row tests.
- **Clause → test map (AC clause → named test):**
  - Happy/grants/identity → livekit.test.js `mints a real token a real cohort member can verify`, `uses the authed uniqueId as identity…`; livekit-cohort.test.js `200 + verifiable token when caller and room are both adult` / `… both minor`.
  - metadata.cohort → livekit.test.js `stamps the room cohort onto the token metadata`; livekit-cohort.test.js `JWT metadata carries the room cohort (adult)` / `(minor)`, `JWT metadata is a JSON string parsing to { cohort }`, `minted token carries BOTH the cohort metadata AND the room-join grant`.
  - Region value matrix → livekit-region.test.js `getRegion …` (country→region) + `getRegionConfig …` (per-region url/key/secret, fallback, per-field independence, unknown-region→asia, all-undefined); region SELECTION via signature → livekit.test.js `default region is asia…`, `an EU CF-IPCountry header routes to the eu secret`, `falls back to the global secret…`.
  - 503 creds → livekit.test.js `503 when the resolved region has no credentials`, `503 when only the api key is missing`.
  - 400/403/404 → livekit.test.js `400 when roomName missing` / `…non-string`, `403 when the caller has no profile…`, `403 when the caller is suspended…`, `401 when no Authorization header` / `…invalid token`, `404 (opaque) when roomName fails the charset pattern`, `404 when the room does not exist`.
  - Cross-cohort + audit (Edge/Security/Observability) → livekit-cohort.test.js `404 (opaque) when an adult caller targets a minor room` / `… minor caller targets an adult room`, `cross-cohort attempt writes a real segregationEvents row with the full value shape`, `cross-cohort 404 body is byte-identical to the room-missing 404`, `cohort gate fires BEFORE the credentials check — … 404, not 503`, `cross-cohort denial returns no token`.
  - Admin bypass → livekit-cohort.test.js `admin caller bypasses the gate (200…) and writes no audit row`, `admin-bypass token metadata follows the ROOM cohort…`.
  - Fail-closed value matrix → livekit-cohort.test.js `room without a cohort field defaults to minor — adult blocked` / `… minor allowed`, `a missing cohort claim is treated as minor…`, `an invalid cohort claim is treated as minor…`, `cohortOverride:minor wins…`, `cohortOverride:adult wins…`.
  - Precedence (UX/ordering) → livekit-cohort.test.js `roomName-missing 400 wins over the cohort gate…`, `malformed roomName → opaque 404 before the cohort gate (no audit row)`.
  - Security (no secret leak) → livekit.test.js `never leaks the signing secret in the response body or token payload`.
  - i18n → livekit.test.js `rejects an RTL/CJK roomName via the charset pattern (404)`.
  - Performance → livekit.test.js `mints within the local-emulator budget`.
- **2026-06-17 — `code-reviewer` cycle 1 (against commit `bfb550b1724`).** Findings applied: **I4 (cross-file emulator isolation — the important one):** the emulator is a single shared backend (jest maxWorkers:2); `livekit.test.js` + `livekit-cohort.test.js` both whole-collection-cleared ROOMS/USERS → reproduced a real parallel-run flake (2/4 runs failed: suspended-user test got "User profile not found" because the sibling's `clearCollection(USERS)` wiped the seeded user mid-test). FIXED by removing the ROOMS/USERS whole-collection clears and relying on globally-unique deterministic IDs (idempotent `set()`; disjoint ranges 5xxxx/9xxxx/7xxxx vs 60000xxx); kept only the SEG_EVENTS clear (non-idempotent `.add()`, single-file, races nothing). 6/6 parallel runs now green. **C3:** added the symmetric `!apiSecret`-only 503 test (only `!apiKey` was isolated). **I2:** added the EU per-field-independence region unit test (asia had one). **I1:** aligned the perf bound — added a comment that 2000ms is a coarse CI-safe upper bound (real auth adds verifyIdToken + ~3 Firestore round-trips; sub-500ms flakes under CI). **I3:** documented why `expectNoSegregationEvent` is race-safe without a wait (allow path never schedules a write). Re-verified: canonical `npm test` 335 suites / 12470 tests green; eslint/prettier clean; ratchet exit 0. **C2 (production security finding — NOT fixed here):** the LiveKit route's admin cohort-bypass trusts only `req.auth.token.admin` without the live `isLiveAdmin` re-check that `requireSameCohort` applies (a demoted admin keeps cross-cohort grant for ~1h until ID-token refresh). Filed as **SHY-0126** (bug, P1) — deliberately NOT bundled (one-PR-one-story; SHY-0125 is a gauntlet-exempt test migration, C2 is a production change to a compliance gate needing its own gauntlet). Flagged to the operator for fix-now-vs-after-EPIC-0003 + MVP/priority triage.
