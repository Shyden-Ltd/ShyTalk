---
id: SHY-0251
status: In Progress
owner: claude
created: 2026-07-29
priority: P1
effort: XS
type: bug
roadmap_ids: []
epic: EPIC-0005
---

# SHY-0251: Searching reports by unique ID never matches anything

## User Story

**As a** moderator looking into a specific account
**I want** to paste that account's unique ID into the reports search box and see their reports
**So that** I can act on the exact person I am investigating instead of guessing at name spellings.

## Why

Surfaced 2026-07-29 while eradicating silently-passing tests under SHY-0245.

The admin Reports tab's search box is unambiguous about what it takes:

```html
<input type="number" id="report-search-input"
       placeholder="Search by unique ID..." aria-label="Search reports by user ID">
```

`type="number"`, so a moderator can only type digits into it. But
`GET /api/reports` filters on **strings only**
(`express-api/src/routes/reports.js`):

```js
const filtered = search
  ? userFiltered.filter(
      (r) =>
        (r.reportedUserName || '').toLowerCase().includes(search) ||
        (r.reporterName || '').toLowerCase().includes(search) ||
        (r.reason || '').toLowerCase().includes(search) ||
        (r.description || '').toLowerCase().includes(search),
    )
  : userFiltered;
```

`reportedUserUniqueId` and `reporterUniqueId` — the fields the report documents
actually carry, and the only identifiers the input will accept — are never
consulted. So the search advertised in the placeholder returns **zero results
for every input a moderator can physically type**, unless a digit sequence
happens to appear inside a display name or a free-text description.

Nothing caught it because the covering test guarded its only assertion on
`if (cardCount > 0)`, so a search returning nothing skipped the check and
reported green.

## Acceptance Criteria

### Happy path

- [ ] Searching the reports list for a reported user's `reportedUserUniqueId` returns that user's reports.
- [ ] Searching for a reporter's `reporterUniqueId` returns the reports they filed.
- [ ] The existing name / reason / description search keeps working unchanged.

### Error paths

- [ ] A search matching nothing returns an empty list and the "no reports" empty state, not an error.
- [ ] A report document missing either unique-ID field is skipped by the ID comparison rather than throwing.

### Edge cases

- [ ] A partial ID (`7770`) matches `77700001`, consistent with the substring behaviour of the existing text fields.
- [ ] Unique IDs are compared as strings, so a numeric field and a string field both match.
- [ ] An empty `search` parameter returns the unfiltered list exactly as before.

### Performance

- [ ] The comparison stays inside the existing single in-memory `filter` pass — no extra Firestore read, no new index.

### Security

- [ ] The endpoint still requires admin (`requireAdmin`) — searchability is unchanged, only the matched fields widen.
- [ ] No new field is added to the RESPONSE; only the matching predicate changes, so nothing new is disclosed.

### UX

- [ ] The placeholder's promise ("Search by unique ID...") is now true.

### i18n

- [ ] N/A — no new user-facing strings; the placeholder and aria-label already exist and are unchanged.

### Observability

- [ ] N/A — a search returning no rows is an ordinary outcome, not an event worth logging; the existing request logging already records the query.

## BDD Scenarios

**Scenario: a moderator searches by the reported user's ID**
- **Given** a pending report against the account with unique ID 77700001
- **When** a moderator searches the Reports tab for "77700001"
- **Then** that report appears in the results

**Scenario: a moderator searches by the reporter's ID**
- **Given** a report filed BY the account with unique ID 77700002
- **When** a moderator searches for "77700002"
- **Then** that report appears in the results

**Scenario: text search still works**
- **Given** a report whose reason is "Spam"
- **When** a moderator searches for "spam"
- **Then** that report still appears

**Scenario: a search that matches nothing**
- **Given** no report involves the account 99999999
- **When** a moderator searches for "99999999"
- **Then** the list is empty and the empty-state message is shown, with no error

## Test Plan

**RED first** — `express-api/tests/routes/reports-search-unique-id.test.js` (new, real emulator):

- `search by reportedUserUniqueId returns the report`
- `search by reporterUniqueId returns the report`
- `search by reason still works (no regression)`
- `search by display name still works (no regression)`
- `a partial unique id matches by substring`
- `a search matching nothing returns an empty list, not an error`
- `a report missing the unique-id fields does not break the search`

Plus `tests/web/admin-reports.spec.ts` → `search by unique ID filters reports`,
whose `if (cardCount > 0)` guard is removed so it fails until this lands.

**GREEN:** include `reportedUserUniqueId` and `reporterUniqueId` (stringified) in
the existing `filter` predicate.

**Mutation checks:** dropping either ID field from the predicate must fail its
matching test; dropping `String(...)` must fail the numeric-field test.

## Out of Scope

- Full-text search infrastructure (Firestore has none; the existing in-memory scan is unchanged).
- Searching reports by conversation or message id.
- The same gap in other admin tabs, if present — each needs its own evidence before being claimed.

## Dependencies

- None. The fields are already on the report documents (`test-helpers.js` writes both, and the real report routes set them).

## Risks & Mitigations

- **Risk:** widening the predicate makes a text search match unexpected reports whose IDs contain the typed digits.
  **Mitigation:** the input is `type="number"`, so the realistic query space is digits; substring behaviour matches the existing fields, keeping one consistent rule.
- **Risk:** a report document missing the fields throws on `.toLowerCase()`.
  **Mitigation:** same `|| ''` guarding the existing fields use, covered by its own test.

## Definition of Done

- [ ] RED tests written first and observed failing.
- [ ] Search matches both unique-ID fields; text search unchanged.
- [ ] Mutations killed.
- [ ] `cd express-api && npm test` green.
- [ ] `npx playwright test` green on chromium including the un-guarded web test.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-29 — Found by removing an `if (cardCount > 0)` guard in `admin-reports.spec.ts`. The guard is the whole reason this survived: the test searched, got nothing, and skipped its only assertion.
