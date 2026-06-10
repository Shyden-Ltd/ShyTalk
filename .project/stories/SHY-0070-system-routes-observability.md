---
id: SHY-0070
status: Draft
owner: claude
created: 2026-06-10
priority: P2
effort: S
type: feature
roadmap_ids: []
pr:
---

# SHY-0070: System-routes observability — structured sweep logging + count plumbing

## User Story

As the ShyTalk operator, I want every invocation of the system sweep endpoints to produce structured logs (auth outcome, sweep counts, duration) and the sweep response to carry `{swept, errors}` counts, so that I can audit the irreversible account-deletion sweep from logs alone and the cron workflow's job summary can show what each run actually did.

## Why

Deferred from SHY-0021 (architect, 2026-06-10): the spec's observability AC assumed per-invocation logging and a `{swept: N, errors: M}` response body that the handler doesn't have — `createSweepHandler` logs only on error and returns `{status: 'ok'}`, and `accountDeletion()` returns void so no counts exist to surface. For an endpoint that irreversibly deletes accounts, "it returned ok" is thin audit material: a sweep that quietly deletes 0 accounts for a month (e.g. a broken Firestore query) is indistinguishable from a healthy one.

## Acceptance Criteria

### Happy path
- [ ] `accountDeletion()` (express-api/src/cron/accountDeletion.js) returns `{swept: N, errors: M}` — counting successful deletions and per-account failures it already iterates over internally.
- [ ] `createSweepHandler` (express-api/src/routes/system.js) propagates the sweep function's counts into the 200 body: `{status: 'ok', swept: N, errors: M}` (additive — `status: 'ok'` stays for the cron workflow's existing success check; verify the workflow greps nothing stricter first).
- [ ] On success, the handler logs INFO with structured fields `{event: 'sweep_run', name, swept, errors, duration_ms}`.
- [ ] Auth failures log WARN with requester IP (`req.ip`) and the failure variant (missing/invalid bearer) — NEVER any part of the attempted or expected secret (middleware change: express-api/src/middleware/system-auth.js).
- [ ] `.github/workflows/cron-account-deletion.yml` job summary renders the sweep counts from the response body.

### Error paths
- [ ] Sweep throws mid-iteration: counts accumulated so far are included in the error log (`{event: 'sweep_run_failed', swept_before_error, error}`); the 500 body stays the generic `{error: 'sweep failed'}` (no internals leak).
- [ ] A sweep function that returns void/undefined (future sweep endpoints not yet migrated): handler treats counts as absent and omits them from body + log rather than emitting `undefined` (backwards-compatible factory).

### Edge cases
- [ ] Zero-eligible-accounts run: `{swept: 0, errors: 0}` — explicitly distinguishable from the old bare `{status:'ok'}` (this is the silent-broken-query audit case that motivates the story).
- [ ] Per-account deletion failure mid-batch: `errors` increments, sweep continues (pin existing continue-on-error semantics if present; if accountDeletion currently aborts on first failure, that behaviour question goes to the architect at gate).

### Performance
- [ ] Counting adds no extra Firestore reads (counts derive from the existing iteration).

### Security
- [ ] No PII in counts/logs: numbers only, never user IDs/emails (pinned by a log-spy test asserting the log payload's exact key set).
- [ ] Secret-never-logged assertion extended over the new WARN path.

### UX
- [ ] N/A — server-side; the cron job summary is the only surface.

### i18n
- [ ] N/A — ops logs/JSON.

### Observability
- [ ] This story IS the observability work; its own meta-AC: the new log events are asserted via the route-test log spies (extending tests/routes/cron-account-deletion.test.js).

## BDD Scenarios

**Scenario: healthy sweep is auditable from the response**
- **Given** the sweep mock reports 3 deletions and 1 per-account failure
- **When** an authorized POST hits /api/system/sweep-account-deletions
- **Then** the response is 200 `{status: 'ok', swept: 3, errors: 1}`
- **And** an INFO `sweep_run` log carries `{swept: 3, errors: 1, duration_ms}`

**Scenario: auth failure logs the requester, never the secret**
- **Given** a request with a wrong bearer token from IP 203.0.113.9
- **When** the middleware rejects it
- **Then** a WARN log carries the IP and variant, and no log line contains any token material

**Scenario: zero-swept run is visible**
- **Given** the sweep mock reports 0 eligible accounts
- **When** an authorized POST runs
- **Then** the 200 body carries `swept: 0` (auditably distinct from pre-story bare ok)

## Test Plan

**Red first:** extend express-api/tests/routes/cron-account-deletion.test.js (log-spy + body assertions for counts, WARN-with-IP, zero-swept case) + unit assertions on `accountDeletion()`'s new return shape in its existing test file (locate at pickup; characterize current continue-on-error semantics first).
**Green:** plumb counts through accountDeletion → createSweepHandler → body/logs; workflow summary line; all existing tests green (the SHY-0021 suite asserts `{status:'ok'}` via toEqual — those assertions are additive-updated in the SAME PR as the behaviour change, documented as the intended-contract change).

## Out of Scope

- The SONAR_TOKEN-style `if: env...` gating quirk in sonarcloud.yml (unrelated; noted in SHY-0068).
- New sweep endpoints; dashboards/alerting on the new logs.
- Changing the 401/503 body shapes (SHY-0021 pinned them).

## Dependencies

- SHY-0021 merged (PR #1120) — its route tests are the extension base; note its `toEqual({status:'ok'})` assertions will be updated here BY DESIGN (the sole intended test edit).
- Architect checkpoint at pickup: accountDeletion's current abort-vs-continue per-account failure semantics.

## Risks & Mitigations

- **Risk:** cron workflow asserts the exact old body. **Mitigation:** AC requires checking the workflow's success condition before changing the shape (additive keys, `status:'ok'` retained).
- **Risk:** count plumbing tempts a refactor of accountDeletion's iteration. **Mitigation:** counts piggyback on existing loops only; any refactor urge → separate story.

## Definition of Done

- [ ] All AC checked; red→green; SHY-0021 suite updated only where the contract intentionally changed (documented in Notes); reviewer ZERO; auto-merged.
- [ ] `status: Done` deferred to release cut; SHY-INDEX synced (reserved row → this entry).

## Notes (running log)

- 2026-06-10 ~04:35 BST — Authored fully-refined from the SHY-0021 architect deferral (same session; handler/middleware facts verified hours earlier: createSweepHandler logs error-only, accountDeletion returns void, two 401 variants in system-auth.js).
