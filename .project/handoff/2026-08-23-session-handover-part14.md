# Handover — 2026-08-23, part 14

Continues part 13. **Nothing has been pushed.** 25 unpushed commits on
`feature/SHY-0387-support-page`.

Part 13 ended with both phones passing J38 and the evidence page published.
Everything since came from the operator reviewing that evidence and finding it
wanting — correctly, three times over.

---

## What the operator caught

### 1. A screenshot that did not show its claim

> "The limits are stated before anybody picks ← the screenshot for this showed
> you checked for updates. nothing to do with support. invalid test case"

`at01-limits-stated.png` was the **About screen with an "Up to Date" dialog**,
captured a minute earlier while navigating TO support. The screenshot that
actually shows the limits (`at02`) existed and was not used at all.

Audited the rest by hand. `at02`, `at04`, `at05`, `at06` are genuine. `at08`
exposed a **systemic** flaw: its claim is *"ticket X carries keys A and B"* — a
Firestore fact a phone screenshot cannot evidence. The page conflates **visual**
claims, where the screenshot IS the proof, with **state** claims, where it merely
sits alongside.

Also queried: how a step showing "Unable to Connect" could be a pass. Fair —
step 1 seeds a ticket through the API and never touches the phone, so the
assertion held, but a device screenshot was attached to it anyway. **The error
screen it caught was real**, and became SHY-0442.

### 2. Attachments could be removed but never deleted — SHY-0434

> "there is no test to prove that the user can remove an uploaded attachment and
> to prove that the file is deleted from the server once removed (we must not
> keep files we don't need - GDPR risk)"

There was no test because **nothing deleted anything.** Bytes upload the moment a
file is *picked*; `removeAttachment` only filtered the local list; and there was
**no DELETE route on the API at all**. Once the form dropped the key nothing
referenced that object — no ticket carried it, so no retention rule and no
erasure request could reach it. Permanent and unreachable.

A comment documented it as deliberate: *"the object stays in R2 unreferenced…
unreferenced objects are the storage lifecycle's problem."* No lifecycle ever
collected them.

Fixed: `DELETE /api/support-tickets/attachments`, reusing the existing prefix and
traversal checks. The form lets go first and deletes in the background.

The operator also asked for a functional count test: three attached, remove one,
two left — and the freed slot genuinely reusable at the ten-file limit. Both now
exist; the old test asserted only the surviving *set*.

### 3. Coordinate taps

> "you're still using clicks based on coordinates of where you expect an element
> to be… leading you to click the wrong things, see a result and assume it's
> passed."

Every tap DID resolve by id — from a dump taken **earlier**, then tapped
`node.center`. `advanceUntil`, which every walk goes through, dumped once, ran
four handlers that each rearrange the screen, then tapped a coordinate from a
screen that no longer existed.

---

## Where the taps ended up

Four rounds, each one finding the previous incomplete.

1. **Element clicks for iOS.** `POST /element` → `/element/{id}/click`. Proven on
   device from the Appium HTTP log: coordinate `/actions` **23 → 4 (−83%)**, all
   13 lookups by `accessibility id`. Cost ~1.6s across the walk.
2. **`tapResolved` for adb**, which has no element click: re-resolve immediately
   before tapping, and THROW if the target has gone.
3. **A P0 I introduced.** `tapLowestText` picks the LOWEST node with a text —
   in a dialog, the button under the identically-worded title. `tapResolved`
   re-resolved with `byText` (first match) and handed back the **title**.
   Sign-out hung; every journey after the first would have failed. Callers now
   pass the rule they used.
4. **Reachability — SHY-0441.** Findable is not reachable.

---

## SHY-0441, the one that matters most

At t≈67s of the iOS recording **the Send button is completely hidden behind the
keyboard**, and the walk taps it and moves on. An occluded button is still in the
tree, with an id, sane bounds and `enabled=true`.

**SHY-0419 was exactly that defect.** Three readings to fix, shipped twice. The
journey written to prove it stays fixed **could not detect it**. SHY-0428 is the
same class from the other side.

`occluderOf` — document order is paint order, so only a node drawn LATER can be
on top; it occludes when its box holds the target's tappable **centre**; a node
wholly inside the target is its own child and ignored. `visible` is now read,
having been parsed since the driver was written with a comment naming SHY-0419
and **zero uses**.

The element-click shortcuts had to go: they skipped the dump, and therefore the
check, on iOS — the platform the defect came from.

**Risk being verified right now:** this gates EVERY tap. Both agents are running
J38 specifically to find out whether it reddens healthy walks.

---

## Three times I tested one side of a seam

Worth stating plainly, because it is the through-line of this stretch.

1. Six source-scanning locator guards passed while the code tapped the wrong
   element — they check the SHAPE of the code.
2. The `forceStop` guard pinned the one method I was shown; `screencap`, `tap`
   and `swipe` had the identical bug — 13 sites, one of which was already
   destroying evidence (every iOS run lost its last screenshot while the report
   linked it).
3. The reachability suite: twelve tests of `occluderOf` and `assertReachable`,
   **zero callers driven**. Deleting the call left all twelve green.

Mutation caught 2 and 3. Both suites now enter through the real caller.

---

## Tickets

| Ticket | Pri | Status | What |
| --- | --- | --- | --- |
| SHY-0433 | P2 | Draft | Attachments show a filename, not what you attached. Thumbnails, tap to view. |
| SHY-0434 | P1 | In Review | A removed attachment was never deleted. **Fixed.** |
| SHY-0435 | P1 | Draft | Abandoned uploads orphaned identically — the likelier path. Not fixed. |
| SHY-0436 | P1 | Draft | Closed tickets deleted after 7 days, with attachments. **Needs an operator decision.** |
| SHY-0437 | P1 | Draft | Teach people to report before offering a ticket. |
| SHY-0438 | P1 | Draft | An admin turns a ticket into a report. |
| SHY-0439 | P1 | Draft | A converted ticket closes for good. |
| SHY-0440 | P2 | Draft | **A room cannot be reported.** Needs a decision. |
| SHY-0441 | P1 | In Review | The walk taps buttons it cannot see. **Fixed, being device-verified.** |
| SHY-0442 | P1 | Draft | "Unable to Connect" on cold start. Cause confirmed, deliberately not built. |

### Two decisions waiting on Shyden

**SHY-0440 — there is no way to report a room.** `reportRoom`, `report_room`,
`reportedRoom`, `roomReport`: zero matches across app, API and admin. The
operator's closing copy for SHY-0439 says "report the user, message or room
directly", so a third of it names something that does not exist. Either build it
or drop the word. The case I would weigh most is age segregation: a room a minor
should never have entered is a safeguarding matter about the ROOM, and nobody can
currently raise it as one.

**SHY-0436 — seven-day deletion vs safety history.** Narrowed by SHY-0438: once a
safety matter becomes a report, the report carries the moderation record, so
deleting the ticket loses nothing. Remaining question is tickets raised before
SHY-0437 ships.

---

## SHY-0442 — ready to build, deliberately not built

`AuthViewModel.handleBackendError` routes auth-shaped failures to sign-in and
sends **everything else** to `isBackendUnreachable`, which renders the
full-screen error. **No retry before it** — `retryConnection()` exists only
behind the button a person must press. So one transient failure on the very
first call (identity resolution, line 366) produces a full-screen "check your
internet" on a stack that is up and answering, and a relaunch fixes it.

There is no `AuthViewModelTest` at all.

Not implemented because both phones were mid-run, and shipping an unverified
change to sign-in would repeat this session's central mistake: a recorder, a
scrcpy flag set and a locator fix all shipped on green unit tests and failed the
moment they met hardware.

---

## Round two: both phones green, and what it took

Written after the device runs part 14 was waiting on.

### Result

| Device | Result | Reachability failures |
| --- | --- | --- |
| OnePlus CPH2653 | **PASS 14/14**, 243.0s | **zero** |
| iPhone Air | **PASS 14/14**, 91.2s | **zero** |

### The reachability gate was wrong, on both phones, on the first screen

Three tree shapes defeated one geometric rule:

1. **Compose semantics sibling** (Android) — `Role.Button` beside the label,
   `clickable="false"`, **larger** than it. The only exemption was "wholly
   INSIDE the target"; Compose emits the inverse.
2. **A child overhanging its parent by ONE point** (iOS) — `main_profileTab`
   `[285,798][420,878]` vs caption `[328,830][377,879]`; containment needs
   `879 <= 878`. **Every bottom-nav tab became untappable.**
3. **A full-screen transparent layer** (iOS) — empty, unnamed,
   `accessible="false"`, and `visible="true"`.

Thirteen controls flagged on one settled iOS Home screen; none absorbed a touch.

Narrowed to a specific question — **is a SYSTEM OVERLAY on top of it?** (class or
id containing keyboard / inputmethod / navigationbar / statusbar / systemui).
Accepted cost, in the code: a product modal covering a control is not caught. A
check that reddens healthy walks gets disabled and then catches nothing.

Rejected routes and why: "ignore non-clickable" would disable SHY-0428 and
SHY-0419 detection, because the navigation bar and soft-input window are both
non-clickable in a dump. "Ignore a candidate that contains the target" would
break SHY-0419, because the keyboard fully contains Send.

### `visible` does not mean visible

Removed. On a plain Home screen the captions `Rooms`, `Messages`, `Profile` all
report `visible="false"` while rendered. The Appium log gives the mechanism:
WDA is **erroring**, not reporting — `Cannot determine visiblity … 
kAXErrorInvalidUIElement … Defaulting to: 0`. It names real controls
(`main_settingsButton`, `settings_subPageBackButton`). Trusting it would have
reddened walks at random.

### A claim I made that was wrong

I cited a 184.2s run passing 14/14 as reassurance for the `tapLowestText` fix.
Its step 2 took **2.2s** — the app was already at SignIn, so the confirm dialog
never appeared and the fix's path was never entered. That run was never evidence
either way. The real proof is the 243.0s run: dialog on screen at t≈71s, SignIn
reached at t≈78s, impossible if re-resolution had returned the identically-worded
title. Recorded as
[[feedback-a-green-run-only-proves-the-paths-it-walked]].

### Sessions and recordings

- **Nothing ever closed the Appium session.** `IosDevice.quit()` existed, called
  from nowhere. Now in the `finally`, best-effort.
- **And a replaced session was orphaned.** WDA dies with the app, the dump-retry
  opens a REPLACEMENT, and `quit()` closed only `_sessionId` — 14 created, 13
  removed. Now closes every id ever opened.
- **The recording covered 21s of a 91s walk**, ending where the app relaunched.
  ffmpeg held the dead MJPEG socket and never reconnected, so steps 3–14 had no
  footage. Fixed with bounded `-reconnect` / `-reconnect_on_network_error`.
  **Any iOS walk that restarted the app had been losing its video since the
  recorder was built.**

### Not settled

**The Send-behind-keyboard moment (~step 8) has never been watched with the gate
live.** The gate did not fire, which is real positive evidence — `typeText`
clicks the field before setting its value so the keyboard was up,
`tapIdScrolling` taps as soon as the id is findable, and `XCUIElementTypeKeyboard`
matches the overlay hints — but that is inference, not a frame. The recording
defect is what denied one. With reconnect in place the next iOS run should cover
the whole walk.

---

## THE ISSUES TO FIX NEXT

Operator, 2026-08-23: *"fix the issues, then run the tests again"*. In priority
order, all found by the device runs and none yet fixed:

1. **SHY-0430 — the debug overlay covers product copy.** On iOS it obscures most
   of the "goes to the back of the queue" paragraph — **the exact sentence step
   10 asserts**. A human reading that screen could not check it.
2. **SHY-0432 — test data grows unbounded.** The iOS persona reached 5–8 open
   requests including duplicates from earlier runs, against a display cap of
   `MAX_OPEN_TICKETS_LISTED = 5`. Nothing asserts a count, so it passes while
   progressively hiding the screen under test.
3. **SHY-0442 — "Unable to Connect" on cold start.** Cause confirmed:
   `handleBackendError` sends every non-auth failure to `isBackendUnreachable`
   with no retry. Needs an `AuthViewModelTest` harness, which does not exist.
4. **The white cold-start splash flash** on a dark-themed app.
5. **`api unknown` beside a GREEN health dot** in the debug overlay — the label
   and the indicator contradict each other on a demonstrably healthy run.
6. **Gift Wall artwork renders as broken-image fallbacks** (Android); a
   **"600 × 200" placeholder banner** dominates Rooms. Neither triaged — may be
   local seed data rather than product.

Then re-run both device journeys and the full suites.

## Where to pick up

1. **Read the two device reports.** The question is whether the reachability
   check is quiet on healthy walks. A failure is either a real find or a false
   positive; the agents were told to diagnose which, not to retry past it.
2. If it is quiet: **SHY-0442's fix** — bounded retry inside
   `handleBackendError`, with the `AuthViewModelTest` harness it needs — then
   device-verify.
3. **Regenerate the evidence page** and re-audit every hand-paired row before
   asking for sign-off again. Distinguish visual claims from state claims.
4. Operator sign-off remains the merge gate. Then push, merge `main`→`develop`,
   `develop`→branch, merge, deploy dev.

### Known, not chased

- The OnePlus delivers live third-party notifications (TikTok, Facebook) during
  runs — a real instance of "the screen moved between dump and tap". The Android
  agent was asked to enable Do Not Disturb.
- Test data accumulates: the iOS persona reached **8 open tickets** against a
  display cap of 5. That is SHY-0432.
- Gift Wall artwork renders as broken-image fallbacks on Android; a "600 × 200"
  placeholder banner dominates the Rooms screen. Neither triaged.

---

# PART 15 — the six issues, fixed, and what the device runs then found

Operator, 2026-08-23: *"fix the issues, then run the tests again."*

## The six, in the order they were given

| # | Issue | State |
| --- | --- | --- |
| 1 | SHY-0430 — the debug overlay covers the copy step 10 asserts | **Fixed**, device-proven |
| 2 | SHY-0432 — test data grows unbounded | **Fixed** (three attempts; see below) |
| 3 | SHY-0442 — "Unable to Connect" on cold start | **Fixed**, copy in 21 locales |
| 4 | The white cold-start splash flash | **Fixed** — SHY-0443 |
| 5 | `api unknown` beside a GREEN health dot | **Fixed**, both surfaces |
| 6 | Gift Wall broken images; "600 × 200" banner | **Triaged** — SHY-0444 filed, not fixed |

## What each turned out to be

**1 — the overlay.** Eight lines deep, covering the "goes to the back of the
queue" paragraph. Now COMPACT: title, status, build identity, account. The
badge turned out to be a **test interface** — `signInAs` and J38's identity
step both parse `UID: <digits>` out of it — so compacting it without reading
its consumers would have reddened ten journeys on hardware. Caught before the
run, not by it. `signInAs` now asserts the ACCOUNT ID instead of a display-name
prefix, from `provision-test-personas.js` so there is no second table.

**5 — `api unknown`.** Never a contradiction. Express answers `sha:"unknown"`
when it has no `DEPLOYED_SHA` and no `.deployed-sha` file, which is every local
stack. That word is **exactly seven characters**, the same budget a short sha
gets, so it survived truncation and rendered where a build id belongs. The dot
was always right. Two tests had PINNED it — a Kotlin one calling it "the honest
local answer", and a web regex spelling out `/api (unknown|…)/` as acceptable.
Both inverted. The web mirror had the identical defect, where a truthy sentinel
beat a falsy check.

**3 — Unable to Connect.** `handleBackendError` sent every non-auth failure
straight to `isBackendUnreachable` with nothing between. Now two retries with a
short backoff, wrapping the CALL rather than the handler (by the time the
handler runs there is nothing left to retry), and all three cold-start callers
go through it. The ticket's claim that no `AuthViewModelTest` existed was
**wrong twice**: an 867-line mockk harness in `app/src/test` and a 1,581-line
`AuthViewModelIdentityTest` in `commonTest` already pinning this state. One
source set was looked in. Corrected in the ticket.

**4 — the splash.** `Theme.AppCompat.Light.NoActionBar`, whose windowBackground
is white, under an app that follows the system theme. The dark value is
**measured** — sampled from a device screenshot at four empty points, all
`#141218`.

**6 — the images.** The "600 × 200" banner was transient local data. The Gift
Wall is **not**: `GiftWallScreen` degrades beautifully when `iconUrl` is BLANK
(a tinted circle with the gift's initials) and not at all when the load FAILS,
because the `AsyncImage` call passes no `error` slot. It is **66 call sites in
`commonMain`, none of which passes `error`, `fallback` or `placeholder`**. Filed
as SHY-0444 rather than fixed beside five unrelated changes.

## SHY-0432 took three attempts, and only the real database showed why

1. **Admin list, one pass.** `GET /api/support-tickets?status=open` returns the
   200 NEWEST across everybody. The emulator holds **320 open, 117 of them one
   dead test account** — so Alice's older leftovers sat outside the window. It
   resolved 1 of 8 and stopped.
2. **Admin list, looped.** Resolving a ticket advances a 200-wide window by
   one. Looping cannot fix an endpoint that cannot ask the question.
3. **Firestore for the list, admin API for the write.** Complete, per-user, and
   it keeps the rule that matters: every MUTATION goes through the
   authorization layer, while a test reads ground truth directly — which this
   runner already does for every assertion.

`mine/open` looked like the answer (per-user, so ownership is structural) and
is the wrong endpoint: capped at five with no ordering, so Firestore returns
the same five ids for ever and five hand-raised tickets at the front stall it
permanently.

**The count assertion was also wrong.** It failed on Alice's five hand-raised
tickets, which the journey may not close and must tolerate. Replaced with the
honest claim: *the ticket THIS run seeded is among the ones the app will show*.
Its failure names the foreign tickets.

## What the device runs then found

**SHY-0445 — a still screen read as a broken recorder.** The Android walk
aborted with "no growing video". Android's encoder emits frames only when the
display CHANGES: on a settled screen the mp4 sat at **48 bytes for ten
seconds**. The gate now proves the CONTAINER opened, and the frames claim moved
to `assertPlayable` (ffprobe: a video stream and a positive duration) at stop,
which also catches the truncated-`moov` file a SIGKILL leaves. **This exact
mechanism was diagnosed for iOS earlier in the session and the comment said, in
writing, "scrcpy has no equivalent channel, so it keeps `waitForGrowth`".**

**Environment debris was failing two journeys for the wrong reason.** Lena
carried a suspension from a hand-driven session days ago (J07 → 403 "Account
suspended"). Alice carried TEN open tickets from this branch's own device
testing. Cleared by `scripts/dev/reset-local-journey-debris.sh`, which lives
OUTSIDE the journeys on purpose — a harness that deletes data it did not create
can hide a real defect.

## Where the tests stand

| Suite | Result |
| --- | --- |
| shared jvmTest | **1,677** green |
| app unit (local flavour) | **2,278** green |
| Express (`npm test`) | **15,246** green, 482 suites |
| Playwright web watermark | **39** green, headed |
| **Android device, full set** | **13 / 13**, recorded 1019.2s / 70.8MB |
| **iPhone device, full set** | **5 / 13**, recorded 713.5s / 20.8MB |

Mutation-proven this session: 2 (badge/sentinel), 7 (run isolation), 4 (cold
start), 2 (splash), 1 (web sentinel).

## SHY-0446 — and the honest headline

**The full thirteen-journey set had never been run on the iPhone.** Every
previous iOS run under `journey-results-ios/runs` holds exactly one journey.
Run three times today, it gives the same answer each time: **Android 13/13,
iPhone 5/13**.

They are revealed, not caused — J38, the journey this session's work is about,
passes on both. But it means that for as long as this has existed, *"the
journeys pass"* has meant **Android**, and a defect reaching only iPhone users
had eight journeys' worth of places to hide.

Two shapes: `device.uninstall is not a function` (a driver method the iOS
backend does not have), and six failures where the dump shows the **iOS home
screen** — the app is not running. The near-alternating pass/fail sequence
points at state carried between journeys rather than at any one journey.

## Open

- **SHY-0446** is the biggest thing on the board now.
- **SHY-0444** — 66 `AsyncImage` sites with no failure state.
- **SHY-0442's own bar** — twenty cold starts per device — needs the devices.
- **SHY-INDEX.md is 91 stories behind**, back to SHY-0226.
  `scripts/reconcile-story-index.sh` reports and, with `--apply`, inserts.
  Deliberately NOT applied: that is a large change to an operator-curated
  table. The public roadmap is unaffected — its sync reads the story directory.
- Two operator decisions still outstanding: SHY-0440 (room reporting) and
  SHY-0436 (seven-day deletion vs safety history).
- **Nothing pushed.** 86 commits on `feature/SHY-0387-support-page`.

---

# PART 16 — support-work evidence, and SHY-0446 half-done

## Evidence page (operator asked for it, 2026-08-23)

**https://claude.ai/code/artifact/ca600866-0571-422e-a07b-db6a7f649013**

Built from the 08:30 run. Every screenshot on it was OPENED and read before the
claim under it was written — the previous evidence page paired claims to
filenames without looking and got one wrong, which is why it was rejected.

Both walks PLAY ON THE PAGE (operator asked, 2026-08-23): Android 225s, iPhone
125s, cut to J38 from the full runs. Inlined as data URIs, not linked — the
`assets` capability is not available to this account (only `artifact`,
`downloads`, `mcp`, `self`), so an artifact asset store was not an option.

Re-encoded to fit: 720px wide (half the 1440 source, so the support copy stays
readable), CRF 20, 20fps, audio dropped. 3.6MB + 3.2MB, so ~9.2MB of base64
against a 16MB page budget; the page is 9.7MB. The originals are untouched on
disk. Both encodes were verified with `assertPlayable` before embedding — the
same check the recorder now uses at stop.

### What it says

- **Built and device-proven, 8 stories**: SHY-0387, 0396, 0419, 0427, 0428,
  0430, 0432, 0434. J38 is **14/14 on BOTH phones** (Android 209.1s, iPhone
  108.3s).
- **Not built, 12 stories** — including all three the operator asked for on
  22 August: SHY-0433 (thumbnails), SHY-0436 (seven-day deletion), SHY-0437/
  0438/0439 (report-first flow + admin conversion). "Safety & another user" is
  still an ordinary category on the form in both screenshots, which is
  SHY-0437 not being built, visible in the evidence.
- **561 support unit tests** green (474 Express + 87 shared).
- Three things I would NOT sign off on the operator's behalf: the iPhone build
  stamps no git identity (its badge reads `? · 08-23 07:25` where Android
  reads `2ad6081`, so the iOS frames cannot prove WHICH commit made them);
  attachments are proven at API/unit level but not walked on a device in this
  run; and "support is done" would be false with twelve stories Draft.

## SHY-0446 — part fixed, iPhone still 5/13

**Fixed and committed:**

1. **J-SMOKE's `device.uninstall is not a function`.** Both backends now have
   `install`/`uninstall`; iOS REFUSES with the reason (the app is built with
   this Mac's LAN address baked in by `ios-local-install.sh`, so the runner
   must not replace it). An unguarded call is now a sentence, not a TypeError.
   J-SMOKE's step is named for what it actually does per platform. It now runs
   81.7s instead of dying at 0.7s.
2. **WDA session recovery on every command.** Instrumenting a run gave the real
   error behind "SignIn not reached": `POST /element/.../click -> 500: Could
   not proxy command to the remote server. Original error: socket hang up`.
   WDA had died; the dump at that instant shows the app happily on Home.
   `dumpXml` already recovered from this and nothing else did — and the dead
   session id stayed on the object, so every LATER command failed too. Now
   wrapped as a CLASS, with the command list derived from the prototype so a
   new one fails until it is wrapped or exempted with a reason.
3. **A parity guard** derives every `device.X(` call from the runner source and
   requires both backends to have it, or an allowlist entry naming the guard.

**What did NOT change: the iPhone is still 5/13.**

Six journeys still fail at "Reach SignIn within 12000ms". That timeout belongs
to `signOutFlow`'s final `reachSignIn`, so the app is being lost DURING
sign-out, and the click hang-up fixed above was a different moment (it was in
"Land on Home"). The session recovery was necessary and is proven by mutation,
but it was not sufficient.

**Ruled OUT by measurement, so nobody repeats it:**

- `forceStop` racing `launch`. The code's own comment blames this and cites an
  A/B. Re-run today, 6/6 land in ShyTalk whether the gap is 0ms or 2000ms.
  `app_state` reports `1` (not running) the instant `forceStop` returns; the
  ~350-400ms I first measured was devicectl's process list lagging, not a
  pending kill.

**Where to pick up:** instrument `signOutFlow` the way the J-ALICE run was
instrumented — run J-ALICE twice in a row on iOS (the first leaves the app
signed in, the second must sign out) and capture what is on screen after each
of the four taps. The first run FAILS and the second PASSES, reliably, which is
the alternating signature.

---

# PART 17 — SHY-0447: the journeys were 87% screen-reading

Operator: *"almost 4 minutes in 1 journey? a real test framework wouldn't take
this long. fix it."*

## What it actually was

Measured, not guessed. The runner now counts its own reads:

```
Screen reads: 96 dumps, 244.2s (2544ms each, 87% of the run)
```

**Not the sleeps.** `adb exec-out uiautomator dump` spawns a fresh
instrumentation per call: the `cat` is ~80ms, the dump is ~2.2s. `/dev/tty` and
`--compressed` make no difference, and it costs the same on the **Android
launcher** — so it is the tool, not the app, and not the debug badge's repaint.
iOS was never slow this way: WebDriverAgent is a server that stays up, 278ms.

## The fix

Android reads over a **warm UiAutomator2 session**: **2332ms → 65ms**. Only the
READ moves; taps and swipes stay on adb. Session stood up once, closed
deliberately. Missing driver ⇒ falls back and says so loudly.

Its `/source` puts the class in the **tag name**; everything else is identical
(proven on the phone — both readers gave the **same eight ids** on the same
screen, Compose testTags included). Renamed at the seam so `parseNodes` never
learns there are two formats.

Plus two Android-only wins: reuse a tree taken microseconds ago instead of
re-reading, and make the poll interval a **floor** rather than an addition.
Both gated to Android — iOS was already at 278ms, so they bought it nothing and
cost correctness when applied there.

## RESULT

| | Before | After |
| --- | --- | --- |
| J38 step time | 269.6s | **47.4s** |
| Full Android set | ~1020s | **271s**, recorded |
| Reads as a share of the run | 87% | 35% |
| Android journeys | 13/13 | **13/13** |

## Four latent defects the speed EXPOSED

All pre-existing, all padded by the slowness. Each fixed at the cause:

1. **The persona-picker wait never waited** — it waited for the text "Sign in
   as test persona", which is the label of the BUTTON that opens the picker.
   Now waits for `persona_picker_list` and retries a swallowed tap.
2. **The ticket assertion raced the server** — queried Firestore the instant it
   tapped, reporting "the request never arrived" for a ticket that arrived a
   moment later. Bounded wait.
3. **The cold-start wait stared at an empty screen** — after a force-stop the
   dump returns to `android:id/content` alone. It settles again.
4. **A self-dismissing overlay failed the walk** — SHY-0441 refuses to tap a
   vanished control, which is right for a target and inverted for an obstacle.

## Prerequisites for the next machine

- `appium driver install uiautomator2`
- **The Appium server must be started with `ANDROID_HOME` set** or the Android
  driver refuses every session with "Neither ANDROID_HOME nor ANDROID_SDK_ROOT
  was exported". Started here as:
  `ANDROID_HOME=~/Library/Android/sdk appium server -p 4723`
- Two uiautomator clients cannot share the accessibility connection: while the
  UiAutomator2 server holds it, `adb exec-out uiautomator dump` returns ZERO
  nodes. That cost an hour of a false conclusion — do not compare the two
  readers simultaneously.

## iPhone: still SHY-0446, and NOT caused by this work

Checked properly rather than assumed: checked out the pre-performance commit
and ran J38 on iOS from it — **it fails there too**, same persona-row symptom.

The instrumented run shows the picker DOES open on the first tap
(`persona_picker_list`, `persona_row_P-02`, "Alice (P-02 adult power)" all in
the dump). What fails is the tap on the persona **row** afterwards, which
bounces back to SignIn. That is where SHY-0446 should pick up.

Also ruled out by measurement earlier, so nobody repeats it: the
`forceStop`/`launch` race the driver's own comment blames does not reproduce —
6/6 land in the app whether the gap is 0ms or 2000ms.
