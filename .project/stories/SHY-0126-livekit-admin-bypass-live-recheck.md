---
id: SHY-0126
status: Draft
owner: claude
created: 2026-06-17
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
mvp: false
---

# SHY-0126: LiveKit token-route admin bypass trusts a stale token claim — no live admin re-verification (cohort-segregation gap)

## User Story

**As** the platform's age-segregation safety system (UK OSA #17),
**I want** the LiveKit token route's admin cohort-bypass to re-verify the caller is **currently** an admin (live customClaims), not just trust the decoded ID-token `admin` claim,
**So that** a **demoted** admin cannot keep minting cross-cohort LiveKit grants (e.g. an adult joining a minor voice room) during the window between demotion and their ID token's natural refresh.

## Why

`requireSameCohort` (the user-to-user gate, `express-api/src/middleware/sameCohort.js:87-90`) defends against stale admin claims with a **two-layer** check: the fast token claim AND a live `isLiveAdmin(uid)` re-fetch of customClaims (60s TTL cache, fail-closed). The LiveKit token route (`express-api/src/routes/livekit.js:82`) does **only** the fast check: `const adminClaim = req?.auth?.token?.admin === true;`. Its own comment claims it "Mirrors `requireSameCohort`'s bypass" — but it does **not** mirror the live re-verification.

**Impact:** Firebase ID tokens carry custom claims until natural refresh (~1h). A user demoted from admin (claim removed in the live store) keeps `admin: true` in their already-issued ID token for up to that window. During it, they can call `POST /api/livekit/token` for a **wrong-cohort** room and the route grants the bypass — obtaining a participant grant to a room of the other cohort. On the age-segregation surface (adult ↔ minor) this is a real safety/compliance gap, even though the window is narrow and requires the caller to already know a wrong-cohort roomId. Surfaced by the SHY-0125 `code-reviewer` pass (finding C2). This is a **pre-existing production bug**, independent of the SHY-0125 test migration.

## Acceptance Criteria

### Happy path
- [ ] A **currently-live** admin (token `admin: true` AND live customClaims `admin: true`) requesting a token for a cross-cohort room still receives **200** + a valid token — moderation entry is preserved.

### Error paths
- [ ] A **demoted** admin (token `admin: true` but live customClaims no longer admin) requesting a cross-cohort token receives **404** `{ error: 'Not found' }` — treated exactly as a non-admin cross-cohort caller (existence-hiding preserved).
- [ ] A live-store lookup failure during the admin re-check **fails closed** (treated as non-admin → 404), never grants the bypass.

### Edge cases
- [ ] Token `admin: true` but `req.auth.uid` absent → no live check possible → fail-closed (non-admin → 404).
- [ ] A non-admin caller is unaffected (same-cohort 200 / cross-cohort 404 as today).
- [ ] A live admin crossing into a room whose cohort matches their own claim is still 200 (no spurious denial).

### Performance
- [ ] The live re-check runs **only** on the admin-claim path (zero added cost for normal callers) and is served by the existing 60s `adminClaimCache` — no new uncached Firestore round-trip on the hot non-admin path.

### Security
- [ ] A stale token `admin` claim **alone** can no longer bypass the LiveKit cohort gate — the live store is authoritative, matching `requireSameCohort`'s contract.
- [ ] No new existence side-channel: the demoted-admin denial is byte-identical to every other cross-cohort 404.

### UX
- [ ] Live admins observe no behaviour change (still 200). Demoted admins receive the same opaque 404 as any cross-cohort caller — no message reveals "you were demoted" or "the room exists".

### i18n
- N/A — server-side gate; no user-facing strings introduced.

### Observability
- [ ] A demoted-admin cross-cohort attempt now writes a `segregationEvents` audit row (it is treated as a non-admin gate hit) with `surface: '/api/livekit/token'`, `action: 'blocked'` — so moderators can see post-demotion probing.

## BDD Scenarios

**Scenario: a currently-live admin keeps cross-cohort moderation entry**
- **Given** a caller whose real ID token carries `admin: true` AND whose live Firebase customClaims still carry `admin: true`, and a `minor` room
- **When** they `POST /api/livekit/token` for that room
- **Then** the route returns 200 with a valid token and writes no audit row

**Scenario: a demoted admin is denied with an opaque 404 + audit**
- **Given** a caller whose real ID token still carries `admin: true` but whose live customClaims have had `admin` removed, and a `minor` room while the caller's claim cohort is `adult`
- **When** they request a token for that room
- **Then** the route returns 404 `{ error: 'Not found' }` and a real `segregationEvents` row is written (`action: 'blocked'`, `surface: '/api/livekit/token'`)

**Scenario: a live-store outage fails closed**
- **Given** an admin-claim caller and a live-admin lookup that errors
- **When** they request a cross-cohort token
- **Then** the route fails closed (404), never granting the bypass

## Test Plan

**RED (real services, no doubles):** add tests to `express-api/tests/routes/livekit-cohort.test.js` (already real-auth + real-emulator under EPIC-0003 / SHY-0125). Induce the conditions for real — NO mock of `auth.getUser`:
- Set `process.env.AUTH_FORCE_LIVE_ADMIN_CHECK = '1'` for these cases so `isLiveAdmin` runs its real `auth.getUser` path under Jest (per `auth.js:297`); clear `clearAdminClaimCache()` (already in `clearAuthCaches`) per-test.
- **Live admin → 200:** `mintRealUser({ uniqueId, cohort: 'adult', admin: true })` already mints the token AND sets live customClaims `admin: true` (via `createCustomToken` claims → the real Auth emulator user). Assert 200 cross-cohort.
- **Demoted admin → 404 + audit:** mint with `admin: true` (stale token claim), then call `auth.setCustomUserClaims(uid, { cohort: 'adult' })` (real Auth-emulator write removing the live `admin` claim), then request a cross-cohort token. Assert 404 + a polled `segregationEvents` row.
- **uid-absent / outage fail-closed:** exercise the `!uid` and catch branches via the real emulator where possible; if an outage cannot be induced for real, escalate per the CLAUDE.md escape hatch (do not mock).
Tests fail against the current route (which never calls `isLiveAdmin`) — genuine RED.

**GREEN:** in `express-api/src/routes/livekit.js`, import `isLiveAdmin` from `../middleware/auth` and gate the bypass on the live check, mirroring `requireSameCohort`:
```
const adminClaim = req?.auth?.token?.admin === true;
const liveAdmin = adminClaim && req.auth.uid ? await isLiveAdmin(req.auth.uid) : false;
if (!liveAdmin && callerCohort !== roomCohort) { /* audit + 404 */ }
```
Run canonical `npm test` (verbatim) — both livekit files + full suite green. eslint/prettier clean; `node scripts/check-no-new-stubs.js` exit 0.

**Frameworks:** express Jest (real Firestore + real Auth emulator + real `isLiveAdmin` via `AUTH_FORCE_LIVE_ADMIN_CHECK`). **Gauntlet:** this is a production-code change to a compliance-critical gate — NOT `*.md`-only-exempt. Run the relevant cohort-segregation moderation journey (admin dial-in into a wrong-cohort room) on the gauntlet before merge; the `firestore.rules` are unchanged (no rules-deploy checkpoint needed), but the change touches the age-segregation enforcement surface — flag at pickup whether an operator checkpoint applies.

## Out of Scope
- The user-to-user `requireSameCohort` gate — already correct (this story brings the LiveKit route up to parity).
- Other admin routes — audit them for the same fast-only pattern is a follow-up if any are found; this story fixes the LiveKit token route specifically.
- Shortening the ID-token claim refresh window / forcing token revocation on demotion — a broader auth-lifecycle concern, not this gate.

## Dependencies
- `isLiveAdmin` + `clearAdminClaimCache` (`express-api/src/middleware/auth.js`) — exist and exported.
- `express-api/tests/helpers/real-auth.js` (`mintRealUser` / `clearAuthCaches`) + the real-emulator stack (SHY-0125 / SHY-0109).
- `AUTH_FORCE_LIVE_ADMIN_CHECK` env switch (auth.js:297) to run the real live path under Jest.

## Risks & Mitigations
- **Risk:** the extra `isLiveAdmin` call adds a Firestore/Auth round-trip on the admin path. **Mitigation:** it is cached (60s `adminClaimCache`) and fires ONLY when the token already carries `admin: true` — normal callers pay nothing.
- **Risk:** EPIC-0003 is the operator-declared sole focus; this is a non-test product fix. **Mitigation:** filed as a tracked story (not silently deferred); the operator decides fix-now vs. after EPIC-0003 and the MVP/priority classification (see Notes).
- **Risk:** behaviour change could break a legitimate admin moderation flow if the live store lags. **Mitigation:** the 60s cache + fail-closed-on-error matches the proven `requireSameCohort` contract already shipped on the user-to-user gate.

## Definition of Done
- The LiveKit route bypass requires a LIVE admin; a demoted admin gets the opaque 404 + audit row; live admins keep 200.
- RED→GREEN with real-services tests (no `auth.getUser` mock); canonical `npm test` green (no regression); lint/prettier clean; ratchet exit 0.
- `code-reviewer` + security review zero findings; the relevant moderation-cohort gauntlet journey green.
- CI green by name (Detect Changes / Analyze JavaScript / PR Gate); judgment-merge → In Review → Done on release cut.

## Notes (running log)
- **2026-06-17 — filed from SHY-0125 `code-reviewer` finding C2.** The LiveKit token route's admin cohort-bypass trusts only the decoded `req.auth.token.admin` claim, omitting the live `isLiveAdmin` re-verification that `requireSameCohort` applies — a demoted admin retains cross-cohort LiveKit-grant access until their ID token refreshes (~1h, NOT the 24h the reviewer cited; the 24h is the minted LiveKit JWT TTL, a different token). Deliberately NOT bundled into SHY-0125 (one-PR-one-story; SHY-0125 is a gauntlet-exempt test migration, this is a production change to a compliance gate that needs its own gauntlet). **Operator decisions needed at pickup:** (1) fix now vs. after EPIC-0003 (sole-focus tension); (2) MVP classification (`mvp:` — plausibly Safety & Compliance MVP; left `false` pending operator triage per the operator-directed MVP-flag process); (3) confirm whether the age-segregation surface change warrants an operator checkpoint.
