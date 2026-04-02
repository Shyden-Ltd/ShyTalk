# Phase 2-3: Deep Playwright Tests — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write 228 deep functional Playwright tests covering all 11 remaining admin panel tabs + cross-tab interactions, validation, keyboard shortcuts, real-time features, empty states, and console error checks.

**Architecture:** Extends Phase 1 infrastructure (AdminApi, testData fixture, test-helpers endpoint). Prerequisites add new seed types + API fixes. Each test file is independent after prerequisites are done.

**Tech Stack:** Playwright, TypeScript, Express.js, Firebase Firestore

**Spec:** `.project/specs/2026-03-18-playwright-phase2-3-deep-tests.md`

**Key principles:**
- When tests fail, fix the app/API — not the test
- Never skip tests — fix the underlying problem instead
- Always self-review before marking complete
- Seed everything fresh, clean up only what you seeded

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `express-api/src/routes/config.js` | P1: Add 3 fields to economy whitelist |
| Modify | `express-api/src/routes/admin-cleanup.js` | P2: Add per-user coin/bean cleanup endpoints |
| Modify | `express-api/src/routes/test-helpers.js` | P3: Seed banners/funFacts/reports/appeals/alerts/conversations + teardown + verify |
| Modify | `express-api/tests/routes/test-helpers.test.js` | Tests for P1-P3 |
| Modify | `tests/web/helpers/api.ts` | P4: Extend SetupPayload/SetupResult types |
| Modify | `tests/web/fixtures/admin.ts` | P4: Extend TestData + fixture body |
| Create | `tests/web/admin-gifts.spec.ts` | 14 tests |
| Create | `tests/web/admin-banners.spec.ts` | 12 tests |
| Create | `tests/web/admin-funfacts.spec.ts` | 10 tests |
| Create | `tests/web/admin-economy-config.spec.ts` | 16 tests |
| Create | `tests/web/admin-spin-monitor.spec.ts` | 10 tests |
| Create | `tests/web/admin-appeals.spec.ts` | 10 tests |
| Create | `tests/web/admin-reports.spec.ts` | 20 tests |
| Create | `tests/web/admin-logs.spec.ts` | 20 tests |
| Create | `tests/web/admin-devices.spec.ts` | 14 tests |
| Create | `tests/web/admin-backups.spec.ts` | 8 tests |
| Create | `tests/web/admin-maintenance.spec.ts` | 16 tests |
| Create | `tests/web/admin-users-extra.spec.ts` | 16 tests |
| Create | `tests/web/admin-alerts.spec.ts` | 8 tests |
| Create | `tests/web/admin-cross-tab.spec.ts` | 12 tests |
| Create | `tests/web/admin-validation.spec.ts` | 10 tests |
| Create | `tests/web/admin-empty-states.spec.ts` | 12 tests |
| Create | `tests/web/admin-keyboard.spec.ts` | 8 tests |
| Create | `tests/web/admin-realtime.spec.ts` | 8 tests |
| Create | `tests/web/admin-console-errors.spec.ts` | 4 tests |
| Delete | `tests/web/admin-tabs.spec.ts` | Old shallow tests |

---

## Chunk 1: Backend Prerequisites (P1-P3)

### Task 1: P1 — Extend economy config API whitelist

**Files:**
- Modify: `express-api/src/routes/config.js`
- Test: `express-api/tests/routes/config.test.js`

- [ ] **Step 1: Write failing test** — test that `PUT /api/config/economy` with `wheelInnerThreshold`, `maxRoomDurationMinutes`, `superShyRoomDurationMinutes` persists these fields.

- [ ] **Step 2: Run test** — should FAIL (fields dropped by whitelist)

- [ ] **Step 3: Add 3 fields to `ECONOMY_CONFIG_FIELDS` array** in `config.js`:
```javascript
'wheelInnerThreshold',
'maxRoomDurationMinutes',
'superShyRoomDurationMinutes',
```

- [ ] **Step 4: Run test** — should PASS

- [ ] **Step 5: Run full suite** — `cd express-api && npm test` — no regressions

- [ ] **Step 6: Commit** — `git commit -m "feat: add wheelInnerThreshold + room durations to economy config whitelist"`

### Task 2: P2 — Add per-user cleanup endpoints

**Files:**
- Modify: `express-api/src/routes/admin-cleanup.js`
- Test: `express-api/tests/routes/admin-cleanup.test.js`

- [ ] **Step 1: Write failing tests** for `POST /api/cleanup/user-coins/:uniqueId` and `POST /api/cleanup/user-beans/:uniqueId` — each should reset the specified user's balance to 0, require admin auth.

- [ ] **Step 2: Run tests** — should FAIL

- [ ] **Step 3: Implement both endpoints** as specified in the spec (P2 section). Both require admin, update a single user doc, return `{ success: true }`.

- [ ] **Step 4: Run tests** — should PASS

- [ ] **Step 5: Run full suite** — no regressions

- [ ] **Step 6: Commit** — `git commit -m "feat: per-user coin/bean cleanup endpoints for safe E2E testing"`

### Task 3: P3 — Extend test-helpers.js (setup + teardown + verify)

**Files:**
- Modify: `express-api/src/routes/test-helpers.js`
- Test: `express-api/tests/routes/test-helpers.test.js`

This is the largest backend task. Add seeding loops for 6 new data types.

- [ ] **Step 1: Add `banners` and `funFacts` seeding loops** — same pattern as `gifts`. Each doc gets `_testRun: testRunId`. Return created data.

- [ ] **Step 2: Write tests** for banner/funFact seeding — verify docs created with correct fields, `_testRun` set.

- [ ] **Step 3: Run tests** — should PASS

- [ ] **Step 4: Add `reports` seeding** — use index-based user references (`reportedUserIndex`, `reporterUserIndex`). Resolve to actual `uid`/`uniqueId` from the `created.users` array. Store with production field names: `reportedUserId`, `reporterId`, `reportedUserUniqueId`, `reason`, `status`.

- [ ] **Step 5: Add `suspensionAppeals` seeding** — resolve `userIndex` to the user's numeric `uniqueId`. Set `isSuspended: true` and `suspensionCanAppeal: true` on the referenced user doc. Store with `userId: user.uniqueId`.

- [ ] **Step 6: Add `alerts` seeding** — simple doc creation with `type`, `severity`, `message`, `status`, `createdAt`, `_testRun`.

- [ ] **Step 7: Add `conversations` seeding** — create conversation doc with `participants` array, then create message subcollection docs.

- [ ] **Step 8: Add economy config backup** — read `config/economy` doc, store in response as `economyConfig`. (No `_testRun` tagging — this is a backup, not seeded data.)

- [ ] **Step 9: Extend teardown** — add `'reports', 'suspensionAppeals', 'alerts'` to `otherCollections` array. Also restore economy config from backup if present.

- [ ] **Step 10: Extend verify allowlist** — add `'reports', 'suspensionAppeals', 'alerts'` to `ALLOWED_COLLECTIONS`.

- [ ] **Step 11: Write tests** for all new seed types + teardown + verify.

- [ ] **Step 12: Run full suite** — all tests pass

- [ ] **Step 13: Commit** — `git commit -m "feat: extend test-helpers with banners, funFacts, reports, appeals, alerts, conversations seeding"`

### Task 4: Deploy backend to dev

- [ ] **Step 1: Push branch** — `git push`

- [ ] **Step 2: Wait for Release Pipeline** to deploy backend to dev

- [ ] **Step 3: Verify health** — `curl https://dev-api.shytalk.shyden.co.uk/api/health`

---

## Chunk 2: Playwright Infrastructure (P4)

### Task 5: Extend API types + fixture

**Files:**
- Modify: `tests/web/helpers/api.ts`
- Modify: `tests/web/fixtures/admin.ts`

- [ ] **Step 1: Extend `SetupPayload`** in `api.ts` with all new seed type interfaces (banners, funFacts, reports, appeals, alerts, conversations).

- [ ] **Step 2: Extend `SetupResult`** with the matching return types including `economyConfig`.

- [ ] **Step 3: Extend `TestData` interface** in `admin.ts` with `secondUser`, `gift`, `banner`, `funFact`, `report`, `appeal`, `alert`, `conversation`, `economyConfig`.

- [ ] **Step 4: Update fixture body** — the `testSetup` call must seed 2 users, 1 gift, 1 banner, 1 funFact, 1 report (user 0 reported by user 1), 1 appeal (for user 0, set suspended+canAppeal), 1 alert, 1 conversation. Store all in `use()`.

- [ ] **Step 5: Verify compilation** — `npx playwright test --list 2>&1 | head -5`

- [ ] **Step 6: Commit** — `git commit -m "feat: extend testData fixture with all Phase 2-3 seed types"`

### Task 6: Delete old admin-tabs.spec.ts

- [ ] **Step 1: Delete** — `rm tests/web/admin-tabs.spec.ts`

- [ ] **Step 2: Verify** — `npx playwright test --list 2>&1 | grep chromium | wc -l` — count should decrease by the old tab test count

- [ ] **Step 3: Commit** — `git commit -m "chore: remove old shallow admin-tabs tests — replaced by per-tab deep tests"`

---

## Chunk 3: Content Tab Tests (Tasks 7-11)

Each task creates one test file. The implementing agent must:
1. Read the spec section for the file
2. Read `public/admin/index.html` to find DOM selectors
3. Write the test using `{ test, expect }` from `'./fixtures/admin'` and `testData`
4. Use `adminLogin(page)` + `navigateToTab(page, tabName)` in `beforeEach`
5. Use `testData.api.get/post/patch/delete` for API verification
6. Always restore state at end of mutating tests
7. Run locally to verify — fix real bugs found in the admin panel

### Task 7: admin-gifts.spec.ts (14 tests)

**Files:**
- Create: `tests/web/admin-gifts.spec.ts`
- Reference: `public/admin/index.html` (gift table, `#gift-add-btn`, `#gift-apply-btn`, `#gift-discard-btn`, `#gift-confirm-overlay`)
- Reference: Spec section "admin-gifts.spec.ts"

- [ ] **Step 1: Write all 14 tests** — CRUD, staging, confirm dialog, undo, reorder, all fields
- [ ] **Step 2: Run locally** — `npx playwright test tests/web/admin-gifts.spec.ts --project=chromium`
- [ ] **Step 3: Fix real bugs found** — investigate admin panel/API code
- [ ] **Step 4: Commit** — `git commit -m "test: deep gift tests — CRUD, staging, confirm dialog, all fields"`

### Task 8: admin-banners.spec.ts (12 tests)

**Files:**
- Create: `tests/web/admin-banners.spec.ts`
- Reference: `public/admin/index.html` (`#banner-add-btn`, `#banner-dialog-overlay`, `#banner-action-type`)
- Reference: Spec section "admin-banners.spec.ts"

- [ ] **Step 1: Write all 12 tests** — CRUD, drag-drop, image upload, action types (NONE/URL/SCREEN), dates, active toggle
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep banner tests — CRUD, drag-drop, action types, image upload"`

### Task 9: admin-funfacts.spec.ts (10 tests)

**Files:**
- Create: `tests/web/admin-funfacts.spec.ts`
- Reference: `public/admin/index.html` (`#funfact-add-btn`, `#funfact-dialog-overlay`)
- Reference: Spec section "admin-funfacts.spec.ts"

- [ ] **Step 1: Write all 10 tests** — CRUD, all fields, drag-drop, active toggle
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep fun fact tests — CRUD, categories, emoji, active toggle"`

### Task 10: admin-economy-config.spec.ts (16 tests)

**Files:**
- Create: `tests/web/admin-economy-config.spec.ts`
- Reference: `public/admin/index.html` (`#eco-beanConversionRate`, `#eco-pullCost-*`, `#eco-pity*`, `#eco-dailyBase`, `#ms-add-btn`, `#eco-save-btn`)
- Reference: Spec section "admin-economy-config.spec.ts"

**IMPORTANT:** This file MUST use `test.describe.configure({ mode: 'serial' })` and skip in non-chromium projects:
```typescript
test.skip(({ browserName }) => browserName !== 'chromium', 'Economy config is a singleton');
```

- [ ] **Step 1: Write all 16 tests** — all config sections, sliders, milestones, save + reload verify. Each test restores from `testData.economyConfig` backup.
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep economy config tests — all sections, milestones, sliders"`

### Task 11: admin-spin-monitor.spec.ts (10 tests)

**Files:**
- Create: `tests/web/admin-spin-monitor.spec.ts`
- Reference: `public/admin/index.html` (`#monitor-uid-input`, `#monitor-start-btn`, `#monitor-stop-btn`, `#guarantee-*`)
- Reference: Spec section "admin-spin-monitor.spec.ts"

- [ ] **Step 1: Write all 10 tests** — start/stop, live stats, guarantee set/revoke, Enter key
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep spin monitor tests — monitoring lifecycle, guarantee CRUD"`

---

## Chunk 4: Operations Tab Tests (Tasks 12-17)

### Task 12: admin-appeals.spec.ts (10 tests)

**Files:**
- Create: `tests/web/admin-appeals.spec.ts`
- Reference: Spec section "admin-appeals.spec.ts"

Precondition: test user must be suspended with appeal seeded (handled by fixture).

- [ ] **Step 1: Write all 10 tests** — filter, approve (auto-unsuspend verify), deny, evidence lightbox, profile preview
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep appeal tests — approve/deny lifecycle, auto-unsuspend, evidence"`

### Task 13: admin-reports.spec.ts (20 tests)

**Files:**
- Create: `tests/web/admin-reports.spec.ts`
- Reference: Spec section "admin-reports.spec.ts"

- [ ] **Step 1: Write all 20 tests** — resolve single/bulk, severity, lock/unlock, stats, CSV export, keyboard shortcuts, conversation viewer, evidence, take-over, audit log, cross-check warn→user history
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep report tests — resolve lifecycle, keyboard shortcuts, cross-checks"`

### Task 14: admin-logs.spec.ts (20 tests)

**Files:**
- Create: `tests/web/admin-logs.spec.ts`
- Reference: Spec section "admin-logs.spec.ts"

Config-modifying tests (13-14) must use chromium-only skip guard.

- [ ] **Step 1: Write all 20 tests** — filters, trace viewer, alerts, config, live mode, export, pagination
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep log tests — filters, trace viewer, alerts, live mode, export"`

### Task 15: admin-devices.spec.ts (14 tests)

**Files:**
- Create: `tests/web/admin-devices.spec.ts`
- Reference: Spec section "admin-devices.spec.ts"

Device data comes from Phase 1 fixture (`e2e-{prefix}-device`).

- [ ] **Step 1: Write all 14 tests** — search, pagination, detail expand, unbind, ban device/network, cross-nav
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep device tests — search, pagination, unbind, ban, cross-nav"`

### Task 16: admin-backups.spec.ts (8 tests)

**Files:**
- Create: `tests/web/admin-backups.spec.ts`
- Reference: Spec section "admin-backups.spec.ts"

- [ ] **Step 1: Write all 8 tests** — trigger, list, download, restore modes, recover photos
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep backup tests — trigger, restore, recover photos"`

### Task 17: admin-maintenance.spec.ts (16 tests)

**Files:**
- Create: `tests/web/admin-maintenance.spec.ts`
- Reference: Spec section "admin-maintenance.spec.ts"

Tests 9-10 use per-user endpoints from P2. Test 15 (nuclear) cancels at last step.

- [ ] **Step 1: Write all 16 tests** — individual cleanup ops, storage audit, nuclear 3-step dialog, confirm/cancel behavior
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep maintenance tests — cleanup ops, storage audit, nuclear dialog"`

---

## Chunk 5: User Extra + Alert + Cross-Cutting Tests (Tasks 18-25)

### Task 18: admin-users-extra.spec.ts (16 tests)

**Files:**
- Create: `tests/web/admin-users-extra.spec.ts`
- Reference: Spec section "admin-users-extra.spec.ts"

- [ ] **Step 1: Write all 16 tests** — DOB, photo URLs, privacy toggles, char counters, clear buttons, temp ID CRUD, list editing, stalkers, login streak, pre-suspension display
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep user extra tests — all remaining profile fields, temp ID, lists"`

### Task 19: admin-alerts.spec.ts (8 tests)

**Files:**
- Create: `tests/web/admin-alerts.spec.ts`
- Reference: Spec section "admin-alerts.spec.ts"

Alert config test uses chromium-only skip. Mutation tests seed their OWN alert (not shared `testData.alert`).

- [ ] **Step 1: Write all 8 tests** — badge, list, acknowledge, resolve, config, cross-nav
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: deep alert tests — badge, lifecycle, config, trace cross-nav"`

### Task 20: admin-cross-tab.spec.ts (12 tests)

**Files:**
- Create: `tests/web/admin-cross-tab.spec.ts`
- Reference: Spec section "admin-cross-tab.spec.ts"

- [ ] **Step 1: Write all 12 tests** — report→warning, appeal→unsuspend, device→user nav, alert→logs, confirm cancel, toasts, error handling, button disable during API
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: cross-tab interaction tests — data flow, navigation, toasts, errors"`

### Task 21: admin-validation.spec.ts (10 tests)

**Files:**
- Create: `tests/web/admin-validation.spec.ts`
- Reference: Spec section "admin-validation.spec.ts"

- [ ] **Step 1: Write all 10 tests** — required fields, number validation, char limits, URL format, XSS, Unicode, double-click prevention, auto-save debounce
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: validation tests — input limits, XSS, Unicode, debounce"`

### Task 22: admin-empty-states.spec.ts (12 tests)

**Files:**
- Create: `tests/web/admin-empty-states.spec.ts`
- Reference: Spec section "admin-empty-states.spec.ts"

Uses a separate test run with minimal seeding.

- [ ] **Step 1: Write all 12 tests** — each tab with no data shows appropriate empty state
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: empty state tests — all tabs with no data"`

### Task 23: admin-keyboard.spec.ts (8 tests)

**Files:**
- Create: `tests/web/admin-keyboard.spec.ts`
- Reference: Spec section "admin-keyboard.spec.ts"

- [ ] **Step 1: Write all 8 tests** — Reports W/S/D/Enter, Search Enter, Lightbox Esc, Monitor Enter, Dialog Esc
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: keyboard shortcut tests — reports, search, lightbox, monitor"`

### Task 24: admin-realtime.spec.ts (8 tests)

**Files:**
- Create: `tests/web/admin-realtime.spec.ts`
- Reference: Spec section "admin-realtime.spec.ts"

- [ ] **Step 1: Write all 8 tests** — onSnapshot live updates, listener cleanup on tab switch/stop/sign-out
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: real-time tests — live updates, listener cleanup"`

### Task 25: admin-console-errors.spec.ts (4 tests)

**Files:**
- Create: `tests/web/admin-console-errors.spec.ts`
- Reference: Spec section "admin-console-errors.spec.ts"

- [ ] **Step 1: Write all 4 tests** — navigate all tabs, search user + subtabs, open/close dialogs, trigger/cancel ops — all with zero console errors
- [ ] **Step 2: Run locally + fix real bugs**
- [ ] **Step 3: Commit** — `git commit -m "test: console error tests — zero errors across all admin panel operations"`

---

## Chunk 6: Integration + CI

### Task 26: Full suite run + CI verification

- [ ] **Step 1: Run full Playwright suite locally** — `npx playwright test --project=chromium --reporter=list`
- [ ] **Step 2: Fix remaining bugs** found by the deep tests
- [ ] **Step 3: Run Express API tests** — `cd express-api && npm test` — all pass
- [ ] **Step 4: Push and create PR**
- [ ] **Step 5: Wait for Release Pipeline** to deploy backend
- [ ] **Step 6: Trigger E2E** — `/run-e2e web` on the PR
- [ ] **Step 7: Verify Allure report** generates and deploys correctly
- [ ] **Step 8: Fix any CI-specific failures** (browser differences, timing)

---

## Summary

| Chunk | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-4 | Backend prerequisites (P1-P3) + deploy |
| 2 | 5-6 | Playwright infrastructure (P4) + delete old tests |
| 3 | 7-11 | Content tab tests (gifts, banners, funFacts, economy, spin monitor) |
| 4 | 12-17 | Operations tab tests (appeals, reports, logs, devices, backups, maintenance) |
| 5 | 18-25 | User extra + alerts + cross-tab + validation + empty states + keyboard + realtime + console errors |
| 6 | 26 | Integration + CI verification |

**Total: 26 tasks, 228 new tests across 19 files**
