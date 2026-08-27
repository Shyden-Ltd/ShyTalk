---
id: SHY-0478
status: Draft
owner: unassigned
created: 2026-08-27
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0478: A promotion PR must not use develop as its head branch

## User Story

As **whoever promotes develop to main**, I want the integration branch to still
exist after the release, so that success does not delete the branch every other
piece of work depends on.

## Why

The repository has `deleteBranchOnMerge = true`. A promotion PR's **head branch
is `develop`**. So merging a promotion deletes the integration branch at the
exact moment the release succeeds.

Observed 2026-08-27 promoting 333 commits / 106 stories. `gh pr merge --merge`
was run with **no** `--delete-branch` flag, and immediately afterwards:

```
develop branch alive: 0
```

Nothing warned. The merge reported success, and the branch every open PR targets
had gone.

### Restoring it is not simply a push

`develop`'s ruleset requires `Detect Changes`, `Analyze JavaScript` and
`PR Gate`, and a freshly created branch has none of them:

```
remote: - 3 of 3 required status checks have not succeeded: 2 expected.
```

It has to be recreated as a **ref**, at the commit that was its head — one that
already carries those checks green:

```
gh api repos/O/R/git/refs -X POST \
  -f ref='refs/heads/develop' -f sha="$(git rev-parse <last-develop-head>)"
```

That worked, and develop is back. But the recovery depends on knowing the old
head SHA, which nobody records because nobody expects to need it.

## Acceptance Criteria

### Happy path

- [ ] Merging a promotion leaves `develop` present.
- [ ] The promotion still lands on `main` as a merge commit, preserving
      ancestry as today.

### Error paths

- [ ] If the integration branch is missing, something says so rather than the
      next push failing on an unrelated rule.

### Edge cases

- [ ] A promotion that is closed without merging leaves no debris.
- [ ] The release cut still refuses to bump on top of a release commit.

### Performance

- [ ] None.

### Security

- [ ] The branch protection on develop is unchanged. The fix must not work by
      relaxing a rule.

### UX

- [ ] The release runbook names the head branch, so the next person does not
      re-derive this.

### i18n

- [ ] None.

### Observability

- [ ] A post-promotion check reports the presence of `develop` and its distance
      from `main`.

## BDD Scenarios

**Scenario: A release does not remove the working branch**

- **Given** a release ready to go out
- **When** it is released
- **Then** the team's shared branch is still there

## Test Plan

| Layer | What it proves |
| --- | --- |
| Workflow test | The promotion is opened from a release branch, not from develop. |
| Live (next release) | `develop` present after the merge. |
| Live (next release) | `main..develop` distance is 0 after the sync-down. |

## Out of Scope

- Turning `deleteBranchOnMerge` off repo-wide. It would fix this, but every
  story branch would then need tidying by hand — a wider change than the
  problem, and an operator decision.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** a `release/x.y.z` branch adds a step people forget.
  **Mitigation:** it is scripted, and the runbook names it.
- **Risk:** the extra branch drifts from develop between cut and merge.
  **Mitigation:** it is cut at promotion time and merged immediately; anything
  landing meanwhile belongs to the next release by definition.

## Definition of Done

- [ ] A promotion is opened from a disposable head branch.
- [ ] `develop` survives a real promotion.
- [ ] The runbook says which branch and why.

## Notes

Recommended shape: cut `release/x.y.z` from develop, open the promotion PR from
**that**, and let auto-delete remove it. `develop` is then never a PR head, and
the setting stays on for the story branches it was enabled for.

Recovery, if it happens again: develop's last head is the promotion merge
commit's **second parent** — `git rev-list --parents -n1 <merge>` — so the SHA is
recoverable from main's history even when nobody wrote it down.
