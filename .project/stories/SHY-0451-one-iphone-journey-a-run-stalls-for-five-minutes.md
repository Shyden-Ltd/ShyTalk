---
id: SHY-0451
status: Draft
owner: unassigned
created: 2026-08-24
priority: P2
effort: M
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0451: One iPhone journey a run stalls for five minutes

## User Story

As **whoever waits for an iPhone journey run**, I want the run to take the time
the journeys take, so that a green matrix does not cost twice what it should.

## Why

Every other journey on the iPhone now completes in 20–45 seconds. Roughly once
per fourteen-journey run, exactly one of them takes **310–380 seconds**, and it
is a different journey each time — J-ADMIN, J02, J06, J12, J38 have all been the
victim.

It always passes. It is not a failure; it is a stall.

That single journey is the difference between an 8-minute run and a 13-minute
one, and it makes the run time unpredictable, which is worse than it being
merely slow.

## Where it is

Inside `signOutFlow`, measured with per-phase instrumentation:

```
PROBE eASI signOut-done @15680ms      typical
PROBE eASI signOut-done @12749ms      typical
PROBE eASI signOut-done @312193ms     the stall
```

A healthy `signOutFlow` is 11–17 seconds. `signOutFlow` is four taps, three
waits and a final wait for SignIn.

## What it is NOT

Each of these was hypothesised, measured, and ruled out. Recorded so the next
person does not spend the evening re-testing them:

| Suspected | Measured | Verdict |
| --- | --- | --- |
| A hung HTTP request | Bounded every WDA command at 20s, then 10s | Stall persisted |
| The dump retry budget (8 attempts × a slow attempt) | Added a time budget, 45s then 10s | Stall persisted |
| WebDriverAgent session re-creation | Instrumented: 17 sessions per run, 4.6–5.7s each | Not it |
| A `withSessionRecovery` WDA restart | It only clears the session id; creation is ~5s | Not it |
| Screen reads being slow | 696–1,648ms each; seven of them cannot make 312s | Not it |
| Slow journeys generally | Twelve of fourteen are 20–45s in the same run | Not it |

The arithmetic is the puzzle: with every command bounded at 10s and about seven
commands in `signOutFlow`, the path cannot exceed roughly 70 seconds. It
reaches 312.

## Where to look next

- **Instrument to the individual command.** The per-phase probe was granular to
  the step; the stall needs granularity to the HTTP call, with timestamps, so
  the gap can be seen rather than inferred. Note that the run which carried the
  granular probe did not stall — it needs to run until it catches one.
- **Wall-clock the whole thing, not just our code.** A gap that is not inside
  any of our awaits would point at the event loop, the phone, or Appium's own
  queueing rather than at this flow.
- **`appium:newCommandTimeout` is 300 seconds**, which is suspiciously close to
  the observed 310–380. Worth ruling in or out explicitly: if a session is
  considered idle and reaped, whatever waits on it may wait exactly that long.

## Acceptance Criteria

### Happy path

- [ ] Fourteen iPhone journeys complete with no journey taking more than about
      twice the median.
- [ ] Run time is predictable: three consecutive runs within 15% of each other.

### Error paths

- [ ] Whatever the cause is, reaching it FAILS FAST rather than waiting minutes.
- [ ] The failure names what it was waiting for.

### Edge cases

- [ ] A genuinely slow journey (J38 does the most navigation) is still allowed
      its time; this is about a stall, not a budget on real work.

### Performance

- [ ] The iPhone matrix runs in under 10 minutes.

### Security

- [ ] No change.

### UX

- [ ] No product change. Test infrastructure.

### i18n

- [ ] No change.

### Observability

- [ ] The run summary already reports dumps, total read time and the share of
      the run. A stall should be visible there rather than needing a stopwatch.

## BDD Scenarios

**Scenario: A run takes the time its journeys take**

- **Given** fourteen journeys that each take under a minute
- **When** the matrix runs
- **Then** it finishes in about the sum of them, with no journey stalling

## Test Plan

| Layer | What it proves |
| --- | --- |
| Instrumentation | Per-command timestamps identify the gap. |
| Device | Three consecutive runs, no journey beyond twice the median. |

## Out of Scope

- The general speed of iOS screen reads, which is a separate and known cost
  (~696ms against ~65ms on Android).

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| It is intermittent, so a fix cannot be proven by one green run | Three consecutive runs is the bar, stated above. |
| Chasing it burns time for a stall that always passes anyway | It is P2 for that reason — the matrix is correct, just unpredictable. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Three consecutive iPhone runs with no stall.

## Notes

- Found on 2026-08-24 while taking the iPhone matrix from 19m 09s to about 8
  minutes. Everything else in that work is committed; this is the one thing left
  that was not isolated.
