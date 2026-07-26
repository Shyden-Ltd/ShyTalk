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

- [ ] Zero `page.waitForTimeout` calls remain anywhere in the repository.
- [ ] Every replaced wait blocks on the **condition** — a retrying assertion, an auto-waiting locator, `waitForFunction`, `waitForResponse`, or an explicit DOM anchor — never on elapsed time.
- [ ] `webkit` and `mobile-safari` pass the previously-failing specs in CI, which is the only environment where the defect reproduces.

### Error paths

- [ ] A replaced wait still **fails** when the condition genuinely never occurs, with a message naming what was awaited — a timeout must remain a failure bound, never the wait itself.
- [ ] The CI ratchet fails a PR that introduces a new sleep, and its message names the file, line and the sanctioned alternative.

### Edge cases

- [ ] Tests asserting **absence** ("must NOT appear") anchor on a positive settled state first, then assert absence — otherwise a retrying assertion passes trivially before the thing would ever have appeared.
- [ ] The auth-bootstrap anchor works on **both** paths in `roadmap-auth.js`: config-loaded (`onAuthStateChanged` → `updateGlobalAuth`) and config-never-loads (the 3s fallback → `renderAuthUI`). Both end with the Sign In button rendered, so that is the anchor.
- [ ] `expect(await x.count()).toBe(n)` is converted to the retrying `await expect(x).toHaveCount(n)` wherever it guards a state that settles asynchronously.

### Performance

- [ ] Total web-suite wall-clock **drops** — 230 removed fixed delays cannot make it slower. The reduction is recorded as measured data, not asserted.

### Security

- N/A — test-harness timing only; no authorization, credential or data-handling surface is touched.

### UX

- N/A — no user-facing behaviour changes. The product's own 3s config-fallback timer is a legitimate deadline, not a wait-then-assert, and stays.

### i18n

- N/A — no user-facing strings added or changed.

### Observability

- [ ] Each replaced wait names its condition in the code, so a future failure says what was being awaited rather than "timed out".
- [ ] The ratchet reports a count, so the remaining debt is visible rather than implied.

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

- **2026-07-25 ~15:20 WIB** — Filed on the operator's HARD ruling. Diagnosis chain: #1670 red on webkit/mobile-safari → my diff proven incapable of causing it (3 files, all express-api tests + a story `.md`, no mutant leaked) → 251/251 pass locally on the same specs → still 251/251 with CI's exact reporter and tracing config, ruling out the SHY-0200 trace-cost theory → both WebKit projects fail the **same** authenticated-state tests including retries, so deterministic and engine-correlated → source read showed `shared-header.js` re-renders on every `shytalk-auth-changed`, and the real bootstrap in `roadmap-auth.js` races the injected state. Inventory: 230 `waitForTimeout` in 29 files (all `tests/web/`), 41 non-retrying count assertions, 0 Kotlin `Thread.sleep`, 0 JS setTimeout-sleep. A clean webkit baseline against develop itself was dispatched (run 30150757612) to confirm the defect is pre-existing rather than introduced.
