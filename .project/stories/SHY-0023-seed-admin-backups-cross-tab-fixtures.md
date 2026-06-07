---
id: SHY-0023
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: S
type: bug
roadmap_ids: [G033]
pr:
---

# SHY-0023: admin-backups + admin-cross-tab data fixture gaps

## User Story

As the ShyTalk operator, I want **the 4 `test.skip(true, ...)` calls in `tests/web/admin-backups.spec.ts:150,187` and `tests/web/admin-cross-tab.spec.ts:361,384` removed by seeding the required backup + trace-link data in Playwright global-setup or per-test fixtures**, so that 4 more admin tests cover their intended behaviour rather than silently skip.

## Why

Roadmap row G033 (line 93 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟡 Polish. `test.skip(true, ...)` — admin-backups, admin-cross-tab. Location: `tests/web/admin-backups.spec.ts:150,187`, `admin-cross-tab.spec.ts:361,384`. Gap: Data-fixture gaps not intentional skips. Fix: Seed backup + trace-link data in global-setup. Scope: S.

Same pattern as SHY-0022 but smaller scope (4 skips across 2 files). P2 Tier-4. Companion to SHY-0022.

## Acceptance Criteria

### Happy path

- [ ] `tests/web/admin-backups.spec.ts:150` skip removed; test seeds backup data; passes.
- [ ] `tests/web/admin-backups.spec.ts:187` skip removed; test seeds backup data; passes.
- [ ] `tests/web/admin-cross-tab.spec.ts:361` skip removed; test seeds trace-link data; passes.
- [ ] `tests/web/admin-cross-tab.spec.ts:384` skip removed; test seeds trace-link data; passes.
- [ ] Shared seed helpers in `tests/web/fixtures/admin-data.ts` (reuse from SHY-0022 where overlap exists; extend with `seedBackups()` + `seedTraceLinks()`).
- [ ] `npx playwright test tests/web/admin-backups.spec.ts tests/web/admin-cross-tab.spec.ts` passes ALL tests (was N-4 → now N, 0 skipped).
- [ ] CI run matches local pass count.

### Error paths

- [ ] Seed failure surfaces test failure with clear "seed step failed" message.
- [ ] Cleanup failure does not affect next test (per-test isolation per [[feedback-test-isolation-no-leaks]]).

### Edge cases

- [ ] Seeded backup data tagged with test-run-ID (provenance) so concurrent tests don't conflict.
- [ ] Cross-tab tests verify trace-link behaviour ACROSS browser contexts; fixture seeds must be visible to both contexts.
- [ ] Backup-restore tests don't accidentally restore prod data — verify test-only namespace.

### Performance

- [ ] Each test <30s incl seed/cleanup.
- [ ] Full file <3 minutes.

### Security

- [ ] Test backups use test-only personas; never production data.
- [ ] Trace-link data uses test-only IDs.
- [ ] No admin credentials leaked in fixture code.

### UX

- [ ] N/A — admin tool; backend verification.

### i18n

- [ ] Tests use `en` default.

### Observability

- [ ] Playwright reporter shows the +4 pass-count delta.
- [ ] Traces preserved on failure.

## BDD Scenarios

**Scenario: admin-backups:150 — backup-list display**

- **Given** seed creates 3 backups via `seedBackups(page, 3)`
- **And** the admin backups screen is loaded
- **When** the page renders
- **Then** all 3 backups appear in the list
- **And** original assertion passes

**Scenario: admin-cross-tab:361 — trace-link follows across tabs**

- **Given** seed creates a trace-link between test entities
- **And** two browser contexts (tabs) are open
- **When** the trace-link is clicked in tab A
- **Then** tab B navigates to the linked target within 2s
- **And** original assertion passes

**Scenario: Seed cleanup leaves no test debt**

- **Given** the file's `test.afterAll` (or per-test)
- **When** all 4 tests complete
- **Then** seeded backups + trace-links are deleted
- **And** the dev backend has no orphaned test data

## Test Plan (TDD)

### Red

1. Read lines `admin-backups.spec.ts:150,187` + `admin-cross-tab.spec.ts:361,384`.
2. Identify required seed state per test.
3. Remove skips → RED.

### Green

1. Extend `tests/web/fixtures/admin-data.ts` with `seedBackups()` + `seedTraceLinks()`.
2. Wire into `test.beforeEach`.
3. Add cleanup.
4. Re-run → GREEN.

## Out of Scope

- **admin-keyboard skips** — SHY-0022 covers.
- **Other Playwright skips** — SHY-0033 covers.
- **Refactoring admin backups/cross-tab logic** — only fixtures.

## Dependencies

- **SHY-0022** — admin-data fixture extracted in this earlier SHY; reused here.
- **SHY-0032** — process.
- Admin API endpoints for backups + trace-links.

## Risks & Mitigations

- **Risk:** Cross-tab seeding requires shared state across contexts (Playwright contexts are isolated). **Mitigation:** seed via admin API (server-side state) so both contexts see it.
- **Risk:** Seeded backup data balloons the backend. **Mitigation:** small fixtures; cleanup verified.

## Definition of Done

- [ ] 4 skips removed; 4 tests pass.
- [ ] Helpers extracted to fixture file.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`bug` → auto-merge + CI green).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-07 ~21:31 BST — Refined under SHY-0032. Tier 4 polish-with-real-value.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-H2` (G033).
