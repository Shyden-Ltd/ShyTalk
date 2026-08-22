---
id: SHY-0436
status: Draft
owner: claude
created: 2026-08-22
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0436: A closed request is deleted after seven days

## User Story

As **somebody who asked support for help**, I want what I sent to be deleted once
the matter is closed, so that my screenshots and my words are not kept longer
than they were needed.

## Why

Operator, 2026-08-22: *"closed support tickets should be deleted after 7 days,
including all attachments."*

Support tickets carry more personal data than almost anything else in ShyTalk:
free text somebody wrote while upset, screenshots of private conversations,
photographs and video **of other people**, and account or payment details they
were asked to evidence. Keeping that after the reason for holding it has ended
is exactly what storage limitation forbids.

Seven days after closure is a deliberate short tail: long enough for somebody to
say "that did not actually fix it" and for the reopen path to work, short enough
that a resolved matter stops being a standing store of other people's images.

### It must take the attachments with it

Deleting the Firestore document alone would leave the objects in storage,
referenced by nothing — the same orphan class as SHY-0434 and SHY-0435, arrived
at by a third route. The ticket's keys are the ONLY record of which objects
belong to it, so they must be collected **before** the document goes.

## ⚠️ Operator decision needed before this is built

**This may conflict with Online Safety Act record-keeping.** A support ticket in
the "Safety & another user" category is a report about another person's conduct.
Deleting it seven days after closure means:

- a repeat pattern by the same person becomes invisible — three reports across
  three months look like one report each time;
- evidence is gone if the same complaint escalates or is appealed;
- record-keeping duties for how safety reports were handled may require
  retention beyond seven days.

There is already an open legal question in this area (GDPR export vs OSA §17).
So this ticket deliberately does NOT assume the rule applies uniformly. The
options, for Shyden to choose:

1. **Seven days for everything** — simplest, matches the instruction literally,
   accepts the safety-history loss.
2. **Seven days except safety categories**, which follow the moderation
   retention period already used for reports and appeals.
3. **Seven days for the CONTENT, longer for a minimal record** — delete the
   message and every attachment on day seven, keep only category, timestamps and
   outcome, which is what pattern-detection actually needs and carries far less
   personal data.

Option 3 is what I would recommend, because it honours the instruction where it
matters — the images and the words go — while not blinding safeguarding. But it
is a decision, not a default, and nothing should be built until it is made.

## Acceptance Criteria

### Happy path

- [ ] A ticket closed more than seven days ago is deleted, together with every
      attachment on it and on any follow-up message.
- [ ] A ticket closed less than seven days ago is untouched.
- [ ] An OPEN ticket is never deleted, however old.

### Error paths

- [ ] A sweep that fails part-way is safe to re-run and never half-deletes a
      ticket, leaving attachments behind.
- [ ] A storage delete that fails leaves the ticket in place, so the orphan is
      retried rather than stranded.
- [ ] Failures are alertable; a sweep that silently stops is the failure mode
      this ticket exists to prevent.

### Edge cases

- [ ] A ticket REOPENED within the window is treated as open again, and its
      clock restarts only when it is closed once more (SHY-0399).
- [ ] Attachments added by a follow-up are deleted too, not just the original's.
- [ ] A ticket whose attachment objects are already gone still deletes cleanly.
- [ ] The window is measured from CLOSURE, not from creation.

### Performance

- [ ] The sweep is incremental and bounded, never a full-collection scan.

### Security

- [ ] The sweep touches only support tickets and only the support attachment
      prefix.
- [ ] It cannot be triggered by a user request.

### UX

- [ ] Somebody whose ticket is about to age out is not surprised by it — decide
      whether closure tells them the seven-day rule.

### i18n

- [ ] Any new user-facing copy is translated for all five MVP locales.

### Observability

- [ ] Every run reports how many tickets it considered, deleted, and how many
      attachment objects went with them.
- [ ] A deletion writes an audit entry, so "it ran" is provable without the data
      it deleted.

## BDD Scenarios

**Scenario: A finished matter does not linger**

- **Given** a support request that was closed over a week ago
- **When** the clean-up runs
- **Then** the request and everything attached to it are gone

**Scenario: Still recent**

- **Given** a support request closed two days ago
- **When** the clean-up runs
- **Then** it is left alone

**Scenario: Picked back up**

- **Given** a closed request that somebody reopened
- **When** the clean-up runs
- **Then** it is left alone, because it is open again

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Selection is by CLOSURE date and closed status; open and recently-closed tickets are excluded. |
| Integration | Against real storage: a closed, aged ticket's attachment objects are actually gone afterwards. |
| Reopen | A reopened ticket survives, and its window restarts on the next closure. |
| Follow-ups | Attachments on follow-up messages are collected too. |
| Idempotence | Re-running the sweep is safe and deletes nothing twice. |

## Out of Scope

- Uploads never attached to a ticket — SHY-0435.
- Removal of a single attachment before sending — SHY-0434.
- Retention of moderation reports and appeals, which have their own queue.

## Dependencies

- **Blocked on the operator decision above.**
- SHY-0399 (close / reopen lifecycle) defines when a ticket counts as closed.
- SHY-0434 established the attachment delete path.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Safety history is destroyed and repeat offenders become invisible | The decision above; option 3 keeps a minimal outcome record without the content. |
| The document is deleted and its attachments are orphaned | Collect the keys and delete the objects FIRST, then the document — never the other way round. |
| A reopened ticket is deleted mid-conversation | Selection is on closed status AND closure age, re-checked at delete time. |
| Seven days is measured from the wrong field | Asserted explicitly: from closure, not creation. |

## Definition of Done

- [ ] The operator decision is recorded in this ticket.
- [ ] Merged to `develop`, all checks green.
- [ ] Proven against real storage: an aged closed ticket's objects are gone.
- [ ] The retention rule is written down where a person can find it, not implied
      by a constant.

## Notes

- Operator, 2026-08-22, verbatim: *"closed support tickets should be deleted
  after 7 days, including all attachments."*
- Third route to the same orphan class as SHY-0434 and SHY-0435. Worth doing all
  three as one lifecycle rather than three separate deletes.
