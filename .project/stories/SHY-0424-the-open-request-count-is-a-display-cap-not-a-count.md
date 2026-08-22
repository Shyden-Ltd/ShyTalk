---
id: SHY-0424
status: Draft
owner: unassigned
created: 2026-08-22
priority: P3
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0424: "You already have 5 requests open" is a display cap, not a count

## User Story

As **somebody with a lot of open requests**, I want to be told how many I
actually have, so that the number in front of me is true.

## Why

`GET /api/support-tickets/mine/open` returns at most `MAX_OPEN_TICKETS_LISTED`
(5) tickets — a deliberate cap, because a choice screen listing twenty is
unreadable.

The client then derives its heading from the LENGTH of that list:

```kotlin
openRequestsHeading(state.openTickets.size)   // "You already have 5 requests open."
```

So somebody with eight open requests is told they have five. The cap is a
decision about how many to SHOW; it is being read as a fact about how many
EXIST.

**How it was found.** A scripted journey asserted that raising a second request
increased the open count, and it failed with *"open tickets went 5 -> 5; the
second request was refused"* — for a request that had been raised perfectly. The
test was wrong in the same way the copy is: it treated a display cap as a count.
The test now asserts the ticket exists instead. The copy still does not.

### Why it is P3

It only bites at five or more open requests, which is rare and already
pathological. Nothing is blocked and nothing is lost — the number is simply
wrong, and it is wrong in the direction of under-reporting.

It is worth fixing anyway because SHY-0396's whole point was replacing a wall
with an honest warning, and a warning that undercounts is quietly dishonest.

## Acceptance Criteria

### Happy path

- [ ] The heading states how many requests are actually open, whatever the
      display cap is.
- [ ] The listed summaries stay capped — this story changes the COUNT, not how
      many are shown.

### Error paths

- [ ] If the count cannot be determined, the copy falls back to wording that
      makes no numeric claim rather than guessing.

### Edge cases

- [ ] Above whatever bound the count query uses, the copy must not assert a
      precise number it cannot stand behind.

### Performance

- [ ] Still one bounded query. A count that scans an unbounded history is a
      worse bug than the one being fixed.

### Security

- [ ] The count remains scoped to the caller's own tickets.

### UX

- [ ] Singular and plural still read naturally.

### i18n

- [ ] All 21 locale files, asserted on rendered text, placeholders intact.

### Observability

- [ ] None needed.

## BDD Scenarios

**Scenario: The number is the real number**

- **Given** somebody with more open requests than the app lists
- **When** they open support
- **Then** they are told how many they really have

**Scenario: The list is still short**

- **Given** the same person
- **When** they look at what is shown
- **Then** they see a readable few, not all of them

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | The response carries a count that is independent of how many tickets it lists. |
| ViewModel | The heading uses the count, not the list length — the exact substitution that caused this. |
| Copy | Rendered text per locale, placeholders intact. |
| Guard | Nothing derives a user-facing count from a capped list. |

## Out of Scope

- Changing the cap itself, or how the choice screen lists tickets.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| An unbounded count query on a large history | Bound it, and word the copy so the bound is not a false precision. |
| The same substitution reappears elsewhere | The guard checks the pattern, not this one call site. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Seen on a real device with more open requests than the app lists.

## Notes

- Found on 2026-08-22 while getting the scripted j38 journey green during
  [[SHY-0396]].
- The general lesson: a limit applied for READABILITY must never be read back as
  a fact about the world. The same shape appears anywhere a `.limit()` result
  is counted.
