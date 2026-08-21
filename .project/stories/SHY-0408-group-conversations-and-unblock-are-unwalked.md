---
id: SHY-0408
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0408: Group conversations are proven to have a name field

## User Story

As **somebody in a group conversation**, I want the group to have been used by
somebody before me, so that "create group" leads to a working conversation rather
than a screen that renders.

## Why

The audit found group conversations covered by **12 steps, every one of them a
render assertion**:

```gherkin
Then I should see the element with tag "groupSetup_nameField"
Then I should see the element with tag "groupSetup_createButton"
Scenario: New message screen shows search and create group
```

**Nobody ever creates a group.** Not one scenario adds members, sends a message
into a group, receives one, leaves, or removes somebody. Direct conversations are
covered properly — `j07` walks create, send, read receipts, edit, delete, offline
queue — and groups get the same product surface with none of the same proof.

Groups are also where the cohort rules get hardest. A direct conversation has two
people and one cohort boundary to check. A group has many, and somebody's cohort
can flip while they are in it — [[j04]] already proves a cohort flip ejects
somebody from a voice room; nothing says what it does to a group they are in.

### Unblock is missing too

Blocking is walked well: `j11` has Nora block Raul and lose him from discovery,
and `j04`/`j18` prove the official account cannot be blocked. **There is no
`unblock` step anywhere.** Somebody who blocks by mistake, or reconciles, has an
unproven way back — and an unblock that half-works leaves them invisible to each
other with no explanation.

## Acceptance Criteria

### Happy path — groups

- [ ] Somebody creates a group with a name and at least two other members.
- [ ] Every member's device shows the new conversation.
- [ ] A message sent in the group reaches every member.
- [ ] A member leaves; the others see them go and the group continues.
- [ ] The creator removes a member; that person loses access.

### Happy path — unblock

- [ ] Somebody unblocks a person they blocked, and the two can find each other
      and message again.

### Error paths

- [ ] Creating a group with no name is refused with a reason.
- [ ] Creating a group with no other members is refused.
- [ ] Sending to a group somebody has left is refused, not silently dropped.
- [ ] A failed group creation leaves no half-made conversation.

### Edge cases

- [ ] The maximum group size is reached and the next add is refused cleanly.
- [ ] The last member leaving — the group's end state is defined and asserted.
- [ ] The creator leaving — ownership either transfers or the group closes;
      whichever it is, it is asserted rather than discovered.
- [ ] A member whose **cohort flips** while in the group — the same eviction
      [[j04]] proves for voice rooms, asserted here.
- [ ] A blocked member and a blocker in the same group — the defined behaviour is
      asserted; this is the case most likely to be undefined today.
- [ ] Group name in a non-Latin script renders on every member's device.
- [ ] Walked on real Android **and** real iPhone, plus Web.

### Performance

- [ ] A message to a large group arrives for every member within the same bound
      direct messages already meet.

### Security

- [ ] Somebody not in the group cannot read it, by id — its own scenario.
- [ ] Somebody not the creator cannot remove members.
- [ ] A minor and an adult cannot end up in the same group — the cross-cohort
      wall [[j08]] proves for direct conversations, asserted for groups.
- [ ] An unblocked person does not regain access to anything they should not —
      unblocking restores discovery and messaging, nothing more.

### UX

- [ ] It is clear who is in the group and who created it.

### i18n

- [ ] Group system messages ("X left") render in each reader's own locale, not
      the actor's — the rule [[j18]] already pins for system PMs.

### Observability

- [ ] Group creation, joins, leaves and removals are auditable.

## BDD Scenarios

**Scenario: Making a group and using it**

- **Given** somebody with two people they can message
- **When** they create a group with both of them
- **Then** all three see the conversation and can read a message sent in it

**Scenario: Leaving a group**

- **Given** somebody in a group of three
- **When** they leave
- **Then** the others see they have gone and the group still works

**Scenario: A group is private to its members**

- **Given** a group conversation somebody is not part of
- **When** they ask for it directly
- **Then** they are refused

**Scenario: A minor and an adult cannot share a group**

- **Given** somebody creating a group
- **When** they try to add a member from the other cohort
- **Then** it is refused

**Scenario: Unblocking someone restores contact**

- **Given** somebody who has blocked another person
- **When** they unblock them
- **Then** the two can find and message each other again

**Scenario: A group system message reads in my language**

- **Given** a member whose app is in another language
- **When** somebody leaves the group
- **Then** the notice appears in the reader's language

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, all three surfaces** | Create, send, receive, leave, remove — asserted on EVERY member's device, not the creator's alone. That is the only way a fan-out bug shows up. |
| Cohort | Cross-cohort add refused, and a mid-group cohort flip handled — modelled on `j04`'s voice-room eviction and `j08`'s wall. |
| Security | Non-member read and non-creator remove are two separate refusals. |
| Boundary | Max size, last member out, creator leaves — each asserted rather than left undefined. |
| Unblock | Asserted by the two finding each other in discovery again, not by a flag flipping. |
| i18n | A leave notice asserted on rendered text in the reader's locale. |

## Out of Scope

- Changing group behaviour. Where a boundary case turns out to be undefined,
  raise it as a decision rather than inventing one while writing a test.

## Dependencies

- Three test personas that can be in a group together, and one in the other
  cohort for the refusal scenarios.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Group messaging is asserted on the sender's screen only | Every member's device is asserted; fan-out is the whole point of a group. |
| Boundary cases are skipped because behaviour is undefined | Undefined behaviour is raised as a decision, and the test then pins the decision. |
| Unblock is asserted by a database flag | Asserted through discovery and messaging actually working again. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device, a real iPhone and a browser.

## Notes

- Found 2026-08-21 in the deeper journey audit.
- Not a gap, checked and confirmed: the **web portal** has 19 Playwright specs,
  and **blocking** is walked properly by `j11`, `j04` and `j18`. Only *unblock*
  is missing.
