---
id: SHY-0374
status: Draft
owner: unassigned
created: 2026-08-20
priority: P2
effort: XS
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0374: A decommission guard scans generated build output

## User Story

As **a developer running the test suite**, I want the decommission guards to
examine the project's own files only, so that leftover build output on my machine
does not fail checks that pass in CI.

## Why

`express-api/tests/scripts/no-funfacts-backend-admin-surface.test.js` enumerates
files with a filesystem `walk(REPO)` whose `SKIP_DIRS` does not exclude
`coverage/`. On any machine holding a stale `express-api/coverage/` it reports
false offenders — the lcov HTML embeds the source of files that were deleted:

```
express-api/coverage/lcov-report/src/routes/fun-facts.js.html
express-api/coverage/lcov-report/src/cron/backups.js.html
... 8 files
```

`express-api/coverage/` is gitignored (`.gitignore:136`). CI starts from a clean
checkout, so CI is green and the failure only ever hits a developer — which is
the worst shape for a guard: red locally, green in CI, and the noise trains
people to ignore it.

Found while verifying SHY-0371: the full suite reported 6 failures, 2 of which
were this. The directory dated from 2026-04-19 and had nothing to do with the
change under test.

## Acceptance Criteria

### Happy path

- [ ] The guard reports zero offenders with a stale `coverage/` directory
      present.
- [ ] It still reports offenders for real source files.

### Edge cases

- [ ] The guard enumerates **tracked** files rather than walking the disk, so no
      future generated directory can reintroduce this. Adding a new build output
      dir must not require touching a skip list.
- [ ] Its existing "the scan is not vacuous" assertion still holds.

### Error paths

- [ ] Behaviour is unchanged in a checkout with no build output at all.

### Performance

- [ ] Enumeration is no slower than today — reading a tracked-file list is
      cheaper than walking the working tree.

### Security

- [ ] The guard reads repository files only. Enumerating tracked paths rather
      than walking the disk also removes any chance of following a stray symlink
      out of the repo.

### UX

- [ ] N/A — a developer-facing check.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] When the guard fails it names the offending file and the matched term, so
      a real offender is distinguishable from a scanning bug at a glance.

## BDD Scenarios

**Scenario: Leftover build output does not fail the checks**

- **Given** a developer has old generated reports in their working copy
- **When** the checks run
- **Then** they pass, because only the project's own files are examined

## Test Plan

1. Reproduce: restore a `coverage/lcov-report` containing the deleted
   fun-facts source and confirm the guard goes RED today.
2. Switch enumeration to tracked files.
3. Confirm GREEN with the same stale directory present.
4. Mutation-check: add a real offender to a tracked source file and confirm the
   guard still goes RED, so the fix did not make it vacuous.
5. Sweep for sibling guards that walk the filesystem the same way and fix them
   together — this is a class, not one file.

## Out of Scope

- The fun-facts decommission itself (SHY-0145, done).

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Tracked-file enumeration makes the guard vacuous | Step 4 mutation-checks it, and the existing non-vacuity assertion stays. |
| Other guards share the flaw | Step 5 sweeps for them rather than fixing only the reported one. |

## Definition of Done

- [ ] Guard green with stale build output present, red on a real offender.
- [ ] Sibling guards swept.
- [ ] Story `In Review` before merge; CI green by name; merged to develop.

## Notes (running log)

- **2026-08-20** — the stale directory on the dev machine was moved to a
  scratchpad rather than deleted, so this is currently reproducible from
  `stale-coverage-apr19`.
- **CI survives this on an ordering coincidence, not by design.**
  `test-backend.yml:104` runs jest with `--coverage --coverageReporters=html`,
  which writes `express-api/coverage/lcov-report/**`. It stays green only
  because jest emits coverage AFTER the run while the guard's `walk(REPO)`
  executes at file load. Anything that changes that order — an incremental
  reporter, a re-run over a reused workspace — turns this into a CI failure.
- The scanner added by SHY-0371
  (`firebase-admin-namespace-surface.test.js`) enumerates via `git ls-files`
  and is immune by construction; that is the pattern to adopt here.
