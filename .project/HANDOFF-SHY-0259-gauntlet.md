# Handoff — SHY-0259 gauntlet, 2026-08-02

Branch: `story/SHY-0245-eradicate-test-sleeps` · nothing pushed (no-push-during-gauntlet).

## Operator's current directive

**Fix the APP cells first. Then WEB-only. Then the cross-overs.** Do not chase
all three at once.

This is now the launcher's DEFAULT, not something to remember: `run.sh` passes
`--phase-gate=stop`, so a run halts at the first phase with failures instead of
spending hours on web and cross cells whose app-side foundation is known broken.
Override with `RUN_JOURNEYS_PHASE_GATE=report`.

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
