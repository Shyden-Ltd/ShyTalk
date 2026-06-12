---
id: SHY-0022
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: M
type: bug
roadmap_ids: [G023]
pr:
mvp: true
---

# SHY-0022: admin-keyboard data-dependent skip remediation

## User Story

As the ShyTalk operator, I want **the 7 `test.skip(true, ...)` calls in `tests/web/admin-keyboard.spec.ts` removed by seeding the required test data (pending reports, evidence thumbnails, etc.) in Playwright global-setup or per-test fixtures**, so that the admin-keyboard test suite has 7 more passing tests covering admin-tool keyboard shortcuts rather than 7 silently-skipped gaps.

## Why

`tests/web/admin-keyboard.spec.ts` has 7 explicit skips on lines 83, 107, 131, 165, 182, 207, 280 — each marked `test.skip(true, "seed data lacks ...")`. The tests cover admin keyboard shortcuts (e.g. press 'A' to approve a pending report; press 'D' to dismiss; press 'E' to expand evidence thumbnail) but the test fixtures don't provide the data state these shortcuts operate on.

Skipped tests are silent gaps. The skip annotation is honest but the COVERAGE invariant we want ("admin keyboard shortcuts work on real data") is unmet.

Roadmap row G023 (line 91 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. `test.skip(true, ...)` data-dependent — admin-keyboard. Location: `tests/web/admin-keyboard.spec.ts:83,107,131,165,182,207,280`. Gap: 7 tests skip because seed data lacks pending reports / evidence thumbnails. Fix: Audit each; seed required state in global-setup or per-test fixture. Scope: M.

P1 Tier-3 coverage. High coverage-per-effort ratio — fixing fixtures unblocks 7 tests at once.

## Acceptance Criteria

### Happy path

- [ ] Each of the 7 `test.skip(true, ...)` removed; replaced with the actual test body that exercises the keyboard shortcut.
- [ ] Each test sets up the required data state in a `test.beforeEach` (or shared fixture) so the keyboard shortcut has something to operate on:
  - Line 83: seed pending reports.
  - Line 107: seed evidence thumbnails.
  - Lines 131, 165, 182, 207, 280: audit each individually + seed required state.
- [ ] Shared seeding logic extracted to a helper in `tests/web/fixtures/admin-data.ts` so the 7 tests don't duplicate.
- [ ] Each test still passes its existing assertions (keyboard shortcut behaviour unchanged).
- [ ] `npx playwright test tests/web/admin-keyboard.spec.ts` passes ALL tests (was N tests, 7 skipped → now N tests, 0 skipped).
- [ ] CI run produces the same pass count locally + in CI.

### Error paths

- [ ] Seeding fails (e.g. backend rejects fixture) → test fails with clear error naming the seed step.
- [ ] Cleanup fails (test cleanup race) → next test's seed re-establishes clean state per [[feedback-test-isolation-no-leaks]].
- [ ] Keyboard shortcut doesn't actually do anything (broken in code) → test fails with the actual UI assertion that wasn't met.

### Edge cases

- [ ] Seeded data must use unique IDs per test run (provenance-tagged) so tests don't interfere; per [[feedback-test-isolation-no-leaks]].
- [ ] Fixtures cleanup after test — no leaked pending reports in dev backend.
- [ ] If the admin-keyboard shortcuts depend on a specific data ORDER (e.g. "approve the first pending report"), the fixture ensures deterministic ordering.
- [ ] If the seeded data is large (many evidence thumbnails), tests run within Playwright's default timeout.

### Performance

- [ ] Each test runs within 30s (with seeding).
- [ ] Full file runs within 5 minutes.
- [ ] Seed/cleanup adds <5s per test.

### Security

- [ ] Test fixtures use test-only personas + test-only data; never production data.
- [ ] Seeded data doesn't expose sensitive admin features to non-admin test runs.
- [ ] Seed helper uses authenticated admin context (test-admin persona).

### UX

- [ ] N/A — backend admin tool; tests verify behaviour, not visible UX.

### i18n

- [ ] If admin keyboard shortcuts have user-facing strings (tooltips, error messages), tests use the default `en` locale.

### Observability

- [ ] Playwright reporter shows pass count delta (was N-7 → now N).
- [ ] CI workflow's job summary reflects the change.
- [ ] Per-test traces preserved for any failure analysis.

## BDD Scenarios

(Playwright tests aren't BDD-shaped; including illustrative scenarios for AC clarity.)

**Scenario: Line 83 — approve-pending-report shortcut**

- **Given** the admin-keyboard test fixture seeds 3 pending reports
- **And** the admin UI is loaded showing the reports list
- **When** the user presses 'A'
- **Then** the first pending report shows "approved" state within 1s
- **And** the test assertion (`expect(page.locator('[data-status="approved"]')).toBeVisible()`) passes

**Scenario: Line 107 — expand-evidence-thumbnail shortcut**

- **Given** the fixture seeds an evidence-attached report
- **And** the report's evidence thumbnail is visible
- **When** the user presses 'E'
- **Then** the thumbnail expands to full-size
- **And** the assertion passes

**Scenario: Seed cleanup leaves no test debt**

- **Given** the test file's `test.afterAll` (or per-test afterEach)
- **When** all 7 tests complete
- **Then** the test-seeded data is cleaned up
- **And** no orphaned reports/evidence remain in the dev backend

**Scenario: Reproducibility across local + CI**

- **Given** the test runs locally on macOS
- **And** the same tests run in CI on Linux
- **Then** both produce the same pass count
- **And** no test passes locally + fails in CI (or vice versa)

## Test Plan (TDD)

### Red

1. Read `tests/web/admin-keyboard.spec.ts:83,107,131,165,182,207,280` — understand what each test ASSERTS once unskipped.
2. For each test, identify the required seed state (read the test body's expected UI / data).
3. Remove the `test.skip(true, ...)` from each.
4. Run `npx playwright test tests/web/admin-keyboard.spec.ts` → RED on all 7 (no seed data).

### Green

1. Implement seed helpers in `tests/web/fixtures/admin-data.ts`:
   - `seedPendingReports(page, count)` — POSTs N reports via admin API; returns IDs.
   - `seedEvidenceThumbnails(page, count)` — uploads N evidence files.
   - (Additional helpers as discovered.)
2. Wire seeds into each test's `test.beforeEach` (or a shared `test.use(...)` fixture).
3. Add cleanup in `test.afterEach`.
4. Re-run → GREEN.
5. Verify in CI (push branch, observe Playwright job).

## Out of Scope

- **Refactoring the admin-keyboard implementation** — only tests.
- **Adding new admin shortcuts** — only fixture seeding for existing.
- **Other Playwright skips** — covered by SHY-0023, SHY-0033.
- **Backend admin API tests** — separate scope.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- Admin API endpoints for seeding pending reports + evidence (verify exist).
- Test-admin persona (verify exists via `provision-test-personas.js`).
- Playwright fixture system existing patterns.

## Risks & Mitigations

- **Risk:** Seeding requires admin-API endpoints that don't exist (and shouldn't be added just for tests). **Mitigation:** if so, use direct Firestore writes via Firebase Admin SDK (test-only); document the rationale.
- **Risk:** Seeded data is hard to clean up (cascade-delete issues). **Mitigation:** use provenance tag (e.g. `test_seed_<run_id>`); global-setup wipes all such tagged data before run.
- **Risk:** Tests become slow due to seed/cleanup overhead. **Mitigation:** share seed across tests where possible; cleanup once per file via `test.afterAll`.
- **Risk:** CI environment lacks admin SDK credentials. **Mitigation:** verify Firebase Admin credentials are CI-available; if not, use the dev-deployed admin endpoints.

## Definition of Done

- [ ] All 7 `test.skip(true, ...)` removed.
- [ ] All 7 tests pass locally + in CI.
- [ ] Seeding helper extracted to fixture file.
- [ ] No test debt (cleanup verified).
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`bug` → auto-merge + CI green).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; final pass count in Notes.

## Notes (running log)

- 2026-06-07 ~21:25 BST — Refined under SHY-0032. Tier 3 high-coverage-per-effort win.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-H1a` (G023).
