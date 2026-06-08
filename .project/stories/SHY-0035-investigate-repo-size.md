---
id: SHY-0035
status: Done
owner: claude
created: 2026-06-08
priority: P0
effort: M
type: chore
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1041
---

# SHY-0035: Investigate >1GB repo size + audit large committed files + prevent recurrence

## User Story

As the ShyTalk operator who observed during SHY-0033's branch cleanup that the `Shyden-Ltd/ShyTalk` repo is **>1GB** ("don't upload large files. finish what you're working on first then tackle these" — operator 2026-06-07 ~22:10 BST), I want **the actual repo size measured, the historical large-file commits identified + documented, `.gitignore` hardened to prevent recurrence, and a CI lint that blocks any future >5MB file from landing — all WITHOUT a force-push or history rewrite** (per operator 2026-06-08 ~10:11 BST: "you do 1. but without force-pushes, you have to follow the processes"), so that the bloat is contained, root-causes are recorded, and future bloat is impossible without explicit operator authorisation for a history-rewrite SHY.

## Why

Investigation findings (gathered 2026-06-08 11:24–11:30 BST via `git rev-list --objects --all | git cat-file --batch-check` + `du -sh .git` + `git count-objects -vH`):

- **Actual repo size: 12.74 GiB pack** (not 1GB — `git count-objects -vH` reports `size-pack: 12.74 GiB`). Operator's "1GB" estimate was conservative by an order of magnitude.
- **Working-tree size: 35 GiB** — but the bulk is local build artefacts (gRPC.framework 2.9GB, FirebaseFirestoreInternal 538MB, derived data caches, the dev APK at 190MB, KMP-link debug `.dylib`s at 97–283MB each). These are correctly NOT committed.
- **`.git/` on disk: 13 GiB** (pack + loose + reflog).
- **Ever-committed blob totals by top-level directory (>100MB):**

  | Dir              | Ever-committed | Blob count   | Currently tracked? |
  | ---------------- | -------------- | ------------ | ------------------ |
  | `data/`          | 23.55 GiB      | ≥17,986      | 0 files            |
  | `playwright/`    | 13.83 GiB      | ≥1,397,202   | 0 files            |
  | `express/`       | 2.58 GiB       | (1000s)      | 0 files            |
  | `history/`       | 947 MiB        | (100s)       | 0 files            |
  | `kotlin/`        | 459 MiB        | (100s)       | 0 files            |
  | `android-e2e/`   | 148 MiB        | (100s)       | 0 files            |

  All six directories are **Allure-report artefact paths** (sample blobs match the Allure tree: `history/categories-trend.json`, `<dir>/pr/<n>/history/`, `data/attachments/*.zip`). At some point a workflow was publishing Allure reports back into the working tree on a branch (likely an early version of `allure-report` / `gh-pages-deploy` workflows) and the published reports got committed before the workflow was fixed.

- **Currently-tracked large file:** `app/src/main/res/raw/room_background.gif` — 54.6 MB blob, 52 MB on disk. This is a legitimate app resource (used by the in-room background animation) but is borderline-large and a candidate for migration to a CDN in a future SHY (out of scope here).
- **Sample of ever-committed `data/attachments/` blobs:** the top 30 are all `*.zip` files at 13–43 MB each with random hex hashes for names (e.g. `34cc1ab47f285541.zip`, `3579b234c54d1a20.zip`). The naming pattern is Allure's attachment-hash convention.

**Why the pack is 12.74 GiB even though only `room_background.gif` is currently tracked:** git delta-compresses blobs aggressively (each Allure report run produces slightly-different copies of similar trend-JSON / screenshot binaries), but historical objects remain reachable via deleted refs (closed PRs, deleted branches whose refs are kept by GitHub for ~90 days, the reflog) and through main's history until a future force-push + filter-repo.

**Operator's constraint:** "you do 1. but without force-pushes, you have to follow the processes" (2026-06-08 ~10:11 BST). The investigation MUST stop short of `git filter-repo` / `bfg` + force-push to main. History rewrite is deferred to a future explicit-auth SHY. This SHY closes the prevention loop — actual cleanup requires another SHY with explicit operator authorisation for the destructive step.

**Three prevention mechanisms in scope here:**

1. **`.gitignore` hardening** — explicitly ignore every Allure-report-path top-level directory + every known large-binary extension that should never be committed.
2. **CI lint via `scripts/check-large-files.sh`** — pre-push + CI step that rejects any tracked file >5MB on the branch. The 5MB threshold mirrors operator's "never commit files >5MB without explicit authorisation" directive ([[feedback-one-active-branch-close-on-finish]]).
3. **Audit artefact** — `.project/audit/repo-size-audit-2026-06-08.md` captures the snapshot so future audits can diff against it and so the eventual history-rewrite SHY has a clear "what to purge" target list.

## Acceptance Criteria

### Happy path

- [ ] `.project/audit/repo-size-audit-2026-06-08.md` committed, containing: `du -sh .git` output, `git count-objects -vH` full text, top-40-largest-blobs table (size + path), top-level-dir bloat table (the 6-dir summary above), Allure-pattern root-cause analysis, current-tracked >5MB file list, prevention mechanisms cross-linked to the lint script + .gitignore diff.
- [ ] `.gitignore` updated to explicitly ignore: `/data/`, `/playwright/pr/`, `/playwright/deploy/`, `/playwright/latest/`, `/express/`, `/history/`, `/kotlin/`, `/android-e2e/` (the architect cycle widened `/express/pr/` → `/express/` and `/kotlin/pr/` → `/kotlin/` to also cover `deploy/` + `latest/` Allure variants), plus reinforced extension blocks for `*.apk`, `*.aab`, `*.ipa`, `*.zip` (with operator-curated allowlist exceptions for any legitimate small zips currently tracked — verify via `git ls-files '*.zip' | xargs -I{} du -h {}`).
- [ ] `scripts/check-large-files.sh` created — shell script that lists every tracked file >5MB and exits non-zero if any found. Defaults to `HEAD` working tree; takes `--against <ref>` to scan only files added in the current diff. Idempotent + safe under `set -euo pipefail`.
- [ ] `scripts/check-large-files.sh` wired into pre-push hook via `.husky/pre-push` (add a step after the existing Sonar/checks).
- [ ] `.github/workflows/lint.yml` runs `scripts/check-large-files.sh --against origin/main` as a required step on every PR; hard-fail if any file >5MB landed in the diff.
- [ ] `CLAUDE.md` § "Git Rules" expanded with a "Large files" subsection pointing at the lint script + the 5MB threshold + the escape hatch (operator authorisation via PR description containing `[allow-large-file: <path> reason: <reason>]`).
- [ ] Unit tests for `scripts/check-large-files.sh` in `express-api/tests/scripts/check-large-files.test.js` covering: happy-path (no large files → exit 0), large-file-detected (exit non-zero + lists files), `--against <ref>` diff-only mode, escape-hatch marker recognition, missing-script error, malformed file-size handling.
- [ ] Housekeeping bundled in this PR (acceptable because trivial + operationally adjacent): SHY-0034's `status:` flipped `In Progress → Done` + `pr:` populated + Notes appended (already done in this branch's first commit); SHY-INDEX.md SHY-0034 moves Active → Done + SHY-0035 promoted from Reserved → Active; SHY-INDEX Reserved table: SHY-0040 (sync-stories perf) added.

### Error paths

- [ ] **`git rev-list` timeout on huge repos**: script uses `--batch-check` (single git invocation, not per-object) and a 5-minute timeout; on timeout, emits a clear "investigation pass incomplete; rerun with --time-budget=900" message and exits non-zero.
- [ ] **Allowlist marker `[allow-large-file: ...]` in commit message but file actually NOT in diff**: lint script treats this as a no-op (warning, not error) — the marker doesn't grant blanket permission for a future file.
- [ ] **Lint script run on a fresh shallow clone** (CI's default `actions/checkout` is shallow): script verifies the `--against` ref resolves locally via `git rev-parse --verify`; if not, exits 4 with a clear "fetch origin first" message rather than silently promoting to HEAD-mode (which would false-positive on every pre-existing >5MB file). CI workflow explicitly `git fetch --depth=1 origin main` BEFORE running the script.
- [ ] **A file is exactly 5,242,880 bytes (5MB on the dot)**: script uses `>` not `>=` (5,242,880 = 5MB exactly is acceptable; one byte more fails). Documented in the script header.
- [ ] **Symlinks pointing to large files**: script uses `git ls-tree -r HEAD | awk '$2=="blob"'` to enumerate TRACKED blobs only, not file-system walks; symlinks resolve to their blob (a 40-byte text blob containing the path), so naturally safe.
- [ ] **`.gitignore` rule conflicts with currently-tracked legitimate file**: pre-flight check warns if a `.gitignore` addition would have ignored a currently-tracked file (`git check-ignore --no-index <path>` + cross-reference with `git ls-files`); operator must explicitly `git rm --cached` to apply.

### Edge cases

- [ ] **The 52MB `room_background.gif` already tracked**: lint script's HEAD-mode (no `--against`) reports it; PR diff-mode (`--against origin/main`) does NOT report it because the diff is empty for this file. Documented as "pre-existing file; out of scope for this PR; tracked for a future move-to-CDN SHY."
- [ ] **A future PR legitimately adds a 4.99MB file** (just under threshold): lint passes silently — no near-threshold warning. Out-of-scope for this SHY: a future "warn at 80% of threshold" enhancement.
- [ ] **A future PR legitimately needs a >5MB asset** (e.g. high-res illustration): operator adds `[allow-large-file: path/to/asset.png reason: hi-res hero image]` marker to PR description; CI lint reads PR body via `gh pr view --json body`, finds marker, exempts that specific path. Marker is per-PR, not per-repo.
- [ ] **Repo size grows because of legitimate code/docs additions** (not large binaries): NOT in scope — `check-large-files.sh` only checks per-file size, not aggregate repo size. Aggregate growth is monitored by the operator manually via `du -sh .git`.
- [ ] **Cross-platform path separators**: script uses POSIX `find` / `git ls-files` (forward slashes); ShyTalk has no Windows contributors. Documented.
- [ ] **CI runner without `git`**: impossible (every GH-hosted ubuntu runner has git); script asserts `command -v git` at startup and exits 3 with clear message if missing (matches the documented exit-code table in the script header).
- [ ] **Pre-push hook bypass via `--no-verify`**: NOT prevented at the local level (NEVER prevented per [[feedback-never-no-verify-without-permission]] policy is about ASKING, not about HARD-blocking the user's escape hatch). The PR-level CI lint catches anything that escaped the local hook.

### Performance

- [ ] `scripts/check-large-files.sh` HEAD-mode completes in <5 seconds on a 12 GiB pack (`git ls-tree -r HEAD | awk` is O(tracked-files), not O(pack-size)).
- [ ] `scripts/check-large-files.sh --against origin/main` completes in <2 seconds on a typical PR diff (10–50 files).
- [ ] Pre-push hook overhead: <1 second (cached `git ls-tree`).
- [ ] CI step in `lint.yml`: <30 seconds end-to-end including checkout + fetch.
- [ ] Audit-snapshot regeneration (`du -sh .git` + `git rev-list`): <3 minutes on the 12 GiB pack (run-once per audit; not in hot path).

### Security

- [ ] Lint script + audit script do NOT log file CONTENTS — only paths + sizes. No secret leakage even if a large file happens to be a credentials dump.
- [ ] CI workflow runs with read-only `contents: read` permission; no write access.
- [ ] No external service calls (no remote API queries; pure git CLI).
- [ ] Escape-hatch marker `[allow-large-file: <path>]` requires the operator's PR description — only the operator (or a trusted contributor with `pull-requests: write`) can author. Documented as "operator-or-trusted-contributor-only."
- [ ] No `eval` / dynamic-bash in any script; all user-derived input (paths) is passed via `--` separator after fixed flags.

### UX

- [ ] N/A — operator-side tooling + CI lint; no end-user UX.

### i18n

- [ ] N/A — internal tooling + audit doc only; English-only.

### Observability

- [ ] `scripts/check-large-files.sh` emits a final summary line: `[check-large-files] scanned: N files, large: M (>5MB), errors: K`.
- [ ] On failure, the script lists every offending file with size in MB + suggested remediation (Git LFS / CDN / extension to `.gitignore`).
- [ ] CI lint job summary includes the offending-file table when fail.
- [ ] `.project/audit/repo-size-audit-2026-06-08.md` includes a "Diff-from-baseline" note explaining how a future re-audit should compute the delta (compare against this file's "Pack size" + "Top-level-dir totals" numbers).
- [ ] Commit message for the housekeeping commit names the threshold: `[SHY-0035] audit: 12.74 GiB pack + add >5MB lint`.

## BDD Scenarios

**Scenario: Investigation enumerates all large blobs**

- **Given** the operator is on `story/SHY-0035-investigate-repo-size`
- **When** the investigation pipeline runs (`git rev-list --objects --all | git cat-file --batch-check`)
- **Then** the audit doc `.project/audit/repo-size-audit-2026-06-08.md` exists with a top-40 table
- **And** each row has `size_bytes` + `path` columns
- **And** the table is sorted by size descending
- **And** the per-top-level-dir aggregate table includes all 6 known bloat dirs (data, playwright, express, history, kotlin, android-e2e)

**Scenario: .gitignore hardened against re-commit**

- **Given** `.gitignore` has the new SHY-0035 block
- **When** a contributor accidentally runs an Allure report into the working tree and `git add .` everything
- **Then** none of the Allure artefacts get staged
- **And** `git check-ignore data/attachments/abc.zip` returns the matching `.gitignore` line

**Scenario: CI lint rejects a >5MB addition**

- **Given** a PR adds `assets/huge.zip` at 6 MB
- **When** `lint.yml`'s `check-large-files` step runs against `origin/main`
- **Then** the step exits non-zero
- **And** the job summary includes `assets/huge.zip — 6.0 MB`
- **And** the PR cannot be auto-merged because lint is a required check

**Scenario: Escape hatch unlocks a legitimate large asset**

- **Given** a PR adds `app/src/main/res/raw/hero_v2.gif` at 8 MB
- **And** the PR description contains the line `[allow-large-file: app/src/main/res/raw/hero_v2.gif reason: hero animation replacement]`
- **When** the lint runs
- **Then** the marker is parsed
- **And** `hero_v2.gif` is exempted from the >5MB rejection
- **And** the job summary notes "exempted by marker" for that file

**Scenario: Lint passes when no large files are added**

- **Given** a PR adds only `src/foo.ts` at 12 KB
- **When** the lint runs
- **Then** the step exits 0
- **And** the summary line reads `[check-large-files] scanned: 1 files, large: 0, errors: 0`

**Scenario: Lint exits 4 when --against ref is unreachable (no silent fallback)**

- **Given** CI did not explicitly fetch `origin/main` (e.g. shallow clone with no extra fetch step)
- **When** the lint runs `scripts/check-large-files.sh --against origin/main`
- **Then** the script exits with code 4
- **And** stderr contains the literal substring `not found locally`
- **And** stderr instructs the operator to `git fetch --depth=1 origin main` first
- **And** the script does NOT silently promote to HEAD-mode (which would false-positive on the 6 pre-existing >5MB tracked files documented in the audit)

**Scenario: Unit tests cover the diff-only mode**

- **Given** the test suite at `express-api/tests/scripts/check-large-files.test.js`
- **When** Jest runs `runScript(['--against', 'origin/main'])`
- **Then** the test asserts the script honours the `--against` flag
- **And** does not report pre-existing large files like `room_background.gif`

## Test Plan

**Red:**
- New file `express-api/tests/scripts/check-large-files.test.js` — assert script exists + is executable (preconditions), HEAD-mode happy-path → exit 0, HEAD-mode with synthetic >5MB blob fixture → exit non-zero + correct file listed, `--against <ref>` mode → exit 0 (no diff additions), `--against <ref>` with synthetic large addition → exit non-zero, escape-hatch marker recognition (mock `gh pr view --json body` via env-var or stdin pipe), missing-script handler, malformed `git ls-tree` output (corrupted index simulation) → exit non-zero with clear error.
- `tests/workflows/lint-pin.test.js` — assert `lint.yml` includes the `check-large-files` job step name + run line matching `scripts/check-large-files.sh --against origin/main`.

**Green:**
- Create `scripts/check-large-files.sh` per AC; chmod +x; verify shellcheck clean (`shellcheck scripts/check-large-files.sh`).
- Wire into `.husky/pre-push` (append, don't replace existing checks).
- Wire into `.github/workflows/lint.yml` (add new step under existing lint job; `if: github.event_name == 'pull_request'` so it doesn't run on direct main-pushes which can only come from the Release App's `createCommitOnBranch` and are exempt from this lint).
- Update `.gitignore` with new ignored paths; verify `git check-ignore` returns each new rule for representative sample paths.
- Update `CLAUDE.md § Git Rules` with the "Large files" subsection.
- Write `.project/audit/repo-size-audit-2026-06-08.md` with all findings.

**Coverage gate:** `npx jest express-api/tests/scripts/check-large-files.test.js tests/workflows/lint-pin.test.js` → all green (≥7 tests per file).

**Validation pre-push:** run `bash scripts/check-large-files.sh` against current HEAD; expected output: `[check-large-files] scanned: ~22000 files, large: 1, errors: 0` with `app/src/main/res/raw/room_background.gif` listed (acknowledged pre-existing). Diff-mode against `origin/main` should report 0 new >5MB files (this PR only adds docs + scripts + lint).

## Out of Scope

- **Force-push / history rewrite / BFG / `git filter-repo`** — operator directive: "you do 1. but without force-pushes." A future explicit-auth SHY will tackle the actual pack-size reduction; this SHY closes prevention only.
- **`room_background.gif` migration to CDN** — borderline-large pre-existing tracked file; legitimate app resource; out of scope for this prevention-focused SHY. Filed as a future SHY recommendation in the audit doc.
- **Git LFS adoption** — bigger architecture decision (operator-facing UX, CI cost, mirroring strategy). Out of scope; filed as future SHY candidate in audit doc.
- **Repo size monitoring as a CI metric** (e.g. fail-if-pack-grows-by-X%) — interesting but distinct from per-file >5MB enforcement. Filed as future SHY candidate.
- **Cleaning the reflog + running `git gc --aggressive --prune=now` locally** — affects only the local clone, not the remote pack. Doesn't help operator's "repo is >1GB" problem.
- **GitHub-side garbage collection** — happens automatically every ~90 days; we cannot force it via API.

## Dependencies

- **SHY-0033 (merged)** — branch cleanup completed first; `.project/audit/` directory established; existing branch-cleanup audit docs as a structural template for this audit doc.
- **SHY-0034 (merged)** — release flow tag-only confirmed; release-tag CI lint integration pattern available as reference.
- `.husky/pre-push` — must exist (it does; currently runs Sonar + check-no-paid-runners + check-release-trigger + check-action-shas).
- `.github/workflows/lint.yml` — must exist (it does; currently runs ktlint + detekt + prettier + actionlint + check-no-paid-runners + check-workflow-concurrency-scoping + check-action-shas + check-story-frontmatter).
- Node + Jest test runner — for the unit tests at `express-api/tests/scripts/check-large-files.test.js`.

## Risks & Mitigations

- **Risk: `.gitignore` addition silently ignores a legitimately-tracked legacy file.** Mitigation: pre-flight `git ls-files` + `git check-ignore --no-index` cross-reference; ANY conflict listed in the audit doc + flagged in PR description for operator decision before merge.
- **Risk: The pre-push hook fires too slowly and frustrates the developer flow.** Mitigation: HEAD-mode tested to complete in <5s on the 12 GiB pack; diff-mode <2s; hook is non-blocking on `--no-verify` (operator-only escape hatch documented).
- **Risk: CI lint becomes a false-positive treadmill** (legitimate large files added without marker). Mitigation: Clear error message includes the EXACT marker syntax to copy-paste into the PR description; documented in `CLAUDE.md`.
- **Risk: The audit doc grows stale and future Claude sessions trust outdated numbers.** Mitigation: filename includes the date (`repo-size-audit-2026-06-08.md`); future re-audits create dated companions and diff against the baseline; baseline is never overwritten.
- **Risk: The 5MB threshold is too restrictive for legitimate game/AR assets that ship later.** Mitigation: Escape-hatch marker handles per-PR exceptions; threshold change requires a follow-up SHY (well-scoped, not unbounded creep).
- **Risk: Force-push deferral leaves the 12.74 GiB pack permanent.** Mitigation: Documented in audit doc as the SINGLE next-step blocker; operator can authorise the destructive cleanup SHY at their discretion. The audit doc provides the complete blob-purge target list so the cleanup SHY has zero discovery cost.

## Definition of Done

- [ ] `.project/audit/repo-size-audit-2026-06-08.md` committed with all findings tables.
- [ ] `.gitignore` updated with new ignored paths; `git check-ignore` verification documented.
- [ ] `scripts/check-large-files.sh` created, executable, shellcheck-clean.
- [ ] `express-api/tests/scripts/check-large-files.test.js` created with ≥7 tests; all green.
- [ ] `.husky/pre-push` updated to call the new lint.
- [ ] `.github/workflows/lint.yml` updated with new step.
- [ ] `CLAUDE.md § Git Rules` updated with "Large files" subsection.
- [ ] Architect agent: ZERO findings.
- [ ] Code-reviewer agent: ZERO findings.
- [ ] Per-type Done gate satisfied (`chore` → auto-merge once green; no dev-deploy required).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 12:54 BST — **MERGED** as PR #1041 (auto-merge fired at `2026-06-08T11:54:59Z` — ~10 min after arming). Squash-merge subject landed CLEAN: `SHY-0035: Investigate >1GB repo size + audit + add >5MB lint (#1041)` — no `[DRAFT]` prefix, no exploratory parentheticals. Confirms [[feedback-update-pr-title-before-promote]] lesson (from PR #1040 close-out) is now baked in. Final cycle counts: 1 architect dispatch (4 findings), 4 reviewer dispatches (8 → 2 → 1 → 0 findings; total 11), all 15 applied. Status flipped `In Progress → Done`. Status flip lands in SHY-0036's branch (per [[feedback-one-active-branch-close-on-finish]] — admin work piggybacks on the next active branch).
- 2026-06-08 ~12:35 BST — Code-reviewer cycle 4 returned **ZERO FINDINGS** — clear to auto-merge. Verified cross-doc consistency one final time: AC bullet at line 57 now reads `/express/` `/kotlin/` (synced with audit doc + .gitignore + CLAUDE.md). Remaining stale-form hits in the audit doc are in the "Sample paths confirmed" block describing actual historical blob paths (correct as-is, evidence not rules) and in Notes log entries (correct as-is, historical record).
- 2026-06-08 ~12:25 BST — Code-reviewer cycle 3 returned 1 Important, applied. AC Happy-path bullet at line 57 still listed pre-architect-widening forms `/express/pr/` and `/kotlin/pr/`; cycle 1 fixed the audit-doc Prevention section (where reviewer pointed) but missed the AC bullet — two surfaces, one update, easy to miss. Now both surfaces synced to `/express/` and `/kotlin/`. Cycle counts: 3 reviewer dispatches, 11 findings total, all applied. Convergence shape 8→2→1; expect cycle 4 to confirm ZERO.
- 2026-06-08 ~12:15 BST — Code-reviewer agent cycle 2 returned 1 Important + 1 Suggestion, both applied. (1) **Important**: audit doc Diff-from-baseline table `>5MB tracked: 1 → 6` (forgot to sync the baseline-comparison table when fixing the Headline in cycle 1; future re-audit would have falsely reported `Δ = +5` from a static baseline). (2) **Suggestion**: audit doc Prevention-mechanisms test count `15 → 17` (the cycle-1 fix added 2 equals-form tests; Notes recorded 28/28 across two files but the Prevention section still said 15). Both fixes are doc-only — no code, script, test, or workflow affected. Cycle 2 confirmed: cycle-1 fixes are correct (`--against=*)` strips prefix safely since git refs can't contain `=`; `*.zip` rule doesn't shadow any currently-tracked file; pin-test `indexOf` ordering tests have no false-positive risk because the search strings are unique step names; BDD scenarios match implementation). Cycle counts so far: 2 reviewer dispatches, 10 findings total, all applied.
- 2026-06-08 ~12:00 BST — Code-reviewer agent (`feature-dev:code-reviewer`) cycle 1 returned 4 Important + 3 Suggestions + 1 Nit, all 8 applied. (1) **Important**: created `express-api/tests/scripts/large-file-guard-pin.test.js` (11 tests pinning lint.yml + pr-checks.yml wiring — step name, run line, fetch command, ALLOW_LARGE_FILE_BODY from inputs.pr_body, ordering before story-validator). (2) **Important**: added `*.zip` to `.gitignore` (verbatim AC item that I dropped during initial impl). (3) **Important**: audit-doc Headline `1 file` → `6 files` (room_background.gif + 5× police_duck.png). (4) **Important**: BDD "Lint warns on shallow clone but still scans" rewritten to "Lint exits 4 when --against ref is unreachable (no silent fallback)" — matches the actual implementation that the architect cycle ALSO baked in. (5) **Suggestion**: `--against=ref` equals-form supported (case `--against=*)`); added 2 new tests covering the form + empty-value rejection. (6) **Suggestion**: AC Edge-cases "exit 127" → "exit 3" (matches the documented exit-code table). (7) **Suggestion**: audit-doc Prevention-mechanisms `/express/pr/`+`/kotlin/pr/` → `/express/`+`/kotlin/` (matches the architect-widened `.gitignore`). (8) **Nit**: test-file path references `tests/scripts/...` → `express-api/tests/scripts/...` in the SHY spec. Test count after this round: 28/28 across two files; shellcheck + actionlint + frontmatter validator all clean. Cycle counts: 1 reviewer dispatch, 8 findings, all applied.
- 2026-06-08 ~11:50 BST — Architect agent (`feature-dev:code-architect`) returned APPROVE-WITH-CHANGES: 2 Important + 2 Suggestions, all applied. (1) `is_exempt` fn — replaced `"${EXEMPT_PATHS[@]:-}"` with explicit `[ "${#EXEMPT_PATHS[@]}" -eq 0 ]` length-guard for bash 3.2 defensiveness; (2) lint.yml `pr_body` — added explicit `workflow_call` input (default `''`) + threaded from `pr-checks.yml` via `with: pr_body: ${{ github.event.pull_request.body }}` (rather than relying on implicit `github.event` propagation from caller); (3) summary line — prefixed mode label `[check-large-files] mode: head|diff, scanned: N, ...`; (4) `.gitignore` — widened `/express/pr/` → `/express/` and `/kotlin/pr/` → `/kotlin/` to cover `deploy/` + `latest/` Allure variants. Architect also affirmed: 5 MiB threshold correct, PR-body marker shape is the best of 3 alternatives, mode split is clean, fetch-depth=1 vs fetch-depth=0 chosen correctly, scope split (no force-push) is correct given operator directive. Cycle count: 1 architect dispatch, 4 findings, all applied.
- 2026-06-08 11:24–11:30 BST — Investigation conducted on `story/SHY-0035-investigate-repo-size`. Findings: pack 12.74 GiB; 6 Allure-pattern directories ever-committed totalling ~42 GiB uncompressed (delta-compressed to 12.74 GiB pack). Currently tracked >5MB: `app/src/main/res/raw/room_background.gif` (52MB) + `police_duck.png` × 5 (5.81 MB each, cross-platform asset). No `data/` / `playwright/pr/` / `express/` / `history/` / `kotlin/` / `android-e2e/` paths currently exist in HEAD — bloat is purely historical. Force-push deferred per operator directive; prevention-only scope confirmed.
- 2026-06-08 11:23 BST — SHY-0034 (release.yml tag-only refactor) merged via PR #1040. Branch `story/SHY-0035-investigate-repo-size` opened off post-merge main HEAD `0704dd5ef99`. Per [[feedback-one-active-branch-close-on-finish]]: SHY-0034 status flip ride-along bundled in first commit of this branch.
