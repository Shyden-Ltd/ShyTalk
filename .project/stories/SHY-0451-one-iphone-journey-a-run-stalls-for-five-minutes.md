---
id: SHY-0451
status: In Review
owner: unassigned
created: 2026-08-24
priority: P1
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
| ~~WebDriverAgent session re-creation~~ | ~~17 sessions per run, 4.6–5.7s each~~ | **THIS WAS IT — see Resolution.** The measurement only ever saw the HEALTHY case, and a once-per-run outlier does not move a mean. |
| ~~A `withSessionRecovery` WDA restart~~ | ~~It only clears the session id; creation is ~5s~~ | **ALSO IT.** Clearing the session id is precisely what forces the unbounded re-creation. "Creation is ~5s" was the healthy case again. |
| Screen reads being slow | 696–1,648ms each; seven of them cannot make 312s | Not it |
| Slow journeys generally | Twelve of fourteen are 20–45s in the same run | Not it |

The arithmetic is the puzzle: with every command bounded at 10s and about seven
commands in `signOutFlow`, the path cannot exceed roughly 70 seconds. It
reaches 312.

**Resolved 2026-08-24 — the arithmetic was wrong because the bound was not
where it was believed to be.** See Resolution below.

## Where it was looked for — and what actually answered it

Kept as written, because the shape of the search is the lesson.

- ~~Instrument to the individual command.~~ Not needed. The time was never
  inside a command; it was inside `await this._session()`, which every command
  calls BEFORE the bounded request and which nothing bounded.
- ~~Wall-clock the whole thing.~~ Not needed for the same reason.
- ~~`appium:newCommandTimeout` is 300 seconds, suspiciously close to 310–380.~~
  **A red herring, and an instructive one.** The neighbouring capability is the
  one that mattered: `appium:wdaLaunchTimeout`, 180000. Two unbounded relaunch
  waits in one recovery ladder, not one idle-session reap.

What actually answered it was reading the guard for its own exclusions. The
cause was named in `COMMAND_TIMEOUT_MS`'s docstring, as the thing the bound
deliberately did not cover.

## Resolution

`_get` and `_post` DO carry `AbortSignal.timeout(COMMAND_TIMEOUT_MS)` — but both
open with `await this._session()`, which sits **outside** that signal, and whose
own `fetch` carried no signal at all. Session creation is not a command, so the
10s bound never applied to it, and the exemption was written down in
`COMMAND_TIMEOUT_MS`'s own docstring:

> "NOT applied to session creation, which legitimately takes minutes while
> WebDriverAgent builds and installs (`appium:wdaLaunchTimeout`)."

`withSessionRecovery` answers a dead WebDriverAgent by clearing `_sessionId` and
re-running the operation. That re-run calls `_session()`, and because WDA has
just died Appium takes the **relaunch** path — `wdaLaunchTimeout`, 180 unbounded
seconds — reached from inside a call the code believed was capped at ten. Two of
those in one `ensureAtSignIn` ladder is 310–415s exactly.

It accounts for every part of the signature the ruled-out hypotheses could not:
once per run (a WDA death is rare), a different journey each time (not
journey-specific), usually passing (the recovery works, it is only slow), and
concentrated in `signOutFlow` (the most command-dense stretch, so the likeliest
to be holding the ball when WDA dies).

Three of the five fetch calls in the driver were unbounded; all are bounded now,
with **separate** budgets for a cold start (which may genuinely build and
install WDA) and a reconnect (which reattaches to one already installed, and was
measured at 4.6–5.7s). A single flat bound would restore the defect.

Two further defects surfaced during verification, both in the same subsystem:

- **One wedge poisoned the rest of a journey.** `COMMAND_TIMEOUT_MS` promised in
  writing that "the driver drops the session on error"; nothing did it, so every
  later command queued behind the same dead session and paid the full timeout
  again. The transport now drops the session when the *socket* fails — a 404
  means WDA is alive and said no, and keeps its session.
- **`withSessionRecovery` replayed operations that had already taken effect.**
  A click that landed was hunted on the screen it had opened (J39, loud); a
  typed sentence landed twice because XCUITest's `/value` appends (J38, silent
  and worse). Both are made idempotent, and every replayable command now has to
  declare how it survives running twice.

**Evidence page:** https://claude.ai/code/artifact/7bf240a7-8cb4-4954-8767-a0d42de50c2f
— the hypothesis ledger with its two corrections, the full run ledger including
every failure and why, and the acceptance criteria checked against measurement.

### Measured, twelve consecutive iPhone runs on the real device

| | Before | After |
| --- | --- | --- |
| Stalls | ~1 per 14-journey run, 310–415s | **0 in 12 runs (~168 journeys)** |
| Longest journey | 415s | **78.8s** (J38/J39, the two support flows) |
| Run wall time | ~544s, unpredictable | **386–429s** |
| Three consecutive runs | — | 419s / 404s / 404s — **3.7% spread** |
| Unit suite for the driver | hung 120.6s | **5.6s** |
| Full Express suite | 8 suites red at HEAD | **501 suites, 15,541 tests, exit 0** |

## Acceptance Criteria

### Happy path

- [x] Fourteen iPhone journeys complete with no journey taking more than about
      twice the median. **Median 22.6–25.1s; every journey except the two
      support flows sits at 9–28s. J38/J39 run 59–79s and are covered by the
      edge case below — stated rather than glossed, because 79s IS more than
      twice 23s.**
- [x] Run time is predictable: three consecutive runs within 15% of each other.
      **419s / 404s / 404s — 3.7%.**

### Error paths

- [x] Whatever the cause is, reaching it FAILS FAST rather than waiting minutes.
      **A wedged reconnect now gives up at 30s instead of waiting toward 180.**
- [x] The failure names what it was waiting for. **"Appium did not grant a
      reconnect session within 30000ms (WebDriverAgent is probably wedged)".**

### Edge cases

- [x] A genuinely slow journey (J38 does the most navigation) is still allowed
      its time; this is about a stall, not a budget on real work. **J38 and J39
      are untouched at 59–79s.**

### Performance

- [x] The iPhone matrix runs in under 10 minutes. **6.4–7.2 minutes across
      twelve runs.**

### Security

- [ ] No change.

### UX

- [ ] No product change. Test infrastructure.

### i18n

- [ ] No change.

### Observability

- [x] The run summary already reports dumps, total read time and the share of
      the run. A stall should be visible there rather than needing a stopwatch.
      **Plus a session creation over 12s now prints a line of its own, because
      a mean of seventeen healthy ones is what hid this for two fix attempts.**

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

- [ ] Merged to `develop`, all checks green. **Suite is green locally (501
      suites, 15,541 tests, exit 0); nine commits unpushed pending review.**
- [x] Three consecutive iPhone runs with no stall. **Twelve.**

## Follow-up

**SHY-0452** — WebDriverAgent itself wedges roughly twice in twelve runs, and a
reconnect then cannot be granted. That is a distinct defect from this stall: it
is now a fast, named failure at 30s rather than a five-minute silence, but it
still costs a journey. Measured across all twelve runs, session creation is
**bimodal** — every successful one completed in under 12 seconds, and the wedged
ones never completed at all — so it is not a tuning problem and raising the
budget would only make the failure slower.

## Notes

- Found on 2026-08-24 while taking the iPhone matrix from 19m 09s to about 8
  minutes. Everything else in that work is committed; this is the one thing left
  that was not isolated.
