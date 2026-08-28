---
id: SHY-0489
status: Draft
owner: unassigned
created: 2026-08-28
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0489: Re-seeding dev personas does not clear moderation state

## User Story

As **whoever re-seeds the dev personas**, I want them returned to a known state,
so that a fixture restored from the seeder is actually restored.

## Why

`provision-test-personas.js` upserts each persona's identity fields. It never
writes `hasActiveWarning`, `warningReason` or `isSuspended` — so it neither seeds
them **nor clears them**.

A moderation journey that warns or suspends a persona therefore leaves that state
on dev **permanently**. Re-seeding looks like it restores the fixture and does
not.

Found 2026-08-28: `host@shytalk.dev` (50000060) carried
`hasActiveWarning: true`, reason *"Inappropriate language in voice ro…"*, from an
earlier moderation walk. Because the app persists the session and the nav graph
routes a warned user to `Screen.Warning` on launch, **every** journey — not only
that persona's — found the warning screen instead of the sign-in picker. One
persona's leftover state blocked the whole matrix.

That is the shape of defect this repository has already been bitten by twice: a
shared fixture that can be written by a test and not restored by its seeder.

## Acceptance Criteria

### Happy path

- [ ] Re-seeding returns every persona to a known moderation state.
- [ ] A persona warned by a journey is clean after the next seed.

### Error paths

- [ ] A persona the seeder does not own is never touched — the script's
      prod-safety assertion and seeded-id scoping are unchanged.

### Edge cases

- [ ] A suspended persona is un-suspended by a re-seed.
- [ ] A persona deliberately seeded INTO a moderation state (if any is ever
      added) is honoured rather than blanket-cleared.

### Performance

- [ ] Same number of writes: the fields join the existing upsert.

### Security

- [ ] Clearing is limited to the seeded persona registry. It is not a
      moderation-bypass tool.

### UX

- [ ] None.

### i18n

- [ ] None.

### Observability

- [ ] The seed report says how many personas had moderation state cleared, so a
      surprising number is visible rather than silent.

## BDD Scenarios

**Scenario: Restoring the test accounts**

- **Given** a test account left with a warning by an earlier test
- **When** the test accounts are restored
- **Then** it no longer has the warning

## Test Plan

| Layer | What it proves |
| --- | --- |
| Script test | The upsert includes the moderation fields. |
| Script test | Non-seeded ids are untouched. |
| Live (dev) | A persona warned on purpose is clean after a re-seed. |

## Out of Scope

- Journey-level cleanup of other dev debris (rooms, conversations). Separate
  concern; this is about the persona fixture only.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** clearing suspension hides a real moderation bug on dev.
  **Mitigation:** it applies only to the seeded persona registry, which exists
  to be reset; real accounts are out of its scope by construction.

## Definition of Done

- [ ] Moderation fields are part of the persona upsert.
- [ ] A warned persona is clean after a re-seed, proven on dev.

## Notes

Filed **Draft**: the fix is small, but "what is a persona's known state" is worth
one deliberate decision rather than an assumption — in particular whether any
persona should be seeded warned or suspended on purpose, which would make a
blanket clear wrong.
