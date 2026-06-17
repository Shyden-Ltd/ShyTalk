---
id: SHY-0110
status: In Review
owner: claude
created: 2026-06-17
priority: P1
effort: S
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1447
mvp: false
---

# SHY-0110: Migrate the backpackCleanup cron test to the real Firestore emulator (EPIC-0003 Phase 3)

## User Story

**As** the team draining EPIC-0003's 162 firebase-mock express Jest files,
**I want** `tests/cron/backpackCleanup.test.js` rewritten off `jest.mock('../../src/utils/firebase')` + `jest.mock('../../src/utils/log')` and onto the REAL Firestore emulator (now provisioned in CI by SHY-0109),
**So that** the cron is verified by its REAL outcome (expired backpack items actually deleted, fresh ones actually retained) instead of the current 11 hollow `toHaveBeenCalled` mock-call assertions — and one more file drops out of the Phase-3 backlog.

## Why

The current test asserts only that the mocked `db`/`batch`/`log` were *called* in a certain shape — it has **zero** state-read assertions, so the cron could delete the wrong documents and the test would still pass. This is exactly the "was called"/structural-only anti-pattern the operator's strict testing standard bans ([[feedback-ac-traceability-in-tests]]). SHY-0109 shipped the emulator-in-CI keystone + the reusable `tests/helpers/firebase-emulator.js`; this is the first follow-on migration, establishing two reusable patterns for the remaining drain: a **`collectionGroup` query** against the emulator, and **de-mocking the logger** (assert the real Firestore outcome; do not assert log calls). Pure firebase + log deps — no r2/fcm/external service, so it ships on the **CI-green gate** (no device surface), like SHY-0109.

## Acceptance Criteria

### Happy path
- [ ] `tests/cron/backpackCleanup.test.js` contains **no** `jest.mock` (verified: file drops out of the firebase-mock set); it sets `NODE_ENV=local` before requiring firebase.js and uses `assertEmulatorReachable()` + the emulator helpers.
- [ ] It seeds real `backpack` subcollection docs under multiple parent users (`users/<uid>/backpack/<itemId>`) with `expiresAt` past/future, runs the real `backpackCleanup()`, and asserts via real emulator reads that the **expired** items are gone and the **future** items remain.
- [ ] The full canonical `cd express-api && npm test` is green with the local emulator up (this file + the rest, 0 regressions).

### Error paths
- [ ] The empty-result branch (`snapshot.empty → log + early return`) is exercised against a genuinely empty `backpack` collection group (clean slate via the new `clearCollectionGroup` helper) and asserted to be a no-op (cron resolves; nothing deleted).
- [ ] No assertion depends on the logger: the migrated test asserts the real Firestore post-state, never `expect(log.x).toHaveBeenCalled()` (banned shape). The real `log` runs unmocked.

### Edge cases
- [ ] The real `expiresAt <= now` boundary is exercised: an item with `expiresAt` exactly `<= Date.now()` is deleted; an item with `expiresAt` in the future is retained (value-level, not "the mock was called").
- [ ] The collection-group nature is proven: expired items under **different** parent users are all collected by the single `collectionGroup('backpack')` query and deleted; items in a same-named-but-unrelated structure are not falsely matched.
- [ ] Per-test isolation: `clearCollectionGroup(db, 'backpack')` in `beforeEach` gives a clean slate (the cron operates globally on the group, so isolation requires controlling global group state — surgical per-id cleanup is insufficient here); `NODE_ENV` restored in `afterAll`.

### Performance
- [ ] `clearCollectionGroup` drains in batched passes (≤ one batch for test sizes); the migrated suite completes in a few seconds against a warm emulator; no per-doc round-trip storm.

### Security
- [ ] No credentials/secrets (emulator sandbox `demo-shytalk`, inherited from SHY-0109). Read-only helper additions; no external network.

### UX
- [ ] N/A — backend cron test harness; no user-facing surface.

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The real `log.info('cron', 'backpackCleanup: ...', { count })` runs unmocked during the test (exercised, not asserted) — proving the logging path does not throw against the real emulator.

## BDD Scenarios

**Scenario: expired backpack items across multiple users are deleted**
- **Given** the emulator `backpack` collection group is empty, then seeded with two expired items (under `users/u1` and `users/u2`) and one future item (under `users/u3`)
- **When** `backpackCleanup()` runs
- **Then** reading the emulator back shows both expired items deleted
- **And** the future item still exists with its original `expiresAt`

**Scenario: the expiry boundary is exact**
- **Given** one item with `expiresAt = Date.now()` (already due) and one with `expiresAt = Date.now() + 1 day`
- **When** `backpackCleanup()` runs
- **Then** the due item is deleted and the future item is retained

**Scenario: empty collection group is a no-op**
- **Given** `clearCollectionGroup(db, 'backpack')` has emptied the group
- **When** `backpackCleanup()` runs
- **Then** it resolves without error and nothing is created or deleted

**Scenario: helper clears a collection group**
- **Given** three `backpack` docs exist under different parents
- **When** `clearCollectionGroup(db, 'backpack')` runs
- **Then** a subsequent `collectionGroup('backpack')` read returns empty and the deleted count is 3

## Test Plan

**RED (before the rewrite):**
- New `clearCollectionGroup` helper test in `tests/helpers/firebase-emulator.test.js` — seed 3 group docs under different parents, clear, assert empty + count. Fails until the helper exists.
- Rewritten `tests/cron/backpackCleanup.test.js` run **without** an emulator → fails fast via `assertEmulatorReachable()` (proves it needs the real service).

**GREEN:**
- Add `clearCollectionGroup(db, groupName, batchSize)` to `tests/helpers/firebase-emulator.js`.
- Rewrite `backpackCleanup.test.js` to seed → run → assert real state.
- Bring up local stack → `npm test` green.

**Frameworks:** Express/Node Jest (`npm test`), eslint (`--max-warnings=0`), prettier, SHY frontmatter validator. **Real backend:** Firestore emulator (`demo-shytalk`). **Gauntlet exemption:** backend test harness only — no app/web/device surface; authoritative proof = CI-green (Test Backend job exercises the emulator).

## Out of Scope
- The other 161 firebase-mock files (each its own follow-on migration; crons with r2/fcm/child_process deps need their own approach).
- Any change to `src/cron/backpackCleanup.js` (production code unchanged — only its test).
- Per-jest-worker emulator isolation (documented scaling item from SHY-0109; not triggered here — only this file uses the `backpack` group).
- Adding SHY-0110 to `EPIC-0003` `child_shys` (deferred to the same consolidation as SHY-0108/0109).

## Dependencies
- SHY-0109 (merged) — emulator-in-CI + `tests/helpers/firebase-emulator.js`. This branch is off `origin/main` which includes it.
- Local emulator stack (`bash local/start.sh`) for local verification + pre-push Jest.
- Confirmed empirically: the emulator runs `collectionGroup('backpack').where('expiresAt','<=',N)` **without** a composite index — no `firestore.indexes.json` change needed.

## Risks & Mitigations
- **Risk:** `collectionGroup` global state collides with other emulator tests. **Mitigation:** only this migrated file uses the `backpack` group; `clearCollectionGroup` in `beforeEach` gives a clean slate; documented per-worker-namespacing remains the future scaling answer.
- **Risk:** de-mocking `log` makes the real logger write to the emulator and throw. **Mitigation:** SHY-0109 already proved the real logger runs fine under `NODE_ENV=local` (the migrated expireTempIds test logs unmocked); exercised-not-asserted.
- **Risk:** clearing the `backpack` group wipes local seed data. **Mitigation:** emulator data is ephemeral (CI fresh; local re-seedable); no non-migrated test reads the emulator.

## Definition of Done
- `backpackCleanup.test.js` is mock-free + asserts real state; `clearCollectionGroup` added + tested; `npm test` fully green; eslint/prettier clean.
- `code-reviewer` zero findings on the local commit before push.
- Pushed; CI required checks green by name (Detect Changes, Analyze JavaScript, PR Gate) + Test Backend/SonarCloud green with the emulator exercised.
- Judgment-merge (CI-green gate; no auto-merge). Story → In Review → Done on next release cut.

## Notes (running log)
- **2026-06-17 ~00:10 BST — created In Progress.** First follow-on Phase-3 migration after the SHY-0109 keystone. Architect skipped (small, low-risk test refactor reusing the proven pattern, [[feedback-rate-limit-slowdown-strategies]]). Chosen because backpackCleanup is the simplest clean (firebase+log only) cron — single `collectionGroup` query + batch delete. Establishes the `collectionGroup` + de-mock-logger patterns. Probe confirmed no composite index needed in the emulator.
- **2026-06-17 ~00:30 BST — local green + reviewer clean → In Review (PR #1447).** RED→GREEN: rewrote the cron test (5 real-state tests) + added `clearCollectionGroup` helper (+ tests). Full canonical `npm test` = 333 suites / 12,328 tests, 0 failed. eslint/prettier clean. code-reviewer: 0 Critical, 2 Important (group-variant pagination test, boundary comment) — both applied. Pre-push SonarCloud quality gate passed. Flipped to In Review in the same push so CI runs once on the final commit (concurrency cancels the nascent run). Awaiting CI-green → judgment-merge.
