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
- [x] The full `--project=webkit` Playwright suite passes with zero hard failures (previously 11). Verified 2026-07-17: 0 failed / 1 flaky-passed-on-retry / 1357 passed / 17.4 min.
- [x] The `--project=mobile-safari` Playwright suite passes with zero hard failures. Verified 2026-07-17: 0 failed / 1 flaky-passed-on-retry / 1348 passed / 18.0 min.
- [x] Chromium, Firefox, and mobile-chrome remain green and retain FULL traces (DOM snapshots + screencast) — the trace reduction is scoped to the two WebKit-engine projects only. mobile-chrome verified 2026-07-17: 0 failed / 1354 passed / 17.9 min; chromium/firefox unaffected by construction (the config never touches their `use.trace`).

### Error paths
- [x] When a WebKit test genuinely fails, its retained trace still contains the action log, network log, source, and a single on-failure screenshot (via `use.screenshot: 'only-on-failure'`) — enough to diagnose, even without the DOM-snapshot time-travel. (`trace.screenshots`/`sources` and the separate `use.screenshot` are independent Playwright settings — confirmed in review.)
- [x] `portal-a11y` "Tab navigates through interactive elements" FAILS if either OAuth button becomes non-focusable (e.g. regressed to a `<div>` without tabindex) or loses its accessible name — the rewritten assertion is not a tautology (native `.focus()` is a no-op on a non-tabindexed element, so `toBeFocused()` genuinely fails).
- [x] `admin-users-security` "reset PIN lockout" FAILS if `#pin-is-locked` settles to anything other than `No` (`toHaveText` is exact-match, both branches converted symmetrically).
- [x] `admin-keyboard` "W key selects warn" FAILS if the W shortcut never fires — the test first sets the select to `suspend`, so a passing `warn` assertion proves W actually ran (no longer a default-value tautology). The retry helper re-presses only the SAME key against the SAME expected value, so it cannot paper over a wrong-key mapping (cross-checked against the product handler's fixed per-key assignment).

### Edge cases
- [x] `WEBKIT_TRACE` is applied to BOTH `webkit` and `mobile-safari` projects (mobile-safari = iPhone 13 = WebKit engine); mobile-chrome (Pixel 5 = Chromium) is untouched.
- [x] The reduced trace still writes a `trace.zip` on failure (mode stays `retain-on-failure`), so CI artefact upload paths are unchanged.

### Performance
- [x] Full webkit suite wall-clock drops from ~1.2 h to ≤ ~20 min (measured: 17.4 min) — the trace overhead was also inflating pass times.
- [x] No new Firestore reads/writes; change is test-harness config + test-file assertions only.

### Security
- N/A — test-harness configuration and test assertions only; no product runtime, auth, or data-plane surface touched. The Allure `detail:false` password-leak guard in `playwright.config.ts` is unchanged.

### UX
- N/A — no user-facing surface changes (no `app/`, `iosApp/`, `shared/`, `express-api/`, or `public/` change).

### i18n
- N/A — no user-facing strings.

### Observability
- [x] The `WEBKIT_TRACE` const and both WebKit-engine project definitions carry comments explaining WHY snapshots/screenshots are off (the webkit serialisation cost), so a future reader does not "restore" them and reintroduce the cascade.

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
  - `tests/web/admin-keyboard.spec.ts` W/S/D report-shortcut tests → new `pressReportActionKey()` retry helper (re-presses the same key until the select settles, absorbing the WebKit keydown race) + W test de-tautologised (sets `suspend` first, then asserts `warn`) + the "Enter key triggers user search" test wrapped in the same `toPass` re-press + a 45s describe timeout for headroom on the chained-retry tests → `admin-keyboard ×6 webkit` 48/48 pass (S-key was ~40–80% fail); Enter-search `×10 webkit` 10/10.
- **Regression (all verified 2026-07-17):** full webkit suite 0-hard-fail / 1357 passed / 17.4 min; **mobile-safari 0-hard-fail / 1348 passed / 18.0 min** (WebKit engine — validates the `WEBKIT_TRACE` override on that project); **mobile-chrome 0-hard-fail / 1354 passed / 17.9 min** (Chromium — confirms the engine-agnostic spec edits regress nothing); chromium/firefox unaffected by construction (config never touches their `use.trace`). Residual: one pre-existing `search shows correct seeded user data` flaky appears on BOTH mobile projects (chromium + webkit) and passes on retry — engine-agnostic mobile-viewport search timing, outside this story's WebKit scope; re-file if it hardens.
- **Frameworks:** Playwright web-e2e (all 5 projects) + story-frontmatter validator (passes) + `code-reviewer` 100%-clean. **Lint caveat:** the repo's `eslint`/`prettier` gate (`lint.yml`, `.husky/pre-commit` lint-staged) is scoped to `express-api/**` only — there is NO eslint/prettier/tsc gate for `tests/web/**` or `playwright.config.ts`. These files are validated by Playwright loading them (esbuild type-stripping executes the suite) + manual review that `WEBKIT_TRACE`'s shape matches the installed Playwright `test.d.ts`. Adding a `tsc --noEmit` + eslint/prettier gate for the web-test surface is a worthwhile follow-up (see Out of Scope). Test-harness-only change (no product runtime) ⇒ the browser-suite run IS the verification.

## Out of Scope

- Shrinking the ~260 KB admin DOM (legitimate 16-tab SPA markup + 102 KB inline CSS; no single removable blob). Would help real WebKit memory but is a large, risky refactor with unclear payoff and does not gate the tests once snapshots are off.
- The `adminLogin` / `adminContext` `Promise.race([waitFor, waitFor])` dangling-poll anti-pattern: investigated as a suspect, PROVEN not to cause the slowdown (isolated repro showed no effect; the `.or()` fix did not stop the failures), and reverted. If cleaned up for hygiene, it is its own story — NOT attributed to this bug.
- The `admin-keyboard.spec.ts` "Enter key triggers resolve" test (unrelated Enter → `resolveReport` path): genuinely NOT modified — it carries no retry wrapping and was stable. ("Enter key triggers user search" IS modified here — it flaked once in the full webkit suite and got the same `toPass` re-press treatment; see Test Plan.)
- Deeper hardening of the reports keyboard handler itself (`public/admin/js/tabs/reports.js`) so a single keydown is never dropped: out of scope — that is product code and the shortcut is reliable for real users; the flake is a synthetic-input timing artifact handled test-side.
- Enabling WebKit "Full Keyboard Access" in the Playwright launch (not exposed by Playwright; the a11y contract is tested directly instead).
- Adding an `eslint`/`prettier`/`tsc --noEmit` gate for `tests/web/**` + `playwright.config.ts` (today only `express-api/**` is gated): a worthwhile CI-hardening follow-up, but a separate CI-config-only story — not required to land this fix.

## Dependencies

- None blocking. Rides the in-flight device-return develop gauntlet; merges to develop before the develop→main promotion so the webkit gate is trustworthy for the batch.

## Risks & Mitigations

- **Risk:** dropping DOM snapshots weakens WebKit failure diagnosis (no DOM time-travel). **Mitigation:** action log + network + source + on-failure screenshot are retained; Chromium/Firefox keep full traces and reproduce most logic bugs; the alternative (a bigger timeout) masks the cost and keeps the suite 4x slower.
- **Risk:** a future editor "restores" snapshots/screenshots to unify the projects and reintroduces the cascade. **Mitigation:** the `WEBKIT_TRACE` const and both project definitions carry explicit WHY comments citing this story.
- **Risk:** the `portal-a11y` rewrite becomes a tautology that never fails. **Mitigation:** `focus()` + `toBeFocused()` catches a regression to a non-focusable element; the accessible-name check catches a stripped label — both are real, falsifiable assertions (AC error-paths).

## Definition of Done

RED evidence recorded (above); `playwright.config.ts` WebKit-engine trace reduction + the four spec fixes in; full `--project=webkit`, `--project=mobile-safari`, and `--project=mobile-chrome` suites green via the canonical local env (evidence in Test Plan); chromium/firefox unaffected by construction; story-frontmatter validator clean; `code-reviewer` 100% clean; merged to develop (develop-PR flow: local web-e2e gauntlet + review, `pre-merge-check.sh --skip-ci-check` with `BASE_REF=origin/develop`); rides the develop→main promotion with the gauntlet batch.

**Gauntlet-classification note (do NOT treat as a self-granted exemption):** `CLAUDE.md`'s Pre-Merge Protocol lists exactly two exemptions from the device/browser gauntlet — `*.md`-only and CI-config-only — and this diff (`playwright.config.ts` + `tests/web/*.spec.ts`) is textually neither (though it touches NO product runtime — no `app/`, `shared/`, `iosApp/`, `express-api/src/`, `firestore.rules`, or `public/`). Substantively a real-device app journey exercises nothing this change affects, so it is not re-run FOR this story; the story nonetheless lands inside the in-flight device-return develop gauntlet batch, whose real-device journeys run for the batch as a whole before the develop→main promotion. Operator: flag if you want a documented "test-harness-only" exemption added to `CLAUDE.md` (mirroring the CI-config-only rationale) rather than this per-story note.

**Lint-gate note:** the repo enforces `eslint`/`prettier` on `express-api/**` only; there is no eslint/prettier/tsc gate for `tests/web/**` or `playwright.config.ts`. Verification for the changed files is Playwright-load (executes the suite) + manual review that `WEBKIT_TRACE` matches the installed Playwright types. A follow-up to add `tsc --noEmit` + eslint/prettier for the web-test surface is noted in Out of Scope.

## Notes

- 2026-07-17 ~02:1x WIB — Diagnosed and fixed mid-gauntlet. Full root-cause trail in memory `reference-webkit-playwright-trace-dom-snapshot-cost`. Decisive bisection: `--trace off` on the REAL reproducing case (`admin-maintenance.spec.ts --project=webkit --repeat-each=8`) flipped exactly the trace variable → 0 failures; then `snapshots:false` then `+screenshots:false` narrowed it to the two per-action capture costs. Six earlier hypotheses were falsified (token expiry, persistent-page churn, AudioContext creation, cross-page latency growth, dangling getByRole poll ×2) — synthetic latency harnesses could not reproduce because they lacked the 260 KB populated admin DOM.
- 2026-07-17 ~03:4x WIB — `code-reviewer` R1 (agent a462bc9254fb3e1a9) on commit `09dbc6da744`: found NO code-correctness defects (verified all four files' logic sound, no tautologies, no Playwright-API misuse, mutation-survivable) — findings were 1 Critical + 4 Important, all documentation/evidence-accuracy, plus 1 below-bar worst-case-timeout note. All addressed in `e8914f1baa9`: mobile-safari/mobile-chrome green evidence recorded + AC boxes ticked (Critical #1, Important #5); device-gauntlet exemption reframed as a classification note flagged for operator (Important #2); lint-gate claim corrected — eslint/prettier cover `express-api/**` only (Important #3); Out-of-Scope Enter-search contradiction fixed (Important #4); reviewer's own worst-case-timeout note fixed via a 45s describe timeout (self-verified 24/24 webkit). The ONLY post-review code delta was that reviewer-suggested 45s timeout headroom; self-verified rather than re-spawning a review round (small, reviewer-directed delta).
- 2026-07-17 ~04:1x WIB — Post-push correction #1: the "Enter key triggers user search" `toPass` fix still flaked ONCE on chromium in the first pre-push (1 flaky / 1378 passed). Hypothesised the intermediate `toHaveText('Search')` matched the pre-search IDLE button state; changed to assert displayName populated (`b3b7fbf41cd`, 20/20 isolation).
- 2026-07-17 ~04:3x WIB — Post-push correction #2 (the REAL root): the SECOND pre-push flaked the same test again — error `Expected "e2e-chromium-w1-u" Received "Suspended Account"`. NOT a keydown/button race at all: **test-data pollution**. The worker-scoped `testData.user` is shared suite-wide and a prior test suspended/renamed it, so the exact-`displayName` assertion is fragile to test order. Per systematic-debugging (3+ fixes on one test ⇒ question the design), the test was asserting on MUTABLE shared state. Fixed in `63477f8e60d` by asserting the loaded user's IMMUTABLE `#field-uniqueId` == the searched uniqueId (proves Enter fired AND loaded the right user, immune to displayName mutation). Verified 16/16 chromium+webkit. The full-suite pre-push (not isolation) was what surfaced this — isolation can't reproduce cross-test pollution.
Reviewed-up-to: 63477f8e60dab52c3221173521779a5beaf72b94
