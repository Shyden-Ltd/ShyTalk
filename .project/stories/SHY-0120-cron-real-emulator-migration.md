---
id: SHY-0120
status: In Progress
owner: claude
created: 2026-06-17
priority: P1
effort: L
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0120: Migrate the remaining cron tests to the real Firestore emulator (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** the remaining cron tests (~10 beyond SHY-0110's backpackCleanup — closedRooms / archiveReports / subscriptions / … ) moved off `jest.mock` + `makeStatefulFakeDb` onto the real Firestore emulator (provisioned in CI by SHY-0109),
**So that** every scheduled job is verified by its real outcome (the right docs actually deleted/archived/updated) instead of hollow `toHaveBeenCalled` mock-call assertions.

## Why

Crons act unattended on production data, so a cron that deletes/archives the wrong documents is high-impact — and the current `toHaveBeenCalled`-style mock tests would not catch it ([[feedback-ac-traceability-in-tests]]). SHY-0109 shipped the emulator-in-CI keystone + `tests/helpers/firebase-emulator.js`, and SHY-0110 migrated the first cron (backpackCleanup), establishing the `collectionGroup` + de-mock-logger patterns. This area drains the remaining ~10 crons using those proven patterns. Some crons depend on r2/fcm/external services and need their own real-path approach (called out per-cron at pickup).

## Acceptance Criteria

### Happy path
- [ ] Every remaining cron test (closedRooms / archiveReports / subscriptions / expiry / cleanup jobs) runs against the real Firestore emulator; no `jest.mock`/`makeStatefulFakeDb` remains in them; each sets `NODE_ENV=local` + uses `assertEmulatorReachable()` + the emulator helpers.
- [ ] Each migrated cron seeds real state (e.g. real closed rooms / real expired reports), runs the real job, and asserts via real reads that the **correct** docs were mutated and the others retained (value-level, not "the mock was called").

### Error paths
- [ ] Each cron's empty-result branch is exercised against a genuinely empty real collection (clean slate) and asserted to be a no-op.
- [ ] No assertion depends on the logger (real `log` runs unmocked; banned `expect(log.x).toHaveBeenCalled()` shape removed).
- [ ] A cron with an r2/fcm/external dependency exercises the **real** sandbox path for that dependency (or escalates via the operator escape-hatch if genuinely un-inducible — never a silent mock).

### Edge cases
- [ ] Each cron's threshold/boundary (e.g. `expiresAt <= now`, `closedAt older than N`) is exercised at the real value level — boundary item mutated, just-past-boundary item retained.
- [ ] `collectionGroup` correctness where applicable: items under different parents all collected; unrelated same-named structures not falsely matched (the SHY-0110 pattern).
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Real-state setup/teardown batched; migrated cron suites complete in a few seconds against a warm emulator; no per-doc round-trip storm.

### Security
- [ ] Emulator sandbox (`demo-shytalk`); no secrets logged; r2/fcm sandbox keys only for the external-dep crons.

### UX
- [ ] N/A — backend scheduled jobs; no user-facing surface.

### i18n
- [ ] N/A — no user-facing strings (cron-internal).

### Observability
- [ ] Each cron's real `log.info('cron', …)` runs unmocked during tests (exercised, proving the logging path does not throw against the real emulator).

## BDD Scenarios

**Scenario: closedRooms archives the right rooms by real outcome**
- **Given** real rooms — some closed past the threshold, some recent
- **When** the real closedRooms cron runs
- **Then** real reads show the past-threshold rooms archived/cleaned and the recent ones retained

**Scenario: a cron's empty collection is a no-op**
- **Given** the cron's target collection emptied for real
- **When** the cron runs
- **Then** it resolves without error and mutates nothing

**Scenario: an external-dep cron uses the real sandbox path**
- **Given** a cron that calls r2/fcm
- **When** it runs in the test
- **Then** it exercises the real sandbox path (not a mocked client), asserting the real Firestore outcome

**Scenario: a surfaced cron bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each cron test to require the real emulator (no mocks) → fails until seeded real; run without an emulator → fails fast via `assertEmulatorReachable()`.

**GREEN:** per cron — seed real state → run real job → assert real post-state + boundary + empty branch; de-mock the logger; for external-dep crons wire the real sandbox path; file + `@known-failure`-tag surfaced bugs. Bring up local stack → canonical `npm test` green.

**Frameworks:** express Jest (real Firestore emulator + r2/fcm sandbox where needed), frontmatter validator. **Real backend:** Firestore emulator (`demo-shytalk`) + r2/fcm sandbox for external-dep crons. **Gauntlet exemption:** backend cron harness — no app/web/device surface; authoritative proof = CI-green (Test Backend exercises the emulator).

## Out of Scope
- backpackCleanup (already migrated by SHY-0110).
- Per-jest-worker emulator isolation (SHY-0109 scaling item) unless a cron's global collection-group state forces it.
- Sub-splitting: ~10 crons delivered as 1-SHY-1-PR slices (or small grouped PRs by dependency profile) at pickup.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0109** (emulator-in-CI) + **SHY-0110** (first cron migration, established patterns) + `tests/helpers/firebase-emulator.js`.
- Local emulator stack; r2/fcm sandbox for external-dep crons.

## Risks & Mitigations
- **Risk:** external-dep crons (r2/fcm) are harder to make real. **Mitigation:** real sandbox path; operator escape-hatch escalation if a specific condition is genuinely un-inducible, never a silent mock.
- **Risk:** `collectionGroup` global-state collisions between cron tests. **Mitigation:** per-group clean-slate (`clearCollectionGroup`) in `beforeEach`; documented per-worker namespacing as the scaling answer.

## Definition of Done
- All remaining cron tests double-free + asserting real value-level outcomes; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; `code-reviewer` zero findings; CI green by name incl. Test Backend.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P1, ~10 crons, L).** Continues SHY-0109/0110; reuses the `collectionGroup` + de-mock-logger patterns. External-dep crons (r2/fcm) get the real sandbox path, not a mock; escape-hatch if genuinely un-inducible.
- **2026-06-18 ~02:55 BST — picked up (→ In Progress); pickup-fitness mapped the real landscape.** Actual remaining mock-using cron tests in `express-api/tests/cron/` = **13** (backpackCleanup already 0; expireTempIds=1 near-done): Firestore-only — `testDataCleanup`(82), `ageVerificationAuditReconcile`(46), `closedRooms`(36), `index`(32), `serverHealth`(28), `subscriptions`(27); external-dep (R2/FCM/email, need real-sandbox path) — `accountDeletion`(158), `archiveReports`(59), `orphanedStorage`(53), `backups`(44), `rotateLogs`(41), `expireDataExports`(21). The story's named examples (closedRooms/archiveReports/subscriptions) all still exist — count estimate accurate; sequencing is by dependency profile (Firestore-only first, external-dep crons each get the real sandbox path as separate slices). Picked up while SHY-0102 is parked at its operator device-gate (operator: "work on something else while you're waiting").
- **2026-06-18 — SLICE 1: `testDataCleanup` (Firestore-only, 82 mock-lines → real emulator).** Chosen first: largest Firestore-only cron, zero external deps (no R2/FCM/email) → fully ungated + self-contained. The old 18 tests were mostly hollow (`db.collection toHaveBeenCalledWith`, `ref.delete toHaveBeenCalled`) — could not catch the cron deleting the WRONG docs. Rewriting each as a real value-level assertion (correct docs deleted, siblings retained) against the live Firestore emulator; `_testRun`-prefix scoping + `createdAt`-cutoff boundary + user/conversation subcollection deletion + linked deviceBans/networkBans (numeric+string uniqueId variants) + starting-screen key-prefix deletion + counter restore + production guard, all proven by real reads. Logger de-mocked (runs unmocked, not asserted).
- **2026-06-18 — SLICE 1 DONE (verified).** 19 real tests, **19/19 pass in ~2.4s** against the live Firestore emulator; **RED-sensitivity proven** (temporarily zeroed the cron's `staleDocs` → the sweep test failed; restored → green). eslint/prettier clean; `check-no-new-stubs` baseline tightened (`testDataCleanup` removed → jest.mock 194→193, jest.fn 226→225, mockResolvedValue 202→201). Even the `cleanupTestStartingScreens` best-effort catch is exercised by a REAL induced error (an invalid `..` field-path in `update()`), not a mock. On branch `story/SHY-0120-cron-real-emulator-migration` off origin/main. **Gotcha (re-learned):** emulator-backed express tests MUST run via the canonical runner `node --experimental-vm-modules node_modules/.bin/jest` (i.e. `npm test`) — bare `npx jest` cannot load the Firebase Admin SDK's transitive **ESM `uuid@14`** and fails with `Unexpected token 'export'` (a false red that wasted a cycle; the `--experimental-vm-modules` flag is the fix). **Remaining slices (next pickups):** Firestore-only — `ageVerificationAuditReconcile`, `index`, `serverHealth`; external-dep (real R2/FCM/email sandbox path) — `accountDeletion`, `archiveReports`, `orphanedStorage`, `backups`, `rotateLogs`, `expireDataExports`.
- **2026-06-18 — SLICE 3 DONE (verified): `closedRooms` (delete >7-day CLOSED rooms + subcollections, 36 mock-lines → 9 real tests).** Seeds real rooms → runs real cron → reads back: a >7-day CLOSED room + its `messages`/`seatRequests` subcollection docs deleted; recent (`closedAt` <7d), missing-`closedAt`, and non-CLOSED (state scoping) rooms retained; the do/while message pagination exercised by a batch-seeded **exactly-500-message** room (cheap single-batch setup forces the loop to run twice); the 20-per-run cap proven by seeding 21 old CLOSED rooms → exactly 1 survives; multi-room loop continuation. **9/9 green ~1.4s; RED-sensitivity proven** (zeroed the cron's `old` list → deletion test failed; restored). The per-room try/catch is a defensive guard (a real Firestore delete failure is not cheaply inducible — loop continuation is proven by the multi-room test instead). eslint/prettier clean; ratchet tightened (closedRooms removed → jest.mock 192→191, jest.fn 224→223, mockResolvedValue 200→199).
- **2026-06-18 — SLICE 4 DONE (verified): `ageVerificationAuditReconcile` (compliance audit-log back-fill, mock query-shape fakes + pinned `now` → 18 real value-level tests + pure toMillis/exports).** Seeds real `ageVerificationSubmissions` + `auditLog` → runs the real cron → reads `auditLog` back. Covers: full remediation-row value assertion (action/actionType/targetType/targetId/adminUid/fromSubmissionId/method/originalDecisionAt/note/timestamp); the status→action **value matrix** (all 5 STATUS_ACTION_MAP keys: approved/rejected/dob_modified/modify-dob/modifyDob → exact actions); method-leak scoping (rejected omits the approve-only method); DOB-delta caveat note; adminUid fallback to 0 (missing + non-numeric decidedBy); tagged-row idempotency; **end-to-end run-twice → no duplicate** (the strongest real proof — second run finds the row it wrote); original-write window match in/out of ±10 min; targetId scoping; **REAL Firestore Timestamp coercion** (seeded a JS Date → read back a genuine Timestamp, exercising toMillis path the mock faked); skippedPending (via numeric in-window `status:'pending'`); skippedUnknownStatus; the 7-day range-query boundary (8-day-old excluded); multi-doc loop continuation. **2 real-vs-mock corrections surfaced + encoded** (verified against the emulator with a probe): (1) the numeric `where('decisionAt','>=',cutoff)` range query is **type-aware** — a string/out-of-window decisionAt is excluded by the QUERY and never scanned, so the mock's "string → skippedPending" path is unreachable in prod (now asserted as not-scanned); (2) the per-doc `failed` counter + `data()`-throws branch is a defensive guard not cheaply real-inducible (every seedable value is Firestore-storable → the rebuilt entry is storable → add() won't throw) — loop continuation proven by the multi-doc test, a genuine outage is operator escape-hatch territory. **26/26 green ~0.96s; RED-sensitivity proven** (skipped the cron's real `auditLog.add` → 11 read-back tests failed; restored). eslint/prettier clean; ratchet tightened (ageVerificationAuditReconcile removed → jest.mock 191→190, jest.fn 223→222, mockResolvedValue 199→198). Commit `e211b198353`. **Classification note for the next slices:** `index`(32) is the cron **registry** (pure `node-cron` scheduling + prod-guard, no Firestore/Auth/network collaborator) → genuine UNIT test; correct EPIC-0003 move is RELOCATE/RENAME to a `*.unit.test.js` location (mocking `node-cron` is legit unit isolation), NOT rewrite-to-real. `serverHealth`(28) is MIXED — real in-process memory + `alertManager.createAlert`(real→Firestore) + `pm2 jlist` via execFile (external binary, escape-hatch territory).
- **2026-06-18 — SLICE 5 DONE (verified): `index` (cron registry, 32 mock-lines) — RECLASSIFIED to a unit test, NOT rewritten.** Investigation confirmed `src/cron/index.js` is the scheduling REGISTRY: `startCronJobs()` reads NODE_ENV (prod-guard) + calls `node-cron.schedule(expr, callback)` to wire each job. It exercises NO real collaborator — `node-cron` is an in-process scheduler (cannot "really" wait until 03:00 UTC for a job to fire), each job module has its OWN real-emulator test, and alertManager's real behaviour belongs in alertManager's own test. The only thing under test is the WIRING (7 prod schedules + exact cron expressions, dev prod-guard, callback delegation, error-`.catch` paths, age-verif catastrophic-alert path). There is no "real" version of a scheduler-wiring test, so the correct EPIC-0003 move (explicitly sanctioned by `check-no-new-stubs.js`'s own error message: "move it to a unit-test location if it is genuinely a unit test") is `git mv tests/cron/index.test.js → index.unit.test.js` + a classification docstring — mocking node-cron + the job modules is correct unit isolation, not migration debt. 17/17 still green via the canonical runner (no logic change); eslint/prettier clean. Ratchet: `isUnitTestLocation` now exempts the `*.unit.test.js` file → it drops from the integration debt (jest.mock 190→189, jest.fn 222→221, mockResolvedValue 197). **Open for reviewer/operator veto** if they prefer a different classification — but rewrite-to-real is impossible for a scheduler. Remaining: `serverHealth`(28, MIXED — real memory + alertManager→Firestore + pm2 external) + the external-dep crons (accountDeletion/archiveReports/orphanedStorage/backups/rotateLogs/expireDataExports — real R2/FCM/email sandbox path).
- **2026-06-18 — SLICE 2 DONE (verified): `subscriptions` (SuperShy expiry cron, 27 mock-lines → 9 real tests).** Seeds real users → runs the real cron → reads back: expired non-lifetime downgraded (isSuperShy=false, expiry/tier nulled), future/lifetime/non-supershy retained verbatim; `<=` boundary (expiry == now → downgraded); missing-tier (undefined ≠ lifetime → downgraded); multi-user batch; empty no-op. **9/9 green ~1.4s; RED-sensitivity proven** (zeroed the cron's `toExpire` → the downgrade test failed; restored). Dropped the prior mock test's impossible ">500 → 2 batches" case (the query's `.limit(500)` caps `toExpire` ≤ 500, so the chunk loop always runs once — the mock fabricated 501 docs past the limit); the truncation `log.warn` is observability-only (unmocked, fires only at exactly 500 rows — documented, not 500-seeded). eslint/prettier clean; ratchet tightened (subscriptions removed → jest.mock 193→192, jest.fn 225→224, mockResolvedValue 201→200).
