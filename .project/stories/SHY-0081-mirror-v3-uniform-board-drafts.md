---
id: SHY-0081
status: In Progress
owner: claude
created: 2026-06-11
priority: P1
effort: L
type: refactor
roadmap_ids: []
epic: EPIC-0001
public: false
---

# SHY-0081: Mirror v3 — every story is a board work-item card; the Issues page is reserved for bug reports

## User Story

As the operator, I want EVERY SHY story (any type, including `bug`) to appear on the Project board as a work-item card, and the GitHub Issues page to be reserved exclusively for genuine bug REPORTS (a separate intake, not auto-generated from stories), so each surface has a single clear job: the board is the home for all delivery work; Issues is where bugs are reported.

## Why

Operator directive 2026-06-11 16:26 BST: "the issues page is only for reporting bugs. the project board is for work items, including bug tickets." Decisions confirmed (AskUserQuestion): (1) `type: bug` stories become board cards ONLY — no auto-created GitHub Issue; (2) the Issues page is reserved for a future bug-report intake (user/QA-submitted defects), NOT generated from the SHY corpus; the 29 existing story-issues are migrated to board cards and deleted.

This corrects the [[SHY-0074]] v2 modelling error: in our framework `type: bug` denotes the KIND of work (a fix task), which is orthogonal to bug REPORTING (a defect being filed). v2 conflated "bug-fix ticket" with "GitHub Issue bug report", flooding the Issues page with dev work-items. v3 makes the board the single home for all work and frees the Issues page for its real purpose. It also retires the v2 issue machinery (bug-report bodies, status-transition comments, close-on-terminal, issue-dedup) — the [[SHY-0079]] sidecar becomes the one dedup mechanism for all (now uniformly draft) cards, and the [[SHY-0080]] ARG_MAX-safe stdin merges are retained.

## Acceptance Criteria

### Happy path
- [ ] **Uniform routing:** EVERY story (any `type`) with no existing board item gets a board DRAFT item (`addProjectV2DraftIssue`) titled `SHY-NNNN: <Title>` with the full-spec body + footer (Source URL + `_Status:_` marker + Last-synced hash). NO `gh issue create` is ever called from the story sync.
- [ ] **Uniform update:** hash-gated draft body/title refresh via `updateProjectV2DraftIssue`; unchanged ⇒ skip. All six board fields (Status, Pri, Effort, Type, SHY ID, Roadmap IDs) set on create AND update for every card; Status mutated last.
- [ ] **Migration:** a `--rebuild` deletes every board item AND every `story`-labeled issue (the 29 legacy v2 issues), then recreates EVERY story as a draft card — leaving the Issues page empty of story-generated issues and the board holding one draft per story.
- [ ] **Legacy issue-backed item → draft (incremental path too):** if the items map shows a story currently backed by an ISSUE (a v2 leftover), the sync deletes that board item, closes+leaves-or-deletes its issue per the migration policy, and recreates it as a draft. (In practice the one-shot `--rebuild` handles this; the incremental guard is the safety net.)
- [ ] **Sidecar:** unchanged behaviour ([[SHY-0079]]) — overlays stale API reads; all entries now `backing: "DRAFT"`. ARG_MAX-safe stdin merges retained ([[SHY-0080]]).

### Error paths
- [ ] Draft create/update mutation failure → `[gh-error]` + `N_FAILED++` → exit 40; subsequent stories still sync.
- [ ] Items-map query failure → abort pre-mutation (exit 40).
- [ ] `--rebuild` `deleteIssue` permission gap → loud `::warning::` + `N_FAILED++`, teardown continues (unchanged from v2).
- [ ] Field-mutation failure on any of the six fields → independent `[gh-error]` + `N_FAILED++` → exit 40.

### Edge cases
- [ ] No `gh issue create`/`edit`/`comment`/`close` is emitted by the story sync for ANY story type (asserted) — the Issues page is never written from the corpus.
- [ ] Hash anchoring (literal `body-hash:` in a spec body) still resolves to the footer hash (unchanged).
- [ ] Oversize draft body truncated with notice + intact footer (unchanged).
- [ ] `--dry-run` performs ZERO mutations; previews draft creates + the `--rebuild` teardown; no issue previews.
- [ ] Single-source labels: the five duplicated families are still deleted repo-wide; the `story` label is no longer applied to anything (no issues created) — it is left as an inert repo label (a future bug-report intake may reuse it) and is NOT auto-deleted.

### Performance
- [ ] One paginated items query + the sidecar overlay (unchanged). No per-story issue searches. Fewer API calls than v2 (no issue create/view/comment/close round-trips).

### Security
- [ ] No new scopes; `deleteIssue` during `--rebuild` only (migration); no secret values logged.

### UX
- [ ] Board = every story as a card in its correct Status column with all fields; Issues page contains no story-generated entries (reserved for bug reports).
- [ ] Bug-fix work (type:bug stories) is visible on the board like all other work, in its lifecycle column.

### i18n
- [ ] N/A — operator-facing surfaces, English-only.

### Observability
- [ ] Summary: created (all drafts now), updated, skipped, failed, items added/deleted, issues deleted (rebuild migration only), fields updated, status set, bodies embedded/truncated, sidecar overlay fills. The issue-specific counters (comments posted, issues closed, dedup-guard hits) are removed or fixed at 0 (no issue path).
- [ ] Verbose logs `story → draft action` per item.

## BDD Scenarios

**Scenario: A bug-type story becomes a board card, not an issue**
- **Given** a `type: bug` story with no existing board item
- **When** the sync runs
- **Then** `addProjectV2DraftIssue` is called for it and NO `gh issue create` is made

**Scenario: No story type ever writes the Issues page**
- **Given** stories of every type (feature, bug, refactor, docs, infra, spike, chore)
- **When** the sync runs
- **Then** zero `gh issue create`/`edit`/`comment`/`close` calls are recorded

**Scenario: --rebuild migrates v2 issues to draft cards**
- **Given** a board with v2 issue-backed items + their `story`-labeled issues
- **When** `--rebuild` runs
- **Then** every board item is deleted, every story-labeled issue is deleted, and every story is recreated as a draft card (Issues page empty of story entries)

**Scenario: Legacy issue-backed item is converted incrementally**
- **Given** the items map shows SHY-NNNN backed by an ISSUE (v2 leftover)
- **When** a normal sync runs
- **Then** the issue-backed item is deleted and SHY-NNNN is recreated as a draft

**Scenario: Board fields set for every card**
- **Given** stories with each Status/Pri/Effort/Type value
- **When** the sync runs
- **Then** each draft card's six fields are set to the exact option/text values, Status last

## Test Plan

- **Layer 1 — mock-`gh` runtime (Jest, `sync-stories-to-issues-board-fields.test.js`):** rework the matrix so EVERY type routes to a draft (no issue create); add the headline `no gh issue create/edit/comment/close for any type` assertion; keep the per-value field matrix (now all on draft items) on create AND update; keep sidecar (SHY-0079) + ARG_MAX (SHY-0080) blocks; RETIRE the v2 issue-create/bug-body/transition-comment/close-on-terminal/issue-dedup describes (or convert the dedup concept to the draft sidecar, already covered). `--rebuild` test asserts issue deletion + all-draft recreation. Structural pins: sync_one routes all types to the draft path; no `gh issue create` in the story-sync code path.
- **Layer 2 — workflow YAML:** unchanged (rebuild input, sidecar commit-back).
- **Layer 3 — validator:** unchanged.
- **Layer 4 — live:** `--rebuild` migration → board = one draft per story (76), Issues page has zero story-generated issues; a normal sync = all-skip; sample a card renders the full spec.
- All AC → named tests at RED first; clause→test map in the PR.

## Out of Scope

- The future bug-report intake itself (user/QA-submitted defect → Issue) — a separate story; v3 only RESERVES the Issues page (stops the corpus from writing it).
- Removing the `story` label from the repo (left inert for the future intake).
- The ARG_MAX fix ([[SHY-0080]]) and sidecar ([[SHY-0079]]) mechanics — retained as-is.

## Dependencies

- [[SHY-0074]] (v2 mirror — being revised), [[SHY-0078]], [[SHY-0079]] (sidecar — retained), [[SHY-0080]] (ARG_MAX — retained) — all merged.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Removing the issue path breaks a retained code path | Med | Med | Comprehensive test rework; keep the issue helpers only if reused, else delete cleanly (no dead code) |
| Migration leaves orphaned issues | Low | Med | `--rebuild` deletes ALL story-labeled issues; verify the Issues page post-migration |
| A future bug-report intake needs the deleted issue code | Low | Low | Git history retains it; v3 is the correct current model; intake is a separate story |
| Board churn during migration | Certain (one-shot) | Low | Operator-sanctioned `--rebuild`; end state is one draft per story |

## Definition of Done

- [ ] All AC met; tests RED first; clause→test map in the PR; the "no issue writes for any type" headline assertion included.
- [ ] Zero-findings review (reviewer before push).
- [ ] Live `--rebuild` migration: board = one draft per story, Issues page empty of story entries; normal sync = all-skip; evidence in Notes.
- [ ] CLAUDE.md mirror section rewritten for v3; SHY-INDEX in lockstep.
- [ ] Merged via its own PR; `released_in:` at the release cut before Done flip.

## Notes (running log)

- 2026-06-11 16:30 BST — Filed after the operator's model correction (Issues = bug reports only; board = all work items incl bug tickets). Decisions: bug stories → board cards only; Issues reserved for future intake; migrate + delete the 29 existing story-issues. Sequenced AFTER the SHY-0080 ARG_MAX fix (verified: board clean at 76, normal sync all-skip). Release timing (SHY-0074/0078/0079/0080/0081 → Done) folded to AFTER v3 so the released model is final — to confirm with operator. Implementation to start post-/compact (phase boundary, operator present).
