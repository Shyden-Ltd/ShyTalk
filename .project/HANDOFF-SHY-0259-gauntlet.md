# Handoff — SHY-0259 gauntlet, 2026-08-02

Branch: `story/SHY-0245-eradicate-test-sleeps` · nothing pushed (no-push-during-gauntlet).

## Operator's current directive

**Fix the APP cells first. Then WEB-only. Then the cross-overs.** Do not chase all
three at once.

The runner already supports this: phases are `app -> web -> cross`
(`scripts/matrix-phases.js`), and `--phase-gate stop` halts at the first phase
with failures instead of running everything. Use it.

## Where the gauntlet stands

Two full runs, both stopped by me:

| run | result | why |
|---|---|---|
| `20260802-081518-local` | PASS=0 all 4 cells, ~500 findings | my surface-gate regression + no working app reset |
| `20260802-112750-local` | 3 result lines in 30 min | sign-in cost, see below |

**The second run was never stalled — it was slow.** Measured directly:

```
androidPersonaSignIn('P-10', 'rooms', 'local')  ->  true in 79 SECONDS
```

79s x 118 scenarios on app-android is 2.6 hours of sign-in alone. That is the
number to attack next, and it is the whole reason the app phase looks dead.
Where the 79s goes has NOT been measured yet — do that before optimising.

Note `androidPersonaSignIn(personaId, tab, target = 'dev')` — the target
defaults to **dev**. A direct call without it drives `com.shyden.shytalk.dev`
and the reproduction is meaningless. Always pass `'local'`.

## Fixed this session (all committed)

- **Surface gate stopped recognising its own signal** — my regression. Matchers
  moved to the neutral `appMethod` resolver, so their failure message became
  "the app driver has no X" and `blamedDriver` no longer matched it. Steps that
  should have SKIPPED became FAILURES. This caused most of run 1's 500 findings.
  Fixed in `scenario-surface.js`; 7 regression tests, including the case that
  must NOT skip.
- **App reset had no working last resort.** `pm clear` is refused on the OnePlus
  CPH2653 (SecurityException, no CLEAR_APP_USER_DATA). Added a `run-as` drop of
  the two Firebase Auth prefs files, which works and is gentler (legal
  acceptance survives).
- **`androidSignOut` failure was swallowed by `catch {}`** — now recorded and
  reported as `sign-out: <reason>; reset: <reason>`.
- **4 silently-passing test defects -> 0** (the launcher refuses to start
  otherwise). All GUARD-IF: assertions behind an `if` pass by not running.
- **Dashboard run discovery** — four bugs; now finds `/tmp/run-journeys-<id>`
  with no arguments. Running on <http://localhost:4310>.

## Do NOT re-do these

- **`advancePastLaunchGates` must NOT tap the warning gate.** I added that
  branch; two existing tests correctly refused it, one citing a prior review
  finding. Acknowledging a warning is a stateful product action that records
  acceptance server-side — `androidSignOut` owns it. The separation is correct.
- **iOS freshness probe:** testTag literals do NOT survive into the Kotlin/Native
  binary — tags that shipped months ago also read 0 under `strings`. Judge
  freshness on TYPE names (`EventHostScreen`, `EventInviteBanner`).
- **Auth emulator project is `demo-shytalk`**, not `shytalk-local`. Querying the
  wrong one reports 0 users and sends you chasing a non-problem. It has ~895.

## Known-real findings still open (from run 1, not yet triaged)

1. A Firestore listener queries `users/<firebaseUid>`; `firestore.rules:74` does
   `int(uniqueId)` on the doc id and returns PERMISSION_DENIED on every sign-in.
   Also a direct-backend-access violation (clients must go via Express).
2. 38 findings of the shape `collection "X" had 0 entries matching predicate` —
   likely real product/seed gaps, unexamined.
3. `STEP_NOT_IMPLEMENTED` x14.
4. j20 prod-flavor scenarios need `./gradlew installProdRelease -PlocalHost=localhost`
   (all three flavours coexist; nothing needs uninstalling).

## Restart recipe

```bash
# stack (stop.sh now verifies + sweeps ports; a "restart" that reuses a wedged
# emulator is the failure this fixed)
bash local/stop.sh && bash local/start.sh

# devices — both must carry THIS branch's build
./gradlew installLocalDebug -PlocalHost=localhost
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:7880 tcp:7880 && adb reverse tcp:9000 tcp:9000
# iOS: see reference-ios-local-device-build-recipe memory (LOCAL_HOST=<mac LAN ip>)

# app phase only
bash ~/.claude/skills/run-journeys/run.sh launch local
node express-api/scripts/gauntlet/progress-server.js --open
```

If the Android app is stuck signed-in, drop the session (pm clear will NOT work):

```bash
adb shell am force-stop com.shyden.shytalk.local
adb shell run-as com.shyden.shytalk.local rm -f 'shared_prefs/com.google.firebase.auth.api.Store.W0RFRkFVTFRd+MTowOmFuZHJvaWQ6MA.xml'
adb shell run-as com.shyden.shytalk.local rm -f 'shared_prefs/com.google.firebase.auth.api.crypto.W0RFRkFVTFRd+MTowOmFuZHJvaWQ6MA.xml'
```

## Emulator health

It degrades after roughly one full `npm test` run: the rules endpoint starts
returning 500 and suites fail in bulk while passing in isolation. Check age with
`ps -eo pid,etime,rss | grep [c]loud-firestore-emulator` — if `etime` predates
your restart, it never died.
