---
id: SHY-0464
status: In Review
owner: unassigned
created: 2026-08-26
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0464: Running the test suite destroys the personas the device journeys need

## User Story

As **whoever runs the tests and then the device matrix**, I want the suite to
leave the seeded personas alone, so that a green suite is not the reason the
next journey run fails.

## Why

`npm test` silently corrupts the local persona seed. Three suites mint real
users on personas' own uniqueIds, and `mintRealUser` writes with `.set()` and
no merge — so it REPLACES the document:

| Suite | uniqueId | Persona |
| --- | --- | --- |
| `livekit.test.js` | 50000010 | adult-power |
| `livekit-cohort.test.js` | 60000010 | minor-power (Marcus, P-04) |
| `livekit.test.js` | 50000020 | Lena (P-05), minted **suspended** |

A 24-key persona becomes three keys — `firebaseUid`, `uniqueId`,
`isSuspended` — and `dateOfBirth`, `cohort`, `ageVerified` and `displayName`
go with it. Observed on the local emulator:

```
users/50000010  {"firebaseUid":"rt-uid-50000010","uniqueId":50000010,"isSuspended":false}
users/60000010  {"firebaseUid":"rt-uid-60000010","uniqueId":60000010,"isSuspended":false}
```

The `rt-uid-` prefix is `mintRealUser`'s own default, which is what identifies
the writer.

Two distinct failures follow, and both were met in one session:

- **No journey can run.** The runner's pre-flight ([[SHY-0449]]) stops with
  "the seeded personas are missing their date of birth". Twice in one evening,
  each time after a full suite run.
- **A journey blames the product.** Lena is minted **suspended**, and re-seeding
  does not clear it — the seeder merges the persona's fields back and never
  writes `isSuspended`, so the flag survives every re-seed. J07 then failed with
  `Lena's reply expected 200; got 403 {"error":"Account suspended"}`, which reads
  exactly like a product defect and is not one.

Grepping for the cause of Lena's suspension did not find it. Adding the guard
below found it on the first run — which is the argument for guarding the class
rather than hunting instances.

## Acceptance Criteria

### Happy path

- [ ] A full `npm test` leaves every seeded persona document intact — same
      field count, `dateOfBirth`, `cohort` and `ageVerified` unchanged.
- [ ] A device journey run immediately after a full suite run passes its
      seed pre-flight with no re-seed.

### Error paths

- [ ] Minting on a seeded persona's uniqueId fails loudly, naming the persona
      and saying why, rather than silently replacing the document.

### Edge cases

- [ ] The refusal list is read from the persona registry the seeder itself
      uses, so a persona added later is covered without anybody remembering.
- [ ] No suite leaves a SUSPENDED user document behind for the next suite or
      the next journey to meet.

### Performance

- [ ] The guard is a set lookup on data already in memory — no extra read per
      mint.

### Security

- [ ] The guard refuses rather than merges. Merging would leave one test's
      state inside another's fixture, which is the isolation failure this
      ticket is about, in the other direction.

### UX

- [ ] The error tells the reader what to do — "pick an id outside the persona
      registry" — not merely that something was refused.

### i18n

- [ ] None: developer-facing tooling.

### Observability

- [ ] The failure names the offending uniqueId, so the site is findable from
      the message alone.

## BDD Scenarios

**Scenario: The suite leaves the seed alone**

- **Given** a freshly seeded local stack
- **When** the whole test suite runs
- **Then** the personas still have their dates of birth

**Scenario: A suite tries to mint on a persona**

- **Given** a test asking for a seeded persona's uniqueId
- **When** it mints that user
- **Then** it is refused, and told which persona it would have destroyed

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | `mintRealUser` refuses every uniqueId in the registry. |
| Suite | A full run leaves the persona documents byte-intact. |
| Device | A journey run straight after a suite run clears its pre-flight. |

## Out of Scope

- Making the seeder authoritative over `isSuspended`. It is the reason a stale
  suspension survives a re-seed, and it deserves its own decision: a seeder
  that resets moderation state would also wipe a state somebody is mid-way
  through testing.

## Dependencies

- [[SHY-0449]] — the pre-flight that turned this from twelve mystery failures
  into one clear message.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A suite genuinely needs a persona's id | None does; all three uses were incidental. The refusal names the alternative. |
| The registry and the guard drift | The guard imports the registry rather than restating it. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A full suite run followed by a journey run, with no re-seed in between.

## Notes

- Filed 2026-08-26, found while device-proving [[SHY-0461]]: the journey
  pre-flight refused to start, twice, after full suite runs.
