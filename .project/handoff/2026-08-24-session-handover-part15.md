# Session handover — 2026-08-24 (part 15)

Branch `feature/SHY-0387-support-page`, **13 commits, nothing pushed**, working
tree clean. Everything below is committed.

## The one live task: SHY-0451

**The operator's words, still unanswered:** *"fix shy-0451 now before i review.
these tests should be much much faster than they are, i don't understand why
they're so slow"*

### The symptom

Roughly once per fourteen-journey iPhone run, exactly ONE journey takes
**310–415 seconds** while every other takes 20–28. A different journey each time
— J-ADMIN, J02, J06, J12, J38 have all been the victim. It usually passes.

That single stall is the difference between an ~8-minute run and a ~13-minute
one, and it makes the run time unpredictable.

Per-phase instrumentation put it inside `signOutFlow`:

```
PROBE eASI signOut-done @15680ms      typical
PROBE eASI signOut-done @312193ms     the stall
```

### The contradiction that makes it interesting

Every WebDriverAgent command is now bounded at **10s** (`COMMAND_TIMEOUT_MS`),
and one screen read is bounded at **10s** total across retries
(`DUMP_RETRY_BUDGET_MS`). `signOutFlow` is about seven commands. It therefore
**cannot** exceed roughly 70 seconds — and it reaches 312.

So either a bound is not applied where I think it is, or the time is not inside
any of our awaits.

### Ruled out, by measurement — do NOT re-test these

| Hypothesis | How it was tested | Verdict |
| --- | --- | --- |
| A hung HTTP request | Bounded every WDA command at 20s, then 10s | Stall persisted |
| Dump retry budget (8 attempts × slow attempt) | Added a wall-clock budget: 45s, then 10s | Stall persisted |
| WDA session re-creation | Instrumented `_session()`: 17 per run, 4.6–5.7s each | Not it |
| `withSessionRecovery` restarting WDA | It only clears the session id; creation is ~5s | Not it |
| Screen reads being slow | 696–1,774ms each; seven cannot make 312s | Not it |
| `snapshotMaxDepth` / tree size | 40-node screen still takes 312ms; depth 8 is fast only because it DROPS the nodes we need | Not the cost |

### THE NEXT THING TO TRY — untested, and the best lead

**The iOS screen recorder streams MJPEG from WebDriverAgent, on port 9100 —
the same WDA that serves `/source`.**

- `scripts/drivers/journey-screen-recorder.js:26` — "iOS — `ffmpeg` reading
  WebDriverAgent's MJPEG stream"
- `scripts/drivers/ios-journey-device.js` — `appium:mjpegServerPort: 9100`

If ffmpeg pulling a continuous MJPEG stream starves WDA's request loop, that
would explain BOTH the systemic 700ms reads (against Android's 65ms) AND an
occasional multi-minute wedge. Nothing has tested this.

**The experiment, which is cheap and decisive:**

```bash
cd express-api
# A: current behaviour
node scripts/device-journey-runner.js --platform ios --target local
# B: same, with no MJPEG stream competing
node scripts/device-journey-runner.js --platform ios --target local --no-record
```

Compare the summary line from each — it reports dumps, total read time and
ms-per-read:

```
Screen reads: 374 dumps, 616.4s (1648ms each, 77% of the run)
```

If `--no-record` is markedly faster or stall-free, the recorder is the cause and
the fix is to stop sharing WDA — record from a separate source, or pause the
stream around commands.

**If that is not it**, the remaining definitive experiment is per-COMMAND
timestamps: log every `_get`/`_post` with start and end wall-clock, run until it
stalls, and look for the gap. If no single command is slow, the time is between
commands (event loop, phone, or Appium queueing) — and note
`appium:newCommandTimeout` is **300 seconds**, suspiciously close to the
observed 310–415.

## What is already fixed (committed, do not redo)

Journeys went **78–92s → 20–28s** each, and the iPhone matrix 0/13 → 14/14.

- **`terminate_app` leaves WDA on the springboard.** The session survives the
  terminate, still attached to a dead process, so every `/source` returned the
  iOS home screen — a far bigger tree (~1,320ms a read vs ~480ms in the app) —
  while the journey waited for a SignIn that was on the phone. `launch()` now
  uses `activate_app` so WDA re-attaches; all three call sites await it.
- **J-SMOKE waited 75s for a screen it had gone past** — Android reinstalls so
  it starts signed out, iOS does not. Uses `ensureAtSignIn` now.
- **WDA idle waits off** (`waitForIdleTimeout`, `animationCoolOffTimeout`) —
  and these MUST go through the settings endpoint. As capabilities they are
  accepted, ignored, and read back `undefined`.
- **Every tap cost two reads.** `treeIsFresh` was gated to Android on a figure
  measured on the near-empty SignIn screen. Now both platforms; the 400ms window
  is what makes it safe.
- **Persona pick slept a flat 2.5s** — polls now.
- **Persona row must be STILL before tapping** (two reads agreeing within 4px)
  and `tapElement` looks twice — both fix `404 element could not be located` for
  a control we had just seen.
- **Sign-out had 12s**, which produced a perfectly alternating matrix once
  sign-ins started working. 45s now, and `ensureAtSignIn` falls through to its
  restart instead of propagating.
- **`dumpWithRetry` grew a time budget** — its attempt count was sized for
  Android, where a failed dump exits immediately.

### Tried and REVERTED — recorded in the code, do not repeat

Shortening the optimistic `settle` in `ensureAtSignIn` from 20s to 8s. It gives
up on a screen that was about to arrive and falls through to a force-stop and
relaunch, which costs far more: two journeys went 37s → 301s and 96s → 367s on
that change alone.

## Everything else in this session

**All twelve support tickets are built and committed** — SHY-0422, 0431, 0433,
0437, 0438, 0439 and the SHY-0420 remainder, plus SHY-0424/0426/0430/0436/0442
from earlier.

**Eight defects found that nothing was catching**, notably:
- A user report WITH a screenshot filed **nothing at all** — the client uploads
  to `path="report_evidence"`, which was not in the storage allowlist, and it
  returns before calling `reportUser`. Fixed; the remaining decision is
  **SHY-0450**.
- The retention sweep would have **deleted live evidence** — `attachmentKeysOf`
  read a shape the product never writes, so the keys-in-use set came back empty.
- **SHY-0449** — no moderator has ever seen a support attachment (`<img src>`
  cannot send a bearer token).
- **SHY-0448** — `public/**` JavaScript is never linted.

**Express suite: 33 min with 3 failures → 9m 21s, 498 suites, 15,493 tests,
exit 0.** One test was running the story sync over the live corpus: 1,206s → 5.5s.

**Android: 14/14, exit 0, 356s.**

## Published evidence

- Report — https://claude.ai/code/artifact/113dcd48-0c4c-4177-bab2-8e8e805d9945
- OnePlus walk — https://claude.ai/code/artifact/41fe73b4-47cd-4b89-af24-e4816e6d15b4
- iPhone walk — https://claude.ai/code/artifact/bd9bc3af-bfde-4132-878f-2b7fcdba509b

Republishing from a new session needs the URL passed as `url`, or it creates a
separate artifact. Screenshots are embedded at native resolution with Save
buttons (the `downloads` capability — `<a download>` is inert in that sandbox).

## Waiting on the operator

1. **SHY-0450** — should a failed screenshot lose the whole report?
   Recommendation: file it anyway and say which pictures did not attach.
2. **The attachment scanning engine** — recommendation on record is self-hosted
   ClamAV, because the files include images of real people.
3. **Nothing is pushed.** Thirteen commits.

## Running the devices

```bash
# The iPhone's CoreDevice tunnel goes dormant; wake it or the runner says
# "No connected iPhone found" (the runner now wakes it itself, but a manual
# nudge is still the quickest way to check the phone is there):
xcrun devicectl device info details --device 74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6

# Clear leftover suspensions/tickets before any matrix, or J07 fails on a
# persona a previous run suspended:
bash scripts/dev/reset-local-journey-debris.sh --apply

# Android MUST be built with the host flag or it bakes 10.0.2.2 (emulator only):
./gradlew :app:assembleLocalDebug -PlocalHost=localhost
```
