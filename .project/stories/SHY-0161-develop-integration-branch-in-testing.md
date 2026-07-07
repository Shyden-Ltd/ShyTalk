---
id: SHY-0161
status: In Review
owner: claude
created: 2026-07-07
priority: P1
effort: M
type: infra
roadmap_ids: []
public: false
mvp: false
---

# SHY-0161: Adopt a `develop` integration branch + "In Testing" status (git-flow)

## User Story

As **the ShyTalk delivery team (operator + Claude)**, we want **a `develop` integration branch and an "In Testing" board status**, so that **multiple in-flight tickets can be merged and tested together before promotion, keeping `main` always stable**.

## Why

Today every ticket branches off `main` and merges straight back to `main`, so `main` absorbs each ticket's risk one at a time and there is nowhere to test **several in-flight tickets together** before they reach the stable branch. The operator adopted git-flow: feature branches merge into a shared `develop` branch when they reach their **testing phase**, the (currently deferred) real-device gauntlet runs once against the accumulated batch on `develop`, and only when the whole batch is verified clean do we promote `develop → main` and cut ONE batched release. This keeps `main` always-stable and makes `develop` the batching mechanism for the deferred device gauntlet.

A new **"In Testing"** board column (immediately after In Review) tracks tickets that have merged into `develop` and are awaiting the batch gauntlet. This requires threading a sixth status value through every validator, CI gate, board-sync, roadmap and doc surface that currently hard-codes the five-value lifecycle — and, critically, making CI + the Pre-Merge Gate run on `base: develop` PRs (today they trigger only on `base: main`, so a feature→develop PR would otherwise run **zero** checks).

## Acceptance Criteria

### Happy path
- [ ] A story file whose frontmatter `status: In Testing` passes `scripts/check-story-frontmatter.sh` (exit 0).
- [ ] A feature→develop PR whose diffed story is `In Review` passes the CI Pre-Merge Gate (`scripts/check-pr-story-status.js` exits 0).
- [ ] A develop→main promotion PR whose diffed stories are `In Testing` passes the CI Pre-Merge Gate (exit 0).
- [ ] `scripts/sync-stories-to-issues.sh`'s `status_board_option in-testing` resolves to the exact board option name `In Testing`.
- [ ] A `pull_request` opened against `base: develop` triggers the `Detect Changes`, `Analyze JavaScript`, and `PR Gate` workflows (they run, rather than being skipped by the branch filter).

### Error paths
- [ ] A story with an unknown `status` (e.g. `Backlog`) is still rejected by `check-story-frontmatter.sh` with exit 11 and stderr naming the allowed set.
- [ ] A feature PR whose diffed story is still `Draft` or `In Progress` is still blocked by the Pre-Merge Gate (`check-pr-story-status.js` exit 1) — In Testing does not loosen this.
- [ ] `scripts/pre-merge-check.sh` still refuses (non-`OK`) a story that is `Draft`/`In Progress`/`Done`/`Cancelled`; only `In Review` (feature→develop) or `In Testing` (develop→main) pass.

### Edge cases
- [ ] `scripts/check-epic-frontmatter.sh` accepts `status: In Testing` on an EPIC (shared six-value enum) and still rejects an unknown status with exit 31.
- [ ] The board sync maps `In Testing` to a non-terminal state: the mirrored issue is NOT closed on an `In Review → In Testing` transition (only `Done`/`Cancelled` close the issue).
- [ ] The board-fields validator that asserts "exactly the mapped statuses" is updated to the six-value set (the pinned five-value test no longer under-counts).

### Performance
- [ ] N/A — process/config change; the validator/sync scripts gain one enum value, no measurable runtime change; no app runtime surface.

### Security
- [ ] `develop` receives a branch-protection ruleset requiring the same status-check contexts as `main` (`Detect Changes`, `Analyze JavaScript`, `PR Gate`) plus PR-required and non-fast-forward, so unverified code cannot land on `develop` unchecked. No relaxation of `main`'s protection (ruleset `12613584`); `main` still requires signatures and the develop→main promotion is web-signed.
- [ ] The Pre-Merge Gate change is status-keyed (not base-branch-keyed), so it cannot be tricked into passing a `Draft` story by targeting a different base.

### UX
- [ ] The agile board shows an "In Testing" column between "In Review" and "Done"; tickets merged to `develop`-awaiting-testing are visible there.
- [ ] The public roadmap (`public/roadmap-data.json` + renderer) treats `In Testing` as active work: an In Testing public SHY appears in `currentlyWorkingOn` and renders with an active status icon, not the default "planned" icon.

### i18n
- [ ] N/A — internal delivery process; no new user-facing app strings. The public-roadmap status label is derived from the status value, not a new translated string.

### Observability
- [ ] The board sync emits a clear `::warning::` (non-fatal, exit 0) if the `In Testing` board Status option is not yet provisioned, naming the missing option.
- [ ] The Pre-Merge Gate failure message names the offending story ID and its current status; the frontmatter validator names the invalid value and the allowed set.

## BDD Scenarios

**Scenario: frontmatter validator accepts In Testing**
- **Given** a story file with `status: In Testing` and otherwise valid frontmatter
- **When** `scripts/check-story-frontmatter.sh <file>` runs
- **Then** it exits 0 with no status error on stderr

**Scenario: frontmatter validator still rejects an unknown status**
- **Given** a story file with `status: Backlog`
- **When** `scripts/check-story-frontmatter.sh <file>` runs
- **Then** it exits 11
- **And** stderr lists the allowed statuses including `In Testing`

**Scenario: promotion PR at In Testing passes the gate**
- **Given** a changed story whose `status` is `In Testing`
- **When** `scripts/check-pr-story-status.js` evaluates it
- **Then** it exits 0 (allowed)

**Scenario: in-progress story still blocked by the gate**
- **Given** a changed story whose `status` is `In Progress`
- **When** `scripts/check-pr-story-status.js` evaluates it
- **Then** it exits 1 (blocked)

**Scenario: board sync maps In Testing to its board option**
- **Given** a story with lowercased status `in-testing`
- **When** `status_board_option in-testing` is called in `scripts/sync-stories-to-issues.sh`
- **Then** it prints `In Testing`

**Scenario: In Testing is non-terminal (issue stays open)**
- **Given** a story transitioning `In Review → In Testing`
- **When** the board sync reconciles issue open/closed state
- **Then** the mirrored issue is NOT closed (only Done/Cancelled close it)

**Scenario: In Testing counts as currently working on**
- **Given** a public SHY with `status: In Testing`
- **When** `scripts/sync-shy-to-roadmap-data.mjs` builds the roadmap data
- **Then** the SHY appears in `currentlyWorkingOn`

**Scenario: feature→develop PR runs CI**
- **Given** a PR opened with `base: develop`
- **When** GitHub evaluates workflow triggers
- **Then** `pr-checks.yml` and `codeql.yml` run (their `branches` filter includes `develop`)

## Test Plan

**RED (write/update first — must fail against current five-value code):**
- `express-api/tests/scripts/check-story-frontmatter.test.js` — add "accepts `In Testing`" (exit 0); keep an unknown-status rejection (exit 11) asserting stderr lists `In Testing`.
- `express-api/tests/scripts/check-epic-frontmatter.test.js` — add "accepts `In Testing`" on an EPIC; keep unknown-status exit 31.
- `express-api/tests/scripts/pre-merge-gate.test.js` — add `In Testing → allowed (exit 0)`; keep `In Progress → blocked (exit 1)`.
- `express-api/tests/scripts/sync-stories-to-issues-board-fields.test.js` — add `In Testing` to the `STATUS_OPTIONS` fixture + the status→option mapping `test.each`; update the pinned five-value validator-contract assertion to the six-value set; add an `In Testing` non-terminal (no-close) case.
- `express-api/tests/scripts/sync-shy-to-roadmap-data.test.js` — add `['In Testing', true]` to the currentlyWorkingOn matrix.
- `express-api/tests/scripts/pre-merge-check.test.js` — add an `In Testing` accepted path (base develop→main) + confirm Draft/In Progress/Done still refused.
- `tests/web/roadmap-i18n-lazy.spec.ts` — an In Testing item lifts into `#in-progress-section` with the active icon (not the planned default). Real Playwright against the static roadmap page with a fixture `roadmap-data.json` (test data, no new mock); runs in the deferred browser gauntlet.

**GREEN (implement to pass):**
- `scripts/check-story-frontmatter.sh:42` + `scripts/check-epic-frontmatter.sh:45` — `VALID_STATUS="Draft|In Progress|In Review|In Testing|Done|Cancelled"`.
- `scripts/check-pr-story-status.js:29` — add `'In Testing'` to `ALLOWED`.
- `scripts/sync-stories-to-issues.sh` — add `in-testing) echo "In Testing" ;;` to `status_board_option()` (after `in-review)`).
- `scripts/pre-merge-check.sh` — accept `In Review` OR `In Testing`.
- `scripts/sync-shy-to-roadmap-data.mjs:301` — `currentlyWorkingOn` includes `In Progress` and `In Testing`.
- `public/js/roadmap-app.js` — add an `in-testing` case to the status-icon + active-lift predicates.
- `.github/workflows/pr-checks.yml` + `.github/workflows/codeql.yml` — add `develop` to `pull_request: branches`.

**Verification:** the validator/gate/sync/roadmap-data changes are scripts/workflows/docs (non-device). The ONE browser surface — the `public/js/roadmap-app.js` renderer — is proven by the Playwright spec above, run in the deferred `develop` batch gauntlet (NOT claimed device-exempt).
- `cd express-api && npm test -- tests/scripts/` fully green (all six updated files, incl. the five→six-value pins).
- `bash scripts/check-story-frontmatter.sh --scan` + `bash scripts/check-epic-frontmatter.sh --scan` green with this In Testing-capable corpus.
- Exercise the flow on this bootstrap story: open the feature→develop PR, confirm CI actually runs (proves the branches-filter edit); flip to In Testing; open the develop→main promotion PR, confirm the gate passes at In Testing.

## Out of Scope

- The SHY-0102 rooms `list` fix (in flight on `fix/SHY-0102`; it just migrates onto `develop`) and the SHY-0160 conversations cross-cohort leak (a separate security story).
- Automating creation of the board "In Testing" Status option — GitHub Projects v2 Status is a built-in single-select the operator provisions manually; the sync only reads it by name (warns-and-continues if absent).
- Any change to `release.yml` / `release-tag.yml` — the release path is unchanged: a develop→main merge fires `release-tag.yml` which short-circuits unless the commit is a `chore: release`, and the batched version is cut by the normal manual `release.yml` dispatch.
- Retiring or hard-failing `branch-discipline-check.yml` (soft-fail, base-main only) — its intent comment may be updated but its logic is untouched.

## Dependencies

- GitHub Projects v2 board "Status" single-select field (the manual `In Testing` option).
- `gh` CLI + repo-admin token for the `develop` branch-protection ruleset.
- The mapped touchpoints: `scripts/check-story-frontmatter.sh`, `scripts/check-epic-frontmatter.sh`, `scripts/check-pr-story-status.js`, `scripts/sync-stories-to-issues.sh`, `scripts/pre-merge-check.sh`, `scripts/sync-shy-to-roadmap-data.mjs`, `public/js/roadmap-app.js`, `.github/workflows/pr-checks.yml`, `.github/workflows/codeql.yml`, `CLAUDE.md`, `.project/stories/SHY-INDEX.md`.

## Risks & Mitigations

- **Risk:** feature→develop PRs run no CI if the workflow `branches` filter is not updated → **Mitigation:** the `pr-checks.yml`/`codeql.yml` branches edit is core to this story and is verified by opening a real feature→develop PR and confirming the checks run.
- **Risk:** the five-value pinned tests silently under-count and a status typo slips through → **Mitigation:** those pins are updated to the six-value set as the RED start; a genuinely-unknown status still fails.
- **Risk:** `develop` drifts/breaks under the fix-forward model → **Mitigation:** `develop` branch protection requires the green status checks; fix-forward keeps it green before promotion.
- **Risk:** bootstrap chicken-and-egg — this story is what enables develop-CI, so its own feature→develop PR predates the filter edit → **Mitigation:** land it via the develop→main promotion PR (base `main`, full CI runs) as the validating gate; develop protection is applied only after this story merges.

## Definition of Done

- All six test files updated (RED-first) and green; `npm test -- tests/scripts/` passes; both frontmatter validators pass `--scan` with an In Testing story present.
- `develop` branch created and protected (parallel ruleset); the board "In Testing" Status option provisioned.
- `CLAUDE.md` (frontmatter enum, Lifecycle, Git Rules git-flow + one-active-branch relaxation, Board status conventions, Pre-Merge Testing Protocol) and `SHY-INDEX.md` legend updated to the new flow.
- `code-reviewer` 100% clean on the local commit before push; CI green (Detect Changes · Analyze JavaScript · PR Gate).
- Landed via the new flow on itself and released in a `vX.Y.Z` with `released_in:` set.

## Notes (running log)

- 2026-07-07 — Filed. Operator adopted git-flow with a `develop` integration branch after four locked design decisions: (1) branch off `develop`, back to `develop`; (2) new "In Testing" column after In Review; (3) fix-forward — the batch waits for a failing ticket; (4) one batched release per develop→main promotion. Codebase touchpoints mapped (Explore). `develop` created off `origin/main` (`a20d453681d`) and pushed; this story built on `feature/SHY-0161-develop-branch-flow`. Bootstrap lands via feature→develop→main on itself; the scripts/workflows/docs are verified by unit tests + CI, and the one browser surface (`public/js/roadmap-app.js` renderer) by Playwright in the deferred batch gauntlet.
- 2026-07-07 (review) — code-reviewer dispatched on `912d9afd908`: ZERO correctness bugs in the diff (gate logic, 4-spot renderer consistency, board non-terminal handling, casing chain, CI security all "Verified Clean"). 8 findings, all addressed in the follow-up commit: **C1** — `sync-stories-to-issues.yml` now fires on `develop` (so the `In Review → In Testing` flip moves the board), with the `main`-hardcoded sidecar commit-back gated to `main` only (avoids an expectedHeadOid mismatch on develop runs). **C2** — new `git-flow-workflow-triggers.test.js` pins the pr-checks/codeql/board-sync `develop` branch filters. **C3** — In Testing donut-count Playwright test. **I1** — CLAUDE.md `currentlyWorkingOn`/lag doc corrected. **I2** — PR-template In Testing stage. **I3** — validator stderr lists In Testing. **I4** — board `In Review → In Testing` transition test. **I5** — unscoped no-double-render assertion. Fix batch self-reviewed + green (515 script tests, actionlint, eslint, prettier, both validator scans); a formal agent re-review of the fix batch is recommended before the `develop → main` promotion.
- 2026-07-07 (pickup / rebase + re-review) — Rebased onto healed `main` `c1182d50be6` (SHY-0162's CI-pin-drift heal), force-free (branch was unpushed); only `SHY-INDEX.md` overlapped and git auto-merged both entries (different table regions), zero code conflicts. Full `tests/scripts` green post-rebase (**111 suites / 6893 tests**), which also confirms SHY-0161's `pr-checks.yml`/`codeql.yml`/`sync-stories-to-issues.yml` edits satisfy SHY-0162's new repo-wide `ci-action-pin-consistency` guard. Formal agent **re-review** of the whole diff (incl. the previously self-reviewed-only fix batch `bc17b6a13ef`): **zero Critical, one Important** — a stale `# ... 5 allowed values` comment in `check-story-frontmatter.sh:239` (fixed → `6`); plus a self-caught stale "five option names" comment in `sync-stories-to-issues.sh` (fixed; verified accurate vs the resolve-by-name-warn-if-absent ladder). All 8 focus areas (sync-stories develop-trigger + `main`-gated sidecar, GHA base-branch bootstrap caveat, 4-site renderer exhaustiveness incl. the phase-shell axis correctly NOT threaded, six-point enum parity, SHY-0162 guard interaction, status-keyed-not-base-keyed security, CLAUDE.md↔code consistency) **verified clean**; coverage **no-gaps** (every changed branch → ≥1 exact-value accept+reject test). Both fixes comment-only (`83d56eeeef1`); shellcheck + the two affected suites (353 tests) green. Open item (operator/infra, per DoD): `develop` branch-protection ruleset + board "In Testing" option — not in this diff.
- Reviewed-up-to: 83d56eeeef1
