---
id: SHY-0513
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: XS
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0513: The story-index reconciler cannot insert the rows it finds missing

## User Story

As **a maintainer filing stories**, I want the index reconciler's `--apply`
to insert the missing rows on the machine I run it on, so that the story index
stops drifting by omission.

## Why

Found on 2026-09-04 while filing EPIC-0013. `scripts/reconcile-story-index.sh`
correctly reported 158 story files with no row in `SHY-INDEX.md` — the index
had been abandoned around SHY-0225 — and then failed to insert any of them:

```
awk: newline in string | [SHY-0226](SHY-022... at source line 1
```

Two defects, both in the last twelve lines of the script:

1. **The rows are passed to awk with `-v rows="$rows"`** (`reconcile-story-
   index.sh:119`). macOS ships BSD awk (`awk version 20200816`), which refuses
   a newline inside a `-v` value. The script runs only on developer machines,
   so it has never inserted a row on a Mac; the drift it was written to stop
   (17 stories on 2026-08-23) grew to 158.
2. **The insertion point is wrong even where awk accepts it.** Rows are printed
   immediately before the `## Done` heading, which sits after the blank line
   that closes the Active table (`SHY-INDEX.md:187-189`). Inserted rows would
   form a second, header-less table under the first — rendered as a broken
   table, not as backlog rows.

The tool's purpose is exactly right ("derived rather than remembered"); it
just never worked where it is run. The 158-row backfill was done by hand on
2026-09-04 in the EPIC-0013 filing PR; this story makes the tool able to do the
next one.

## Acceptance Criteria

### Happy path

- [ ] `--apply` inserts every missing row **inside** the Active table — after
      its last existing row, before the blank line — in the same column format
      the script already builds.
- [ ] Rows reach awk through a temporary file (or the script builds the output
      without awk), never through `-v`; the script passes on macOS BSD awk and
      on GNU awk.
- [ ] The report mode is unchanged: exit 1 with the `MISSING` list when the
      index is behind, exit 0 with the tick when it is not.

### Error paths

- [ ] A malformed story (missing priority, status or title) is still reported
      as `MALFORMED` and skipped; the remaining rows are inserted.
- [ ] If `## Done` or the Active table cannot be found, the script exits 2
      naming the index file and changes nothing.

### Edge cases

- [ ] Running `--apply` twice inserts nothing the second time (idempotent).
- [ ] A title containing `|` or `&` is inserted verbatim without breaking the
      table (the `|` is escaped as `\|`).
- [ ] An empty Active table (header only) still receives the rows under the
      header.

### Performance

- [ ] 200 missing rows insert in under two seconds.

### Security

- [ ] N/A — a local documentation tool with no network or secret access; it
      writes only `SHY-INDEX.md` inside the repository.

### UX

- [ ] The success line names how many rows were inserted and where; a failure
      names the reason, never a bare awk error.

### i18n

- [ ] N/A — maintainer tooling; titles are copied verbatim in whatever
      language they are written.

### Observability

- [ ] Exit codes: 0 clean or applied, 1 drifted in report mode, 2 usage or
      structural failure — documented in `--help` and asserted.

## BDD Scenarios

**Scenario: Missing rows are added to the backlog table**

- **Given** three story files with no line in the index
- **When** the maintainer runs the reconciler and asks it to apply
- **Then** three rows appear at the end of the active backlog table
- **And** the table still renders as one table

**Scenario: The tool works on a Mac**

- **Given** a maintainer on macOS with the system's own awk
- **When** they run the reconciler and ask it to apply
- **Then** the rows are inserted and the tool reports how many

**Scenario: Running it again changes nothing**

- **Given** an index that already lists every story
- **When** the maintainer runs the reconciler and asks it to apply
- **Then** it reports the index is complete and the file is unchanged

**Scenario: A broken story is reported, not indexed**

- **Given** a story file with no priority
- **When** the maintainer runs the reconciler
- **Then** that story is reported as malformed and the others are handled

## Test Plan

### Red

- `express-api/tests/scripts/reconcile-story-index.test.js` — copies a fixture
  index and story files into a temp dir, runs the real script with the system
  awk: rows land inside the Active table (not after the blank line); idempotent
  second run; `|` in a title escaped; malformed story skipped; exit codes 0/1/2.
  The suite runs on the macOS and Linux CI runners so both awks are covered.

### Green

- Write rows to a temp file and read it from awk, insert after the last
  `| [SHY-` row above `## Done`, escape `|` in titles, add the structural
  guard and exit code 2.

## Out of Scope

- Making the index generated entirely by CI (a larger change to how the index
  is owned; note it in EPIC-0001 if the drift recurs after this fix).
- Re-ordering existing rows — the script deliberately never does.

## Dependencies

- None. EPIC-0001 (the SHY framework) is the natural home.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The fix works on one awk and not the other | The test runs on both CI runner families. |
| Rows inserted in the wrong table | The test asserts the row's line number lies between the Active header and the first blank line after it. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Run once for real on a Mac against the live index with no drift reported
      afterwards; recorded in Notes.

## Notes

- **2026-09-04** — Found while filing EPIC-0013; the backfill of 158 rows was
  done by hand in that PR (same column format) so the index is true at merge.
