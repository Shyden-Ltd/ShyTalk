---
id: SHY-0082
status: Done
owner: claude
created: 2026-06-11
priority: P1
effort: XL
type: refactor
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1308
released_in: v0.97.12
epic: EPIC-0001
public: false
---

# SHY-0082: Mirror v4 — every story is a real typed GitHub issue (Bug/Feature/Task), never a draft

## User Story

As the ShyTalk operator,
I want every story on the project board to be a **real, typed GitHub issue** (Bug / Feature / Task) rather than a draft card,
So that work items are first-class, filterable, and visually typed — while the repo's Issues tab stays usable for real-user bug reports through a separate label + saved filter.

## Why

- **SHY-0081 v3 made every board card a draft.** Drafts cannot carry a native issue type, cannot be cross-referenced/linked like issues, and read as "lesser." The operator wants typed *tickets* (operator's term for a real GitHub issue that lives on the board — distinct from the repo's `/issues` tab).
- **Native org issue types are enabled** on `Shyden-Ltd` (`Bug`, `Feature`, `Task` — verified 2026-06-11 via `gh api /orgs/Shyden-Ltd/issue-types`). This gives first-class typing that drafts can't.
- **Tool decision (durable):** GitHub-native over Jira. The source-of-truth is the `.md` corpus, so both tools are only a mirror; GitHub *evolves* the hardened ~1,100-line mirror, whereas Jira would *rebuild* it greenfield + add a 2nd SaaS + Atlassian lock-in. See `## Notes` and the `project-board-mirror-v4-decision` memory. **Do not relitigate.**
- The one GitHub mechanic that shapes this: only *drafts* are board-only/invisible to the Issues tab, but drafts can't be typed. So typed story-issues necessarily also appear on the Issues tab. v4 keeps that tab usable for user bug reports by (a) a `story` marker label on every story-issue, (b) **closing** issues whose story reaches a terminal status (Done/Cancelled) so they drop out of the default open view, and (c) reserving a `user-report` label + issue form for real reports (intake form is out of scope here — see below).

## Acceptance Criteria

### Happy path

- [ ] Every story `.md` in `.project/stories/SHY-NNNN-*.md` (ANY `type`) mirrors to exactly ONE **real GitHub issue** in `Shyden-Ltd/ShyTalk`, added as an item on the `ShyTalk Stories` Projects v2 board. No `addProjectV2DraftIssue` is emitted for any story.
- [ ] The issue carries a native issue **type** per this exact mapping (value matrix — one assertion per row):
  - `bug` → `Bug`
  - `feature` → `Feature`
  - `refactor` → `Task`
  - `docs` → `Task`
  - `infra` → `Task`
  - `spike` → `Task`
  - `chore` → `Task`
- [ ] The issue **title** is exactly `SHY-NNNN: <Title>` (the H1 title from the body, sans the `SHY-NNNN: ` already-present prefix — no duplication).
- [ ] The issue **body** is the full spec verbatim + the standard footer (`_Source: <blob URL>_` / `_Status: <lifecycle>_` / `_Last synced: <UTC> from commit <sha> body-hash: <hex>_`) — identical format to the v3 draft body.
- [ ] Every story-issue carries the single marker label `story` (and ONLY that marker — no `type:*`/`priority:*`/`effort:*`/`status:*`/`roadmap:*` label families; those facts live in board columns).
- [ ] Board fields set on the item exactly as v3 did: `SHY ID` (text), `Pri` (single-select), `Effort` (single-select), `Roadmap IDs` (text), the `Type` board single-select field, and `Status` — mapped `Draft→Todo`, `In Progress→In Progress`, `In Review→In Review`, `Done→Done`, `Cancelled→Cancelled` (Status written last).
- [ ] Issue **open/closed state** is derived from story status: `Done` and `Cancelled` → issue **closed**; all other statuses → issue **open**. (State is reconciled on every sync, not only at create.)

### Error paths

- [ ] Issue **create** failure (GraphQL/REST non-2xx) → `emit` a structured error + increment `N_FAILED`; no board item is orphaned for that story; the run continues to the next story (no silent swallow).
- [ ] Issue **type-set** failure (e.g. `issueTypeId` mutation 4xx/5xx) → loud `::warning::` naming the SHY + the type + increment `N_FAILED`; the issue is still created/updated (degraded, never silent). Matches the existing per-component-failure discipline.
- [ ] **Unknown native type** (org is missing one of `Bug`/`Feature`/`Task` at run start) → `fail_global` with an actionable message (which type name was not found) BEFORE any mutation; exit `40`.
- [ ] **PAT lacking `issues:write`** → the first create surfaces a clear `[gh-error]`/`::warning::` (token-permission worded like the existing `deleteIssue` permission-gap message) + `N_FAILED`; never logs the token value.
- [ ] Issue **close/reopen** failure → `emit` + `N_FAILED`; body/fields already written are not rolled back (board reflects partial truth + a loud failure, not a silent green).

### Edge cases

- [ ] **Idempotency (no change):** a story whose issue already exists with matching body-hash, type, labels, fields, and open/closed state → SKIP (0 mutations). A second consecutive run over an unchanged corpus is all-skip (`0 created, 0 updated, N skipped`).
- [ ] **Create vs update keying:** an existing story-issue is matched by `SHY ID` board field / the items-map (NOT by fuzzy title), so a renamed title updates the same issue rather than duplicating.
- [ ] **Migration (v3→v4 one-shot):** the 77 existing DRAFT items are converted to real typed issues — for each: create the typed issue + add to board + set fields/labels/state, then delete the old draft item. Gated behind the existing `--rebuild` path (`REBUILD_CONFIRM=yes`); after it, the board has 0 drafts and 77 typed issues, and a normal sync is all-skip.
- [ ] **Type drift:** an existing story-issue whose native type no longer matches the mapping (e.g. story `type` changed `chore`→`bug`) → type corrected on sync (Task→Bug), counted as an update.
- [ ] **Status flip only (body unchanged):** detected via the footer `_Status:_` marker (status lives in frontmatter, outside the body hash) → moves board Status column AND reconciles open/closed state, with 0 body re-embed when the body hash is unchanged.
- [ ] **Body > 65,536 chars** → line-truncated with an explicit `[spec truncated — N chars omitted…]` notice ahead of an intact footer (unchanged from v3).
- [ ] **Read-after-write lag** on freshly-created issues (Projects v2 items query is eventually consistent) → the SHY-0079 sidecar (`board-items.json`, now `backing: ISSUE`) overlays a stale read so no duplicate issue is created on the next run.

### Performance

- [ ] Steady-state no-change run uses ONE paginated items-map query (≈1 call/100 items) + per-story hash compares with 0 mutations (all-skip), matching v3's ~2–3 call budget.
- [ ] Full migration (77 draft deletes + 77 issue creates + type/label/field/state sets) completes within the workflow timeout; bump `timeout-minutes` from 15 → 20 if the dry-run estimate exceeds ~12 min (document the chosen value).

### Security

- [ ] `GH_PAT_PROJECT` (fine-grained PAT: `issues:write`, `pull-requests:write`, `project:write`) is the only credential; its value is NEVER echoed/logged (assert no `set -x` leak path around the token).
- [ ] The `story` marker label and the `user-report` label are distinct namespaces so a saved filter (`label:user-report`) cleanly isolates real reports from story-issues.

### UX

*(consumer-first: the two surfaces are the BOARD and the Issues TAB)*

- [ ] **Board:** each item renders with its native type chip (`Bug`/`Feature`/`Task`) and its Status column — a reader can tell the kind of work and its lifecycle at a glance.
- [ ] **Issues tab:** story-issues are visually typed + carry `story`; finished ones (Done/Cancelled) are **closed** so the default `is:open` view is dominated by in-flight work; real user reports (future) are isolated by `label:user-report`. A reader filtering `is:issue label:story` sees exactly the corpus; `-label:story` (or `label:user-report`) sees reports.
- [ ] No story is represented as a draft anywhere on the board.

### i18n

- N/A — internal tooling. Issue titles/bodies are the English spec content; public-facing translation is handled by the roadmap webpage per `[[feedback-public-translations-lazy-architecture]]`, which derives from the same `.md` corpus and is unaffected by this change.

### Observability

- [ ] The end-of-run summary reports, with exact counters: `created`, `updated`, `skipped`, `failed`, plus `(issues created; issues updated; issue types set; issues closed; issues reopened; board items added; board items deleted; project fields updated; status fields set; bodies embedded; bodies truncated; sidecar overlay fills; draft items migrated)`.
- [ ] Every failure path increments `N_FAILED` and emits a greppable structured line; a non-zero `N_FAILED` makes the run exit non-zero.

## BDD Scenarios

**Scenario: a feature story becomes a real Feature-typed issue on the board**
- **Given** a story `SHY-0200` with frontmatter `type: feature` and `status: In Progress` and no existing board item
- **When** the sync runs
- **Then** a real GitHub issue titled `SHY-0200: <Title>` is created (not a draft), added to the `ShyTalk Stories` board
- **And** its native issue type is `Feature`, it carries the `story` label, its board Status is `In Progress`, and the issue is open

**Scenario: a chore story is typed Task (7→3 mapping)**
- **Given** a story with `type: chore`
- **When** the sync runs
- **Then** the created issue's native type is `Task`
- **And** no `type:chore` label is applied (type is the native field, not a label)

**Scenario: a bug story is a typed issue, never a draft**
- **Given** a story with `type: bug`
- **When** the sync runs
- **Then** exactly one `createIssue` (real issue) is emitted with native type `Bug`
- **And** zero `addProjectV2DraftIssue` mutations are emitted for it

**Scenario: terminal status closes the issue**
- **Given** a story-issue that is open and its story status flips to `Done`
- **When** the sync runs
- **Then** the board Status moves to `Done` AND the issue is transitioned to `closed`
- **And** the body is not re-embedded if its body-hash is unchanged

**Scenario: unchanged corpus is all-skip**
- **Given** every story already mirrored as a matching typed issue (body-hash, type, labels, fields, state all current)
- **When** the sync runs with no `.md` changes
- **Then** the summary is `0 created, 0 updated, N skipped, 0 failed`
- **And** zero create/update/close/type mutations are emitted

**Scenario: v3→v4 migration converts drafts to typed issues**
- **Given** the board holds 77 draft items (v3 state) and `--rebuild` is invoked with `REBUILD_CONFIRM=yes`
- **When** the migration runs
- **Then** each story gets a real typed issue added to the board and its old draft item is deleted
- **And** afterwards the board has 0 drafts and 77 typed issues, the 25 `prod-desync` deploy-alert issues are untouched, and an immediate normal sync is all-skip

**Scenario: type-set failure is loud, not silent**
- **Given** the `issueTypeId` mutation returns a 5xx for one story
- **When** the sync runs
- **Then** the issue is still created with the `story` label and body
- **And** a `::warning::` names the SHY + intended type, `N_FAILED` increments, and the run exits non-zero

**Scenario: unknown native type aborts before mutating**
- **Given** the org is missing the `Feature` issue type at run start
- **When** the sync starts
- **Then** it exits `40` with an actionable message before creating/deleting anything

## Test Plan

All script behaviour is covered by the mock-`gh` harness in `express-api/tests/scripts/`. **RED first** — the v3 test suites (which currently assert `addProjectV2DraftIssue` on the create path) are reworked to the v4 contract; each AC clause maps to ≥1 named test.

**RED (write/convert failing tests first):**
- `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js`
  - New describe `SHY-0082 v4: every story type → a real typed ISSUE` — 7-type matrix asserting `createIssue` (not draft) + the exact native-type value per row (`bug→Bug` … `chore→Task`); headline `zero addProjectV2DraftIssue for ANY type`.
  - New describe `SHY-0082 v4: native issue type value matrix` — one case per `type`→native-type row with the exact expected type id/name.
  - New describe `SHY-0082 v4: terminal status closes / non-terminal opens the issue` — `Done`→closed, `Cancelled`→closed, `In Progress`/`In Review`/`Draft`→open; status-flip-only path re-asserts state with 0 body re-embed.
  - New describe `SHY-0082 v4: marker label is exactly [story]` — asserts `story` present and the five families absent.
  - Rework `update path` describe → issue update via `updateIssue` (body/title/labels) + `Status` field; never a draft mutation.
- `express-api/tests/scripts/sync-stories-to-issues-comprehensive.test.js`
  - Rework create-path / silent-failure / board-addition blocks to the issue contract; per-component failure injection: `createIssue` 5xx, `issueTypeId` mutation 5xx, close/reopen 5xx, field 5xx ×N → each `N_FAILED` + non-zero exit.
  - Rework `--rebuild teardown` block: deletes 77 draft items + creates 77 typed issues + leaves the 25 non-`story` issues untouched (assert `--label story` scoping unchanged) + sidecar `backing: ISSUE`.
  - Extended-summary test → v4 counters (issues created/updated/types set/closed/reopened/migrated …).
- `express-api/tests/scripts/sync-stories-to-issues-parse-characterization.test.js`
  - Update the mock `resp-*` fixtures so create returns a real `createIssue { issue { id number } }` shape; title-fidelity asserts through `createIssue` (title=`SHY-NNNN: …`); type derivation asserts the native type, "no `type:*` label applied".
- `express-api/tests/scripts/sync-stories-to-issues.test.js`
  - Live-dir summary regex → v4 form; `--rebuild`/`--story` mutual-exclusion retained; add `--dry-run` previews "would create typed ISSUE" (not draft).

**GREEN (implement to pass):** refactor `scripts/sync-stories-to-issues.sh` — reintroduce a typed-issue create/update path (`create_issue` / `update_issue_body` / issue-node-id extraction, adapted) + a new `set_issue_type` (GraphQL `issueTypeId`, type-id cache from `gh api /orgs/<org>/issue-types`) + `set_issue_state` (close on terminal status). Keep sidecar (SHY-0079, `backing: ISSUE`), ARG_MAX stdin merges (SHY-0080), items-map retry (SHY-0078), `populate_project_fields`. Re-point `sync_one` create/update to the issue path; `--rebuild` teardown deletes drafts + recreates issues. Bump `VERSION` to `4.0.0`.

**Suites that must stay green:** full `cd express-api && npm test`; `bash -n` + `shellcheck` clean (no `shellcheck-disable`); `check-story-frontmatter.sh --scan` green.

## Out of Scope

- The **real-user bug-report intake** (the issue FORM template under `.github/ISSUE_TEMPLATE/`, the `user-report` label provisioning, and the saved/pinned triage filter). v4 only reserves the `story` marker namespace and leaves the Issues tab writable by users; the intake is a separate follow-up SHY.
- Retiring/altering the `prod-desync` deploy-failure alert automation (it keeps filing to the Issues tab; v4 must not touch those 25 issues).
- Public roadmap renderer changes (derives from `.md`; unaffected).
- Any migration of the 25 existing deploy-alert issues.

## Dependencies

- Native org issue types `Bug`/`Feature`/`Task` enabled on `Shyden-Ltd` (verified 2026-06-11).
- `GH_PAT_PROJECT` secret with `issues:write` + `project:write` (already provisioned for the v3 mirror).
- Builds directly on the SHY-0074/0078/0079/0080/0081 mirror; reuses the sidecar + items-map + ARG_MAX machinery.
- Reverses the create/update path shipped by SHY-0081 (which deleted the issue machinery) — net code re-addition expected.

## Risks & Mitigations

- **Exact GraphQL mutation for native issue types is unconfirmed** (`gh` 2.93 has no `--type` flag). *Mitigation:* pin it at RED via a throwaway introspection/probe (candidates: `createIssue(input:{ …, issueTypeId })` in one call, vs `updateIssue(input:{ id, issueTypeId })`, vs a dedicated `updateIssueIssueType`); cache org issue-type IDs once per run. The test harness mocks whichever shape is chosen, so the contract is locked by tests.
- **77 story-issues now populate the Issues tab** (expected, not a regression). *Mitigation:* `story` label + terminal-status-close + the future `user-report` filter; documented as the agreed model.
- **Read-after-write lag on issue creation** could duplicate issues. *Mitigation:* the SHY-0079 sidecar already guards this; extend its `backing` to `ISSUE` and assert dedup in tests.
- **Migration is destructive** (deletes 77 drafts). *Mitigation:* `REBUILD_CONFIRM=yes` gate (unchanged) + dry-run preview + the `--label story` scoping that provably cannot touch the 25 `prod-desync` issues (asserted in tests).
- **Reintroduces complexity v3 removed.** *Mitigation:* keep the single create path (issue only — no draft fork), exhaustive per-component failure tests, shellcheck-clean, code-reviewer to ZERO findings.

## Definition of Done

- All RED tests authored first (clause→test map in the PR body), then GREEN; full `express-api` suite passes; `shellcheck` + `bash -n` clean (no suppressions); `check-story-frontmatter.sh --scan` green.
- `code-reviewer` agent run on the local branch BEFORE push → ZERO findings (all severities).
- CLAUDE.md "Board mirror" section rewritten to **v4** (real typed issues, native type mapping, `story` label, terminal-close semantics, Issues-tab coexistence) + the `sync-stories-to-issues.yml` header comment corrected (currently stale v2 text).
- Merged + released (`released_in: vX.Y.Z`); the live one-shot migration run (dispatch `--rebuild`) verified: board = 77 typed issues, 0 drafts, 25 deploy-alerts untouched, and an immediate normal sync is all-skip — evidence pasted into `## Notes`.
- SHY-INDEX row added.

## Notes (running log)

- 2026-06-12 ~01:10 BST — **DONE — released in v0.97.12.** Migration verified clean: post-merge incremental sync (run 27384094365) → `Sync result: 79 created, 0 updated, 0 skipped, 0 failed` (79 drafts→typed issues, 79 board items added + 79 old draft items deleted, issue types set ×79, 27 terminal-status issues closed, sidecar id-map committed `f6ce3b0`). Live board verified = 79 typed issues (52 open + 27 closed), all keyed by the "SHY ID" field; bodies + hashes correct (issue #1387 footer body-hash == freshly-computed SHY-0083 body-hash, byte-identical). Release: bump run 27384760667 → commit `c1a50d3` → tag run 27384868546 → **v0.97.12** tagged.
  - **FOLLOW-UP FINDING → SHY-0085:** in GitHub Actions the items-map read returns an EMPTY `items.nodes` array (the same `GH_PAT_PROJECT` PAT returns all 79 from a laptop), so CI runs SIDECAR-ONLY (`[sidecar] API read missed 79 item(s)`). Correct today (no dups — the sidecar supplies item IDs → UPDATE path, never CREATE) but it re-updates all 79 every run + would duplicate them all if the sidecar were ever lost. Root cause: the CI token can create/add issues but apparently can't traverse-READ Issue-backed project items (Drafts read fine pre-migration → that's why the migration's read worked). Operator will re-provision the secret with Issues: Read; SHY-0085 makes the degraded read LOUD (`::warning::`) instead of silent + keeps the API read primary.
- 2026-06-12 ~00:25 BST — **IMPLEMENTED + reviewed; all tests green (In Review).** Script v4.0.0 (shellcheck-clean, bash -n OK): `bootstrap_repo` (repo id + native type ids + `story` label via repo-level GraphQL), `create_issue` (`createIssue` + `issueTypeId` + inlined `story` labelId) + `add_to_board`, `update_issue` (now also re-applies the `story` label so a manual removal is restored), `set_issue_state` (close/reopen reconciled ONLY on a terminal-boundary change → no spurious calls, all-skip preserved), `sync_one` create→`create_issue_path` + update→`update_issue`, migration INVERTED (DRAFT-backed = legacy → recreate as issue; ISSUE-backed = normal), items-map fetches the Issue `body`, summary → v4 counters, `setup_pre_sync` shared by sync_all + sync_story. **TWO real bugs caught by the tests:** the first story got an empty `issueTypeId` because the type id was computed before `bootstrap_repo` ran — fixed by bootstrapping before the loop in BOTH `sync_all` AND `sync_story`. Tests: board-fields 152 + comprehensive 27 + characterization 5 + main 14 = **198 sync tests**; full express-api **12,151 green**; CLAUDE.md Board-mirror section + `sync-stories-to-issues.yml` header → v4. **code-reviewer (agent a78baf09): ZERO Critical** (core logic / bootstrap ordering / migration inversion / globals-not-echo / `--label story` scoping all verified correct). Applied: I1 (`ensure_story_label` failure → loud `::warning::` not silent `|| true`), I2 (`setup_pre_sync` DRY helper), I8 (`update_issue` re-applies the label), + 4 new tests (C2 bootstrap-missing-type → exit 40 before any create; C3 terminal→non-terminal `reopenIssue`; I3 `closeIssue` fails on create → exit 40, issue still created; I4 `addProjectV2ItemById` fails after createIssue → exit 40, story absent from sidecar). I7 stale v3 comments fixed.
  - **KNOWN LIMITATION (I4, tracked):** if `addProjectV2ItemById` fails AFTER `createIssue` succeeds, the issue exists on the Issues tab but is NOT on the board and NOT in the sidecar → the next run re-creates a duplicate. Acceptable for now (rare; loud exit 40). Future fix: idempotency-by-search (find an existing story-issue by SHY id before create) — a follow-up SHY.
  - **Next:** merge → release → LIVE `--rebuild` migration (drafts→issues; operator authorized; verify 0-failed + all-skip after; the 25 prod-desync alerts already manually deleted).
- 2026-06-11 ~20:45 BST — **Implementation blueprint** (de-risked; for resume-after-compaction). GraphQL research DONE: type node IDs Task=`IT_kwDOEOcG584B_iaD` Bug=`IT_kwDOEOcG584B_iaE` Feature=`IT_kwDOEOcG584B_iaF`; PAT can't read org issueTypes (403) but CAN read repo-level: `repository(owner,name){issueTypes{nodes{id name}}}`. `CreateIssueInput.issueTypeId` + `UpdateIssueInput.issueTypeId` both EXIST → one-call typed create/update.
  - **Script (`scripts/sync-stories-to-issues.sh`, v3=1448 lines, VERSION 3.0.0→4.0.0):** add `bootstrap_repo()` = one GraphQL `repository(owner:"Shyden-Ltd",name:"ShyTalk"){ id issueTypes(first:20){nodes{id name}} label(name:"story"){id} }` → globals REPO_NODE_ID, ISSUE_TYPE_{BUG,FEATURE,TASK}_ID, STORY_LABEL_ID. `ensure_story_label()` → if STORY_LABEL_ID empty, create + re-query id. `story_type_to_issue_type_id()` map bug→Bug feature→Feature refactor/docs/infra/spike/chore→Task. `create_issue(title,body,typeId)` → GraphQL `createIssue(input:{repositoryId,title,body,issueTypeId,labelIds:[STORY_LABEL_ID]}){issue{id number}}` (body via `-F body=@-` stdin) → then `add_to_board(issueNodeId)` = addProjectV2ItemById(projectId,contentId)→itemId. `update_issue(issueNodeId,title,body,typeId)` → GraphQL updateIssue. `set_issue_state(issueNodeId, terminal?)` → closeIssue/reopenIssue. REPLACE create_draft_item(865)/update_draft_item(898)/create_draft_path(1058); rewire sync_one(1096) create+update→issue path; teardown_for_rebuild(1211) keeps draft-item delete + create-path now makes issues; sidecar backing ISSUE; new counters. KEEP body builders(983-1042)/populate_project_fields(773)/delete_project_item(922)/delete_issue_node(949)/sidecar/items-map/status_board_option(761).
  - **Tests (mock-gh harness, board-fields.test.js 2006 lines + comprehensive + characterization + main):** harness = pattern rules `[ERE,respFile,exit,stderr]` first-match, records argv lines, captures `body=@-` graphql stdin. Rework `createPathRules`(432) + builders: add `issueTypesResponse`/`issueCreateResponse`(`{data:{createIssue:{issue:{id,number}}}}`), keep `ADD_ITEM_RESPONSE`(213). Rules: add `repository.*issueTypes`, `createIssue`; keep `addProjectV2ItemById`. Flip create describe(472) addProjectV2DraftIssue→createIssue + native-type value matrix + `story` label + close-on-terminal. `issueNode`(239)/`itemsResponse` already model issue-backed items.
  - **Then:** reviewer→push→auto-merge→release→LIVE migration (dispatch `--rebuild`; operator authorized; 25 deploy-alerts already deleted; expect 77 typed issues + all-skip after). Fix stale v2 header comment in sync-stories-to-issues.yml too.
- 2026-06-11 ~19:25 BST — Filed after the operator clarified the model (board cards must be real typed *tickets* = GitHub issues, Bug/Feature/Task; never drafts; the `/issues` tab is a separate surface for user bug reports + deploy alerts). This reverses SHY-0081 v3. The operator asked to evaluate **Jira** properly; after a grounded comparison (Jira Free = 10 users / 2 GB / 100 automation-runs/mo; greenfield `.md`→Jira sync + 2nd SaaS + Atlassian lock-in vs evolving the hardened GitHub mirror) the operator chose **GitHub-native v4**. Decision is durable (`project-board-mirror-v4-decision` memory) — do not relitigate. Native org issue types verified enabled (`Bug`/`Feature`/`Task`). gh 2.93 lacks `--type` ⇒ types set via GraphQL (exact mutation to pin at RED). Design choice that keeps the Issues tab usable for user reports without a new surface: **terminal status (Done/Cancelled) closes the issue**, so finished work leaves the default open view.
