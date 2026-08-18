---
id: SHY-0350
status: Draft
owner: claude
created: 2026-08-19
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0350: You cannot find anyone to message — search is refused outright

## User Story

As **someone trying to start a conversation**, I want to search for a person by
name, so that I can message somebody I am not already connected to.

## Why

**P0, MVP-blocking, and seen on a real device.** Searching for a user on the
OnePlus produced this on screen:

```
PERMISSION_DENIED:
Null value error. for 'list' @ L74
```

`L74` is the `users` read rule in `firestore.rules` — the same rule at the heart
of SHY-0338.

**Why it fails.** `PrivateMessageRepositoryImpl.searchUsers` (line 755) runs
`firestore.collection("users")` **directly from the client** with a filter. Line
74 gates that read on `cohortMatchesCaller()`, a condition on document CONTENT.
For a filtered query Firestore must decide permission from the query ALONE, and
a content-dependent condition can never be decided that way — so it refuses the
whole query. This is the genuine "rules are not filters" case (unlike SHY-0338's
`documentId in [...]`, which the engine can evaluate per named document).

**The fix already exists and is unused.** `GET /api/users/search`
(`express-api/src/routes/users.js:479`) does exactly this, server-side, with the
cohort filter applied properly and sensitive fields stripped. The client simply
never calls it.

**This is the THIRD surface with one root cause.** SHY-0338 (follow lists),
SHY-0348 (blocked profile view) and now search — all the client reading Firestore
directly instead of going through the API, which is what the operator's
no-direct-backend rule exists to prevent. Each one presents differently: empty
lists, a safety control that does nothing, and here a raw `PERMISSION_DENIED`
shown to the user.

**What the user experiences.** The new-message screen says "Search all users",
they type a name, and they get a database error string. Not "no results" — an
internal error, verbatim, in the UI. On a product whose core loop is meeting
people, this is the loop being broken at its first step.

## Acceptance Criteria

### Happy path

- [ ] Searching a name finds matching people the searcher is allowed to see.
- [ ] Results appear quickly enough to feel like search rather than a page load.
- [ ] Tapping a result opens that person, as it does today from other routes.

### Error paths

- [ ] A failed search says so in plain words — never a raw database error.
- [ ] No results and a failed search are visibly different states.
- [ ] A slow or unreachable server does not leave the field looking like it found nothing.

### Edge cases

- [ ] Cross-cohort people never appear, whatever is typed.
- [ ] Somebody who has blocked the searcher does not appear.
- [ ] An exact ID search still works alongside a name search.
- [ ] An empty or whitespace query does not run a search.
- [ ] A query with regex or wildcard characters is treated as text.

### Performance

- [ ] Typing does not fire a request per keystroke.

### Security

- [ ] Filtering happens server-side; a modified client cannot see who it should not.
- [ ] Results carry no email, date of birth or other stripped field.
- [ ] Search cannot be used to enumerate the user base.

### UX

- [ ] The empty, loading, results and error states are all distinct.
- [ ] Verified with eyes on real devices, both platforms.

### i18n

- [ ] Every new or changed string ships in all locale files, asserted on rendered text.

### Observability

- [ ] A refused search is distinguishable in logs from one that legitimately found nobody.

## BDD Scenarios

**Scenario: Someone can find a person to message**

- **Given** a person who wants to message somebody new
- **When** they search for that person's name
- **Then** they see them in the results

**Scenario: A failure is explained, not dumped**

- **Given** a search that cannot be completed
- **When** the person searches
- **Then** they are told the search did not work, in ordinary words

**Scenario: Search does not cross the age boundary**

- **Given** an adult searching for people
- **When** results are shown
- **Then** no minor appears among them

## Test Plan

**RED first.** Reproducible on a real device today: type a name in the
new-message search and read `PERMISSION_DENIED … for 'list' @ L74` on screen.

### Express / Jest — `express-api/tests/routes/users-search.test.js`

- `search returns same-cohort matches` — pins the endpoint that already exists
- `search never returns a cross-cohort user`
- `search never returns a user who has blocked the searcher`
- `search strips sensitive fields`
- `an exact uniqueId query still resolves`

### Kotlin unit — `shared/src/commonTest/.../messaging/`

- `searching goes through the API, not Firestore` — **the defect, in one assertion**
- `a failed search surfaces a readable message, not the raw error`
- `no results and a failed search are different states`
- `an empty query does not search`

### Journey tests — real devices

- `journey-tests/`: a persona searches for another by name and opens them; then a
  cross-cohort name returns nothing. Walked on real Android AND real iPhone,
  local then dev.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| search reverted to the direct Firestore query | `searching goes through the API, not Firestore` + the journey |
| the raw error passed to the UI | `a failed search surfaces a readable message...` |
| the server's cohort filter removed | `search never returns a cross-cohort user` |
| the block filter removed | `search never returns a user who has blocked the searcher` |

## Out of Scope

- Search ranking, fuzzy matching or an index — this restores search working at
  all, not search being clever.
- The other direct-Firestore reads (SHY-0338, SHY-0348 cover theirs).

## Dependencies

- **SHY-0338** — same root cause and the same API-response hazard (`cohort` is
  stripped, so anything relying on it client-side must not). Land 0338 first.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Moving to the API changes what results look like | The endpoint already strips fields and filters by cohort; its behaviour is pinned by tests before the client is switched. |
| A raw error reaches the UI again | Asserted directly, and in the mutation table. |
| Search becomes an enumeration tool | Server-side limit and cohort filter, both already present and now pinned. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Journey walked on real Android AND real iPhone, local then dev.
- [ ] Screenshots of results, empty and error states on both platforms.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19** — Found on a real OnePlus while verifying SHY-0348: the
  new-message screen offers "Search all users", and typing a name renders
  `PERMISSION_DENIED: Null value error. for 'list' @ L74` **as UI text**. Not a
  log line — on screen, to the user.

- **2026-08-19** — Root cause read from source, not inferred:
  `PrivateMessageRepositoryImpl.searchUsers:755` runs
  `firestore.collection("users")` from the client. `firestore.rules:74` gates
  that read on `cohortMatchesCaller()`, a `resource.data` condition. A FILTERED
  query cannot be decided from the query alone, so the engine refuses it
  outright. This is the real "rules are not filters" case — distinct from
  SHY-0338's `documentId in [...]`, which the engine CAN evaluate per document.

- **2026-08-19** — `GET /api/users/search` already exists (`users.js:479`) and
  does the job properly, cohort filter and field stripping included. The fix is
  to call it.

- **2026-08-19** — Third surface, one root cause: SHY-0338 (follow lists),
  SHY-0348 (blocked profile) and this. All the client reading Firestore directly.
  Worth treating as a class, not three coincidences — a sweep for remaining
  client-side `firestore.collection(...)` queries would be a sensible follow-up.

- **2026-08-19 — DEVICE-PROVEN on the OnePlus.** Searching `50000020` in the
  new-message search:

  | stage | what the screen said |
  | --- | --- |
  | before | `PERMISSION_DENIED: Null value error. for 'list' @ L74` |
  | after routing to the API | "No users found" — the API returned a match, the client filtered it away |
  | after the `shapeForViewer` fix | **`[SEED] Lena (P-05 lapsed)`** |

  That middle row is the SAME trap SHY-0338 hit: `NewMessageViewModel` runs
  `filterSameCohortAs` over the results and the API strips `cohort`, so every
  result reads as the 'minor' default and an adult's search filters itself to
  nothing. Fixed at `shapeForViewer` — the single choke point for
  `/users/search` AND `/users/discover` — which re-attaches `cohort` after
  stripping. It discloses nothing, because the line above it guarantees every
  user returned is same-cohort as the caller.

- **2026-08-19 — 8 endpoint tests, mutation-proven.** Stripping `cohort` again
  reddens `returns cohort, and it always equals the searcher's` and
  `strips sensitive fields but keeps cohort`, and nothing else.

- **2026-08-19 — STILL OWED:** the Kotlin unit tests (`searching goes through
  the API, not Firestore`; the readable-error and empty-query cases), the
  journey scenarios, and the iOS device leg. Android is walked.
