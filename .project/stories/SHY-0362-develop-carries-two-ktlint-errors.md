---
id: SHY-0362
status: In Review
owner: unassigned
created: 2026-08-20
priority: P0
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0362: develop carries two ktlint errors, so every app-touching PR fails lint

## User Story

As **a developer opening a PR that touches app code**, I want `develop` to be
lint-clean, so that my PR's red lint gate tells me about *my* change rather than
about someone else's.

## Why

`develop` currently fails ktlint on two files:

```
app/src/main/java/com/shyden/shytalk/data/repository/UserRepositoryImpl.kt:4:1: Unused import (standard:no-unused-imports)
shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosUserRepositoryImpl.kt:15:1: Unused import (standard:no-unused-imports)
```

Both are `FieldPath`. In each file the only remaining mention is **inside a
comment** describing what the code used to do:

- `UserRepositoryImpl.kt:171` — `// This used to be \`collection("users").whereIn(FieldPath.documentId(),`
- `IosUserRepositoryImpl.kt:149` — `// This used to be \`where { FieldPath.documentId inArray chunk }\` straight`

SHY-0338 (#1800, merged 2026-08-19) replaced those `whereIn(FieldPath.documentId())`
queries and left the imports behind.

**Why it went unnoticed:** the lint job is gated on `inputs.app_changed == true`,
and a branch does not re-run PR checks after merge. So the error only appears on
the *next* PR that happens to touch app code — where it reads as that PR's fault.
It was found on **#1853**, a portal/Express change that touches no Kotlin at all.

This blocks the PR queue, and by the zero-tolerance rule a lint error is a
critical build failure regardless of triviality.

## Acceptance Criteria

### Happy path

- [ ] `ktlint --relative` reports zero errors on `develop`.
- [ ] Both unused `FieldPath` imports are removed.
- [ ] The explanatory comments that mention `FieldPath` are **kept** — they
      document why the query shape changed, which is still useful.

### Error paths

- [ ] Removing the imports does not break compilation on either platform —
      Android host unit tests and the KMP iOS compile both still pass.

### Edge cases

- [ ] No other unused import is left anywhere: the whole tree is checked, not
      just these two files.
- [ ] `FieldPath` is not referenced in any non-comment position in either file.

### Performance

- [ ] N/A — removes two import lines.

### Security

- [ ] N/A — no behaviour, dependency or permission change.

### UX

- [ ] N/A — no user-visible change.

### i18n

- [ ] N/A — no strings.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: A developer's PR is judged on their own change**

- **Given** a developer opens a pull request that touches app code
- **When** the automated checks run
- **Then** the code-style check does not fail for problems they did not introduce

## Test Plan

**RED first.** `ktlint --relative` on `develop` reports exactly the two errors
above. That is the failing state, reproduced from CI job `96173798745` on #1853.

1. Run `ktlint --relative` before the fix — 2 errors.
2. Remove the imports.
3. Run `ktlint --relative` after — 0 errors.
4. Sweep the whole tree for any other unused import.
5. Compile both platforms to prove nothing depended on the imports.

## Out of Scope

- Changing the queries themselves — SHY-0338's replacement is correct and stays.
- Rewriting the historical comments beyond leaving them intact.
- Making the lint gate run on `develop` pushes so this class of drift is caught
  at merge rather than on the next PR. That is a real gap and deserves its own
  ticket; this story restores green.

## Dependencies

- Follows SHY-0338 (#1800), which introduced the unused imports.
- Blocks #1853 (SHY-0147) and any other PR whose diff sets `app_changed`.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| An import is used somewhere the grep missed | Both platforms are compiled after the change, which is the authority, not grep. |
| The same drift recurs silently | Called out in Out of Scope as its own ticket — the lint gate not running on `develop` pushes is the structural cause. |

## Definition of Done

- [ ] ktlint clean; both platforms compile.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

Reviewed-up-to: c1ada9cb530634f97ddee17c244cd9d90f3917ee

- **2026-08-20** — Found while triaging #1853's red lint gate. The failure was
  reported against a portal/Express PR that touches no Kotlin, which is what made
  it worth checking `develop` rather than the branch.
