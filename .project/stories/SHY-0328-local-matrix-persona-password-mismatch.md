---
id: SHY-0328
status: In Review
owner: claude
created: 2026-08-18
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0328: The local journey matrix cannot pass on any branch, because it seeds with one password and signs in with another

## User Story

As a **developer running the pre-merge gauntlet**, I want the local journey
matrix to seed and sign in with the same persona password, so that Phase 1 of
the Pre-Merge Testing Protocol is actually achievable.

## Why

**This is P0 because it invalidates the gate every story is supposed to pass.**

Measured live on run `20260817-235347-local`: **0 pass / 5 fail / 7 skip**, and
per cell **exactly `OK=2 / FAIL=224`** — on `chromium`, `mobile-chrome-android`,
`mobile-firefox-android`, `mobile-safari-ios` and `mobile-chrome-ios` alike. The
uniformity is the diagnosis: real product debt does not fail every scenario of
every feature on every browser, including desktop `chromium`, which touches no
device at all.

Two scripts disagree about one credential:

- `20-reseed.sh:43` **FORCES** local personas to `localdev123`, because the
  `.local` app flavour bakes `DEV_QA_PERSONAS_PASSWORD='localdev123'`.
- `50-matrix.sh` sources `~/.shytalk/dev-personas.env` and requires
  `PERSONAS_PASSWORD` from it (`:56,:61`) — the **32-character DEV** secret —
  then passes it to the runner with no local override (`:114`).

So the run seeds with one credential and signs in with another. Every persona
sign-in fails, so every journey dies at its first gate.

**The asymmetry that hid it.** The SEED side has been guarded since 2026-07-11 —
`20-reseed.sh:63` dies with "personas seeded with the WRONG password
(INVALID_PASSWORD) — a dev PERSONAS_PASSWORD leaked into the seed". Nobody ever
guarded the RUNNER side, so the mirror-image failure was silent.

**And it was believed fixed.** A reference note dated 2026-07-22 records this
exact root cause and states the fix is "in place since 2026-07-22", pinned by
`matrix-local-persona-password.test.js`. Neither exists: `git log -S
"PERSONAS_PASSWORD=localdev123" -- express-api/scripts/gauntlet/50-matrix.sh`
returns **no history at all**, and the test file is absent from develop, main and
every story branch. The fix was written up as done and never landed — so this is
not a regression, it is a fix that never shipped, and the note has been corrected.

The consequence is worth stating plainly: **any claim of "LOCAL gauntlet green"
since 2026-07-22 was not achievable.** That includes the release-gate protocol.

## Acceptance Criteria

### Happy path

- [ ] `50-matrix.sh` passes `PERSONAS_PASSWORD=localdev123` to the runner for `target = local`.
- [ ] A local matrix run reaches real journey execution — persona sign-in succeeds and the per-cell shape is no longer `OK=2 / FAIL=224`.
- [ ] The value is DERIVED from `20-reseed.sh` by the pinning test, not hard-coded twice.

### Error paths

- [ ] Removing the override turns exactly one named test RED (mutation-proven).
- [ ] A future change to the seeded password without a matching runner change fails the test.
- [ ] `target = dev` is NOT overridden — dev personas use the real secret, and pinning `localdev123` there would break every dev run just as uniformly.

### Edge cases

- [ ] The test reads the FORCING assignment in `20-reseed.sh`, not a mention of the password in a comment.
- [ ] If `20-reseed.sh` stops forcing a password at all, the test fails loudly rather than passing against `null`.
- [ ] A dev-length secret appearing on the seed line fails the test (the runtime guard at `20-reseed.sh:63` pinned statically too).
- [ ] An operator who has already exported `PERSONAS_PASSWORD` in their shell still gets the pinned local value — the override is in the runner's env prefix, so it wins.

### Performance

- [ ] N/A — a one-line env-prefix change and a file-reading test. No runtime cost.

### Security

- [ ] `localdev123` is a LOCAL-EMULATOR credential only; it is already committed in `20-reseed.sh` and the `.local` flavour, so pinning it in `50-matrix.sh` discloses nothing new.
- [ ] The real 32-char dev secret is never written into a script, a log, or this story.
- [ ] The `dev` target keeps sourcing the real secret from `~/.shytalk/dev-personas.env`, unchanged.

### UX

- [ ] N/A — developer tooling with no end-user surface. The developer-facing outcome is that a 0-pass matrix stops being the default state.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] A future 0-pass run is diagnosable from the run artefacts alone: the triage ladder (per-cell `OK`/`FAIL` counts, then the watermark `UID:` field in a scenario screenshot) is recorded in the reference note.
- [ ] The runner side now has parity with the seed side's existing loud failure.

## BDD Scenarios

**Scenario: A local test run can actually sign in**

- **Given** a freshly seeded local environment
- **When** the journey matrix runs
- **Then** the test personas sign in successfully

**Scenario: Every journey no longer dies at the first gate**

- **Given** a local journey matrix run
- **When** it finishes
- **Then** the results are not zero-passed across every browser

**Scenario: Changing the seeded password without the runner is caught**

- **Given** someone changes the password used to create the test accounts
- **When** the checks run
- **Then** they fail until the run's sign-in password is changed to match

**Scenario: Runs against the shared dev environment are unaffected**

- **Given** a run targeting the shared dev environment
- **When** it signs in
- **Then** it uses the real dev credential, not the local one

## Test Plan

**RED first.** The failing state was measured before any change: run
`20260817-235347-local`, `0 pass / 5 fail / 7 skip`, `OK=2 / FAIL=224` per cell.

### Node / Jest — `express-api/tests/scripts/gauntlet/matrix-local-persona-password.test.js`

- `20-reseed.sh forces an explicit local persona password`
- `50-matrix.sh has a local env_prefix at all`
- **`the runner password for local EQUALS the seeded password`** — the defect in one assertion
- `does NOT override the password for dev — dev personas use the real secret`
- `the seeded password is not the 32-char dev secret`

The expected value is derived from `20-reseed.sh`. A test hard-coding
`localdev123` on both sides would pass on the day someone changes the seed —
exactly the drift it exists to prevent.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| the `PERSONAS_PASSWORD=localdev123` override removed | `the runner password for local EQUALS the seeded password` |
| `localdev123` also pinned for the `dev` target | `does NOT override the password for dev` |
| the seed line's forcing assignment removed | `20-reseed.sh forces an explicit local persona password` |
| the test hard-codes the value on both sides | it would stop failing under mutation 3 — checked by inspection |

Verified: 5/5 green with the pin; removing the pin turns exactly one named test
RED, and the tree was restored with the pin re-applied and re-verified.

### Real-run proof

- Relaunch the matrix on the same machine and devices and confirm persona
  sign-in succeeds and the per-cell shape changes. **A green test is not the
  deliverable here — a matrix that can actually run is.**

### CI-config-only classification

Touches `express-api/scripts/gauntlet/**` and a new test under
`express-api/tests/scripts/**`. No app, backend or website runtime surface →
CI-config-only, so no device gauntlet for this change itself.

## Out of Scope

- Fixing whatever journey failures the matrix reveals ONCE it can sign in. Those
  are real findings and get their own stories; this one only makes them visible.
- The 7 skipped cells (Samsung Internet is not installable on the OnePlus; Edge
  needs its first-run flow completed; Chrome's CDP socket needs an active
  renderer).
- Any change to the `dev` target's credential handling.

## Dependencies

- None. This is a one-line script change plus its test, and it blocks everything
  that needs a local gauntlet — so it should land first.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| **Believed-fixed again without landing** — the exact failure mode last time | The pinning test is part of this story's DoD, and the reference note has been corrected to say the earlier fix was never committed. A note is not a fix. |
| `localdev123` pinned for `dev` by a later well-meaning edit | Explicitly asserted against, and in the mutation table. |
| The test hard-codes the value and stops detecting drift | It derives the expected value from `20-reseed.sh`; mutation 3 checks that derivation is real. |
| The matrix still fails after this, and the fix looks wrong | Expected and fine: this unblocks sign-in, it does not promise green journeys. The DoD asks for a CHANGED per-cell shape, not a passing matrix. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] **A real local matrix run shows persona sign-in succeeding** and a per-cell shape other than `OK=2 / FAIL=224`.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`; `actionlint` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Found while running the local gauntlet for PR #1696 after the operator enabled iOS UI Automation. The matrix launched cleanly (reseed verified, 9 tunnels, both devices prepped, 14 ok / 0 fail / 3 skip on `--check-drivers`) and then returned `0 pass / 5 fail / 7 skip`.
- **2026-08-18** — Diagnosed via the documented triage ladder rather than guessed: per-cell `OK`/`FAIL` counts first (`OK=2 / FAIL=224`, uniform), which identifies auth over product debt.
- **2026-08-18** — The reference note claiming this was fixed on 2026-07-22 was WRONG. `git log -S` finds no history for the pin, and the pinning test does not exist on any ref. Corrected the note in place; it now leads with the correction so the next reader does not trust it again.
- **2026-08-18** — Filed P0 / `mvp: true`: it invalidates Phase 1 of the Pre-Merge Testing Protocol, so any "local gauntlet green" claim since 2026-07-22 was unachievable.

## ⚠️ IMPORTANT — this fix does NOT make the matrix pass

Verified after landing the pin, on run `20260818-001021-local`:

- The override **reaches the runner**. `ps eww` on the live process showed
  `NODE_ENV=local PERSONAS_PASSWORD=localdev123` on `manual-qa-runner.js`, and the
  launched `bash -c` command line carries it too.
- The matrix is **still 0-pass**: `OK=4-5 / FAIL=221-222` per cell, versus
  `OK=2 / FAIL=224` before. Marginally different, fundamentally the same.
- A scenario screenshot still reads **`UID: —`** on a public page
  (`/community-guidelines.html`, `ar`), i.e. the browser was never signed in.

So the password mismatch was **real and latent** — the two scripts genuinely
disagreed, and the test proves the fix — but it was **not** the cause of the
0-pass runs. Do not close this story believing the matrix now works.

Also ruled out, so nobody re-checks them:

- **Stack health.** `:3000 /api/health` → 200, `:8888` → 200, `:9099` auth
  emulator → 200, all six stack ports listening.
- **`api unknown` in the watermark is cosmetic.** `/api/health` returns
  `{"status":"ok","sha":"unknown"}` — the watermark faithfully reports that the
  API does not know its own git SHA. It is NOT an API-reachability failure.

**Next place to look** (for whoever picks up the remaining 0-pass): what the
runner's persona sign-in does with `ctx.personasPassword`, and whether the seeded
accounts actually exist in the auth emulator after `20-reseed.sh` reports
"complete + verified" — its verification proved ONE sign-in worked, which is not
the same as the runner's own path working.

The AC "a per-cell shape other than OK=2 / FAIL=224" is technically met and that
is **not good enough**; treat the real bar as sign-in succeeding, and split the
remainder into its own story rather than stretching this one.

## The sign-in path, dug all the way down (2026-08-18)

Operator asked for the runner's persona sign-in path specifically. Three layers,
each hiding the next.

**Layer 1 — the password.** Fixed and pinned above. Proven insufficient on its own.

**Layer 2 — the runner authenticated against PRODUCTION on a local run.**
`manual-qa-runner.js` resolved the Identity Toolkit base at four sites as:

```js
ctx.target === 'local' && process.env.FIREBASE_AUTH_EMULATOR_HOST
  ? emulator : 'https://identitytoolkit.googleapis.com'   // ← production
```

`20-reseed.sh:32` sets `FIREBASE_AUTH_EMULATOR_HOST` for seeding. `50-matrix.sh`
never set it for the runner. So every local matrix run signed personas in against
**real Google auth** with a `fake-local-key` API key — the exact same asymmetry as
the password, one variable over, and equally silent.

This is `if (check) { right thing } else { wrong thing }` with no complaint. Fixed
two ways: `50-matrix.sh` now pins the host for local, and a new `resolveAuthBase()`
**refuses** the production fallback on a local target rather than quietly using a
different URL. A local run must never reach production auth — it cannot succeed,
and it should not be attempting it.

Both proven against the live process (`ps eww` showed `PERSONAS_PASSWORD=localdev123
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 NODE_ENV=local`), and the REST sign-in
errors disappeared from the run log.

**Layer 3 — the actual dominant cause: the driver surface is incomplete.**
With auth resolving, the real blocker is visible: **64 `not implemented yet`**
failures from **5 distinct web-driver stubs** —

    webAdminIssueWarning        webAdminShowsDashboardCounters
    webFallbackEnStrings        webOpenProfilePanel
    webShowsNonEmptyLocaleText

— and `webSignIn` is **not implemented on any web driver at all**
(`grep -rn "webSignIn" scripts/drivers/` returns nothing), so the step
`^([A-Z][a-z]+) on Web signs in with valid credentials$` can only ever return
`ctx.webDriver.webSignIn not configured`. That is why the browser is never signed
in and every watermark reads `UID: —`.

**So the 0-pass matrix was never one bug.** It is the known missing-driver-method
inventory (see `[[project-zero-gap-journey-matrix-inventory]]`, 114 methods), and
layers 1 and 2 were masking it — the run failed at auth before it could reach the
missing methods. Fixing them does not make the matrix pass; it makes the real
debt visible and attributable, which it was not before.

**Verified after all three changes:** 2017/2017 across 9 runner + gauntlet suites;
eslint `--max-warnings=0`, prettier, `check-no-new-stubs.js` and `bash -n` all
clean.

**Scope call:** implementing 5+ web-driver methods is not this story. It belongs
with the driver-gap inventory. This story ends having made the local matrix able
to *authenticate*, with both env pins test-pinned and the production fallback
made impossible.

## Layer 4 — the definitive answer (2026-08-18, run 20260818-005216-local)

Two facts settle it.

**`--bail 3`.** The matrix aborts a cell after 3 failures
(`"error": "matrix aborted by --bail 3 after 3 failure(s)"` in
`matrix-report.json`). So `FAIL=221` was never 221 attempts — it is a handful of
real failures plus ~218 scenarios that never ran. That is why three separate
fixes moved the aggregate barely at all: the FIRST failures were unchanged, and
everything after them is arithmetic.

**The real reasons.** Running one journey directly and reading the generated
report (`/tmp/manual-qa-cycle-1.md`) gives what the cell logs never did:

```
j01 :: Adam signs up with email/password/DOB
  step:  When Adam on Android taps "signin_signUpLink"
  error: UI step requires ctx.uiDriver (tag=persona_picker_open)

j01 :: Adam accepts privacy + terms
  step:  Then within 5000ms Adam's Android UI shows the legal acceptance screen
  error: ctx.uiDriver.androidShowsNamedKind not configured
```

**j01 is an ANDROID-first journey.** Its failures are missing *driver methods*,
not auth and not configuration. Same for the 256 `not implemented yet` entries
across 5 web stubs. This is the missing-driver-method inventory
([[project-zero-gap-journey-matrix-inventory]], 114 methods) and nothing else.

### What this story fixed, and what it did not

**Fixed, all real and all test-pinned:**
1. Persona password mismatch — seed forced `localdev123`, runner got the 32-char dev secret.
2. Runner authenticated against **production** Identity Toolkit on local runs, because `FIREBASE_AUTH_EMULATOR_HOST` was never set for the runner. Now pinned AND the fallback is refused outright.
3. `webSignIn` implemented on **all seven** web drivers (two transports: Playwright Page, and WebDriver REST for geckodriver/Appium). Proven against the real stack — `uid: rjSZL33Km1lx7dbJWmblufjlAyCE`, matching a direct emulator REST sign-in for the same persona.

**Not fixed, and not this story:** the driver-method inventory. That is a large,
already-tracked programme. What changed is that it is now the ONLY thing in the
way — before tonight it was masked by three layers of auth and configuration
failure, and the uniform `OK=2 / FAIL=224` shape made it look like product debt.

### The triage ladder that actually works

1. `matrix-report.json` → check for `--bail`. Per-cell FAIL counts are not attempt counts.
2. Run ONE journey directly and read the generated report — the cell logs carry titles, not reasons.
3. `grep -c "not implemented yet"` — if it dominates, it is driver debt; stop hunting a config bug.
4. `ps eww -p <runner-pid>` — confirm the env the runner ACTUALLY got.
5. Only then the watermark `UID:` field.


## Review rounds (2026-08-18) — what the reviewer found that I did not

Four rounds. Recording them because the pattern is more useful than the fixes:
**every single finding was a test that could not fail, not a product bug.**

### R1 — the coverage was theatre on six of seven drivers

`webSignIn` was wired into all seven web drivers, and only the desktop one had
any behavioural test. The two files that *appeared* to cover the other six do
not: `driver-contract.test.js` asserts `listMethods()` equals
`WEB_METHOD_NAMES`, but `listMethods()` **is** `[...new Set(WEB_METHOD_NAMES)]
.sort()` — it compares a constant to itself and can never fail for a real
reason. `driver-interface-pin.test.js` counts string literals in the array's
source text.

Consequence, measured rather than argued: pointing the firefox driver's
`executeAsync` at `/execute/sync` — which makes sign-in report success *before*
the auth Promise settles — turned **0** tests red. It now turns 2 red.

Also unproven: `resolveAuthBase`'s refusal, which was pinned only on the
exported pure function. Dropping the `.ok` guard at any one of its four call
sites would have left `authBase` undefined, silently building
`"undefined/v1/accounts:signInWithPassword?key=..."`, with every test still
green. Five tests now drive all four call sites through real matcher dispatch.

### R2 — a test-isolation bug I introduced, and a call I got wrong

The new refusal block captured its saved env value as a bare
`const SAVED = process.env.X` in the `describe` body. **Jest evaluates describe
callbacks during collection**, before this file's root `beforeAll` sets
`FIREBASE_AUTH_EMULATOR_HOST` — so it captured `undefined` and its `afterEach`
then DELETED the variable for every test that followed. Blast radius was zero
only because the block happened to be last in a file that has grown by
appending for months. Proven with a probe test, which is kept as a permanent
isolation guard.

Worth recording: my first attempt to prove it used `-t "PROBE"`, which filtered
out the block that CAUSES the leak, so the probe passed. **A filtered run
cannot detect a cross-block interaction bug** — the filter removes the
interaction.

I had also declared the injected browser script untestable in-process. The
reviewer pushed back and was right: it is a self-contained state machine whose
only collaborators are `window.shytalkAuth`, `Date.now` and `setTimeout`, all
of which a test supplies. It is now exported as `WEBDRIVER_SIGN_IN_SCRIPT` and
executed for real via `node:vm` against a virtual clock.

### R3 — my harness could not see the bug it existed to catch

The vm drain loop exited on the FIRST result. A script that fires `done()`
twice schedules the second with a fresh `setTimeout` that lands in the queue
*after* that iteration captured its batch — so whenever the first fire came
from a batched timer callback rather than a promise reaction, the second was
invisible.

The reviewer predicted, from a mechanistic model, that under a narrow
single-statement mutation the "currentUser materialises late" test would
SURVIVE. It did. My earlier "5 of 7 killed" had mutated a different statement.
Exit condition is now "a result AND nothing still pending".

**A test named "fires exactly once" that cannot observe a second call is not a
weak test — it is an instrument fault, and no number of passing runs would ever
have revealed it.**

### The one REAL product bug, found only because the coverage got honest

Both phases shared a single 20s deadline. A page whose Firebase SDK is slow to
appear silently eats the budget the `currentUser` wait needs, so sign-in
reports `no currentUser after sign-in` when nothing is wrong — a false
NEGATIVE, worst on the slowest surface we run (a real iPhone over Appium on a
cold page). `makeWebSignIn`, the Playwright twin, gives each phase its own
fresh 20000ms timeout, and this module's docstring claimed the two differ only
in transport. That claim was false. Fixed RED-first: `waitForUser` now has its
own budget.

### Totals

14038 → **14104** tests. 66 added across the four rounds, every one of them
mutation-checked rather than assumed.

### R4/R5 — the step was lying, and the fix had an unbounded tail

**R4, and this is the story's own headline bug.** The Web sign-in matcher did
`await ctx.webDriver.webSignIn(name); return { ok: true };` — it DISCARDED the
result. Every refusal implemented across seven drivers resolves `false`, and the
step reported PASSED. Two existing tests PINNED the defect: their spies resolved
`undefined` and asserted `ok: true`, which is proof the result was never
inspected. Now `signedIn !== true` — strict, so a driver that forgets to return
reads as failure rather than success.

**R4 also caught a Critical in R3's own fix.** Per-phase deadlines raised the
script's worst case to ~40s, but the W3C default script timeout is 30000ms and
none of the three REST drivers set one (verified: zero occurrences). A
legitimately-slow-but-SUCCEEDING sign-in could be killed server-side and surface
as a transport error — strictly worse than the bug R3 fixed, and invisible to
the `node:vm` harness by construction, since that harness models the script's
logic and has no notion of a remote protocol ceiling. `timeouts: {script: 45000}`
now pinned on all three, asserted against the script's own worst case rather
than a literal.

**R5 verdict: clean on this commit.**

## Owed after this story — do NOT lose these

### 1. ~~The discarded-verdict bug class is systemic~~ — DELIVERED, SHY-0330 (#1790)

> **Superseded 2026-08-18.** Filed and shipped as **SHY-0330 — "A journey step
> passes even when the driver did nothing at all"**, merged in PR #1790. The
> sweep went far wider than the 7 sites listed below: **116** discarded-verdict
> call sites now check `!== true`, the `iosTap`/`iosTapByTag` contract mismatch
> is fixed, and the driver stubs THROW instead of returning `false`. The
> analysis is kept for the record; do not re-file it.


R5's sweep found the same shape at **7 more call sites / 5 driver methods**:

| `manual-qa-runner.js` | Step | Method |
| --- | --- | --- |
| :2857 | Android taps "&lt;tag&gt;" | `androidTap` |
| :2910 | Android types into "&lt;tag&gt;" | `androidTap` |
| :2996 | iOS taps "&lt;tag&gt;" | `iosTap` |
| :3128 | Web taps "&lt;tag&gt;" | `webTap` |
| :3602 | Web refreshes rooms list | `webRefreshRoomsList` |
| :3734 | Android searches in &lt;screen&gt; | `androidSearchIn` |
| :3750 | Android types into search | `androidSearchIn` |

Each has a pinned "theatre" test (spy resolving `undefined`, asserting
`ok: true`). `webFillIn` (:10343) and the `*TapOnCard` family (:10371) already
do it correctly — use them as the reference.

**`iosTap` (:2996) is the severe one and is a COMPOUND bug.** The runner passes a
STRING tag. `ios-simctl-driver.js` takes one. But `ios-appium-driver.js` — the
driver behind `--driver appium`/`all` with `WDA_TEAM_ID`, i.e. the transport
enabled on 2026-08-18 — defines `iosTap(x, y)` taking **numeric coordinates**;
its string-based method is `iosTapByTag`. So every iOS tap sends
`x="<tag>", y=undefined`, Appium rejects it, `iosTap` returns false, and the
runner discards it. **Every "on iOS taps" step is a guaranteed no-op reporting
PASS**, and its test asserts `toHaveBeenCalledWith('<string>')`, encoding the
wrong contract.

This corrupts the triage ladder recorded above: per-cell OK counts cannot be
trusted while taps that silently no-op are indistinguishable from taps that
worked. **Do not draw conclusions about matrix health from a run until this
lands.** R5 called its sweep a floor, not a ceiling — ~150 `androidShows*` /
`iosShows*` assertion methods were not individually re-verified.

Also fold in `webTypeIntoSearch` (:6457), which deliberately treats `undefined`
as pass and is now inconsistent with the `!== true` convention.

### 2. Appium may not honour `timeouts.script` — verify on the real iPhone (STILL OWED)

`timeouts` is a W3C standard capability, so geckodriver is settled. For the two
Appium/iOS drivers it is confirmed to survive capability validation, but whether
the XCUITest driver's WEBVIEW `/execute/async` path derives its ceiling from
session `timeouts.script` or from a separate WebKit RPC timeout
(`webkitResponseTimeout`, historically well under 45s) is UNVERIFIED. The unit
test proves the capability is REQUESTED, not that Appium honours it — that is a
real-device question by construction. Decisive check: slow the Firebase SDK load
past ~25s on the real iPhone and confirm no early transport timeout.

Reviewed-up-to: ae898a8fcad

- **2026-08-18** — Merged develop in to pick up the CI fixes that were blocking
  this PR (SHY-0334's apt hardening and SHY-0329's driver-checks budget). The
  merge was clean, but the tree then showed 10 failures in `50-matrix.sh`
  suites — a file this story modifies, so it looked like a real conflict.

  It was not. `50-matrix.sh` resolves the repo BY PATH and refuses anything not
  at the canonical location, so every test that shells out to it fails inside a
  git worktree (`FAIL repo not found at .../ShyTalk-shy0328`), whatever the
  code says. `SHYTALK_REPO` does not override it. The same suite passes 9/9 in
  the canonical tree.

  Recorded because it is a real limit on reviewing/testing from worktrees, and
  because the near-miss was expensive: read cold, "10 failures after merging
  develop" in a file this story touches reads as a merge conflict.

- **2026-08-18** — Incremental review of everything after the previous
  `Reviewed-up-to` marker (the develop merge's conflict resolution plus these
  Notes). One Important finding, applied: the two failure-path tests for the Web
  sign-in step asserted only `ok: false` and a loose `/Lena/`, so **the enriched
  error message this merge deliberately kept could have been deleted with every
  test still green** — the returned value and the pointer to the driver's output
  were both unasserted. Three assertions added, plus a test for a non-boolean
  return, which is the only case that exercises `JSON.stringify` rather than
  trivial template coercion.

- **2026-08-18** — The reviewer also read this file's post-marker delta as the
  15 lines AFTER the marker line, when 74 of the 89 added lines sit above it.
  Reading them myself found the real problem: the "Owed after this story"
  section still filed the discarded-verdict sweep as future work, and SHY-0330
  had already delivered it. Marked superseded rather than left to send the next
  reader chasing finished work.
