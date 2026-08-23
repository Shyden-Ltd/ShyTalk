---
id: SHY-0447
status: In Review
owner: claude
created: 2026-08-23
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0447: The journeys spend their whole life reading the screen

## User Story

As **whoever waits for a journey run**, I want it to finish in minutes rather
than tens of minutes, so that running the walks is something we do often rather
than something we avoid.

## Why

The operator, 2026-08-23: *"almost 4 minutes in 1 journey? that's crazy. way
too long. a real test framework wouldn't take this long."*

Measured rather than guessed. The runner now counts its own screen reads, and
on the real OnePlus:

```
Screen reads: 96 dumps, 244.2s (2544ms each, 87% of the run)
```

**It was never the sleeps.** `adb exec-out uiautomator dump` spawns a fresh
instrumentation on **every call**. Splitting it: the `cat` that reads the file
back is ~80ms; the dump itself is ~2.2s. Neither `/dev/tty` nor `--compressed`
helps, and it costs the same on the **Android launcher** as inside ShyTalk — so
it is the tool, not the app, and not the debug badge's repaint either.

iOS was never slow this way because WebDriverAgent is a server that stays up:
**278ms** for the same call.

## Acceptance Criteria

### Happy path

- [ ] A journey run finishes in a small number of minutes.
- [ ] Every journey that passed before still passes.

### Error paths

- [ ] Where the fast reader is unavailable the run still works, and says so.
- [ ] A failure caused by the harness racing the product is not reported as a
      product defect.

### Edge cases

- [ ] Holds across a force-stop and cold start mid-journey.
- [ ] Holds when an overlay dismisses itself before it can be tapped.
- [ ] Holds on both platforms — including the one that was already fast.

### Performance

- [ ] Screen reads stop being the majority of a run.
- [ ] The run REPORTS its own read cost, so this is measurable next time.

### Security

- [ ] No change. The fast reader is local dev tooling.

### UX

- [ ] No product change.

### i18n

- [ ] No change.

### Observability

- [ ] Every run prints how many reads it made, what they cost, and what share
      of the run that was.

## BDD Scenarios

**Scenario: Running the walks**

- **Given** somebody running the journeys on a real phone
- **When** the run finishes
- **Then** it took minutes, and says where its time went

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | A tree carries when it was read, and is reused only while fresh. |
| Unit | The poll interval is a floor, not an addition. |
| Unit | The two source formats parse to the same nodes, from a real captured fixture. |
| Unit | A picker that never opens fails naming the picker. |
| Device | The full set passes, faster. |

## How it was built

**The big one: Android reads the screen over a warm UiAutomator2 session.**
Same phone, same screen: **2332ms → 65ms**. Only the READ moves — taps, swipes
and installs stay on adb, which is proven and is not where the time went.
Stood up once at startup, closed deliberately at the end. Where the driver is
absent it falls back and says so loudly, because a silent fallback hides a 36×
regression behind a run that is merely slow.

Its `/source` puts the class in the **tag name** where `uiautomator dump` uses
`<node class=…>`. Everything else is identical — proven on the phone, where
both readers returned the **same eight ids** on the same Home screen, Compose
testTags included. So the tag is renamed at the seam and `parseNodes` never
learns there are two formats.

**Two smaller wins**, found by attributing the dumps to their callers
(`tapResolved=22 tapId=16 waitForId=16`):

- `tapId` dumped to FIND a control and `tapResolved` dumped AGAIN to re-resolve
  it, with nothing in between. A caller may now hand over the tree it just
  took — judged on when the phone was actually read, not the caller's word.
- The poll interval was an **addition**: read, then sleep 700–800ms. Now a
  floor.

Both are **Android-only**. iOS reads were already 278ms, so they bought it
almost nothing.

### Four latent defects the speed exposed

Every one of these was already there, padded by the slowness:

1. **The persona-picker wait never waited.** It waited for the text "Sign in as
   test persona" — the label of the BUTTON that opens the picker, on screen
   before, during and after. It now waits for `persona_picker_list`, which only
   exists while the sheet is open, and retries a swallowed tap.
2. **The ticket assertion raced the server.** Step 14 queried Firestore the
   instant it tapped and reported "the request never arrived" for a ticket that
   arrived a moment later. Bounded wait.
3. **The cold-start wait stared at an empty screen.** After a force-stop,
   `settle` reaches Home and the dump then goes back to `android:id/content`
   alone. It settles again instead of timing out.
4. **A self-dismissing overlay failed the walk.** SHY-0441 refuses to tap a
   control that vanished — right for a control the walk means to press, and
   inverted for an obstacle. A permission dialog that auto-answered has
   delivered exactly what was wanted.

## Result

| | Before | After |
| --- | --- | --- |
| J38 step time | 269.6s | 47.4s |
| Full Android set | ~1020s | **271s** |
| Reads as a share of the run | **87%** | 35% |
| Android journeys passing | 13/13 | **13/13** |

## Out of Scope

- The iPhone's journey failures. Checked at the pre-performance commit: J38
  fails there too, with the same persona-row symptom. That is SHY-0446.

## Dependencies

- `appium driver install uiautomator2`, and the Appium server started with
  `ANDROID_HOME` set or the Android driver refuses every session.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The fast reader is unavailable on another machine | Falls back, and says so once, loudly. |
| Speed hides new races | It EXPOSED four. Each was fixed at the cause rather than by restoring padding. |
| The two source formats drift | The fixture is a real capture with an anchor test that fails if it drifts to `<node>` shape. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [x] Full Android set 13/13, recorded, in under five minutes.
- [x] The run reports its own screen-read cost.

## Notes

- Raised by the operator on 2026-08-23.
- The instrumentation stays: "the journeys are slow" is not actionable, and
  "355 reads at 268ms is 35% of the run" is.
