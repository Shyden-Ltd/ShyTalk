---
id: SHY-0074
status: Done
owner: claude
created: 2026-06-10
priority: P1
effort: XL
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1134
epic: EPIC-0001
public: false
released_in: v0.97.10
---

# SHY-0074: Mirror architecture v2 — bugs-only Issues, draft cards for stories, faithful board columns

## User Story

As the operator, I want the GitHub Issues tab to contain ONLY bugs (each linked to its story on the board and updated as that story progresses), every story of any type to appear on the Project board in the correct column with correct fields, and exactly one label per issue — so each GitHub surface has a single clear job: Issues = open bug list, Board = delivery state, `.md` files = specs.

## Why

Operator-reported defects + directives (2026-06-10, 13:31–15:25 BST), all symptoms of the mirror being built mechanically without thinking like its consumer:

1. **Every ticket sat in To Do** — the sync set five custom fields but never the built-in Status single-select (the only field board columns read). Unmet SHY-0002 AC line 46 clause that survived SHY-0067 untested.
2. **Ticket bodies were a broken relative link** (`**Spec:** [../blob/main/...]`) with no content, despite CLAUDE.md documenting body-overwrite-with-content.
3. **Six redundant label chips** (`status:*`, `priority:*`, `effort:*`, `type:*`, `roadmap:*`) duplicated board columns. Operator: a fact lives in its column ONLY.
4. **Issues tab flooded with non-bugs** — operator directive 15:10: "the issues section should only be for bugs. each issue should also have a story linked to it on the board. as the story progresses, we update the issue."

Architecture v2 (all five design decisions operator-confirmed via explicit options, 2026-06-10 14:30–15:25):

- **Non-bug stories → board DRAFT items** (`addProjectV2DraftIssue`): full title + spec body + all six fields, no Issues-tab entry.
- **`type: bug` stories → real GitHub Issue** (bug-report framing) + its issue-backed board item. The issue body links the story (Source `.md` URL + board reference); the board item carries the fields.
- **Issue updates as the story progresses**: status-transition comment on every lifecycle move, body refresh on spec change (hash-gated), close on `Done` (as completed, naming `released_in` when present) / `Cancelled` (as not-planned).
- **Single-source labels**: bug issues carry exactly `story`; the five duplicated families are deleted repo-wide, idempotently, every run.
- **Migration = teardown + fresh build** (operator explicitly chose this over close-and-convert: "it's already a mess and you need to fix yourself"): one-shot `--rebuild` deletes every existing board item and every mirror-created issue, then a fresh `--all` sync rebuilds drafts + bug issues.

Coverage audit findings driving the test bar (operator: "every moving part, every edge case… everywhere in everything"): the prior pack's only runtime field assertion was *"at least one field"* (`sync-stories-to-issues-comprehensive.test.js:423`); zero tests assert a specific value on a consumed surface. Implementation work additionally surfaced two pre-existing SHY-0067 bugs — `N_PROJECT_ITEMS_ADDED` and `N_LABELS_CREATED` increments die in `$()` subshells (counters always 0) — fixed and pinned here per the fix-pre-existing rule.

## Acceptance Criteria

### Happy path
- [ ] **Item lookup map:** one paginated GraphQL query loads all project items (id, type, Status, SHY ID field value, content number/id for issue-backed items) into a run-scoped map keyed by SHY ID — replacing per-story `gh issue list` searches for board reconciliation.
- [ ] **Non-bug create:** a story with `type != bug` and no existing board item gets a DRAFT item via `addProjectV2DraftIssue` with title `SHY-NNNN: <Title>` and body = full spec verbatim (everything after frontmatter) + footer (`_Source: <absolute blob URL>_` + `_Status: <lifecycle>_` + `_Last synced: <UTC> from commit <sha> body-hash: <hex>_`). No GitHub Issue is created.
- [ ] **Non-bug update:** when the body-hash differs, the draft's title/body refresh via `updateProjectV2DraftIssue`; unchanged hash ⇒ skip (no mutation).
- [ ] **Bug create:** a `type: bug` story with no existing issue gets a real Issue titled `SHY-NNNN: <Title>` with label exactly `story` and a BUG-REPORT body: `## Bug` (the story's `## Why` section content verbatim — the symptom), `## Tracking` (Source `.md` URL line + "Tracked as SHY-NNNN on the [ShyTalk Stories board](https://github.com/orgs/Shyden-Ltd/projects/1)" + current lifecycle status line), then the same footer. The issue is added to the board (`addProjectV2ItemById`) — the issue-backed item IS the story's board card.
- [ ] **Bug update:** hash-gated body refresh via `gh issue edit`; the `## Tracking` status line always shows the current lifecycle status.
- [ ] **Status-transition comment (bug issues only):** the footer's `_Status: <X>_` marker is compared against the story's current status each run; on difference, the sync posts an issue comment `Status: <old> → <new>` before refreshing the body. Drafts get no comments (no timeline exists).
- [ ] **Close on terminal states (bug issues only):** story `Done` ⇒ `gh issue close --reason completed` (comment names `released_in: vX.Y.Z` when the frontmatter carries it); `Cancelled` ⇒ `gh issue close --reason "not planned"`. Reopened stories (validator forbids backward transitions) are out of scope.
- [ ] **Board fields for EVERY item type:** all six fields set on create AND update for drafts and issue-backed items alike — Status (Draft→`Todo`, In Progress→`In Progress`, In Review→`In Review`, Done→`Done`, Cancelled→`Cancelled`; option names verified live 2026-06-10), Pri (P0–P3), Effort (XS–XL), Type (all 7), SHY ID (exact text), Roadmap IDs (`, `-joined; empty ⇒ not written). Status is mutated LAST (last-writer over GitHub's "Item added → Todo" automation).
- [ ] **Single-source labels:** `build_labels` emits exactly `story`; the five duplicated families are deleted repo-wide every run (idempotent; exact-prefix match on the script's own former namespaces; foreign labels like `dependencies` never touched).
- [ ] **`--rebuild` teardown (one-shot migration):** gated on `REBUILD_CONFIRM=yes` env; deletes every project item (`deleteProjectV2Item`) and every `story`-labeled issue (`deleteIssue`), then falls through to a fresh `--all` sync. Refuses to run without the confirm env (exit 2, message naming the env var).

### Error paths
- [ ] Status field/option missing from board → `::warning::` naming the gap + story id; config-gap no-op; run continues, exit 0.
- [ ] Any field mutation failure (4xx/5xx) on ANY of the six fields independently → `[gh-error]` + `N_FAILED++` → exit 40; one field's failure never masks siblings.
- [ ] Draft create/update mutation failure → `[gh-error]` + `N_FAILED++`; subsequent stories still sync.
- [ ] Issue create/edit/comment/close failure → existing stderr-capture pattern + `N_FAILED++`; no new silencing.
- [ ] `deleteIssue` permission failure during `--rebuild` (fine-grained PATs may lack issue-delete) → loud `::warning::` naming the PAT scope gap + actionable message (grant Issues admin or close manually), `N_FAILED++`, teardown continues with remaining items.
- [ ] Label-family deletion failure → `::warning::` + `N_FAILED++`; sync continues.
- [ ] Items-map query failure → fail the run (exit 40) before any mutations — without the map, create-vs-update decisions would be wrong.

### Edge cases
- [ ] **Hash anchoring:** change-detection extraction anchors on the `_Last synced:` footer line (line-start match, LAST occurrence wins) — embedded specs legitimately contain literal `body-hash:` text (SHY-0067, this story); unanchored extraction would wedge those stories into permanent re-sync/skip.
- [ ] **Oversize body:** body > 65,536 chars ⇒ spec cut at the last whole line that fits + `…_[spec truncated — N chars omitted; read the full file at the Source link]_` notice + intact footer (largest story today ~50K; byte-measured, conservative).
- [ ] **Type flip bug↔non-bug** (e.g. a story re-typed during refinement): the sync detects the mismatch between item backing (draft vs issue) and story type, deletes the stale item (and closes+unlinks the orphaned issue when bug→non-bug), and recreates the correct backing. Logged explicitly.
- [ ] Option-name matching exact + case-sensitive (`Todo`, never `To Do`).
- [ ] Unchanged re-run is a no-op (hash skip for bodies; idempotent field writes); `--dry-run` performs ZERO mutations/deletions/comments but previews every action including label-family and rebuild deletions.
- [ ] A story flipping Done in the same run that adds `released_in:` lands in Done AND its close comment names the release.

### Performance
- [ ] ONE items query (paginated, 100/page) replaces ~75 per-story `gh issue list` calls — net API-call reduction despite the added Status mutation (+1/story) and transition comments (only on actual transitions).
- [ ] Full-corpus rebuild budget: ≤ ~330 API calls (≈75 deletes + ≈75 creates + 6×75 field sets ÷ batching) — within the workflow's 15-min timeout; documented in the workflow budget comment.

### Security
- [ ] No new token scopes for normal sync (`GH_PAT_PROJECT`: `issues:write` + `project:write`); `deleteIssue` scope gap surfaces loudly per Error paths; no secret values logged; `REBUILD_CONFIRM` gate prevents accidental teardown.
- [ ] Embedding full specs adds zero exposure (the `.md` files are already public in this repo).

### UX
- [ ] Issues tab = bug list only: every open issue is an open bug; each links to its story file and board; closed = fixed (with release) or not-planned.
- [ ] Board = complete delivery state: every story (any type) in the right column with all fields; column tallies match frontmatter tallies after first full sync.
- [ ] Each bug issue shows exactly one chip (`story`).

### i18n
- [ ] N/A — operator-facing, English-only surfaces (framework convention; public translated surfaces unaffected).

### Observability
- [ ] Summary line + `GITHUB_STEP_SUMMARY` table report: created (drafts/issues split), updated, skipped, failed, labels created/deleted, items added/deleted, fields updated, status fields set, bodies embedded/truncated, comments posted, issues closed. Counter increments survive command substitution (the two pre-existing subshell-counter bugs are fixed and pinned).
- [ ] Verbose mode logs `story → action` per item; all failures via `[gh-error]` + exit 40.

## BDD Scenarios

**Scenario: Non-bug story becomes a draft card, not an issue**
- **Given** a `type: feature` story with no existing board item
- **When** the sync runs
- **Then** `addProjectV2DraftIssue` is called with title `SHY-NNNN: <Title>` and the full-spec body
- **And** NO `gh issue create` call is made for it

**Scenario: Bug story becomes a bug-report issue on the board**
- **Given** a `type: bug` story with no existing issue
- **When** the sync runs
- **Then** `gh issue create` fires with label exactly `story` and a body whose `## Bug` section is the story's `## Why` content
- **And** the body's `## Tracking` section contains the absolute Source URL and the board link
- **And** `addProjectV2ItemById` adds that issue to the board

**Scenario: Draft story lands in Todo / Done story lands in Done**
- **Given** stories with each of the five lifecycle statuses (any type)
- **When** the sync runs
- **Then** each board item's Status field is set to exactly Todo / In Progress / In Review / Done / Cancelled respectively, as the LAST mutation per item

**Scenario: Status transition posts an issue comment**
- **Given** a synced bug issue whose footer says `_Status: In Progress_` and a story file now at `status: In Review`
- **When** the sync runs
- **Then** an issue comment `Status: In Progress → In Review` is posted
- **And** the refreshed body footer says `_Status: In Review_`

**Scenario: Done bug closes its issue naming the release**
- **Given** a bug story flipped to `status: Done` with `released_in: v0.98.0`
- **When** the sync runs
- **Then** `gh issue close` fires with reason completed and a comment naming v0.98.0

**Scenario: Cancelled bug closes as not planned**
- **Given** a bug story flipped to `status: Cancelled`
- **When** the sync runs
- **Then** `gh issue close` fires with reason "not planned"

**Scenario: Rebuild refuses without confirmation**
- **Given** `--rebuild` is invoked without `REBUILD_CONFIRM=yes`
- **When** the script starts
- **Then** it exits 2 naming the missing confirmation env var and performs zero mutations

**Scenario: Rebuild tears down and resyncs fresh**
- **Given** `REBUILD_CONFIRM=yes` and a board with existing items (drafts + issue-backed)
- **When** `--rebuild` runs
- **Then** every item is deleted via `deleteProjectV2Item`, every `story`-labeled issue via `deleteIssue`
- **And** the fresh sync then creates drafts for non-bugs and issues for bugs

**Scenario: deleteIssue permission gap is loud, not silent**
- **Given** `deleteIssue` returns a permissions error during rebuild
- **When** the teardown processes that issue
- **Then** a `::warning::` names the PAT scope gap with an actionable message and `N_FAILED` increments
- **And** the teardown continues with the remaining items

**Scenario: Spec containing literal body-hash text does not break change detection**
- **Given** a synced story whose embedded spec contains `body-hash: deadbeef`
- **When** the sync re-runs with no file change
- **Then** the stored hash is extracted from the footer line and the story is skipped as unchanged

**Scenario: One field's mutation failure does not mask the others**
- **Given** the Effort mutation returns HTTP 500 while the other five succeed
- **When** the sync runs
- **Then** `N_FAILED` increments exactly once and the exit code is 40

**Scenario: Duplicated label families are deleted repo-wide, foreign labels untouched**
- **Given** repo labels `status:done`, `priority:p1`, `effort:m`, `type:bug`, `roadmap:g001`, `story`, `dependencies`
- **When** the sync runs
- **Then** exactly the five family labels are deleted; `story` and `dependencies` survive; a second run deletes nothing

**Scenario: Type flip recreates the correct backing**
- **Given** a story previously synced as a draft whose `type:` is now `bug`
- **When** the sync runs
- **Then** the draft item is deleted and a bug issue + issue-backed item is created in its place

## Test Plan

Every behavior assertion names a concrete expected value on a concrete surface; no "at least one X" shapes; structural greps don't count as behavior coverage. AC→test mapping listed in the PR description before implementation (traceability rule).

**Layer 1 — mock-`gh` runtime matrix (Jest):** `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js` — pattern-matching mock `gh` (first-match `\x1f`-delimited rules; TAB collapses as IFS whitespace), stdin capture for `issue create/edit/comment`, STORIES_DIR fixture isolation. Covers: draft-vs-issue routing per type (8 type values); per-value field matrix on create AND update (Status ×5, Pri ×4, Effort ×5, Type ×7, SHY ID, Roadmap incl. empty-list skip); Status-last ordering; bug-report body sections (`## Bug` = Why content, `## Tracking` links, footer) + full-spec draft bodies (verbatim equality); transition comment content `old → new`; close-on-Done with release name; close-on-Cancelled reason; rebuild confirm-gate (exit 2) + teardown call set + permission-failure warning; hash anchoring self-referential fixture; truncation arithmetic; label single-source + family deletion + idempotency + failure; per-field/draft/issue/comment/close failure injection (independent, exit 40); items-map query failure aborts pre-mutation; dry-run zero-mutation previews; type-flip recreation; subshell-counter pins (`project items added: 7`, `labels created: 1`); validator five-status contract.
**Layer 2 — workflow YAML (Jest structural):** GH_TOKEN routing unchanged; budget comment updated for v2 call profile.
**Layer 3 — frontmatter validator contract:** the five-value `status:` pin (what makes the mapping total).
**Layer 4 — live verification (verify-by-running, ALL surfaces, evidence in Notes before Done):** one-time `--rebuild` dispatch (operator-sanctioned teardown), then: GraphQL per-Status group counts == frontmatter tallies; Issues tab lists exactly the `type: bug` stories; spot-open one draft card (full spec rendered) + one bug issue (report format, working Source link, board-linked); flip a sandbox story's status → comment posted + column moved; `gh label list` shows none of the five families.

## Out of Scope

- User-submitted bug reports (issues not born from SHY files) — future intake story; the bugs-only tab makes room for it.
- Rewriting relative markdown links inside embedded spec bodies (render as text; candidate follow-up).
- Two-way sync (board/issue edits back to `.md`) — one-way by design.
- Epic field reconciliation on the board (tracked separately per SHY-0067 deferral).
- `inject-pr-closes.yml` behaviour for non-bug stories: verified to no-op gracefully when no issue exists (assertion included), but any redesign of PR-issue linkage is a follow-up.

## Dependencies

- SHY-0067 mirror foundation (field cache, setters, stderr-capture, error bubbling) — shipped.
- `GH_PAT_PROJECT` (`issues:write` + `project:write`) — live; issue DELETION may need an additional grant, surfaced at rebuild time per Error paths.
- `check-story-frontmatter.sh` five-value status contract — shipped.
- GraphQL mutations: `addProjectV2DraftIssue`, `updateProjectV2DraftIssue`, `deleteProjectV2Item`, `deleteIssue` (documented GitHub GraphQL API).

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `deleteIssue` denied for fine-grained PAT | Med | Med (rebuild incomplete) | Loud actionable warning + N_FAILED; operator grants scope or closes manually; teardown continues elsewhere |
| Old PR `Closes #N` references point at deleted issues | High | Low (cosmetic history) | Operator explicitly accepted via nuke-and-rebuild decision; references degrade to plain text |
| Draft-item field mutations differ subtly from issue-backed items | Low | Med | Same `updateProjectV2ItemFieldValue` API for both (item-id-keyed); matrix tests run the full pipeline for both backings |
| Items-map pagination misses items (>100) | Low | High (duplicate creates) | Cursor-driven pagination loop + test with multi-page fixture |
| Transition comments spam on body-only edits | Low | Low | Comment fires only when footer `_Status:_` ≠ current status, not on hash change |
| Built-in "Item added → Todo" races our Status write | Low | Low | Status mutated last in the same pass; self-heals next run |

## Definition of Done

- [ ] All AC met; tests written RED first; all green via canonical runners (`cd express-api && npm test`).
- [ ] AC→test mapping in the PR description.
- [ ] Zero-findings review (reviewer against the LOCAL commit BEFORE push).
- [ ] Live rebuild + verification evidence in Notes (tallies, sampled surfaces, label list, transition demo) before any Done flip.
- [ ] CLAUDE.md mirror section rewritten for v2; SHY-INDEX row in lockstep; workflow budget comment updated.
- [ ] Merged via its own PR; `released_in:` at next release cut before Done flip.

## Notes (running log)

- 2026-06-10 13:40 BST — Filed (Draft) after operator spotted the all-To-Do board. Root cause + live Status-option verification at filing time. Queued ahead of SHY-0062 batch 1 per operator.
- 2026-06-10 13:37 BST — Operator escalation: value-level verification of EVERY column, all layers ("every moving part, every edge case"). Audit smoking gun: "at least one field" assertion (now a banned shape, global standard feedback-ac-traceability-in-tests STRENGTHENED 3x).
- 2026-06-10 13:43 BST — Validator caught my fenced-gherkin BDD format at filing (exit 13 → fixed → 0); kept as verify-by-running example.
- 2026-06-10 13:58 BST — Defects 2+3 reported (broken Spec link body; status:done label). Five design decisions operator-confirmed (full spec body; Source footer; drop ALL five label families; bundle into this story). Consumer-first lesson codified (feedback-consumer-first-surface-design).
- 2026-06-10 14:40 BST — Implementation: RED observed (structural pins; runtime tests unrunnable pre-fix by design — STORIES_DIR gap). v1 fidelity implemented; 60/69 green. Harness bug found (TAB IFS-whitespace collapses empty rule fields → \x1f delimiter); TWO pre-existing SHY-0067 bugs found via mock debug: N_PROJECT_ITEMS_ADDED + N_LABELS_CREATED increments die in $() subshells (counters always 0 in production) — fixed + pinned per fix-pre-existing rule.
- 2026-06-10 15:25 BST — ARCHITECTURE V2 (operator): Issues = bugs only; drafts for non-bugs; bug issue = bug report linked to board story; status comments + body refresh + close-on-terminal; migration = operator-chosen TEARDOWN + fresh rebuild ("it's already a mess and you need to fix yourself"). Story re-specced to v2; effort L→XL. SYNC_GRACE_WINDOW_SECS found documented-but-never-implemented (SHY-0002 ghost) — the close-on-Done AC finally implements the close path; the grace window stays unimplemented and the dead config doc is removed in this PR.
- 2026-06-10 16:55 BST — v2 IMPLEMENTED, all suites green. RED first (78 failed/113), then: items-map paginated query + MAP_* lookup; draft create/update via `-F body=@-` (stdin keeps 64K bodies out of argv); bug-report body builder (## Bug = Why via awk section extraction); `_Status:_` footer marker + anchored last-match extraction for both hash and status; transition comments → body refresh → fields → close-on-terminal ordering; `--rebuild` confirm-gated teardown + workflow `rebuild` dispatch input (the click is the sanction); type-flip recreation. Board-fields suite 117 tests (matrix split per-itemId — attribution-precise, no segmentation). Siblings adapted: characterization (bug fixtures + items-aware mock), comprehensive (items-query mock channel; reviewer-I3 "at least one field" test DELETED as banned shape — superseded by the per-value matrix; reviewer-I5 repurposed to items-map abort), structural file (draft-routing + map-based skip). Canonical `npm test`: 12,080 passed. NOTE: the items-map work implements a chunk of SHY-0071's scope (one upfront list → map) — re-validate SHY-0071 at pickup per [[feedback-pickup-fitness-review-every-story]].
- 2026-06-10 16:55 BST — AFK coverage (operator, 15:32 BST): live `--rebuild` authorized autonomously post-merge with THOROUGH testing; deleteIssue PAT capability to be tested NOW via throwaway issue (awaiting PAT file at ~/.secrets/gh_pat_project); devices-unreachable ⇒ hold release, keep working; Phase 10 MVP held until operator returns.
- 2026-06-10 17:05 BST — PAT obtained (operator: "get it via playwright"): regenerated the `ShyTalk-Project-Sync` fine-grained token, stored at `~/.secrets/gh_pat_project` + `gh secret set GH_PAT_PROJECT`. deleteIssue capability CONFIRMED live (throwaway issues created→deleteIssue→gone). Token briefly surfaced in a command output → rotated a 2nd time to invalidate the exposed value, captured silently, browser snapshots shredded. The merged PR's first push-sync (run 27288734833) failed CORRECTLY — items-map 401 → abort-before-mutation → exit 40 — because regeneration #1 had invalidated the secret value mid-window; zero partial state (the abort guard working in prod). Then held the rebuild: GitHub had an ACTIVE auth incident (15:23–~16:39 UTC, ~15% API 401s); running a destructive rebuild mid-incident risked a half-wiped board.
- 2026-06-10 18:15 BST — **Layer-4 LIVE VERIFICATION (rebuild complete).** Incident resolved (API Requests Operational) + 20/20 clean stability burst → ran the operator-sanctioned `--rebuild` via workflow_dispatch (dry-run preview first: 47 drafts + 26 issues = 73, zero mutations ✓; then real). Real rebuild (run 27292740288) outcome — teardown: 72 board items deleted + 72 story-labeled issues deleted (deleteIssue at scale ✓) + 76 duplicated-family labels deleted; rebuild: **73 items created (47 DraftIssue + 26 Issue — verified live via GraphQL totalCount/by-backing), 341 fields updated, 73 statuses set, 73 bodies embedded, 3+1 Done-bug issues closed (4 Done bugs total).** Exit 40 came from ONE soft false-negative: `issue close 1161` returned "Could not close" but the mutation committed — #1161 (SHY-0067, Done bug) verified `CLOSED/COMPLETED`. Layer-4 evidence: board 73 = 47 drafts + 26 issues ✓; `gh label list` shows 0 of the five families, `story` present ✓; #1161 CLOSED/COMPLETED ✓. **Consistency proof:** a follow-up normal `--all` sync reported `0 created, 0 updated, 73 skipped, 0 failed, exit 0` — the migration is internally consistent + idempotent (steady-state clean no-op). A green confirming CI run (27293436056) left on record (the rebuild run shows red only due to the #1161 soft error; actual state correct). REMAINING for Done: SHY-0074 stays In Progress until a release cut adds `released_in:` (DoD). The "Type field already taken" gh-error in rebuild logs is benign (field exists from SHY-0067; that path is `|| true`).
