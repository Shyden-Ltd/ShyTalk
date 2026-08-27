# Session handover — 2026-08-26 (part 20)

Self-contained. Everything needed to resume is here.

Part 19 ended with a ten-story branch and nothing pushed. This session merged
PR #1940, split that branch, and shipped a P0 that had never been caught.

---

## 1. Where the work is

| | |
| --- | --- |
| `origin/develop` | `effa2698eed` — was `c691ad046e6` at session start |
| `origin/main` | `6fce4c0874a` — **develop is still 3 commits behind main**, unchanged |
| The old combined branch | `story/SHY-0458-conversations-read-path-via-api`, untouched, still 45 commits ahead. **Nothing was lost.** |

**PR #1940 is MERGED** (45 stories, EPIC-0012). The dev deploy that followed
succeeded on every leg — backend, web, Android, personas, sanity, smoke — after
one re-run of the iOS TestFlight job (§5).

### Merged this session, as per-story PRs — 14 of the 15

`SHY-0452 · SHY-0454 · SHY-0455 · SHY-0456 · SHY-0457 · SHY-0458 · SHY-0461 ·
SHY-0462 · SHY-0463 · SHY-0464 · SHY-0465 · SHY-0466 · SHY-0467 · SHY-0468`

**The split is complete apart from SHY-0169** (§3) and EPIC-0006 (§4).
A dev deploy of the finished line went out at 22:05 with SHY-0464 named in the
build notes, as the standing rule requires.

Each was cut from `develop`, so each ran full CI — not the zero checks a PR
stacked on a feature branch would get.

### Still open

| PR | Story | State |
| --- | --- | --- |
| #2008 | EPIC-0006 — banners and notification settings via the API | **coverage gate 79.2% vs 80** (§4) |

### SHY-0461 and SHY-0463 could not be split from each other

Worth knowing before the next split. SHY-0463 was filed as "SHY-0461's
defects", and it does not FOLLOW 0461 — it COMPLETES it. Alone, SHY-0461 went
red on 11 tests across three identity suites, `POST /api/users/sign-in`
answering 500: it adds `checkUserBans()`, and the identity suites' Firestore
double has no `size` on its snapshots, so `bans.js` compares
`undefined < LIMIT` — false, not an error — and its pagination loop dereferences
`docs[-1]`. **SHY-0463 carried the fix to that double.** Paired: 288 tests, 16
suites, green. They shipped as one PR (#2017), which is recorded in its body.

A cherry-pick that applies cleanly proves nothing about whether the result is
GREEN. Run the story's suites on the split branch before opening the PR.

### Not yet pushed

`story/SHY-0169-realtime-read-transport-spike` — 2 commits, conflict resolved,
blocked on a decision (§3).

**SHY-0461, SHY-0463 and SHY-0464 have not been cut.** They conflict on
`develop` until SHY-0169 lands: the chain is `0169 → 0461 → 0463 → 0464`. All
four were verified to apply cleanly in that order.

---

## 2. SHY-0468 — an adult could open a DM thread with a minor

Found while migrating a test suite off `jest.mock` for the ratchet. A policy
chore turned up a P0.

```js
const callerCohort = req.auth.cohort;
if (callerCohort && other.cohort && String(other.cohort) !== String(callerCohort)) {
```

`authMiddleware` sets `{ uid, uniqueId, token }`. **There is no `cohort` on
it** — the claim lives at `req.auth.token.cohort`. So `callerCohort` was always
`undefined`, the `&&` short-circuited, and every caller passed the gate.

Proven against the real Auth emulator and the real middleware chain before the
fix:

```
POST /api/conversations   adult -> minor
  status : 200  (expected 404)
  stored : {"participantIds":["64209001","64209002"],"crossCohortAtMigration":false,...}
  VERDICT: CROSS-COHORT THREAD CREATED
```

**It never shipped.** The endpoint was in neither `main` nor `develop` —
checked, not assumed — so no such thread can exist. It is now in `develop`
*with* the gate working.

### Why nothing caught it

The suite mocked `requireSameCohort` to a pass-through **and** hand-supplied
`req.auth.cohort` — the very field production does not have. It asserted a 404
that the double produced while the code path that must produce it was switched
off. It passed for exactly as long as it was fiction.

Swept: `req.auth.cohort` was read in exactly one place in the codebase. Every
other cohort decision already used `cohortFromClaim` / `effectiveCohort`, which
fall back to `'minor'` rather than to "unknown" — so a stripped claim restricts
a caller instead of freeing them. Both sides now use them.

**Mutation-tested**: reverting the resolver turns 5 of the 15 tests red.

---

## 3. SHY-0169 needs a decision before it can be pushed

The no-new-stubs ratchet (EPIC-0003) blocks the push. Two files:

- **`tests/utils/sse.test.js` — resolved.** `utils/sse.js` requires nothing and
  talks to no emulator; its whole contract is what it writes to a response
  object and when it stops. Testing it needs a fake socket, and a real HTTP
  server would only test Node. Renamed `sse.unit.test.js`, which the ratchet
  explicitly permits, with the reasoning recorded in the file. Already committed.

- **`tests/routes/conversations-stream.test.js` — open.** It calls
  `streamHandler()(req, res)` directly with fake req/res; it never opens HTTP.
  It drives `onSnapshot` and `checkSuspension` to assert per-delivery
  authorization, frozen-thread filtering, teardown and error propagation.

Three honest options, materially different in cost:

1. **Rewrite on the real stack.** Four of the eight tests can be: subscribe,
   write to Firestore, suspend the user mid-stream, assert delivery stops. Two
   cannot — "disconnect detaches the Firestore listener" and "a listener error
   closes the stream" assert internal wiring nothing outside can drive.
2. **Extract and split.** Pull the stream's authorization/filter decision into a
   pure unit (the shape SHY-0466 used for `roomScreenContentFor`), unit-test
   that, and real-stack the delivery path. Best answer, largest change, and it
   edits product code on a story whose SSE approach the operator ratified on
   2026-08-25.
3. **Operator-approved exception**, which the ratchet offers by name. Defensible
   — it *is* a handler-level unit test — but it is a reclassification of someone
   else's route test and should not be made silently.

**This is why SHY-0169 is unpushed, and it blocks 0461, 0463 and 0464.**

---

## 4. EPIC-0006's coverage gate

`new_coverage` 79.2% against an 80 threshold. Everything else on the gate is
clean — reliability 1, security 1, maintainability 1, duplication 0.0,
hotspots 100%.

Not `notifications.js`, which is at 93.75%. PATCH round-trip tests were added
this session (it had none at all — a field could be accepted and silently
dropped and no test would notice) and the number did not move. The remaining
drag is **`scripts/audit-direct-backend.js`, 298 new lines with no tests**.
That is the honest fix and it is contained work.

---

## 5. The iOS deploy failure was transient

The first dev deploy failed on "Build, archive, and export iOS app" — log ending
mid-compile, no error, no OOM or disk signature, and neither the 50-minute step
timeout nor the 120-minute job timeout reached. One deliberate re-run (operator
authorised) **succeeded**. Runner flake, not a defect. No ticket filed.

---

## 6. Environment as left

- Local stack UP, **restarted `FRESH=1` at 16:42** (§7). 17 personas seeded.
- The machine's LAN address moved twice during the session (`.3` → `.5` → `.3`)
  and the phone's with it. SHY-0465's chooser handled it each time — **do not
  hard-code either address**; it re-derives them every start.
- OnePlus `CPH2653` (`3b402284`) on USB. Sean's iPhone available and paired.
- Previous emulator data kept at
  `local/firebase-emulator-data.pre-fresh-20260826-164227`.
- GitHub reports **19 Dependabot vulnerabilities on the default branch**
  (2 critical, 12 high, 4 moderate, 1 low). Untouched this session; surfaced on
  every push.

---

## 7. Traps met this session

- **The pre-push gate runs against the LOCAL stack.** After ~13 hours up and a
  full 15,665-test express run, the emulator held 150 support tickets, and six
  unrelated admin Playwright specs failed the gate on a branch touching only
  journey scripts. `FRESH=1 bash local/start.sh` cleared all six. **Restart
  fresh before a session of pushes.**
- **Two canonical runners, and bare calls lose their environment.** express is
  `npm test` from `express-api/`; Playwright is `bash local/test-playwright.sh`,
  which supplies `API_BASE_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. `npx
  playwright test` dies in `helpers/admin-auth.ts` — an invocation error that
  looks like a product failure. This cost two wrong conclusions in a row: a
  "reproduction" and then a "disproof", both of which were failing on missing
  env vars and testing nothing.
- **A linter's suggested fix can be the defect.** SonarCloud's S2871 asked for a
  comparator on the sorts that build a conversation's ID and suggested
  `localeCompare`. Those IDs must be identical on iOS, Android and the server;
  a locale-dependent sort would give two devices different threads. An explicit
  code-unit comparator satisfies the rule without that.
- **A split can separate a pin from the thing it pins.** One commit both
  recorded SHY-0452 as fixed and dropped the locale string count for SHY-0454's
  deleted strings. Grouping by the commit's tag left SHY-0452 expecting 880 keys
  while carrying 883, and SHY-0454 deleting three while expecting all 883.
- **A guard fired correctly and looked like a stale pin.** J09 signs in as the
  voice host, which was also the iOS support persona; Android and iOS run in
  parallel, so the two walks would share one account.
  `device-journey-parallel-isolation` named that exact case in its own comment.
  Support moved to P-11, the only adult/en/MEMBER persona no journey uses.
- **zsh does not word-split unquoted variables.** A cherry-pick dry run reported
  11 false conflicts because `for s in $shas` ran once with the whole string.
  Re-run in Python: 9 of 15 clean, and the 6 conflicts were exactly the
  dependency chains.
- **The husky pre-push hook scans the WORKING TREE, not the ref being pushed.**
  Nine `git push <branch>` calls from the wrong checkout all failed on debt that
  belonged to a different branch. Checkout, then push.

---

## 8. Two of the four "pre-existing" failures were SHY-0457's

Parts 18 and 19 recorded `drivers/ios-session-recovery` and
`drivers/journey-device-parity` as pre-existing debt. That was true of the
COMBINED branch — and the combined branch contained SHY-0457. Run on `develop`,
both suites are green: 29 suites, 2823 tests. Split apart, they follow SHY-0457,
because it is what introduced them.

What they were saying:

- **`journey-device-parity`** — `hideKeyboard` exists on NEITHER backend, and
  the guard refuses an exemption for a method nothing implements. SHY-0457 added
  `dismissKeyboard(device)`; its Android path is real (`KEYCODE_BACK`, which does
  not navigate while an IME is up), and its iOS path called
  `device.hideKeyboard()` "where the driver offers one" — and the driver offered
  none. **The iOS keyboard was never dismissed at all**, which is the "control
  behind the keyboard" failure the helper was written to prevent.
- **`ios-session-recovery`** — `longPressElement` reached the iOS prototype
  without anyone deciding whether it survives a WDA restart.

Both fixed on the branch: `hideKeyboard` implemented on the iOS driver, both
commands registered in the recovery table with how they survive running twice,
and the long-press pair documented as the guarded platform pair it is.

The recovery guard then caught a flaw in that implementation too. The first
version caught its error INSIDE `withSessionRecovery`, which swallows a dead
session before the recovery machinery sees it — the stale id survives and every
later command fails, one WDA death becoming a whole failed journey. The
tolerance now sits outside the wrapper.

**Device proof for the iOS dismissal is owed.** The call is best-effort and
warns rather than throwing, so a WDA that refuses the route costs a worse
screenshot, not a failed journey — but it has not been run against Sean's
iPhone.

**The remaining two of the four are real and still open**: `check-no-new-stubs`
(§3, SHY-0169's stream test) and `device-journey-parallel-isolation`, which
SHY-0456 fixed and is now merged.
