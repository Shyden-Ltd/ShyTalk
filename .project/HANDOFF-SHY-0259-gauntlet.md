# Handoff — SHY-0259 gauntlet, 2026-08-02

Branch: `story/SHY-0245-eradicate-test-sleeps` · nothing pushed (no-push-during-gauntlet).

## OVERNIGHT 2026-08-02/03 — what changed while the operator slept

Nothing pushed. Everything committed on `story/SHY-0245-eradicate-test-sleeps`.

**Read the settled counts CORRECTLY.** The retry pass REWRITES `<cell>.log`, so
`total=228` does not mean the cell finished. Read only once the `DONE`/`FAIL`
sentinel exists AND the pid is gone. I misreported "OK 15 -> 17" twice from
mid-flight reads; the truth is app-android has been FLAT at OK=16 since run 6:

| settled run | android OK | FAIL | SKIP | ios OK | FAIL | SKIP |
|---|---|---|---|---|---|---|
| 6-10 | 16 | 101-102 | 110-111 | 13 | 122 | 93 |

Most of what was fixed removed FALSE failures — which converts them into honest
results, not into passes. Several fixes also move a failure one step LATER in the
same scenario, which the totals cannot show at all.

### Product / data defects found (need operator decisions)

1. **Adam and Greta were the same user.** `uniqueId 90000001` belonged to BOTH
   registry P-12 Greta (the ADMIN) and ephemeral P-01 Adam, so they shared one
   `users/90000001` document and whichever seeded last won — silently stripping
   admin rights or granting them to a brand-new signup. FIXED (Adam -> 90000002)
   plus a shrink-only guard. This was visible for a day as "signing in as P-12
   shows Adam", which reads like a display bug.
2. **A suspended user was told to check their internet connection.** Full chain
   fixed (see below); the appeal button was unreachable.
3. **`segregationEvents` stores ids as STRINGS** while the rest of the schema
   uses numbers — NOT fixed, needs a migration decision. See its section below.

### Harness defects found (all fixed)

- **Android shadowed 86 of 104 shared methods** — a fix to `app-ui-methods.js`
  has a one-in-six chance of never running on Android. Frozen, shrink-only.
- **The iOS text assertion could never pass on a device.** It checked
  `"label":"…"` (JSON); `iosUiDump` returns Appium /source, which is XML. Three
  existing tests fed it JSON, so harness and tests shared one wrong picture.
- **110 skips a cell with no reason recorded**, and the summary blamed
  `@manual` for all of them. Now itemised; 67 were web scenarios on an app cell
  and were being described as missing a device driver the cell already had.
- **`ApiPost` discarded its response**, so `Then the response status is 400`
  reported "no prior request — When step missing?" about a `When` sitting right
  above it.
- **`{adamId}`-style placeholders were never populated** (7 corpus uses).
- **A room Given looked up a TITLE as a document id.**
- **`ShowsNamedKind` resolved screens through a one-entry map**, so `suspension`
  and `warning` screen assertions answered false about screens that were on the
  device.

### Locale work (operator's 5-language requirement)

Foundation + wiring done: `ctx.locale` — previously written by five matchers and
read by NOTHING — now drives all three text matchers, resolving English -> string
key -> the locale's shipped translation. A Thai run showing English now FAILS.
All five MVP bundles verified at 841 strings each.

TWO THINGS NEED THE OPERATOR:

- **Coverage is thin.** Of 22 corpus text literals only 2 name a shipped UI
  string; the rest are data (`"6,000"`, room names, typed messages) and are
  asserted literally. Real translation coverage needs the corpus to assert
  string KEYS rather than English sentences.
- **Runtime.** App+web at 5 locales is roughly a working night per full pass,
  and the app cells are at OK=16/228. Recommend getting English green first.

## THE BIGGEST STRUCTURAL FINDING — read this first

**Android shadowed 86 of the 104 shared app methods. iOS shadows 10.**

Both drivers install the shared surface with

    for (const [name, impl] of Object.entries(sharedMethods)) {
      if (typeof driver[`android${name}`] === 'function') continue;   // <-- here
      driver[`android${name}`] = impl;
    }

so a driver-local definition WINS and nothing records that a shared
implementation was discarded. A fix to `app-ui-methods.js` therefore has roughly
a one-in-six chance of never running on Android — and it cost real time on
2026-08-02: `ShowsNamedKind` was taught to resolve screens through
SCREEN_MARKERS, went green in the shared unit tests, and still failed on the
device because android-adb-driver.js had its own copy.

Frozen in `tests/scripts/drivers/shared-method-shadowing.unit.test.js`
(shrink-only). Before fixing anything in `app-ui-methods.js`, CHECK THAT LIST —
if the method is on it, the Android copy is what actually runs.

## Operator's current directive

**Fix the APP cells first. Then WEB-only. Then the cross-overs.** Do not chase
all three at once.

This is now the launcher's DEFAULT, not something to remember: `run.sh` passes
`--phase-gate=stop`, so a run halts at the first phase with failures instead of
spending hours on web and cross cells whose app-side foundation is known broken.
Override with `RUN_JOURNEYS_PHASE_GATE=report`.

## Where the numbers actually are (app-android, first pass of 228)

| run | OK | FAIL | SKIP |
|---|---|---|---|
| 1 | 15 | 115 | 98 |
| 5 | 15 | 103 | 110 |
| 6 | 16 | 102 | 110 |
| 7 | 16 | 102 | 110 |

Be honest about this shape: **FAIL falls while SKIP rises and OK barely moves.**
Most of what has been fixed removed FALSE failures — phantom tags, a sign-in
helper vetoing legitimate gates, a matcher answering false about screens it never
looked for. Those convert failures into honest results, not into passes. A
failure converted to a SKIP looks like progress in the FAIL column while testing
exactly as little as before; the skip mechanism is what now caps OK, and it is
the next thing worth attacking.

Run 7's android was numerically identical to run 6 but its COMPOSITION changed:
the suspension-screen assertion started passing and the failure moved one step
later, to the missing `androidGetDisplayedReason`. That is progress the totals
cannot show.

## The suspended-persona chain, fixed end to end (2026-08-02/03)

Every link had to be found by following the app's own logcat rather than
reasoning about which call must be failing. Each fix revealed the next:

1. `POST /users/sign-in` was not suspension-exempt, so the middleware 403'd
   before the route could run. The route was ALREADY suspension-aware —
   `{ found: true, suspended: true }`, no claims minted — so exempting the gate
   is safe because the route is the real guard.
2. `GET /users/:id` was not exempt either (self-only carve-out added,
   value-compared, GET-only).
3. The app did not CALL either one — both platforms read Firestore directly, and
   a suspension revokes the session that authorises the read. Migrated to the
   API (EPIC-0006; direct-backend debt 34 -> 33).
4. `stripSensitiveFields` removed `cohort`/`dateOfBirth` from the SELF view, so
   the migration would have silently dropped the fields AuthViewModel routes on.
5. `classifyAndroidAuthState` did not know the suspension screen -> `unknown` ->
   "never act". Ranked above `warning`, matching SignInScreen's own order.
6. `ShowsNamedKind` resolved screens through a one-entry map — and its Android
   copy shadowed the fix (see above).
7. `GetDisplayedReason` existed on no driver, and the reason text had no tag.

Device-proven: `P-08 signIn -> true`, `state: suspended`, appeal button present,
"Account Suspended | Reason: Repeat harassment | … 2 DAY 21…".

## Live run

`20260802-134434-local`, launched 13:44. Both devices passed the driveability
health check. Status: `bash ~/.claude/skills/run-journeys/run.sh status`.
Dashboard: `node express-api/scripts/gauntlet/progress-server.js --open`.

Do NOT poll it — one snapshot per explicit ask, per the run-journeys contract.

## Sign-in is 3x faster — 79s -> 26s

This was the reason the app phase read as stalled. It was never stalled; at 79s
a scenario, 118 app-android scenarios spend 2.6 HOURS in sign-in alone.

| | wall | dumps |
|---|---|---|
| baseline | 79,295ms | 30 |
| + reset reordered, settings chain collapsed | 55,157ms | 18 |
| + gate-loop double-dumps removed | 41,566ms | 12 |
| + session drop moved AHEAD of first classify | **25,760ms** | **8** |

**A `uiautomator` dump costs a FIXED ~2,228ms and nothing makes it cheaper.**
Measured: 2,155ms compressed vs 2,167ms uncompressed; 2,171ms on the home screen
vs 2,125ms inside ShyTalk; **1,092ms even with no arguments**, printing only its
usage text. It is per-invocation process startup — an `app_process` VM plus a
fresh UiAutomation bind, every time. Do not go looking for a flag. The only
lever is issuing fewer dumps, and the only way past that is a resident agent
(an instrumented APK / Appium's UiAutomator2 server), which nobody has built.

Cheap probe if you ever need one: `dumpsys activity activities | grep
topResumedActivity` is **77ms**. Useless for auth state though — ShyTalk is
single-Activity Compose, so focus cannot tell the picker from main.

What was actually wrong, all three the same shape (information read, then
thrown away):

1. **The reset chain ran backwards.** An ~18s UI sign-out chain went first;
   a 437ms deterministic session drop was the last resort, because two comments
   in the driver claimed `run-as` was denied on the CPH2653. **It is not.** It
   lists and deletes the Firebase Auth prefs and the app comes up on the picker.
   `pm clear` genuinely is refused there; that stays last.
2. **Two boots to reach one picker.** Boot, classify, discover signed-in, drop
   the session, boot again. The drop now precedes the first classification.
3. **Every tap re-dumped a screen a wait had just dumped.** `waitForDump()` now
   returns the dump that satisfied the predicate; `tapWhenVisible` and a
   `providedDump` argument let callers act on what they already read.

(3) is also a **correctness** fix: the persona picker verified a row was inside
the list's clipping rect in one dump, then tapped coordinates parsed from a
different, later one — so the check that exists to stop taps landing on the
backdrop was made against a screen that was not the one being tapped.

Nothing was removed. `run-as` needs a debuggable build, so a release APK (j20's
prod-flavor scenarios) still reaches the picker via the UI chain, and a test
pins that path.

## Traps that cost time today — do NOT re-learn these

- **`local/start.sh` REINSTALLS the app on the phone**, built for the emulator
  host `10.0.2.2`, which a real device cannot route. Its own banner says
  `Installed on: CPH2653`. After EVERY `stop.sh && start.sh`:
  `./gradlew installLocalDebug -PlocalHost=localhost` + re-assert `adb reverse`.
  The failure is silent: logcat shows `FirebaseAuth: Logging in as …` with no
  result line, and the picker dialog just stays open.
- **A stale session presents as "Unable to Connect".** After an emulator
  restart the signed-in user no longer exists, its calls fail, and
  `AuthViewModel` reports that as connectivity (it only sets
  `isBackendUnreachable` while authenticated — so Retry cannot help). Both host
  AND device could reach every port throughout. Cure: drop the stored session.
- **`GET /emulator/v1/projects/<p>/accounts` is DELETE-only** and answers
  `{"message":"Method GET not allowed"}`. Grepping that for `email` counts 0 and
  reads exactly like an empty emulator. Real count:
  `POST /identitytoolkit.googleapis.com/v1/projects/<p>/accounts:query` with
  `Authorization: Bearer owner` — it said **793**, and 895 after seeding.
- **`androidPersonaSignIn(personaId, tab, target = 'dev')`** — the target
  defaults to **dev**. A direct call without it drives `com.shyden.shytalk.dev`
  and the reproduction is meaningless. Always pass `'local'`.
- **P-12 renders as "Adam (P-01 adult new)"** — a pre-existing seed-data
  discrepancy, NOT a sign-in bug. The UID authenticated is 90000001, which IS
  P-12's `uniqueId` in `provision-test-personas.js`; only `displayName` is
  wrong. The unmodified driver does the identical thing. P-09, P-10, P-11 and
  P-19 all resolve correctly. Worth a ticket; not a driver defect.

## Also do NOT re-do

- **`advancePastLaunchGates` must NOT tap the warning gate.** Two existing tests
  correctly refuse it, one citing a prior review finding. Acknowledging a
  warning records acceptance server-side — `androidSignOut` owns it.
- **iOS freshness probe:** testTag literals do NOT survive into the
  Kotlin/Native binary — tags that shipped months ago also read 0 under
  `strings`. Judge freshness on TYPE names (`EventHostScreen`).
- **Auth emulator project is `demo-shytalk`**, not `shytalk-local`.

## Emulator degradation is real and it lies

A full `npm test` left 14 suites failing (95 tests). All 14 passed after
`stop.sh && start.sh` — **proven by re-running, not assumed**. The tell is
duration: `journey-moderation-seed-givens` 454s, `admin-audit-log-completeness`
321s, `rotateLogs` 210s. Zero of the 14 referenced the driver.

`stop.sh` now genuinely stops (verify by process age:
`ps -eo pid,etime -ax | grep [f]irestore` — 17s old means it really restarted).

## PRODUCT DEFECT — a suspended user is told to check their internet connection

Found 2026-08-02 from the 8 remaining app-android sign-in failures, all P-08
(the persona j11 suspends), all classified `degraded`.

    SignInScreen renders SuspensionScreen when uiState.isSuspended.
    AuthViewModel.resolveProfileState learns isSuspended from
      userRepository.getUser(userId)  ->  GET /users/:id
    auth.js isSuspensionExemptPath() does NOT list that path
      ->  403 'Account suspended'
      ->  getUser returns Resource.Error
      ->  the else branch sets isBackendUnreachable = true
      ->  "Unable to Connect. Please check your internet connection."

So the only way the app can DISCOVER it is suspended is an endpoint that
suspension blocks. The user gets a misleading network error, and j11's
"Raul's Android shows the suspension screen with reason, end date, and appeal
button" cannot pass.

**The sharp part is the appeal.** `isSuspensionExemptPath` deliberately keeps
`/users/:id/appeal` and `POST /appeals` reachable while suspended — the policy
intends appeal rights to survive suspension. But the button that calls them
lives on a screen the app can never render. The policy is defeated by the
discovery path, which matters beyond UX given the OSA appeal-rights review
already open in [[project-gdpr-export-osa17-legal-review]].

Server already has a channel that works: `/portal/me` IS suspension-exempt and
answers with an explicit `isSuspended` payload. The app does not use it here.

**Fix direction (NOT yet implemented — needs care + emulator tests):** prefer a
SERVER-side self-scoped exemption so every client is fixed at once with no app
release, rather than a client change that ships three times. It must be
SELF-ONLY — a blanket exemption on `GET /users/:id` would let a suspended user
browse other profiles, which the current wholesale-path regexes would not
prevent. Verify the requested id equals the caller's own `uniqueId`, fail
closed.

## PRODUCT FINDING — `segregationEvents` stores ids as STRINGS, the rest of the schema uses numbers

Three findings a run on j02/j08 read as "the product failed to write a
cross-cohort audit row". It writes one. The assertion cannot see it:

    sameCohort.js         sourceUniqueId: String(req.auth.uniqueId)
                          targetUniqueId: String(targetUniqueId)
    corpus predicate      {sourceUniqueId: 50000040, targetUniqueId: 60000010}
    comparison            doc[k] === v          -> "50000040" !== 50000040

I started to make the predicate coerce numeric strings, and BACKED IT OUT. An
existing test seeds both types deliberately —

    { action: 'blocked', sourceId: 50000010 },
    { action: 'blocked', sourceId: '50000010' },  // wrong type — should NOT match

— and expects exactly one match. That contract is right and the coercion would
have masked the real defect: one collection holding the same logical id in a
different type from every other makes cross-collection queries a trap, and this
is an OSA audit trail.

**The fix is a product decision, not a harness one** — either normalise
`segregationEvents` to numeric ids (with a migration for existing rows) or
change the schema everywhere deliberately. Left for the operator because it has
migration implications and was found at 03:20 unsupervised.

## Known-real findings still open

1. `firestore.rules:74` does `int(uniqueId)` on a `users/<firebaseUid>` doc id
   and returns PERMISSION_DENIED. Also a direct-backend-access violation.
2. 38 findings shaped `collection "X" had 0 entries matching predicate` —
   unexamined.
3. `STEP_NOT_IMPLEMENTED` x14.
4. j20 prod-flavor scenarios need `./gradlew installProdRelease -PlocalHost=localhost`.
5. P-12 display-name / seed mismatch (above).

## Restart recipe

```bash
bash local/stop.sh && bash local/start.sh
./gradlew installLocalDebug -PlocalHost=localhost      # start.sh's build is emulator-targeted
for p in 3000 7880 9000 8080 9099 9002; do adb reverse tcp:$p tcp:$p; done
bash ~/.claude/skills/run-journeys/run.sh launch local  # seeds + health-checks + phase-gates
```

If the app is stuck signed-in or on "Unable to Connect" (`pm clear` will NOT work):

```bash
adb shell am force-stop com.shyden.shytalk.local
adb shell run-as com.shyden.shytalk.local rm -f 'shared_prefs/com.google.firebase.auth.api.Store.W0RFRkFVTFRd+MTowOmFuZHJvaWQ6MA.xml'
adb shell run-as com.shyden.shytalk.local rm -f 'shared_prefs/com.google.firebase.auth.api.crypto.W0RFRkFVTFRd+MTowOmFuZHJvaWQ6MA.xml'
```
