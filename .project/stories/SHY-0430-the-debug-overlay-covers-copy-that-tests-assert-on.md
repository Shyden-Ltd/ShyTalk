---
id: SHY-0430
status: Draft
owner: claude
created: 2026-08-22
priority: P3
effort: XS
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0430: The debug overlay sits on top of the words being tested

## User Story

As **somebody testing ShyTalk on a device build**, I want the debug overlay to
stay out of the way of the screen's own copy, so that what I see on the phone is
what a real person would see.

## Why

Seen on a real OnePlus on 2026-08-22, during journey J38: the debug overlay
(top-right red panel) **overlaps the duplicate-choice screen's body text**,
partially covering the line telling somebody that sending the same problem again
puts it at the back of the queue.

That line is not decoration — it is one of SHY-0396's acceptance criteria, and
one that tests assert on. So the overlay covers exactly the words that most need
to be read on that screen.

### Why it is worth fixing rather than ignoring

- It is **debug-only**, so it never reaches a real person. That is why this is
  P3 and not higher.
- But it degrades the one check that catches what assertions cannot: a person
  watching the screen ([[UI work needs eyes]]). An overlay covering copy makes a
  screenshot or a recording *less* trustworthy than the assertions it exists to
  supplement — the worst possible direction for a debug aid.

## Acceptance Criteria

### Happy path

- [ ] The debug overlay never covers a screen's own text.

### Error paths

- [ ] N/A.

### Edge cases

- [ ] Holds on the duplicate-choice screen specifically, whose text sits high on
      the page.
- [ ] Holds in both orientations and at the largest supported font scale, where
      copy grows towards the overlay.
- [ ] Holds on the smallest supported screen.

### Performance

- [ ] No change.

### Security

- [ ] No change. The overlay must remain absent from release builds.

### UX

- [ ] On a debug build, every screen's own copy is fully readable with the overlay
      present.

### i18n

- [ ] Holds where translated copy is longest and wraps to more lines.
- [ ] Holds under right-to-left layout, where the overlay and the text swap sides.

### Observability

- [ ] No change.

## BDD Scenarios

**Scenario: Reading the screen on a test build**

- **Given** somebody looking at the duplicate-request question on a debug build
- **When** they read the screen
- **Then** every word of it is visible, with nothing drawn over it

## Test Plan

| Layer | What it proves |
| --- | --- |
| Screenshot | The duplicate-choice screen shows the full back-of-the-queue line on a device build. |
| Guard | The overlay is absent from release builds. |

## Out of Scope

- Redesigning the debug overlay's contents. This is about where it sits.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Moving the overlay makes it cover something else | Prefer a form that cannot occlude at all — collapsed by default, or a translucent strip in a reserved band — over relocating it. |
| It is dismissed as cosmetic and left | It actively undermines visual verification, which is how the navigation-bar defect (SHY-0428) was caught. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A device screenshot of the duplicate-choice screen shows the full
      back-of-the-queue line.

## Notes

- Found while re-running the SHY-0396 device journeys with screen recording, in
  the same walk that surfaced SHY-0428 and SHY-0429.
