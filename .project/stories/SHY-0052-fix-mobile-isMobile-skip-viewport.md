---
id: SHY-0052
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: S
type: bug
roadmap_ids: [G035]
pr:
mvp: true
---

# SHY-0052: Rewrite admin-suggestions.spec.ts mobile-context skips using viewport sizing

## User Story

As a coverage-conscious ShyTalk maintainer, I want **the 4 permanently-skipped tests at `tests/web/admin-suggestions.spec.ts:1349,1402,1414,1426`** (skipped because Mobile-Firefox + Mobile-WebKit Playwright projects use `isMobile: true` context which some assertions rely on) **rewritten using viewport sizing instead of `isMobile` context detection**, so that responsive-layout coverage extends beyond Mobile-Chromium.

## Why

Roadmap row (line 95, 2026-06-05): `G035 | 🟡 Polish | Mobile FF/WebKit isMobile-context skip | tests/web/admin-suggestions.spec.ts:1349,1402,1414,1426 | Permanently skipped; underlying behavior (responsive layout) testable via viewport sizing | Rewrite using viewport sizing instead of isMobile context | S`.

4 skipped tests × 2 browser projects = 8 silently-uncovered combinations.

## Acceptance Criteria

### Happy path

- [ ] Read the 4 skipped tests; identify what `isMobile`-dependent behaviour each tests (likely responsive-layout breakpoints).
- [ ] Rewrite each using `page.setViewportSize({ width: 375, height: 667 })` (typical mobile viewport) + assertions on resulting layout rather than the `isMobile` browser-context flag.
- [ ] Remove the skip guards.
- [ ] All 4 tests pass on Chromium + Firefox + WebKit (desktop AND mobile projects).
- [ ] No other skips introduced; no new flakiness.

### Error paths

- [ ] **`isMobile` context controls something beyond layout** (e.g. touch-event registration, viewport-meta parsing): viewport sizing alone won't replicate; file follow-up SHY for the genuinely-mobile-only path.
- [ ] **Layout breakpoint differs from typical mobile width**: read the CSS / responsive-utility component to find the actual breakpoint; use it.
- [ ] **Tests become flaky on real mobile projects** (touch event timing): use `waitForLoadState('networkidle')` + element visibility.

### Edge cases

- [ ] **Viewport reset between tests** — Playwright fixtures should isolate per-test; verify with explicit `setViewportSize` in beforeEach if needed.
- [ ] **Test depends on touch interaction** as well as layout: handle touch separately via touch APIs (Playwright supports touch via context option).
- [ ] **Different breakpoints for tablet vs phone** — pick the smaller one that triggers the mobile layout.

### Performance

- [ ] Per-test delta: <500ms (viewport set is fast).

### Security

- [ ] N/A.

### UX

- [ ] Catches regressions in responsive layout on all 3 browser engines, not just one.

### i18n

- [ ] N/A.

### Observability

- [ ] CI report shows the 4 tests passing on all browser projects post-merge.

## BDD Scenarios

**Scenario: Test 1 passes on all browsers with viewport sizing**

- **Given** test at line 1349 is rewritten with viewport sizing
- **When** `npx playwright test --grep '<test 1 title>'` runs across all projects
- **Then** all project runs pass
- **And** zero skip markers remain in this test

**Scenario: Tests 2, 3, 4 — same as test 1**

- **Given** tests at lines 1402, 1414, 1426 are similarly rewritten
- **When** filtered runs execute
- **Then** all pass

**Scenario: Regression — adding a new isMobile-context skip is caught**

- **Given** future code attempts to add `test.skip(isMobile, ...)`
- **When** reviewer reads the diff
- **Then** the pattern is flagged + this SHY referenced as the proper fix-pattern

## Test Plan

**Red:**
- Current: each of the 4 tests has `test.skip(isMobile && ..., ...)`. Remove skip → red on mobile projects.

**Green:**
- Rewrite each to use viewport sizing.
- Run full Playwright suite + filter.

**Coverage gate:** 4 tests × N browser projects all green.

## Out of Scope

- Re-architecting the admin-suggestions component itself for better mobile support.
- Mobile-only behaviour beyond layout (touch interactions, viewport-meta parsing).
- Other isMobile-context skips elsewhere in the suite (separate SHYs if discovered).

## Dependencies

- Playwright projects config covering desktop + mobile.
- Local dev stack.

## Risks & Mitigations

- **Risk: `isMobile` controls more than layout.** Mitigation: check Playwright fixtures + component source.
- **Risk: rewriting breaks Mobile-Chromium coverage** that was working. Mitigation: re-run Chromium-mobile too.
- **Risk: tests flake on real mobile due to touch timing.** Mitigation: explicit waitForLoadState.

## Definition of Done

- [ ] 4 skips removed; viewport-based rewrites applied.
- [ ] All 4 tests pass on all browser projects.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 95 (G035). Reserved ID SHY-0052.
