---
id: SHY-0279
status: Done
owner: claude
created: 2026-08-05
priority: P0
effort: S
type: bug
roadmap_ids: []
released_in: v0.98.0
---

# SHY-0279: Seven web checks are decided by a timing race, so WebKit blocks every PR into develop

## User Story

As **the engineer relying on the develop CI gate to tell the truth about a change**,
I want **the web checks that exercise a signed-in visitor to wait for the page's sign-in check to finish instead of racing it**,
So that **their verdict comes from the product's behaviour rather than from how fast the machine happened to be**.

## Why

`playwright-web (webkit)` and `(mobile-safari)` fail on **7 checks** on every run that reaches them, while `chromium`, `firefox` and `mobile-chrome` pass the same checks. Nothing in the failures is WebKit-specific — they are decided by a race, and WebKit loses it.

**Measured on this machine (2026-08-05), same page, same checks:**

| Engine | Page's own sign-in result | Check injects its pretend visitor | Winner |
|---|---|---|---|
| chromium | `t = 505 ms` | `t = 524 ms` | check wins → passes |
| webkit | `t = 594 ms` | `t = 415 ms` | **page wins by 179 ms → fails** |

The mechanism is a single line of ownership. Every check that needs a signed-in visitor assigns `window.shytalkAuth` directly. When the page's own sign-in check finishes, `updateGlobalAuth()` (`public/js/roadmap-auth.js:247`) **replaces that object wholesale** from its private `currentUser`/`shytalkProfile` and re-publishes. Nobody is really signed in, so `currentUser` is `null`: the pretend visitor is erased. The shared header then re-renders — and `render()` (`public/js/shared-header.js:52-53`) *removes and rebuilds the whole header*, so `header-user-info` is detached and `Sign In` returns. That is exactly what CI reports: `element was detached from the DOM, retrying` until the 20 s budget expires, and `expect(signInBtn.count()).toBe(0)` receiving `1`.

**The checks cannot avoid this today**, and that is the defect worth fixing: `authStateKnown` — the flag that already records "the sign-in check has finished" — is private to the module (`roadmap-auth.js:31`). No caller can distinguish *"signed out"* from *"we don't know yet"*, so a check has no signal to wait on and can only guess. One check guesses with `await page.waitForTimeout(1000)` (`shared-header.spec.ts:167`), which guarantees it loses whenever the page is slow.

This is the same defect class as [[SHY-0243]]: **the check encoded the machine it ran on instead of the contract it was written for** ([[feedback-parameterized-probe-fixtures]]), and it passes for a reason unrelated to what it claims to prove ([[feedback-verify-the-harness-not-just-the-result]]). It is pre-existing — develop's own `PR Checks` runs have failed here since 2026-07-25 — and it is on the critical path: it is the wall PR #1670 hit as the first PR in weeks whose `test-backend` passed far enough for Playwright to actually run.

**All 12 injection sites are racy, not just the 7 that fail today.** The other 5 pass only because their assertion happens to land inside the margin. Fixing only the visible 7 leaves the same trap armed ([[feedback-consistency-whole-project]]).

## Acceptance Criteria

### Happy path

- [ ] `window.shytalkAuth.authStateKnown` is published and is `true` once the page's sign-in check has resolved.
- [ ] All 12 sites that pretend a visitor is signed in wait for that signal before injecting, and none uses a sleep to do it.
- [ ] `playwright-web` passes on all five projects — `chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`.

### Error paths

- [ ] When Firebase cannot be reached or its config never loads, the page still publishes `authStateKnown: true` (via the existing 3 s fallback) so a waiter is never stranded.
- [ ] When the sign-in SDK throws during init, `authStateKnown: true` is still published.
- [ ] A check that waits for the signal fails with a clear timeout rather than hanging indefinitely.

### Edge cases

- [ ] `authStateKnown` is falsy on the synchronous pre-resolution publish (`roadmap-auth.js:282`), so the flag can never read `true` before the check has run.
- [ ] Publishing the flag adds **no** additional `shytalk-auth-changed` dispatch on the already-resolving path — an extra dispatch would detach the header again and re-introduce the instability.
- [ ] A signed-in visitor whose profile fetch is still in flight (`profile === null`) is still reported as sign-in-state-known.

### Performance

- [ ] No check waits on wall-clock time; every wait is condition-based, so a fast machine pays no fixed cost.
- [ ] Total `playwright-web (webkit)` wall time does not regress beyond its current ~29 min.

### Security

- [ ] The published flag carries no identity, token or profile data — it is a boolean about *resolution*, not about *who*.
- [ ] No new surface allows a page script to assert a signed-in state it does not have.

### UX

- [ ] No user-visible rendering change ships in this story. The header's pre-resolution "Sign In" flash is a real, separate defect and is filed rather than folded in.

### i18n

- [ ] N/A — no user-facing string is added, removed or changed.

### Observability

- [ ] Every code path that concludes the sign-in state is known publishes it; a structural check fails if a future path sets the flag without publishing.
- [ ] A structural check fails if any web spec injects a pretend signed-in visitor without first waiting for the signal.

## BDD Scenarios

**Scenario: The suite gives the same verdict on a slow machine**
- **Given** a page's sign-in check takes longer than usual to finish
- **When** the automated checks for a signed-in visitor run
- **Then** they report the same result as they do on a fast machine

**Scenario: A page reports when its sign-in check has finished**
- **Given** a visitor opens a public page
- **When** the sign-in check resolves
- **Then** the page reports that the sign-in state is now known

**Scenario: The sign-in state is reported even when sign-in is unavailable**
- **Given** the sign-in service cannot be reached
- **When** the page stops waiting for it
- **Then** the page still reports that the sign-in state is known

**Scenario: A new check cannot reintroduce the guesswork**
- **Given** an engineer adds a check that pretends a visitor is signed in
- **When** the suite runs
- **Then** it fails unless that check waits for the sign-in state to be known

## Test Plan

**Red (written first, must fail against today's code):**

- `tests/web/auth-state-known-contract.spec.ts`
  - `publishes authStateKnown once the sign-in check resolves` — fails today: the property is `undefined`, so the wait times out.
  - `authStateKnown is falsy on the synchronous pre-resolution publish` — pins that the flag cannot read `true` too early.
  - `an injected signed-in visitor survives the page's own sign-in resolution` — the regression probe; fails today on WebKit because the injected object is replaced.
  - `resolution publishes exactly one auth-changed event on the signed-out path` — pins that the fix adds no extra dispatch (an extra one would detach the header).
- `tests/web/auth-injection-discipline.spec.ts` (structural, reads the spec corpus with `fs`)
  - `every spec that injects shytalkAuth first awaits the resolution gate` — fails today at all 12 sites.
  - `no auth-state spec gates a signed-in assertion on waitForTimeout` — fails today at `shared-header.spec.ts:167`.
  - `the guard's own corpus is non-empty` — vacuous-pass guard.
  - `every authStateKnown assignment in roadmap-auth.js publishes it` — fails today at 3 of 4 sites.

**Green (must pass after the fix):**

- The four previously-failing files in full, on the WebKit engine specifically:
  `npx playwright test --project=webkit --project=mobile-safari tests/web/shared-header.spec.ts tests/web/roadmap-auth.spec.ts tests/web/suggestions-board.spec.ts`
- The full web suite on all five projects (the CI shape): `npx playwright test`.
- `npm run lint` (`--max-warnings=0`) and `prettier --check` from `express-api/`.

**Real services only:** every check runs against the real local stack (`local/start.sh` — real Firebase Auth emulator on `:9099`, real Express API on `:3000`, real static server on `:8888`). No mock, no route interception, no fake clock. The race is exercised by real engine timing, which is what produced the measurement above.

## Out of Scope

- **The header's pre-resolution "Sign In" flash.** `shared-header.js` treats "sign-in state unknown" as "signed out", so a signed-in visitor sees a Sign In button flash on every page load. Real defect, real user impact, separate story — it changes shipped rendering and needs its own device/browser gauntlet.
- The 122 `waitForTimeout` calls elsewhere in the web corpus. Only the sleeps that gate *this* race are removed here; the rest belong to the sleeps-eradication story on PR #1673.
- The two `test-backend` suites that fail on every backend-touching PR — that is [[SHY-0243]] (PR #1670).
- Any change to how sign-in itself works.

## Dependencies

- None on other stories. This PR touches `public/**` and `tests/web/**` only, so `detect-changes` sets `web_changed=true` and leaves `backend_changed=false` — `test-backend` is skipped, and `playwright-web` runs because its gate accepts `skipped`. It therefore lands independently of PR #1670.
- Requires the local stack for verification (`local/start.sh`), plus the real Android and real iOS devices for the pre-merge gauntlet, since `public/**` is a shipped runtime surface.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Publishing the flag adds an extra `shytalk-auth-changed` dispatch, detaching the header mid-click and creating a *new* instability | The already-resolving path publishes exactly once; a dedicated check counts dispatches on the signed-out path |
| A waiter hangs forever if the flag is never published on some path | Every path that concludes the state is known publishes it, including the 3 s config-never-loaded fallback; a structural check pins this and the wait carries an explicit timeout |
| The gate makes the checks slower | The wait is condition-based; it resolves as soon as the page does, and it replaces a hard-coded 1000 ms sleep |
| Fixing only the 7 visible failures leaves the trap armed | All 12 injection sites are converted, and the structural check fails any future site that skips the gate |
| The structural check is placed under `express-api/` and drags the broken `test-backend` suites into this PR's gate | It lives in `tests/web/`, keeping the PR web-only — verified against the `detect-changes` path table |

## Definition of Done

- [ ] Red checks written first and observed failing against unmodified code.
- [ ] All 12 injection sites converted; zero sleeps gate an auth-state assertion.
- [ ] `npx playwright test` green on all five projects locally, WebKit included.
- [ ] `npm run lint` and `prettier --check` clean.
- [ ] LOCAL gauntlet green on real Android + real iOS + the full browser matrix (`public/**` is a runtime surface).
- [ ] `code-reviewer` 100% clean, `Reviewed-up-to:` recorded in Notes.
- [ ] CI green by name — Detect Changes, Analyze JavaScript, PR Gate — with `playwright-web` actually **running**, not skipped.
- [ ] The header-flash defect filed as its own story before this one merges.
- [ ] DEV gauntlet green, then judgment-merge.

## Notes (running log)

- **2026-08-05 01:45 WIB** — Root cause established by measurement, not inference. First recorded hypothesis (WebKit ITP / partitioned storage blocking Firebase Auth persistence) was **wrong** and is retired: these checks never touch Firebase persistence at all — they assign `window.shytalkAuth` in-page. Corrected by reading the specs before theorising further.
- **2026-08-05 01:47 WIB** — A local WebKit run of `shared-header.spec.ts` passed 29/29, which initially looked like "does not reproduce". It reproduces: a purpose-built probe showed the clobber landing 179 ms after injection on macOS WebKit too. The suite passes locally only because, by the 23rd check in the file, a warm browser resolves sign-in *before* the injection. Timing, not engine.
- **2026-08-05 01:52 WIB** — Confirmed this lands independently of PR #1670: `playwright-web`'s gate accepts `test-backend: skipped`, and `test-backend` only runs when `backend_changed`. Corrects the earlier note that "every develop PR fails test-backend" — that holds only for backend-touching PRs.
- **2026-08-05 02:05 WIB** — RED observed before any product change: 4 of 5 checks in `auth-state-known-contract.spec.ts` failed (the flag was private, so the gate timed out) and 3 of the discipline rules failed naming all 12 offending sites. The 5th contract check passed from the start — it guards the helper's own error message, which is test infrastructure, not product.
- **2026-08-05 02:20 WIB** — The refactor reddened `roadmap-auth.spec.ts:1317` (the W1 source-level pin), which searched for the literal `updateGlobalAuth()` inside the `onAuthStateChanged` body. The ordering contract it guards is intact — the publish still precedes `checkShyTalkAccount(user)` — but the call now reaches it through `markAuthStateKnown()`. Fixed the PIN, not the code, and strengthened it: it now strips comments first (so prose cannot satisfy it) and asserts the named publisher really does publish, so the ordering check cannot be met by an indirection that does nothing.
- **2026-08-05 02:40 WIB** — GREEN: 506/506 on `webkit` + `mobile-safari` across all five affected files. Full `webkit` suite: **1379 passed, 1 failed, 57 skipped**. The single failure is `admin-gifts.spec.ts:73` ("seeded gift appears in table"), which fails in isolation, imports nothing this story touches, and lives on the admin page — which does not load `roadmap-auth.js` at all (only `roadmap.html` does). Local gifts-seeding gap, pre-existing, not introduced here; it was not among CI's failures.
- **2026-08-05 02:50 WIB** — Mutation-verified rather than assumed. Removing the publish from `markAuthStateKnown()` killed the publisher rule; deleting `authStateKnown:` from the published object killed 6 checks. Product file restored byte-identical afterwards and re-run green. Also fixed a latent helper bug found in self-review: appending `currentUser` unconditionally would have wiped an existing visitor with `undefined` when a caller passed only a profile — now covered by `a partial injection updates only the keys it names`.
- **2026-08-05 03:05 WIB** — `code-reviewer` round 1. Every claim was re-verified against the files before acting on it. **Applied here (all in code this story introduces):** the discipline scan walked only the flat `tests/web/*.spec.ts`, so a future `helpers/quick-signin.ts` doing a raw assignment would have been invisible to both rules — it now walks the tree recursively; the assignment rule missed sub-property and bracket-notation forms, which are equally racy because the page replaces the object wholesale; the import rule hardcoded single quotes, which would have failed an auto-import for a difference that changes nothing given nothing lints `tests/web/**`; and nothing proved the rebuilt `getIdToken` actually resolves the passed token. **Rejected one suggestion:** banning `Object.defineProperty(window, 'shytalkAuth', …)` would have flagged observation as injection — `roadmap-auth.spec.ts` uses it to intercept OAuth and this story's own recorder uses it to observe. The broadened sub-property rule initially flagged `shytalkAuth.signInWithGoogle = …` in `roadmap-auth.spec.ts`; that is a method swap the spec already re-applies through a late-binding setter, not a visitor, so the rule is scoped to the state keys (`currentUser`/`profile`/`authStateKnown`) rather than any property. A rule that flags legitimate work gets routed around instead of obeyed.
- **2026-08-05 03:10 WIB** — Three findings deliberately NOT applied here; filed as [[SHY-0280]] because they are defects in code this story does not modify, and proving them needs a real-sign-in harness that does not exist yet: `renderAuthUI()` and `checkShyTalkAccount()` double-publish on the "Firebase identity, no ShyTalk account" path (not timing-dependent — it happens every time); the signed-in branch has only a static source pin and no executed proof; and an in-flight profile fetch can publish for a visitor who has since signed out. Folding them in would have held the queue-unblocking fix behind new test infrastructure.
- **2026-08-05 03:15 WIB** — Re-verified after the review fixes: 524/524 on `webkit` + `mobile-safari` across all five affected files. `Reviewed-up-to: e78b0e06ff8` plus the review-response commit below.
- **2026-08-05 02:55 WIB** — Note for whoever runs the web suite locally: the admin specs require `API_BASE_URL` (and `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`TEST_API_KEY`) to be set explicitly, exactly as `playwright-tests.yml` does. Without them the whole run aborts at import time. Neither ESLint nor Prettier gate this PR: the `Express lint (ESLint + Prettier)` step in `lint.yml` is gated on `backend_changed`, so web-only changes are never linted in CI. Worth its own story; not folded in here.
- **2026-08-05 07:50 WIB — `code-reviewer` round 2, covering the one commit that landed after round 1.** `4deaddf5c4e` (the audit-log sleep removal) post-dated the clean review, so Gate 3 owed it a pass. The reviewer confirmed the wait *mechanism* is honest — `expect.poll` genuinely auto-retries, and it is neither a sleep nor the banned single-shot `expect(await locator.count())` — but raised two findings against the check, both re-verified against source before acting.
  **Fixed here** (commit `b57c3ce02fa`): the assertion was nested inside two bare `if`s, so an empty audit log or a hidden Load More button let the test report PASS having asserted nothing at all. It now reports the missing precondition as a SKIP, matching the `test.skip` idiom the sibling CSV check in the same file already uses — the same "absence of work reported as success" class this story exists to eliminate.
  **Deferred to [[SHY-0283]], deliberately:** `toBeGreaterThanOrEqual` cannot tell real pagination from a duplicate re-fetch of page 1 — and there IS one. `public/admin/js/tabs/audit-log.js` never increments `state.page` (verified: exactly three references — initialiser line 12, reset line 58, read line 75 — and no increment anywhere), so Load More re-requests page 1 and appends the same rows beneath themselves. The server paginates correctly; it is purely client state. Strengthening the assertion here would pin a product bug in `public/**`, a shipped runtime surface needing the full device gauntlet — unavailable with the phones unplugged, and holding this PR would strand the ~30-PR queue it exists to unblock. The weak assertion is left in place with a comment naming [[SHY-0283]], which carries the RED test.
  The round-1 note above records `Reviewed-up-to: e78b0e06ff8` inside prose,
  which `scripts/pre-merge-check.sh` cannot see — it matches `^Reviewed-up-to:`
  at column 0 precisely so a narrative mention can never satisfy the gate. The
  authoritative marker is the standalone line below, superseding it.

Reviewed-up-to: b57c3ce02fa
