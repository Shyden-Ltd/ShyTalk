---
id: SHY-0177
status: In Review
owner: claude
created: 2026-07-11
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
---

# SHY-0177: Board sync fires from main — develop-flow story changes never reach the Projects board

## User Story

**As** the operator tracking sprint reality on the GitHub Projects board,
**I want** the story→board mirror to sync from **develop** (the git-flow integration branch),
**So that** a story's status flip or spec edit shows on the board minutes after it merges to develop — instead of only after a develop→main promotion, which can lag by days.

## Why

The git-flow pivot (SHY-0161, 2026-07-07) moved all day-to-day merges to `develop`; `main` now only receives operator-gated promotions. But `sync-stories-to-issues.yml` still triggers on `push: branches: [main]` — so every story change since the pivot (SHY-0149's In-Review flip, SHY-0176's creation, EPIC updates) is invisible on the board until a promotion lands. The board is ~3 days stale and drifts further every develop merge.

Three subordinate defects surface once the trigger moves:

1. **Sidecar commit-back is main-hardcoded** — the `createCommitOnBranch` step targets `branch: "main"` with `expectedHeadOid` = the checked-out HEAD; on a develop run that pair is inconsistent and the commit always fails. It must target develop, and resolve the **live** develop head (develop is busy; a checkout-time SHA goes stale mid-run).
2. **Concurrency is per-ref** (`sync-stories-${{ github.ref }}`) — adequate while one branch triggered; global serialization is the correct posture for a single shared board (dispatch + push can still overlap).
3. **Issue-footer `_Source:` links point at `blob/main`** — for a story that exists only on develop (e.g. SHY-0176) the board link 404s until promotion. Links must point at develop, where story truth lives.

Syncing from develop ONLY (not both branches) is load-bearing: change detection is an equality body-hash with no version ordering, so a main-triggered sync running after a develop one would regress issues to main's older content. Develop ⊇ main for story files under git-flow, so nothing is lost by dropping the main trigger.

## Acceptance Criteria

### Happy path
- [ ] A story `.md` change merged to develop updates its board card (body, status column, issue state) on the next sync run, with no develop→main promotion involved.
- [ ] The workflow's push trigger fires on develop (and NOT on main); path filters are unchanged (`SHY-*.md`, the sync script, the workflow itself).

### Error paths
- [ ] If develop advances while a sync is mid-run, the sidecar commit still lands: `expectedHeadOid` is resolved from the live develop ref at commit time, with one retry on a head-race mismatch; a persistent failure is loud (exit 1 + response logged), and the next run reconciles.
- [ ] A manual `workflow_dispatch` from the default branch (main) cannot publish stale main content: the job checks out `ref: develop` explicitly, so any trigger syncs develop truth.

### Edge cases
- [ ] Back-to-back develop merges serialize: the concurrency group is global (`sync-stories`, no per-ref suffix), `cancel-in-progress: false` — no duplicate issues from concurrent runs.
- [ ] The sidecar commit to develop cannot re-fire workflows: `board-items.json` stays out of the trigger paths, the bot-actor guard remains, and the commit message keeps `[skip ci]` (now load-bearing — develop has push-triggered workflows; main effectively didn't).
- [ ] The footer-URL change flips every issue's body-hash once → a one-time full-body refresh of ~75 issues on the first develop run, then steady-state no-op resumes (no duplicates — the items map + sidecar still key by SHY ID).

### Performance
- [ ] Steady-state no-change run stays ~2-3 API calls; the only addition is one `git/ref/heads/develop` resolution per mutating run (+1 on retry). The one-time refresh (~2 calls × ~75 issues) fits the existing 15-min budget with headroom.

### Security
- [ ] Workflow-token permissions stay `contents: read`; no new secrets; sidecar commits remain App-signed via `createCommitOnBranch` (develop's ruleset `16058327` is `non_fast_forward`-only — verified 2026-07-11 — so the App needs no bypass there).

### UX
- [ ] Operator sees current story state (e.g. a merged-unreleased story sitting In Review) on the board within minutes of the develop merge; board `_Source:` links resolve for develop-only stories instead of 404ing.

### i18n
- N/A — CI plumbing; no user-facing translated surface.

### Observability
- [ ] The sidecar step logs the resolved live head, the commit OID (or both raw GraphQL responses on double-failure), and the existing step summary; the run triggered by THIS story's merge is itself the live-fire proof.

## BDD Scenarios

**Scenario: a ticket edited on the working branch shows up on the board**

- **Given** a story file changes on the team's working branch
- **When** the change lands
- **Then** the story's card on the GitHub board updates to match within a few minutes

**Scenario: two changes landing together don't duplicate cards**

- **Given** two story changes land back-to-back
- **When** both sync runs execute
- **Then** each story still has exactly one card, with the newest content

**Scenario: a manual sync can't roll the board backwards**

- **Given** someone triggers the sync by hand from the release branch
- **When** it runs
- **Then** the board still shows the working branch's newer content, not the release branch's older copy

**Scenario: board links open the ticket, even before release**

- **Given** a brand-new story that exists only on the working branch
- **When** the operator clicks the card's source link
- **Then** the story file opens (no dead link)

## Test Plan

**Classification: CI-config-only (SHY-0163 exemption — device/browser gauntlet skipped).** Scope is confined to `.github/workflows/sync-stories-to-issues.yml`, `scripts/sync-stories-to-issues.sh` (CI-only helper), and the meta-tests that pin them. No app, backend, or website runtime surface.

**Red → Green:**
- **NEW** `express-api/tests/scripts/sync-stories-to-issues-develop-source.test.js` (pure file-content pins + script characterization; no doubles) — all RED against current develop:
  - `push trigger fires on develop, not main`
  - `concurrency group is global (no per-ref suffix) with cancel-in-progress false`
  - `checkout pins ref develop (dispatch-from-main cannot publish stale content)`
  - `sidecar commit-back targets branch develop`
  - `sidecar expectedHeadOid comes from the live develop ref with one head-race retry`
  - `sidecar commit message retains [skip ci]`
  - `footer Source URL points at blob/develop` (script source pin)
- **UPDATED** `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js` — `SOURCE_URL_PREFIX` (line 39) and the two exact-footer regexes (lines ~986, ~1476) flip `blob/main` → `blob/develop`; these are the behavioral (run-the-real-script) proofs of the footer change. All other yaml pins (trigger paths entry, rebuild input, sidecar wiring, actor guard, GH_TOKEN routing, `contents: read`) must stay green — they pin what this story preserves.
- **Static:** `actionlint` (+ embedded shellcheck) on the workflow; `npx prettier --check` + `eslint --max-warnings=0` on touched JS; story validator `--scan`.
- **Canonical runner:** `cd express-api && npm test -- tests/scripts/` locally (never bare `npx jest`); full suite in CI (PR Gate).
- **Phase 2:** `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name (Detect Changes · Analyze JavaScript · PR Gate).
- **Live-fire (post-merge):** merging this PR to develop modifies the workflow file, which is itself a trigger path — the merge fires the first develop sync. Verify that run green + board spot-check: SHY-0149 card shows In Review, SHY-0176 and SHY-0177 cards exist, footer links open on develop.

## Out of Scope
- `sync-roadmap-data.yml` (public-website surface — deliberately reflects main/released state; if the operator wants the public roadmap develop-aware, that's a separate story).
- `inject-pr-closes.yml` (future bug-report intake; untouched).
- Promotion-time board behavior beyond the natural no-op (post-promotion main pushes fire nothing — the promoted workflow file has no main trigger).
- Rewriting sidecar history or reconciling main's now-frozen `board-items.json` copy (develop's copy becomes canonical; promotions carry it forward).

## Dependencies
- Develop branch ruleset `16058327` (`non_fast_forward` only — no PR/signature requirement; verified via `gh api repos/Shyden-Ltd/ShyTalk/rules/branches/develop`, 2026-07-11) — allows the Release App's `createCommitOnBranch`.
- `GH_PAT_PROJECT` + Release App secrets (existing; unchanged).
- `.project/board-items.json` tracked on develop (verified via `git ls-files`).

## Risks & Mitigations
- **Risk:** the footer-hash flip refreshes every issue body once (~150 API calls). **Mitigation:** one-time, within the documented create-scale budget (15-min timeout ≈ 5× headroom); no dedupe risk (SHY-ID-keyed items map + sidecar).
- **Risk:** `expectedHeadOid` races on a busy develop. **Mitigation:** resolve the live head at commit time + one retry; loud failure otherwise and the next run reconciles (sidecar only fills gaps in the API read — script line ~516 — so a missed commit degrades gracefully).
- **Risk:** `board-items.json` diverges main↔develop until the next promotion, which may conflict. **Mitigation:** generated file — resolve with develop's copy; the next sync run rewrites it regardless.
- **Risk:** the old main-triggered workflow remains live on main until promotion. **Mitigation:** push events evaluate the workflow file at the pushed commit, so the promotion itself (carrying this change) cannot fire the old trigger; any interim main story push syncs content strictly newer than the board's current 3-day-stale state (forward-only, no regression).

## Definition of Done
- [x] Workflow (trigger, checkout ref, global concurrency, sidecar target + live-head retry) + script footer + meta-tests implemented; RED→GREEN trail in the new test file; updated characterization assertions green.
- [x] CLAUDE.md § Board mirror updated (trigger branch, global concurrency, develop footer links, sidecar-on-develop).
- [x] **Pre-Merge Testing Protocol satisfied under the CI-config-only exemption:** Jest meta-tests + actionlint + eslint/prettier + validator green locally → `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name → merge to develop (autonomous per develop merge authority) → **live-fire proof:** the sync run green + board reflects develop truth (see the 2026-07-11 postmortem Note: proof ran via dispatch; organic push-trigger proof rides the next story-md merge).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
Reviewed-up-to: c31e59dc19a
- 2026-07-11 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) at operator request ("sync ticket changes from develop onto the GitHub project board first", prioritized ahead of SHY-0150). Root cause: git-flow pivot (SHY-0161) left the board mirror main-triggered. Pickup-fitness investigation done at creation time: develop ruleset verified `non_fast_forward`-only; sidecar tracked on develop; exactly one `blob/main` in the script (footer, line 1177); four Jest suites pin the script/workflow — impact inventory in `## Test Plan`. Develop-only trigger (not main+develop) is load-bearing: equality body-hash has no version ordering, so a second source branch can regress the board. Non-technical BDD per [[feedback-non-technical-bdd]].
- 2026-07-11 — **MERGED to develop (PR #1570, squash `16877822d64`) + LIVE-FIRE VERIFIED — postmortem addendum (rides the SHY-0150 PR; md-only, review-neutral).** (1) **The merge push fired NO workflows**: the squash body (repo `COMMIT_MESSAGES` squash setting) inherited a literal skip-ci marker from a commit message in the branch, and GitHub suppresses ALL push-event workflows for such a head commit — codified as the global rule [[feedback-never-write-skip-ci-literally]] (always WRITE "skip-ci", never the bracketed literal). (2) Live-fire proof therefore ran via `workflow_dispatch`: run 29134019520 all-green — sidecar bot-commit `cd375263a75` landed on develop with the id-map, board issues #1576/#1577 created, SHY-0149's issue shows In Review, footers point at `blob/develop`. Board is CURRENT with develop. (3) **Organic push-trigger proof PENDING**: the next story-`.md` PR merged to develop (SHY-0150) must auto-fire a sync run — verify at that merge. (4) `pr:` frontmatter left empty per SHY-0149 precedent (a frontmatter edit would re-run the 15-min pre-push hook for zero review value).
- 2026-07-11 — **Rounds 1-3 code-reviewer (pre-push loop): CLEAN (ZERO FINDINGS at R2 and R3).** R1 Critical: the new retry-loop branches (loud exit-1 failure, hoist-resistance of the live-head resolution, per-attempt observability) were unpinned — fixed with 4 tests; mutants built verbatim from the live yaml (hoisted LIVE_HEAD; deleted `exit 1`) and proven killed. R2: ZERO FINDINGS + one informational note (step-summary table unpinned) — filled per [[feedback-fill-gaps-always-no-skip]] as a 12th test. R3: ZERO FINDINGS with independent byte-level re-verification. Suite 12/12; family 214/214 across the 5 sync suites; actionlint + shellcheck + prettier/eslint + validator + no-new-stubs ratchet all clean. `Reviewed-up-to: eb77145031b`. Flipping In Review; push + PR to develop next (autonomous merge per develop authority; the merge itself is the live-fire proof — this workflow file is its own trigger path).
