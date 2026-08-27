---
id: SHY-0452
status: In Review
owner: unassigned
created: 2026-08-24
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0452: WebDriverAgent wedges and the phone stops answering for one journey

## User Story

As **whoever runs the iPhone matrix**, I want a run to be green when the product
is good, so that a red result means something is actually wrong with ShyTalk.

## Why

Roughly twice in twelve runs, WebDriverAgent stops answering mid-run. One
journey then fails, reporting:

```
Appium did not grant a reconnect session within 30000ms
(WebDriverAgent is probably wedged): The operation was aborted due to timeout
```

Nothing is wrong with the app. The journey that fails is a different one each
time, and re-running passes. That is a matrix nobody can use as a gate: about
one run in six is red for a reason unrelated to the product, so a red result
stops carrying information.

This is the residue of SHY-0451, and it is a **different defect**. SHY-0451 was
that the wedge was unbounded and cost 310–415 silent seconds. It is now a fast,
named failure at 30 seconds. The wedge itself was never fixed, because it was
never the same thing.

## What is already known

Measured across the twelve runs that closed SHY-0451:

- **Session creation is bimodal.** Every creation that succeeded did so in
  **under 12 seconds** (the driver prints a line for any that takes longer, and
  across twelve runs it printed none). The wedged ones did not complete at all.
- **So this is not a tuning problem.** There is no population of 12–30s
  creations that a bigger budget would rescue. Before SHY-0451's fix the same
  wedges resolved somewhere in the 180–300s range, which is what produced the
  stall — so raising the budget makes the failure slower, not rarer.
- **It is not the screen recorder.** Two runs with `--no-record` averaged
  756ms per screen read against 694ms for four runs with recording, and one of
  the two still failed a journey. The MJPEG-contention theory was the leading
  hypothesis and is ruled out by measurement.
- **The wedge follows a WebDriverAgent death**, seen as
  `Could not proxy command to the remote server. Original error: socket hang up`
  on the answer to a command that had already taken effect.

**SHY-0451's evidence page** carries the twelve-run data this story rests on:
https://claude.ai/code/artifact/7bf240a7-8cb4-4954-8767-a0d42de50c2f

## Resolution — 2026-08-25

The second hypothesis in the list below was the right one: **Appium was still
holding the session that died**, and the new one queued behind it. Nothing had
ever asked Appium to let go.

A refused RECONNECT now releases the sessions the driver knows about and asks
once more. Only on a reconnect — before the first session there is nothing to
clear — and exactly one extra attempt, because a WebDriverAgent that will not
come back has to fail the step rather than spin against the phone.

**Caught in the field, on the third verification run:**

```
▶ Reach SignIn (for host@shytalk.dev) ... [ios] reconnect refused after 30012ms
  — releasing 16 known session(s) and asking once more
--- J39: ✓ PASS
```

Sixteen stale sessions. Before this, that same event cost the journey.

| | Before | After |
| --- | --- | --- |
| iPhone matrix | 13/14 or 12/14, ~1 run in 3 | **14/14, 14/14, 14/14** |
| A wedge mid-run | lost the journey | recovered, journey passed |

The fix carried a trap, and the test written for it caught the trap rather than
the fix: `isReconnect` was derived from "do we hold any session ids", and
releasing them empties that set — so the attempt after a recovery would have
looked like a COLD start and waited the 210s cold budget, which is exactly the
stall SHY-0451 removed. Having opened a session is a fact about the run, not
about what is currently held, and is tracked separately now.

## Where it was looked for

- **Why does WebDriverAgent die at all?** The death is what starts this; the
  refused reconnect is only the consequence. Appium server logs across a wedge
  have not yet been read.
- **Is Appium still holding the dead session?** If the refused reconnect is
  queueing behind a session Appium has not finished tearing down, deleting it
  explicitly before reconnecting may be the whole fix.
- **Recover without Appium.** The app can be restarted through `devicectl`,
  which does not need Appium to be well. `ensureAtSignIn` already does this at a
  higher level; the driver could do it when a reconnect is refused.

## Acceptance Criteria

### Happy path

- [ ] Six consecutive iPhone runs are green, with no journey failing for a
      reason other than the product.

### Error paths

- [ ] If WebDriverAgent dies, the run recovers and continues rather than losing
      the journey.
- [ ] A recovery that cannot succeed still fails fast and names what it was
      waiting for — the SHY-0451 behaviour is kept, not traded away.

### Edge cases

- [ ] A genuine product failure is still reported as a failure. Recovery must
      not become a way for a broken journey to pass.
- [ ] A second WebDriverAgent death in the same journey does not loop; the run
      says so and stops.

### Performance

- [ ] Recovery costs seconds, not minutes. A run that recovers stays inside the
      under-10-minute bar SHY-0451 set.

### Security

- [ ] No change. Test infrastructure only.

### UX

- [ ] No product change.

### i18n

- [ ] No change.

### Observability

- [ ] Every WebDriverAgent death and every recovery attempt is visible in the
      run output, with how long it took.

## BDD Scenarios

**Scenario: The phone stops answering and the run carries on**

- **Given** a journey walking the app on the iPhone
- **When** the phone stops answering partway through
- **Then** the journey continues and reports on the app, not on the tooling

**Scenario: A run says so when the phone cannot be brought back**

- **Given** a phone that has stopped answering and will not come back
- **When** the run has tried to recover
- **Then** it stops quickly and says the phone stopped answering

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | A refused reconnect triggers the recovery, and a second one does not loop. |
| Unit | Recovery cannot turn a genuine product failure green. |
| Device | Six consecutive runs green; every recovery visible in the output. |

## Out of Scope

- **The general speed of iOS screen reads** (~690ms against ~65ms on Android).
  Real, known, and separate — it is 60% of every run and deserves its own story.
- SHY-0451's stall, which is fixed and verified across twelve runs.

## Dependencies

- Builds on SHY-0451, which is what made this failure visible and fast.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A recovery that is too eager hides a real product failure | An explicit AC and a unit test; the same trap SHY-0451's replay fixes had to avoid. |
| It is intermittent, so one green run proves nothing | Six consecutive runs is the bar, stated above. |
| The cause is in Appium or WebDriverAgent, not in our code | Then the story is to survive it well, which the ACs are written for. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Six consecutive iPhone runs green.

## Notes

- Raised to **P1** by the operator on 2026-08-24: if the iPhone matrix is meant
  to gate merges, one run in six going red for a tooling reason makes a red
  result uninformative, which is the whole point of having one.
- Left at **Draft** deliberately. It is newly filed here, and the filing
  exemption is Draft-only; marking it In Review while nothing is implemented
  would be false, and the reviewed-up-to marker would point at a commit that
  reviewed nothing. It gets picked up on its OWN branch after this PR merges,
  which is also what one-story-one-PR asks for.
- Split out of SHY-0451 on 2026-08-24 rather than absorbed into it. SHY-0451's
  own evidence shows why they are different: the stall is gone in all twelve
  runs, and this failed in two of them.
