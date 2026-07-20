---
id: SHY-0226
status: In Review
owner: claude
created: 2026-07-20
priority: P1
effort: S
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1651
---

# SHY-0226: Heal the main-side setup-java pin drift and make CI-action pin drift structurally impossible

## User Story

- **As the** ShyTalk operator relying on automatic dependency updates
- **I want** dependency-update pull requests to stop being rejected by a pin inconsistency that lives on main itself — and that whole failure class made impossible to reintroduce
- **So that** the 17 queued dependency updates (and every future one) are judged on their own merits and can keep the project current

## Why

1. **Main pins `actions/setup-java` to two different SHAs.** Since #1587 (2026-07-13, 5.4.0→5.5.0, workflow-only) `.github/workflows/test-backend.yml` moved ahead while the composite `.github/actions/setup-jdk-gradle/action.yml` stayed at `1bcf9fb1…` (v5.4.0). Today's #1646 widened it (workflow now `03ad4de0…` / v5.6.0). The SHY-0162 one-SHA-repo-wide invariant test is therefore RED on every branch cut from main — all 17 Dependabot PRs fail with the same signature (verified: #1650 run 29721428550 / job 88287120285 prints exactly this two-SHA drift).
2. **The previous heal could not protect main.** SHY-0195's #1617 (2026-07-16, "drift half of the main-based fix") aligned the composite on **develop only**; Dependabot bumps land on main, so the drift re-split there on the very next bump.
3. **Two structural holes make recurrence certain, not just possible:**
   - `dependabot.yml`'s `github-actions` ecosystem watches `directory: "/"` only → composite actions under `.github/actions/**` are invisible to Dependabot → every bump of `setup-java` (or `setup-node`, `cache`, `setup-gradle`, all pinned in composites) moves the workflow references only.
   - `pr-checks.yml` change detection classifies `.github/*` as "no flags" (case arm ~line 111) → a workflow-only PR skips `test-backend`, `sonarcloud` **and** `integration-tests` → the pin guard cannot run on exactly the diff class that introduces drift. That is how #1646 auto-merged green this morning: every guard-carrying job reported "skipped".
4. **A second drift vector, proven by #1649:** Dependabot treats each sub-path of one action repo (`github/codeql-action/init`, `/autobuild`, `/analyze`; `actions/cache`, `/restore`, `/save`) as a separate dependency and raises separate PRs — so #1649 bumped `autobuild` alone and its own CodeQL job failed with *"Loaded a configuration file for version '4.36.3', but running version '4.37.1'"* (plus GitHub's mixed-versions warning). Every such solo PR also violates the one-SHA invariant by construction. Same-repo sub-actions must ride one grouped PR.
5. **A third unpinned-drift casualty, surfaced by this PR's own CI:** `integration-tests` fails on main lineage — 4 of 136 specs, all positive-permission cases ("user CAN read own device binding", "caller CAN create room with cohort"), denied via Firestore rules `evaluation error at L57:24`. Main's rules (last change #1550, 07-09) and specs (unchanged since May) are self-consistent — but `.github/actions/start-firebase-emulators` installed **unpinned `firebase-tools@latest`**, and 15.23.0 (07-09) / 15.24.0 (07-15) landed inside a window where change-detection routed **zero** integration runs on main. The locally-proven 15.15.0 passes these exact rules+specs (every local gauntlet); the CI-latest engine denies them — an emulator rules-engine behaviour drift masquerading as a product regression (same signature on #1650). The toolchain must be pinned to the local reference version and bumped deliberately.

## Acceptance Criteria

### Happy path
- [ ] `ci-action-pin-consistency.test.js` passes on a branch cut from healed main: one SHA repo-wide for `actions/setup-java` (`03ad4de0992f5dab5e18fcb136590ce7c4a0ac95` / v5.6.0), composite and workflows agreeing.
- [ ] Every `.github/actions/*` directory is declared in `dependabot.yml`'s `github-actions` entries, so a future action bump raises ONE PR moving every reference together.
- [ ] A PR whose diff touches only `.github/**` runs the backend test job (and with it the pin guard) — the guard can no longer be skipped on the diff class that causes drift.
- [ ] Every action repo referenced under two or more sub-paths (`github/codeql-action/*`, `actions/cache*`) is covered by a Dependabot group, so its sub-path bumps arrive as ONE PR moving all references together.
- [ ] CI's emulator toolchain is pinned to the locally-proven `firebase-tools@15.15.0` with a version-keyed JAR cache — `integration-tests` returns green on main lineage (proven on this PR's own run).

### Error paths
- [ ] A future PR reintroducing a two-SHA pin state fails CI by name (test-backend / sonarcloud) before merge, even when its diff is workflow-only.
- [ ] Adding a NEW composite-action directory without declaring it to Dependabot fails the new coverage test, naming the missing directory.
- [ ] Introducing a second sub-path of an action repo without a covering Dependabot group fails the coverage test, naming the ungrouped repo.
- [ ] Reverting to an unpinned `firebase-tools` install — or bumping the pin without moving the cache key in lockstep — fails the new emulator-pin test.

### Edge cases
- [ ] Composite actions with no external pinned `uses:` today are still declared (harmless now; future-proofs their first pinned step).
- [ ] The change-detection edit keeps every existing classification intact for non-`.github` diffs — pinned by the existing `pr-checks-*.test.js` family staying green.

### Performance
- [ ] Only `.github`-touching PRs pay a new cost (the backend suite, ~6 min). They are rare (~1–2/week); every other PR class is unchanged.

### Security
- [ ] All action references remain full-length commit-SHA pins; no tag/branch refs introduced.

### UX
- N/A — operator-facing CI behaviour only.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] The pin test's failure output continues to name the drifted action repo and the per-file SHA map (the exact diagnostic that solved this incident).

## BDD Scenarios

**Scenario: A routine dependency update arrives after the heal**
- **Given** the automatic dependency updater proposes a new version of a build tool that CI uses in several places
- **When** its pull request runs the checks
- **Then** the proposal moves every reference of that tool together
- **And** the checks judge the update on its own merits instead of failing on a pre-existing inconsistency

**Scenario: Someone changes only CI plumbing**
- **Given** a pull request that touches only CI configuration
- **When** the checks run
- **Then** the consistency guard actually runs on that pull request
- **And** an inconsistent state cannot merge unnoticed

**Scenario: A new reusable CI building block is added**
- **Given** a new composite-action directory is created without registering it with the dependency updater
- **When** the test suite runs
- **Then** a test fails naming the unregistered directory

## Test Plan

- **RED first** (all three proven failing at the `origin/main` cut before any fix, via the canonical runner):
  1. `tests/scripts/ci-action-pin-consistency.test.js` — already RED (CI evidence #1650 job 88287120285; reproduced locally in this worktree).
  2. NEW `tests/scripts/dependabot-composite-actions-coverage.test.js` — parses `dependabot.yml` + the `.github/actions/*` directory list; RED before the `dependabot.yml` change. Also enumerates every action repo used under ≥2 sub-paths across `.github/**` and asserts each is covered by a Dependabot group pattern (the #1649 vector); RED before the groups are added.
  3. NEW `tests/scripts/pr-checks-github-dir-backend-gate.test.js` — parses the detect-changes case block; RED before the `pr-checks.yml` change.
  4. NEW `tests/scripts/start-firebase-emulators-pin.test.js` — exact-semver install + version-keyed cache, cross-consistent (version-agnostic contract); 3/3 RED against the unpinned composite before the fix.
- **GREEN**: those three after the fixes; the existing `pr-checks-*.test.js` pin family green (regression net over the case-block edit).
- **Frameworks**: express Jest (canonical `npm test`; single-file invocations during the device-matrix window — scripts tests are stack-free), eslint, actionlint on edited workflows, story validators.
- **CI proof on this PR**: the diff touches `express-api/tests/**` → `BACKEND=true` → test-backend + sonarcloud run the pin guard on this very PR.
- **Device gauntlet**: EXEMPT — CI-config-only class (`.github/**` + CI-structure pin tests; no runtime surface touched or affected).

## Out of Scope

- Upgrading firebase-tools past 15.15.0 and adapting `firestore.rules`/integration specs to the newer rules engine — that is deliberate follow-up work on develop (product-surface rules change = full protocol), not part of this CI-config heal. The #1650-observed integration failure itself IS root-caused and fixed here (Why #5).
- Closing/regrouping the already-open per-sub-path PRs (#1649 and siblings) — operational sweep after merge; Dependabot applies groups at PR-creation time, so existing solos are closed and the next scheduled run raises grouped replacements.
- Rebasing/re-judging the 17 Dependabot PRs (operational sweep immediately after merge, not part of this diff).
- develop's pin state (v5.5.0-aligned via #1617) — resolved by the mandatory back-merge, not by edits on develop.

## Dependencies

- None. Cut from `origin/main` @ `37a9dc175e0`.

## Risks & Mitigations

- **Back-merge conflict is expected** on the composite pin (develop: `0f481fcb…` v5.5.0 via #1617; main after this: `03ad4de0…` v5.6.0) → resolve to `03ad4de0…`; develop's own pin test then agrees repo-wide.
- **Case-pattern ordering is first-match-wins** → the new `.github/*` arm sits after the more-specific `express-api`/integration arms and before the no-op arm; pinned by the new test plus the existing family.
- **Dependabot `directories` syntax risk** → the coverage test parses exactly what we ship; the next scheduled "Dependabot Updates" run is the live end-to-end proof.

## Definition of Done

- [ ] Three RED tests captured failing, then green after the fix; full pin-test family green; eslint + actionlint clean; `code-reviewer` 100% clean on the local commit; push; CI green BY NAME (Detect Changes, Analyze JavaScript, PR Gate, test-backend, sonarcloud); `scripts/pre-merge-check.sh <PR#>` with no `--skip-ci-check`; autonomous squash-merge to MAIN per the CI-config-only rule; story → Done on main-merge; IMMEDIATE back-merge main→develop (conflict resolved, Done flip + SHY-INDEX row in that push); Dependabot queue rebased and re-judged; #1508 auto-merge armed.

## Notes

- 2026-07-20 — Born fully refined mid-incident. The story file rides the main PR deliberately (never-untracked rule; it reaches develop via the back-merge — same distribution SHY-0195's spec used in reverse). Lineage: #1587 (07-13) split the pins on main → #1617 (07-16, SHY-0195) healed develop only → #1646 (today 06:14) re-split wider on main with every guard job change-detection-skipped (test-backend / sonarcloud / integration-tests all "skipped"; auto-merge fired on the skips).
- 2026-07-20 — **code-review R1** (`/code-review low`-shape, single strict reviewer on the LOCAL commit, adapted pre-push): 2 findings, both test-robustness, both verified before applying — (1) job-gate assertions were whole-file `toContain` while the `backend_changed == 'true'` literal exists at 3 sites (job-input wiring line 173, test-backend 315, integration-tests 375) → rescoped via mirrored `extractJob`; (2) no behavioral case covered the `.github/**/*.md` dual-match (`.github/*` vs `*.md` first-match ordering) → added `.github/pull_request_template.md` → BACKEND case. Re-review of the fixes: **zero findings**. Prettier + In-Review flip delta re-reviewed: **zero findings** (reviewer verified the delta formatting-only + confirmed the corrected comment citation).
- 2026-07-20 — **First CI run surfaced Why #5** (integration-tests red, 4/136 positive-permission denials, same signature as #1650): root-caused to the unpinned `firebase-tools@latest` in `start-firebase-emulators` (15.23.0/15.24.0 released 07-09/07-15 inside a zero-integration-runs window; local 15.15.0 green on identical rules+specs). Fixed in-class: pinned install + version-keyed cache + `start-firebase-emulators-pin.test.js` (RED 3/3 → GREEN). Deliberate 15.24-era upgrade deferred to develop follow-up (Out of Scope). Also: lint's Express prettier step caught hand-formatting on the two new tests (fixed); Pre-Merge Gate correctly failed the In-Progress story (flipped to In Review — Gate 1 working as designed).
- Reviewed-up-to: `8644c0dff36` + the firebase-tools-pin delta (review pending at commit time; recorded on verdict).
