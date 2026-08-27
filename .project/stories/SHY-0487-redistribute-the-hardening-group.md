---
id: SHY-0487
status: In Review
owner: unassigned
created: 2026-08-28
priority: P1
effort: S
type: refactor
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0487: A hardening group tests routes that have already moved

## User Story

As **whoever reads a route's tests**, I want a route's edge cases to live beside
its other tests, so that "what does this route do" is answered in one place
rather than in a group named after the review that produced it.

## Why

`room-mutations.test.js` carries a describe called **"Chunk C review-hardening
coverage"** — 14 tests grouped by *when they were written* rather than by *what
they test*. They cover `/name`, `/owner-returned`, `/owner-away`, `/seats/:i/move`,
`/join`, `/decline-invite` and `/close`.

Six of those seven routes have already been migrated onto real Firestore by
SHY-0481 through SHY-0485. So their edge cases are still asserted against the
**faked transaction** — a stub that called its callback once with a canned
snapshot — while the routes' main tests are real. The same route now has two
sets of tests making incompatible claims about how much they prove.

Grouping by review round also hides things. Two of the fourteen are already
covered by the migrated suites and nobody could tell without reading both files.

## What moves where

| Tests | Destination |
| --- | --- |
| `/name` non-string type | `room-settings.test.js` |
| `/seats/:i/move` — owner-seat target, moving the owner, float `toIndex`, OWNER_AWAY | `room-seats.test.js` |
| `/join` — already a participant, absent `bannedUserIds` | `room-membership.test.js` |
| `/owner-returned` idempotent, `/close` zero-participants, `/close` NaN guard | `room-lifecycle.test.js` |
| `/owner-away` (2) | stay — RTDB presence, sequenced against SHY-0103 |

Two are dropped as **duplicates** of assertions the migrated suites already make:
the `/name` 50-character boundary and `/decline-invite` on a CLOSED room.

## Acceptance Criteria

### Happy path

- [ ] Every non-duplicate hardening test runs against real Firestore, beside its
      route.
- [ ] The "Chunk C" describe is gone; its `owner-away` tests are in the
      `owner-away` describe.

### Error paths

- [ ] The NaN guard still holds: a missing `ownerLeftAt` must not compare as
      expired.
- [ ] A non-string room name is still refused.

### Edge cases

- [ ] `/join` with **no** `bannedUserIds` field is distinguished from an empty
      one — absent and empty must behave alike, and only real data shows it.
- [ ] `/close` with zero participants performs no user-document write at all.
- [ ] Each dropped duplicate is confirmed present in the destination suite
      before removal.

### Performance

- [ ] Net-neutral: the same tests, in different files.

### Security

- [ ] The move rules — owner seat protected in both directions, the owner not
      movable by a host — are proven against real data.

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] `/owner-returned`'s idempotent branch publishes no event, asserted against
      real RTDB.

## BDD Scenarios

**Scenario: Nothing to do**

- **Given** a room that is already in the state asked for
- **When** somebody asks for it again
- **Then** nothing changes and nobody is notified

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | Each relocated case against real state. |
| Count | No behaviour lost: 14 = 10 relocated + 2 duplicates + 2 left behind. |
| Full suite | Green. |

## Outcome

**14 = 10 relocated + 2 duplicates dropped + 2 left behind.**

`room-mutations.test.js` now contains **only** `owner-away` and
`disconnect-user` — 24 tests, exactly the work SHY-0103 gates. Its remaining
doubles have a single stated reason to exist.

The duplicates removed, each matched to the assertion that already covers it:

| Dropped | Already covered by |
| --- | --- |
| `/name` 200 at exactly 50 characters | `room-settings.test.js` — *"a name exactly at the limit is accepted (boundary)"* |
| `/decline-invite` 200 on a CLOSED room | `room-membership.test.js` — *"CLOSED-room cleanup: the caller can still decline after close"* |

Two relocated cases are stronger for being real:

- **`/join` with no `bannedUserIds` field at all.** The test now asserts the
  field is genuinely absent from the stored document before calling, so a ban
  check that reads `undefined` and throws — or treats absence as "everybody is
  banned" — has nowhere to hide.
- **`/close` with zero participants.** A non-participant's `currentRoomId` is
  shown untouched, rather than a batch spy shown uncalled.

## Out of Scope

- `owner-away` and `disconnect-user`. Both read RTDB presence and the SHY-0113
  umbrella sequences them against SHY-0103.

## Dependencies

- Follows SHY-0481 through SHY-0485.

## Risks & Mitigations

- **Risk:** a "duplicate" is not quite a duplicate. **Mitigation:** each is
  matched to the specific assertion that covers it, named in the PR, before
  removal.

## Definition of Done

- [ ] The Chunk C describe no longer exists.
- [ ] `room-mutations.test.js` contains only the presence-gated groups.
- [ ] Full express suite green.

## Notes

Once this lands, `room-mutations.test.js` holds nothing but `owner-away` and
`disconnect-user` — exactly the work SHY-0103 gates. The file's remaining doubles
then have a single, stated reason to exist.
