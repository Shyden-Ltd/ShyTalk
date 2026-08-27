---
id: SHY-0456
status: Done
owner: unassigned
created: 2026-08-25
priority: P1
effort: L
type: feature
roadmap_ids: []
mvp: false
released_in: v0.99.0
---

# SHY-0456: A core set that always runs, before we believe a green report

## User Story

As **whoever is about to sign off a release**, I want a small fixed set of
critical journeys to run every single time evidence is gathered, so that a green
report cannot mean "nothing we happened to look at was broken".

## Why

Operator, 2026-08-25:

> "for every journey evidence gathering session, there must be some mandatory
> journey tests that we always run, to ensure critically core features of the
> application still work. Such as, create a room, mute and unmute. Not a full
> regression test but just to prove that nothing has been critically broken due
> to recent changes"

There are two journey corpora and they disagree about what green means.

`manual-qa-runner --matrix` reads 188 `.feature` files and does cover `j09` —
the voice room: create, join, seat, mute, unmute, kick, close.
`device-journey-runner` has fourteen hardcoded journeys — sign-in, cohort
gating, moderation, monetization, support — and **no room, seat, mic or LiveKit
journey at all**.

The evidence bundle offered for PR #1940 sign-off came from the device runner.
It was 221 screenshots and "14/14 on both devices", and it never once created a
room or opened a microphone, on a platform whose core feature is voice rooms.

This is not hypothetical. Two voice-room defects are open right now — #1746
(SHY-0270, rooms close themselves seconds after opening) and #1795 (SHY-0340, a
muted person can unmute themselves). Neither could have been caught by the
evidence we were about to sign off, because nothing in it goes near a room.

The point of the core set is that it runs when the ticket has nothing to do with
rooms. That is exactly when a break goes unnoticed.

## Acceptance Criteria

### Happy path

- [ ] Every evidence-gathering run executes the core set **first**, before any
      ticket-specific journeys, on both real phones.
- [ ] The core set is: reach sign-in; create a room; unmute and mute again;
      close the room; follow and exchange a message; and the cross-cohort wall
      holding.
- [ ] The report names each core journey and its result, so a reader can see the
      core was proven rather than assume it.

### Error paths

- [ ] A failing core journey **stops the session** before the rest is gathered.
      Evidence of a feature working on a broken core is not evidence.
- [ ] A core journey that cannot run — no device, stack down — is reported as a
      blocker. It must never be silently skipped or counted as a pass.
- [ ] The runner exits non-zero when any core journey fails, so no automation
      can read a broken core as success.

### Edge cases

- [ ] Running with an explicit journey selection still runs the core set. A
      narrower request cannot opt out of it.
- [ ] If the core set itself is empty or unresolvable, the run fails loudly
      rather than passing a set of zero journeys.

### Performance

- [ ] The core set is small enough to always run. It is a critical-path guard,
      not a regression suite.

### Security

- [ ] The cross-cohort wall is part of the core set, because age segregation is
      the one defect class here with real safeguarding exposure.

### UX

- [ ] `--help` names the core set and states it cannot be skipped.

### i18n

- [ ] No new user-facing strings.

### Observability

- [ ] The report records which core journeys ran, on which device, and the SHA
      they ran against, so a bundle can never be read against the wrong commit.

## BDD Scenarios

**Scenario: Evidence is gathered after a change to an unrelated screen**

- **Given** a change that only touched the support pages
- **When** evidence is gathered for sign-off
- **Then** the core set runs first on both phones
- **And** the report names each core journey and its result

**Scenario: The core set finds the room feature broken**

- **Given** an app that can no longer create a room
- **When** evidence is gathered for sign-off
- **Then** the session stops before gathering the rest
- **And** the report names creating a room as the failure

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The core set resolves to a non-empty, fixed list; an empty set fails loudly. |
| Unit | Core journeys are prepended even when an explicit selection is passed. |
| Unit | A failing core journey halts the run and yields a non-zero exit. |
| Unit | An unrunnable core journey reports blocker, never pass or skip. |
| Device | The core set runs green end-to-end on the OnePlus and the iPhone. |
| Device | A deliberately broken room creation halts the session at the core set. |

## Out of Scope

- Fixing #1746 and #1795. This story makes them visible every session; it does
  not repair them.
- Broadening the device runner to the full 188-scenario corpus. The core set is
  deliberately small.

## Dependencies

- `j09-voice-room-host.feature` currently casts its joiner on "iOS Sim".
  Simulators are retired here, so the scenarios entering the core set must be
  re-targeted to the real iPhone before they can be mandatory on iOS.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The core set grows until it is a regression suite and gets skipped | The list is fixed and named in this story; adding to it is a story of its own. |
| A flaky core journey blocks every session | Core failures are investigated as P0, not retried away; the set is small so a flake is visible immediately. |
| Somebody adds a skip flag later | The "cannot opt out" behaviour has its own test asserting a narrow selection still runs it. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Demonstrated on both real devices: the core set runs first and green.
- [ ] Demonstrated failing: a broken room creation halts the session.

## Notes

- Filed 2026-08-25 from the operator's request, mid-way through gathering
  PR #1940 sign-off evidence. The matrix run in progress was stopped so this
  guard would be present in the first bundle rather than the second.
