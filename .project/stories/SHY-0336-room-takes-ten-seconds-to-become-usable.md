---
id: SHY-0336
status: Draft
owner: claude
created: 2026-08-18
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0336: A room shows "loading" for 10+ seconds before it can be used

## User Story

As **someone opening a voice room**, I want the room to appear and be usable
straight away, so that joining a conversation feels like walking into a room
rather than waiting for a page to download.

## Why

**P1, MVP-blocking.** Operator-reported 2026-08-18: opening a new room shows
"loading" for **10+ seconds** before it is usable.

Ten seconds is past the point where people assume something is broken. On a
social product the cost is compounding: the person who opened the room is
staring at a spinner, and anyone who followed them in is staring at an empty
room wondering whether to leave. It converts the product's core action —
"join a conversation" — into an act of faith.

It is also the difference between a room being **used** and being **abandoned**.
A user who taps a room, waits, and backs out never discovers that the product
works.

## Acceptance Criteria

### Happy path

- [ ] The room UI is on screen and interactive immediately, with connection progressing behind it — not gated behind a blocking spinner.
- [ ] Audio is usable within 2 seconds on a normal connection.
- [ ] Entering a room the user has been in before is not slower than the first time.

### Error paths

- [ ] A connection that genuinely fails says so, rather than spinning indefinitely.
- [ ] A slow connection shows progress that distinguishes "still working" from "stuck".
- [ ] Backing out during connection cleans up — no orphaned session holding a mic or a seat.

### Edge cases

- [ ] On a poor connection the room still becomes usable, degrading rather than blocking.
- [ ] Opening a second room immediately after leaving the first does not inherit the first's delay.
- [ ] Cold start (app just launched) is measured separately and is also within budget.

### Performance

- [ ] **Time from tapping a room to a usable room is under 2 seconds** on a normal connection, measured on real devices, not an emulator.
- [ ] The budget is asserted by a test, so a regression fails CI rather than being noticed months later.

### Security

- [ ] N/A — a latency fix. No change to who may join a room or what they may do; token minting and seat rules are untouched.

### UX

- [ ] No dead-end spinner. Whatever the state, the user can see what is happening and can leave.
- [ ] Verified on real devices at the smallest supported resolution and on a throttled connection.

### i18n

- [ ] Any new or changed strings ship in all 20 locale files.

### Observability

- [ ] Join is instrumented in phases (token, connect, first audio) so a future regression can be attributed to a phase rather than guessed at.

## BDD Scenarios

**Scenario: A room is usable almost immediately**

- **Given** someone browsing the room list
- **When** they open a room
- **Then** the room appears straight away and they can take part within about two seconds

**Scenario: A room that cannot be joined says so**

- **Given** someone whose connection is failing
- **When** they open a room
- **Then** they are told it could not be joined, instead of waiting indefinitely

**Scenario: Leaving during connection leaves nothing behind**

- **Given** someone who opened a room and is still connecting
- **When** they leave before it finishes
- **Then** they are returned to the room list and hold no seat or microphone

## Test Plan

**Measure BEFORE changing anything.** The current 10+ second figure is
operator-observed; the story starts by recording a real measurement per phase on
a real device, so the fix is aimed at the phase that actually costs the time
rather than the one that looks slow.

### Kotlin unit — `shared/src/commonTest/.../room/`

- `the room screen renders before the voice session has connected`
- `a failed connect surfaces an error state, never an indefinite loading state`
- `leaving mid-connect tears the session down`

### Express/Jest — `express-api/tests/routes/livekit*`

- token minting is not doing work that could be deferred or cached

### Journey tests (REQUIRED — real devices)

- `journey-tests/` scenario measuring **tap → usable**, asserting the budget on a
  real Android device and a real iPhone, local then dev.
- A second scenario on a throttled connection asserting the room still becomes
  usable rather than blocking.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the room screen gated behind connect again | `the room screen renders before the voice session has connected` |
| the budget assertion relaxed | the journey's latency assertion |
| mid-connect teardown removed | `leaving mid-connect tears the session down` |

## Out of Scope

- Mute correctness — its own story.
- Any redesign of the room UI beyond what removing the blocking spinner requires.

## Dependencies

- None, though it touches the same voice session as the mute fix; sequence them
  to avoid a conflict rather than combining them.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The spinner is removed but the room is not actually usable | The journey asserts USABILITY (taking part), not the absence of a spinner. |
| Optimising the wrong phase | Phase instrumentation and a real measurement come first, before any change. |
| A regression creeps back | The budget is asserted in CI, not left to observation. |

## Definition of Done

- [ ] Every AC met; every named test written RED first and now green.
- [ ] A before/after measurement per phase, on real devices, recorded in Notes.
- [ ] Journey walked on real Android + real iPhone, local THEN dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [ ] Status In Review before merge; Done on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Reported by the operator as an MVP blocker, verbatim: "when
  opening a new room. it should appear and connect and be useable instantly
  instead of 'loading'. for 10+ seconds."
- **2026-08-18** — Split from the mute report into its own story: a latency
  problem with a different fix and different tests.
