---
id: SHY-0127
status: In Review
owner: claude
created: 2026-06-18
priority: P1
effort: L
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0127: Pre-merge gate hardening (enforce the steps before merge)

## User Story

**As** the team relying on "merge = an assertion of production-readiness",
**I want** the pre-merge steps that are currently documented-but-unenforced to become real gates — mechanical ones blocked by CI, judgment ones blocked by a refuse-by-default local script — plus a hard rule that any backend change triggers the FULL app+web+device gauntlet,
**So that** a story can never again merge while still `In Progress`, with its dev-verify skipped, or with commits that landed after a clean review left un-reviewed — and so a backend change can never silently skip the clients it could break.

## Why

SHY-0120 merged with three real pre-merge slips: it was still `In Progress` at merge (the In-Review flip was forgotten); its dev-verify was skipped; and the commits that fixed CI landed **after** the clean `code-reviewer` pass without re-review. Root cause: Phases 2–4 of the Pre-Merge Testing Protocol are written down but nothing **enforces** them. Separately, `detect-changes` gates the app/web/e2e jobs on `app_changed`/`web_changed` independently of `backend_changed`, so a backend-only PR can skip every client suite — unacceptable because the Express backend is the **shared core** of every app and webpage (operator 2026-06-18: "if there's any backend changes… everything needs testing… the backend is the core of all of the apps and webpages"). This story closes both.

Enforcement model is **Option A** (operator-chosen 2026-06-18): hard CI checks for the *mechanical* gates (status, change-scope), a refuse-by-default local script + a hard CLAUDE.md rule for the *judgment* gates (a CI check can verify a ticked box, not that a human re-reviewed — so don't manufacture false confidence). Pauses EPIC-0003 by operator direction; EPIC-0003 resumes after merge.

## Acceptance Criteria

### Happy path
- [ ] **Gate 4 (backend ⇒ full gauntlet):** when `detect-changes` classifies a PR as `backend_changed`, it forces `app_changed`, `android_app_changed`, `ios_app_changed`, `web_changed`, `integration_changed` all true, so every client suite runs — verified by a value matrix over the classifier outputs.
- [ ] **Gate 1 (status In Review):** `node scripts/check-pr-story-status.js` finds any `SHY-[0-9]{4}-*.md` in the PR diff and **exits 0** when its `status:` ∈ {`In Review`, `Done`, `Cancelled`}; the new `pre-merge-gate` job runs it and is wired into the required **PR Gate** aggregation (no ruleset edit).
- [ ] **Gates 2+3 (checklist + re-review):** `scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK` only when (a) the story status = In Review, (b) all required CI checks are green by name, and (c) there are zero un-reviewed commits since the `Reviewed-up-to: <sha>` recorded in the story `## Notes`; otherwise it refuses with a named reason.

### Error paths
- [ ] Gate 1 → a diff'd story whose `status:` is `Draft`/`In Progress` → **exit non-zero** with a `::error::` naming the file + required status.
- [ ] Gate 3 → a commit after `Reviewed-up-to` that is not a pure marker-bump → `pre-merge-check.sh` refuses ("N unreviewed commits since last review — re-review + bump Reviewed-up-to").
- [ ] Gates 2+3 → a missing `Reviewed-up-to:` marker, an un-flipped status, or any red/cancelled required check → refuse (never emit the OK token); a missing/ambiguous story file → loud refusal, never a silent pass.
- [ ] Gate 1 script run with no story `.md` in the diff → **exit 0 (skip — not applicable)**, so dependabot/infra PRs aren't blocked.

### Edge cases
- [ ] Gate 1 skips **draft** PRs (a draft isn't mergeable; the gate only applies to ready PRs).
- [ ] Gate 1 handles **multiple** story `.md`s in one diff (all must be In Review).
- [ ] Gate 4 forcing is **idempotent** + order-correct (applied after the `case` loop, before `$GITHUB_OUTPUT` is written) and does not disturb `workflow_only` / `skip_*e2e` markers.
- [ ] Gate 3 treats a commit whose **only** change is the `Reviewed-up-to:` line in a story `## Notes` as already-reviewed (so bumping the marker doesn't create a perpetual "unreviewed commit").
- [ ] `pre-merge-check.sh` run against a non-existent / closed PR → loud non-zero, never OK.

### Performance
- [ ] Gate 1 script: one `git diff --name-only` + bounded per-story-file reads; the `pre-merge-gate` CI job is checkout+node+script (a few seconds), adding negligible PR wall-clock.
- [ ] `pre-merge-check.sh`: one `gh pr checks` + a bounded `git log` range; no busy-spin, no full-tree walk.

### Security
- [ ] Both scripts are read-only: they never execute scanned files; subprocesses (`git`, `gh`) are spawned with arg arrays (no shell string interpolation of untrusted PR data); no credentials are read or logged.

### UX
- [ ] Every refusal names the exact failing gate + the one action to fix it (flip status / re-review + bump marker / wait for check X). `pre-merge-check.sh` prints the full pre-merge checklist so the human-judgment items are seen, and only the explicit `PRE-MERGE-CHECK: OK` token (not a vague "looks fine") authorises the merge.
- [ ] The PR template carries the `## Pre-merge gate` checklist so every PR shows it.

### i18n
- N/A — engineering CI/CLI tooling output is English (internal surface, not a translated user surface).

### Observability
- [ ] The `pre-merge-gate` CI job logs which story file(s) it checked + their status. `pre-merge-check.sh` prints a per-gate PASS/REFUSE summary (status / CI-green / re-review) so the merge decision's evidence is visible in one place.

## BDD Scenarios

**Scenario: a backend change forces the full client gauntlet**
- **Given** a PR that changes only `express-api/**`
- **When** `detect-changes` runs
- **Then** `backend_changed` is true
- **And** `app_changed`, `web_changed`, and `integration_changed` are also forced true

**Scenario: a story still In Progress blocks merge**
- **Given** a ready (non-draft) PR whose diff includes a `SHY-XXXX-*.md` with `status: In Progress`
- **When** the `pre-merge-gate` check runs
- **Then** it exits non-zero with a `::error::` naming the file
- **And** the required PR Gate check is therefore red

**Scenario: status flipped to In Review unblocks the gate**
- **Given** the same PR after the story `.md` is changed to `status: In Review`
- **When** the gate re-runs on the new commit
- **Then** it exits 0

**Scenario: commits after a clean review are refused until re-reviewed**
- **Given** `Reviewed-up-to: <sha>` in the story Notes and a later non-marker commit on the branch
- **When** `scripts/pre-merge-check.sh <PR#>` runs
- **Then** it refuses (no OK token) and reports the count of unreviewed commits

**Scenario: a fully-satisfied PR is blessed**
- **Given** status In Review, all required checks green, and `Reviewed-up-to` == head (modulo a marker-only bump)
- **When** `scripts/pre-merge-check.sh <PR#>` runs
- **Then** it prints the checklist and emits `PRE-MERGE-CHECK: OK`

**Scenario: a non-story PR is not blocked by Gate 1**
- **Given** a PR with no `SHY-XXXX-*.md` in its diff (e.g. a dependabot bump)
- **When** the `pre-merge-gate` check runs
- **Then** it exits 0 (skip — not applicable)

## Test Plan

Touches `.js` + `.sh` + CI workflow + PR template + `CLAUDE.md` → **NOT `*.md`-only → runs the FULL Pre-Merge Testing Protocol** (and dogfoods Gate 4: the test files live under `express-api/tests/scripts/**` ⇒ `backend_changed` ⇒ the new forcing block runs the whole matrix on this very PR). Per CLAUDE.md § No Stubs, script logic is tested against **real** temp git repos + real file trees (no `jest.mock`).

**Red → Green (framework by framework):**
- **Express/Node (Jest)** `cd express-api && node --experimental-vm-modules node_modules/.bin/jest`:
  - `pr-checks-backend-forces-full.test.js` — assert the `detect-changes` YAML contains the backend-forcing block AND that it is ordered after the `case` loop / before the `$GITHUB_OUTPUT` write (pin pattern: `emulator-in-ci-pin.test.js`).
  - `pre-merge-gate.test.js` — drive `check-pr-story-status.js` against a **real temp git repo**: `In Progress` story in diff → non-zero; `In Review` → 0; no story in diff → 0; multiple stories, one In Progress → non-zero.
  - `pre-merge-check.test.js` — drive `pre-merge-check.sh`'s git/status logic against a **real temp git repo**: refuses on un-flipped status; refuses when a non-marker commit exists after `Reviewed-up-to`; passes (emits OK) when status In Review + reviewed-up-to current (CI-green leg exercised via a documented `--skip-ci-check` test flag so the git+status logic runs for real without a live PR).
- **eslint** `npm run lint` → 0 warnings (new `.js` + `.test.js`).
- **actionlint** — `pr-checks.yml` (forcing block + `pre-merge-gate` job) shellcheck/actionlint-clean; `shellcheck` on the new `.sh`.
- **Guard self-run:** `node scripts/check-pr-story-status.js` exits 0 on this branch once SHY-0127 is flipped In Review; `bash scripts/pre-merge-check.sh <thisPR>` emits OK before merge (dogfood).
- **Device gauntlet (Phase 1 LOCAL):** the change is CI/tooling/docs only (no app/web/backend RUNTIME code), so the device leg's role is the no-corruption proof — batched per the EPIC's parked device legs / operator-gated window.
- **Phase 2:** `code-reviewer` 100% clean → flip In Review + record `Reviewed-up-to:` → push → CI green by name (Detect Changes / Analyze JavaScript / PR Gate incl. the new `pre-merge-gate`).
- **Phase 3 (DEV):** re-run on dev (web = Chrome) — proves the workflow change broke nothing.

## Out of Scope
- Editing branch-protection ruleset 12613584 — Gate 1 rides the existing required **PR Gate** check via `needs:`; no ruleset change.
- Full CI enforcement of the judgment gates (Option B) — explicitly not chosen; CI can verify a ticked box, not the act.
- Retro-applying the gates to other open PRs — they adopt the gate on their next push.
- An auto-fixer / codemod — the gates detect + refuse; satisfying them is human/Claude work.

## Dependencies
- `pr-checks.yml`'s existing `detect-changes` classifier + `PR Gate` aggregation job (extended, not replaced).
- `git` (diff/log) + `gh` (pr checks) for the scripts.
- `.husky/pre-push` + `lint.yml`/`actionlint` for shell/JS linting of the new files.
- `CLAUDE.md` Pre-Merge Testing Protocol (the doc the gates enforce).

## Risks & Mitigations
- **Risk:** Gate 1 shows red during the normal In-Progress→CI window (before the flip). **Mitigation:** that is the intended forcing function; the flip is one commit and is the satisfying action. Documented in the gate's error message.
- **Risk:** Gate 3 marker chicken-and-egg (bumping `Reviewed-up-to` is itself a commit). **Mitigation:** the gate treats a marker-only commit as already-reviewed (covered by an edge-case test).
- **Risk:** Gate 4 makes every backend PR pay the full (slow) gauntlet. **Mitigation:** that is the operator-stated requirement (backend = shared core); the cost is deliberate and correct.
- **Risk:** `pre-merge-check.sh` relies on me running it (author-side). **Mitigation:** hard CLAUDE.md rule + the checklist in the PR template + the muscle-memory of the push/merge ritual; CI cannot verify the judgment act regardless, so a refuse-by-default tool at the merge moment is the strongest practical guardrail.

## Definition of Done
- [ ] `detect-changes` backend-forcing block + `scripts/check-pr-story-status.js` + the `pre-merge-gate` job wired into PR Gate + `scripts/pre-merge-check.sh` + PR-template `## Pre-merge gate` checklist + `CLAUDE.md` Pre-Merge Protocol updates (all four gates + the `Reviewed-up-to:` convention) implemented.
- [ ] **Pre-Merge Testing Protocol satisfied:** Jest RED→GREEN (3 suites) + eslint 0 + actionlint/shellcheck clean + both guard scripts self-run correctly → LOCAL no-corruption proof → `code-reviewer` 100% clean → flip In Review + `Reviewed-up-to:` → dogfood `pre-merge-check.sh` → push → CI green by name (incl. `pre-merge-gate` + the full backend-forced matrix) → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-06-18 — **CREATED + PICKED UP** (authored fully-refined per [[feedback-no-skeleton-stories-fully-refined]]; status In Progress immediately) after the SHY-0120 retro surfaced the pre-merge gaps and the operator chose to fix all four (ExitPlanMode-approved plan; enforcement **Option A**; backend ⇒ full gauntlet per the operator's "backend is the core" directive). **Architect gate skipped** per [[feedback-rate-limit-slowdown-strategies]] (low-risk CI/tooling/docs; spec fully-refined; flagged, not silently bypassed). Branch `story/SHY-0127-pre-merge-gate-hardening` off `origin/main`. Pauses EPIC-0003 (operator-directed); resumes after merge (next: SHY-0113 rooms/voice).
- 2026-06-18 — Tests-first RED→GREEN (3 suites / 26 tests, driven against REAL temp git repos + the real YAML; no mocks). RED-sensitivity proven per gate (backend-forcing absent; In Progress wrongly allowed; unreviewed-check defeated — each failed its test, restored). `code-reviewer`: 0 Critical; C1 (validate Reviewed-up-to is a real commit) / C2 (check every story marker) / I1 (Done-refuse + doc) / I2 (real gh path test) / I3 (header order) all fixed. Focused **re-review** of the fix commit: 0 Critical, residuals fixed; **dogfooding the gate on this branch surfaced a real bug** — Gate-3 review-neutrality used the strict SHY-NNNN pattern so a normal status-flip commit (which also edits SHY-INDEX.md) was wrongly flagged unreviewed → added `NEUTRAL_RE` (any `.project/stories/*.md`). Full express suite green (339 suites / 12436+ tests); actionlint + shellcheck + eslint `--max-warnings=0` + prettier clean. Flipped **In Review**; recorded the reviewed commit below for the Gate-3 self-check (dogfood: `pre-merge-check.sh` emits OK locally). Device leg = no-corruption proof only (CI/tooling/docs change; no app/web/backend RUNTIME surface) — batched to the operator-gated window per the SHY-0108 precedent.
- 2026-06-18 — **CI on #1475 ran the full Gate-4 matrix and PROVED Gate-4 live**: the backend-forcing block lit up `android-e2e` (✅), `ios-e2e` (✅), all 5 `playwright-web` browsers (chromium / firefox / webkit / mobile-chrome / mobile-safari ✅) + `integration-tests` (✅) on this backend PR — every TEST passed. That all-green success then tripped a **latent pre-existing bug** in `.github/workflows/allure-report.yml`'s "Write metadata.json" step: `FAILED=$(grep -c '…failed…' suites.json || echo 0)` double-zeros (grep -c prints `0` AND exits non-zero on zero matches, so `|| echo 0` ALSO fires → `$'0\n0'`), and `$((PASSED + FAILED))` then throws "syntax error in expression" under `set -e` — failing the allure-report jobs (hence **PR Gate**) precisely WHEN EVERYTHING PASSES. A Gate-4 that turns every all-green backend PR red is not a viable gate, so the fix is in-scope to delivering a working Gate-4. Fixed in-branch (the [[feedback-one-active-branch-close-on-finish]] rule forbids a parallel fix branch while this one is open + blocked) via the idiomatic `VAR=$(grep …) || VAR=0` (single-line for N-match / zero-match / missing-file; `set -e`-safe because `||` absorbs grep's exit). Guard: `express-api/tests/scripts/allure-report-metadata-count.test.js` runs the REAL extracted block under `bash -eo pipefail` against real `suites.json` fixtures and asserts the emitted `metadata.json` — RED before the fix (all-green + zero-passed cases emit invalid JSON / abort), GREEN after (7 tests). No mocks. Re-review of the fix commit (`dfc417bb`): `code-reviewer` 0 Critical / 0 Important / 1 Minor (a stale "6 tests" count in this note — fixed); 11 points verified clean (fix correctness + `set -e` safety, no remaining `|| echo N` anti-pattern, JSON shape unchanged, `\|` BRE portability macOS+ubuntu, extraction/materialize correctness, test isolation, no doubles). Marker bumped to the fix commit below.
- 2026-06-19 — **Gate-4 exposed a SECOND latent issue → fixed (operator-directed).** After the metadata fix, the re-run's `playwright-web/allure-report` failed (`android-e2e/allure-report` passed → metadata fix confirmed). Investigated per-step timing (operator chose "investigate first"): the job's `timeout-minutes: 10` was blown — "Restore history from gh-pages" did a FULL `actions/checkout` of the whole gh-pages tree (~4m06s) + the peaceiris deploy got guillotined mid-push at the 10-min cap. Root cause = the ~12.7 GiB gh-pages branch (repo-size audit). Fix (operator chose "sparse-checkout + headroom"): `sparse-checkout` the restore to only `${{ inputs.suite_name }}/${{ inputs.report_env }}/history` (trims the working-tree WRITE — honestly NOT the network fetch, since actions/checkout `filter:` overrides sparse-checkout; verified against the v6 action.yml + README) + raise `timeout-minutes` to 20 (the load-bearing guarantee). Tracked a follow-up (shrink+bound gh-pages) for a SEPARATE `.md`-only PR post-merge (see the next Notes entry — it is NOT carried in this PR). Guard: `express-api/tests/scripts/allure-report-restore-perf.test.js` (structural pins; CI run is the behavioral proof) RED→GREEN; actionlint clean. Re-review (commit `9920a7d`): `code-reviewer` 0 Critical / 0 Important; closed 2 test-coverage gaps (cone-mode-stays-on guard + full `destination_dir` `/report_env/latest` pin); self-caught + fixed a `sonarjs/slow-regex` on the `filter:` check (`\s*`→`[ \t]*`). Full express suite 341 suites / 12455 green. Marker bumped to the fix commit below.
- 2026-06-19 — **Gate-1 DOGFOOD: my own Pre-Merge Gate caught the SHY-0128 follow-up.** The allure restore-perf fix made the full matrix go green (playwright `allure-report` ✅ 6m27s — the perf fix is proven), but `Pre-Merge Gate` then failed: `pre-merge-gate: SHY-0128…md has status "Draft" — must be In Review`. The gate is working **exactly as specced** (a Draft story in the merge diff blocks the merge; `pre-merge-check.sh` would refuse the same way). Resolution (no design change): pulled SHY-0128 OUT of this PR — its content is preserved at commit `9920a7d` (`git show 9920a7d:.project/stories/SHY-0128-shrink-gh-pages-allure-bloat.md`) and will be re-filed as its **own** `.md`-only PR after #1475 merges (better honours one-story-one-PR; one-active-branch blocked a parallel branch while #1475 was open). **Open design question for the operator** (NOT decided unilaterally): whether Gate-1 should be refined to gate only the branch's PRIMARY `SHY-NNNN` (allowing a Draft backlog story to be filed alongside) — a possible future SHY. This removal commit is `.project/stories/*.md`-only → review-neutral (Gate-3); marker stays at `9920a7d`.

Reviewed-up-to: 9920a7d0672f608a40f2a87b4724ae7b243d6e66
