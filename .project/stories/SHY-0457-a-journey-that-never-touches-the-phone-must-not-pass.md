---
id: SHY-0457
status: In Progress
owner: unassigned
created: 2026-08-25
priority: P0
effort: L
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0457: A journey that never touches the phone must not pass

## User Story

As **whoever reads a green journey report**, I want a journey that never used the
app to fail, so that "15/15 on both devices" means the product was exercised
rather than that some true statements were made near a phone.

## Why

Operator, 2026-08-25, reading the sign-off evidence:

> "j07 is showing as pass.. but there's 20+ screenshots of just empty room
> list.. so how is it green?"
>
> "fix all 5 and any more. I am deeply concerned on how assertions can be
> passing. this means the testing is massively unreliable"

Because J07 never touched the phone. It signed in, then minted tokens, called
the API and read Firestore. Four consecutive screenshots were **byte-identical**;
six distinct images across eleven steps. Every assertion it made was TRUE —
Alice really did follow Lena, the messages really were in Firestore. It simply
never asked the product to do anything, so a completely broken UI would have
reported the same 15/15.

It was not one journey:

| Journey | Claim | Distinct frames |
| --- | --- | --- |
| J11 | report → suspend → appeal → unsuspend | **3 of 9** |
| J12 | admin reaches moderation queues | **3 of 8** |
| J04 | cohort-override is staff-only | 4 of 8 |
| J08 | cross-cohort wall holds | 5 of 9 |
| J07 | social: follow + PM round-trip | 6 of 11 |
| J38 | support (a real walk, for contrast) | **15 of 15** |

The mechanism is structural: a step passes whenever its body does not throw, so
a body with no comparison in it is **incapable of failing**. Two of the five
(J07, J08) were in the core set introduced by [[SHY-0456]] and reported as proven.

## Acceptance Criteria

### Happy path

- [x] The runner counts real UI operations — taps, typing — per step.
- [x] A journey declaring `kind: 'ui'` that performs none outside its sign-in
      preamble FAILS, whatever its own steps asserted.
- [ ] J07, J08, J11 and J12 drive the screens they claim to cover.

### Error paths

- [x] The failure names the journey and says what to do about it.
- [x] Signing in does not count. Logging in is not evidence the FEATURE works.
- [x] A FAILED step does not count as touching the UI — taps that led nowhere
      are not proof.

### Edge cases

- [x] A missing `uiOps` reads as zero, never as "unknown, therefore fine".
- [x] Reading the screen does not count. A dump is an observation, not a use.
- [x] A journey whose feature genuinely has no app UI declares
      `kind: 'api-contract'` and its title says so. J04 is the only one.
- [ ] A step that records a FINDING must not pass (J02's
      `FINDING: minor UI is NOT feature-hidden`, operator decision: make it fail).

### Performance

- [x] A counter increment per tap. No measurable cost.

### Security

- [x] J08 and J11 cover safeguarding paths — the cross-cohort wall and the
      moderation cycle. Those are the two this defect was hiding.

### UX

- [x] The report records `uiOps` per step, so a reader can see what a journey
      did rather than infer it from a green tick.

### i18n

- [x] No user-facing strings.

### Observability

- [x] `uiOps` and `preamble` are in the report JSON.

## BDD Scenarios

**Scenario: A journey asserts only against the server**

- **Given** a journey that signs in and then only calls the API
- **When** the matrix runs it
- **Then** the journey fails
- **And** the report says it never touched the device outside sign-in

**Scenario: A feature with no screen of its own**

- **Given** a journey whose feature exists only in the back office
- **When** the matrix runs it
- **Then** it passes as a declared API contract
- **And** its title does not claim a device walk

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | A UI journey with zero non-preamble UI ops is rejected. |
| Unit | The sign-in preamble does not count, however many taps it makes. |
| Unit | A failed step does not count; a missing counter reads as zero. |
| Unit | Every journey declares a kind from a closed set. |
| Unit | An api-contract journey's title says so — asserted non-vacuously. |
| Device | J07/J08/J11/J12 fail before conversion; J04 passes as a contract. |
| Device | After conversion, all four pass by driving real screens. |

## Out of Scope

- Converting journeys to cover MORE than they claim today. Each one drives the
  screens its existing title already promises, no more.

## Dependencies

- Builds on [[SHY-0456]], whose core set contained two of the affected journeys.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A journey is declared api-contract to dodge the guard | The title must say so, asserted by test, and the set is small enough to review. |
| The counter is bypassed by a new tap route | Counted once in `tapResolved`, above every click backend, with a source anchor test. |
| Converted journeys become slow | They drive only the screens their title already claims. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [x] Guard demonstrated on a real device: the four fail, J04 passes.
- [ ] All four converted and passing by driving real screens on both devices.

## Notes

- Filed 2026-08-25 after the operator caught it in the SHY-0456 sign-off
  evidence. The guard landed first because it defines what "converted" means.
