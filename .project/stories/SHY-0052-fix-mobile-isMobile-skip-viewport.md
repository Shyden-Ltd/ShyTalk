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

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (un-skips + rewrites 4 Playwright tests) → the FULL protocol applies. This is a **responsive-web admin** coverage fix.

**Frameworks exercised (RED→GREEN):**
- ✅ **Web E2E Playwright** — the 4 `admin-suggestions.spec.ts` tests with the skips removed + viewport-sizing rewrites, run against the **REAL rendered admin UI + real dev stack** (no mocked state, per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only) on Mac chromium/firefox/webkit/edge.
- ✅ **eslint** (`--max-warnings=0`) — the spec TS.
- ⬜ **Express Jest · Android/iOS app · Kotlin/detekt/ktlint** — N/A (web test only).

**No-Stubs — honest layering of "mobile":** viewport-sizing (`setViewportSize({375×667})`) tests **real responsive layout on real desktop engines** — that is the ticket's fix, and it is genuinely real at that layer. It is NOT a claim of real-mobile coverage: the **true mobile-browser assurance** comes from the protocol's real **Android-Chrome + iOS-Safari device-browser cells** (built by EPIC-0003), which run the same admin surface on real hardware. The two are complementary, not substitutes. **🚩** the Error-path note is correct under No-Stubs: if `isMobile` controls behaviour beyond layout (touch registration, viewport-meta parsing), viewport sizing can't replicate it → use Playwright's real touch context OR file a follow-up SHY — never assert mobile-only behaviour via a desktop viewport and call it covered.

**LOCAL gauntlet:** the 4 tests green on all Mac desktop browsers against the real local stack + the real Android + iOS device-browser cells as the true-mobile net; eslint clean; per-test viewport isolation verified. Any failure → fix TDD → restart.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-run the 4 tests on Chrome against the real dev stack. Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge.

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
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): the 4 tests green on all Mac desktop browsers (real admin UI + real stack) + the real Android/iOS device-browser cells as the true-mobile net + eslint clean → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green (Chrome) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 95 (G035). Reserved ID SHY-0052.
- 2026-06-13 ~01:16 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): responsive-web admin un-skip → Playwright headline on the real admin UI across Mac desktop browsers. No-Stubs ([[feedback-no-stubs-mocks-fakes-real-only]]) **honest-layering note:** viewport-sizing tests REAL responsive layout on real desktop engines (the fix), but is NOT real-mobile — the true mobile assurance is the real Android-Chrome + iOS-Safari device-browser cells (EPIC-0003); the two are complementary. **🚩** if `isMobile` drives behaviour beyond layout (touch/viewport-meta), use a real touch context or a follow-up SHY — never fake mobile-only behaviour via a desktop viewport. DoD swaps the stale Reviewer-ZERO line for protocol-satisfied + judgment-merge + released_in + `pr:`. Pickup-fitness: AC current; the 4 line numbers (`:1349,1402,1414,1426`) to re-confirm at pickup.
