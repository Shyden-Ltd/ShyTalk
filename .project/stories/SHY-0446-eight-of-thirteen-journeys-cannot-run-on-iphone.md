---
id: SHY-0446
status: Draft
owner: claude
created: 2026-08-23
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0446: Eight of the thirteen journeys cannot run on the iPhone

## User Story

As **whoever trusts a green journey report**, I want the same walks to run on
both phones, so that "it passes" does not quietly mean "it passes on Android".

## Why

On 2026-08-23 the full thirteen-journey set was run on the real iPhone **for
the first time**. Every previous iOS run in `journey-results-ios/runs` contains
exactly one journey; the set had only ever been driven on Android.

The result, repeated across three consecutive runs with identical outcomes:

| | Android | iPhone |
| --- | --- | --- |
| Journeys passing | **13 / 13** | **5 / 13** |

Passing on iOS: J-MARCUS, J02, J11, J05, **J38**. Failing: J-SMOKE, J-ALICE,
J-ADMIN, J08, J04, J07, J12, J06.

### These are not regressions

They were revealed, not caused. Nothing in the failures touches the changes
made this session — J38, the journey those changes are about, passes on both
phones — and the set had never been run on iOS to fail before.

That is the finding: **for as long as this has existed, "the journeys pass" has
meant Android.** A defect that only reaches iPhone users had eight journeys'
worth of places to hide.

### The two shapes

**1. A driver method that does not exist.**

```
J-SMOKE ▶ Clean reinstall … ✗ device.uninstall is not a function
```

The Android backend has it; the iOS one does not. It fails in 0.7s, so this
one is unambiguous.

**2. The app is not on screen when the walk expects it.**

Six journeys fail with `SignIn not reached within 12000ms`, and the dump shows
the **iOS home screen** — Weather, Calendar, FaceTime, Photos. The app is not
running. J04 gets further and stalls with the persona picker open and `Home not
reached within 60000ms`.

The pass/fail sequence is close to alternating, which points at a journey
leaving the app in a state the NEXT journey's launch cannot recover from,
rather than at any one journey being broken.

## Acceptance Criteria

### Happy path

- [ ] All thirteen journeys run on the iPhone.
- [ ] A journey leaves the app in a state the next one can start from.

### Error paths

- [ ] A journey that cannot start says whether the app failed to LAUNCH or
      launched and failed to reach the screen — the report currently cannot
      tell those apart.
- [ ] A missing driver method fails naming the method and the platform, not as
      a bare TypeError.

### Edge cases

- [ ] Holds when the previous journey ended signed IN.
- [ ] Holds when the previous journey ended on an error screen.
- [ ] Holds when the app was killed rather than closed.
- [ ] Holds across the full set run end to end, not only journey by journey.

### Performance

- [ ] No slower than Android for the same walk beyond what the platform costs.

### Security

- [ ] No change.

### UX

- [ ] No product change; test infrastructure — unless a failure turns out to
      be a real iOS defect, which then gets its own ticket.

### i18n

- [ ] No change.

### Observability

- [ ] The report distinguishes "the app is not running" from "the app is on the
      wrong screen". Six failures currently share one message.

## BDD Scenarios

**Scenario: The same walks on both phones**

- **Given** the thirteen journeys and two real devices
- **When** the set is run on each
- **Then** both report the same thirteen results

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The iOS backend answers every method the journeys call; a missing one is a named failure, not a TypeError. |
| Guard | Both backends implement the same surface, so the next method added to one cannot be forgotten on the other. |
| Device | The full set, end to end, on the iPhone. |
| Device | Two consecutive full sets, because the failures look like state carried between journeys. |

## Out of Scope

- The journeys' content. Nothing here suggests the WALKS are wrong; they run
  on Android.

## Dependencies

- None. The evidence is captured: three runs, identical results, with
  recordings.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Fixed one journey at a time until the list looks shorter | The Definition of Done is the whole set end to end, twice — the failures look like carried state, which a per-journey fix would mask. |
| A failure turns out to be a real iOS product defect | Then it is worth far more than this ticket, and gets its own. |
| It stays Android-only because Android is green | That is precisely the position this ticket exists to end. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Thirteen of thirteen on the iPhone, twice in a row.
- [ ] A guard that fails when the two backends' surfaces diverge.

## Notes

- Found on 2026-08-23 while re-running the full set after the SHY-0430/0432/
  0442 work. Recordings for all three runs are under
  `journey-results-ios/runs/`.
- Related to the journey-matrix gap inventory, which already counted missing
  driver methods; this is the same class, caught by running rather than by
  reading.
