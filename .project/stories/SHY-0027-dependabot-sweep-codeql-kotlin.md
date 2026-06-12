---
id: SHY-0027
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: XS
type: chore
roadmap_ids: [G045, G047]
pr:
mvp: true
---

# SHY-0027: Dependabot open-PR sweep + CodeQL Kotlin enable

## User Story

As the ShyTalk operator who treats Dependabot PRs as priority ([[feedback-dependabot-priority]]), I want **the current Dependabot open-PR queue swept (each merged or explicitly documented if blocked) AND CodeQL Kotlin analysis enabled (via `vars.ENABLE_CODEQL_KOTLIN`)**, so that dep security freshness + static-analysis coverage both reach their intended baselines.

## Why

Two adjacent housekeeping items bundled:

**G045**: Dependabot open PRs may have accumulated; each is a security/freshness risk if left stale. Per [[feedback-dependabot-priority]] HARD rule.

**G047**: `.github/workflows/codeql.yml:45-46` has a Kotlin analysis step gated on `vars.ENABLE_CODEQL_KOTLIN == 'true'` (currently false). Was disabled because Kotlin 2.x extractor support was incomplete; need to check current state.

Roadmap rows G045 (line 113) + G047 (line 114):

> G045: Sev: 🟡 Polish. Dep — Dependabot open PR sweep. Location: (GitHub PR queue). Gap: Open dependency PRs may be stale. Fix: `gh pr list --search "label:dependencies" --limit 30`; merge patch/minor. Scope: XS.
>
> G047: Sev: 🟡 Polish. CI — CodeQL Kotlin analysis disabled. Location: `.github/workflows/codeql.yml:45-46`. Gap: Gated on `vars.ENABLE_CODEQL_KOTLIN == 'true'` (currently false). Fix: Check action changelog for Kotlin 2.x extractor support; enable if available. Scope: XS.

P2 Tier-5 chore. Together close two housekeeping gaps.

## Acceptance Criteria

### Happy path

**G045 — Dependabot sweep:**

- [ ] Run `gh pr list --search "label:dependencies" --limit 30 --json number,title,mergeable,mergeStateStatus,statusCheckRollup --jq '.[] | {n: .number, t: .title, m: .mergeStateStatus}'` to enumerate open Dependabot PRs.
- [ ] For each: if CI green + patch/minor + non-major version bump → merge.
- [ ] If CI red → investigate, fix, merge OR mark blocked with documented reason.
- [ ] Major version bumps left for human review (do NOT auto-merge per existing `.github/workflows/dependabot-auto-merge.yml` config).
- [ ] Post-sweep: `gh pr list --search "label:dependencies"` returns only major-bump PRs OR documented-blocked PRs.

**G047 — CodeQL Kotlin enable:**

- [ ] Check current state of `github/codeql-action` Kotlin extractor (release notes or `gh api repos/github/codeql-action/releases`).
- [ ] If Kotlin 2.x extractor supports our codebase: set repo variable `ENABLE_CODEQL_KOTLIN=true` via `gh variable set ENABLE_CODEQL_KOTLIN --body "true"`.
- [ ] Verify CodeQL workflow now runs Kotlin analysis on next push.
- [ ] If Kotlin extractor still incomplete: document in `.github/workflows/codeql.yml` comment with version checked + reason; revisit when next version drops.

### Error paths

- [ ] Dependabot PR fails CI on rebase → investigate root cause; fix in this PR if trivial OR file follow-up SHY.
- [ ] CodeQL Kotlin enable surfaces extractor crash → disable, document, file upstream issue.
- [ ] Major-bump PR mis-classified as patch → reviewer agent catches; don't auto-merge.

### Edge cases

- [ ] Dependabot PR has merge conflict → rebase via `gh pr edit --add-comment "@dependabot recreate"`; if fails twice, manual fix per [[feedback-dependabot-rebase-fallback]].
- [ ] CodeQL Kotlin enable causes existing CodeQL JavaScript analysis to slow down → document tolerable; investigate if >2× slowdown.
- [ ] Repo variable already set incorrectly → unset + reset.

### Performance

- [ ] Sweep completes within 30 min (limited by CI runtime per PR).
- [ ] CodeQL Kotlin adds <5 min to existing CodeQL workflow.

### Security

- [ ] Each merged dep verified for known CVEs via `gh pr view <N> --json title` + brief check of changelog.
- [ ] CodeQL Kotlin coverage closes a real gap (Android-side code currently un-analysed).
- [ ] No suppression of CodeQL findings introduced.

### UX

- [ ] N/A — operator-side hygiene.

### i18n

- [ ] N/A.

### Observability

- [ ] PR description lists every Dependabot PR swept + outcome (merged / blocked).
- [ ] PR description lists CodeQL Kotlin status (enabled with check ID / deferred with reason).
- [ ] Follow-up issues filed for any blocked items.

## BDD Scenarios

**Scenario: Dependabot sweep merges patch + minor bumps**

- **Given** `gh pr list --search "label:dependencies"` shows 5 open PRs (3 patch, 1 minor, 1 major)
- **When** the sweep runs
- **Then** the 3 patch + 1 minor are merged (CI green)
- **And** the major is left for human review with the rationale documented
- **And** post-sweep, only the major remains in the queue

**Scenario: CodeQL Kotlin enabled**

- **Given** github/codeql-action's latest release supports Kotlin 2.4.x extractor
- **When** `gh variable set ENABLE_CODEQL_KOTLIN --body "true"` runs
- **Then** the next push triggers CodeQL with Kotlin language
- **And** no extractor crash observed
- **And** any findings appear in Security tab

**Scenario: CodeQL Kotlin deferred with reason**

- **Given** extractor still incomplete for our Kotlin version
- **When** the SHY closes
- **Then** the `codeql.yml` comment names the extractor version checked + reason
- **And** a follow-up SHY is filed referencing the upstream issue tracker URL

**Scenario: Stale Dependabot PR with merge conflict**

- **Given** a Dependabot PR with merge conflict
- **When** `@dependabot recreate` is commented twice
- **Then** if still conflicting, manual rebase fix per [[feedback-dependabot-rebase-fallback]]
- **And** outcome documented in this PR's description

## Test Plan (TDD)

### Red

This is a process chore — TDD's "Red" state is procedural confirmation of the pre-condition (work-to-do exists), not a failing test file. No test file is expected for the sweep itself.

1. List current Dependabot PRs via `gh pr list --search "label:dependencies" --limit 30`; count > 0 → there's work to do (RED state confirmed).
2. Check `vars.ENABLE_CODEQL_KOTLIN` value via `gh variable list`; currently false → CodeQL Kotlin gap confirmed (RED state confirmed).
3. (Optional, if scope expands) Add an actual test in `express-api/tests/workflows/codeql-config.test.js` asserting that when `ENABLE_CODEQL_KOTLIN` is `true`, the CodeQL workflow includes Kotlin in its language matrix.

### Green

1. Sweep Dependabot PRs (merge patch/minor; leave major).
2. Check extractor; if good, set var; verify next CodeQL run.
3. Update Notes log with outcomes.

## Out of Scope

- **Updating individual deps proactively** (beyond what Dependabot already proposed).
- **Refactoring CodeQL workflow structure** — only enable Kotlin flag.
- **Custom CodeQL queries** — only built-in.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- `.github/workflows/dependabot-auto-merge.yml` — existing infrastructure.
- `gh` CLI auth.

## Risks & Mitigations

- **Risk:** Multiple Dependabot PRs merging in rapid succession trigger CI overload. **Mitigation:** merge one at a time; verify each green before next; honour SHY-0031 gh-pages serialization.
- **Risk:** CodeQL Kotlin discovers many findings at once; triage scope balloons. **Mitigation:** GOOD outcome — fix critical ones in this PR; file follow-up SHYs for the rest.
- **Risk:** Repo variable doesn't exist yet (needs creating). **Mitigation:** `gh variable set` creates if absent.

## Definition of Done

- [ ] Dependabot queue swept; PR description lists outcomes.
- [ ] CodeQL Kotlin either enabled OR deferred with documented reason.
- [ ] Any blocked items have follow-up SHYs filed.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`chore` → auto-merge once green).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; sweep summary in Notes.

## Notes (running log)

- 2026-06-07 ~21:14 BST — Refined under SHY-0032. Tier 5 chore.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-I5` (G045, G047).
