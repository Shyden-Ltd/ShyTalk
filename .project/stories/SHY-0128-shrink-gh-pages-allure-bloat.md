---
id: SHY-0128
status: Draft
owner: claude
created: 2026-06-19
priority: P2
effort: L
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0128: Shrink the gh-pages Allure-report bloat (fast, bounded report deploys)

## User Story
As the maintainer of ShyTalk's CI, I want the `gh-pages` branch that hosts Allure reports to stay small and bounded, so that every test suite's report restore + deploy completes in seconds (not minutes), the allure-report job never approaches its timeout, and the repo's pack stops growing unboundedly.

## Why
The 2026-06-08 repo-size audit found the repo pack is ~12.74 GiB, **~95% historical Allure-report artefacts** accumulated on `gh-pages`. SHY-0127's Gate-4 (which runs android-e2e + playwright-web on one PR) exposed the operational cost: the playwright allure-report job blew its 10-min cap because "Restore history from gh-pages" (a full checkout) and "Deploy report to GitHub Pages" (a peaceiris push) are both slow against the bloated branch. SHY-0127 applied the **interim** fixes — sparse-checkout the restore + raise the timeout to 20 min — which unblock merges but do NOT address the root cause: the branch keeps growing and the fetch+deploy stay slow. This story fixes the root cause so the timeout headroom is no longer load-bearing.

## Acceptance Criteria

### Happy path
- [ ] After the shrink, the `gh-pages` branch tip + history pack is < 500 MiB (verifiable: `git count-objects -vH` on a fresh `--filter=blob:none` clone of gh-pages, or the GitHub branch size).
- [ ] The `Restore history from gh-pages` step completes in < 60s for every suite (android-e2e, playwright, ios-e2e, express, kotlin) at `report_env: pr`.
- [ ] The `Deploy report to GitHub Pages` step completes in < 90s for the playwright suite (the largest report).
- [ ] The latest published report for every existing `<suite>/<env>/latest` path still resolves on GitHub Pages (no report URLs 404 after the shrink).

### Error paths
- [ ] The shrink preserves the most-recent report per `<suite>/<env>/latest` AND the trend `history/` folders — trend charts keep ≥1 prior data point (no reset to "first run").
- [ ] A pre-shrink backup ref/tag of `gh-pages` exists so the operation is reversible if a report path is lost.
- [ ] If the shrink workflow fails partway, `gh-pages` is left in a consistent (un-corrupted) state — either the old tree or the new tree, never a half-written one.

### Edge cases
- [ ] A brand-new suite/env (no prior gh-pages dir) still self-heals trend history on its first post-shrink run (the `cp ... || echo "No previous history"` path stays correct).
- [ ] The global `concurrency: gh-pages-deploy` serialization still holds — the shrink job and a normal report deploy cannot run concurrently against gh-pages.
- [ ] An ongoing PR's report deploy that races the shrink either queues behind it or is safely re-runnable (no lost deploy).

### Performance
- [ ] End-to-end allure-report job wall-clock < 6 min for the playwright suite after the shrink (well under the 20-min cap), so the SHY-0127 timeout headroom is no longer the thing keeping it green.
- [ ] A retention policy bounds gh-pages growth: only the last N runs per `<suite>/<env>/runs/` are kept (the existing "Prune old runs" step), AND old history is periodically compacted so the branch cannot re-bloat to >1 GiB.

### Security
- [ ] The history rewrite / force-push to `gh-pages` uses an authorized token (the same mechanism peaceiris uses) and is operator-gated (history rewrite is destructive — checkpoint before running, per the repo-size-audit deferral).
- [ ] No secrets are introduced into gh-pages content (the existing `Sanitize results (strip secrets)` step remains the guard).

### UX
- [ ] N/A for end users — CI/observability only. For the developer audience: the Allure report landing page + per-suite report links continue to work unchanged after the shrink.

### i18n
- [ ] N/A — CI infrastructure; no user-facing strings.

### Observability
- [ ] The allure-report job logs the gh-pages branch/working-tree size each run (so re-bloat is visible).
- [ ] A bounded size-budget check (CI or scheduled) fails/warns if gh-pages exceeds a threshold (e.g., 1 GiB), preventing silent regression to the pre-shrink state.

## BDD Scenarios

**Scenario: Shrunk gh-pages makes the playwright report deploy fast**
- **Given** the gh-pages branch has been shrunk below 500 MiB
- **When** a backend PR triggers the playwright allure-report job
- **Then** "Restore history from gh-pages" completes in < 60s
- **And** "Deploy report to GitHub Pages" completes in < 90s
- **And** the job finishes well under its 20-min timeout

**Scenario: The shrink preserves the latest reports and trend history**
- **Given** gh-pages has `android-e2e/pr/latest`, `playwright/pr/latest` and their `history/` folders
- **When** the shrink runs
- **Then** both `…/latest` reports still resolve on GitHub Pages
- **And** each suite's `history/` retains ≥1 prior trend data point

**Scenario: The shrink is reversible**
- **Given** a pre-shrink backup ref of gh-pages exists
- **When** a report path is found missing after the shrink
- **Then** the maintainer can restore gh-pages from the backup ref without data loss

**Scenario: gh-pages cannot silently re-bloat**
- **Given** the size-budget check is wired
- **When** gh-pages grows past the threshold (e.g., 1 GiB)
- **Then** CI warns/fails so the regression is caught

## Test Plan
- **Red:** `express-api/tests/scripts/allure-report-gh-pages-budget.test.js` (new) — pin the size-budget check wiring (the step/workflow exists, references the threshold) + assert the retention/prune logic keeps last-N. The shrink mechanism (a workflow or script, e.g. `.github/workflows/shrink-gh-pages.yml` or `scripts/shrink-gh-pages.sh`) is asserted present + operator-gated (workflow_dispatch, not auto on push).
- **Green:** implement the shrink (orphan-commit rebuild of gh-pages keeping only `<suite>/<env>/latest` + a compacted `history/`, with a backup tag) + the recurring size-budget guard; behavioral proof = a real post-shrink allure-report run timing under budget (captured in Notes).
- Frameworks: actionlint/shellcheck (workflow), express Jest (pin + budget tests), the live CI run (behavioral timing proof).

## Out of Scope
- The SHY-0127 interim fix (sparse-checkout restore + `timeout-minutes: 20`) — already shipped; this story removes the need for the headroom to be load-bearing.
- Rewriting the **main** branch history (the other part of the repo-size audit's 12.7 GiB) — separate, higher-risk, deferred there.
- Migrating reports off gh-pages to an external host (would break $0 hosting; not pursued).

## Dependencies
- The `gh-pages` branch + `peaceiris/actions-gh-pages` deploy + the `gh-pages-deploy` concurrency group in `allure-report.yml`.
- The SHY-0127 timeout headroom (keeps CI green in the interim until this lands).
- Operator checkpoint for the destructive history rewrite (force-push to gh-pages).

## Risks & Mitigations
- **Risk:** history rewrite loses a live report path → broken Pages links. **Mitigation:** pre-shrink backup tag + the "latest reports still resolve" AC + a dry-run that diffs the path set before/after.
- **Risk:** trend charts reset to "first run". **Mitigation:** explicitly preserve each suite's `history/` in the rebuild; AC asserts ≥1 retained data point.
- **Risk:** force-push to gh-pages races a deploy. **Mitigation:** run inside the `gh-pages-deploy` concurrency group; operator-gated `workflow_dispatch`.
- **Risk:** re-bloat over time. **Mitigation:** the recurring size-budget guard + retention prune.

## Definition of Done
- [ ] gh-pages shrunk < 500 MiB with a backup tag; all `<suite>/<env>/latest` reports still resolve; trend history preserved.
- [ ] Recurring size-budget guard wired (CI/scheduled) so gh-pages cannot silently re-bloat.
- [ ] Behavioral proof recorded: a real playwright allure-report run completes < 6 min after the shrink.
- [ ] Pre-Merge Testing Protocol satisfied (Jest RED→GREEN + actionlint clean + `code-reviewer` 100% clean + CI green by name). `.md`/workflow/script change — no device gauntlet, but the FULL backend-forced CI matrix applies if it touches `express-api/**`.
- [ ] `released_in: vX.Y.Z` on the next release cut.

## Notes (running log)
- 2026-06-19 — **FILED** as the follow-up to SHY-0127 (operator-directed). SHY-0127's Gate-4 surfaced that the gh-pages bloat makes Allure report restore+deploy slow enough to blow the job timeout; SHY-0127 applied the interim sparse-checkout + `timeout-minutes: 20` headroom. This story is the real root-cause fix (shrink + bound gh-pages). Status Draft — backlog; EPIC-0003 remains sole-focus until its children are Done, so this is picked up after.
