---
id: SHY-0002
status: Done
owner: claude
created: 2026-06-06
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0001
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1035
---

# SHY-0002: Wire GitHub Issues + Projects v2 integration

## User Story

As the ShyTalk operator, I want every SHY story file (`.project/stories/SHY-NNNN-*.md`) automatically mirrored to a GitHub Issue and a GitHub Projects v2 board card — with labels for `status`, `priority`, `effort`, `type`, and each `roadmap_id`; with PR `Closes #N` auto-injection on merge; and with a CLI for catch-up / dry-run / single-story sync — so that I can see the backlog visually on GitHub, filter by any dimension, and have Issues auto-close when their PR merges, without manually maintaining a parallel tracking system.

## Why

SHY-0001 establishes the local spec (story `.md`, INDEX, validator) but the backlog is invisible to anyone reading GitHub. The operator chose GitHub Issues + Projects v2 as the tracking surface (over Linear / Jira / local-only) for:

1. **Native to where the code lives** — issue ↔ PR auto-links via `Closes #N`.
2. **Free** — no third-party billing, no extra accounts.
3. **`gh` CLI + GraphQL operable** — I can mirror via `gh issue create`, `gh project item-edit`, `gh issue edit --add-label`.
4. **Notifications + assignments + comments** — team-collaboration affordances out of the box.

The integration is delivered as SHY-0002 so SHY-0003 (roadmap → stories conversion) can auto-create issues for each of the ~25 stories it generates. Without SHY-0002 first, SHY-0003 would either ship stories with no remote visibility or do a one-time manual mirror.

Operator-confirmed earlier (2026-06-06 ~11:50 BST):

- `.md` is source of truth; issue is a derived mirror (one-way sync).
- Status changes flip labels; merge closes the issue via PR's `Closes #N`.
- The GitHub Project (v2) board's columns map to status labels.
- The integration ships as SHY-0002, BEFORE roadmap conversion (SHY-0003).

## Acceptance Criteria

### Happy path

- [ ] `scripts/sync-stories-to-issues.sh` exists, mode 755, and accepts these flags: `--all` (sync every SHY-NNNN-\*.md), `--story SHY-NNNN` (sync one), `--dry-run` (print actions without making API calls), `--help`, `--verbose`
- [ ] First run with `--all` against a directory of N story files creates N GitHub Issues (idempotent: re-running doesn't duplicate)
- [ ] Each created issue has: title `SHY-NNNN: <Story Title>`, body opening with `Spec: [SHY-NNNN-slug.md](link-to-github-blob)` followed by the `## User Story` and `## Why` sections mirrored, followed by `## Acceptance Criteria` as a GitHub task list (`- [ ]` checkboxes preserved), followed by a footer `_Last synced: <UTC timestamp> from commit <sha>_`
- [ ] Each created issue has labels applied: `story`, `status:<status>`, `priority:<priority>`, `effort:<effort>`, `type:<type>`, and one `roadmap:<G-ID>` label per roadmap entry (empty `roadmap_ids: []` produces no roadmap labels)
- [ ] Each created issue is added to a Project v2 named `ShyTalk Stories` (the operator provisions the project once; the script adds items + sets status field)
- [ ] Project v2 has custom fields `Pri` (single-select P0/P1/P2/P3), `Effort` (single-select XS/S/M/L/XL), `Type` (single-select feature/bug/refactor/docs/infra/spike/chore), `Roadmap IDs` (text), `SHY ID` (text); script sets each from the .md frontmatter
- [ ] On subsequent runs, the script detects change via SHA-256 of the file body, stored in the issue footer as `_Last synced: <UTC> from commit <sha> body-hash: <hex>_`. If the current SHA-256 differs from the stored hash, the issue is UPDATED (title/body/labels reconciled); unchanged stories are skipped with stderr log `SHY-NNNN: unchanged - skipping`. The commit-SHA alone is insufficient (mid-PR edits share the same commit) — body-hash is the canonical change-detection signal.
- [ ] On story status change to `Done`, the script closes the issue with comment `Closed by sync from SHY-NNNN (status: Done)` — but PRIORITIZES the natural close via the PR's `Closes #N`. Force-close only fires if the issue is still open after a configurable grace window (env var `SYNC_GRACE_WINDOW_SECS`, default 300). Tests inject `SYNC_GRACE_WINDOW_SECS=0` to exercise the close-decision without a real sleep.
- [ ] On story status change to `Cancelled`, the script closes the issue with reason `not_planned` and comment `Cancelled via sync from SHY-NNNN`
- [ ] A GitHub Action `.github/workflows/sync-stories-to-issues.yml` runs on push to main and invokes `scripts/sync-stories-to-issues.sh --all`; runs on PR merge so labels reconcile within seconds
- [ ] A GitHub Action `.github/workflows/inject-pr-closes.yml` runs on PR open / edit and, if the branch matches `story/SHY-NNNN-*` AND the PR body does NOT already contain `Closes #<issue-number>` for the corresponding issue, appends it
- [ ] `scripts/sync-stories-to-issues.sh --help` prints synopsis, flags, exit codes, and one example invocation
- [ ] SHY-0001's issue is auto-created on the first post-merge sync run (backfill)

### Error paths

- [ ] Missing / invalid `GITHUB_TOKEN` environment variable → exit 30, stderr `GITHUB_TOKEN missing or lacks required scopes (need: issues:write, project:write)`
- [ ] GitHub API rate limit exceeded → exit 31, stderr names the rate-limit category (core / graphql) and the reset time; the script waits-and-retries ONLY in `--all` mode (max 1 retry after rate limit reset); single-story mode exits immediately
- [ ] GitHub API 5xx (transient) → exit 32 after 3 retries with exponential backoff (1s, 2s, 4s)
- [ ] Story file fails `check-story-frontmatter.sh` validation → exit 33, stderr names the offending file + the validation reason; sync is NOT attempted for invalid stories
- [ ] Specified `--story SHY-NNNN` doesn't exist in `.project/stories/` → exit 34, stderr `SHY-NNNN: story file not found at .project/stories/SHY-NNNN-*.md`
- [ ] Project v2 named `ShyTalk Stories` not found in the org → exit 35, stderr instructs operator to provision the project with the documented schema; lists required custom fields
- [ ] Project v2 schema mismatch (custom field missing or wrong type) → exit 36, stderr names the missing/mismatched field
- [ ] Issue exists but for a DIFFERENT SHY (title mismatch on the SHY-NNNN tag) → exit 37, stderr names the conflict; sync skips that story to prevent overwriting unrelated work
- [ ] Network failure (no connectivity) → exit 38, stderr `network unreachable; retry when connection restored`

### Edge cases

- [ ] Story renamed (`SHY-0042-old-slug.md` → `SHY-0042-new-slug.md`): existing issue updated (title/body refreshed); no new issue created (SHY-ID is the key, not the filename)
- [ ] Story moved to `status: Done` but no PR has merged yet (rare — should only happen via direct frontmatter edit): script logs warning but still closes after the configurable grace window (`SYNC_GRACE_WINDOW_SECS`, default 300s)
- [ ] Story moved to `status: Cancelled`: issue closes with reason `not_planned`
- [ ] Story moved back from `Cancelled` to `Draft` (rare reactivation): issue reopened + labels reconciled
- [ ] Story with 0 `roadmap_ids` → no roadmap labels applied (no error)
- [ ] Story with 10+ `roadmap_ids` → all 10+ labels applied; sync time stays within performance bounds
- [ ] Existing issue created MANUALLY before sync (operator created `Issue #5: SHY-0001: ...` by hand): script DETECTS the existing issue by parsing the `SHY-NNNN:` prefix in the title; idempotent — does not duplicate; reconciles labels and body
- [ ] Issue MANUALLY edited (operator added a comment / changed a label by hand): comments preserved; labels reconciled (sync IS authoritative for labels managed by sync — `status:*`, `priority:*`, `effort:*`, `type:*`, `roadmap:*`, `story`); other labels (operator-added `wontfix`, `help-wanted`) preserved
- [ ] AC checkbox state divergence: story `.md` AC shows `- [ ]` but issue's mirrored task list shows `- [x]`. Sync OVERWRITES with .md state (one-way sync; .md is source of truth). Operator MUST check boxes in the .md file, not on the GitHub UI. Documented in CLAUDE.md § "Agile Way of Working" under "GitHub Issues mirror".
- [ ] Story file deleted from `.project/stories/`: existing issue is NOT auto-closed (story might be temporarily missing on a feature branch); script logs `SHY-NNNN: story file missing; issue left untouched`
- [ ] Duplicate SHY ID across two files (operator collision): script exits 39 with `duplicate SHY ID detected at <path1> and <path2>`; no sync proceeds
- [ ] Concurrent sync runs (two CI jobs simultaneously) are prevented by the workflow-level `concurrency:` group `sync-stories-${{ github.ref }}` with `cancel-in-progress: false` — GitHub Actions guarantees only one workflow run per group at a time. No application-level lock label is used (a label-based lock has a TOCTOU race — workflow `concurrency:` is the only race-free mechanism).

### Performance

- [ ] Single-story sync: <5s wall-clock (one API call cluster: get issue, diff, possibly update)
- [ ] Bulk sync (30 stories): <60s wall-clock on a warm cache (most stories unchanged); <180s on a cold cache (every story needs API call)
- [ ] GitHub API budget: <50 REST calls per `--all` run on a 30-story directory (≤2 calls per story average; well within the 5000/hr core rate limit)
- [ ] GraphQL calls for Project v2 mutations: <30 per `--all` run on 30 stories (well within the 5000/hr GraphQL limit)
- [ ] Memory: <100MB resident (parsing JSON responses); verified via `/usr/bin/time -v`
- [ ] CI workflow `sync-stories-to-issues.yml` completes in <90s for typical post-merge runs

### Security

- [ ] A dedicated PAT (secret name: `GH_PAT_PROJECT`) with scopes `issues:write`, `pull-requests:write`, and `project:write` is required. GitHub Actions' automatic `GITHUB_TOKEN` cannot carry `project:write` — the auto-token is provisioned at job-start and does NOT include Projects v2 scopes. Operator action: create a fine-grained PAT at https://github.com/settings/tokens scoped to `Shyden-Ltd/ShyTalk` with the three permissions above, then register it as repository secret `GH_PAT_PROJECT` before first sync run. All workflow YAML references `${{ secrets.GH_PAT_PROJECT }}`, NOT `GITHUB_TOKEN`, for Issues + Projects v2 API calls.
- [ ] No secrets logged to stdout or stderr (mask via `echo "::add-mask::"` in GitHub Actions; sed-strip in local CLI)
- [ ] Story content mirrored to issue is already public-repo content; no new exfiltration surface
- [ ] Script does NOT execute story file content (no `eval` of mirrored body)
- [ ] CLI mode requires explicit token via `GITHUB_TOKEN` env var; never reads `.netrc` or other auth files (avoids accidental personal-token use)
- [ ] PR-body injection step verifies the PR is from a trusted branch (`story/SHY-NNNN-*` pattern) before mutating; rejects PR-body mutation on fork PRs

### UX

- [ ] Sync output is structured per story: one line on stderr per story:
  - `SHY-0001: created issue #5 (https://github.com/<org>/<repo>/issues/5)`
  - `SHY-0002: updated issue #6 (labels reconciled, body refreshed)`
  - `SHY-0003: unchanged - skipping`
  - `SHY-0042: closed issue #N (status: Done)`
- [ ] `--dry-run` prints every action that WOULD be taken (issue created/updated/closed; labels added/removed; project fields set) without making any API mutation
- [ ] `--verbose` prints API calls + payloads (token redacted) for debugging
- [ ] Error messages include actionable next steps (e.g. "run `gh auth login` to authenticate" for exit 30)
- [ ] On `--all` failure mid-run, the script reports `N succeeded, M failed; rerun with --story <ID>` so operator can target retries
- [ ] `--help` includes 3 example invocations: sync all, sync one, dry-run all

### i18n

- [ ] Issue title and body tolerate Unicode from story content (emoji, CJK, RTL); GitHub natively renders Unicode markdown
- [ ] Label names use ASCII only (`status:in-progress` not `status:進行中`) — GitHub Issues filter UI works best with ASCII labels
- [ ] CLI's own stderr is English (CI logs are English by convention)
- [ ] Script works correctly under `LC_ALL=C`, `LC_ALL=en_GB.UTF-8`, `LC_ALL=ja_JP.UTF-8` (no locale-dependent string comparisons)

### Observability

- [ ] Exit codes are documented in `--help` and in CLAUDE.md:
  - 0 = success (all stories synced or unchanged)
  - 2 = usage error
  - 30 = missing/invalid GITHUB_TOKEN
  - 31 = rate limit hit (with reset time in stderr)
  - 32 = GitHub API 5xx after retries
  - 33 = story file failed frontmatter validation
  - 34 = `--story SHY-NNNN` story file not found
  - 35 = Project v2 not provisioned
  - 36 = Project v2 schema mismatch
  - 37 = SHY-ID title-tag conflict on existing issue
  - 38 = network failure
  - 39 = duplicate SHY ID across two files
- [ ] Stderr is structured: `<story-id>: <category-name>: <details>` for per-story events; `<global-category>: <details>` for global failures
- [ ] CI workflow logs include a summary line (`Sync result: N created, M updated, K skipped, X failed`) that can be parsed by downstream tooling
- [ ] On any failure, the sync writes a summary JSON to `/tmp/sync-stories-result.json` (when invoked locally) for operator inspection

## BDD Scenarios

### Story-author / operator scenarios

**Scenario: First-run sync creates an issue for every story**

- **Given** the operator has provisioned the `ShyTalk Stories` Project v2 with all 5 required custom fields
- **And** `.project/stories/` contains SHY-0001, SHY-0002, SHY-0003 (each well-formed, validator-clean)
- **When** the operator runs `scripts/sync-stories-to-issues.sh --all` with a valid `GITHUB_TOKEN`
- **Then** 3 GitHub Issues are created with titles `SHY-0001: …`, `SHY-0002: …`, `SHY-0003: …`
- **And** each issue has labels `story` + `status:draft` + `priority:p1` + `effort:m` + `type:infra`
- **And** each issue is added to the Project v2 board in the `Draft` column
- **And** the script exits 0
- **And** stderr lists `SHY-0001: created issue #N (url)` for each story

**Scenario: Second run is idempotent — unchanged stories are skipped**

- **Given** the first sync run created issues for SHY-0001 through SHY-0003
- **And** no story file has changed since
- **When** the operator runs `--all` again
- **Then** the script detects each issue exists (by parsing title for `SHY-NNNN:` tag)
- **And** the script compares the issue body footer's `Last synced: … from commit <sha>` against the current HEAD
- **And** stderr prints `SHY-NNNN: unchanged - skipping` for each story
- **And** zero issues are created or updated
- **And** exit code is 0

**Scenario: Story `status` change propagates as a label flip**

- **Given** SHY-0001's frontmatter is updated from `status: Draft` to `status: In Progress`
- **And** the script is re-run
- **When** the sync processes SHY-0001
- **Then** the issue's `status:draft` label is removed
- **And** `status:in-progress` is added
- **And** the Project v2 status field is updated to `In Progress`
- **And** stderr prints `SHY-0001: updated issue #N (labels reconciled)`

**Scenario: PR merge closes the issue via `Closes #N`**

- **Given** SHY-0001 has issue #5 in `status:in-review`
- **And** a PR titled `SHY-0001: Establish Agile workflow` exists with body containing `Closes #5`
- **When** the PR auto-merges
- **Then** GitHub closes issue #5 automatically (native `Closes` behavior)
- **And** the next sync run detects the closed issue and logs `SHY-NNNN: issue #N already closed (natural close via PR)`. No `.md` write-back (bidirectional sync is Out of Scope). Operator manually flips `status: Done` in the frontmatter via their normal lifecycle update.
- **And** the Project v2 card moves to the `Done` column

**Scenario: PR-body `Closes #N` injection fires on PR open**

- **Given** a developer pushes a branch `story/SHY-0001-establish-agile-workflow` and opens a PR titled `SHY-0001: …`
- **And** the PR body does NOT yet contain `Closes #<N>`
- **When** the `inject-pr-closes.yml` GitHub Action runs
- **Then** the action looks up the issue with title prefix `SHY-0001:` in the repo
- **And** the action appends `\n\nCloses #N` to the PR body
- **And** the PR's checks-tab event log records the injection

**Scenario: Operator runs `--dry-run` before bulk sync**

- **Given** the operator wants to verify what the sync would do
- **When** they run `scripts/sync-stories-to-issues.sh --all --dry-run`
- **Then** every action is printed to stderr with prefix `DRY-RUN:`
- **And** NO GitHub API mutations occur (verified by inspecting `gh api rate_limit` before and after)
- **And** exit code is 0

**Scenario: Operator targets one story with `--story`**

- **Given** the operator just edited SHY-0042 and wants to sync only it
- **When** they run `--story SHY-0042`
- **Then** only SHY-0042 is processed
- **And** stderr prints `SHY-0042: updated issue #N`
- **And** exit code is 0

### Error / adversarial scenarios

**Scenario: Missing `GITHUB_TOKEN` exits clearly**

- **Given** `GITHUB_TOKEN` is unset
- **When** the script runs
- **Then** exit code is 30
- **And** stderr contains `GITHUB_TOKEN missing or lacks required scopes (need: issues:write, project:write)`
- **And** stderr suggests `gh auth login` or `export GITHUB_TOKEN=…`

**Scenario: Rate limit hit during bulk sync**

- **Given** the operator runs `--all` against 200 stories
- **And** halfway through, the GitHub API returns 403 with `X-RateLimit-Remaining: 0`
- **When** the script hits the rate limit
- **Then** stderr prints `rate limit hit at SHY-0100; reset in M minutes`
- **And** the script sleeps until reset (max 60 min cap)
- **And** resumes from SHY-0101 (no re-sync of already-processed stories)
- **And** exits 0 on completion or exits 31 if the cap is exceeded

**Scenario: Manually-created issue is detected and reconciled, not duplicated**

- **Given** the operator manually created Issue #99 with title `SHY-0001: Establish Agile workflow` before SHY-0002 ever ran
- **When** the first sync runs
- **Then** the script lists open issues, finds #99 by title prefix `SHY-0001:`
- **And** updates #99's body to the mirrored format
- **And** applies the SHY-0001 label set
- **And** does NOT create a duplicate issue
- **And** stderr prints `SHY-0001: reconciled with existing issue #99`

**Scenario: Story marked `Cancelled` closes the issue with `not_planned`**

- **Given** SHY-0042 frontmatter is changed to `status: Cancelled`
- **And** the issue #N for SHY-0042 is open
- **When** the sync runs
- **Then** the script calls `gh issue close N --reason not-planned`
- **And** posts a comment `Cancelled via sync from SHY-0042`
- **And** the Project v2 card moves to the `Cancelled` column
- **And** stderr prints `SHY-0042: closed issue #N (reason: not_planned)`

**Scenario: Duplicate SHY ID across two files exits 39 without mutation**

- **Given** `.project/stories/` contains two files with the same `id: SHY-0042`
- **When** the sync runs
- **Then** the script exits 39
- **And** stderr names both file paths
- **And** ZERO API mutations occur
- **And** stderr instructs the operator to delete or renumber one of the files

**Scenario: Validator-failing story is skipped without API mutation**

- **Given** SHY-0099 has invalid frontmatter (`status: pending`)
- **And** the sync is run
- **When** the script processes SHY-0099
- **Then** it invokes `scripts/check-story-frontmatter.sh` per story first
- **And** SHY-0099 fails validation (exit 11 from the validator)
- **And** the sync skips SHY-0099 with stderr `SHY-0099: validation failed (status invalid); skipping`
- **And** continues with other stories
- **And** the final exit code reflects partial success (exit 0 if other stories synced; otherwise 33)

**Scenario: Concurrent sync runs serialise via workflow `concurrency:` group**

- **Given** two CI jobs would trigger `sync-stories-to-issues.yml` against the same ref at the same time
- **When** both jobs queue
- **Then** GitHub Actions' workflow-level `concurrency:` group `sync-stories-${{ github.ref }}` queues the second job (per GitHub's documented behavior: only one run per concurrency group at a time)
- **And** the second job stays in `queued` state until the first completes
- **And** the first completes normally; the second then runs against the now-current state (idempotent — finds no changes if first already synced everything)
- **And** no application-level lock label is used (label-based locks have a TOCTOU race; workflow `concurrency:` is the only race-free mechanism)

### CI / GitHub Action scenarios

**Scenario: `sync-stories-to-issues.yml` runs on push to main**

- **Given** SHY-0001 was just merged to main
- **When** the push triggers `sync-stories-to-issues.yml`
- **Then** the workflow checks out main, runs `scripts/sync-stories-to-issues.sh --all`
- **And** the workflow logs include the sync summary line
- **And** the workflow exits 0 on success

**Scenario: `inject-pr-closes.yml` does NOT mutate fork PRs**

- **Given** an external contributor opens a PR from a fork branch `story/SHY-0099-contribution`
- **When** the `inject-pr-closes.yml` workflow runs
- **Then** the workflow detects the fork origin
- **And** skips the body mutation (security — prevents fork PR exfiltrating data via crafted issue references)
- **And** exits 0 with workflow log entry `SKIP: fork PR detected; no API mutations possible on fork PRs under pull_request trigger (token is read-only)`. The contributor must add `Closes #N` manually. (Note: we cannot post a comment on fork PRs either — GitHub provisions a read-only token for `pull_request` events from forks.)

## Test Plan (TDD)

### Red — write failing tests FIRST

Create `express-api/tests/scripts/sync-stories-to-issues.test.js` with cases below. Tests mock the GitHub API (using `nock` or `msw` — pick whatever is already in the project; if neither, use a simple `fetch` mock). Initial run fails because `scripts/sync-stories-to-issues.sh` doesn't exist.

**Sync mechanics (8 tests):**

- `it('creates an issue per story on first run')`
- `it('is idempotent: second run with no changes makes zero API mutations')`
- `it('updates issue when story title changes')`
- `it('updates issue when AC changes (body diff)')`
- `it('flips status label on frontmatter status change')`
- `it('flips priority label on priority change')`
- `it('applies roadmap_ids as multiple labels')`
- `it('rec­onciles existing manually-created issue by SHY-NNNN: title prefix')`

**Project v2 (4 tests):**

- `it('adds new issue to Project v2 with correct field values')`
- `it('updates Project v2 status field when issue label flips')`
- `it('exits 35 when Project v2 not provisioned')`
- `it('exits 36 when Project v2 schema mismatch')`

**Error paths (10 tests):** one per exit code (30 through 39)

**Edge cases (7 tests):**

- `it('rename preserves issue (same SHY-ID)')`
- `it('Done status closes issue with grace window')`
- `it('Cancelled status closes issue with not_planned reason')`
- `it('reactivation from Cancelled reopens issue')`
- `it('empty roadmap_ids produces no roadmap labels')`
- `it('10 roadmap_ids produces 10 roadmap labels')`
- `it('deleted story file leaves issue untouched')`

**CLI flags (5 tests):**

- `it('--dry-run makes zero API mutations')`
- `it('--story SHY-NNNN processes only that story')`
- `it('--help exits 0 and prints all 12 exit codes')`
- `it('--verbose prints API calls with redacted token')`
- `it('--all without --story processes every story')`

**Security (4 tests):**

- `it('rejects token without issues:write scope')`
- `it('does not log token in stderr or stdout')`
- `it('skips PR-body injection on fork PRs')`
- `it('does not execute story content')`

**Performance (3 tests):**

- `it('single-story sync completes in <5s (mocked API)')`
- `it('bulk sync of 30 stories completes in <60s warm-cache (mocked API)')`
- `it('uses <50 REST calls for 30-story bulk sync')`

**GitHub Action integration (3 tests):**

- `it('sync-stories-to-issues.yml has correct on: push to main trigger')`
- `it('inject-pr-closes.yml only runs on PRs from non-fork branches')`
- `it('workflow YAML passes actionlint')`

Fixtures: ~25 story files for variations, mocked API responses for each scenario, sample Project v2 schema, sample PR webhook payloads.

### Green — implement until red flips

1. **Create `scripts/sync-stories-to-issues.sh`** — bash 3.2-compatible; uses `gh issue` + `gh api graphql` for Project v2 mutations; sequential per-story processing; sectional awk parsing of frontmatter (reuse logic from `scripts/check-story-frontmatter.sh`)
2. **Create `.github/workflows/sync-stories-to-issues.yml`** — triggers `on: push to main` + `on: pull_request closed merged` + manual `workflow_dispatch`; runs `scripts/sync-stories-to-issues.sh --all`
3. **Create `.github/workflows/inject-pr-closes.yml`** — triggers `on: pull_request opened, edited`; greps the branch name for `story/SHY-NNNN-*`; looks up issue by SHY-NNNN title prefix; appends `Closes #N` if absent
4. **Update `CLAUDE.md`** — add a subsection under `## Agile Way of Working` documenting: the GitHub mirror direction (one-way), the labels list, the `Closes #N` injection, the manual operator action (provision Project v2 with the listed schema)
5. Run Jest tests — all red flip green
6. Run `shellcheck scripts/sync-stories-to-issues.sh` and `actionlint .github/workflows/*.yml` — both clean

## Out of Scope

- Bidirectional sync (issue → story file). Future enhancement if operator-edit-on-GitHub becomes a real workflow.
- Sync of comments / discussion (issues collect comments; story Notes log captures key events; they're DIFFERENT streams).
- Backfill of HISTORICAL closed PRs (the 12 from overnight) as issues. They merged before SHY-0002 existed; no retroactive tracking.
- A web UI for viewing the sync log (GitHub Action logs + the `/tmp/sync-stories-result.json` are sufficient).
- Multi-org / multi-repo sync (this script targets ONE repo's `.project/stories/` → ONE repo's Issues).
- Auto-provisioning of the Project v2 (operator does this once; script validates schema).
- Sync of `SHY-INDEX.md` to a special meta-issue (the index is local-only; humans read it).

## Dependencies

- **Blocks:** SHY-0003 (roadmap conversion benefits from auto-issue-creation; can run without it but would mirror later)
- **Blocked by:** SHY-0001 (the frontmatter validator must exist; sync calls it per story before mutating)
- **Blocked by:** Repo migration to company GitHub org (per 2026-06-06 ~12:15 BST operator directive). The Project v2 will be provisioned in the company org. Once migration completes, this story can proceed.
- **Tool-version assumptions:** `gh` CLI ≥ 2.40 (Project v2 GraphQL support); `jq` for response parsing; bash 3.2+. All present in CI's ubuntu-latest image and on the operator's macOS.

## Risks & Mitigations

- **Risk:** GitHub API rate limit hit during a large bulk sync. **Mitigation:** Sequential processing; back-off + resume; documented rate-limit awareness per [[feedback-api-rate-limit-awareness]]. Cap on retry wait (60 min).
- **Risk:** Sync overwrites operator's manual issue edits. **Mitigation:** Sync owns the labels in the SHY namespace (`status:*`, `priority:*`, etc.); operator-added labels (`wontfix`, `help-wanted`) preserved; issue body's `## Acceptance Criteria` task list IS overwritten (documented; operator instructed to check boxes in the .md, not on GitHub).
- **Risk:** Race between PR `Closes #N` natural close and sync's status-flip-then-close. **Mitigation:** 5-minute grace window — script only force-closes if issue is still open after the natural close timeout.
- **Risk:** Fork PR exploitation of `inject-pr-closes.yml`. **Mitigation:** Workflow skips body mutation on fork PRs; documented; tested.
- **Risk:** Project v2 schema drift if operator changes field types. **Mitigation:** Script validates schema on every run; exits 36 with descriptive message.
- **Risk:** Duplicate SHY ID across files (typo). **Mitigation:** Exit 39 before any API mutation; named in both file paths.
- **Risk:** Sync of `Done` status before PR merges (operator manually flipped status). **Mitigation:** 5-minute grace window for natural-close; otherwise sync closes with comment.
- **Risk:** Cyclic dependency between sync workflow and validator workflow. **Mitigation:** Sync depends on `check-story-frontmatter.sh` from SHY-0001; SHY-0001 must merge first. Encoded in `Blocked by:`.
- **Risk:** Project v2 GraphQL API instability. **Mitigation:** Pin to documented API version; abstract API calls behind helper functions; one schema-validation test per release.
- **Risk:** Concurrent CI runs both invoke `--all` simultaneously. **Mitigation:** Workflow `concurrency:` group `sync-stories-${{ github.ref }}` + cancel-in-progress: false (matches gh-pages-deploy pattern from G054 work).

## Definition of Done

- [ ] All Acceptance Criteria boxes across the 8 dimensions are checked
- [ ] `cd express-api && npm test -- sync-stories-to-issues` green locally
- [ ] `actionlint .github/workflows/sync-stories-to-issues.yml` exits 0 (no warnings)
- [ ] `actionlint .github/workflows/inject-pr-closes.yml` exits 0 (no warnings)
- [ ] `shellcheck scripts/sync-stories-to-issues.sh` exits 0
- [ ] `scripts/sync-stories-to-issues.sh --help` exits 0 and lists all 12 exit codes
- [ ] `scripts/sync-stories-to-issues.sh --all --dry-run` against the live stories directory succeeds (no API mutations)
- [ ] Operator has provisioned the `ShyTalk Stories` Project v2 board in the company org with the documented schema (this is operator-side action; tracked as an AC for the manual setup step)
- [ ] First post-merge sync run creates issues for SHY-0001 (backfill) + SHY-0002 (this story) + any other stories present
- [ ] Branch is `story/SHY-0002-wire-github-integration`
- [ ] All commits' subjects start with `[SHY-0002]`
- [ ] PR title is `SHY-0002: Wire GitHub Issues + Projects v2 integration`
- [ ] PR body opens with `Implements SHY-0002 — see .project/stories/SHY-0002-wire-github-integration.md for full spec, AC, BDD scenarios, and DoD.\nCloses #<issue-N>` (the corresponding issue, manually created if SHY-0002 ships before its own automation runs)
- [ ] Architect agent dispatched against SHY-0002; concerns addressed
- [ ] Code-reviewer agent reports ZERO findings
- [ ] PR pushed, auto-merge armed, ScheduleWakeup on CI
- [ ] PR merged via auto-merge
- [ ] **Per-type Done gate:** `type: infra` → Done = auto-merge fires. No dev verify required.
- [ ] `status: Done` set in frontmatter; `pr:` populated
- [ ] Notes log records PR URL + merge timestamp + reviewer cycle count
- [ ] `SHY-INDEX.md` row for SHY-0002 moved from Active to Done

## Notes (running log)

- 2026-06-06 12:25 BST — Draft v1 created. Scope confirmed in operator Q&A rounds 1–5: one-way sync (.md → issue), Project v2 board, label automation, PR-body `Closes #N` injection, per-type Done bar (infra → auto-merge). Initially blocked by repo migration.
- 2026-06-06 ~16:30 BST — Migration RESOLVED (repo transferred to Shyden-Ltd 2026-06-06 ~12:00 BST). SHY-0001 ALSO RESOLVED (PR #1034 merged 15:56 BST; validator now live on main). Architect cycle 1 returned APPROVE-WITH-CHANGES: 5 Critical (C1 PAT scope, C2 idempotency body-hash, C3 fork-PR security model, C4 grace-window testability, C5 concurrency lock TOCTOU) + 8 Important + 6 polish. All Critical findings applied to spec. Operator-side prerequisite (cannot be done autonomously): provision `GH_PAT_PROJECT` secret + create `ShyTalk Stories` Project v2 board with the documented field schema. The implementation can SHIP structurally without these (dry-run smoke verifies parser + labels logic); live sync activates post-merge once operator finishes setup.
