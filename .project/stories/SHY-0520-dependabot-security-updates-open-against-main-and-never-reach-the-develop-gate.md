---
id: SHY-0520
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0520: Dependabot security updates open against main and never reach the develop gate

## User Story

As **the operator who never merges into `main` directly**, I want a
Dependabot security update that opens against `main` to be moved onto
`develop` automatically and put through the same checks and auto-merge as
every other dependency update, so that a high-severity fix lands within the
hour instead of sitting on a pull request nothing is allowed to merge.

## Why

SHY-0242 set `target-branch: develop` on all four Dependabot ecosystems, and
version updates have flowed through `develop` since (#2104–#2117). **Security
updates ignore that setting**: GitHub raises them against the default branch
only. PR #2134 (`fast-uri` 3.1.5 → 3.1.7, four high alerts) therefore opened
against `main` on 2026-09-03 with its checks green and no way to merge it under
the branching rule. On 2026-09-04 it was retargeted by hand — and a base change
fires no `pull_request` event, so it also had to be closed and reopened before
`pr-checks.yml` and `dependabot-auto-merge.yml` would run against `develop`.
Every future security update will do exactly the same. This is a class.

**Design.** A new workflow `dependabot-retarget-security-updates.yml`:

- `on: pull_request_target` with `types: [opened]` and `branches: [main]`;
  job `if: github.event.pull_request.user.login == 'dependabot[bot]'`.
  `pull_request_target` is used only for its write token; the job checks out
  nothing and runs no code from the pull request.
- Mints the Release App token (`actions/create-github-app-token`, the SHA
  `release.yml` and `sync-roadmap-data.yml` pin). Actions taken with the
  default `GITHUB_TOKEN` create no further workflow runs, so the reopen below
  would start no checks; the App identity does.
- `gh pr edit --base develop`, then `gh pr close` and `gh pr reopen` with the
  App token. The `reopened` event starts `pr-checks.yml`,
  `branch-discipline-check.yml` and `dependabot-auto-merge.yml` against
  `develop`, and the existing auto-merge rules take it from there (a patch or
  minor security bump auto-merges on green; a major waits for a human, as
  today).
- Polls `gh pr checks` for up to two minutes; if no check has started, the
  job fails loudly and comments on the PR naming this story, rather than
  leaving a silently stranded update.

## Acceptance Criteria

### Happy path

- [ ] A Dependabot PR opened against `main` is retargeted to `develop` within
      a minute of opening, with a PR comment stating the retarget and the
      reason (security updates target the default branch).
- [ ] After the retarget, `PR Checks`, `Branch discipline check` and
      `Dependabot Auto-merge` all run against `develop` without any human
      action; a patch or minor update auto-approves and auto-merges on green.
- [ ] Dependabot PRs that already target `develop` are untouched.

### Error paths

- [ ] If no check has started two minutes after the reopen, the job fails and
      comments on the PR naming SHY-0520 and the manual steps.
- [ ] If the PR is not mergeable onto `develop` (lockfile conflict), the job
      comments `@dependabot rebase` with the App token and still fails loud
      if no rebase push arrives within five minutes.
- [ ] A PR from any author other than `dependabot[bot]` is skipped by the job
      condition; the workflow never edits a human's PR.

### Edge cases

- [ ] A Dependabot PR against `main` that a human retargeted before the
      workflow ran is left alone (base already `develop`).
- [ ] A Dependabot PR against a release branch (`release/*`) is not
      retargeted; only `main` is matched.
- [ ] A reopen by the workflow does not loop: `types: [opened]` only, and the
      job condition excludes its own actor.

### Performance

- [ ] The job finishes in under three minutes including the poll; no checkout,
      no dependency install.

### Security

- [ ] `pull_request_target` grants a write token, so the job must never check
      out or execute pull-request code; `express-api/tests/scripts/dependabot-retarget-security-updates.test.js`
      asserts there is no `actions/checkout` step and no `run:` that references
      `github.event.pull_request.head`.
- [ ] `permissions:` is the minimum: `pull-requests: write`, `contents: read`.
- [ ] Every action is SHA-pinned; the App-token action SHA equals the one in
      `release.yml` (cross-workflow parity, as the roadmap workflow test does).

### UX

- [ ] The operator sees one comment per retargeted PR explaining what
      happened and why, in plain English, with the story id.

### i18n

- [ ] N/A — CI tooling, English only.

### Observability

- [ ] The step summary records the PR number, old and new base, and whether
      checks started; exit codes 0 (done), 1 (stranded, commented).

## BDD Scenarios

**Scenario: A security fix opened against the release branch is moved and checked**

- **Given** Dependabot opened a security update against the release branch
- **When** the update is opened
- **Then** it is moved to the integration branch and its checks start there

**Scenario: A small security fix lands without a human**

- **Given** a security update on the integration branch that bumps a patch version
- **When** its checks pass
- **Then** it is approved and merged automatically

**Scenario: A stranded update is announced, not hidden**

- **Given** a security update was moved to the integration branch but its checks did not start
- **When** two minutes have passed
- **Then** the job fails and a comment on the update says what to do next

**Scenario: A person's pull request is never touched**

- **Given** a pull request opened by a person against the release branch
- **When** the workflow runs
- **Then** the pull request's target branch is unchanged

## Test Plan

### Red

- `express-api/tests/scripts/dependabot-retarget-security-updates.test.js`:
  trigger is `pull_request_target` on `main` with `types: [opened]`; job
  condition names `dependabot[bot]`; permissions are exactly
  `pull-requests: write` and `contents: read`; no `actions/checkout`; no
  reference to `github.event.pull_request.head`; App-token step SHA equals
  `release.yml`'s; the run block edits the base to `develop`, closes and
  reopens with the App token, and polls `gh pr checks`; `timeout-minutes` set.
- `express-api/tests/scripts/dependabot-auto-merge-decision.test.js` —
  unchanged and green.

### Green

- The workflow file, roughly forty lines, following `sync-roadmap-data.yml`'s
  App-token pattern.

## Out of Scope

- Changing `pr-checks.yml` or `dependabot-auto-merge.yml` to react to
  `edited` events (a retarget alone) — broader CI change, not needed once the
  reopen path exists.
- Dependabot version updates (already target `develop`, SHY-0242).
- Auto-merging major security bumps (a major must boot the app first —
  standing rule).

## Dependencies

- `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets (exist; used by
  `release.yml` and `sync-roadmap-data.yml`).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `pull_request_target` is a known injection surface | No checkout, no PR-controlled input in `run:`; the test pins both; the job only edits PR metadata with `gh`. |
| Closing a Dependabot PR makes Dependabot treat the update as dismissed | It is reopened in the same job seconds later; Dependabot keeps managing a reopened PR. Verified on #2134 on 2026-09-04 (reopened by hand, checks started). If a future Dependabot change breaks this, the two-minute poll fails loud. |
| The App token's events do not start checks either | Then the poll fails loud with the manual steps; the story is not Done until the first real security PR after merge has auto-merged, recorded in Notes. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The first Dependabot security PR opened after the merge is retargeted,
      checked and (if patch/minor) merged with no human action; its number and
      the run id recorded in Notes.

## Notes

- **2026-09-04** — Found on PR #2134 (four high `fast-uri` alerts) during the
  EPIC-0013 handover checks. Retargeted, closed and reopened by hand to prove
  the reopen path starts checks on `develop`; this story removes the hand.
