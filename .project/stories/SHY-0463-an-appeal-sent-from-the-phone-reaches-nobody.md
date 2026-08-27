---
id: SHY-0463
status: Done
owner: unassigned
created: 2026-08-26
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0005
released_in: v0.99.0
---

# SHY-0463: An appeal sent from the phone reaches nobody, and can only ever be sent once

## User Story

As **somebody appealing a suspension from the app**, I want my appeal to reach
a moderator with my name on it, and to be able to appeal each suspension, so
that the right to answer an accusation is real rather than nominal.

## Why

[[SHY-0461]] made the suspension screen reachable. Driving it on a real phone
immediately exposed that the screen's appeal button does not work — for two
independent reasons, both in `POST /api/users/:uniqueId/appeal`, which is the
endpoint the app calls (`UserRepositoryImpl.kt:89`).

### D1 — the appeal reaches the moderator with nobody attached to it

Two endpoints write to the SAME `suspensionAppeals` collection with DIFFERENT
schemas:

| | `POST /appeals` (reports.js) | `POST /users/:id/appeal` (users.js) |
| --- | --- | --- |
| owner field | `userId` — `req.auth.uniqueId` (**Number**) | `uniqueId` — `req.params.uniqueId` (**String**) |
| duplicate check | queries the appeals collection | reads a flag on the user doc |
| review fields | `reviewedBy`, `reviewedAt` | absent |

The admin queue reads one of them:

```js
// GET /appeals — reports.js
const uid = a.userId ?? a.user_id;
const userData = uid ? await getDoc(`users/${uid}`) : null;
```

An appeal written by the app has no `userId`, so `uid` is `undefined`,
`userData` is `null`, and the moderator is handed an appeal with
`userUniqueId: null`, `userDisplayName: null` and `suspensionReason: null`.
There is nobody to approve or deny. The admin duplicate check
(`where('userId','==',uniqueId)`) cannot see them either, so the two endpoints
do not even agree that an appeal exists.

### D2 — after one appeal, no later suspension can ever be appealed

`POST /users/:id/appeal` decides "already pending" from a flag on the USER
document, not from the appeals collection:

```js
if (userData.suspensionAppealStatus === 'pending') return res.status(409)…
```

That flag is written when an appeal is submitted and cleared in exactly ONE of
the three places that end a suspension:

| Writer | Clears `suspensionAppealStatus`? |
| --- | --- |
| `POST /users/:id/lift-suspension` (expired, client-driven) | **yes** |
| `POST /admin/users/:id/suspend` | no |
| `POST /admin/users/:id/unsuspend` | no |

So a person who appeals once carries `pending` for ever. Every later
suspension — a brand new accusation — is refused `409 Appeal already pending`,
and the appeal they are entitled to cannot be sent. Reproduced against the
local stack:

```
POST /api/users/50000050/appeal   -> 409 {"error":"Appeal already pending"}
POST /api/appeals                 -> 200 {"success":true,"appealId":"…"}
suspensionAppeals in emulator     -> 0 documents
```

The second line is the tell: the OTHER endpoint, checking the collection
rather than the flag, correctly allowed the same appeal at the same moment.

### Why it went unseen

The app reports success either way. The suspension screen clears its appeal
field and button on submit, so on the phone a 409 and a 201 look identical —
J11 recorded "appeal submitted from the phone ✓" for a request that wrote
nothing. Found by J11's DB assertion, not by its UI assertion.

For a minors-facing product with a moderation process, an appeal that reaches
nobody is a compliance problem, not a UX one — the same reasoning as
[[SHY-0461]], one layer further in.

## Acceptance Criteria

### Happy path

- [ ] An appeal submitted from the phone appears in the admin queue with the
      appellant's name, uniqueId and suspension reason attached.
- [ ] A person suspended, unsuspended, then suspended again can appeal the
      second suspension.

### Error paths

- [ ] A second appeal against the SAME live suspension is still refused 409.
      Idempotency is the point of the check; only its source of truth is wrong.
- [ ] A failed appeal submission is surfaced on the phone. The screen must not
      report success for a request the server refused.

### Edge cases

- [ ] Both endpoints agree an appeal exists: submitting through one and then
      the other is refused, in either order.
- [ ] Appeals written before this fix are still readable by the admin queue.

### Performance

- [ ] No extra round trip for the caller. The duplicate check moves from a
      document read to one indexed, limited query — the same single call the
      web endpoint already made.
- [ ] The appeal write stays one batch: the row and the user-doc mirror.

### Security

- [ ] The owner check still refuses an appeal submitted for somebody else.
- [ ] No widening: a person who is not suspended still cannot appeal.
- [ ] A non-integer owner id is refused rather than stored. `Number()` yields
      NaN silently, and a `userId: NaN` row looks present in the console while
      matching no query ever again.

### UX

- [ ] A refused appeal is visible on the phone. Clearing the field and button
      on a request the server rejected is what made this invisible for months.

### i18n

- [ ] No new strings: the suspension screen and its appeal form already ship
      in 21 locales.

### Observability

- [ ] A refused appeal is logged with the reason, so "nobody appeals" can be
      told from "nobody could".

## BDD Scenarios

**Scenario: An appeal reaches a moderator**

- **Given** somebody suspended who appeals from the app
- **When** a moderator opens the appeal queue
- **Then** the appeal is listed with their name and the reason they were suspended

**Scenario: A second suspension can also be appealed**

- **Given** somebody who appealed a previous suspension
- **When** they are suspended again and appeal
- **Then** the appeal is accepted

**Scenario: The same suspension cannot be appealed twice**

- **Given** somebody with an appeal already pending
- **When** they submit another appeal
- **Then** they are told one is already pending

## Test Plan

| Layer | What it proves |
| --- | --- |
| API | An app-submitted appeal is enriched by `GET /appeals` with a real user. |
| API | Both endpoints write one schema, and each sees the other's rows. |
| API | Suspend → appeal → unsuspend → suspend → appeal succeeds. |
| API | A second appeal against the same live suspension is 409. |
| API | Appealing for somebody else is still refused. |
| Device | J11: Raul appeals from the phone and the row exists, attributed. |

## Out of Scope

- Merging the two endpoints into one. They have different callers and different
  auth shapes; making them agree on a schema is this ticket, consolidating them
  is not.

## Dependencies

- [[SHY-0461]] — made the suspension screen reachable, which is how this was
  found. SHY-0461's Definition of Done (J11 green) cannot be met without this.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing appeal rows use the old field | The admin read already falls back (`a.userId ?? a.user_id`); the fix writes the canonical field and a migration is unnecessary for rows nobody could attribute anyway. |
| Moving the duplicate check changes idempotency | A test asserts the 409 still fires for a live pending appeal, in both directions across the two endpoints. |
| The phone keeps reporting success | Assert the client surfaces a failed submission rather than clearing the form. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] J11 green on both real devices, with the appeal row asserted.

## Notes

- Filed 2026-08-26, found while device-proving [[SHY-0461]] on the OnePlus.
