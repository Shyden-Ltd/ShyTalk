---
id: SHY-0200
status: In Review
owner: claude
created: 2026-07-17
priority: P1
effort: S
type: bug
roadmap_ids: []
---

# SHY-0200: Stop the WebKit-only Playwright admin-test timeout cascade (trace DOM-snapshot cost)

## User Story

As an engineer running the ShyTalk web-e2e gauntlet, I want the WebKit and Mobile-Safari Playwright projects to pass reliably, so that a green webkit run reflects real product health instead of drowning in trace-capture-induced timeouts that hide the two genuine test bugs underneath.

## Why

The 2026-07-17 device-return develop gauntlet ran the full webkit project and produced **11 failed / 18 flaky / 25 did-not-run / 1306 passed in 1.2h** — while chromium (1378 passed) and firefox (1359 passed) were green on the same tree (develop `24e4aad0965`). Every failure was webkit-only, clustered on action-heavy / late-in-file admin tests (nuclear dialog, cross-tab, gifts, reports, users-*).

Root cause, proven by bisection (see Notes for the full trail):

1. **Playwright's `trace: 'retain-on-failure'` records a per-action DOM snapshot AND a screencast on every action.** The admin panel DOM is ~260 KB (1531 nodes — a legitimate 16-tab SPA). WebKit serialises that ~10x slower than Chromium, so every protocol action inflates from ~50 ms to ~0.5–2.5 s — **uniform latency, not a JS main-thread block** (wall-clock drift meters on both the persistent fixture page and the page-under-test stayed under 300 ms throughout). An action-heavy admin test (~8–10 actions) accrues enough per-action overhead to exceed its 20 s budget.
2. **`--trace off` on the reproducing case → 0 failures, median 0.40 s** (vs trace-on median 2.4 s, max 21 s). Granular bisection: `snapshots:false` alone cut the median but multi-file runs still timed out; `snapshots:false + screenshots:false` → median 0.49 s, max 5.4 s, cascade gone.
3. **Mobile-Safari (iPhone 13 device) uses the same WebKit engine**, so it carries the identical cost and would fail the same way once run.

This is the "root cause, not symptom" class: the fix removes the actual expensive operation for the WebKit-engine projects (keeping full traces on the fast Chromium/Firefox engines) rather than masking it with a larger timeout. Genuine, non-trace test bugs were unmasked once the cascade cleared (they had been drowned among the 18 flaky / 25 did-not-run) and are fixed here too:

- `portal-a11y` "Tab navigates through interactive elements" encoded Chromium's Tab order (WebKit/macOS omits buttons from the default Tab sequence).
- `admin-users-security` "reset PIN lockout" used a one-shot `textContent()` read that raced the WebKit render.
- `admin-keyboard` report action-shortcut tests (W/S/D) intermittently dropped the synthetic keydown on WebKit (the async card render lands between the ArrowDown selection and the letter press), AND the W test was a **tautology** — the action-select defaults to `warn` (its first `<option>`), so asserting `warn` passed even when the shortcut never fired.

## Acceptance Criteria

### Happy path
- [ ] The full `--project=webkit` Playwright suite passes with zero hard failures (previously 11).
- [ ] The `--project=mobile-safari` Playwright suite passes with zero hard failures.
- [ ] Chromium, Firefox, and mobile-chrome remain green and retain FULL traces (DOM snapshots + screencast) — the trace reduction is scoped to the two WebKit-engine projects only.

### Error paths
- [ ] When a WebKit test genuinely fails, its retained trace still contains the action log, network log, source, and a single on-failure screenshot (via `use.screenshot: 'only-on-failure'`) — enough to diagnose, even without the DOM-snapshot time-travel.
- [ ] `portal-a11y` "Tab navigates through interactive elements" FAILS if either OAuth button becomes non-focusable (e.g. regressed to a `<div>` without tabindex) or loses its accessible name — the rewritten assertion is not a tautology.
- [ ] `admin-users-security` "reset PIN lockout" FAILS if `#pin-is-locked` settles to anything other than `No`.
- [ ] `admin-keyboard` "W key selects warn" FAILS if the W shortcut never fires — the test first sets the select to `suspend`, so a passing `warn` assertion proves W actually ran (no longer a default-value tautology). The retry helper re-presses only the SAME key, so it cannot paper over a wrong-key mapping.

### Edge cases
- [ ] `WEBKIT_TRACE` is applied to BOTH `webkit` and `mobile-safari` projects (mobile-safari = iPhone 13 = WebKit engine); mobile-chrome (Pixel 5 = Chromium) is untouched.
- [ ] The reduced trace still writes a `trace.zip` on failure (mode stays `retain-on-failure`), so CI artefact upload paths are unchanged.

### Performance
- [ ] Full webkit suite wall-clock drops from ~1.2 h to ≤ ~20 min (measured: 17.4 min) — the trace overhead was also inflating pass times.
- [ ] No new Firestore reads/writes; change is test-harness config + two test-file assertions only.

### Security
- N/A — test-harness configuration and test assertions only; no product runtime, auth, or data-plane surface touched. The Allure `detail:false` password-leak guard in `playwright.config.ts` is unchanged.

### UX
- N/A — no user-facing surface changes (no `app/`, `iosApp/`, `shared/`, `express-api/`, or `public/` change).

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] The `WEBKIT_TRACE` const and both WebKit-engine project definitions carry comments explaining WHY snapshots/screenshots are off (the webkit serialisation cost), so a future reader does not "restore" them and reintroduce the cascade.

## BDD Scenarios

**Scenario: the webkit gauntlet reflects real health**
- **Given** the admin panel works correctly in Safari
- **When** an engineer runs the full WebKit Playwright suite
- **Then** it passes without timing out
- **And** it finishes in minutes, not over an hour

**Scenario: a real webkit failure is still diagnosable**
- **Given** a WebKit test genuinely fails
- **When** the engineer opens its retained trace
- **Then** they see the action log, the network calls, the source, and a screenshot of the failure

**Scenario: keyboard accessibility is verified honestly across engines**
- **Given** the portal sign-in buttons are real, focusable, named buttons
- **When** the a11y test runs on WebKit (where macOS omits buttons from the default Tab order)
- **Then** it confirms the buttons are focusable and named, rather than demanding they appear in WebKit's default Tab sequence
- **And** the same test still passes on Chromium and Firefox

**Scenario: the PIN-lockout status is read after it settles**
- **Given** a user with no PIN lockout
- **When** the security subtab renders the "is locked" field on WebKit
- **Then** the test waits for the field to settle on "No" instead of reading it once mid-render

## Test Plan

- **RED evidence (pre-fix, captured this session):** full `npx playwright test --project=webkit` = 11 failed / 18 flaky / 25 did-not-run / 1306 passed, 1.2 h (log `pw-webkit.log`). Reproducing subset: `admin-maintenance.spec.ts --project=webkit --repeat-each=8` = 12–15 timeouts, median 2.4 s, max 21 s. `portal-a11y.spec.ts:168 --project=webkit` = hard fail (`focusedElements` missing the buttons). `admin-users-security.spec.ts:153 --project=webkit --repeat-each=6` = 3/6 fail on `toBe('No')`.
- **GREEN (post-fix, verified this session):**
  - `playwright.config.ts` `WEBKIT_TRACE = { mode:'retain-on-failure', snapshots:false, screenshots:false, sources:true }` on webkit + mobile-safari → `admin-maintenance ×8 webkit` 0 fail (med 0.49 s, max 5.4 s); 8-admin-file webkit set 0 hard fail (med 0.49 s, max 5.4 s); **full webkit suite 1 fail / 2 flaky / 1355 passed, 17.4 min** (the 1 fail = portal-a11y, fixed below).
  - `tests/web/portal-a11y.spec.ts:168` rewritten (assert inputs in Tab order + buttons focusable with accessible name) → passes on webkit + chromium + firefox (3/3).
  - `tests/web/admin-users-security.spec.ts:153` one-shot `textContent()` → retrying `toHaveText('No')` (both branches) → `×10 webkit` 10/10 pass (was ~50%).
  - `tests/web/admin-keyboard.spec.ts` W/S/D report-shortcut tests → new `pressReportActionKey()` retry helper (re-presses the same key until the select settles, absorbing the WebKit keydown race) + W test de-tautologised (sets `suspend` first, then asserts `warn`) → `admin-keyboard ×6 webkit` 48/48 pass (S-key was ~40–80% fail).
- **Regression:** full webkit suite green (re-run in DoD); chromium/firefox unaffected (config change scoped to webkit-engine projects; the two spec edits are engine-agnostic and verified on chromium/firefox for portal-a11y). mobile-safari + mobile-chrome run in the gauntlet continuation.
- **Frameworks:** Playwright web-e2e (all 5 projects) + `eslint`/`prettier` (`--max-warnings=0`) + story-frontmatter validator + `code-reviewer` 100%-clean. Test-harness-only change (no product runtime) ⇒ no real-device APP journey required; the browser-suite run IS the verification.

## Out of Scope

- Shrinking the ~260 KB admin DOM (legitimate 16-tab SPA markup + 102 KB inline CSS; no single removable blob). Would help real WebKit memory but is a large, risky refactor with unclear payoff and does not gate the tests once snapshots are off.
- The `adminLogin` / `adminContext` `Promise.race([waitFor, waitFor])` dangling-poll anti-pattern: investigated as a suspect, PROVEN not to cause the slowdown (isolated repro showed no effect; the `.or()` fix did not stop the failures), and reverted. If cleaned up for hygiene, it is its own story — NOT attributed to this bug.
- The `admin-keyboard.spec.ts` "Enter key triggers user search" (line 236) and "Enter key triggers resolve" tests: characterised as stable (6/6 in isolation and in the 48/48 full-file ×6 verify); not modified. Re-file if they recur in the full suite.
- Deeper hardening of the reports keyboard handler itself (`public/admin/js/tabs/reports.js`) so a single keydown is never dropped: out of scope — that is product code and the shortcut is reliable for real users; the flake is a synthetic-input timing artifact handled test-side.
- Enabling WebKit "Full Keyboard Access" in the Playwright launch (not exposed by Playwright; the a11y contract is tested directly instead).

## Dependencies

- None blocking. Rides the in-flight device-return develop gauntlet; merges to develop before the develop→main promotion so the webkit gate is trustworthy for the batch.

## Risks & Mitigations

- **Risk:** dropping DOM snapshots weakens WebKit failure diagnosis (no DOM time-travel). **Mitigation:** action log + network + source + on-failure screenshot are retained; Chromium/Firefox keep full traces and reproduce most logic bugs; the alternative (a bigger timeout) masks the cost and keeps the suite 4x slower.
- **Risk:** a future editor "restores" snapshots/screenshots to unify the projects and reintroduces the cascade. **Mitigation:** the `WEBKIT_TRACE` const and both project definitions carry explicit WHY comments citing this story.
- **Risk:** the `portal-a11y` rewrite becomes a tautology that never fails. **Mitigation:** `focus()` + `toBeFocused()` catches a regression to a non-focusable element; the accessible-name check catches a stripped label — both are real, falsifiable assertions (AC error-paths).

## Definition of Done

RED evidence recorded (above); `playwright.config.ts` WebKit-engine trace reduction + the two spec fixes in; full `--project=webkit` AND `--project=mobile-safari` suites green via the canonical local env; chromium/firefox/mobile-chrome regression-green; `eslint` + `prettier` (`--max-warnings=0`) clean; story-frontmatter validator clean; `code-reviewer` 100% clean; merged to develop (develop-PR flow: local web-e2e gauntlet + review, `pre-merge-check.sh --skip-ci-check` with `BASE_REF=origin/develop`); rides the develop→main promotion with the gauntlet batch. Test-harness-only (no product runtime) ⇒ device/app journey gauntlet not required for THIS story.

## Notes

- 2026-07-17 ~02:1x WIB — Diagnosed and fixed mid-gauntlet. Full root-cause trail in memory `reference-webkit-playwright-trace-dom-snapshot-cost`. Decisive bisection: `--trace off` on the REAL reproducing case (`admin-maintenance.spec.ts --project=webkit --repeat-each=8`) flipped exactly the trace variable → 0 failures; then `snapshots:false` then `+screenshots:false` narrowed it to the two per-action capture costs. Six earlier hypotheses were falsified (token expiry, persistent-page churn, AudioContext creation, cross-page latency growth, dangling getByRole poll ×2) — synthetic latency harnesses could not reproduce because they lacked the 260 KB populated admin DOM.
- Verified-up-to marker set at implementation commit (bumped on push).
