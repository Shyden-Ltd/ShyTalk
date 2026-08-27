# Session handover — 2026-08-26 (part 19)

Self-contained. Everything needed to resume is here.

---

## 1. Where the work is

| | |
| --- | --- |
| Branch | `story/SHY-0458-conversations-read-path-via-api` |
| HEAD | `db28ba7baa2` |
| Ahead of `origin/develop` | **178 commits** |
| `origin/develop` | `c691ad046e6` — **untouched** |
| Working tree | clean |
| **Pushed** | **NOTHING. Deliberate** — PR #1940 sign-off is still gated on the operator. |

Three commits added this session, on top of part 18's state:

```
db28ba7baa2  fix(SHY-0466): a room opens on room data, not on voice
c84a27a876a  fix(SHY-0465): the stack asks the phone before choosing a voice address
e7c0b51fb70  docs(SHY-0465, SHY-0466): file what J09's voice failure actually was
```

The branch now carries **nine** stories — SHY-0169, 0456, 0457, 0458, 0461,
0463, 0464, 0465, 0466 — against "ONE Story = ONE PR". Nothing is pushed, so it
can still be split. §5 has the decision.

---

## 2. J09 was the open blocker in part 18. It is closed.

Part 18 §5 left J09 red and named the suspect as "the phone's WebSocket link to
LiveKit — `adb reverse`, or the app's LiveKit client". **Both were healthy.**

The machine had rebooted, so the symptom was re-confirmed before anything was
touched, and it reproduced. What the probes actually said:

```
phone -> localhost:7880   (adb reverse)   200        signalling OK
phone -> 192.168.1.3:7880 (host LAN)      000        unreachable
phone -> 192.168.1.1      (gateway)       0% loss    positive control
mac   -> 192.168.1.5      (the phone)     100% loss
arp -an                                   192.168.1.5 (incomplete)
macOS firewall                            disabled
```

`local/start.sh` detects this machine's LAN address and hands it to LiveKit as
`NODE_IP`, the address LiveKit advertises in its ICE candidates. It asked "what
is my LAN IP" and never "can the phone reach it". Signalling connected over the
USB tunnel so the room opened; ICE then pointed the phone at an address it
could not reach, and voice never joined.

### The cause was reported before it was proven — read this before quoting it

The operator was told this was **AP client isolation**. That was a guess
wearing the confidence of the measurements. Hours later, after both devices
took new DHCP leases (host `.3` -> `.5`, phone `.5` -> `.6`), the phone reached
the host with **0% loss**. Isolation, a stale lease and a band/AP split all fit
the evidence and none was proven.

The measurements were right. The label on them was not. SHY-0465, the script
header, the test docstring and the memory file have all been corrected.

It does not weaken the fix — it is the argument for it. The stack cannot know
WHY the phone cannot reach it either. It only needs to know WHETHER it can.

---

## 3. What shipped

### SHY-0465 — the stack asks the phone before choosing a voice address

`scripts/dev/choose-livekit-node-ip.sh` pings this machine **from the attached
phone** and falls back to `127.0.0.1` when the answer is no, where media rides
the `adb reverse tcp:7881` tunnel that `start.sh` already opens.

The probe is **ICMP, not a port check**, and that is not a detail: the address
is chosen at Step 1, before any container starts, so nothing is listening on
7880 yet and a port check would report "unreachable" on a healthy network.

"No device attached" is deliberately NOT read as "unreachable" — that would
flip every desktop-only run onto loopback for a reason nobody tested. A probe
that cannot run keeps the LAN address and says it is untested.

The tests RUN the chooser with real commands and real exit codes rather than
reading it. Two matter more than the rest:

- one asserts the **seam** — a chooser that decides correctly while `start.sh`
  ignores its answer would pass everything else and fix nothing;
- one asserts the **stdout contract** — `start.sh` captures stdout as the
  address, so a warning leaking there would be advertised to clients as an IP.

### SHY-0466 — a room opens on room data, not on voice

The room screen rendered nothing until voice reported ready, and no path marked
voice ready on failure — only a 10s watchdog. On any network that blocks media,
the seat grid, the chat and the participant list were withheld for ten seconds.
None of them need voice.

Four sites raised the unavailable flag and **three recorded no reason**, so the
banner could only ever say "temporarily unavailable" — the sentence a whole
session of diagnosis started from.

- `isVoiceUnavailable` is now DERIVED from the reason. That turns "forgot to
  say why" into a compile error, and the compiler named all seven call sites; a
  grep would have missed some.
- The reason is a typed value, not the voice service's own message. That
  message is English and technical, so it cannot be shown to a reader in Thai
  however well the app is translated. It still reaches the log.
- What the screen shows is a pure function, `roomScreenContentFor`, so "voice
  never decides whether the room renders" is asserted over every voice state.
  The access-check gate keeps its precedence — rendering earlier must not
  render a room the block check has not cleared.
- The mic control stays ENABLED and answers the tap with an explanation. It
  still refuses to write a mute when there is no voice session, which is what
  SHY-0272's test protected; what changed is the silence.
- 4 new strings across all 21 locale files, hand-written (the repo's
  translate script is quota-blocked on Google's endpoint and wrote a to-do
  manifest instead).

---

## 4. Two things found on the way, both fixed here

- **The androidTest source set had not COMPILED since 2026-08-19.**
  `getProfileForViewing` reached `UserRepository` without reaching
  `FakeUserRepository`. Every instrumented test silently stopped RUNNING rather
  than failing — a whole tier dark for a week. Fixed here because SHY-0466's own
  evidence (`MicToggleTest`) lives in that source set.
- **The journey runner DROPPED any on-screen text over 40 characters** from its
  reports (`summarizeScreen`, a `filter`, not a truncate). The longest sentences
  on screen — banners and warnings, exactly what a reader needs — were absent
  from every report. SHY-0466's own banner is 67 characters and was invisible in
  the evidence while plainly visible in the screenshot. Truncated now.

---

## 5. Awaiting the operator

- **PR #1940 sign-off** — unchanged since part 17. Nothing is pushed.
- **Branch topology** — nine stories on one branch. Still splittable.
- **SHY-0458's 4 failing unit tests — now filed as [[SHY-0467]]**, at the
  operator's request. `PrivateMessageRepositoryImplTest` —
  `getOrCreateConversation` ×4. Proven pre-existing by stashing this session's
  work and reproducing them identically; the file was last touched by
  `f2f3d46f14b`, SHY-0458's own commit.

  They are stale, not a product defect — SHY-0458 moved the write off Firestore
  and they still mock it. But they are also the ONLY assertion anywhere that
  `participantIds` are stored as Strings (SHY-0130) and that a new thread is
  stamped `crossCohortAtMigration: false` (SHY-0132, a cross-cohort leak). The
  server does both correctly and no test says so:
  `conversations-read-path.test.js:175` compares `participantIds.map(String)`,
  which coerces before comparing and so cannot see the very bug it looks like it
  guards. **Deleting the four to green the suite is the one move that leaves
  both invariants unguarded** — SHY-0467 requires the server-side assertions
  first, mutation-tested.
- **J02 / SHY-0459** — still deliberately red; a minor sees controls the server
  refuses. Product decision, not a bug to paper over.
- **LiveKit logs an `ERROR` on every local boot** — `devsecret` is 9 characters
  and LiveKit wants ≥32. Non-fatal, cosmetic, real. Fixing it means changing
  `local/livekit.yaml` and `express-api/.env.local` together.
- **LiveKit as a ratified exception** and **the portal script tag** — both still
  open from part 17 §7.

---

## 6. Test state, all measured this session

| Suite | Result |
| --- | --- |
| express `npm test` (canonical) | **15 660 passing**, 5 failed in 4 suites |
| `:shared:jvmTest` + `:app:testLocalDebugUnitTest` | **2 283 completed**, 4 failed |
| Locale parity + content | 105 passing across 4 suites |
| Device core set (OnePlus, local) | **4/5** — only J02 red |

The 4 express failures are the ones part 18 named, unchanged:
`check-no-new-stubs`, `device-journey-parallel-isolation`,
`drivers/ios-session-recovery`, `drivers/journey-device-parity`.
`check-no-new-stubs` still names the previous session's `conversations-read-path`,
`conversations-stream` and `notification-settings-read` suites — real debt
belonging to SHY-0169 / SHY-0458.

The 4 Kotlin failures are the SHY-0458 ones in §5.

**Run `npx jest` from the repo root and you will see two EXTRA failures**
(`device-journey-picker-open`, `drivers/journey-smoke-platform`) that are not
real. The canonical runner is `npm test` from `express-api/`; both pass under
it. This cost time this session.

### SHY-0464 re-proven

After the full 15 665-test run, with no re-seed:

```
users/50000010  22 keys  dateOfBirth=yes  isSuspended=unset
users/50000020  23 keys  dateOfBirth=yes  isSuspended=unset   <- Lena
users/60000010  23 keys  dateOfBirth=yes  isSuspended=unset
users/50000060  24 keys  dateOfBirth=yes  isSuspended=unset
```

Before SHY-0464 a full run left these as 3-key documents with Lena suspended.
That is the fix holding.

---

## 7. Device evidence (OnePlus CPH2653, serial 3b402284, local target)

J09 was proven BOTH ways, which is SHY-0466's Definition of Done.

| Condition | Seat grid renders | Outcome |
| --- | --- | --- |
| LiveKit **stopped** | **2.1s** — was timing out at 10 000ms | banner shown; mic declines to write a mute |
| Voice healthy | **2.2s** | J09 **14/14** |

The screenshot for the stopped-LiveKit run shows the banner reading "Voice chat
is temporarily unavailable — You can still read and chat" with the full room —
seat, participant count, message box, chat controls — live behind it.

Read the TIMING, not the tick. A step that stops waiting out a watchdog is the
fix landing; a step that merely goes green may just have raced differently. The
same root cause surfaced as two different failures on two runs before it was
understood — "opens his mic" one run, "shows the seat grid" the next — because
the runner's wait for `room_seatGrid` is 10 000ms, the same value as the app's
voice watchdog. SHY-0466 removes that race rather than re-tuning the wait.

---

## 8. Environment as left

- Local stack UP: express-api `:3000`, Firebase emulators, web `:8888`,
  LiveKit/MinIO/Mailpit via Docker. Started with a plain `bash local/start.sh`.
- **The LAN addresses moved during the session.** This machine is now
  `192.168.1.5` (was `.3`) and the phone `192.168.1.6` (was `.5`). LiveKit is
  advertising `192.168.1.5` because the chooser probed and the phone answered.
  **Do not hard-code either address** — the chooser re-derives them every start.
- Personas seeded and verified intact after a full suite run (§6).
- OnePlus `CPH2653` (`3b402284`) connected by USB, 8 reverse tunnels active.
- Emulator data does NOT survive a hard reboot — the export only happens on a
  clean shutdown. `local/firebase-emulator-data/` was empty on arrival this
  session and `start.sh` re-seeded from scratch. Expect to re-seed after any
  crash or forced restart.
- Restart the API alone from `express-api/` with
  `NODE_ENV=local TEST_API_KEY=local-test-key node src/index.js`.

---

## 9. Traps met this session

- **A handover's diagnosis is a hypothesis, and so is the next one.** Part 18
  named the wrong layer for J09. This session then named the wrong CAUSE for the
  right layer. Reproduce first; and when you report a cause, say which parts are
  measured and which are inferred.
- **After a reboot, re-confirm the symptom before debugging it.** It did
  reproduce here — but the machine had been up 18 minutes and the emulator data
  was already gone, so the environment was not the one the handover described.
- **A source-scanning guard can pass vacuously.** A regex written for
  `LIVEKIT_NODE_IP=$(detect_lan_ip)` did not match the real
  `${LIVEKIT_NODE_IP:-$(detect_lan_ip)}` form, so it went green against the
  broken code it existed to catch. Anchor on the form that is ACTUALLY there.
- **Use the canonical runner.** Bare `npx jest` from the repo root reported two
  failures that do not exist under `npm test`.
- **A derived field is a better guard than a convention.** Making
  `isVoiceUnavailable` derive from the reason turned a "remember to set it" rule
  into a compile error, and the compiler enumerated the call sites.
- **A test can be inconclusive rather than passing.** Pointing LiveKit at
  TEST-NET-1 to fake "voice unreachable" let signalling complete anyway, so the
  app considered voice AVAILABLE and J09 passed — proving nothing about the
  path under test. Stopping the container was the honest reproduction.
- **The evidence report can omit the evidence.** The banner was on screen in the
  screenshot and absent from the report's text list, and the cause was a filter
  in the runner, not the app. The first theory — that a `testTag` on the
  container had merged the semantics — was wrong, and the comment written for it
  had to be corrected too.
