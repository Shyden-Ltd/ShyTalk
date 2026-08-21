---
id: SHY-0410
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0410: The things people own, and the messages we push at them

## User Story

As **somebody who owns gifts I have been given**, I want sending one from my
backpack to have been tried before, so that what I own is really mine.

## Why

Three user-facing capabilities with no journey between them.

**The backpack** — `GET /users/:uniqueId/backpack` and
`POST /economy/backpack-send`. People accumulate gifts and send them on. Neither
reading the backpack nor sending from it appears in 610 scenarios. Gifting
itself is well covered (`j01`, `j05`, `j15`, `j17`) — all of it *buying* a gift
and sending it. Sending something already owned is a different path with
different arithmetic, and nobody has walked it.

**Trials** — `POST /economy/trial-claim` and `POST /economy/trial-activate`. A
claim-then-activate pair, unwalked. Anything with two steps has a state between
them, and an unwalked state between two steps is where somebody ends up having
claimed something they cannot activate.

**Banners** — `GET /banners/active` is read by **every member's app**;
`/admin/banners` publishes, reorders, edits and deletes them. Nobody has ever
published a banner and seen it appear. The 48 corpus hits for "banner" are all
in-app cohort and frozen-conversation banners — a different feature entirely.

Reorder is worth its own mention: an ordering endpoint with no test is an
ordering that will silently stop being an ordering.

## Acceptance Criteria

### Happy path

- [ ] Somebody opens their backpack and sees the gifts they own.
- [ ] Sending one from the backpack removes it from theirs and gives it to the
      recipient.
- [ ] The recipient sees it arrive.
- [ ] Claiming a trial, then activating it, grants what it promises.
- [ ] An admin publishes a banner and members see it.
- [ ] An admin reorders banners and members see the new order.

### Error paths

- [ ] Sending a gift that is not in the backpack is refused.
- [ ] Sending the same item twice quickly sends it once.
- [ ] Activating a trial that was never claimed is refused.
- [ ] Claiming a trial twice does not grant two.
- [ ] Deleting a banner that is being shown removes it cleanly.

### Edge cases

- [ ] An empty backpack shows an empty state rather than a blank screen.
- [ ] A backpack with more items than fit on one screen.
- [ ] A trial that has expired cannot be activated.
- [ ] No active banners at all — members see no empty banner strip.
- [ ] A banner with text in a non-Latin script renders on every platform.
- [ ] Walked on real Android **and** real iPhone.

### Performance

- [ ] The banner request does not delay the first screen.

### Security

- [ ] Nobody can read another person's backpack.
- [ ] Nobody can send a gift out of another person's backpack.
- [ ] Publishing, reordering, editing and deleting banners each refuse a
      non-admin — four separate scenarios, because "requires admin" that was
      never walked is how an admin surface leaks.
- [ ] A trial cannot be claimed on somebody else's behalf.

### UX

- [ ] It is clear what a banner is for and how to dismiss it, if it can be.

### i18n

- [ ] Banner text and backpack labels render per locale, asserted on rendered
      text.

### Observability

- [ ] Backpack sends and trial claims are auditable.

## BDD Scenarios

**Scenario: Sending something I already own**

- **Given** somebody with a gift in their backpack
- **When** they send it to another member
- **Then** the recipient has it and the sender no longer does

**Scenario: You cannot send what you do not have**

- **Given** somebody with an empty backpack
- **When** they try to send a gift from it
- **Then** they are refused

**Scenario: Somebody else's backpack is theirs**

- **Given** another member's backpack
- **When** somebody asks to see it
- **Then** they are refused

**Scenario: A trial has to be claimed before it is activated**

- **Given** somebody who has not claimed a trial
- **When** they try to activate one
- **Then** they are refused

**Scenario: A published banner reaches members**

- **Given** an admin who has published a banner
- **When** a member opens the app
- **Then** they see that banner

**Scenario: The order an admin sets is the order people see**

- **Given** an admin who has reordered the banners
- **When** a member opens the app
- **Then** the banners appear in that order

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, both devices** | Backpack send asserted on the RECIPIENT's device and the sender's remaining items — the arithmetic, not the API call. |
| Banner seam | Published by an admin, asserted on a MEMBER's screen. The publish endpoint and the read endpoint are different halves and only the journey joins them. |
| Ordering | Reorder asserted by reading the order a member sees, not the order the admin sent. |
| Trial state | Activate-without-claim and double-claim each refused, against the real store. |
| Security | Four separate admin refusals for banners; two for the backpack. |

## Out of Scope

- Changing gift, trial or banner behaviour.

## Dependencies

- A persona with items already in their backpack.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Backpack send is asserted on the sender's screen | The recipient's device is the required assertion. |
| Banner tests stop at the admin panel | The member's screen is the far end in every banner scenario. |
| Reorder is asserted by re-reading the admin list | Asserted from the member side, which is the only order that matters. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone.

## Notes

- Found 2026-08-21 in the third audit pass.
