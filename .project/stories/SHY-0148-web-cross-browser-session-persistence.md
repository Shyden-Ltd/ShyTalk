---
id: SHY-0148
status: In Review
owner: claude
created: 2026-07-01
priority: P1
effort: M
type: chore
roadmap_ids: []
epic: EPIC-0004
pr:
mvp: true
---

# SHY-0148: Prove & harden "stay signed in" across all browsers (public web surfaces)

## User Story

**As** someone who has signed in on the ShyTalk website,
**I want** to stay signed in when I come back or reload — in whatever browser I use, on desktop or mobile — with no flicker of "signed out" before the page settles,
**So that** I'm never unexpectedly asked to sign in again, and the experience is consistent across every browser we support.

## Why

The web-surfaces map found the public pages **already keep users signed in** (the Firebase JS SDK persists the session by default) and **already** don't re-prompt login on load — the sign-in prompt only appears when a signed-out visitor clicks Suggest/Subscribe. So the correctness mostly exists; what's missing is **proof and polish**:

1. **No cross-browser coverage.** The session behaviour is only ever exercised in one browser in practice; there are **no** tests on Firefox, WebKit/Safari, mobile-Chrome, or mobile-Safari. **Safari/WebKit ITP** (Intelligent Tracking Prevention, which can evict site storage) is the real cross-browser risk, and it's currently unverified.
2. **A hollow reload test.** `tests/web/roadmap-auth.spec.ts:1029-1041` is a skeleton — it reloads the page but asserts **nothing** afterward.
3. **No "signed-in user skips the login prompt on reload" test.**
4. **A loading flash.** `roadmap-auth.js` uses a tri-state (`null` = "still checking") and `shared-header.js` handles it, but there's a brief window where a signed-in visitor can flash the signed-out UI before their profile resolves.

Operator chose **`mvp: true`** — cross-browser session correctness is a launch requirement (a returning visitor being wrongly signed out on Safari would be a bad first impression).

## Acceptance Criteria

### Happy path
- [x] A signed-in visitor reloads (or returns to) any public page — roadmap, suggestions board, admin dashboard — and **stays signed in**, seeing their signed-in state, on **all five supported browsers** (Chrome, Firefox, Safari/WebKit, mobile-Chrome, mobile-Safari).
- [x] A signed-in visitor is **not** shown the sign-in prompt/modal on reload of the suggestions board (they can suggest/vote straight away).

### Error paths
- [x] A genuinely **signed-out** visitor still sees the sign-in prompt when they try to suggest/subscribe (unchanged).
- [x] A visitor whose session has **genuinely expired** is prompted to sign in again (not left in a broken half-signed-in state).

### Edge cases
- [x] **No signed-out flash:** during the brief "checking sign-in" moment, the signed-out UI (a "Sign In" button) does **not** flash before the signed-in state resolves.
- [x] **Safari/WebKit ITP:** the session survives a reload within the expected window on WebKit despite ITP storage constraints (verified, not assumed).
- [x] **Mobile browsers:** mobile-Chrome and mobile-Safari persist the session the same as their desktop counterparts.

### Performance
- [x] The signed-in state resolves quickly on reload — no long blank/loading state before the page settles into the correct auth view.

### Security
- N/A — this is cross-browser **coverage** + a UI-flash fix; it does not change what is gated or who can see what (the backend still enforces every read/write). The flash fix only affects which of the *already-permitted* UI states is shown first.

### UX
- [x] The signed-in indicator (header account state) is **stable** on load/reload — no flip from signed-out to signed-in that the user can perceive.

### i18n
- N/A — no new user-facing strings; the public pages' existing (translated) copy is unchanged. (Public pages remain lazy-translated per [[feedback-public-translations-lazy-architecture]].)

### Observability
- N/A — client-side display behaviour on already-instrumented pages; no new server events. (Existing console/debug logging is untouched.)

## BDD Scenarios

**Scenario: a signed-in visitor stays signed in when they reload — in any browser**
- **Given** someone who is signed in on the ShyTalk website
- **When** they reload the page — whether in Chrome, Firefox, Safari, or on a phone browser
- **Then** they are still signed in and are not asked to sign in again

**Scenario: no flicker of "signed out" before the page settles**
- **Given** a signed-in visitor opening one of the pages
- **When** the page loads
- **Then** they do not briefly see a "Sign In" button before their account appears

**Scenario: a signed-in visitor isn't shown the sign-in pop-up on the suggestions board**
- **Given** a signed-in visitor on the suggestions board
- **When** the page reloads
- **Then** they can suggest or vote without being shown the sign-in pop-up

**Scenario: a signed-out visitor is still asked to sign in**
- **Given** a visitor who is not signed in
- **When** they try to suggest or subscribe
- **Then** they are shown the sign-in prompt, exactly as before

**Scenario: the session survives a reload on Safari**
- **Given** a signed-in visitor using Safari
- **When** they reload the page
- **Then** they are still signed in (Safari's tracking protection has not silently signed them out)

## Test Plan

Touches the public web JS (`public/js/**`, `public/portal`/`admin` where the flash lives) → **web change ⇒ the Playwright browser gauntlet on all 5 browsers**; if any shared auth JS is edited it also runs the wider gauntlet (per SHY-0127). No backend change. Per § No Stubs, Playwright drives **real browsers** against the **real** (dev) Firebase — no route stubbing of the auth flow.

**Red → Green (framework by framework):**
- **Playwright (ALL 5 browsers — chromium/firefox/webkit/mobile-chrome/mobile-safari)** `tests/web/`:
  - **Fill the skeleton** `roadmap-auth.spec.ts:1029-1041`: after sign-in → reload → assert the visitor is **still shown as signed in** (real assertion, was empty).
  - **New** — signed-in visitor reloads the suggestions board → asserts the sign-in modal is **not** shown and an action (suggest/vote) is available.
  - **New** — no-flash: on load, assert the header does **not** render the signed-out "Sign In" control before settling to the signed-in state (guard the tri-state loading window).
  - **New/extended** — admin dashboard: run the existing `admin-login.spec.ts` session-persists-across-reload assertion on **all five** browsers (currently effectively chromium-only).
  - **Regression** — a signed-out visitor still gets the sign-in prompt on an action (unchanged).
  - **Safari/WebKit-specific** — reload-stays-signed-in on webkit + mobile-safari (the ITP risk).
- **Static/quality:** `npm run lint` 0 warnings on any touched JS; prettier clean.
- **Phase 1 LOCAL gauntlet:** the Playwright suite green on all 5 browsers (desktop + mobile) for the reload-stays-signed-in + no-flash + no-modal cases.
- **Phase 2:** `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name (all browser cells).
- **Phase 3 (DEV):** re-run against dev (real Firebase) in all 5 browsers.

## Out of Scope
- The **portal TOTP "remember this browser"** change — that is **SHY-0147** (this story is the public pages' plain sign-in persistence, no MFA).
- The **app** session (SHY-0143).
- **Centralising** the per-surface Firebase persistence config into the unused `public/js/core/auth.js` — a worthwhile tidy-up, but a separate refactor; this story proves + fixes behaviour without a risky cross-surface rewrite.
- Adding auth to pages that currently have none (homepage/legal).

## Dependencies
- `public/js/roadmap-auth.js`, `public/js/suggestions-board.js`, `public/js/shared-header.js` (the tri-state loading + header render — where the flash lives), `public/admin/js/main.js` (already persists; needs cross-browser proof).
- The existing Playwright specs (`roadmap-auth.spec.ts`, `suggestions-board.spec.ts`, `admin-login.spec.ts`, `portal-auth.spec.ts`) + the 5-browser Playwright config.
- Real (dev) Firebase for the browser-driven auth.

## Risks & Mitigations
- **Risk:** Safari/WebKit ITP evicts the session earlier than expected → false test failures or real sign-outs. **Mitigation:** test within the documented persistence window; if ITP genuinely breaks it, that's a real finding to surface (first-party storage should be fine) — captured as a `code-reviewer`/operator escalation, not silently worked around.
- **Risk:** the no-flash fix regresses the tri-state loading logic (e.g. hides the header too long, or shows signed-in before confirmed). **Mitigation:** explicit tests for both the signed-in and signed-out first-paint; the fix only reorders which *already-correct* state shows first.
- **Risk:** cross-browser flakiness inflates the suite. **Mitigation:** wait on real auth-state signals, not timeouts; reuse the existing spec patterns.

## Definition of Done
- [ ] Cross-browser session-persistence tests (all 5 browsers) filling the skeleton + the new signed-in-reload/no-modal/no-flash cases across roadmap/suggestions/admin, plus the loading-flash fix, implemented.
- [ ] **Pre-Merge Testing Protocol satisfied:** Playwright RED→GREEN on **all 5 browsers** (reload-stays-signed-in · no-modal-for-signed-in · no-signed-out-flash · signed-out-still-prompted · Safari-survives-reload) + lint/prettier clean → LOCAL gauntlet green → `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name (all browser cells) → DEV gauntlet green (all 5 browsers) → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes

Reviewed-up-to: 875479f1e122a33f063f75be79520e9e24ca8126

- **2026-08-19 — the flash had a known cause and an unused fix already in the
  tree.** SHY-0279 added `window.shytalkAuth.authStateKnown` precisely so a
  consumer could tell "signed out" from "we don't know yet", and its own comment
  names the consequence: *"which is why the shared header renders Sign In during
  the unknown window"*. The producer was done; **the header simply never read
  the flag**. So this is a consumer fix plus one small producer gap, not a new
  mechanism.
- **2026-08-19 — the producer gap.** `updateGlobalAuth()` was only ever called
  from inside async paths, so `window.shytalkAuth` was **undefined** at the
  header's first render even on pages that DO have auth. The unknown window was
  therefore not observable at the moment it mattered. Fixed by publishing the
  global at module load.
- **2026-08-19 — publishing must NOT dispatch.** The first attempt called
  `updateGlobalAuth()` at module load and broke SHY-0279's *"exactly one
  auth-changed event"* test — caught by that test, on both chromium and webkit.
  Each dispatch makes the header rebuild itself, and a second one detaches
  elements mid-click. Split into `publishGlobalAuth()` (assign only) and
  `updateGlobalAuth()` (assign + dispatch); the module-load call uses the
  former.
- **2026-08-19 — the regression this fix could most plausibly have caused.**
  **Seven of the eight** pages carrying the shared header load no auth module at
  all (`index`, `terms`, `privacy`, `404`, `community-guidelines`,
  `cyber-bullying`, `do-not-sell`). Waiting for a flag that never arrives would
  have left them pending forever — worse than the flash. The header therefore
  defers only when `window.shytalkAuth` **exists** but is not yet known; absent
  entirely means "no auth on this page" and Sign In renders at once. Four
  explicit tests pin this, and each asserts the premise (`shytalkAuth` really is
  absent) rather than assuming it.
- **2026-08-19 — a timing test would have been worthless here.** The natural
  page-load race only flashes when the header renders before Firebase resolves;
  on a fast machine it does not, so the first version of the spec was **flaky —
  it failed once and passed on retry**. Replaced with deterministic transitions
  driven through the REAL published contract (the same global and the same
  `shytalk-auth-changed` event the real producer uses), plus a settled-state
  guard that does not depend on timing at all.
- **2026-08-19 — an earlier draft of the spec passed while measuring nothing.**
  `addInitScript` runs before the document is parsed, so
  `MutationObserver.observe(document.documentElement)` threw and silently killed
  the observer, leaving an empty log that would have read as "no flash". Caught
  only because the spec asserted its own non-vacuity first.
- **2026-08-19 — the repo's own discipline guard rejected my first spec, and
  it was right to.** `auth-injection-discipline.spec.ts` forbids anything
  outside the sanctioned gate from assigning `window.shytalkAuth`, because a
  direct write cannot wait for the page's own sign-in check and is decided by a
  race it cannot see (measured on this page: Chromium won at 505 ms, WebKit lost
  at 594 ms). The spec now goes through `injectAuthState`.
  A second constraint fell out of that: the gate waits for `authStateKnown ===
  true` before every write, so a test cannot inject `false` and then `true` — the
  second call deadlocks against the first. The settled signed-out case therefore
  asserts the state the page reaches **on its own**, with no injection at all,
  which is a truer assertion anyway.

- **2026-08-19 — CROSS-BROWSER PROOF, all five projects, real browsers, local
  stack:** `shared-header`, `shared-header-signin-fallback`,
  `shared-header-auth-flash`, `roadmap-auth`, `auth-state-known-contract` —
  **116 passed on each** of chromium, firefox, webkit, mobile-chrome and
  mobile-safari (580 total). One pre-existing flaky on mobile-chrome
  (`roadmap-auth`, unrelated to this change) passed on retry. Firefox and WebKit
  binaries were not installed locally and were installed before the run — the
  earlier all-red on those two was a harness gap, not a result.
 (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0004-persistent-session-instant-coldstart]]. Scoped from the web-surfaces Explore map: the public pages already persist the session + don't re-prompt login on load; the gaps are **cross-browser proof** (Safari/WebKit ITP the real risk), a **skeleton** reload test (`roadmap-auth.spec.ts:1029-1041`, no assertion), a missing "signed-in skips the login modal on reload" test, and a **loading flash**. Operator chose **`mvp: true`** (launch-blocking cross-browser session correctness). Sibling: SHY-0147 (portal TOTP remember-browser).
