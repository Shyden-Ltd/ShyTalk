---
id: SHY-0260
status: Draft
owner: claude
created: 2026-07-30
priority: P1
effort: M
type: bug
roadmap_ids: []
---

# SHY-0260: The admin audit log silently omits almost every admin action

## User Story

**As a** compliance reviewer reading the admin audit log
**I want** every admin action to appear in the list and the export
**So that** the record I rely on is the whole record, rather than a silent subset that happens to share one field name.

## Why

Found 2026-07-30 while proving SHY-0259's admin-dashboard Givens run against
real routes. On the local emulator, `adminAuditLog` held 200 documents; the
query the product runs returned **2**.

Both read paths in `express-api/src/routes/admin-audit-log.js` order by
`timestamp`:

```js
db.collection('adminAuditLog').orderBy('timestamp', 'desc').get()   // :22 export
db.collection('adminAuditLog').orderBy('timestamp', 'desc').get()   // :82 list
```

**Firestore's `orderBy` silently excludes documents that lack the ordered
field.** No error, no warning — the rows simply are not in the result.

And almost every writer uses `createdAt`, not `timestamp`:

| Writer | Action | Field written |
|---|---|---|
| `admin-bans.js:133` | `BAN_DEVICE` | `createdAt` |
| `admin-bans.js:216` | (ban lift) | `createdAt` |
| `admin-devices.js:235` | `UNBIND_DEVICE` | `createdAt` |
| `admin-gifts.js:53` | `CREATE_GIFT` | `createdAt` |
| `admin-gifts.js:122` | (gift edit) | `createdAt` |
| `users.js:1392` | `ACCOUNT_DELETION_SCHEDULED` | `createdAt` |
| `users.js:1447` | (deletion cancel) | `createdAt` |
| `suggestions-maintenance.js:26` | suggestions upkeep | `timestamp` |

So the audit surface omits bans, device unbinds, gift creation and account
deletions — the actions a reviewer most needs — and shows only the
suggestions-maintenance rows. 198 of 200 documents were invisible.

This is worse than a broken endpoint. A failure is visible; this returns
`200 OK` with a plausible-looking, materially incomplete answer. Someone
checking "was this user banned by an admin?" gets "no evidence of that" when
the evidence exists.

A second, independent defect sits in the same handler: the export issues three
**unbounded** `.get()` calls and assembles the whole result in memory. Measured
on the local emulator at 62,112 `auditLog` rows, that query does not merely run
slowly — it fails outright (`grpc 2 UNKNOWN`) after 24 seconds. `auditLog` is
append-only, so production reaches that size on its own.

## Acceptance Criteria

### Happy path

- [ ] The audit-log list returns every `adminAuditLog` entry regardless of whether it was written with `createdAt` or `timestamp`.
- [ ] The export contains every entry from all three collections (`auditLog`, `adminAuditLog`, `moderationLog`), ordered newest-first across the merged set.
- [ ] Every writer records the same canonical time field, so new rows cannot reintroduce the split.

### Error paths

- [ ] A document missing BOTH time fields is still returned, sorted last, rather than silently dropped — an entry with a bad timestamp is still evidence.
- [ ] A read that exceeds its cap reports that it was truncated, rather than returning a short list that looks complete.

### Edge cases

- [ ] Existing documents written with `createdAt` are readable without a migration; a migration may normalise them but correctness must not depend on it having run.
- [ ] Mixed-field ordering is stable: two entries with the same instant do not swap between calls.

### Performance

- [ ] Neither read path issues an unbounded collection `.get()`. Both are bounded and paged.
- [ ] The list endpoint responds within its existing budget at 100k+ `auditLog` rows.

### Security

- [ ] Both paths stay behind `requireAdmin` with the live-claim re-check; this change must not widen access.
- [ ] The export continues to emit only the fields it emits today — fixing omission must not leak new ones.

### UX

- [ ] N/A — admin-facing data correctness; no visual change beyond rows now appearing.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] A read that drops or truncates records logs the count, so a future regression of this shape is detectable from logs rather than by manual counting.

## BDD Scenarios

**Scenario: an admin ban appears in the audit log**
- **Given** an admin has banned a device, recorded with the writer's own time field
- **When** a reviewer opens the admin audit log
- **Then** the ban appears in the list

**Scenario: the export is complete**
- **Given** entries written with `createdAt` and entries written with `timestamp`
- **When** the reviewer exports the audit log
- **Then** every entry is present, newest first

**Scenario: an entry with no usable timestamp is still evidence**
- **Given** an audit entry missing both time fields
- **When** the log is read
- **Then** the entry is returned, ordered last, rather than omitted

**Scenario: a huge audit log does not break the endpoint**
- **Given** an `auditLog` collection with more rows than one response can carry
- **When** the export runs
- **Then** it completes, and says it was truncated rather than implying completeness

## Test Plan

**RED first**, against the REAL Firestore emulator (no doubles — a mocked `db`
returns whatever the test tells it to and therefore cannot reproduce
`orderBy`'s exclusion, which is the entire bug):

`express-api/tests/routes/admin-audit-log-completeness.test.js` (new)

1. Seed `adminAuditLog` with N entries written the way `admin-bans.js` writes
   them (`createdAt`) and M written the way `suggestions-maintenance.js` does
   (`timestamp`). Assert the list returns N+M. **This fails today, returning M.**
2. Seed one entry with neither field; assert it is returned, ordered last.
3. Assert merged ordering is newest-first across both field conventions.
4. Assert neither handler issues an unbounded read — seed past the cap and
   assert the response reports truncation instead of silently short-listing.

**Mutation checks:** reverting the reader to `orderBy('timestamp')` must fail
test 1; removing the missing-field fallback must fail test 2; restoring the
unbounded `.get()` must fail test 4.

## Out of Scope

- Backfilling historical documents. The reader must be correct without a
  migration; normalising old rows can follow separately.
- The `auditLog` and `moderationLog` collections' own schemas — they already
  use `timestamp` consistently. Only their unbounded reads are in scope.
- The admin UI's rendering of the returned rows.

## Dependencies

- None. The fix is contained to `admin-audit-log.js` plus the writers that
  choose the time field.

## Risks & Mitigations

- **Risk:** normalising writers to `timestamp` while old rows carry `createdAt`
  leaves two conventions in the data forever.
  **Mitigation:** the reader tolerates both by contract, pinned by test 1, so
  correctness never depends on which convention a row was written with.
- **Risk:** adding a cap turns a silent omission into a different silent
  omission.
  **Mitigation:** AC requires truncation to be REPORTED, and test 4 pins it.
- **Risk:** an in-memory merge sort across three collections re-introduces the
  memory problem at a smaller scale.
  **Mitigation:** page each collection under a cap, and merge the bounded sets.

## Definition of Done

- [ ] Every admin action appears in both read paths, whichever time field it was written with.
- [ ] No unbounded collection read remains in the handler.
- [ ] Truncation is reported, never implied-complete.
- [ ] Mutations killed.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-30 — Found via SHY-0259. Measured on the local emulator:
  `adminAuditLog` 200 documents, `orderBy('timestamp','desc')` returned 2.
  Sample of the 198 excluded documents shows fields
  `[adminId, action, targetUserId, details, createdAt]` — no `timestamp`.
- 2026-07-30 — The unbounded-read half was measured separately: `auditLog` at
  62,112 rows failed the export's exact query after 24,222ms with `grpc 2
  UNKNOWN`. Those rows were test debris from a non-idempotent seeder (fixed
  under SHY-0259), but production accumulates real rows the same way.
