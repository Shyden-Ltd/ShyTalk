---
id: SHY-0533
status: Draft
owner: unassigned
created: 2026-09-19
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0533: CI refuses a pull request that leaves the story index out of step

## User Story

As **a maintainer filing or finishing stories**, I want CI to refuse a pull
request that leaves a story file without its `SHY-INDEX.md` row, or a row
without its story file, so that the index stops drifting without anyone
having to remember to check it.

## Why

- **The index row has been missed four times.** SHY-0136 and SHY-0270 were
  found on 2026-08-14, and SHY-0269 in #1687 on 2026-08-15. On 2026-09-19,
  SHY-0500's story file turned out to have arrived with #2129 without a row;
  it was found while filing SHY-0532 and fixed in #2204.
- **Nothing in CI can see it.** The frontmatter validator globs
  `SHY-[0-9][0-9][0-9][0-9]-*.md`, which leaves `SHY-INDEX.md` out by design.
  No workflow runs `scripts/reconcile-story-index.sh`: `git grep
  reconcile-story-index -- .github/` on `develop` returned nothing on
  2026-09-19.
- **The detector already exists.** The reconciler's report mode names every
  story file that has no row, and exits 1 when it finds one. On 2026-09-19
  it named SHY-0500 on macOS. SHY-0513 makes its `--apply` work on macOS,
  which helps whoever remembers to run it. This story removes the need to
  remember.

## Acceptance Criteria

### Happy path

- [ ] A CI job runs `scripts/reconcile-story-index.sh` in report mode on every
      pull request into `develop` that touches `.project/stories/`, and fails
      when the reconciler exits non-zero, printing its `MISSING` lines.
- [ ] The reverse direction is checked as well. An index row whose linked
      story file does not exist, because it was renamed or deleted, fails the
      job with the row named. The reconciler's report mode is extended to do
      this rather than a second script being added.
- [ ] After the job first merges, its name is added to `develop`'s required
      status checks, and the protection is re-read to confirm it. A job
      outside the required list is decoration.

### Error paths

- [ ] A story file with malformed frontmatter fails the job with the
      reconciler's `MALFORMED` line; it never passes silently.
- [ ] A missing or unreadable reconciler script fails the job closed. The job
      never skips because its tool is absent.

### Edge cases

- [ ] A filing pull request that adds several stories at once passes when
      every row is present, and otherwise fails naming each missing one.
- [ ] A pull request that does not touch `.project/stories/` is never left
      waiting on this required check. The job is wired through the existing
      `detect-changes` job, where a skipped job counts as passing, not through
      a workflow-level `paths:` filter, which leaves a required check pending
      for ever.
- [ ] Rows in the Done and Cancelled tables count as present, so a story
      does not have to sit in the Active table to satisfy the check.

### Performance

- [ ] The job adds under 30 seconds to a pull request's checks, measured on
      a real run and recorded.

### Security

- [ ] The job runs with `permissions: contents: read` only. Every action is
      pinned to a full commit SHA with a version comment. Story files are read
      as data and never executed.

### UX

- [ ] The failure names each missing row and says how to add it: run
      `scripts/reconcile-story-index.sh --apply` on Linux, or add the row by
      hand in the reconciler's format until SHY-0513 lands.

### i18n

- [ ] Unchanged. This is CI tooling output only, with no user-facing copy in
      any locale.

### Observability

- [ ] The job writes the missing and orphaned rows to `$GITHUB_STEP_SUMMARY`,
      so a reviewer sees the drift without opening the log.

## BDD Scenarios

**Scenario: A story filed without its index row is refused**

- **Given** a pull request that adds a story file and no `SHY-INDEX.md` row
- **When** CI runs on the pull request
- **Then** the index check fails and names the story that has no row

**Scenario: A story filed with its index row passes**

- **Given** a pull request that adds a story file and its `SHY-INDEX.md` row
- **When** CI runs on the pull request
- **Then** the index check passes

**Scenario: A row left behind by a renamed story is refused**

- **Given** a pull request that renames a story file and leaves its old row
- **When** CI runs on the pull request
- **Then** the index check fails and names the row whose file is gone

**Scenario: Unrelated work is not held up**

- **Given** a pull request that touches no file under `.project/stories/`
- **When** CI runs on the pull request
- **Then** the index check does not leave the pull request waiting

## Test Plan

- **Unit.** The reconciler's reverse-direction report gets tests in
  `express-api/tests/scripts/`, using real temporary directories and no
  mocks: an orphaned row, a present row, a row in the Done table, and a
  malformed story. Each test is written red before the change.
- **Workflow.** The new job passes `actionlint`. A throwaway pull request
  that adds a story without a row goes red; adding the row turns it green.
  Both runs are linked from the story.
- **Mutation.** Delete one row from a copy of the index and the job goes red;
  restore it and the job goes green. The predicted verdicts are written down
  first, and the whole verdict is read.
- **Wiring.** Required status checks are read back from the API after the
  job is added, and the evidence is the read, not the write response.

## Out of Scope

- Making `--apply` work on macOS, which is SHY-0513.
- Row order inside the Active table, which the operator curates.
- Moving rows between the Active, Done and Cancelled tables.

## Dependencies

- None. Report mode already runs on Linux runners, and on macOS it has
  reported correctly even though `--apply` cannot insert there.
- Related: SHY-0513 (the same tool's `--apply`).

## Risks & Mitigations

- **A required check that never reports blocks unrelated pull requests.** The
  job is wired through `detect-changes` as a conditional job. It is not
  filtered at the workflow level.
- **A false positive blocks a legitimate pull request.** The reconciler
  already matches a row anywhere in the index, and the reverse check follows
  the same rule. The mutation step proves both directions.

## Definition of Done

- [ ] The tests above were red before the change and are green after it.
- [ ] The job is required on `develop`, confirmed by reading the protection
      back.
- [ ] The story is `In Review` and its index row is updated.

## Notes

- 2026-09-19 15:05 WIB — **Filed** from #2204. SHY-0500's missing row was
  found there while filing SHY-0532, which makes it the fourth recurrence of
  a drift CI cannot see.
