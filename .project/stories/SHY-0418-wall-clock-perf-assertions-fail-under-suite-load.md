---
id: SHY-0418
status: Done
owner: unassigned
created: 2026-08-21
priority: P2
effort: XS
type: bug
roadmap_ids: []
mvp: false
released_in: v0.99.0
---

# SHY-0418: Two wall-clock assertions go red when the machine is busy

## User Story

As a **developer reading a red suite**, I want a failure to mean the code is
wrong, so that I do not learn to re-run reds until they go green.

## Why

Found while running the full Express suite during SHY-0308.

`express-api/tests/scripts/check-story-frontmatter.test.js` asserts elapsed
wall-clock time twice:

```js
expect(ms).toBeLessThan(5000);   // line 730
expect(ms).toBeLessThan(5000);   // line 970 — "--scan over a directory of 20 stories"
```

Result on the same commit, minutes apart:

| Run | Result |
| --- | --- |
| Full suite (14,552 tests) with the API server + emulators also running | **1 failed** — `--scan over a directory of 20 stories completes in under 5s` |
| That file alone | **191/191 passed** |

Nothing about the code changed between them. The assertion measures how busy
the machine is, and the suite is at its busiest exactly when it runs.

### Why it is worth fixing rather than tolerating

This is the same hazard as [[SHY-0308]]: a test that fails for reasons unrelated
to correctness teaches everyone that a red can be re-run away. That habit is
cheap to acquire and expensive when the next red is real — and it is precisely
how an intermittent SECURITY failure gets trained into invisibility. Two
assertions is a small enough surface to fix before it becomes a norm.

## Acceptance Criteria

### Happy path

- [ ] The scan's performance is still guarded — the guard is not simply deleted.
- [ ] The suite passes under load, proven by running it alongside the full
      Express suite rather than alone.

### Error paths

- [ ] A genuine performance regression — an accidental O(n²), a per-file
      process spawn — still reddens the guard. Proven by mutation, not by
      inspection.

### Edge cases

- [ ] The guard behaves the same on a loaded CI runner as on an idle laptop.

### Performance

- [ ] The guard itself adds no meaningful time to the suite.

### Security

- [ ] N/A.

### UX

- [ ] N/A — test-suite change, no user-facing surface.

### i18n

- [ ] N/A — test-suite change, no user-facing copy.

### Observability

- [ ] On failure the message states what was measured and against what budget,
      so a reader can tell a regression from a busy machine.

## BDD Scenarios

**Scenario: a busy machine does not create a red**

- **Given** the whole test suite is running at once
- **When** the story-scan guard runs
- **Then** it passes

**Scenario: a real slowdown is still caught**

- **Given** the scan is changed to re-read every file per story
- **When** the guard runs
- **Then** it fails

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard rewrite | Measure work done (files opened, processes spawned) rather than elapsed milliseconds, or give the budget headroom proportional to a measured baseline. |
| Mutation | An artificial O(n²) reddens it. |
| Under load | The file passes while the full Express suite runs concurrently. |

## Out of Scope

- Other timing assertions elsewhere in the suite; this story fixes the two
  known ones and records the pattern. A sweep for the rest belongs with the
  broader no-sleeps work.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The guard is "fixed" by widening the budget until it never fails, which deletes it | The Error-paths AC requires a mutant to still redden it. |
| Counting work instead of time misses a real slowdown | Keep a generous elapsed-time ceiling as a backstop alongside the work-based assertion. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The file passes while the full Express suite runs concurrently.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes

- Observed 2026-08-21: full suite 1 failed / 14,551 passed; the same file alone
  191/191. The failing assertion was the 5s scan budget at line 970.

Reviewed-up-to: efe91c67360c145cadcc1eb7f16183ecf58c97c3
