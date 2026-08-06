---
id: SHY-0242
status: In Review
owner: claude
created: 2026-07-25
priority: P1
effort: M
type: infra
roadmap_ids: []
---

# SHY-0242: Dependabot → develop + hard-gate every develop PR on CI

## User Story

As the **maintainer** of ShyTalk's git-flow,
I want **Dependabot to open its updates against `develop` and every `develop` pull request to be blocked until CI is green** (so safe dependency bumps auto-merge on green, exactly as they do on `main` today),
So that **dependencies flow through the integration branch like all other work, and nothing — bot or human — lands on `develop` untested**.

## Why

The git-flow pivot (SHY-0161/#1538) moved all day-to-day merges to `develop`, but its second half — wiring CI to `develop` — was never completed. Today `pr-checks.yml`, `codeql.yml`, and `branch-discipline-check.yml` all trigger only on `pull_request: branches: [main]`, and the `develop` branch is governed only by the global `no-force-push-anywhere` ruleset (`non_fast_forward`, `~ALL`). **So `develop` PRs run zero CI and nothing gates their merge.**

That leaves two gaps:

1. **Dependabot still targets `main`.** Dependency bumps jump straight to the release branch instead of flowing through `develop`. 17 stale update PRs are piled against `main`, red on stale-base CI, never auto-merging.
2. **Any `develop` merge is untested.** If Dependabot were simply retargeted to `develop` as-is, `gh pr merge --auto` (which waits on *required status checks*) would find none and **merge immediately, untested** — the opposite of "auto-merge as long as automated tests pass."

The operator's decision (2026-07-25): **hard-gate ALL develop PRs** — every `develop` PR (stories included) must be CI-green to merge, and Dependabot rides that same gate. This makes Dependabot reuse the exact battle-tested CI path it uses on `main` today (proven to run with secrets — see Notes), rather than a bespoke parallel workflow.

## Acceptance Criteria

### Happy path
- [ ] `pr-checks.yml` triggers on `pull_request` for **both** `main` and `develop`; a `develop` PR produces the three required check contexts (`Detect Changes`, `Analyze JavaScript`, `PR Gate`).
- [ ] A new `develop`-scoped repository ruleset requires those three contexts (mirroring `main` ruleset `12613584`), so a `develop` PR cannot merge until they pass.
- [ ] `dependabot.yml` sets `target-branch: "develop"` on all four ecosystems (gradle `/`, npm `/express-api`, npm `/`, github-actions `/`); Dependabot opens future updates against `develop`.
- [ ] `dependabot-auto-merge.yml` triggers on `pull_request: branches: [develop]`; a patch/minor/github-actions update auto-approves and `--auto --squash`-merges **only after** the develop required checks pass.

### Error paths
- [ ] A `develop` PR (bot or human) whose CI is failing or still pending **cannot** be merged (required-checks ruleset blocks it).
- [ ] A Dependabot update whose CI fails is **not** merged — it stays open for a human (auto-merge is enabled but never completes on red).

### Edge cases
- [ ] A **major** dependency update targeting `develop` is **not** auto-merged (unchanged policy: only patch/minor + github-actions auto-merge) — a human decides.
- [ ] The board-sync sidecar commit to `develop` (`board-items.json`, via the Release App `createCommitOnBranch`) **still succeeds** — the Release App (integration `29110`) is in the new ruleset's `bypass_actors`, exactly as on `main`.
- [ ] The heavy device-E2E jobs (`android-e2e`, `ios-e2e`) **skip** on `feature→develop` PRs (their existing `github.base_ref == 'main'` guards) and run only on the `develop→main` promotion — no emulator cost added to develop PRs.
- [ ] The 17 existing `main`-targeted Dependabot PRs are migrated to `develop` (recreated against the new target) so the backlog lands through the gate.

### Performance
- [ ] Develop PRs now pay the standard fast-CI wall-clock (~15 min); acceptable and intended (the operator's explicit choice). No *new* device/emulator cost is added to develop PRs (device jobs stay base-main-guarded).

### Security
- [ ] The new required-checks ruleset targets **`refs/heads/develop` only** — NOT `~ALL` — so feature branches are unaffected (never force CI on every branch).
- [ ] `bypass_actors` on the develop ruleset is limited to the Release App (`29110`) — the one confirmed direct-writer to develop. **Dependabot is NOT a bypass actor** (it must gate on checks like everyone else).
- [ ] No secret is added, logged, or exposed by any change.

### UX
- N/A — CI-config-only; there is no user-facing app/web/backend surface in this change. (Developer-facing effect: a `develop` PR now shows required checks and blocks-until-green, documented in `CLAUDE.md`.)

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] The develop ruleset is inspectable via `gh api repos/Shyden-Ltd/ShyTalk/rules/branches/develop` (shows the `required_status_checks` rule + the three contexts).
- [ ] The auto-merge workflow logs its patch/minor/major decision (unchanged decision block, re-pinned by tests).

## BDD Scenarios

**Scenario: A safe dependency update lands on develop by itself**
- **Given** Dependabot opens a patch or minor dependency update
- **And** it targets the `develop` integration branch
- **When** the automated test suite runs and passes
- **Then** the update is approved and squash-merged into `develop` with no human involved

**Scenario: A dependency update with failing tests is held back**
- **Given** Dependabot opens a dependency update targeting `develop`
- **When** the automated test suite fails
- **Then** the update is **not** merged
- **And** it stays open for a human to investigate

**Scenario: A contributor's own change to develop must pass CI first**
- **Given** a contributor opens a pull request into `develop`
- **When** the required automated checks have not all passed
- **Then** the pull request cannot be merged until they do

**Scenario: A major dependency update still needs a human**
- **Given** Dependabot opens a **major** version update targeting `develop`
- **When** the tests pass
- **Then** it is **not** auto-merged — a human makes the call (unchanged policy)

**Scenario: The story-board sync keeps working**
- **Given** the board sync writes its bookkeeping file to `develop` using its trusted release app
- **When** the new develop protection is active
- **Then** the release app is exempt and the write still succeeds (the board does not go stale)

**Scenario: Feature branches are untouched**
- **Given** a contributor pushes an ordinary feature branch (not a PR into develop or main)
- **When** the new develop protection is active
- **Then** no new required checks apply to that branch (the gate is scoped to develop only)

## Test Plan

**RED-first meta-tests (Jest, `express-api/tests/scripts/`), against the REAL workflow/config files (no doubles):**

- **NEW `develop-ci-gate.test.js`** — pins the trigger + config invariants that make the gate real:
  - `pr-checks.yml` `on.pull_request.branches` contains both `main` and `develop`.
  - `codeql.yml` `on.pull_request.branches` contains both `main` and `develop` (source of the `Analyze JavaScript` required context).
  - `dependabot-auto-merge.yml` `on.pull_request.branches` contains `develop` (and no longer `main`-only).
  - `dependabot.yml` sets `target-branch: "develop"` on all four ecosystems (parsed structurally — one assertion per ecosystem so a single omission is named).
  - RED before the edits (current files are `main`-only / no `target-branch`), GREEN after.
- **NO edits to existing meta-tests** — all trigger pins live in the one new `develop-ci-gate.test.js` (one-fact-one-home). `dependabot-auto-merge-decision.test.js` (the executed decision matrix) and `pr-checks-device-e2e-deferred.test.js` (the base-main device-skip guards — whose describe already anticipated "once develop joins the trigger") are verified UNBROKEN by the trigger edits (138 sibling meta-tests green).

**Real-execution verification (no mocks — the change's proof is the live behaviour):**
- After landing on `main` + back-merging to `develop` + creating the ruleset:
  - `gh api .../rules/branches/develop` read-back shows the `required_status_checks` rule with the three contexts (Observability AC).
  - A real `develop` PR is confirmed to run `pr-checks` and be blocked-until-green.
  - A real recreated Dependabot patch/minor PR against `develop` is observed to run CI and auto-merge on green (the headline AC — end-to-end proof).
  - The board-sync sidecar commit to `develop` is confirmed still landing (Release App bypass works).

**Full non-device gauntlet for a CI-config-only change (per the Pre-Merge Protocol exemption 2):** `express-api` Jest (the meta-tests above + the full suite), `actionlint` + embedded shellcheck, `eslint`/`prettier` `--max-warnings=0`, the story-frontmatter validator, `code-reviewer` 100%-clean, and CI green by name on the `main` PR.

## Out of Scope

- Adding `pull_request`-required / `required_signatures` rules to `develop` (kept minimal — only `required_status_checks` + the global `non_fast_forward` already covering develop).
- Changing the auto-merge **policy** (which update types merge) — patch/minor/github-actions stays exactly as today.
- Extending CI to a *reduced/Dependabot-only* lane (rejected in favour of the full-gate decision).
- Any product runtime change (app/backend/website) — none; this is CI-config-only.
- Retiring `pre-merge-check.sh --skip-ci-check` from the tooling (follow-up doc/tooling cleanup once the develop gate is proven; the flag becomes a no-op for develop but removing it is not required here).
- **`inject-pr-closes.yml` develop-parity — deliberately DEFERRED.** It still triggers on `branches: [main]`, but CLAUDE.md documents it as currently inert (story PRs carry no `Closes #N`; it is retained for a future user-bug-report intake). When that intake activates, bug-report PRs against `develop` will want `Closes #N` injection — a conscious follow-up at that time, not this story's concern.

## Dependencies

- Depends on the **main** ruleset `12613584` as the mirror source for the `required_status_checks` rule shape + `bypass_actors` (read, not modified).
- The develop ruleset creation requires repo-admin (`gh api` with the operator's token) — repo setting, not a committed file.
- `dependabot.yml` must land on the **default branch (`main`)** for Dependabot to read the new `target-branch` (Dependabot always reads config from the default branch).
- Sequencing depends on the GitHub rule that `pull_request` `on:` filters are read from the **base branch's** copy of the workflow — so `develop` must receive the updated workflow files (back-merge) **before** the ruleset is armed, or develop PRs would hang on checks that never start.

## Risks & Mitigations

- **Risk: arming the ruleset before develop has the updated workflows → develop PRs hang forever on missing checks.** → **Mitigation:** strict sequence — the workflow files must be LIVE on `develop` (merged, and `pr-checks` confirmed to fire + report the 3 contexts on a real develop PR) BEFORE the ruleset is armed; creating the ruleset is the LAST step.
- **Risk: the develop ruleset accidentally scoped to `~ALL` → CI forced on every feature branch (repo-wide breakage).** → **Mitigation:** target `refs/heads/develop` explicitly; read-back `conditions.ref_name.include` before considering it done; a test cannot cover a repo setting, so verification is the `gh api` read-back.
- **Risk: the board-sync sidecar commit to develop breaks (required checks block the direct `createCommitOnBranch`).** → **Mitigation:** add the Release App (`29110`) to `bypass_actors`, mirroring `main`; verify a board-sync run still commits `board-items.json` after arming.
- **Risk: retargeting the 17 existing PRs leaves them rebased onto the wrong base / red.** → **Mitigation:** recreate them against `develop` (close → Dependabot re-opens against the new target, or `@dependabot recreate`) *after* the config is live, so they run the develop gate cleanly; escalate the 2 websocket-driver criticals + any major to the operator rather than force-merging.
- **Risk: a hidden test asserts the `[main]`-only trigger and goes red.** → **Mitigation:** grep + run the full `express-api` Jest suite (YAML-change discipline); verified — the two candidate pins (`pr-checks-device-e2e-deferred`, `dependabot-auto-merge-decision`) do NOT assert the trigger list and stay green UNCHANGED; every new pin lives in `develop-ci-gate.test.js` (one-fact-one-home). 138 sibling meta-tests confirmed green.
- **Risk: a future edit adds a `base_ref`/`if:` skip-gate to a REQUIRED-context job (`detect-changes`/`gate`/`analyze-javascript`), making it never report → develop PRs hang forever on the ruleset.** → **Mitigation:** `develop-ci-gate.test.js` pins the ABSENCE of a `base_ref` gate on all three (and `if: always()` on the gate), while asserting the intentional device-E2E `base_ref` guards REMAIN — so the two invariants can't be conflated in a refactor.

## Definition of Done

- **Everything → `develop` (one PR)** — per the operator's 2026-07-25 rule change ("the rule needs to change; everything goes to develop for testing"): `pr-checks.yml` + `codeql.yml` + `branch-discipline-check.yml` develop triggers, `dependabot-auto-merge.yml` develop trigger, `dependabot.yml` `target-branch`, the new meta-test, the story. No separate main PR (the old "CI-config → main directly" rule is retired — see Notes).
- **`dependabot.yml` reaches `main` via the develop→main promotion** (the release gauntlet), NOT a direct main PR. Until that promotion, Dependabot still reads main's old config; the in-flight backlog (17 PRs) is retargeted to `develop` by hand so it lands through the new gate now.
- New + updated meta-tests green; full `express-api` Jest suite green; `actionlint`/lint/prettier green; `code-reviewer` 100%-clean; CI green by name on the `main` PR.
- Back-merged to `develop`; `develop` ruleset created (required checks + Release-App bypass) and read-back-verified; a real develop PR confirmed blocked-until-green.
- The 17 existing Dependabot PRs migrated to `develop`; patch/minor ones auto-merging on green; criticals/majors escalated.
- `CLAUDE.md` Git-Rules/branch-protection section updated to document the develop ruleset; memory updated ([[feedback-merge-authority-develop-vs-main]] / the develop-has-no-CI facts corrected).
- **Standing-rule documented (drift guard):** `dependabot.yml` on `develop` is functionally INERT (Dependabot reads config only from the default branch, `main`). Any future `dependabot.yml` edit landed the normal git-flow way (PR → develop) has ZERO effect until it also reaches `main`. Captured in `CLAUDE.md` so a future edit isn't silently ignored.
- Story flipped to `In Review` with a `Reviewed-up-to: <sha>` line before merge.

## Notes

**2026-07-25 — CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) after the operator directive: "dependabot PRs must be wanting to merge into develop, not main. and they should auto-merge as long as automated tests pass." Pickup-fitness investigation done at creation (all `gh api` / grep evidence, no guessing):

- **Empirical: Dependabot PRs get FULL CI + secrets on this repo.** PR #1650 (a real Dependabot→main PR) ran `integration-tests` (needs the live stack), `sonarcloud` (needs `SONAR_TOKEN`), and `Build & Test` (needs `google-services` secrets) — so the notorious "Dependabot read-only token / no secrets" trap is already solved here. The 17 PRs are piled up because they're **red** (stale-base CI), not because auto-merge is broken (the `auto-merge` job itself passes).
- **`main` ruleset `12613584`** requires `Detect Changes` + `Analyze JavaScript` + `PR Gate` (each `integration_id: 15368`, `strict: false`); `bypass_actors` = Release App `29110` + integration `3324562`, both `always`.
- **`develop` today** is governed only by ruleset `16058327` (`no-force-push-anywhere`, target `~ALL`, `non_fast_forward` only). The develop gate therefore needs a **NEW** ruleset (not a mutation of `16058327`, which would hit every branch).
- **SHY-0161 half-done:** the git-flow pivot moved merges to develop but never added `develop` to the CI triggers; `pr-checks.yml`'s SHY-0163 `base_ref == 'main'` device-E2E guards were written forward-looking for exactly this moment (comments say "once SHY-0161 adds develop to the trigger").
- **Operator decision:** hard-gate ALL develop PRs (chosen over a Dependabot-only lane) — Dependabot reuses the proven main CI path; the cost is that develop story PRs now also gate on CI.
- **Merge-target correction (surfaced mid-build):** the first plan was "land the whole thing on `main` directly" (CI-config-only exemption). Investigation killed that: (a) the workflow triggers must live on `develop` for develop PRs to use them (GitHub reads a `pull_request` workflow's `on:` from the PR's **base** branch); (b) `main` is 49 commits behind `develop` and still carries the **pre-existing** `SC2034` (unused `DEP_TYPE`) + `SC2129` (ungrouped redirects) that SHY-0191/a later commit already fixed on `develop` — the **local pre-push hook** runs `actionlint` over all workflows (my 1.7.12 + shellcheck) and would block a main-based push on those develop-already-fixed warnings; fixing them on `main` would collide with develop's versions on back-merge. (CI's 1.7.7 tolerates them — proven by PR #1650's green `Lint` with the same `DEP_TYPE` present — but the local hook does not.) So the CI-gate lands on **develop**. Non-technical BDD per [[feedback-non-technical-bdd]].
- **Rule CHANGED by operator (2026-07-25), surfaced by the code-reviewer:** the reviewer (correctly) flagged that landing a CI-config change on develop deviates from the then-standing HARD rule "CI-config-only → main directly," and asked for operator sign-off. Operator's ruling (verbatim): *"the rule needs to change. everything goes to develop for testing."* So the old rule is **RETIRED** — it only existed because develop had no CI, and THIS story is what gives develop CI. Everything now lands on develop first (tested there); `main` receives changes only via the develop→main promotion. Memory [[feedback-ci-config-only-merge-to-main]] rewritten to record the reversal; `CLAUDE.md` updated as part of this story (with the develop ruleset, after arming). This removes the whole `main`-staleness problem — there is now just ONE PR, to develop.
- **2026-07-25 — `code-reviewer` R1** (verified each finding before agreeing): 2 Crit — (a) CI-gate merge-target vs the CI-config→main rule → escalated → operator changed the rule (above); (b) missing regression pin for a `base_ref`/`if:` skip-gate on the 3 required-context jobs → ADDED (`develop-ci-gate.test.js` now asserts absence on detect-changes/gate/analyze-javascript + presence on the device jobs). Plus Imp/Minor: parser edge-case tests ADDED; story inconsistencies (stale "land on main", false "pins updated") FIXED; `inject-pr-closes.yml` develop-parity deliberately DEFERRED (Out of Scope); `dependabot.yml` two-surface drift documented as a standing rule. Reviewer-fix delta self-certified (22 develop-ci-gate tests green, 138 sibling meta-tests green, actionlint clean).

Reviewed-up-to: 01251e0d9f2c4fa4fa1f8976f9aef99328f035da
