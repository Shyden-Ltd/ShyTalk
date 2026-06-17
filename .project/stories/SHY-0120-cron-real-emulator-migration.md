---
id: SHY-0120
status: Draft
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
