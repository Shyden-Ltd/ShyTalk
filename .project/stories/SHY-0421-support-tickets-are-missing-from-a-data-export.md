---
id: SHY-0421
status: Draft
owner: unassigned
created: 2026-08-22
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0421: Somebody's data export leaves out everything they told support

## User Story

As **somebody asking for a copy of my data**, I want the messages I sent support
to be in it, so that what I get is actually everything you hold about me.

## Why

`express-api/src/utils/data-export-builder.js` gathers backpack, gift wall,
transactions, warnings, conversations and their messages, rooms owned, reports
filed, suspension appeals, identity map, device bindings, suggestions and
notifications.

It does **not** gather `supportTickets`.

A support ticket is a message somebody wrote about their own account. It is
their personal data by any reading, and it is the one queue the export misses.

**This was not a decision, it was drift.** Reports and appeals are both included
— the two other user→admin queues — which shows the intent was to cover
everything somebody submits. Support tickets arrived later (SHY-0380, SHY-0385)
and nobody extended the export. SHY-0396 has since added a `messages` array of
follow-ups to the same documents, so the amount of somebody's own writing that
is missing has grown.

### Why it is a P1 rather than a tidy-up

A data export is a legal answer to a subject access request. An export that
silently omits a category of personal data is a wrong answer given with
confidence, and the person has no way to know it is incomplete. Every other
user-submitted queue is already in there, so the omission is invisible on
inspection — the export looks complete.

## Acceptance Criteria

### Happy path

- [ ] A data export includes every support ticket the person raised: the
      message, the category, when it was raised, and its status.
- [ ] It includes the follow-ups they added to a ticket (`messages`), because
      those are equally their own words.

### Error paths

- [ ] A failure gathering support tickets is recorded in the export's per-section
      status the same way `reports` and `appeals` failures already are, rather
      than producing a silently short export.

### Edge cases

- [ ] Somebody who has never contacted support gets an empty section, not a
      missing one — the difference between "nothing to show" and "we did not
      look" must be visible in the export itself.
- [ ] Tickets raised before this ships are included; nothing depends on a field
      added by this story.

### Performance

- [ ] One bounded query, consistent with the other sections.

### Security

- [ ] Only the requester's OWN tickets. A support queue holds other people's
      words, and the ownership filter is the whole safety of this section.
- [ ] The **admin's internal note** (`adminNote`) is NOT exported — it is written
      by staff about the case, not by the person, and other queues already draw
      that line. Decide it deliberately and write down why.
- [ ] Attachments are referenced, not embedded, and any link obeys the same
      expiry rules as the rest of the export.

### UX

- [ ] The section is named in plain language in the export, matching how the
      other sections read.

### i18n

- [ ] No new user-facing app strings expected. If the export adds a label, it
      goes in all 21 locale files, asserted on rendered text.

### Observability

- [ ] The export's section-status map gains `supportTickets`, so a partial export
      is diagnosable after the fact.

## BDD Scenarios

**Scenario: What I told support comes back with my data**

- **Given** somebody who has contacted support
- **When** they ask for a copy of their data
- **Then** what they wrote to support is in it

**Scenario: Nothing to show is different from not looking**

- **Given** somebody who has never contacted support
- **When** they ask for a copy of their data
- **Then** the support section is there and empty

**Scenario: Only my own words**

- **Given** two people have both contacted support
- **When** one of them exports their data
- **Then** only their own tickets are in it

## Test Plan

| Layer | What it proves |
| --- | --- |
| Builder | The support section is gathered, with follow-ups, against the real emulator. |
| Ownership | An export never contains a ticket belonging to anybody else. |
| Failure | A failing support query marks that section failed rather than shortening the export in silence. |
| Guard | Every user-submitted queue that exists is represented in the export — the check that stops the NEXT queue being forgotten the way this one was. |
| Journey | Walked as part of j23 (my data and my account), which is where this omission should have been caught. |

## Out of Scope

- Changing what an export contains for any other section.
- The reply channel and ticket lifecycle — [[SHY-0397]], [[SHY-0398]],
  [[SHY-0399]].

## Dependencies

- None. `supportTickets` already carries everything this needs.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Exporting the admin's internal note along with the person's own message | Named explicitly in the AC as excluded, with a test. |
| A future queue is forgotten the same way | The guard asserts coverage of every user-submitted queue, not just this one. |
| Attachment links outliving the export | Reuse the existing expiry, do not invent a second rule. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real export downloaded and opened, with a real ticket and a real
      follow-up visible in it.

## Notes

- Found on 2026-08-22 while sweeping for other consumers of `supportTickets`
  during [[SHY-0396]]. That sweep also found the admin panel never rendered the
  new `messages` array — the same class of miss, one surface over: a field is
  added and the places that display or export it are not revisited.
- The general lesson worth carrying: when a new user-writable field or
  collection appears, the question is not only "who writes it" but "who is
  supposed to READ it" — the admin queue, and the person's own export.
