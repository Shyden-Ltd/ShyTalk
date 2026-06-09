---
id: SHY-0067
status: Done
owner: claude
created: 2026-06-09
priority: P0
effort: L
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1049
released_in: v0.97.8
---

# SHY-0067: Fix SHY-0002 issue/board mirror — 4 stacked defects + self-healing label/field provisioning

## User Story

As **the ShyTalk operator depending on the GitHub Issues + Projects v2 board as the canonical visual surface for the SHY backlog** (per `[[feedback-stories-epics-and-two-surface-sync]]`), I want **the `scripts/sync-stories-to-issues.sh` mirror to actually create issues + populate the `ShyTalk Stories` Project v2 board on every push to main** — so that **the project board accurately reflects every SHY in the corpus + every PR's `Closes #N` injection actually closes a real issue + the two-surface sync invariant holds, instead of the current state where SHY-0002 is marked `Done` but Issues count = 0 + board items = 0.**

## Why

**Audit results 2026-06-09 ~12:45 BST** (during session close-out post-SHY-0065):

- `gh issue list --state all --limit 1` returns `[]`; `gh api repos/Shyden-Ltd/ShyTalk --jq '.open_issues_count'` returns `0`.
- `gh api graphql … projectV2(number: 1) { items { totalCount } }` returns `0`.
- The workflow `sync-stories-to-issues.yml` is running on every PR (all 5 of today's PRs triggered it; all green).

**SHY-0002 shipped a workflow that exits success but produces nothing.** Per `[[feedback-think-like-qa-real-fixes]]`: green CI is not the same as a working feature. Per `[[feedback-workflow-verify-by-running]]` STRENGTHENED 5x today: SHY-0002 should not have flipped to `Done` without a live-verify gate confirming actual issue creation.

**Root cause: FOUR stacked defects + ONE schema gap:**

### Defect A — `gh` CLI ignores `GH_PAT_PROJECT` env var

The workflow `env:` block exposes the secret as `GH_PAT_PROJECT`, but the `gh` CLI authenticates via `GH_TOKEN` (highest priority) or `GITHUB_TOKEN` (fallback) — not via `GH_PAT_PROJECT`. So `gh issue create …` runs with the auto `GITHUB_TOKEN`, which has only `contents: read` + `metadata: read` scope per the workflow's `permissions:` block. Every `gh issue create` call fails with 403 / scope error.

### Defect B — repo labels do not exist

`scripts/sync-stories-to-issues.sh:195` `build_labels()` generates labels like `story`, `status:in-progress`, `priority:p0`, `effort:s`, `type:bug`, `roadmap:g001` — but `gh label list` shows the repo only has `bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix, critical, prod-desync, dependencies, npm, gradle`. **None of the SHY-specific labels exist.** Even with auth fixed (Defect A), `gh issue create --label story,status:in-progress,priority:p0,...` would fail with `could not add label: <label> not found`.

### Defect C — silent failure swallowing

`scripts/sync-stories-to-issues.sh:252`:
```bash
if ! "$GH" issue create --title "$title" --body "$body" --label "$labels" >/dev/null 2>&1; then
  emit "$id" "api" "failed to create issue"
  N_FAILED=$((N_FAILED + 1))
  return 0
fi
```

`>/dev/null 2>&1` silences both stdout AND stderr — we never see WHY `gh` failed (no token? no label? rate limit?). `return 0` continues iteration. Final `exit 0` regardless of `N_FAILED` count. The script can fail 63 issue-creates in a row and still produce a green workflow run.

### Defect D — Project v2 board logic entirely absent

SHY-0002 AC line 46: *"Each created issue is added to a Project v2 named ShyTalk Stories (the operator provisions the project once; the script adds items + sets status field)."* — UNMET. `grep "project\|PROJECT\|board\|addItem"` against `scripts/sync-stories-to-issues.sh` yields ZERO matches in the actionable code path. The script never invokes `gh project item-add`, `addProjectV2ItemById` GraphQL mutation, or `updateProjectV2ItemFieldValue`. The board stays empty regardless of issue-creation success.

### Schema gap E — `Type` field absent from board

Project v2 schema audit shows `Pri`, `Effort`, `Roadmap IDs`, `SHY ID`, `Epic` fields exist — but **no `Type` single-select field** (which the spec calls for: `feature / bug / refactor / docs / infra / spike / chore`). Per operator decision 2026-06-09 ~12:50 BST: script auto-creates the field if missing.

### Why now (priority)

Operator named the project board as a hard prerequisite for prod deploys (2026-06-09 ~12:40 BST): *"all the items to be SHYs with the framework fully in place, the project board correctly done, workflows complete and everything else before we deploy anything to prod."* SHY-0067 is the gating SHY — without it, the project board surface is broken; without that, the framework-complete prerequisite isn't met; without that, we can't trigger the next release.

## Acceptance Criteria

### Happy path
- [ ] After SHY-0067 merges + workflow runs once on main, `gh issue list --state open` returns one issue per Active-status SHY in `.project/stories/`.
- [ ] After the workflow runs, `gh api graphql … projectV2(number: 1) { items { totalCount } }` returns ≥ count-of-Active-status-SHYs.
- [ ] Each issue has labels: `story`, `status:<status-slug>`, `priority:<pNumber>`, `effort:<sizeSlug>`, `type:<typeSlug>`, plus one `roadmap:<gId>` per `roadmap_ids` entry.
- [ ] Each Project v2 item has `Pri`, `Effort`, `Type`, `SHY ID`, `Roadmap IDs`, `Epic` (if applicable) fields populated from the SHY frontmatter.
- [ ] Workflow env block sets `GH_TOKEN: ${{ secrets.GH_PAT_PROJECT }}` (renamed/aliased so `gh` actually authenticates).
- [ ] `scripts/sync-stories-to-issues.sh` invokes `gh label create` for any SHY-namespace label that doesn't already exist (idempotent on subsequent runs).
- [ ] `scripts/sync-stories-to-issues.sh` invokes `addProjectV2ItemById` GraphQL mutation for each issue, then `updateProjectV2ItemFieldValue` for each populated field.
- [ ] Script auto-creates the `Type` single-select field on the Project v2 board if it doesn't exist (via `createProjectV2Field` mutation), with options `feature / bug / refactor / docs / infra / spike / chore`.

### Error paths
- [ ] If `gh issue create` fails with non-zero exit, script captures stderr to a tmpfile, logs the full error message to stderr (NOT `>/dev/null`), increments `N_FAILED`, AND the global script exits with `E_API=40` after the loop completes if `N_FAILED > 0`.
- [ ] If `gh label create` fails (e.g. rate limit, network), the failure is captured + logged with context (which label failed, what gh said). Issue creation still proceeds — labels that don't exist are dropped from the `--label` flag rather than failing the whole create.
- [ ] If `addProjectV2ItemById` fails (e.g. PAT lacks `project:write`), error captured + logged; `N_FAILED++`; script continues; exit non-zero at end.
- [ ] If `createProjectV2Field` fails for the Type field (board ID wrong, PAT scope insufficient), error captured + logged; script continues using labels only for type signal; exits non-zero at end so operator sees the partial-success.
- [ ] If `GH_TOKEN` is missing (no PAT in env), script exits 30 with stderr `GH_TOKEN missing (set via GH_PAT_PROJECT secret) — sync cannot authenticate`.
- [ ] If `GH_TOKEN` lacks the required scopes (issues:write or project:write), the first `gh issue create` returns 403; error message preserves the 403 response body; exit 40.
- [ ] Rate limit (429 from GitHub): script logs the Retry-After header value + exits 40 with a clear instruction to re-run later. Does NOT retry-with-backoff inline (avoids creating a per-script rate-limit-storm).

### Edge cases
- [ ] Repository already has the `story` label: `gh label create story` returns 422 "already exists"; script detects this exit code OR stderr substring and treats it as success (idempotent).
- [ ] A SHY's `roadmap_ids` array contains 5+ entries: 5+ `roadmap:gNNN` labels are created (one per G-ID).
- [ ] A SHY has `roadmap_ids: []` (no roadmap entries): zero `roadmap:*` labels added; issue still created with the other 5 labels.
- [ ] A SHY has `epic: EPIC-0001`: the corresponding Project v2 `Epic` field is set to "EPIC-001" (note: existing board options use 3-digit, not 4-digit; script converts on output OR operator adds 4-digit options via a follow-up SHY).
- [ ] An issue already exists for a SHY (body-hash matches stored footer): script skips re-creating + only updates Project v2 field values if frontmatter changed. Existing behaviour preserved.
- [ ] Story file is renamed (slug changed, ID stable): existing issue's title is updated to match the new H1 in the next sync run.
- [ ] Story file is deleted: per existing AC, issue is NOT auto-closed (story might be temporarily absent on a feature branch). New AC: orphan issue is logged with a `story-orphan-since: <date>` footer note for operator review.

### Performance
- [ ] First run with 63 SHYs completes within workflow's 10-min timeout. Rough budget: 63 issues × (1 create + 6 label-checks + 1 board-add + 6 field-sets) = 63 × 14 ≈ 880 API calls × 200ms avg ≈ 176 sec ≈ 3 min. Comfortable margin.
- [ ] Subsequent no-op runs (no SHY changes) complete in < 30 sec: per-SHY body-hash check returns 304-like quickly via single `gh issue view` per existing issue.
- [ ] Workflow timeout-minutes raised from `10` to `15` to give first-run headroom for label/field provisioning + GitHub Issue creation latency.

### Security
- [ ] `GH_TOKEN` is sourced from `${{ secrets.GH_PAT_PROJECT }}` ONLY — never echoed to logs, never embedded in a step name, never written to a tmpfile.
- [ ] The PAT scope requirement (`issues:write` + `pull-requests:write` + `project:write`) is documented in the workflow file's header comment + in `CLAUDE.md § GitHub Issues mirror` section.
- [ ] Untrusted user content (SHY body markdown) is passed to `gh issue create --body` via stdin (`gh issue create … --body-file -`) — NOT interpolated into a `--body "$STRING"` argument (avoids shell escape gotchas for SHYs containing single quotes / backticks).
- [ ] Workflow `permissions:` block stays at `contents: read` — issues + project mutations happen via the PAT, not via elevated workflow-token scope.
- [ ] Rate-limit budgeting documented: 880 API calls per first sync run vs. 5000/hr PAT REST budget = comfortable; GraphQL points budget separately documented.

### UX
- [ ] Operator running `bash scripts/sync-stories-to-issues.sh --all --dry-run --verbose` sees a line-by-line preview of WHAT issues + WHAT field-sets WOULD happen, with NO API mutations.
- [ ] Script's final summary line: `Sync result: <N> created, <N> updated, <N> skipped, <N> failed (labels created: <N>; project items added: <N>; project fields updated: <N>; type-field auto-created: <yes/no>)`.
- [ ] `gh project item-list 1 --owner Shyden-Ltd` after a successful sync shows every Active SHY as a board item with its fields populated.
- [ ] Operator-side onboarding doc: `scripts/sync-stories-to-issues.sh --help` mentions the auto-create-on-first-sync behaviour and the one-time setup steps that are NO LONGER needed (manual label creation).

### i18n
- N/A — script + workflow run in CI with English-only stderr/stdout; produces English issue titles + bodies derived from English SHY files. No locale variants planned.

### Observability
- [ ] Every API failure logs the gh exit code + the full stderr response. No `>/dev/null 2>&1` anywhere in the production code path; only test fixtures redact gh output.
- [ ] `$GITHUB_STEP_SUMMARY` appended with a per-run table: SHYs processed, issues created/updated/skipped, board items added, labels created (first-time), errors (with link-to-log-tab).
- [ ] If `N_FAILED > 0` final exit non-zero, the workflow shows red status — operator immediately sees something's wrong. No more silent-success.
- [ ] Audit Notes block appended to this SHY-0067 file post-merge: live-verify gate result (N issues confirmed via `gh issue list` count), board verify (N items confirmed via `gh api graphql`).

## BDD Scenarios

**Scenario: Workflow env propagates PAT to gh CLI correctly**
- **Given** the workflow `Sync stories to GitHub Issues` step's `env:` block
- **When** parsing the YAML
- **Then** it contains `GH_TOKEN: ${{ secrets.GH_PAT_PROJECT }}` (the rename or alias that gh CLI actually reads)
- **And** the script's first `gh issue create` invocation succeeds against a real (not mocked) GitHub API after merge

**Scenario: Label auto-creation on first sync**
- **Given** a repo with NONE of the SHY-namespace labels (`story`, `status:*`, `priority:*`, `effort:*`, `type:*`, `roadmap:*`)
- **And** a freshly-merged SHY-0067 + a workflow_dispatch trigger
- **When** the sync script encounters its first SHY-with-labels
- **Then** the script invokes `gh label create story --color <neutral> --description <doc>` BEFORE attempting `gh issue create --label story,…`
- **And** subsequent SHYs in the same run reuse the cached `gh label list` and skip re-creation
- **And** all expected SHY-namespace labels exist post-run

**Scenario: Silent-failure path eliminated**
- **Given** the sync script encounters a failing `gh issue create` (simulated: bad token, missing label, rate limit)
- **When** the failure occurs
- **Then** the full gh stderr is logged (NOT `>/dev/null 2>&1`)
- **And** `N_FAILED` is incremented
- **And** the loop continues processing remaining SHYs
- **And** at end-of-loop, if `N_FAILED > 0`, the script exits 40 (not 0)
- **And** the workflow run shows red status — operator sees the partial failure

**Scenario: Issue creation produces real Issues**
- **Given** SHY-0067 has merged + workflow_dispatch fires
- **When** the sync script runs against the live API
- **Then** `gh issue list --state open --json number,title --jq 'length'` returns ≥ 1 post-run
- **And** each issue's body contains `_Last synced: <UTC> from commit <sha> body-hash: <hex>_`
- **And** the issue is labelled with `story` + status/priority/effort/type + per-G-ID roadmap labels

**Scenario: Project v2 board addition + field population**
- **Given** an issue has just been created (returned issue number `N`)
- **When** the script runs the project-add step
- **Then** `addProjectV2ItemById` GraphQL mutation is invoked with the issue's node ID + project ID
- **And** the returned item ID is captured
- **And** for each of `Pri`, `Effort`, `Type`, `SHY ID`, `Roadmap IDs`, `Epic` (if applicable), `updateProjectV2ItemFieldValue` is invoked with the SHY-derived value
- **And** `gh api graphql … projectV2 { items(first: 100) { nodes { content { ... on Issue { number } } } } }` after sync includes issue #N

**Scenario: Type field auto-created on first sync**
- **Given** the Project v2 board has fields Pri/Effort/Roadmap IDs/SHY ID/Epic but NO Type field
- **When** the sync script's setup phase runs
- **Then** the script invokes `createProjectV2Field(input: { projectId, dataType: SINGLE_SELECT, name: "Type", singleSelectOptions: [{name: "feature"}, {name: "bug"}, ...] })`
- **And** subsequent SHYs in the same run can set the Type field via the returned field ID

**Scenario: Workflow exits non-zero on any failure**
- **Given** a SHY whose frontmatter is malformed (intentional fixture)
- **When** the sync script encounters it
- **Then** the script logs `failed to validate; skipping` + increments N_FAILED
- **And** at end-of-loop, exit code is 40 (not 0)
- **And** GitHub Actions shows the workflow run as red

**Scenario: --dry-run preview is fully accurate**
- **Given** a repo with mixed state (some SHYs have issues, some don't; one label missing; Type field missing)
- **When** running `bash scripts/sync-stories-to-issues.sh --all --dry-run --verbose`
- **Then** stderr shows a complete preview: which issues WOULD be created, which WOULD be updated, which labels WOULD be created, whether Type field WOULD be created
- **And** ZERO actual API mutations occur (verified by repo state being byte-identical before/after)
- **And** the script exits 0 even though changes would be needed

## Test Plan

**Red state:**

Add `express-api/tests/scripts/sync-stories-to-issues-comprehensive.test.js` (new file, ~30 assertions across the 4 defect categories + Project v2 board logic). Use mock-gh fixture similar to existing test file. Assertions:

- **Auth (Defect A):** workflow YAML `env:` block contains `GH_TOKEN:` referencing `secrets.GH_PAT_PROJECT`.
- **Labels (Defect B):** script body contains `gh label create` invocation logic; mock-gh fixture records `label create` calls and the test asserts ≥ 5 label-creates occur on first run.
- **Silent failure (Defect C):** script body does NOT contain `>/dev/null 2>&1` on `gh issue create` line; final exit code is non-zero when mock-gh returns failure for ≥ 1 issue.
- **Project board (Defect D):** script body contains `addProjectV2ItemById` AND `updateProjectV2ItemFieldValue` GraphQL strings; mock-gh records project-add calls.
- **Type field (Defect E):** script contains `createProjectV2Field` invocation guarded by a `Type field already exists?` check.

Also update existing `sync-stories-to-issues.test.js` to assert NEW behaviour for label-create idempotency + non-zero exit on N_FAILED.

`cd express-api && npm test -- sync-stories-to-issues` — expect new red assertions to fail; existing tests still pass (no regression in tested behaviour).

**Green state:**

1. **Workflow YAML fix:** add `GH_TOKEN: ${{ secrets.GH_PAT_PROJECT }}` to the sync step's `env:` block; bump `timeout-minutes` from 10 to 15.
2. **Script: label-create logic:** add `ensure_label()` function that checks a cached `gh label list` once per run, invokes `gh label create` only for missing labels. Idempotent on subsequent runs.
3. **Script: silent-failure removal:** capture each `gh` invocation's stderr to a tmpfile; on non-zero exit, log the tmpfile contents to stderr + increment `N_FAILED`. At end of `sync_all`, exit `E_API=40` if `N_FAILED > 0`.
4. **Script: Project v2 board addition:** new function `add_to_project_board()` that runs `addProjectV2ItemById` GraphQL mutation + captures returned item ID; new function `set_project_field()` that runs `updateProjectV2ItemFieldValue` for each field. Called after successful issue create.
5. **Script: Type field auto-create:** new function `ensure_project_type_field()` that runs a one-time `createProjectV2Field` mutation if the field doesn't exist; called at script startup (before any per-SHY processing).
6. **Body via stdin:** change `gh issue create --body "$body"` to `gh issue create --body-file -` reading from heredoc — avoids shell-escape bugs for SHYs with quotes/backticks.

Re-run Jest until green. Full express-api suite verify (11,757 / 11,757 passing).

actionlint clean.

**Local dry-run (mandatory per `[[feedback-workflow-verify-by-running]]`):**

- Set `GH_PAT_PROJECT` env locally to a fine-grained PAT with issues:write + project:write.
- Run `GH_TOKEN=$GH_PAT_PROJECT bash scripts/sync-stories-to-issues.sh --all --dry-run --verbose 2>&1 | head -200`.
- Verify stderr shows: N_CREATED previews, label-create previews, project-add previews, type-field-create preview.
- ZERO API mutations confirmed via `gh issue list --state all | wc -l` byte-identical before/after.

**Live-verify gate post-merge:**

- After SHY-0067 PR merges into main, the post-merge sync workflow auto-fires.
- Within 10 min, manually run: `gh issue list --state open --json number,title --jq 'length'` — expect ≥ Active-status-SHY-count.
- Run: `gh api graphql … projectV2(number: 1) { items { totalCount } }` — expect ≥ same.
- Confirm one sample issue has all expected labels + body footer.
- Confirm one sample board item has Pri / Effort / Type / SHY ID / Roadmap IDs fields populated.
- Status flips to `Done` ONLY when live-verify succeeds, per `[[feedback-done-equals-release-cut]]` + `[[feedback-workflow-verify-by-running]]`.

## Out of Scope

- **PR `Closes #N` injection workflow** — already exists at `.github/workflows/inject-pr-closes.yml`; SHY-0067 doesn't change it. (Operator should re-verify post-SHY-0067 that injections work end-to-end once issues actually exist.)
- **Auto-closing issues when SHYs flip to Done** — that's the `SYNC_GRACE_WINDOW_SECS` path, already in the script; SHY-0067 doesn't change it.
- **Existing issue cleanup / backfill** — SHY-0067 makes the sync work going forward; the first run on first-merged commit creates 53+ issues at once. No retroactive bookkeeping needed (SHY corpus is the source of truth, issues are derived).
- **Backfilling `released_in: vX.Y.Z` to historical Done SHYs** — separate SHY (operator hasn't filed it yet; tracked in handoff as "formalisation SHY").
- **Project v2 board view configuration** (column widths, default groupings) — operator-side; not script-controlled.
- **Renaming `GH_PAT_PROJECT` secret to `GH_TOKEN_PROJECT`** — secret name is operator-facing only; alias via `env:` block keeps the secret name stable.

## Dependencies

- **SHY-0002** (Done, PR #1035) — established the script + workflow scaffold this SHY repairs. The script's structure (find_issue_for, body_hash, fm_get, build_labels, build_issue_body) is reused.
- **`GH_PAT_PROJECT` secret** — already provisioned (confirmed via `gh secret list` output).
- **Project v2 board "ShyTalk Stories"** — already exists at org `Shyden-Ltd`, project number 1. Custom fields Pri / Effort / Roadmap IDs / SHY ID / Epic confirmed present; Type field absent (auto-created by this SHY).
- **`gh` CLI ≥ 2.40** for `gh project` subcommands; CI runner ships ≥ 2.50 (verified via release-workflow-pin.test.js precedent).
- **`jq`** for parsing GraphQL responses.

## Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | First sync run creates 53+ issues + 53+ board items in one pass; partial failure leaves the repo in inconsistent state | Medium | Medium | Script is idempotent: re-running picks up where it left off (body-hash detects which issues already exist; project-item-exists check skips re-adds). Plus: workflow_dispatch with --dry-run pre-merge to predict the change set. |
| R2 | PAT scope doesn't actually include project:write despite the secret name | Low | High (board stays empty) | Pre-merge: `gh auth token` + manual `gh project item-list 1 --owner Shyden-Ltd` test to confirm PAT can read; addProjectV2ItemById test against a throwaway item confirms write. |
| R3 | Auto-label-create rate-limits the script on first run (33+ label-creates × 200ms = 6 sec, within budget) | Very Low | Low | All label-creates happen sequentially; if rate-limited the script logs Retry-After + exits 40 cleanly. Operator retries; subsequent runs find labels exist + skip. |
| R4 | Auto-Type-field-create races with another concurrent run | Very Low | Low | Workflow concurrency group `sync-stories-${{ github.ref }}` already serialises runs per branch. No parallel race. |
| R5 | Project v2 GraphQL schema changes between gh versions | Very Low | High | gh CLI version pinned via runner image; check `release-workflow-pin.test.js` precedent. SHY-0067 uses `addProjectV2ItemById` which has been GA since 2023-04. |
| R6 | Body-via-stdin (`--body-file -`) doesn't accept heredoc shape | Very Low | Low | Tested via local dry-run with a SHY containing single-quotes/backticks/multi-line markdown. |
| R7 | SHY-0067 causes spurious noise from existing tests | Low | Low | Existing `sync-stories-to-issues.test.js` covers script behaviour with mock-gh; update mocks to match new behaviour; verify all assertions still pass. |
| R8 | Existing 53 Active SHYs all create issues at once — operator overwhelmed | Low | Low | This is the desired outcome — the board finally reflects reality. Operator can hide/filter via Status field grouping. |

## Definition of Done

1. **Spec authored fully refined** — this file. ✅ on creation.
2. **TDD red** — new Jest file `express-api/tests/scripts/sync-stories-to-issues-comprehensive.test.js` written; running it against current code yields the predicted red assertions. ✅ when red observed.
3. **TDD green** — workflow + script refactored to apply all 5 fixes; re-run Jest until green; full express-api suite verifies no regression. ✅ when green observed.
4. **Local dry-run completed** — `GH_TOKEN=$PAT bash scripts/sync-stories-to-issues.sh --all --dry-run --verbose` previews accurately + makes ZERO API mutations. ✅ when logged.
5. **actionlint pass** on `sync-stories-to-issues.yml`. ✅ when reported.
6. **Pre-self-review** — manual lint against known recurring categories (silent-failure swallowing, regex anchoring, label/permission edge cases).
7. **ONE reviewer cycle** — code-reviewer agent dispatched against the LOCAL commit; ALL findings applied as ONE amend; push once.
8. **PR opened + auto-merge armed** — `SHY-0067: Fix SHY-0002 mirror — comprehensive (auth + labels + silent-failure + Project v2 board + Type field)`; body opens with `Implements SHY-0067 — see .project/stories/SHY-0067-...md ...`.
9. **CI passes** — all required checks green; SonarCloud quality gate passes.
10. **Auto-merge fires.**
11. **Live-verify gate** — within 10 min of merge:
    - `gh issue list --state open --json number --jq 'length'` returns ≥ 53 (count of Active SHYs).
    - `gh api graphql … projectV2 { items { totalCount } }` returns ≥ 53.
    - One sampled issue confirms all expected labels.
    - One sampled board item confirms all populated fields.
12. **Lifecycle** — flips `In Review` on push; flips `Done` + adds `released_in: vX.Y.Z` ONLY after the next operator-triggered `release.yml vX.Y.Z` per `[[feedback-done-equals-release-cut]]`. Joins the SHY-0038 / 0063 / 0064 / 0065 / 0066 cohort awaiting release.
13. **SHY-0068 filed** (follow-up, parking lot only — NOT done in this SHY): operator-side Project board polish (Type field options verification, Epic options 3-digit → 4-digit alignment, default view groupings).

## Notes (running log)

**2026-06-09 ~12:55 BST — Diagnosis complete + spec authored.** All 4 defects + 1 schema gap surfaced via session-close audit. Operator selected most-automated path for both label provisioning + Type field creation (AskUserQuestion 2026-06-09 ~12:52 BST). Scope upgraded from initial M-effort to L-effort because Project v2 board logic was entirely absent + needs ground-up GraphQL implementation, not just a tweak to existing logic.

**Authoring decision: ONE comprehensive SHY instead of splitting.** The 4 defects are tightly coupled — fixing auth without labels still produces 0 issues (because gh issue create fails on missing labels); fixing labels without auth still produces 0 issues (because auth fails first); fixing both without silent-failure removal hides any remaining issue; fixing all three without Project v2 board logic still leaves the operator's stated prerequisite (board correctly done) unmet. Single PR is the right granularity per the "1 PR-bundle = 1 SHY" rule.

**Pattern reference:** existing `sync-roadmap-data-workflow.test.js` (SHY-0063/0064 lineage) for the static-assertion test shape. Existing `sync-stories-to-issues.test.js` for mock-gh fixture pattern (will update + extend, not replace).

**Live-verify gate is mandatory + non-negotiable** per `[[feedback-workflow-verify-by-running]]` STRENGTHENED 5x in this session. SHY-0002 was the FIRST SHY in the framework that flipped Done without a live-verify gate — SHY-0067 is the lesson cost (a P0 bug-fix SHY 24 hours later). The validator should be updated in the formalisation SHY (next session) to require a live-verify Notes entry before allowing Done.

**2026-06-09 ~20:30 BST — Reviewer cycle 3 (post C1-C4 + I1-I5 fix) → 1 Important finding (I-A1 / I6).** Code-reviewer agent re-dispatched on commit b136af6 (the "Address all reviewer findings" pass). Found `add_to_project_board` failures swallowed by `|| true` at lines 847 (create path) + 903 (update path), plus 5 `set_project_field_*` swallows inside `populate_project_fields` (lines 581/586/591/595/599). All 7 sites reintroduced Defect-C-class silent success on the Defect-D code path that this PR was meant to harden — AC line 79 explicitly requires `N_FAILED++` + non-zero exit on board-add failure. **Fix:** new failing test `reviewer-I6` (mock-gh returns `addProjectV2ItemById: null` → drives empty-id branch → asserts exit 40), tightened all 7 swallow sites to propagate via N_FAILED + emit, made `populate_project_fields` return non-zero on any field-set failure so the caller can count it. 30/30 comprehensive tests passing, 13/13 sibling tests passing, shellcheck clean.

**2026-06-09 ~22:57 BST — Released in v0.97.8.** PR #1049 squash-merged 2026-06-09 21:50:19Z as 294d6a028ca (auto-merge after node-26-hang root-cause fix unblocked the final push). v0.97.8 cut by release.yml run 27238174189; flipped Done.
