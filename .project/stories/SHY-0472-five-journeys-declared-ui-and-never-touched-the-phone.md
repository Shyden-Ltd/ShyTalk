---
id: SHY-0472
status: Done
owner: unassigned
created: 2026-08-27
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
released_in: v0.99.0
---

# SHY-0472: Five journeys declared themselves UI and never touched the phone

## User Story

As **whoever reads a green journey report**, I want a journey that claims to
walk the app to have walked it, so that a passing run is evidence rather than a
formality.

## Why

SHY-0457 added a guard: a journey declared `kind: 'ui'` must touch the device
somewhere other than the sign-in preamble. The first full matrix run after it
merged found **five**:

```
J-ALICE   declared a UI journey but never touched the device outside sign-in
J-MARCUS  …
J-ADMIN   …
J05       …
J06       …
```

Every step in each of them passed. They failed at the journey level, which is
the point: **the steps were true and the journey was not**. J-MARCUS proved
"the minor persona signs in" by reading `users/60000010.cohort` out of
Firestore — an assertion a signed-OUT phone in a drawer would also have
passed.

They are not new defects. They have been passing this way for as long as they
have existed, and the guard is simply the first thing to say so.

### What each one needed

| Journey | Was | Now |
| --- | --- | --- |
| J-ALICE / J-MARCUS / J-ADMIN | sign in, then read Firestore | opens the profile and asserts the surface DIFFERS by cohort |
| J05 | buy coins, then read Firestore | reads the new balance off the wallet button |
| J06 | two API refusals, declared `ui` | declared `api-contract`, which is what it is |

The persona journeys deliberately assert something cohort-dependent — the
wallet, which SHY-0459 hides from minors. An assertion identical for every
persona would prove only that the app renders something; this one fails if the
wrong person is signed in.

J06 is declared rather than dressed up. Both its refusals happen at the
endpoint and neither has an outcome on screen: the app never offers an unknown
product, and a replayed receipt is something the SERVER notices, not something
a person can do twice from the UI. Calling it what it is keeps the guard
meaningful for journeys that are genuinely lying.

## Acceptance Criteria

### Happy path

- [ ] Every journey declared `ui` touches the device outside the sign-in
      preamble.
- [ ] The full matrix passes on a real device.

### Error paths

- [ ] A persona journey fails if the wrong person is signed in, not merely if
      the app fails to render.
- [ ] J05 fails if the balance is not shown, rather than passing on a Firestore
      read alone.

### Edge cases

- [ ] A journey with no reachable UI is declared `api-contract`, not given a
      cosmetic tap to satisfy the guard.
- [ ] The minor persona's assertion expects the wallet ABSENT, so SHY-0459
      being reverted would fail it.

### Performance

- [ ] One extra screen read per persona journey. The matrix already spends 87%
      of its time reading the screen; three more reads is noise.

### Security

- [ ] None directly, though the cohort-differentiated assertion means a
      regression in minor gating now fails a journey rather than passing
      quietly.

### UX

- [ ] None: test-harness only.

### i18n

- [ ] The wallet assertion matches on the balance separator rather than a
      translated word, so a locale change does not break it.

### Observability

- [ ] A journey that fails the guard names WHICH journey and why, as it already
      does — that message is what turned five green reports into five findings.

## BDD Scenarios

**Scenario: A journey says it walked the app**

- **Given** a journey that claims to walk the app
- **When** it runs and passes
- **Then** it actually looked at the screen

**Scenario: Somebody buys coins**

- **Given** somebody who has just bought a coin pack
- **When** they open their profile
- **Then** their new balance is shown

## Test Plan

| Layer | What it proves |
| --- | --- |
| Device (real) | The full matrix, 15/15, on the OnePlus. |
| Device (real) | The minor persona sees no wallet and the adult personas do — the same assertion, opposite answers. |
| Unit | The journey-shape suites still pass, including SHY-0457's guard itself. |

## Out of Scope

- The iOS matrix. The same guard applies there and is worth a look, but this
  story is the Android run that surfaced it.

## Dependencies

- [[SHY-0457]] — added the guard that found these.
- [[SHY-0459]] — supplies the cohort difference the persona journeys assert.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The new assertions are themselves shallow | Each one differs by persona or by outcome, so a wrong sign-in or a missing credit fails it. That is the standard SHY-0457 set. |
| J06's reclassification hides a gap | It is declared, not deleted: J05 covers the successful purchase end to end, including on screen. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The full matrix green on a real device — 15/15.

## Notes

- Found 2026-08-27 on the first full-matrix run after SHY-0457 merged. Before
  the fix: 10/15. After: **15/15**.
- The core set was 5/5 in both runs, which is why this needed the FULL matrix
  to surface. A mandatory core set is a floor, not a substitute.
