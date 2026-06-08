---
id: SHY-0051
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: bug
roadmap_ids: [G034]
pr:
---

# SHY-0051: Convert Firefox/WebKit touch-skip in suggestions-board.spec.ts to mouse-event drag

## User Story

As a coverage-conscious ShyTalk maintainer, I want **`tests/web/suggestions-board.spec.ts:1252`'s Firefox/WebKit touch-event skip** (which permanently disables the test on 2 of 3 desktop browsers) **rewritten using `page.mouse.move/down/up` drag instead of touch events**, so that the suggestions-board drag behaviour is verified on Firefox + WebKit too, not just Chromium.

## Why

Roadmap row (line 94, 2026-06-05): `G034 | 🟡 Polish | Firefox/WebKit touch limitation skip | tests/web/suggestions-board.spec.ts:1252 | Real browser limit but can use mouse-event equivalent | Convert to page.mouse.move based drag | XS`.

Permanent browser skips reduce coverage silently. Real desktop browsers DO support mouse drag (it's mobile-touch APIs that have FF/WebKit gaps). The fix is to use the universal mouse-event API which all 3 browsers support.

## Acceptance Criteria

### Happy path

- [ ] `tests/web/suggestions-board.spec.ts:1252` (or whatever line the skip lives on now): remove the `test.skip(browserName !== 'chromium', ...)` guard.
- [ ] Replace the touch-event sequence with `await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 10 }); await page.mouse.up();` form.
- [ ] Test passes on `--project=chromium`, `--project=firefox`, `--project=webkit`.
- [ ] No other skips introduced.

### Error paths

- [ ] **Drag interaction relies on touch-specific event listeners** in the suggestions-board component: file a follow-up SHY to add mouse-event handlers if needed; this SHY ships either the test pass OR explicit "implementation requires component change" Notes.
- [ ] **One browser flakes on the new drag** (e.g. webkit needs more steps): tune the `steps` parameter; document the per-browser minimum.

### Edge cases

- [ ] **Mobile webkit (real Safari) still uses touch** — out of scope; this SHY only fixes desktop browser coverage. Mobile is a separate concern.
- [ ] **Drag distance calibration** — coordinates must be relative to viewport; use `boundingBox()` to anchor.
- [ ] **Animation completion** — wait for the suggestion-card transition with `page.waitForFunction(...)` or explicit selector visibility.

### Performance

- [ ] Per-browser test runtime delta: <500ms (mouse drag with 10 steps is faster than the touch dispatch).

### Security

- [ ] N/A.

### UX

- [ ] N/A — test only.

### i18n

- [ ] N/A.

### Observability

- [ ] CI report shows the test passing on all 3 desktop browsers post-merge.

## BDD Scenarios

**Scenario: Drag works on Chromium**

- **Given** `npx playwright test --project=chromium tests/web/suggestions-board.spec.ts` filtered to the drag test
- **When** the test runs
- **Then** the drag completes
- **And** the test passes

**Scenario: Drag works on Firefox**

- **Given** `--project=firefox` filter
- **When** the test runs
- **Then** the drag completes
- **And** the test passes (was: skipped)

**Scenario: Drag works on WebKit**

- **Given** `--project=webkit` filter
- **When** the test runs
- **Then** the drag completes
- **And** the test passes (was: skipped)

## Test Plan

**Red:** current `test.skip(browserName !== 'chromium', ...)` means the test is silently passing on FF+WK (skipped). Remove skip → red on FF+WK with touch-event-not-supported error.

**Green:**
- Replace touch-event sequence with mouse-event sequence.
- Run all 3 browsers.

**Coverage gate:** all 3 browser-project runs pass.

## Out of Scope

- Mobile-WebKit / mobile-Firefox coverage (separate SHY).
- Refactoring component to support both touch + mouse events.
- Other suggestion-board tests beyond the affected drag test.

## Dependencies

- Playwright config has all 3 desktop browser projects.
- Local stack + dev API (per [[reference-local-stack-runner-setup]]).

## Risks & Mitigations

- **Risk: component listens only to `touchstart`** — mouse drag won't trigger. Mitigation: read component source; if true, file follow-up component-update SHY + ship this with `.fixme`.
- **Risk: webkit headless behaves differently than headed.** Mitigation: verify in both modes locally before push.
- **Risk: drag distance flaky across viewports.** Mitigation: use `boundingBox()` for anchor.

## Definition of Done

- [ ] Skip removed.
- [ ] Mouse drag implemented.
- [ ] 3 browser projects pass.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 94 (G034). Reserved ID SHY-0051.
