---
id: SHY-0470
status: Draft
owner: unassigned
created: 2026-08-27
priority: P3
effort: S
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0470: The moderation-queue client API has no caller

## User Story

As **whoever maintains the report repository**, I want its methods to have
callers or to be gone, so that nobody spends time keeping an API working that
nothing asks for.

## Why

SHY-0460 removed `ReportReviewScreen`, which was the only caller of two
repository methods:

| Method | Implemented in | Tested by |
| --- | --- | --- |
| `getPendingReports()` | `ReportRepositoryImpl` (Android), `IosSmallRepositories` (iOS) | `ReportRepositoryImplTest` (3 cases) |
| `resolveReport()` | both | `ReportRepositoryImplTest` (6 cases) |

They are not broken and not dead weight at runtime — they are simply
unreferenced. The moderation queue a human works through is the web admin
console, which calls the Express endpoints directly and is unaffected either
way.

They were left out of SHY-0460 deliberately. That story's acceptance criteria
named the leftovers that made an unreachable screen LOOK reachable — the
`Screen` entry and the nav registrations — and these sit a layer below that.
Sweeping them in would have widened a scoped removal on the day, which is how a
removal turns into a refactor nobody reviewed.

The decision is a small one and it is genuinely open, which is why this is a
ticket rather than a deletion:

- **Remove them** if in-app moderation is not coming back. Two implementations,
  nine tests, and an interface method go with them.
- **Keep them** if it is. They already work, and `resolveReport` in particular
  carries the warning/suspension outcome parsing that any future in-app
  moderation would need.

## Acceptance Criteria

### Happy path

- [ ] Either both methods have a caller, or they and their implementations,
      interface entries and tests are gone.

### Error paths

- [ ] If they are removed, `ResolveReportOutcome` and any parsing that exists
      only for them goes too, rather than being left as the next orphan.

### Edge cases

- [ ] The web admin console is unaffected either way — it calls the Express
      endpoints, not this client API. Verified, not assumed.
- [ ] `FakeReportRepository` and the test doubles that implement the interface
      are updated in step, so the androidTest source set still compiles.

### Performance

- [ ] None: nothing calls them, so nothing gets faster or slower.

### Security

- [ ] Removing client methods does not touch the Express endpoints or their
      `requireAdmin` gate, which J12 covers and which stays.

### UX

- [ ] None: no user-facing surface either way.

### i18n

- [ ] None.

### Observability

- [ ] If kept, a comment says WHAT is expected to call them, so the next person
      does not have to re-derive that nothing does.

## BDD Scenarios

**Scenario: A moderator reviews reports**

- **Given** a moderator with reports to work through
- **When** they open the moderation queue
- **Then** they use the web admin console, as they do today

**Scenario: Someone reads the report repository**

- **Given** a developer opening the report repository
- **When** they look at what calls each method
- **Then** every method has a caller, or is not there

## Test Plan

| Layer | What it proves |
| --- | --- |
| Compile | The interface, both platform implementations and every test double agree after the change. |
| Unit | If kept, the existing nine cases still pass. If removed, they go with the methods rather than being left testing nothing. |
| Grep | No reference survives in either source set — the check SHY-0460's sweep used. |

## Out of Scope

- The Express endpoints. They serve the web admin console and stay.
- Rebuilding in-app moderation. That is a product decision, not this chore.

## Dependencies

- [[SHY-0460]] — removed the screen that was the only caller.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Removing something a future feature wants | The Express endpoints remain; a future screen would re-add a thin client method against an API that already exists. |
| Removal breaks the androidTest source set | That set has already been silently un-compilable once (SHY-0466 §). The AC requires the doubles to be updated in step and the set to compile. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A grep for both method names returns callers, or returns nothing at all.

## Notes

- Filed 2026-08-27 while removing the screen in SHY-0460, rather than after
  somebody re-derived that nothing calls these.
- P3: nothing is broken and nothing is exposed. It is tidiness with a decision
  attached.
