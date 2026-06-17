---
id: SHY-0126
status: In Review
owner: claude
created: 2026-06-17
priority: P1
effort: S
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1472
mvp: true
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
- [~] A live-store lookup failure during the admin re-check **fails closed** (treated as non-admin → 404), never grants the bypass. _NOT real-inducible without a mock — a token that passes `verifyIdToken` implies an existing Auth user, so `auth.getUser` won't throw `user-not-found` at request time (verified against the emulator at pickup). Per the CLAUDE.md escape hatch this is escalated, operator-accepted (2026-06-17 pickup) as a defensive mirror of the already-shipped `requireSameCohort`/`requireAdmin` catch path (same `isLiveAdmin` function); the SAME fail-closed code path (`isLiveAdmin → false → 404 + audit`) is proven for real by the demoted-admin test (live claim absent rather than an outage)._

### Edge cases
- [~] Token `admin: true` but `req.auth.uid` absent → no live check possible → fail-closed (non-admin → 404). _NOT real-inducible — the real auth middleware always sets `req.auth.uid` from `verifyIdToken`, so this guard is unreachable dead-code-by-contract. Escalated, operator-accepted (2026-06-17) as a defensive mirror of `requireSameCohort`'s identical `req?.auth?.uid ? … : false` guard; kept in the route (`livekit.js`) for parity. The fail-closed OUTCOME it protects is covered for real by the demoted-admin test._
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
- **Live admin → 200:** `mintRealUser({ uniqueId, cohort: 'adult', admin: true })` mints a token whose `admin` *developer claim* is `true`, but — verified against the emulator at pickup (2026-06-17) — that does **NOT** populate `getUser().customClaims` (developer claims ≠ persisted customClaims). So a genuinely-live admin additionally needs `auth.setCustomUserClaims(uid, { cohort: 'adult', admin: true })` to write the live store that `isLiveAdmin` reads. Assert 200 cross-cohort + room-cohort metadata + no audit row.
- **Demoted admin → 404 + audit:** mint with `admin: true` (stale token claim), then call `auth.setCustomUserClaims(uid, { cohort: 'adult' })` (real Auth-emulator write — live `admin` absent), then request a cross-cohort token. Assert 404 + opaque body + no token + a polled `segregationEvents` row with the full value shape. This is the genuine RED (the current route trusts the stale token claim → grants 200).
- **Same-cohort not spuriously denied:** a demoted admin requesting a SAME-cohort room still gets 200 (regression guard — the live re-check must only gate the cross-cohort bypass).
- **uid-absent / live-store-outage fail-closed:** NOT inducible through the real auth middleware — a token that passes `verifyIdToken` implies an existing uid (the emulator rejects a deleted user's token with `auth/user-not-found` at the middleware, never reaching the route). Per the CLAUDE.md escape hatch these are NOT mocked; the realistic fail-closed trigger (demotion → live claim absent → `isLiveAdmin` false) is fully covered above, and the `!uid`/catch guards are defensive mirrors of the already-shipped `requireSameCohort` / `requireAdmin` path (same `isLiveAdmin` function). Documented in the test-file header.
- Set `process.env.AUTH_FORCE_LIVE_ADMIN_CHECK = '1'` (scoped to a nested describe's before/afterEach) so `isLiveAdmin` runs its real `auth.getUser` path under Jest (auth.js:297); `clearAuthCaches()` (the file's outer beforeEach) clears `adminClaimCache` per-test.
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
- **2026-06-17 ~18:34 BST — GREEN + pushed → In Review (PR #1472).** RED proven against real services (demoted admin got 200; expected 404). GREEN: live `isLiveAdmin` re-check on the bypass (`livekit.js`). Tests (real, zero doubles): demoted admin → 404 + real `segregationEvents` audit row (full value shape); live admin → 200 + room-cohort metadata + no audit; same-cohort demoted → 200 (no spurious denial); 60s `adminClaimCache` hit (Performance AC). Removed 2 prior admin tests that passed only via the `JEST_WORKER_ID` short-circuit (non-production path); subsumed by the real live-admin test. Canonical `npm test` = **335 suites / 12472 tests** green; eslint/prettier/stub-ratchet (baseline unchanged)/story-validator clean; pre-push full suite + SonarCloud quality gate passed. **code-reviewer: 2 cycles** — cycle 1 (6 findings: C1 stale auth.js comment, C2 short-circuit tests, I1 perf-cache test, I2/M2/M3 clarity) all applied; cycle 2 confirmed cycle-1 resolved, residual = clarity/doc only (I-1 parens not possible — prettier strips them, resolved via precedence comment; I-2 story AC `[~]` escalation annotations; m-2/n-1 comments) all applied. **Remaining:** CI green by name → dev cohort-moderation gauntlet (NOT exempt — production change to a compliance gate) → judgment-merge.
- **2026-06-17 ~18:05 BST — picked up (operator decision via AskUserQuestion):** (1) FIX NOW — interrupt EPIC-0003 for this one bug-fix PR; (2) `mvp: true` (Safety & Compliance) — set; (3) operator-checkpoint: the `firestore.rules` are unchanged (route-only product change), so no rules-deploy checkpoint — the change is gated by the standard pre-merge gauntlet on the age-segregation surface. Story flipped Draft→In Progress.
- **2026-06-17 ~18:05 BST — empirical correction to the Test Plan (never-guess rule).** Probed the real Auth emulator before writing tests: `createCustomToken(uid, {admin:true})` puts `admin` in the ID token but leaves `getUser().customClaims` **undefined** — only `setCustomUserClaims` writes the store `isLiveAdmin` reads. So the original Test-Plan claim ("mintRealUser already sets live customClaims") was wrong; the live-admin test now calls `setCustomUserClaims(uid,{admin:true})` explicitly. Also confirmed the emulator's `verifyIdToken` rejects a deleted user (`auth/user-not-found`), so the live-store-outage catch branch is not real-inducible → escalate-not-mock (covered behaviourally by the demoted-admin case).
- **2026-06-17 — filed from SHY-0125 `code-reviewer` finding C2.** The LiveKit token route's admin cohort-bypass trusts only the decoded `req.auth.token.admin` claim, omitting the live `isLiveAdmin` re-verification that `requireSameCohort` applies — a demoted admin retains cross-cohort LiveKit-grant access until their ID token refreshes (~1h, NOT the 24h the reviewer cited; the 24h is the minted LiveKit JWT TTL, a different token). Deliberately NOT bundled into SHY-0125 (one-PR-one-story; SHY-0125 is a gauntlet-exempt test migration, this is a production change to a compliance gate that needs its own gauntlet). **Operator decisions needed at pickup:** (1) fix now vs. after EPIC-0003 (sole-focus tension); (2) MVP classification (`mvp:` — plausibly Safety & Compliance MVP; left `false` pending operator triage per the operator-directed MVP-flag process); (3) confirm whether the age-segregation surface change warrants an operator checkpoint.
