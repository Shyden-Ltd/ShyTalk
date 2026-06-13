---
id: SHY-0057
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: bug
roadmap_ids: [G048]
pr:
mvp: true
---

# SHY-0057: Split admin-keyboard.spec.ts:61 mobile-viewport skip — keyboard-only vs general

## User Story

As a coverage-conscious ShyTalk maintainer, I want **`tests/web/admin-keyboard.spec.ts:61`'s mobile-viewport skip** (correctly skips the keyboard interaction tests on mobile but ALSO skips general non-keyboard assertions that COULD run on mobile) **split into 2 separate test blocks**, so that the non-keyboard parts of the suite run on mobile too.

## Why

Roadmap row (line 96, 2026-06-05): `G048 | 🟡 Polish | admin-keyboard mobile-viewport skip | tests/web/admin-keyboard.spec.ts:61 | Correct skip but should split test; non-keyboard parts should run on mobile | Split keyboard-only vs general; apply test.skip only to keyboard path | XS`.

The skip is correct (mobile has no physical keyboard) but too coarse — it's skipping more than it needs to.

## Acceptance Criteria

### Happy path

- [ ] Read `tests/web/admin-keyboard.spec.ts:61` + the test block it controls.
- [ ] Identify assertions in the block that DON'T depend on keyboard interaction (e.g. layout assertions, button visibility, copy assertions).
- [ ] Split the test block: KEYBOARD-only assertions stay skipped on mobile; non-keyboard assertions move to a separate `test()` block without the skip.
- [ ] Mobile-project runs of the suite gain coverage for the non-keyboard half.
- [ ] No regression in desktop coverage.

### Error paths

- [ ] **All assertions in the block ARE keyboard-dependent**: skip remains; document via comment that the audit confirmed; close as `Cancelled` with rationale.
- [ ] **Some assertions depend on viewport-specific layout**: rewrite using `page.setViewportSize` so they run on all projects via simulated mobile viewport.

### Edge cases

- [ ] **Test isolation** — splitting may require duplicating `beforeEach` setup; verify per-test idempotency.
- [ ] **Test naming** — give the split tests distinct, descriptive names.

### Performance

- [ ] Minor regression — one extra test block per file. Negligible.

### Security

- [ ] N/A.

### UX

- [ ] Catches mobile-layout regressions in admin-keyboard surface that previously slipped through.

### i18n

- [ ] N/A.

### Observability

- [ ] Per-project test counts post-merge show the new mobile coverage.

## BDD Scenarios

**Scenario: Mobile gains non-keyboard coverage**

- **Given** the block at line 61 is split into keyboard + non-keyboard
- **When** `--project='Mobile Chromium'` runs the file
- **Then** the non-keyboard test passes
- **And** the keyboard test is skipped

**Scenario: Desktop coverage unchanged**

- **Given** the block was split
- **When** `--project=chromium` runs
- **Then** both tests pass

**Scenario: All-keyboard case — cancellation**

- **Given** audit shows all assertions are keyboard-dependent
- **When** the contributor categorises
- **Then** SHY closes as `Cancelled` with the audit recorded

## Test Plan

**Red:**
- Current: `npx playwright test --project='Mobile Chromium' tests/web/admin-keyboard.spec.ts --list` shows the test at line 61 as SKIPPED.

**Green:**
- Audit + split.
- Re-run; verify mobile coverage delta.

**Coverage gate:** mobile project gains ≥1 passing test from this file (or audit-cancellation documented).

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (splits + un-skips part of a Playwright test) → the FULL protocol applies. Web admin surface; the headline is the non-keyboard half gaining real mobile coverage.

**Frameworks exercised (RED→GREEN):**
- ✅ **Web E2E Playwright** — the split `admin-keyboard.spec.ts`, run against the **REAL rendered admin UI + real dev stack** (no mocked state, per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only): the non-keyboard block on Mac desktop browsers + mobile projects; the keyboard-only block stays skipped on mobile.
- ✅ **eslint** (`--max-warnings=0`) — the spec TS.
- ⬜ **Express Jest · Android/iOS app · Kotlin/detekt/ktlint** — N/A (web test only).

**No-Stubs — the keyboard skip is a REAL constraint, not a stub:** a mobile device genuinely has no physical keyboard, so skipping the keyboard-only assertions on mobile is a legitimate real-condition skip (documented), NOT a coverage dodge — the bug being fixed is that the skip was too *coarse*. Honest-layering (as [[SHY-0052]]): if a split assertion needs viewport-specific layout, `setViewportSize` gives real responsive coverage on desktop engines, while the **real Android/iOS device-browser cells** are the true-mobile net. The **Cancelled** path (all assertions keyboard-dependent) is a valid audited outcome, recorded — never a silent leave-as-is.

**LOCAL gauntlet:** the non-keyboard block green on Mac desktop browsers + mobile projects against the real local stack + the real device-browser cells; per-test isolation verified ([[feedback-test-isolation-no-leaks]]); eslint clean. Any failure → fix TDD → restart.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-run the file on Chrome against the real dev stack. Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge. (If audited to Cancelled, the audit record + comment is the deliverable — no merge-gauntlet.)

## Out of Scope

- Other test.skip cases in admin-keyboard.spec.ts (covered by [[SHY-0023]] for data-fixture skips).
- Other admin-* spec files.
- Re-architecting the admin-keyboard page itself.

## Dependencies

- `tests/web/admin-keyboard.spec.ts` exists.
- Playwright mobile projects in config.

## Risks & Mitigations

- **Risk: split tests share state that becomes brittle.** Mitigation: per-test isolation per [[feedback-test-isolation-no-leaks]].
- **Risk: audit reveals nothing to split.** Mitigation: cancellation path documented.

## Definition of Done

- [ ] Block split OR cancellation recorded.
- [ ] No regression.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): the non-keyboard block green on desktop + mobile (real admin UI + real stack; keyboard block skipped on mobile = real constraint) + eslint clean → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green (Chrome) → **judgment-merge** (zero doubt; NO auto-merge). (Cancellation path: documented audit, no gauntlet.)
- [ ] `released_in: vX.Y.Z` set after the release cut (Done path only).
- [ ] `status: Done` or `Cancelled`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:22 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 96 (G048). Reserved ID SHY-0057.
- 2026-06-13 ~01:30 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): web-admin skip-split → Playwright headline (non-keyboard half gains real mobile coverage). No-Stubs ([[feedback-no-stubs-mocks-fakes-real-only]]): the keyboard-only skip on mobile is a REAL device constraint (no physical keyboard), legitimate + documented — the bug is that it was too coarse, not that it exists; honest-layering as [[SHY-0052]] (viewport = real desktop responsive; device-browser cells = true mobile). The Cancelled path (all-keyboard) is a valid audited outcome. DoD swaps the stale Reviewer-ZERO line for protocol-satisfied + judgment-merge + released_in(Done-path) + `pr:`. Pickup-fitness: AC current; the `:61` line number to re-confirm at pickup; [[SHY-0023]] covers the data-fixture skips in the same file (no overlap).
