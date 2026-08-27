---
id: SHY-0477
status: In Review
owner: unassigned
created: 2026-08-27
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0477: The board-sync commit's `[skip ci]` blocks every open promotion PR

## User Story

As **whoever promotes develop to main**, I want a promotion PR to stay
mergeable, so that a bookkeeping commit landing on develop does not strand a
release indefinitely.

## Why

`sync-stories-to-issues.yml` commits its id-map sidecar to `develop` with:

```
chore(board): sync board-items.json id-map [skip ci]
```

GitHub honours `[skip ci]` on the **head commit** for `pull_request` events, not
only for pushes. So the moment that commit lands on `develop`, every open PR
whose head is develop — which is exactly what a promotion PR is — has a head
commit with **zero check runs**.

`main`'s ruleset requires `Detect Changes`, `Analyze JavaScript` and `PR Gate`.
Those checks will never report on that SHA, so the PR sits at `BLOCKED` with
`mergeable: MERGEABLE` forever, and nothing in the UI says why.

Observed 2026-08-27 on **#2033** (328 commits, 106 stories). A full green run —
**28/28 jobs**, android-e2e included — was superseded eleven minutes later by the
bot's commit, and the PR became unmergeable with no failing check to point at.

### `[skip ci]` was the third belt on a two-belt problem

The workflow's own comment says so:

> `board-items.json` is deliberately ABSENT from the push `paths:` below and the
> commit message carries `[skip ci]` … the actor guard on the job is
> belt-and-braces.

The loop it prevents is already prevented **twice**: the sidecar is not a trigger
path, and the job has an actor guard. `[skip ci]` adds no loop protection the
other two do not already give — it only suppresses *unrelated* workflows, and
that suppression is what strands promotions.

### The trade-off, stated

Removing it means a board sync fires the normal develop workflows. That costs CI
minutes on a commit that changes one JSON file. The alternative costs a release.

## Acceptance Criteria

### Happy path

- [ ] A board-sync commit landing on develop leaves an open promotion PR
      mergeable.
- [ ] The promotion PR's required checks report on the new head.

### Error paths

- [ ] The sync workflow still does not re-fire itself — no loop.

### Edge cases

- [ ] A sync landing while several PRs are open unblocks all of them, not just
      the newest.
- [ ] A sync that changes nothing still commits nothing, as today.

### Performance

- [ ] Accepted cost: develop's workflows run on the sidecar commit. Bounded by
      how often stories change, and the sidecar is one small JSON file.

### Security

- [ ] The commit stays signed via the Release App token (SHY-0063). No change to
      how it is authored.

### UX

- [ ] None. No product change.

### i18n

- [ ] None.

### Observability

- [ ] The workflow says in its header WHY the marker is absent, so nobody
      restores it as an optimisation.

## BDD Scenarios

**Scenario: Housekeeping does not strand a release**

- **Given** a release waiting to go out
- **When** the board updates itself in the background
- **Then** the release can still go out

## Test Plan

| Layer | What it proves |
| --- | --- |
| Workflow test | The commit message carries no skip marker. |
| Workflow test | The sidecar is still absent from the trigger paths, so no loop. |
| Live | This story's own PR moves develop past the stranded head and #2033 becomes mergeable. |

## Out of Scope

- Changing how promotions are cut. Cutting from a fixed SHA would also avoid
  this, but it is a much larger change to the release flow.
- Other `[skip ci]` uses in the repo, which do not land on an integration branch.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the sync loops. **Mitigation:** the paths filter and actor guard are
  unchanged and were always the real protection; a test pins the paths filter.
- **Risk:** somebody restores the marker to save CI minutes.
  **Mitigation:** the workflow header states the cost, and a test fails if it
  comes back.

## Definition of Done

- [ ] The marker is gone and a test would catch its return.
- [ ] The sync still does not re-fire itself.
- [ ] #2033 becomes mergeable.

## Notes

Found while promoting 106 stories. The promotion had passed everything; the only
thing standing between it and `main` was a bookkeeping commit that told CI not to
look.
