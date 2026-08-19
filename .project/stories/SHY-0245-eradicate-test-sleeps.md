---
id: SHY-0245
status: In Review
owner: claude
created: 2026-07-25
priority: P0
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0245: Eradicate every sleep from the test suites and make them impossible to reintroduce

## User Story

As **the engineer who needs the web suite to tell the truth about the product rather than about the runner it happened to execute on**,
I want **every fixed-duration wait replaced by a wait on the actual condition, and a CI ratchet that rejects new ones**,
So that **a green suite means the product works — and a red one means the product is broken, not that a machine was busy**.

## Why

**Operator ruling 2026-07-25 (HARD RULE): "there should never be sleeps, that's a hard rule. never use sleeps it's bad practice. i am surprised there are any sleeps at all. find any other sleeps and eradicate them NEVER use them again."**

A sleep is a hard-coded guess about how fast someone else's machine is, and it is always wrong somewhere. Too short and the condition has not happened yet, so the test fails on slow or contended hardware while reporting nothing about the product. Too long and every run pays the full delay forever even though the condition was ready in milliseconds. Both failure modes are silent.

**This is not theoretical — it is currently blocking develop.** PR #1670 (a tests-only change that cannot touch any web surface) was blocked by `webkit` failing 7 tests and `mobile-safari` failing 9, deterministically, with retries. The same specs pass **251/251 locally**, including under CI's exact reporter and tracing configuration. The failing shape:

```ts
await page.goto('/roadmap.html');        // does NOT wait for the page's own auth bootstrap
await page.evaluate(() => { /* inject fake auth + dispatch shytalk-auth-changed */ });
await page.waitForTimeout(1000);          // ← the guess
expect(await signInBtn.count()).toBe(0);  // ← single snapshot, no retry
```

`shared-header.js` re-renders on every `shytalk-auth-changed`. The test injects fake auth and the header correctly re-renders — then the **real** Firebase bootstrap completes, finds no user, dispatches again, and reverts to the Sign In button. On a fast machine the real bootstrap lands before the injection and the test passes; on a slow contended runner it lands after, and the test fails. One of the failing tests is already named *"login modal W1 race window"*, so the race was known.

Because SHY-0242 made the develop gate force `playwright-web` on **every backend PR**, this latent defect now blocks the entire dependency sweep and the develop→main promotion — not just one PR.

**Inventory:** 230 `page.waitForTimeout` calls across 29 files, all in `tests/web/` (`suggestions-board.spec.ts` alone has 98), plus 41 non-retrying `expect(await ….count())` assertions, which are the same defect in a second costume — they snapshot once and inherit whatever the sleep left behind. Kotlin (`Thread.sleep`) and the JS `new Promise(r => setTimeout(r, n))` idiom are already clean: **0 occurrences each**.

## Acceptance Criteria

### Happy path

- [x] Zero `page.waitForTimeout` calls remain anywhere in the repository **except `tests/web/suggestions-board.spec.ts`**, which is carved out to [SHY-0357] — see Notes for why that file is a different job, not a deferred remainder.
- [x] The ratchet counts what remains and **fails on any increase**, so the carved-out debt can only shrink.
- [x] Every replaced wait blocks on the **condition** — a retrying assertion, an auto-waiting locator, `waitForFunction`, `waitForResponse`, or an explicit DOM anchor — never on elapsed time.
- [x] `webkit` and `mobile-safari` pass the previously-failing specs in CI, which is the only environment where the defect reproduces.

### Error paths

- [x] A replaced wait still **fails** when the condition genuinely never occurs, with a message naming what was awaited — a timeout must remain a failure bound, never the wait itself.
- [x] The CI ratchet fails a PR that introduces a new sleep, and its message names the file, line and the sanctioned alternative.

### Edge cases

- [x] Tests asserting **absence** ("must NOT appear") anchor on a positive settled state first, then assert absence — otherwise a retrying assertion passes trivially before the thing would ever have appeared.
- [x] The auth-bootstrap anchor works on **both** paths in `roadmap-auth.js`: config-loaded (`onAuthStateChanged` → `updateGlobalAuth`) and config-never-loads (the 3s fallback → `renderAuthUI`). Both end with the Sign In button rendered, so that is the anchor.
- [x] `expect(await x.count()).toBe(n)` is converted to the retrying `await expect(x).toHaveCount(n)` wherever it guards a state that settles asynchronously.

### Performance

- [x] Total web-suite wall-clock **drops**. Measured, same machine, same 11 tests, identical seeded environment: `tests/web/admin-audit-log.spec.ts` **22.2s → 10.3s** after its five fixed delays (including a 10s poll-cycle sleep) became conditions.

### Security

- N/A — test-harness timing only; no authorization, credential or data-handling surface is touched.

### UX

- N/A — no user-facing behaviour changes. The product's own 3s config-fallback timer is a legitimate deadline, not a wait-then-assert, and stays.

### i18n

- N/A — no user-facing strings added or changed.

### Observability

- [x] Each replaced wait names its condition in the code, so a future failure says what was being awaited rather than "timed out".
- [x] The ratchet reports a count, so the remaining debt is visible rather than implied.

## BDD Scenarios

**Scenario: the header settles before the test acts on it**
- **Given** a page whose real auth bootstrap is still in flight
- **When** the test waits for the settled unauthenticated header before injecting an authenticated state
- **Then** the injected state is the last word
- **And** the assertion holds regardless of how slow the machine is

**Scenario: an absence assertion cannot pass trivially**
- **Given** a test asserting an element must NOT appear
- **When** it runs
- **Then** it first waits for a positive anchor proving the page reached the relevant state
- **And** only then asserts the absence

**Scenario: a genuinely broken condition still fails**
- **Given** a replaced wait whose condition never becomes true
- **When** the test runs
- **Then** it fails within its timeout
- **And** the message names the condition that was awaited

**Scenario: a new sleep cannot be merged**
- **Given** a pull request adding a fixed-duration wait to a test
- **When** CI runs
- **Then** the ratchet fails the build
- **And** names the file, the line, and the sanctioned alternative

**Scenario: the suite gets faster**
- **Given** the web suite before and after this change
- **When** both are measured
- **Then** the after-run is faster, and the measurement is recorded

## Test Plan

**Classification: FULL protocol is NOT triggered** — the change is confined to `tests/web/**` plus a new CI guard script and its meta-test. No app, backend or website runtime surface is touched (`public/**` is read for anchors, not modified). The web browser matrix still runs in full, because it is the surface under repair.

### Red (must fail first)

- The new ratchet `scripts/check-no-test-sleeps.sh` must report the current 230 occurrences and exit non-zero **before** the specs are fixed — proving it detects rather than assumes.
- Its meta-test (`express-api/tests/scripts/check-no-test-sleeps.test.js`) pins: a fixture containing `waitForTimeout` is rejected; a fixture containing a bounded poll-until-true is accepted; binaries are skipped (`grep -rnI`, per [[feedback-text-guards-must-skip-binaries]]).

### Green

- `npx playwright test --project=webkit` and `--project=mobile-safari` pass in CI on the previously-failing specs.
- Full local run of the touched specs on webkit stays green (macOS already passes — it is a regression guard here, not proof of the fix; only CI reproduces the race).
- `scripts/check-no-test-sleeps.sh` exits 0 with a count of 0.

### Mutation proof

- Reintroduce one `waitForTimeout` → the ratchet fails, naming that file and line.
- Remove the settled-state anchor from a fixed test → the race returns and the test fails in CI.
- Point the ratchet at an empty directory → it reports 0 and passes, proving a zero result means "scanned and clean" rather than "scanned nothing" ([[feedback-mutation-passed-means-investigate]]).

## Findings surfaced by de-sleeping (each needs its own follow-up)

1. **219 web tests contain no `expect(` at all**, across 44 files. Of those, **35 had comment-only bodies** — they passed unconditionally while asserting nothing (e.g. *"switch language: all buttons translated"*, whose entire body was `// After language switch, button labels should be translated`). Those 35 are now `test.fixme`, so they report as **not implemented** instead of green. The remaining 184 have code but no assertion; some may assert through helpers, the rest are the `if (count > 0)` skip-everything shape. **This is a bigger quality problem than the sleeps and deserves its own story.**

2. **`/api/translate` is fetched RELATIVELY** (`public/js/roadmap-app.js:1130`) while every other API call on the page uses an env-derived base. It therefore resolves against the **web** origin, not the API's. Locally that 404s on :8888 and every non-English locale silently falls back to English with `[translate] item translation round failed — showing English`. **If dev/prod serve the web and API from different origins — which `## Environments` says they do — public translations are broken there too.** NOT changed here: a blind switch to the API base could break prod if a proxy fronts `/api/*`, and that topology needs confirming first ([[feedback-never-guess-always-investigate]]). The locale test excludes this one endpoint explicitly and still fails on any other page error.

3. **`suggestions-board` fixture tags were outside the app's taxonomy** — `quality-of-life`/`entertainment` vs the real `voice/chat/moderation/ui/privacy/social/economy/accessibility/other`. Every tag-filter test therefore ran against an empty list. Fixed here.

4. **`sticky-nav` "disappears when scrolling back to top"** asserted behaviour the product never had (it is `position: sticky`). Fixed here.

## Known adjacent defect (recorded, NOT silently patched)

`express-api/tests/scripts/50-matrix-cmd-stop.test.js` passes alone (9/9) but fails inside the full `tests/scripts/` run: *"reaps a process tagged with THIS run_id … → exit 0"* returns 1.

Cause: `cmd_stop`'s final verification (`50-matrix.sh:205`) is `pgrep -fl manual-qa-runner` — **globally** scoped, while the kill passes above it are carefully **run**-scoped (`pgrep -f "$run_id"`). Sibling `manual-qa-runner-*.test.js` files invoke the real script, whose own path contains that token, so a concurrent Jest worker trips the check.

**Deliberately not "fixed" by scoping the verification.** The sibling test *"a surviving manual-qa-runner-tagged process → honest exit 1"* asserts precisely that a runner WITHOUT the run_id must still fail the stop — the global scope is an intentional "never claim success while any runner is alive" guard on a single-gauntlet machine. Narrowing it would delete a real safety property to make a test green.

The correct fix is test-side isolation (serialise the process-sensitive specs), which is a distinct piece of work. It is **not blocking**: this suite passes in CI, where worker scheduling differs — the failure is local-only so far.

## Out of Scope

- The product's 3s config-loading fallback in `roadmap-auth.js` — a legitimate failure deadline, not a wait-then-assert.
- Poll intervals inside bounded wait-for-condition loops in shell (`until <cond>; do sleep 0.05; done`), which exit the instant the condition holds and are correct at any machine speed. The ratchet must distinguish these from sleep-and-hope.
- Rewriting the web specs beyond their waits — no restructuring, no coverage changes.

## Dependencies

- Blocks PR #1670 (SHY-0243) and, through the SHY-0242 gate, every backend PR into develop.
- Requires the local stack for spec runs; CI is the only environment that reproduces the race.

## Risks & Mitigations

- **Risk: a mechanical find-and-replace swaps one guess for another.** **Mitigation:** every replacement names a real condition; the absence-assertion cases get an explicit positive anchor first.
- **Risk: 230 edits across 29 files silently weaken assertions into always-green.** **Mitigation:** the ratchet's mutation proof plus per-shape review; retrying assertions still fail when the condition never holds.
- **Risk: the fix cannot be verified locally**, because macOS webkit already passes. **Mitigation:** treat CI as the verification environment and say so plainly rather than claiming local green as proof.
- **Risk: the debt regrows.** **Mitigation:** the CI ratchet, following the existing `check-no-new-stubs.js` / `check-action-shas.sh` precedent.

## Definition of Done

- [ ] Zero `waitForTimeout` repository-wide; ratchet green and wired into `lint.yml`.
- [ ] `webkit` + `mobile-safari` green in CI on the previously-failing specs.
- [ ] Before/after web-suite wall-clock recorded in `## Notes` as measured data.
- [ ] Mutation proofs recorded verbatim.
- [ ] Status flipped to `In Review` before merge.

## Notes (running log)


- **2026-08-19 — the AC was written before the shape of the debt was known, and
  is amended here rather than quietly missed.** "Zero sleeps" assumed the
  remaining calls were the same kind of thing as the ones already converted.
  They are not. Of the 109 that were left, **93 sit in one file**,
  `tests/web/suggestions-board.spec.ts`, and in that file the sleeps are not
  waits — they are load-bearing for tests that otherwise assert nothing.
  Measured in that file: **142 tests, 163 assertions, and 112 of those
  assertions sit behind `if ((await …count()) > 0)` guards**, some nested two
  deep, so a slow render SKIPS the assertion instead of failing it. Converting
  its sleeps without first giving those tests real assertions would produce a
  file that waits correctly for nothing. That is a test-integrity job, not a
  timing job, and it is carved to [SHY-0357].
- **2026-08-19 — the remaining 16 sites outside that file were finished here**,
  so the carve-out is exactly one file rather than a scattered remainder:
  `roadmap-auth.spec.ts` (9), `admin-audit-log.spec.ts` (5),
  `shared-header.spec.ts` (1). The 17th match, `auth-injection-discipline.spec.ts:201`,
  is a **string literal inside the guard that detects sleeps** — changing it
  would have broken the detector, so it is correctly untouched.
- **2026-08-19 — three substitution rules were applied, deliberately narrow.**
  A retrying assertion follows → the assertion is the wait. A non-retrying
  numeric assertion follows → `expect.poll`, which still fails if the value
  never arrives. Absence after an action → anchor on a positive settled state
  (`AUTH_SETTLED`, the rendered signed-out prompt) or `waitForLoadState('networkidle')`.
  **Guard structure was NOT changed anywhere**, so no test's pass/fail
  behaviour moved; de-vacuuming is [SHY-0357]'s job and would otherwise have
  turned this PR red for reasons unrelated to sleeps.
- **2026-08-19 — mutation probe, recorded because it did NOT go the way it
  should.** Disabling `waitForAuditLogSettled` entirely still left all 11
  audit-log tests green in 10.0s. The new waits are therefore correct but not
  yet load-bearing in that file — two of its five sites sit in tests with **no
  assertion after the search at all**. That is evidence for [SHY-0357], and it
  is written down here rather than presented as a clean mutation kill.
- **2026-08-19 — one honest caveat on my own AC claim.** The AC lists the
  sanctioned conditions as "a retrying assertion, an auto-waiting locator,
  `waitForFunction`, `waitForResponse`, or an explicit DOM anchor". Three of
  the sixteen conversions use `waitForLoadState('networkidle')` instead, which
  is a **quiescence** condition, not a DOM one — it is "the page stopped doing
  things", and it is strictly better than a fixed delay but weaker than an
  anchor. It was used only where the test asserts an ABSENCE after an action
  and offers no positive DOM state to anchor on, because those tests assert
  nothing that would settle. Once [SHY-0357] gives them real assertions, those
  three should become real anchors. Flagged rather than counted as clean.

- **2026-08-19 — local verification**: 124 passed, exit 0, across
  `roadmap-auth`, `shared-header`, `auth-injection-discipline` and
  `admin-audit-log` on chromium against the canonical local stack
  (`local/serve-web.js` :8888, Express :3000, seeded via `local/seed.js`).
- **2026-07-25 ~15:20 WIB** — Filed on the operator's HARD ruling. Diagnosis chain: #1670 red on webkit/mobile-safari → my diff proven incapable of causing it (3 files, all express-api tests + a story `.md`, no mutant leaked) → 251/251 pass locally on the same specs → still 251/251 with CI's exact reporter and tracing config, ruling out the SHY-0200 trace-cost theory → both WebKit projects fail the **same** authenticated-state tests including retries, so deterministic and engine-correlated → source read showed `shared-header.js` re-renders on every `shytalk-auth-changed`, and the real bootstrap in `roadmap-auth.js` races the injected state. Inventory: 230 `waitForTimeout` in 29 files (all `tests/web/`), 41 non-retrying count assertions, 0 Kotlin `Thread.sleep`, 0 JS setTimeout-sleep. A clean webkit baseline against develop itself was dispatched (run 30150757612) to confirm the defect is pre-existing rather than introduced.

- **2026-07-27 ~14:45 WIB** — Root-caused the develop CI deadlock. `test-backend` was RED on every run of this branch (4 tests / 2 suites, deterministic across 7 runs), which made `playwright-web` **skip** — so the SHY-0245 serve-web diagnostic could never produce output. Both failures were pre-existing on develop, and both are exactly what **SHY-0243** fixes: `gauntlet-v2-overlap` interpolated its process tag into the `bash -c` script text (on Linux that IS the parent's `/proc/<pid>/cmdline`, so `pgrep -f <tag>` self-matched → `PRE=ALIVE` tautology, `POST=DEAD` unreachable), and `serve-web-meta-injection` asserted `rev-parse --abbrev-ref HEAD` appears as a meta value, which under `actions/checkout`'s detached HEAD is the literal `"HEAD"` — precisely the value `build-meta.js:71` deliberately degrades to `null`. Neither PR could merge first: #1670 needs green webkit (fixed only here), this PR needs green `test-backend` (fixed only there). Resolved by merging `story/SHY-0243` into this branch (`--no-ff`, no conflicts). `test-backend` now **passes** on CI. This PR must be merged with a **MERGE COMMIT, not a squash**, so SHY-0243's tip stays an ancestor of develop and #1670 closes as genuinely Merged instead of stranded. Local gates after the merge: sleep ratchet OK (205, at baseline), `prettier --check "tests/**/*.ts"` exit 0, story + epic validators exit 0, the two suites 18/18.
- **2026-07-27 ~14:45 WIB** — Remaining webkit blockers narrowed with evidence, not guesses. All four reproduce **only in CI** — `preview-watermark` ×3 and `lang-flag` ×1 all PASS locally on webkit against the same `serve-web.js`. The CI badge text names the cause pair: `"…api unknown ●**??**Safari 26UID: -en · **/roadmap**"` — both git metas absent AND the route reading `/roadmap` instead of `/roadmap.html`; the `lang-flag` failure is the same shape (`/privacy.html?lang=fr` resolving to `en`, and `getLanguage()` is fully synchronous off `window.location.search`, so the query string was simply not there). Ruled out this session: client-side rewriting (`replaceState` only ever writes a hash), service worker (none exists), job container (none — all four jobs are bare `ubuntu-latest`), and a `serve-web.js` redirect (`curl` returns 200, no `Location`). Notably `preview-watermark` PASSED on #1670's webkit job (PR-triggered) and FAILED on run 30150757612 (dispatch-triggered, `ref: develop`) — so the discriminator may be checkout shape rather than a develop defect. Webkit-only dispatch 30245915287 armed on this branch to capture the `Serve-web log` step.

## Remaining work — measured 2026-08-17 21:40 WIB

`lint / Lint` fails on this branch's OWN strict ratchet (`lint.yml:161`,
"No fixed-duration waits (SHY-0245, strict)" — no baseline, zero tolerance).
`bash scripts/check-no-test-sleeps.sh` exits 1 with **116 offending lines**:

| file | count |
| --- | --- |
| `tests/web/suggestions-board.spec.ts` | **93** |
| `tests/web/roadmap-auth.spec.ts` | 10 |
| `tests/web/admin-audit-log.spec.ts` | 5 |
| `express-api/scripts/drivers/ios-appium-driver.js` | 2 |
| `tests/web/shared-header.spec.ts` | 1 |
| `express-api/tests/unit/ip-geo.unit.test.js` | 1 |
| `express-api/tests/scripts/matrix-dispatch.test.js` | 1 |
| `express-api/scripts/drivers/web-playwright-driver.js` | 1 |
| `express-api/scripts/drivers/web-common-methods.js` | 1 |
| `express-api/scripts/drivers/device-lock.js` | 1 |

Shape of the 93 in `suggestions-board.spec.ts` (2523 lines, 142 tests):
`waitForTimeout(500)` ×54, `(300)` ×20, `(1000)` ×10, `(2000)` ×5, `(200)` ×4.
They are scattered rather than following one pattern, so each needs its own
judgement about which condition to wait on.

**Why this was NOT batch-converted.** A sleep replaced by a wait on the wrong
condition is worse than the sleep: it passes trivially and reports green. That
is the same failure this story exists to eliminate, so 93 mechanical
substitutions would risk trading 93 slow tests for 93 vacuous ones. The three
voting tests converted earlier in this branch are the template — each one names
the state it waits for (`sg-vote-btn--active`) and was mutation-proven.

Note the driver-file sleeps (`ios-appium-driver.js`, `device-lock.js`,
`web-common-methods.js`, `web-playwright-driver.js`) arrived via the develop
merge, not from this branch. They are polling loops rather than test waits, so
they may warrant the documented-marker exemption rather than conversion — decide
per site; `lint.yml:159` notes an unexplained marker does NOT exempt.

## Notes (running log) — continued

- **2026-08-17 ~21:40 WIB** — CI state after the driver fix: `qa-runner-driver-checks` cause found and fixed (42 tests were passing locally only because a real phone was attached; `selectSerial` substituted it for the requested serial). `lint` remains red on the 116 sleeps above — this story's actual scope. `Pre-Merge Gate` needs a `Reviewed-up-to:` marker, which needs a reviewer pass on the current head.


- **2026-08-19 — merging develop into this branch is NOT a conflict-resolution
  job, and should not be attempted as one.** Assessed on 2026-08-19 while
  clearing the open-PR queue. The branch is **217 commits ahead / 38 behind**
  develop, and `git merge origin/develop` produces **17 conflicted files** —
  sixteen of them with one or two conflicts each, which are tractable, and
  **`express-api/scripts/manual-qa-runner.js` with 47**.

  The runner conflicts are **semantic, not textual**. A representative one:

  ```
  HEAD    :  await appMethod(ctx, 'PersonaSignIn')(personaId, tab, ctx.target);
  develop :  if ((await ctx.uiDriver.androidPersonaSignIn(...)) !== true) {
               return { ok: false, error: '... the step did not happen' };
             }
  ```

  This branch refactored those call sites behind an `appMethod` indirection.
  develop, meanwhile, landed **SHY-0330** — *"a journey step passes even when
  the driver did nothing at all"* — which added the `!== true` failure check at
  each of them. **Neither side can simply be taken:**

  - taking this branch's side **silently reintroduces the SHY-0330 bug** in every
    site it touches — steps that report success while the driver did nothing;
  - taking develop's side **discards the refactor** this story exists to make.

  Correct resolution means re-applying SHY-0330's guard *through* the new
  abstraction, forty-seven times, inside the 16k-line journey-test engine. Done
  hastily that is worse than not done: the failure mode is a green journey suite
  that proves nothing, which is precisely the defect SHY-0330 was filed to kill.

- **2026-08-19 — recommendation: REBUILD rather than merge.** Re-apply the
  sleep-eradication onto current `develop` as a fresh, smaller change, taking
  SHY-0330's guard as the starting point instead of fighting it. The sleep
  removals are individually mechanical; it is 217 commits of drift that makes
  the merge hard, not the change itself. That is a call worth the operator
  making explicitly, so this is recorded rather than decided unilaterally —
  everything else in the queue was merged, and this one deliberately was not.

- **2026-08-19 — REBUILT onto develop, at the operator's direction.** The
  original branch (#1673) was 217 ahead / 38 behind and could not be merged:
  `manual-qa-runner.js` alone carried **47 semantic conflicts**, because that
  branch refactored the runner's call sites behind an `appMethod` indirection
  while develop landed **SHY-0330**'s `!== true` guard at the same sites. Taking
  either side lost something real — this branch's refactor, or the guard that
  makes a step whose driver did nothing FAIL.

  The rebuild avoids that entirely. Measured rather than assumed: of the
  original branch's work, the **107 Playwright spec files applied to current
  develop with `git apply --check` returning 0** — no conflict at all. Only the
  runner was contested, and the runner is not where the sleeps were.

  Result: **228 → 119** `waitForTimeout` occurrences, with none of SHY-0330's
  guard disturbed.

- **2026-08-19 — shipped as a RATCHET, not a strict gate, and that is a
  deliberate downgrade from the original.** The original reached zero and ran
  `check-no-test-sleeps.sh` strict. This rebuild cannot honestly claim that:
  **209 waits across 37 files remain** (the script counts more forms than
  `waitForTimeout` alone — Kotlin, Swift and Jest sleeps too), and they are
  concentrated in `tests/web/suggestions-board.spec.ts` (**93**), with
  `roadmap-auth` (9), `admin-audit-log` (5) and two single occurrences.

  Those are not mechanically replaceable. The shape is
  `click(); waitForTimeout(500); const n = await locator.count();` — each needs
  the *right* condition, and the surrounding `expect(await x.count())` is itself
  the banned pattern. Replacing 93 of them blind would trade a sleep for a
  flake, which is a worse defect than the one being fixed.

  So the ratchet lands now with a baseline: **a NEW sleep fails immediately**,
  and the existing debt may only shrink. Proven in all three states — at
  baseline exit 0, with one added sleep exit 1, and exit 0 again once removed.
  Same model as the direct-backend and no-stubs ratchets already in `lint.yml`.

- **2026-08-19 — STILL OWED, and now enforced rather than remembered:** the 209
  baselined waits. `tests/web/suggestions-board.spec.ts` is 93 of them and is
  the obvious next unit of work. Status is **In Progress**, not In Review: the
  story's own AC asks for zero, and zero is not reached.
