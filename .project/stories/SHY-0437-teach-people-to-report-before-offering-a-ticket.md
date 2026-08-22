---
id: SHY-0437
status: Draft
owner: claude
created: 2026-08-22
priority: P1
effort: L
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0437: Show people how to report, before offering them a ticket

## User Story

As **somebody who wants to report another person**, I want to be shown how to do
it properly, so that my report reaches the moderation queue instead of sitting in
a support inbox.

## Why

"Safety & another user" is currently a support category like any other: choose
it, type, send. That is the wrong destination. **The support queue is not a
reporting system.** A report raised there:

- does not enter the moderation queue, so it is not triaged by urgency;
- carries no `reportedUserId`, so it cannot be actioned, counted toward a repeat
  pattern, or resolved against the person it concerns;
- is answered by whoever picks up support, not by moderation;
- and, since SHY-0436, is on a deletion clock designed for support requests.

Somebody in genuine distress picks the option that says "Safety", and the least
effective route is the one we offered them.

**Operator, 2026-08-22:** *"the support ticket system is not designed for
reporting someone. Therefore, instead of allowing them to submit a ticket when
they choose that option, we give them step-by-step guide, with images or a
video, showing them how to make reports in all the different ways. After that,
they can still choose to submit a support ticket, if they're having problems
trying to report."*

The escape hatch matters as much as the guide. Somebody who cannot make the
report — the person blocked them, the message is gone, the interface defeated
them — must not be left with nowhere to go. They raise a ticket and an admin
files the report for them (SHY-0438).

## The ways to report, as they actually exist today

Verified in the code on 2026-08-22:

| What | Where | Component |
| --- | --- | --- |
| A person | Their profile | `ProfileScreen` → `ReportUserDialog` |
| A person | Their card inside a room | `UserCardPopup` → `ReportUserDialog` |
| A message | In a room | `RoomScreen` → `ReportMessageDialog` |
| A message | In a private chat | `PrivateChatScreen` → `ReportMessageDialog` |

Reasons offered: Spam, Harassment, Inappropriate Content, Other.

## ⚠️ A room cannot be reported

The instruction says the closing message should tell people it is better to
report *"the user, message or room directly"*. **There is no way to report a
room.** `reportRoom`, `report_room`, `reportedRoom` and `roomReport` return zero
matches across the app, the API and the admin dashboard.

So this ticket cannot teach it, and SHY-0439's copy would be telling people to do
something the app does not let them do. Filed as SHY-0440 for a decision: either
build room reporting, or drop "room" from the copy. **The guide must only teach
routes that exist.**

## Acceptance Criteria

### Happy path

- [ ] Choosing "Safety & another user" shows the guide instead of the message
      form.
- [ ] The guide covers every route that actually exists, each as a numbered step
      with an image or a short video of the real screen.
- [ ] After the guide, somebody can still choose to raise a ticket, and that
      choice is clearly for "I tried and could not".
- [ ] Choosing to raise a ticket anyway lands on the normal form, still in the
      safety category.

### Error paths

- [ ] A guide asset that fails to load still leaves the steps readable as text —
      the instructions never depend on an image arriving.
- [ ] Nothing about the guide can trap somebody: leaving is always available.

### Edge cases

- [ ] Somebody who arrives at support ALREADY in the safety category (from a
      deep link or a previous session) sees the guide too, not the form.
- [ ] Switching away from safety to another category shows the normal form
      immediately.
- [ ] Switching back to safety shows the guide again, not a remembered
      "dismissed" state — somebody who has not read it has not read it.
- [ ] The guide works with the keyboard closed and does not fight the layout
      when it opens (SHY-0419, SHY-0428).
- [ ] Holds for a minor's account, where some routes may differ.

### Performance

- [ ] Guide media is sized for a phone and does not delay the screen appearing;
      text renders first.
- [ ] No video autoplays with sound.

### Security

- [ ] The guide contains no real person's name, avatar or message. Every example
      is fabricated.

### UX

- [ ] The guide reads as help, not as an obstacle placed in front of a form.
- [ ] The route to a ticket is visible from the start, not hidden behind
      finishing the guide — somebody in distress must never feel trapped.
- [ ] Steps are usable by somebody who cannot see the images: each is written so
      the text alone is sufficient.

### i18n

- [ ] Every string is translated for all five MVP locales.
- [ ] Screenshots either carry no embedded text, or exist per locale — an
      English screenshot inside Vietnamese instructions is not a guide.
- [ ] Holds under right-to-left layout.

### Observability

- [ ] We can tell how many people saw the guide and went on to report, versus
      raised a ticket anyway. That ratio is how we learn whether the guide works.

## BDD Scenarios

**Scenario: Being shown the way**

- **Given** somebody who chooses "Safety & another user"
- **When** the screen opens
- **Then** they are shown, step by step, how to report the person or message

**Scenario: When reporting did not work**

- **Given** somebody who read the guide and still could not report
- **When** they choose to contact support anyway
- **Then** they can write their request as normal

**Scenario: Nothing else changes**

- **Given** somebody who chooses any other category
- **When** the screen opens
- **Then** they get the message form straight away

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Choosing safety yields the guide state; choosing anything else yields the form; switching back re-shows the guide. |
| Content | Every route the guide teaches resolves to a real entry point in the app — a guide step naming a control that does not exist fails. |
| Device | On both phones: choose safety, read the guide, follow one route end to end and see the report land in the moderation queue. |
| Escape hatch | From the guide, reach the form and raise a ticket in the safety category. |
| i18n | The guide renders in all five locales without clipping. |

## Out of Scope

- Admin conversion of a ticket into a report — SHY-0438.
- The closed-and-cannot-reopen state — SHY-0439.
- Building room reporting — SHY-0440.
- Changing the report flows themselves.

## Dependencies

- **SHY-0440 must be decided first**, because it determines whether the guide has
  three routes or four.
- SHY-0438 and SHY-0439 complete the loop; this story is useful without them but
  the escape hatch is only honest once an admin can act on it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The guide reads as a wall between somebody in distress and help | The route to a ticket is visible throughout, not gated behind finishing. |
| Screenshots go stale as the app changes and teach the wrong taps | Prefer short recordings of the real flow, and add a check that every control the guide names still exists. |
| People skip the guide and raise tickets anyway, so nothing improves | Measured explicitly; the ratio is the acceptance signal, not the existence of the screen. |
| The guide is English-only in practice | Assets are per-locale or text-free; asserted by test. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on both real devices: guide shown, a real report filed by following
      it, and the escape hatch reaching a ticket.
- [ ] Every locale checked.

## Notes

- Operator, 2026-08-22 — quoted in full above.
- This is the first support category that does not lead straight to the form, so
  the form's state machine gains a genuine branch. Worth doing carefully: the
  category selector currently has no concept of a category that changes the
  screen.
