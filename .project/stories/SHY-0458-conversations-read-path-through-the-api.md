---
id: SHY-0458
status: In Progress
owner: unassigned
created: 2026-08-25
priority: P0
effort: L
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0006
---

# SHY-0458: The conversations read path goes through the API, and private messaging works again

## User Story

As **anyone who wants to message somebody for the first time**, I want the app
to reach conversations through the API like everything else, so that starting a
conversation works at all — and so that who may read it is decided by the
server rather than by rules evaluated on my phone.

## Why

Private messaging is **completely broken on the client**. Found on 2026-08-25
by rewriting J07 to actually drive the phone (SHY-0457), and confirmed against
the emulator with a real token:

```
GET /conversations/50000010_50000020  (does not exist yet) -> 403
   "evaluation error at L355:21 for 'get' @ L355, Null value error."
GET /conversations/officia-50000030   (exists, not mine)   -> 403 "false"   <- correct
GET /users/50000010                   (my own doc)         -> 200           <- token fine
```

`firestore.rules:355` dereferences `resource.data.participantIds` with no null
guard, so reading a conversation that **does not exist yet** is a rules
evaluation error, not a miss. `getOrCreateConversation` opens with exactly that
read, so it can never get past it: no conversation is ever created, and
`PrivateChatViewModel.sendMessage` then returns silently on the empty
`conversationId` while the composable clears the input. A person types a
message, presses send, and watches it vanish with no error at all.

The client is **half-migrated**, which is why this was invisible: sending
already goes through `api.post("/api/conversations/{id}/messages")`, where the
Admin SDK bypasses rules and works. Listing and get-or-create stayed on the
client, where rules apply — so the migrated half worked and carried none of the
risk, and the unmigrated half carried all of it.

Nothing caught it because the old J07 created the conversation document itself
with the Admin SDK, then asserted over the API. Fifteen of fifteen, on a
feature that cannot be started.

Operator, 2026-08-25: *"nothing should be read directly! this is a major issue.
we should always be using the API. that's what it's there for."* — and, for the
live path, **SSE** ([[SHY-0169]] ratified).

## Acceptance Criteria

### Happy path

- [ ] `GET /api/conversations` returns the caller's conversations, newest first.
- [ ] `POST /api/conversations` returns the 1:1 conversation with another user,
      creating it if it does not exist.
- [ ] `GET /api/conversations/stream` pushes changes over SSE so the list and an
      open chat stay live without the client holding a Firestore listener.
- [ ] Android and iOS use these instead of Firestore for the conversation read
      path.
- [ ] A person can start a brand-new conversation, send, and see the reply.

### Error paths

- [ ] A conversation that does not exist is a **404**, never a rules evaluation
      error. That distinction is the whole defect.
- [ ] `sendMessage` with no conversation surfaces an error instead of returning
      silently while the input is cleared.
- [ ] A dropped SSE connection reconnects; a refused one surfaces rather than
      leaving a dead-looking screen.

### Edge cases

- [ ] Requesting a conversation with yourself is rejected.
- [ ] A conversation the caller does not participate in is 404 (not 403 — do not
      confirm existence).
- [ ] `participantIds` are strings; the caller's `uniqueId` claim is a number.
      Both endpoints coerce, as the existing message routes already document.

### Performance

- [ ] The list is paginated and ordered server-side.
- [ ] One SSE connection serves the conversation list; it is not one per thread.

### Security

- [ ] Cross-cohort pairs are refused at creation, and `crossCohortAtMigration`
      threads stay hidden — the same gates `requireSameCohort` and the existing
      read gate already apply, evaluated **server-side**.
- [ ] Authorization is re-checked per SSE fan-out, not only at subscribe: a
      suspension or cohort change mid-stream must stop delivery.
- [ ] The ratchet baseline shrinks by the sites this story removes. It must
      never grow.

### UX

- [ ] Starting a conversation shows either the chat or a reason. Never silence.

### i18n

- [ ] Any new user-facing string ships in all 21 locales.

### Observability

- [ ] Refused reads log the caller, the conversation and the reason.

## BDD Scenarios

**Scenario: Somebody messages a person for the first time**

- **Given** two adults who have never spoken
- **When** one of them opens the other's chat and sends a message
- **Then** the message appears in the conversation
- **And** the other person receives it

**Scenario: A message that cannot be sent says so**

- **Given** a chat that could not be opened
- **When** the person presses send
- **Then** they are told it could not be sent
- **And** the text they typed is still there

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | List returns only the caller's conversations; excludes migrated cross-cohort. |
| Unit | Get-or-create returns the existing thread, creates when absent, refuses self. |
| Unit | A non-participant gets 404, not 403. |
| Unit | Cross-cohort pairs are refused at creation. |
| Unit | SSE re-checks authorization per fan-out, not only at subscribe. |
| Device | J07 on the OnePlus and the iPhone: first-time conversation, send, reply. |
| Device | The ratchet baseline shrinks and the checker still passes. |

## Out of Scope

- The other 30 direct-access sites. They are [[EPIC-0006]]'s remaining stories
  and are sequenced behind this one, which proves the SSE pattern.
- Removing the `firestore.rules` conversation rules. They stay as defence in
  depth once the client no longer connects.

## Dependencies

- [[SHY-0169]] — SSE ratified 2026-08-25. This story is its first implementation.
- [[SHY-0457]] — the guard that made the defect visible.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| SSE turns out unworkable on one platform | This story is deliberately the first, on the smallest surface, so the pattern is proven before the other 30 sites adopt it. |
| Express holds many long-lived connections | One stream per signed-in client, not per thread; measured on device before the pattern spreads. |
| The rules bug is left in place | The rules keep denying non-existent reads, which is now harmless because no client reads them — and a later story tightens them to deny-by-default. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] J07 green on both real devices, driving the real screens.
- [ ] `check-no-direct-backend.js` baseline reduced, never increased.

## Notes

- Filed 2026-08-25 mid-investigation. The P0 it fixes was found by making a
  journey real, which is the whole argument for [[SHY-0457]].
