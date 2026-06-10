---
id: SHY-0021
status: In Progress
owner: claude
created: 2026-06-07
priority: P0
effort: S
type: infra
roadmap_ids: [G021]
pr:
---

# SHY-0021: cron-account-deletion endpoint integration test (auth coverage)

## User Story

As the ShyTalk operator, I want **the `/api/system/sweep-account-deletions` endpoint to have an integration test covering the three canonical auth paths (no-auth → 401, wrong-secret → 401, correct-secret → 200)**, so that a future change to the auth middleware can never silently expose this account-deletion endpoint to unauthenticated callers.

## Why

`/api/system/sweep-account-deletions` is the cron-triggered endpoint that performs scheduled account-deletion sweeps (the only remaining server-side cron after the cron-elim cluster closed 2026-06-04/05). It is invoked by `.github/workflows/cron-account-deletion.yml:48` with a shared-secret header.

**The endpoint currently has NO integration test for auth.** This means:

- A future refactor to the auth middleware could allow no-auth requests through and we wouldn't notice.
- A typo in the secret-comparison logic (e.g. switching from constant-time to simple `===`) wouldn't be caught.
- A regression that returns 200 instead of 401 on wrong-secret would expose the endpoint to any HTTP caller.

Account deletion is **irreversible** — accidentally exposing this endpoint would allow an attacker to mass-delete arbitrary accounts.

Roadmap row G021 (line 81 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Category: CI — cron-account-deletion endpoint auth untested. Location: `.github/workflows/cron-account-deletion.yml:48` + `express-api/src/routes/...`. Gap: `/api/system/sweep-account-deletions` lacks integration test for no-auth/wrong-secret/correct-secret. Fix: Add route test covering 401/401/200 paths. Scope: S.

Bumped to Tier 1 P0 under SHY-0032 because:

1. The endpoint performs irreversible actions on user data.
2. Server-side auth coverage gaps are the textbook IDOR-class vulnerability.
3. Pre-public-release window is the cheap time to add the safety net.
4. The cron workflow itself is the only remaining cron; its security posture matters disproportionately.

## Acceptance Criteria

### Happy path

- [ ] A new test file `express-api/tests/routes/cron-account-deletion.test.js` exercises the endpoint via the existing Express test harness (likely supertest or equivalent).
- [ ] Test case A: **no Authorization header** → HTTP 401 `{error: "Missing bearer token"}` (actual middleware body, system-auth.js — verified 2026-06-10; bodies do not leak the secret or schema).
- [ ] Test case B: **wrong shared-secret header** → HTTP 401 `{error: "Invalid bearer token"}` (distinct from case A by design in the current middleware — reveals only Bearer-prefix parseability, not secret correctness; acceptable, documented).
- [ ] Test case D: **SYSTEM_SHARED_SECRET env missing** → HTTP 503 `{error: "System authentication not configured"}` (fail-closed, never fail-open).
- [ ] Test case C: **correct shared-secret header** → endpoint returns HTTP 200 with a body confirming sweep ran (e.g. `{ status: 'ok' }`).
- [ ] Test case C uses a mock/stub for the Firestore Admin SDK call (no real deletions in the test).
- [ ] All three tests pass via `cd express-api && npm test -- cron-account-deletion`.
- [ ] The test file is referenced from the existing `npm test` script (automatic via the test pattern).
- [ ] The test file uses the same harness/fixtures as sibling route tests in `express-api/tests/routes/` (consistent style).
- [ ] CI workflow `.github/workflows/express-api-tests.yml` (or equivalent) executes the new tests.

### Error paths

- [ ] **Malformed Authorization header** (e.g. `Bearer ` with no token, `Bearer foo bar baz` with extra spaces) → returns 401 (covered as a parameterized variant of test case B).
- [ ] **Authorization header with correct prefix but empty secret** (`Bearer `) → returns 401 (covered).
- [ ] **Authorization header with extremely long secret** (10 KB) → returns 401 without timing-out or crashing (covered as an edge case).
- [ ] **Authorization header with the correct secret but a different scheme** (`Basic <correct-secret>` instead of `Bearer <correct-secret>`) → returns 401.
- [ ] **Server-side sweep throws** (e.g. Firestore unreachable mid-sweep) → returns 500 with a generic error body (no stack trace leakage); the cron retries on the next schedule.
- [ ] If the shared-secret env var is missing entirely from the test environment, the test setup fails-loudly with a clear error rather than passing accidentally.

### Edge cases

- [ ] **Constant-time comparison**: the secret comparison must use `crypto.timingSafeEqual` (or equivalent), not `===`. Verified by:
  - Reading the route handler source.
  - A separate unit test that exercises two distinct wrong-secrets and asserts response times are within ±10ms of each other (best-effort timing-side-channel check; informational, not a strict assertion).
- [ ] **Concurrent requests**: 10 simultaneous correct-secret requests — exactly ONE returns 200, the rest 409 (serialized via the handler's `inFlight` guard, system.js:85-91). Teardown calls `_resetInFlightForTesting()` so state never leaks between tests.
- [ ] **Replay attack**: a captured correct-secret request CAN be replayed (no nonce in the protocol); document in the test file as a known limitation. Mitigation: short-lived secret rotation policy (out of scope).
- [ ] **Cron-only invocation** (no public exposure): the route should ideally be on a `/api/system/*` path that's mounted only when invoked from a known IP range OR the workflow's runner. Verify the route registration in `express-api/src/server.js` (or equivalent) and document the trust model.

### Performance

- [x] Per-test latency: environment-bound; the contractual bound is jest.config testTimeout (10s). Observed warm-runner suite total ~1.4s for 13 tests (2026-06-10).
- [x] Suite budget: ≤10s on a warm runner — accounts for the concurrency test's deterministic settle-wait (bounded 8s worst-case); the original 5s claim contradicted that design and was corrected at review.
- [ ] No test-environment leakage: tests don't touch real Firestore even in error cases.

### Security

- [ ] The shared-secret env var name is the same name the cron workflow uses (cross-check `.github/workflows/cron-account-deletion.yml:48` vs the route handler's env var read). A drift would mean the workflow sends one secret while the route validates another — both halves working but together broken.
- [ ] No test logs the actual secret value to console (use environment variable indirection: `process.env.SYSTEM_SHARED_SECRET` in test; never inline literal).
- [ ] No test fixture commits the production secret to git (use a test-only synthetic secret).
- [ ] Response bodies on 401 never include the expected or attempted secret (asserted). Body uniformity across 401 variants is NOT current behaviour (two distinct messages) — accepted; only prefix-parseability is revealed.
- [ ] Response bodies on 200 don't leak personally-identifiable info about deleted accounts (no user IDs, emails — only counts).
- [ ] The test exercises the rate-limiting behaviour IF the route has rate-limiting middleware; documents if not.

### UX

- [ ] N/A — server-side cron endpoint; no user-facing UX.

### i18n

- [ ] N/A — server-side response bodies are JSON; no localized text.

### Observability

- [ ] Error-path logging asserted: when the sweep throws, the handler's existing `log.error` fires (spy assertion) and the response is 500 with a generic body.
- [ ] Per-invocation INFO/WARN auth-result logging + requester-IP + structured `sweep_run` counts: **Out of Scope — the handler has no such logging today** (architect-verified 2026-06-10). Deferred to the reserved system-routes observability story in SHY-INDEX (with the `{swept,errors}` count-plumbing it depends on).
- [ ] Sonar coverage on the route handler ≥90% (small surface, easy to cover).
- [ ] The cron workflow's job summary (in `.github/workflows/cron-account-deletion.yml`) annotates the run with the sweep counts.

## BDD Scenarios

**Scenario: No Authorization header → 401**

- **Given** the Express API is running with the cron-account-deletion route mounted
- **When** a POST to `/api/system/sweep-account-deletions` is sent with no Authorization header
- **Then** the response status is 401
- **And** the response body is `{"error": "Missing bearer token"}`
- **And** the response time is within p99 budget

**Scenario: Wrong shared-secret → 401**

- **Given** the route is configured with a known shared secret
- **When** a POST is sent with header `Authorization: Bearer wrong-secret-value`
- **Then** the response status is 401
- **And** the response body is `{"error": "Invalid bearer token"}` — distinct from the no-auth case BY DESIGN (reveals Bearer-prefix parseability only, never secret correctness)

**Scenario: Correct shared-secret → 200 + sweep runs**

- **Given** the Firestore Admin SDK is mocked to report 3 accounts ready for deletion
- **And** the route is configured with secret `test-secret-abc`
- **When** a POST is sent with header `Authorization: Bearer test-secret-abc`
- **Then** the response status is 200
- **And** the response body is `{"status": "ok"}`
- **And** the mocked accountDeletion() sweep function was invoked exactly once

**Scenario: Malformed header → 401**

- **Given** the route is mounted
- **When** a POST is sent with header `Authorization: Bearer ` (empty secret)
- **Then** the response status is 401

**Scenario: Constant-time comparison (timing side-channel check)**

- **Given** the route is mounted
- **When** 100 POST requests are sent alternating two distinct wrong secrets (one prefix-matching the correct secret, one totally different)
- **Then** the average response time for both wrong secrets is within ±10ms
- **And** (informational, not strict) — no detectable timing pattern reveals which prefix was closer

**Scenario: Workflow secret name matches route env var**

- **Given** `.github/workflows/cron-account-deletion.yml:48` references `${{ secrets.SYSTEM_SHARED_SECRET }}`
- **When** the route handler is grep'd for `process.env.<NAME>`
- **Then** the env var name read by the handler matches the workflow's secret name exactly

**Scenario: Sweep handler error returns 500 not 200**

- **Given** the Firestore Admin SDK mock throws on delete (simulating network outage)
- **When** a POST with the correct secret is sent
- **Then** the response status is 500
- **And** the response body is a generic error (no stack trace, no Firestore-internal message)
- **And** the logger captured the underlying error at ERROR level

## Test Plan (TDD)

### Red

1. Add `express-api/tests/routes/cron-account-deletion.test.js`:
   - 3 primary test cases (401, 401, 200).
   - 4 additional error-path cases (malformed, empty, long, basic-instead-of-bearer).
   - 1 edge-case for sweep-handler-error → 500.
   - 1 informational test for timing side-channel.
   - 1 env-var-name match assertion against the workflow YAML.
2. Run `cd express-api && npm test -- cron-account-deletion` → RED on most tests (test file references a route handler that may not exist yet, or the handler returns different status codes).

### Green

1. Read the existing route handler in `express-api/src/routes/system/` (or wherever it lives — locate via `grep -rn "sweep-account-deletions" express-api/src/`).
2. If the handler exists but lacks the auth middleware → add it.
3. If the handler doesn't exist (the workflow calls a nonexistent endpoint!) → add it with the proper auth + sweep logic.
4. Iterate until all tests GREEN.
5. Run prettier on the new test file: `cd express-api && npx prettier --write tests/routes/cron-account-deletion.test.js`.
6. Run full `cd express-api && npm test` to verify no regressions in sibling route tests.

## Out of Scope

- **Refactoring the cron workflow** itself — only adding the route test.
- **Implementing secret rotation** — out of scope (operator-side process).
- **Migrating from shared-secret auth to a stronger mechanism** (e.g. JWT or mTLS) — separate SHY.
- **Adding rate-limiting middleware** — only documenting whether present; not adding.
- **End-to-end test that triggers the workflow** — only the route handler; the workflow itself is covered by manual smoke + existing workflow lint.
- **Refactoring the account-deletion logic** — only auth coverage; the deletion semantics stay unchanged.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- `express-api/src/routes/system/...` — the route handler (verify location).
- `express-api/tests/` test harness — existing sibling tests are the style template.
- `.github/workflows/cron-account-deletion.yml` — must reference the matching env var name.
- Firebase Admin SDK mock — likely already used by sibling tests.

## Risks & Mitigations

- **Risk:** The route handler doesn't exist or lives in a different file path. **Mitigation:** grep at PR-start; if missing, file as a Critical reviewer finding + add the handler in this PR (scope creep but justified by Tier-1 priority).
- **Risk:** The Express test harness doesn't support env-var injection cleanly. **Mitigation:** use `dotenv` or direct `process.env` mutation in `beforeAll`; sibling tests likely show the pattern.
- **Risk:** The timing-side-channel test is flaky on shared CI runners. **Mitigation:** marked as informational; doesn't fail the build; logged with the measured delta for ops visibility.
- **Risk:** Adding the test causes a regression in another route's test because of shared state. **Mitigation:** test isolation per [[feedback-test-isolation-no-leaks]] — each test sets up + tears down its own env-var + mock.
- **Risk:** The cron workflow's secret name doesn't match what we expect (different env-var name); the matching test fails. **Mitigation:** GOOD outcome — fix the drift in this PR (update either the workflow or the route handler to align).

## Definition of Done

- [ ] `express-api/tests/routes/cron-account-deletion.test.js` exists.
- [ ] All 401/401/200 cases pass.
- [ ] All error-path cases pass.
- [ ] Constant-time comparison verified by reading system-auth.js (HMAC-of-HMAC + timingSafeEqual — already present); the ±10ms timing scenario is INFORMATIONAL ONLY, never a CI assertion.
- [ ] Env-var name cross-check passes.
- [ ] Sonar coverage on route handler ≥90%.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`infra` → auto-merge once green per CLAUDE.md lifecycle rules; server-side test addition has no user-visible behaviour change).
- [ ] PR merged via auto-merge.
- [ ] `status: Done`; `pr:` populated; coverage delta logged in Notes.

## Notes (running log)

- 2026-06-10 ~04:05 BST — **Reviewer cycle 1 (feature-dev:code-reviewer): 0 Critical, 5 Important, all applied.** (1) stale BDD 401-body literals fixed to actual middleware bodies; (2) redundant afterEach clearAllMocks removed (jest.config clearMocks:true already handles call-counts; beforeEach mockReset+default documented as the implementation contract); (3) concurrency settle-wait hardened to 5ms×1600 (8s budget vs 10s testTimeout); (4) startup fail-loud guard added for NODE_ENV≠test (missing _resetInFlightForTesting would otherwise poison every afterEach with a misleading TypeError); (5) Performance AC corrected — original 5s suite budget contradicted the concurrency design. Reviewer verified clean: empty-Bearer branch routing, serverHealth mock non-bleed, workflow-contract path resolution, env teardown, factory-mock reset indirection.

- 2026-06-10 ~03:35 BST — **Architect verdict: APPROVE-WITH-CHANGES** (4 blocking + 2 advisory, all applied; key claims spot-verified against code). Spec was authored 2026-06-07 and the code evolved past it: auth extracted to middleware/system-auth.js (SYSTEM_SHARED_SECRET + HMAC timingSafeEqual, 11 unit tests already exist) — story premise narrowed to the REAL remaining gap: route-level integration (mounted route + middleware wiring + sweep mock + inFlight 409 + 503 fail-closed). 200 body corrected to `{status:'ok'}` (Path A; count-plumbing deferred); 401 bodies corrected to actual two-variant shapes; observability logging AC deferred (no such logging exists — reserved follow-up row added to SHY-INDEX); concurrency AC corrected to 1×200 + 9×409 with `_resetInFlightForTesting()` teardown. Canonical pattern: tests/routes/admin-account-deletion.test.js. Story flipped Draft → In Progress.

- 2026-06-07 ~20:44 BST — Refined under SHY-0032. Bumped P1 → P0 (account-deletion is irreversible; auth coverage is Tier 1).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-G4` (roadmap_ids: G021).
