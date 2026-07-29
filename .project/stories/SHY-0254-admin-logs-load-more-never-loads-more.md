---
id: SHY-0254
status: In Progress
owner: claude
created: 2026-07-29
priority: P2
effort: XS
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0254: "Load more" in the admin Logs tab never loads more

## User Story

**As an** admin reading through the logs
**I want** the "Load more" button to actually fetch the next page
**So that** I can see past the first fifty entries instead of being silently capped.

## Why

Surfaced 2026-07-29 while un-skipping the log pagination test under SHY-0245.

`GET /admin/logs` hands back a cursor taken straight from a stored `timestamp`:

```js
const nextCursor =
  snapshot.docs.length === limit ? snapshot.docs.at(-1).data().timestamp : null;
```

and then reads it back coerced:

```js
if (cursor) query = query.startAfter(Number(cursor));
```

`logger.js` writes `timestamp` as an **ISO string** (`new Date().toISOString()`),
so `Number("2026-07-29T…")` is `NaN`. `startAfter(NaN)` against a
string-ordered field matches nothing, so the second page came back empty every
time. The button appeared (because `nextCursor` was non-null), the admin pressed
it, and the table did not change.

Nothing caught it because the covering test skipped itself with
`if (!isVisible) test.skip(true, 'Fewer than 50 logs …')` — on a database with
under a page of logs, which is most local runs, the pager was never clicked.

## Acceptance Criteria

### Happy path

- [ ] With more than one page of logs, pressing "Load more" appends the next page to the table.
- [ ] The row count strictly increases after each press until the last page.
- [ ] The button disappears once there are no further pages.

### Error paths

- [ ] A malformed cursor returns a 4xx or an empty page — never a 500.
- [ ] A failed page fetch leaves the rows already on screen intact.

### Edge cases

- [ ] Exactly one full page shows no "Load more" (there is nothing after it).
- [ ] Pagination keeps working alongside the level / source / user / trace filters.
- [ ] A log written with a NUMERIC timestamp still paginates, since the cursor is passed through with its own type rather than coerced.

### Performance

- [ ] Unchanged — same single indexed query per page.

### Security

- [ ] Unchanged: the route still requires admin. The cursor is a value the server itself issued, and is used only as a Firestore range bound.

### UX

- [ ] Pressing the button visibly adds rows, so the control stops lying about what it does.

### i18n

- [ ] N/A — no user-facing strings change.

### Observability

- [ ] N/A — an empty page is now a real outcome rather than a silent failure mode.

## BDD Scenarios

**Scenario: the second page arrives**
- **Given** more than fifty log entries exist
- **When** an admin presses "Load more"
- **Then** more rows appear than were there before

**Scenario: the last page hides the button**
- **Given** the final page of logs has been loaded
- **When** it renders
- **Then** "Load more" is no longer shown

**Scenario: a numeric timestamp still paginates**
- **Given** a log whose `timestamp` is stored as a number
- **When** it is used as the cursor
- **Then** the next page is still returned

## Test Plan

**RED first** — `tests/web/admin-logs.spec.ts` →
`load more button loads additional log entries`, with its
`test.skip(true, 'Fewer than 50 logs')` guard removed and 51 real log documents
seeded through `helpers/logs.ts` so the pager is guaranteed to appear. It fails
against the current code with the row count stuck at 50.

**GREEN:** pass the cursor through to `startAfter` without coercion.

**Mutation check:** restoring `Number(cursor)` must fail the test — verified.

## Out of Scope

- Migrating log timestamps to a numeric field (a data change with its own migration; the fix here is type-agnostic).
- Pagination in any other admin tab.

## Dependencies

- Depends on `logs` being seedable, added under SHY-0245 (`WRITEABLE_COLLECTIONS` + `SWEPT_BY_TEST_RUN`).

## Risks & Mitigations

- **Risk:** a stored timestamp of a different type than the cursor would compare oddly.
  **Mitigation:** the cursor is echoed from a document the same query returned, so it always matches that field's type — which is precisely what coercing broke.

## Definition of Done

- [ ] The pagination test passes with the guard removed.
- [ ] Mutation (restoring the coercion) kills the test.
- [ ] `npx playwright test` green on chromium.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-29 — Found by seeding 51 logs so a self-skipping test had to run. The skip was doing real damage: it hid a broken pager on every database small enough not to trigger it.
