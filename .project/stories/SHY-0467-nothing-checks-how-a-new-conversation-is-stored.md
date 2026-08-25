---
id: SHY-0467
status: Draft
owner: unassigned
created: 2026-08-26
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0467: Nothing checks how a new conversation is stored

## User Story

As **whoever changes private messaging next**, I want the shape a new
conversation is written in to be asserted somewhere, so that the two defects
that shape has already caused cannot come back unnoticed.

## Why

Four tests fail on every run:

```
PrivateMessageRepositoryImplTest > getOrCreateConversation returns Success when creating new
PrivateMessageRepositoryImplTest > getOrCreateConversation returns Success when existing
PrivateMessageRepositoryImplTest > getOrCreateConversation stores participantIds as String values
PrivateMessageRepositoryImplTest > getOrCreateConversation stores participantIds sorted regardless of argument order
```

They are not finding a product defect. SHY-0458 moved this call off Firestore:

```kotlin
val json = api.post("/api/conversations", body)
```

The tests still mock the Firestore write it used to do — `mockDocRef.set(...)`,
`mockDocSnapshot.exists()` — and read their assertions out of a `slot` that is
now never captured. They sit under a comment that says what they were:
`// region getOrCreateConversation — direct Firestore`.

**They are stale. They are also the only pin on two invariants that have each
already shipped as a defect.**

- **SHY-0130** — `participantIds` must be stored as **Strings**. It is the type
  `firestore.rules` compares (`string(callerUniqueId()) in
  resource.data.participantIds`), the type the model uses, and the type iOS and
  Express write. When Android wrote Longs, the threads it created were
  unreadable by the rule.
- **SHY-0132** — a new thread must be stamped `crossCohortAtMigration: false`.
  The flag gates a **cross-cohort leak**: an adult and a minor sharing a thread
  metadata surface. Safeguarding, not cosmetics.

The server does both correctly today:

```js
participantIds: [callerId, otherId].sort(),   // both String(...)
crossCohortAtMigration: false,
```

But no test says so. What exists only looks like it does:

| Where | What it actually proves |
| --- | --- |
| `conversations-read-path.test.js:175` | `participantIds.map(String).sort()` — **coerces before comparing**, so it passes identically whether Strings or Numbers were stored. This is the SHY-0130 bug, and this assertion cannot see it. |
| `conversations-read-path.test.js:176` | `state.written.length` — how MANY documents, never what is IN them. The fake records `{path, data}`; the data is simply never read. |
| `conversations-cohort.test.js:198` | `crossCohortAtMigration: false` as a **fixture** on a read test. Nothing asserts the create path writes it. |
| `conversations-age-gate.test.js:50` | String `participantIds` as a **fixture**, for the same reason. |
| `migrate-participant-ids.test.js` | Real type assertions — on the MIGRATION script, a different code path. |

So the client-side pin is red and about to be deleted or rewritten, and the
server-side pin that should replace it does not exist. Delete the four tests
without replacing them and both invariants become unguarded in the same commit.

Two of the four also fail with a bare `assertTrue(result is Resource.Success)`
and no message, so the failure says only `java.lang.AssertionError`. A reader
learns nothing from the run and has to open the file.

## Acceptance Criteria

### Happy path

- [ ] The four tests assert what the client actually does now — it asks the API
      for the conversation — and pass.
- [ ] A test asserts the document the server WRITES when a conversation is
      created, read from the recorded write rather than from the response.

### Error paths

- [ ] Every assertion that can fail says what it expected, so a failing run is
      readable without opening the test.
- [ ] A create that the server refuses still writes nothing, and that is
      asserted from the recorded writes.

### Edge cases

- [ ] The type assertion fails if `participantIds` are stored as numbers.
      Coercing the value before comparing it does not count.
- [ ] The order assertion fails if the pair is stored unsorted, whichever order
      the caller passed them in.
- [ ] The stamp assertion fails if `crossCohortAtMigration` is missing, not only
      if it is `true`.

### Performance

- [ ] No new emulator round trip: the fake already records every write, so the
      assertions read state that is in memory.

### Security

- [ ] The `crossCohortAtMigration: false` stamp on a newly created thread is
      asserted, because that flag is what keeps an adult and a minor out of a
      shared thread (SHY-0132).
- [ ] The cross-cohort refusal keeps its existing assertion that nothing was
      written at all.

### UX

- [ ] None: internal test coverage, no user-facing surface.

### i18n

- [ ] None.

### Observability

- [ ] A failure names the offending value — the type or the order actually
      stored — rather than reporting only that a boolean was false.

## BDD Scenarios

**Scenario: Someone opens a chat with another person for the first time**

- **Given** two people who have never messaged
- **When** one of them opens a chat with the other
- **Then** the conversation is stored in the shape both apps and the rules expect

**Scenario: The stored shape drifts**

- **Given** a change that stores the pair of people differently
- **When** the tests run
- **Then** they fail, and name what was stored instead

## Test Plan

| Layer | What it proves |
| --- | --- |
| Android unit | `getOrCreateConversation` asks the API and returns what it answers; no Firestore write is expected of it any more. |
| Express route | The written document has String `participantIds`, sorted, and `crossCohortAtMigration: false`. |
| Express route | Numbers, an unsorted pair, or a missing stamp each fail the assertion — proven by mutating the route, not by reading it. |
| Express route | A refused cross-cohort create writes nothing. |

## Out of Scope

- Changing what the server writes. It is already correct; this story is about
  the fact that nothing would notice if it stopped being.
- The other three suites failing on this branch
  (`check-no-new-stubs`, `device-journey-parallel-isolation`,
  `drivers/ios-session-recovery`, `drivers/journey-device-parity`) — unrelated,
  and `check-no-new-stubs` belongs to SHY-0169 / SHY-0458.

## Dependencies

- [[SHY-0458]] — moved the write to the API and left these tests behind.
- [[SHY-0130]] — the String type these tests were written to pin.
- [[SHY-0132]] — the cross-cohort stamp they also pin.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The four tests are simply deleted to get the suite green | The AC requires the server-side assertions to exist FIRST, so the invariant is never unguarded between the two commits. |
| The replacement assertion coerces too, and guards nothing | It must be mutation-tested: change the route to write numbers and watch it fail. A test that cannot fail is the defect this story is about. |
| The response body is asserted instead of the stored document | The AC names the recorded write specifically; the response is a projection and can be right while the stored document is wrong. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] `:app:testLocalDebugUnitTest` has no failing test in this file.
- [ ] Each new assertion demonstrated failing against a deliberately broken
      route before being trusted.

## Notes

- Filed 2026-08-26 at the operator's request, after part 19's handover flagged
  these four as unfiled debt on SHY-0458, this branch's own story.
- Proven pre-existing rather than assumed: the session's own work was stashed
  and the four reproduced identically without it.
- The reason this is P1 with a correct product behind it: the branch cannot
  present a clean pre-merge gate while they are red, and the temptation under a
  red gate is to delete the tests — which is the one outcome that leaves both
  invariants unguarded.
