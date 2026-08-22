---
id: SHY-0432
status: Draft
owner: claude
created: 2026-08-22
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0432: A journey step can pass on data left by an earlier run

## User Story

As **whoever reads a green journey report**, I want each step to have been proven
by THIS run, so that a passing walk cannot be a walk that did nothing.

## Why

J38's step 13 ("A genuinely new problem gets through") asserts that a new ticket
exists by querying Firestore for the typed message and taking the first result:

```js
.where('message', '==', typed)   // `typed` is a fixed constant
snap.docs[0].id !== seededTicketId
```

The message is a **constant**, and J38 never cleans up. That query already
returns **two** documents — one from the 14:39 run and one from 14:08. So if the
app failed to raise the ticket at all, the leftover from a previous run would
satisfy both assertions and the step would still go green.

The test cannot currently fail for the reason it exists.

### It is getting worse, visibly

Open tickets for the iOS persona: **3** at 14:08, **5** at 14:39, **6** now. Step
1 reports the count, and the UI card caps at "and 3 more" — so the screen the
journey is about is being progressively hidden by the journey's own leftovers.

### Both platforms

Android accumulates identically; its seed message carries `Date.now()`, which
makes the SEED unique but not the typed message that step 13 matches on.

## Acceptance Criteria

### Happy path

- [ ] Step 13 passes only when THIS run created the ticket.
- [ ] Each run's assertions match data carrying that run's own marker.

### Error paths

- [ ] If the app fails to raise the ticket, step 13 FAILS, with leftovers from
      previous runs present.

### Edge cases

- [ ] Holds when both platforms run at once against one emulator.
- [ ] Holds on a database that already holds many runs' worth of leftovers.
- [ ] A run interrupted midway does not leave data that makes the NEXT run pass.

### Performance

- [ ] Cleanup does not add meaningfully to the walk.

### Security

- [ ] Cleanup touches only tickets this journey created.

### UX

- [ ] The open-requests notice stops accumulating past what the card can show,
      so the screen under test is the screen a person would see.

### i18n

- [ ] No user-facing copy changes.

### Observability

- [ ] The report states which ticket id each assertion matched, so a green step
      can be traced to the run that produced it.

## BDD Scenarios

**Scenario: A green step means this run did the work**

- **Given** a database holding tickets from earlier test runs
- **When** the journey checks that a new request was raised
- **Then** it only passes if this run's own request is the one it found

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | The journey's assertions match on a per-run marker, not a constant. |
| Mutation | With the app prevented from raising the ticket, step 13 FAILS even though leftovers exist. |
| Device | Two consecutive runs both pass, and the open-ticket count does not grow without bound. |

## Out of Scope

- Wiping the emulator between runs. The journeys should be robust to a shared,
  accumulating database — that is the condition they actually run in.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A unique marker is added but another assertion still matches broadly | Audit every `where(...)` in the journeys, not only step 13. |
| Cleanup deletes something a parallel platform run is using | Each platform already uses its own persona; scope any cleanup to the run's own marker. |
| It is dismissed because the journey passes | A test that cannot fail for its own reason is the most expensive kind of green. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Mutation-proven: with the ticket creation suppressed, step 13 fails.
- [ ] Two consecutive device runs pass without the open count growing without
      bound.

## Notes

- Found on 2026-08-22 while re-running the iOS walk with recordings. The step was
  passing; what is wrong is that it would also pass if the feature were broken.
- Related in kind to the per-platform persona split already made for these runs:
  both are about parallel, repeated runs sharing one emulator.
