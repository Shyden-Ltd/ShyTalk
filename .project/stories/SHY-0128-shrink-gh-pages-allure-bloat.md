---
id: SHY-0128
status: In Progress
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
The 2026-06-08 repo-size audit found the repo pack is ~12.74 GiB, ~95% historical Allure-report artefacts accumulated on `gh-pages`. SHY-0127 applied the **interim** fixes (sparse-checkout restore + 20-min timeout headroom); this story fixes the root cause. The 2026-07-15 measurement pinned it precisely: the branch carries **1,771 deploy commits** (verified live via the commits-API Link header AND local `git rev-list --count`) AND its tip tree alone is **7.2 GiB / ~1.1M files, 95.8% of it `playwright/pr/latest` (6.9 GiB)** — because every peaceiris deploy uses `keep_files: true`, which copies the fresh report INTO `destination_dir` without cleaning it, stranding every prior run's content-hashed files forever. Two root causes → two workflow fixes (operator decision 2026-07-15: **option 2 — workflow root-cause fix only; no manual force-push/shrink performed by Claude**):

1. **`keep_files: false` on ALL gh-pages deploys** (`allure-report.yml`, `test-backend.yml`, `pr-checks.yml` — the third was found at pickup). Verified against the pinned peaceiris v4.1.0 source (`git-utils.ts` L127-138): it cleans ONLY `destination_dir`, so sibling suites, the root landing page and CNAME are untouched. `force_orphan` was evaluated and DISQUALIFIED (src L97-104: it never clones, so each deploy would wipe every sibling suite).
2. **A bounded history cap step** in `allure-report.yml` (inside the workflow-level `gh-pages-deploy` concurrency group): past `MAX_GH_PAGES_COMMITS` (25), rebuild the branch as ONE orphan commit whose tree IS the current tip tree — content-identical by construction, via the Git Data API only (no multi-GiB fetch) — then force-move the ref as the CI bot.

## Acceptance Criteria

### Happy path
- [ ] All three peaceiris gh-pages deploys set `keep_files: false` (allure-report.yml, test-backend.yml express, pr-checks.yml kotlin) so each deploy REPLACES its own `<suite>/<env>/latest` instead of accumulating into it.
- [ ] The cap step exists in `allure-report.yml` after the deploy step; when the gh-pages commit count exceeds 25 it rewrites the branch to a single orphan commit carrying the exact current tip tree (content-identical truncation; 1,771 → 1 at pickup counts).
- [ ] After the first post-merge deploy, every existing `<suite>/<env>/latest` report URL still resolves on GitHub Pages (no 404s), including the root landing page.

### Error paths
- [ ] gh-pages branch missing (first ever run of a fresh repo): the cap step logs "nothing to cap" and exits 0; any OTHER tip-read failure fails the step loudly (`::error::`).
- [ ] A writer outside the concurrency group (the kotlin deploy) landing between the count and the ref move: the cap re-reads the tip immediately before the force move and SKIPS (exit 0) on mismatch — a later run retries; no deploy is clobbered.
- [ ] The ref move is a single atomic API force-update: gh-pages is always either the old tip or the new orphan, never a half-written state.

### Edge cases
- [ ] A brand-new suite/env still self-heals on first run (`Restore history` keeps `continue-on-error: true`; the `cp … || echo "No previous history"` path is unchanged).
- [ ] A single-commit gh-pages (no `Link` header on the commits API) counts as 1 and is left alone.
- [ ] Dependabot-authored runs (read-only GITHUB_TOKEN) skip the cap exactly like they skip the deploy (`github.head_ref` guard).

### Performance
- [ ] The cap's steady-state cost is O(1) API calls per report run (tip read + Link-header count); the rebuild itself transfers no tree content (createCommit reuses the existing tree SHA).
- [ ] gh-pages growth is bounded: ≤25 deploy commits between caps, and `latest/` dirs no longer accumulate — measured post-merge via the first capped run + the shrunken fetch (target: allure-report job wall-clock well under the 20-min cap; recorded in Notes).

### Security
- [ ] The cap authenticates with the workflow's `GITHUB_TOKEN` only (no PAT); commits are authored by the CI bot; the force move touches ONLY `refs/heads/gh-pages`.
- [ ] No expression-injection surface: the run script consumes `github.repository` via an `env:` binding, never inline `${{ }}` interpolation; `github.head_ref` appears only in `if:` expressions.
- [ ] No secrets can enter gh-pages content (the existing `Sanitize results (strip secrets)` step is unchanged).

### UX
- [ ] N/A for end users — CI/observability only. For developers: report URLs and the landing page work unchanged.

### i18n
- [ ] N/A — CI infrastructure; no user-facing strings.

### Observability
- [ ] The cap step logs the gh-pages commit count on EVERY report run (re-bloat in commit terms is visible in any job log) and logs `capped gh-pages: N commits -> 1 (tree T unchanged)` when it fires.
- [ ] EVERY API failure in the cap surfaces as a `::error::` annotation (the guarded first tip read via its explicit message; all later calls via the ERR trap); race-skips log the moved tip pair.

## BDD Scenarios

**Scenario: A deploy replaces its own latest/ instead of accumulating**
- **Given** `<suite>/<env>/latest` on gh-pages contains files from many prior runs
- **When** the next report deploys with `keep_files: false`
- **Then** `<suite>/<env>/latest` afterwards contains exactly the fresh report
- **And** sibling suites' directories and the root landing page are untouched

**Scenario: The cap truncates history without changing content**
- **Given** gh-pages has more than 25 commits and tip tree T
- **When** the cap step runs after a successful deploy
- **Then** gh-pages becomes a single orphan commit whose tree is exactly T
- **And** every published report URL resolves identically before and after

**Scenario: A racing writer is never clobbered**
- **Given** the cap has computed its rebuild from tip X
- **When** another deploy moves gh-pages to Y before the ref update
- **Then** the cap logs the moved tip and exits 0 without force-moving
- **And** a later report run performs the cap instead

**Scenario: First ever run of a fresh repository**
- **Given** the gh-pages branch does not exist
- **When** the cap step runs
- **Then** it logs "nothing to cap" and exits 0 (the job stays green)

**Scenario: Quiet branch stays untouched**
- **Given** gh-pages has 25 or fewer commits
- **When** the cap step runs
- **Then** it logs the count and exits without rewriting anything

## Test Plan
**Classification: CI-config-only (SHY-0163 exemption)** — the diff touches `.github/workflows/**` and the express meta-tests that pin CI structure; no app/backend/website runtime surface, so the device/browser gauntlet does not apply. Full non-device gauntlet runs.

- **Red:** `express-api/tests/scripts/allure-report-gh-pages-cap.test.js` (NEW, 15 tests) — pins `keep_files: false` on all three deploys + line-anchored sweeps (no `keep_files: true`, no `force_orphan:` key) + the cap step's full semantics (placement after deploy, skip+dependabot gating, GH_TOKEN, threshold 25 via `MAX_GH_PAGES_COMMITS`, O(1) Link-header count with no clone/fetch, orphan-by-construction createCommit with `-f tree=` and no parent list, atomic `-X PATCH … force=true` on `refs/heads/gh-pages`, pre-move tip re-check with exit-0 skip, HTTP-404 first-run tolerance) + the one home asserting `allure-report.yml`'s workflow-level `gh-pages-deploy` / `cancel-in-progress: false` group. `allure-report-restore-perf.test.js` deploy-step pin updated (keep_files ownership moved; layout pin retained). Watched RED: 13 failures, all "fix missing".
- **Green:** the three workflow edits; watched 19/19 GREEN.
- **Red 2 (R1 Critical/Important):** `express-api/tests/scripts/allure-report-gh-pages-cap-script.unit.test.js` (NEW, 11 tests) — EXECUTES the real extracted `run: |` block with bash under GitHub's flags against a canned `gh` CLI (unit-test location per the greppable `*.unit.test.js` convention — the shim is the one sanctioned double; the write path is deliberately NOT real-tested pre-merge, the live post-merge run is that proof). Covers: exact multi-digit count (1771), body-decoy immunity, threshold boundary 25-stays/26-caps, tree-SHA binding + force-move fields, no-Link default COUNT=1, race-skip, 404 first-run, loud 500, and (watched RED first) `::error::` on post-first-read failures → drove the ERR-trap fix.
- **Mutants:** `keep_files` flip revert → caught by exactly its 2 owning pins. R1's four named mutants each applied verbatim and CAUGHT by the execution tests (`-le`→`-lt` boundary; `[0-9][0-9]*`→`[0-9]` capture narrowing, killed by 7 tests; deleted `${COUNT:-1}` default; `tree="${TREE}"`→`tree="${TIP}"` wrong-variable); workflow restored GREEN after each.
- Frameworks: express Jest (canonical `npm test`, full suite), actionlint + embedded shellcheck (cap script clean under real shellcheck 0.11.0), eslint `--max-warnings=0`, prettier, story validator, `code-reviewer` 100% clean.
- **Behavioral proof (post-merge):** first live deploy observed cleaning `latest/`; first cap run observed (1,771 → 1) in the job log; every `<suite>/<env>/latest` URL spot-checked; local `git fetch --prune` + gc size reported in Notes.

## Out of Scope
- Any manual/one-off force-push or shrink performed outside the workflow (operator decision 2026-07-15: option 2 — the workflow is the only rewriter).
- Rewriting **main** branch history (the other part of the 12.7 GiB; separate, higher-risk, deferred).
- Migrating reports off gh-pages (would break $0 hosting).
- Fixing the dead archive/prune/trend-write-back steps and the never-deployed express dev/prod report path (logged in Notes as follow-up findings — behavior-neutral to this fix).
- Fixing the silently-disabled embedded shellcheck in the actionlint invocation (found at pickup; separate follow-up SHY).

## Dependencies
- `peaceiris/actions-gh-pages` pinned v4.1.0 (`84c30a8…`) — the `keep_files: false` clean-only-destination behaviour is version-verified; a version bump must re-verify `git-utils.ts`.
- The workflow-level `gh-pages-deploy` concurrency group in `allure-report.yml` (the cap's serialization argument; now pinned by test).
- `GITHUB_TOKEN` with `contents: write` in the callers (already required by the deploys today).

## Risks & Mitigations
- **Risk:** `keep_files: false` deletes something load-bearing inside a `latest/` dir. **Mitigation:** source-verified clean scope (only `destination_dir`); each `latest/` is fully regenerated by its own deploy; post-merge URL spot-check AC.
- **Risk:** the cap races a non-group writer and drops its deploy. **Mitigation:** pre-move tip re-check (skip on mismatch) + the group serializes all allure deploys; kotlin deploy loss window ≈ one API round-trip, self-heals next run — and the old tip stays in the local operator clone until pruned, so recovery is possible.
- **Risk:** trend `history/` regresses. **Mitigation:** none needed — measurement showed the trend write-back path has been dead all along (`<suite>/<env>/history` is never pushed); this fix changes nothing about it (follow-up in Notes).
- **Risk:** cap misfires on API flake. **Mitigation:** 404 is the only tolerated failure; everything else fails the step loudly; the cap never runs concurrently with itself (concurrency group).

## Definition of Done
- [ ] All pins green (new cap test file + updated restore-perf pin), full express `npm test` green, actionlint/eslint/prettier clean, story validator clean.
- [ ] `code-reviewer` 100% clean on the local commit BEFORE push; PR → develop; merged via the develop-flow gates (`pre-merge-check.sh` with `BASE_REF=origin/develop`).
- [ ] Post-merge behavioral proof recorded in Notes: first cleaned deploy + first cap observed live; report URLs resolve; local `.git` size after `git fetch --prune origin` + `git gc` reported.
- [ ] `released_in: vX.Y.Z` on the next release cut.

## Notes (running log)
- 2026-06-19 — **FILED** as the follow-up to SHY-0127 (operator-directed). SHY-0127's Gate-4 surfaced that the gh-pages bloat makes Allure report restore+deploy slow enough to blow the job timeout; SHY-0127 applied the interim sparse-checkout + `timeout-minutes: 20` headroom. This story is the real root-cause fix. Status Draft — backlog.
- 2026-07-15 — **RECOVERED + RE-FILED.** The story `.md` was never re-filed after the #1475 gate pulled it; recovered verbatim via `git show 9920a7d:.project/stories/SHY-0128-….md` and rewritten to the FINAL design. Measurements (local mirror of gh-pages, verified current against the live tip): **1,771 deploy commits** (the prior session's handoff said 240 — both the live commits-API Link header and local `git rev-list --count origin/gh-pages` say 1,771; the handoff figure was wrong); tip tree 7.2 GiB / ~1.1M files; `playwright/pr/latest` alone 6.9 GiB (95.8%); bloat concentrated in `latest/` dirs, NOT `runs/`/`history/` — i.e. `keep_files: true` accumulation, not run archives.
- 2026-07-15 — **Operator decision (option 2):** workflow root-cause fix only; Claude performs NO manual force-push/shrink. The original AC items around an operator-gated `workflow_dispatch` shrink workflow, a pre-shrink backup tag and a recurring size-budget guard are superseded: the cap step IS the recurring bound (commit count logged every run), truncation is content-identical by construction (tree SHA reuse — nothing to back up), and no manual rewrite happens at all.
- 2026-07-15 — **Design evidence:** peaceiris v4.1.0 `git-utils.ts` L127-138 — `keep_files: false` cleans ONLY `destination_dir`; L97-104 — `force_orphan` skips the clone entirely (would wipe sibling suites + root landing page) → disqualified. Cap mechanism moved from a git-checkout rev-list design to pure Git Data API (tip ref → tree SHA → parent-less createCommit → forced ref PATCH): zero content transfer, atomic, content-identical by construction.
- 2026-07-15 — **Pickup findings beyond the handoff:** (a) a THIRD gh-pages deploy exists — `pr-checks.yml` kotlin, `keep_files: true`, outside the concurrency group, fires on every PR — same root cause, fixed in this PR; (b) the archive-previous-run + prune-old-runs steps are DEAD (they mutate the sparse gh-pages checkout, which is never pushed) and the trend write-back never lands on the branch (`<suite>/<env>/history` doesn't exist at tip → trends have always reset each run); (c) the express dev/prod report deploy has never landed at tip (no `express/dev|prod` dirs) — dormant in practice; (d) `generate-allure-landing.js` has no workflow invoker (root landing page is a manual artifact). (b)-(d) are behavior-neutral to this fix → follow-up stories, not scope creep.
- 2026-07-15 — **Adjacent gate bug found at pickup (separate SHY):** `actionlint -shellcheck='-e SC2086'` in `lint.yml` + `.husky/pre-push` points actionlint at a nonexistent EXECUTABLE named `-e SC2086` (the flag takes a command name/path), silently disabling embedded shellcheck in CI and pre-push (exit 0, no warning). Real repo-wide debt under bare actionlint + shellcheck 0.11.0: 9 findings (2 are the intentionally-excluded SC2086). Correct form: `SHELLCHECK_OPTS='-e SC2086' actionlint`. Follow-up SHY to fix the invocation + the surfaced findings + pin the form.
- 2026-07-15 — **R1 review (commit 9343d75f640): 1 Critical + 1 Important + 1 Minor — ALL verified live and fixed.** C1: the cap's decision logic had only structural pins (threshold operator, multi-digit capture, `${COUNT:-1}` default and `tree=${TREE}` binding all unpinned — four named mutants survived); fixed with the execution-harness unit file above (all four mutants now caught). I1: only the first tip read carried `::error::`; later API failures aborted bare — fixed with an ERR trap (test watched RED first). M1: Observability AC quoted a log string that didn't match the code — AC text corrected to the actual format. Reviewer also independently verified: all three `keep_files` flips byte-exact and complete (exactly 3 peaceiris deploys repo-wide), no other pin test regresses (all 17 workflow-referencing files read), security AC fully clean (env-bound REPO, if-only head_ref, scoped token + permissions), correct singular/plural `git/ref(s)` endpoints, correct `-f`/`-F` typing, orphan-by-omission correct, quoting clean, no pipefail/SIGPIPE exposure, race window = accepted single round-trip per the story. `Reviewed-up-to: 9343d75f640` (R1); R1.1 delta re-review of the fix commit pending.
- 2026-07-15 — **TDD evidence:** RED 13/19 (all "fix missing": keep_files ×3 + sweep + 9 cap pins on an absent step) → GREEN 19/19 after the three workflow edits → mutant (one `keep_files` flip reverted verbatim) caught by exactly the 2 owning tests → restored, GREEN. One pin-design correction during RED→GREEN: the `force_orphan`/`keep_files` sweeps moved to line-anchored key matches (`/^[ \t]*force_orphan:/m`) so comments documenting WHY the option is rejected stay legal — mirrors the house `filter:` pin in `allure-report-restore-perf.test.js`.
