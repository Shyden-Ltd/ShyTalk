---
id: SHY-0174
status: In Progress
owner: claude
created: 2026-07-10
priority: P2
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0003
mvp: false
---

# SHY-0174: 100 Playwright tests assert nothing, and every one of them reports as passing

## User Story

**As** an engineer reading a green Playwright run,
**I want** every test that reports "passed" to have actually checked something,
**So that** the number on the screen means the product works, not that a function returned without throwing.

## Why

The web suite reports ~4,500 passing tests. **100 of them contain no assertion at all.** They cannot fail. Several have empty bodies with only a comment describing what they were meant to check:

```ts
test('switch language: all buttons translated', async ({ page }) => {
  // After language switch, button labels should be translated
});
```

Others go through the motions and then stop before checking anything:

```ts
test('switch language: all headings translated', async ({ page }) => {
  const switcher = page.locator('.lang-selector, …');
  if ((await switcher.count()) > 0) {
    await switcher.click();
    const deOption = page.locator('[data-lang="de"], …');
    if ((await deOption.count()) > 0) {
      await deOption.click();
      await page.waitForTimeout(1000);
      // Page content should be in German
    }
  }
});
```

Note the nested `if (count() > 0)`: even if it *did* assert, the whole body is skipped when the locator misses. A test that vanishes when its target is absent is a test that cannot detect the target being absent.

Distribution (assertion-free / total):

| Spec | Hollow | Total |
|---|---|---|
| `tests/web/suggestions-subscribe.spec.ts` | 29 | 32 |
| `tests/web/suggestions-board.spec.ts` | 25 | 140 |
| `tests/web/suggestions-security.spec.ts` | 17 | 33 |
| `tests/web/roadmap-auth.spec.ts` | 11 | 70 |
| `tests/web/roadmap-redesign.spec.ts` | 9 | 44 |
| `tests/web/admin-maintenance.spec.ts` | 3 | 18 |
| `tests/web/admin-suggestions.spec.ts` | 3 | 93 |
| `tests/web/admin-keyboard.spec.ts` | 1 | 9 |
| `tests/web/admin-users-room-cascade.spec.ts` | 1 | 7 |
| `tests/web/portal-a11y.spec.ts` | 1 | 54 |

`suggestions-subscribe.spec.ts` is the worst: **29 of its 32 tests prove nothing**. Its green tick has been meaningless since it was written.

This is worse than `test.skip`. A skipped test is *visibly* absent and shows up in the summary as skipped. An assertion-free test is counted as a pass, inflates coverage, and actively suppresses the suspicion that the behaviour is untested. It is the same defect class as a tautological unit test — see [[feedback-test-must-fail-if-logic-skipped]] — and the same one as a detector that quietly reports nothing — see [[feedback-detector-must-report-not-guess]].

Surfaced while working [[SHY-0149]], which touched `suggestions-security.spec.ts` and implemented 4 of its hollow tests (the banned/suspended-user cases). That story added none and fixed four; the remaining 100 are pre-existing on `develop`.

## Acceptance Criteria

### Happy path
- [ ] Every `test(...)` in `tests/web/**` contains at least one assertion that can fail.
- [ ] The behaviours each hollow test names are actually verified — the test title is the specification, and the implementation must match it.

### Error paths
- [ ] No test body is wrapped in an `if (await locator.count() > 0)` guard that lets it silently no-op when the element is missing. If the element is required, assert it is present.

### Edge cases
- [ ] A test whose behaviour turns out not to exist in the product is either implemented against the real behaviour, or deleted with a note — never left as a green stub.
- [ ] Tests that genuinely need no `expect` (e.g. a navigation smoke that relies on `page.goto` throwing) are documented as such and exempted explicitly, not by omission.

### Performance
- [ ] No more than a ~15% increase in web-suite wall clock (the suite is ~6,900 tests / ~1.7h; these 100 add real work).

### Security
- N/A — test-correctness change; no production surface. (Note: 17 of the hollow tests live in `suggestions-security.spec.ts`, so closing them *increases* real security coverage.)

### UX
- N/A — no user-facing surface.

### i18n
- [ ] The eight `switch language: …` tests must verify translated text against `public/js/suggestions-i18n.js`, not against hardcoded strings duplicated in the spec.

### Observability
- [ ] A CI ratchet fails the build when a `tests/web/**` test contains no assertion, with the count only allowed to shrink — the same shape as `scripts/check-no-new-stubs.js`.

## BDD Scenarios

**Scenario: a test that checks nothing**
- **Given** a test that describes a behaviour in its title
- **And** a body that never checks that behaviour
- **When** the suite runs
- **Then** the build fails and names the test, rather than counting it as a pass

**Scenario: the thing under test has disappeared**
- **Given** a test whose target element is no longer on the page
- **When** the test runs
- **Then** it fails, rather than quietly doing nothing

**Scenario: switching language**
- **Given** the roadmap page in English
- **When** a reader switches the language to German
- **Then** the headings, buttons, status badges and form labels all read in German

## Test Plan

Touches `tests/web/**` and adds one CI ratchet script → no product runtime surface. The device gauntlet does not apply; the full browser matrix does.

**Order matters — the ratchet first, so the work is measurable:**
1. Write `scripts/check-no-assertion-free-web-tests.js` with a baseline of 100. RED: it must fail if the baseline is lowered by one without a fix. Wire it into `lint.yml` beside the existing ratchets.
2. Take the specs worst-first (`suggestions-subscribe` 29, `suggestions-board` 25, `suggestions-security` 17). For each hollow test: read its title, determine the real behaviour from the product code, write the assertion, watch it fail against a deliberately broken page, then pass. Lower the baseline in the same commit.
3. Remove every `if (await locator.count() > 0)` no-op guard, replacing it with `await expect(locator).toBeVisible()`.
4. Run the full matrix (chromium, firefox, webkit, mobile-safari) with CI's env, reseeding first — see [[feedback-never-run-jest-and-playwright-together]].

**Static/quality:** `npm run lint` 0 warnings; prettier clean. Verify with `grep -E "error|warning|problem"`, never a `tail` window.

Expect this to surface real product bugs: 17 of these sit in a *security* spec, and the four this story's parent implemented (`banned user: direct API call returns 403`, `no vote/comment/suggest buttons visible`, `sees suggestions (read-only)`, `suspended user: page shows suspension message`) each needed a product fix to pass.

## Out of Scope
- Unit- and integration-test tautologies outside `tests/web/**`.
- The `tests/web/**` specs' flakiness or runtime, except as bounded by the performance AC.

## Dependencies
- `public/js/suggestions-i18n.js` (the translation source of truth for the eight language tests).
- `scripts/check-no-new-stubs.js` as the ratchet template.

## Risks & Mitigations
- **Risk:** implementing 100 tests surfaces a flood of real product bugs and the story never lands. **Mitigation:** each spec file is an independent slice with its own PR; a discovered product bug is filed as its own story and the test is left failing only if the bug is fixed in the same PR, never skipped.
- **Risk:** the ratchet is added and then never driven to zero. **Mitigation:** the baseline may only shrink; the AC requires it to reach 0 for `tests/web/**`.
- **Risk:** a hollow test names a behaviour the product never had. **Mitigation:** delete it with a note in the running log, do not invent behaviour to match a title.

## Definition of Done
- [ ] Zero assertion-free tests under `tests/web/**`; the ratchet enforces it.
- [ ] Full browser matrix green. `code-reviewer` 100% clean → In Review → CI green by name → merge → `released_in:` on the next cut.

## Notes (running log)

Reviewed-up-to: d5a9d20ae96

- 2026-07-12 ~11:30 WIB — **Increment 1 (this PR): the 3 Admin Audit Log filter tests** (`tests/web/admin-suggestions.spec.ts` — filter by admin user / action type / target type). Surfaced as a HARD BLOCKER: they FAILED in the SHY-0151 pre-push chromium suite (2 of 3 red) after a journey-matrix run churned the emulator audit data. Root cause (verified, NOT a product bug): `waitForAuditLogLoaded` returned as soon as the tbody had *any* `<tr>` — already true from the PREVIOUS test's STALE rows AND from `load()`'s synchronous "Loading…" placeholder `<tr>` — so the assertion read pre-filter/placeholder rows and failed non-deterministically (received target-type "user"/""/"unknown"). The server filter works (`admin-audit-log.js:126-135` targetId overload) and the web sends it (`audit-log.js:72`). **Two-part fix:** (a) new `searchAuditLogAndWaitForResponse(page, paramMatch)` waits for the specific FILTERED API response — a signal independent of the asserted row content, so non-tautological; (b) `waitForAuditLogLoaded` now waits for a REAL data cell (`.audit-admin-name`, present on every `buildRow`) rather than "any `<tr>`", so it can never settle on the unclassed Loading placeholder (closes the residual race for ALL callers). **`count > 0` no-op guards REMOVED** — each test now asserts `count > 0` then content: once real rows render, the filter always yields matches (real backend admin/approve/suggestion entries, or the spec's real-first route falling back to the static `MOCK_AUDIT_ENTRIES`, all of which match these three filter values). **code-reviewer R1 (1 Crit + 2 Imp) CORRECTED MY FIRST DIAGNOSIS:** I had initially retained the guards claiming "Firestore propagation" flakes, but the reviewer traced the spec's own real-first/static-fallback mock and showed it GUARANTEES non-empty for these filters — the observed flake was actually the Loading-placeholder race (fix b), not data availability. Applied fix (b) + the non-empty asserts; both together are clean. **Verified:** full `admin-suggestions.spec.ts` chromium **91 passed / 0 flaky / 0 failed ×2 runs**; the 3 filter tests green on **firefox + webkit** too (edge = chromium engine, not a separate local project). **Remaining SHY-0174 scope (future increments):** the ~100 assertion-free tests; the `check-no-assertion-free-web-tests.js` ratchet; and two SIBLING tests in this same describe block still carrying the pre-fix pattern — `filter by date range works` and `combined filters work` (both call `waitForAuditLogLoaded` directly + assert only `.not.toBeNaN()`, which can't fail) — left per the phased "worst-first" plan; any future strengthening must adopt `searchAuditLogAndWaitForResponse`. Story stays In Progress.
- 2026-07-10 — **CREATED fully-refined** while working [[SHY-0149]]. That story touched `suggestions-security.spec.ts`, implemented 4 of its hollow tests, and added none — but a scan of `tests/web/**` found **100 tests with no assertion in any body**, across 10 files, all pre-existing on `develop`. `suggestions-subscribe.spec.ts` is 29 of 32. The suite reports ~4,500 passes; ~2% of them are unconditional. Filed rather than folded in: it is a large, independent body of work whose slices each need a real browser matrix run, and several will surface product bugs that deserve their own stories. The defect class is the one [[feedback-test-must-fail-if-logic-skipped]] names — green is not evidence unless red was reachable.
