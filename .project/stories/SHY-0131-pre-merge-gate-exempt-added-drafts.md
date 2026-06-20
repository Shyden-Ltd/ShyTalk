---
id: SHY-0131
status: In Review
owner: claude
created: 2026-06-19
priority: P1
effort: S
type: infra
roadmap_ids: []
public: false
mvp: false
---

# SHY-0131: Pre-Merge Gate must exempt newly-ADDED Draft story files (allow story filing)

## User Story

As a **contributor filing a new story spec**, I want **the SHY-0127 Pre-Merge Gate to allow a newly-added `Draft` story `.md` to merge**, so that **a backlog story can be filed to `main` without being forced to a false `In Review` status before any implementation has started**.

## Why

The SHY-0127 Pre-Merge Gate (`scripts/check-pr-story-status.js`) fails any PR whose diff contains a story `.md` with a status outside `{In Review, Done, Cancelled}`. Its purpose is to stop an **implementation** PR from merging while its story is still `In Progress` (the SHY-0120 slip). But it makes no distinction between *modifying* an existing story (implementation) and *adding* a brand-new one (filing). A story is legitimately `Draft` at filing time — it has not been picked up for implementation — so a pure story-filing PR is blocked, with no correct status to use (forcing `In Review` would be a lie and would break the no-backward-transition lifecycle when the story is later implemented).

Concretely: SHY-0130 (the conversations-list bug, just filed) cannot merge its `Draft` spec to the backlog. Before the gate existed (SHY-0127), Draft stories were filed to `main` freely (e.g. SHY-0102 lived on `main` as a `Draft`). This restores that ability while keeping the gate's real protection — that a *modified* (in-implementation) story must reach `In Review` before merge.

## Acceptance Criteria

### Happy path
- [ ] A PR whose diff **ADDS** a new story `.md` at status `Draft` PASSES the gate (exit 0) — filing exemption.
- [ ] A PR whose story is `In Review` / `Done` / `Cancelled` still PASSES (unchanged).

### Error paths
- [ ] A PR that **MODIFIES** an existing story `.md` still FAILS while its status is `In Progress` or `Draft` (the SHY-0120 protection is preserved — implementation must reach In Review).
- [ ] A PR that **ADDS** a story at `In Progress` still FAILS (filing happens at Draft; In Progress is not a valid filing state — only Draft is exempt).

### Edge cases
- [ ] A renamed/copied story file (diff status R/C) is treated as NOT a fresh add — it must satisfy the allowed-status rule (a moved existing story is not a filing).
- [ ] A PR adding multiple stories where one is `Draft` (added) and another is `In Progress` (added) FAILS (only the Draft-added one is exempt; the In-Progress one still trips the gate).
- [ ] The existing skips are unchanged: no story in the diff → skip (exit 0); `IS_DRAFT=true` → skip.

### Performance
- [ ] N/A — one `git diff` invocation, switched from `--name-only` to `--name-status`; no added I/O of significance.

### Security
- [ ] N/A — the script remains read-only (never executes scanned files; `git` spawned with an arg array; no network/credentials). The exemption does not widen any access; it only relaxes a doc-merge gate for added Draft stories.

### UX
- [ ] On failure, the stderr message still names the offending file and the required statuses; on the new exemption, a clear stdout line states the file passed as a newly-added Draft (filing).

### i18n
- [ ] N/A — CI tooling, no user-facing strings.

### Observability
- [ ] The gate prints, per story file, whether it passed via allowed-status, via the added-Draft filing exemption, or failed — so CI logs make the reason explicit.

## BDD Scenarios

**Scenario: filing a new Draft story passes**
- **Given** a PR diff that adds `.project/stories/SHY-0130-*.md` at `status: Draft`
- **When** the Pre-Merge Gate runs
- **Then** it exits 0
- **And** stdout records the added-Draft filing exemption for that file

**Scenario: implementing a story while still In Progress still fails**
- **Given** a PR diff that MODIFIES an existing `.project/stories/SHY-0999-*.md` whose status is `In Progress`
- **When** the gate runs
- **Then** it exits non-zero
- **And** stderr names the file and requires `In Review`

**Scenario: modifying an existing story that is still Draft still fails**
- **Given** an existing `Draft` story on `main` that a PR MODIFIES but leaves `Draft`
- **When** the gate runs
- **Then** it exits non-zero (the add-only exemption does not apply to modifications)

**Scenario: adding a story at In Progress still fails**
- **Given** a PR diff that ADDS a story at `status: In Progress`
- **When** the gate runs
- **Then** it exits non-zero (only Draft is exempt at filing)

## Test Plan

**RED (extend `express-api/tests/scripts/pre-merge-gate.test.js` first):**
- CHANGE the existing `FAILS when a diffed story is still Draft` test: a newly-ADDED Draft story now PASSES (the filing exemption) — rename + flip the assertion to exit 0.
- ADD `FAILS when an EXISTING (modified) Draft story is in the diff` — extend the harness so the story exists on `main` (committed before branching) and is modified on the feature branch; assert non-zero.
- ADD `FAILS when a newly-added story is In Progress` — added In Progress is not exempt.
- ADD `PASSES added-Draft but FAILS a co-added In-Progress story` — mixed multi-story diff.
- Keep all existing pass/skip tests green (In Review, Done, no-story, IS_DRAFT, multi-story-one-bad).

**GREEN:**
- `scripts/check-pr-story-status.js`: switch the diff to `git diff --name-status --diff-filter=ACMR` and parse the status letter per file; a story file passes when `ALLOWED.has(status)` OR (`diffCode === 'A'` AND `storyStatus === 'Draft'`); otherwise fail. Update the per-file stdout/stderr messaging accordingly.

**Gauntlet:** `*.md`+script change — runs the script's own jest suite + eslint + the frontmatter validator + `code-reviewer`; no device/browser gauntlet (no app/web runtime surface touched).

## Out of Scope

- Any change to which statuses are terminal-acceptable for MODIFIED stories (`In Review`/`Done`/`Cancelled` unchanged).
- The frontmatter validator (`check-story-frontmatter.sh`) — orthogonal.
- Broadening the exemption to In-Progress or to modified files — explicitly NOT done (would re-open the SHY-0120 hole).

## Dependencies

- `scripts/check-pr-story-status.js` (the gate) + `express-api/tests/scripts/pre-merge-gate.test.js` (its real-git test).
- `.github/workflows/pr-checks.yml` `pre-merge-gate` job (invocation unchanged).

## Risks & Mitigations

- **Risk:** the exemption re-opens the SHY-0120 hole (merging an unfinished implementation). **Mitigation:** the exemption is strictly `ADDED + Draft`; any MODIFIED story (the implementation case) still requires In Review — covered by a dedicated modified-Draft-fails test.
- **Risk:** `--name-status` parsing mishandles renames (`R100\told\tnew`). **Mitigation:** take the LAST tab-field as the path and the first character as the code; rename/copy (R/C) are NOT treated as 'A', so they must satisfy the allowed-status rule — covered by an edge-case test.

## Definition of Done

- RED tests written first and failing against the current script; GREEN after the fix; the full `pre-merge-gate.test.js` suite + eslint green; frontmatter validator green; `code-reviewer` clean.
- CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green — and this PR's own gate run (the fixed script) passes with SHY-0131 added at In Review.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-19 — Filed + implemented together (operator chose "fix the gate" over bending SHY-0130 to a false In-Review status). Unblocks filing SHY-0130's Draft spec (PR #1481) and all future Draft-story filing. The gate's real protection (a modified/in-implementation story must be In Review) is preserved by restricting the exemption to ADDED + Draft only.
- 2026-06-19 — code-reviewer round 1: added a dedicated `Cancelled`-status test (was named in a title but only `Done` was asserted). Dismissed a flagged "copied (C) Draft" gap as a false premise — verified empirically that `git diff --name-status --diff-filter=ACMR` never emits `C` without `-C` (a copied file surfaces as `A`), so 'C' is an unreachable input; a copied story file is correctly treated as an added filing. **Known by-design asymmetry:** the LOCAL `scripts/pre-merge-check.sh` (for IMPLEMENTATION merges) still requires `status: In Review` unconditionally and does NOT carry this filing exemption — that is intentional (you don't run the implementation pre-merge gate on a Draft story-filing PR); only CI Gate 1 (`check-pr-story-status.js`) exempts added-Draft filings.
