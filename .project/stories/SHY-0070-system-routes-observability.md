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
mvp: true
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

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (changes `accountDeletion.js` + `system.js` + `system-auth.js` + `cron-account-deletion.yml` + tests) → the FULL protocol applies. Server-side observability for an **irreversible account-deletion** sweep; no app/web UI surface, so the headline is the real Jest suite against the real emulator + the real cron job-summary.

**Frameworks exercised (RED→GREEN):**
- ✅ **Express Jest** — the extended `cron-account-deletion.test.js` + `accountDeletion()` unit tests, run against the **REAL local Firebase emulator** (per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only).
- ✅ **eslint** (`--max-warnings=0`) — the changed JS.
- ✅ **actionlint** — the `cron-account-deletion.yml` job-summary edit.
- ⬜ **Web/Android/iOS UI · Kotlin/detekt/ktlint** — N/A (server-side).

**No-Stubs scrub (supersedes the AC/BDD "sweep mock" + "log spy" prose):**
- **"the sweep mock reports {swept:3, errors:1}"** → seed **real** emulator data so the **real** `accountDeletion()` produces those counts: 3 real eligible-for-deletion accounts (really deleted → swept:3) + 1 account whose deletion **really fails** (→ errors:1) + a zero-eligible run (→ {0,0}). The handler then propagates real counts.
- **"log spy" / "log-spy test"** → assert against the **real emitted structured-log stream** the app actually writes (capture the real logger output), NOT by replacing the logger with a fake. The secret-never-logged + IP-present assertions run against real log lines from a **real wrong-bearer request from a real IP**.
- **🚩** inducing a deterministic **real per-account deletion failure** is the one hard case (the `errors:1` path) — induce a real failing condition (e.g. a real locked sub-resource / a real `PERMISSION_DENIED` on one account's doc), or escalate to the operator at the gate — never a mocked rejection. Architect checkpoint at pickup: accountDeletion's abort-vs-continue-on-failure semantics (Dependencies).

**LOCAL gauntlet:** the Jest suite green against the real emulator (real seeded counts, real log stream) + eslint + actionlint clean; the SHY-0021 suite's `{status:'ok'}` assertions additive-updated as the intended contract change. Any failure → fix TDD → restart.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; trigger a real sweep against the real dev backend and confirm the cron workflow's job-summary renders the real `{swept, errors}` counts + the structured logs appear. Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt — extra care given the **irreversible** deletion surface; NO auto-merge.

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

- [ ] All AC checked; red→green; SHY-0021 suite updated only where the contract intentionally changed (documented in Notes).
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): the route + unit tests green against REAL seeded emulator data (real sweep, real log stream — no sweep mock / no replaced logger) + eslint + actionlint clean → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet (real dev backend; the cron job-summary renders real counts on a real run) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done` deferred to release cut; SHY-INDEX synced (reserved row → this entry).

## Notes (running log)

- 2026-06-10 ~04:35 BST — Authored fully-refined from the SHY-0021 architect deferral (same session; handler/middleware facts verified hours earlier: createSweepHandler logs error-only, accountDeletion returns void, two 401 variants in system-auth.js).
- 2026-06-13 ~01:40 BST — **Embedded the Pre-Merge Testing Protocol + No-Stubs scrub** ([[SHY-0091]] pass, [[feedback-no-stubs-mocks-fakes-real-only]]): server-side observability for the irreversible deletion sweep → real-emulator Jest headline + real cron job-summary. Scrubbed the AC/BDD "sweep mock" → real seeded emulator accounts (3 real-deletable + 1 real-failing + zero-case produce the real {swept,errors}); "log spy" → assert the REAL emitted log stream (not a replaced logger); secret-never-logged + IP from a real wrong-bearer request. **🚩** the deterministic real per-account-failure induction (errors:1) is the hard case → real failing condition or escalate; the architect checkpoint on abort-vs-continue semantics stands. DoD swaps "reviewer ZERO; auto-merged" for protocol-satisfied + judgment-merge + released_in (extra care: irreversible surface). Pickup-fitness: AC current; SHY-0021 (PR #1120) base + the handler/middleware facts (createSweepHandler error-only logging, accountDeletion void return, two 401 variants) to re-confirm at pickup.
