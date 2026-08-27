# Handover — 2026-08-22, part 13

Continues part 12. The operator's instruction that opened this stretch:

> "don't push yet i haven't verified the tests because you failed to provide
> recordings. so do the testing again with recordings this time. on both
> devices, in parallel. like the rules state"

**Nothing has been pushed.** There are unpushed commits on
`feature/SHY-0387-support-page`.

---

## What the recordings were for, and what they found

Recording the walks was not a reporting nicety. The first recorded Android walk
found a **P1 defect that every assertion had passed**, and the recorded iOS walk
found three test-infrastructure defects that had been silently degrading every
iOS run.

### Device results

| Device | Journey | Result | Video |
| --- | --- | --- | --- |
| OnePlus CPH2653 | J38 | **PASS 14/14** | 215.3s · 1440×3168 · h264 · 3294 frames · 21.0 MB |
| iPhone Air | J38 | **PASS 14/14** | 86.8s · 1260×2736 · h264 · 1302 frames · 5.5 MB |

The Android run **failed 12/14 first**, on the defect below, and passes only
after the fix.

---

## Screen recording, which did not exist before today

`express-api/scripts/drivers/journey-screen-recorder.js`. The runner records by
DEFAULT; `--no-record` opts out.

- **Android** — `scrcpy`, encoding on the Mac over the adb socket, mirroring the
  screen live. The OnePlus refuses on-device `screenrecord` on every path
  reachable from `adb shell`.
- **iOS** — `ffmpeg` against WebDriverAgent's MJPEG stream on `:9100`.
  `avfoundation` cannot see a USB iPhone (a CMIO flag ffmpeg never sets), and
  Appium's own recorder 500s on this setup.

Both stop on **SIGINT and wait**: an mp4's `moov` atom is written last, so a
SIGKILLed recorder leaves a file with bytes, a plausible size and no index —
unplayable, and indistinguishable from a good one by `existsSync`.

`brew install scrcpy ffmpeg` is now a prerequisite. `resolveBinary` fails with
the install command rather than a bare ENOENT.

---

## The product defect the video caught — SHY-0428

**Pressing Send went to the home screen.**

`SupportPage` pinned Send in the Scaffold's `bottomBar` and lifted it with
`imePadding()`. That accounts for the keyboard and nothing else. With the
keyboard **closed** the IME inset is 0, the bar sat flush to the window bottom,
and Android drew back/home/recents **over the lower half of the button**. Send's
tappable centre coincided with HOME.

Step 8 (first Send, keyboard up) passed. Step 12 (Send after "Go back", which
dismisses the keyboard) failed. Same button, opposite outcome — the shape that
reads as flakiness.

Nothing an assertion could reach was wrong: the button existed, carried its tag,
reported sane bounds, answered "visible". Only the pixels showed it.

**Fix** (`725aad6ff6e`):
```kotlin
Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
```
`union` takes the larger inset per side, so the count stays at ONE — the whole
lesson of SHY-0419's three readings. A second padding call would float Send a
navigation bar's height above the keyboard.

**Swept:** `MainScreen` is the only other screen with a `bottomBar` and is
unaffected — its bar is a Material3 `NavigationBar`, which consumes system-bar
insets itself. A hand-rolled `Surface` does not. That is why exactly one screen
was wrong.

Proven on device: before/after crops of screenshot 11 from both runs (identical
state, identical framing) at
`journey-results-android/runs/local-2026-08-22T14-12-44-375Z/EVIDENCE-send-button-clear-of-navbar.png`.

---

## Test-infrastructure defects found and fixed

Every one of these was invisible to a green test suite.

1. **`IosDevice` could never open a session.** An iPhone answers to two
   look-alike identifiers — the CoreDevice UUID for `devicectl` and the
   ECID-based hardware UDID for `appium:udid`. One value was spent on both, so
   Appium refused every session before a step ran. `ios-appium-driver.js`
   documents this trap using *this exact UDID* as its example.

2. **`--stay-awake` cannot be combined with `--no-control`.** scrcpy keeps the
   screen on by sending a control message, so it refuses to start at all —
   exit 1, no frames. Every Android recording failed. It shipped because the
   flags were added AFTER the command was proven, and the tests asserted the
   argv CONTENTS, which is not the same as the binary accepting it.

3. **Readiness waited on a log line that can never arrive.** scrcpy writes INFO
   to stdout, block-buffered through a pipe, flushed only at process exit —
   measured 9s after recording began.

4. **A failed `start()` leaked scrcpy.** The orphan holds the device's video
   stream, so the NEXT run gets no frames and fails for unrelated-looking
   reasons.

5. **The iOS recorder could not start on a settled screen.** The mp4 held 48
   bytes for fifty seconds while ffmpeg ran happily. Root cause is **x264's
   ~40-frame lookahead**: a still phone sends few frames, so nothing is emitted
   until 40 accumulate. Measured on a real-time 1fps source: default tuning
   produced no frame within 8s; `-tune zerolatency` produced one in 555ms. So
   recording worked only while the screen MOVED — it began failing the moment
   the app started working.

6. **`IosDevice.forceStop()` was fire-and-forget.** The terminate landed after
   the next `launch()` and killed the freshly-launched app, leaving the phone on
   the iOS Home screen — reported by the journey as "SignIn or Home not
   reached", i.e. blamed on a product that would not load. A/B tested 2/2.
   Android never had it, because its `forceStop` is a synchronous `adb` call:
   shared journey code read identically on both platforms and was correct on one.

7. **Parallel walks shared one account.** J38 asserts on how many requests a
   person has open, and both platforms signed in as `adult-power@shytalk.dev`
   against one emulator, so each run's ticket landed in the other's count. iOS
   now uses `host@shytalk.dev` — adult, `en`, MEMBER, and used by no other
   journey.

---

## The evidence page

`/private/tmp/.../scratchpad/evidence/shy-0396-evidence.html`, built by
`gen_evidence.py`.

Two operator complaints about it were **both real**:

- **Screenshots would not enlarge.** A `forEach` over `li.step, li.suite` also
  matched ten "defects fixed" NOTE rows that carry no checkbox, so
  `cb.addEventListener` threw, the exception left the IIFE, and the
  click-to-enlarge handler below it was never registered. The page rendered
  perfectly; only clicking revealed it was half-dead. Same shape as the admin
  Support tab that showed nothing because one import 404'd.
- **No videos.** There were none to show — and the page carried my false claim
  that device recording was impossible on this handset. Both fixed.

`verify-evidence.js` now checks the page BEHAVES: zero `pageerror`, both walks
embedded and decoding, a screenshot enlarging on click, Esc closing it, and the
progress bar reaching 100%. Currently **8/8**.

---

## Tickets filed

| Ticket | Priority | Status | What |
| --- | --- | --- | --- |
| SHY-0428 | P1 | In Review | Send drawn under the Android navigation bar. Fixed. |
| SHY-0429 | P1 | Draft | `PmSyncService` killed for outstaying its foreground budget. Seen twice in nine minutes; the `.dev` package was terminated outright. Still reproducible after the fix run. |
| SHY-0430 | P3 | Draft | The debug overlay covers copy that SHY-0396 asserts on. |
| SHY-0431 | P3 | Draft | The SHY-0428 fix leaves a black 34 pt gutter under the Support bar on iOS. Introduced by us. |
| SHY-0432 | P2 | Draft | A journey step can pass on a previous run's data — it matches a constant message and takes `docs[0]`. |

---

## Also fixed on the way

- **Two perf tests measured the machine's load.** Wall-clock budgets inside a
  runner that puts ~190 suites across every core. Three consecutive runs of the
  UNMODIFIED script gave ratios of 1.56, 1.70 and **4.91** — the last worse than
  a deliberately quadratic mutant scored (3.11). They now COUNT WORK via a
  `bash -x` trace: 10 files means exactly 10 `validate_file` calls. Mutation-
  verified both ways, and the guard documents what it cannot see.
- **`.gitignore`** — `journey-results/` matched only that exact directory, so the
  per-platform dirs (now carrying tens of MB of video) were committable.

---

## What the iOS re-run added

It passed 14/14, from the built-in recorder, starting in **0.73s on a dead-static
screen** — the exact condition that used to hang it. It also produced three
findings:

- **The `union` fix was NOT iOS-neutral — it was a fix there too.** Measured
  across the pre- and post-change walks: Send's bottom edge sat at **20.0 pt**
  inside iOS's **34 pt** bottom safe area, so the home indicator covered its
  lower ~14 pt. After, it ends 54.0 pt up. SHY-0428 is corrected to say so.
- **A sweep failure of mine.** Fixing `forceStop`'s three call sites missed
  `screencap`, `tap` and `swipe` — thirteen more. `screencap` had already done
  damage: every iOS run lost its LAST step's screenshot to `process.exit()` while
  the report linked it. On a FAILING run that is the frame of the failing step.
  The guard is now written for the CLASS, deriving the method list from the
  driver's own `async` declarations.
- **SHY-0431 / SHY-0432** filed — see the ticket table above.

## Where to pick up

1. **Operator sign-off** on the evidence page. That is the merge gate.
   Artifact: `https://claude.ai/code/artifact/7a12acb2-5ee0-4d9b-b4f2-f7d3374600c7`
2. **Then** push, merge `main`→`develop`, `develop`→branch, merge, deploy dev.
3. Open questions unchanged from part 12: whether to split this four-story
   branch, and the 19 dependabot vulnerabilities (2 critical, 12 high).

### Known, not chased

- `backfill-cross-cohort-flag.test.js` "stamps a collection spanning multiple
  500-doc write batches" fails under the full parallel suite and passes in
  isolation — the same contention class as the perf tests above. Pre-existing.
