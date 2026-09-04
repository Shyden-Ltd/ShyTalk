---
id: SHY-0517
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: S
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0517: The pre-push hook tests the wrong diff

## User Story

As **a developer pushing a branch**, I want the pre-push hook to test what I
am pushing — the commits between the remote's tip and mine — so that a
documentation push does not run a sixteen-minute browser suite, and deleting a
branch does not run anything at all.

## Why

`.husky/pre-push` decides what to test from one diff:

```sh
CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null)   # line 46
```

For any branch cut from `develop`, that range contains **everything develop
has that main lacks** — every merged story since the last promotion. So the
web-change test always fires, and when the local stack is up (`:3000` and
`:8888` answering, lines 235-242) the full Playwright suite runs on every push:
sixteen to seventeen minutes, measured three times on 2026-09-03 and
2026-09-04, twice for pushes that changed only Markdown.

Two more consequences of testing `HEAD` rather than the pushed ref:

- **Deletes run the suite.** The force-push guard (lines 14-16) correctly lets a
  delete through, but the diff below it never looks at what is being pushed, so
  `git push --delete` ran Playwright on 2026-09-04 and stalled for two minutes
  ([[feedback-pre-push-hook-runs-playwright-even-for-a-ref-delete]]).
- **A long hook kills the push.** After sixteen minutes the SSH session git
  opened before the hook has gone idle too long; the push exits 141 with a green
  hook and no transfer, and has to be repeated over HTTPS
  ([[feedback-git-push-needs-stdin-closed]]). Testing the right range makes
  most hooks short, which is the real fix for that too.

The large-file check (`scripts/check-large-files.sh --against origin/main`,
lines 92-105) is right to compare with main — it guards what will eventually
land there — and is not changed.

## Acceptance Criteria

### Happy path

- [ ] The hook reads each `<local ref> <local sha> <remote ref> <remote sha>`
      line from stdin and computes the changed files for **that** push:
      `remote_sha..local_sha` when the remote ref exists; the merge-base with
      `origin/develop` (falling back to `origin/main`) `..local_sha` for a new
      branch.
- [ ] Web tests run only when that range touches web files (`public/**`,
      `tests/web/**`, `functions/**`, `playwright.config.ts`); backend and app
      gates likewise key off their own paths in the same range.
- [ ] A ref delete (`local_sha` all zeros) runs no tests and exits 0
      immediately after the force-push guard.
- [ ] A push of Markdown only completes in under ten seconds with the stack up.

### Error paths

- [ ] If `origin/develop` and `origin/main` are both absent locally (fresh
      clone), the hook says so and falls back to today's behaviour rather than
      skipping silently.
- [ ] A hook step that fails still blocks the push with the step named, as
      today.

### Edge cases

- [ ] Pushing several refs at once: each line is evaluated on its own range;
      the union of their gates runs once.
- [ ] A force-push attempt is still refused before any diff is computed.
- [ ] `git push --tags` (refs under `refs/tags/`) runs no tests.

### Performance

- [ ] Docs-only push under ten seconds; a web-only push runs Playwright once.

### Security

- [ ] The force-push guard and the large-file guard are unchanged and covered
      by the existing tests; the new range logic cannot widen what is allowed
      through, only what is tested.

### UX

- [ ] The hook prints the range it tested and why (`testing 3 commits
      a1b2c3..d4e5f6: web=no backend=no app=no docs=yes`) so a developer can see
      the decision.

### i18n

- [ ] N/A — developer tooling, English only.

### Observability

- [ ] Exit code and the printed decision line are asserted by the test; a
      skipped suite is announced, never silent.

## BDD Scenarios

**Scenario: A documentation push is quick**

- **Given** a developer whose branch changes only story files
- **When** they push it
- **Then** the push completes without running the browser suite

**Scenario: A web change still runs the browser suite**

- **Given** a developer whose branch changes a web page
- **When** they push it
- **Then** the browser suite runs before the push is allowed

**Scenario: Deleting a branch runs nothing**

- **Given** a developer deleting a remote branch
- **When** they push the deletion
- **Then** no tests run and the deletion goes through

**Scenario: The developer can see what was decided**

- **Given** a developer pushing any branch
- **When** the hook runs
- **Then** it prints which commits it tested and which suites it chose

## Test Plan

### Red

- `express-api/tests/scripts/pre-push-hook-range.test.js` — runs the hook in a
  temp repository with a fake `origin`, feeding stdin lines: docs-only range
  skips web tests; web range selects them; delete exits 0 with no gates; new
  branch uses the merge-base; multiple refs; force-push still refused; the
  decision line is printed. The hook's test commands are stubbed by `PATH`
  shims that record invocation (the gates themselves are proven elsewhere).

### Green

- Restructure the hook around the stdin loop, one `CHANGED` per line, path
  classification, decision line.

## Out of Scope

- What each gate tests.
- The SSH keep-alive problem itself — mostly removed by shorter hooks; the
  HTTPS workaround stays documented.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A path classification misses a web file and a web change skips the suite | The classification list is asserted against the repository's actual web directories in the test. |
| The hook silently tests nothing on a fresh clone | Explicit fallback with a printed reason. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] One docs-only push and one web push observed with the new decision line;
      recorded in Notes.

## Notes

- **2026-09-04** — Filed as a SHY-0500 follow-up after three sixteen-minute
  hook runs in two days, two of them for Markdown-only pushes.
