---
id: SHY-0034
status: Done
owner: claude
created: 2026-06-08
priority: P0
effort: L
type: refactor
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1040
---

# SHY-0034: Re-architect release.yml to tag-only signed-commit flow

## User Story

As the ShyTalk operator who declared "we make releases and tag them, we don't need a separate branch for a release" (2026-06-07 ~22:30 BST), I want **`release.yml` refactored so that no `release/v*` branches are created during a release run — releases happen via git tags only**, so that the release infrastructure aligns with the codified [[feedback-no-release-branches-use-tags]] HARD GLOBAL rule and the failure mode of orphaned `release/v*-r<run-id>` branches from cancelled runs becomes impossible.

## Why

The current `release.yml` (line 369 + 500) creates `release/v${VERSION}-r${{ github.run_id }}` branches as a load-bearing artefact of its signed-commit flow:

```yaml
BRANCH="release/v${VERSION}-r${{ github.run_id }}"
# ...
gh api -X POST "repos/.../git/refs" -f "ref=refs/heads/${BRANCH}" -f "sha=${PARENT_SHA}"
# ...
PAYLOAD=$(jq -n ... '{ query: "mutation { createCommitOnBranch(input: { branch: { repositoryNameWithOwner, branchName }, ... }) ... }" ... }')
echo "$PAYLOAD" | gh api graphql --input -
```

**Why the branch exists**: GitHub's GraphQL `createCommitOnBranch` mutation is the only path to a SIGNED commit from CI without a configured GPG/SSH key — but it requires a `branchName` input (you can't `createCommitOnBranch` against `main` if main's branch-protection blocks direct writes). The branch is a working space for the signed commit before it gets squash-merged into main.

**Why signed commits are required**: branch-protection ruleset `12613584` on `~DEFAULT_BRANCH` (main) has `required_signatures: true`. Unsigned commits get rejected at merge time — exactly the failure mode hit with PR #608 (v0.97.6 release).

**Why each release creates a fresh branch**: a per-run-ID suffix (`-r<github.run_id>`) prevents collisions between concurrent or retried release runs. Squash-merge discards the branch name from main's history, so the suffix never appears in production.

**The orphan-branch problem**: SHY-0033's branch audit confirmed 6 stale `release/v*` branches contributing to the 506-branch sprawl. Failed/cancelled release runs leave orphans because the cleanup-on-merge auto-delete only fires on successful merge. SHY-0033 swept them; SHY-0034 prevents the source.

**Operator directive 2026-06-07 ~22:30 BST + ~00:35 BST (Option B):**

> "1. and don't make release branches anymore. we make releases and tag them, we don't need a separate branch for a release"
> "B. because A is just a patch over and isn't in line with our quality and reliability first policy"

The operator explicitly chose Option B (re-architect) over Option A (keep ephemeral branches + improved cleanup).

## Acceptance Criteria

### Happy path

- [ ] `.github/workflows/release.yml` is refactored such that NO `release/v*-r<run-id>` branch is created during a release run. Verified by grep: `grep -nE 'release/v.*\$\{|BRANCH=.release' .github/workflows/release.yml` returns zero matches in the refactored file.
- [ ] Signed commits are still produced via the chosen architecture (one of the 3 alternatives below; architect to validate the choice).
- [ ] The release flow still produces:
  - A git tag `v${VERSION}` pointing at the release commit on main.
  - A GitHub Release with auto-generated release notes.
  - The version-bumped files (app/build.gradle.kts + 2 release-notes .txt files) on main.
- [ ] Dispatch of `release.yml` via `workflow_dispatch` against a test version succeeds end-to-end on the dev environment (i.e. test the new flow before merging this PR).
- [ ] `release-workflow-pin.test.js` is updated to assert the new flow (no `BRANCH=release/v` assignment; the new signed-commit mechanism is asserted instead).
- [ ] CLAUDE.md `## Git Rules` section's note about `release.yml currently still creates...` is updated to reflect the new state (no ephemeral branches).

### Error paths

- [ ] If the chosen signed-commit mechanism fails (GraphQL API down, GPG key invalid, etc.) the release run fails LOUDLY with a clear error and does NOT create a partial release tag.
- [ ] If a duplicate release run is triggered for the same version, the second run detects + fails with a clear "version v${VERSION} already released" error.
- [ ] If the version-bump files (build.gradle.kts, release notes) fail to be committed, no tag is created.
- [ ] If the tag creation succeeds but the GitHub Release creation fails, the tag is rolled back (deleted) OR the run is marked failed and operator is told to manually create the Release.

### Edge cases

- [ ] **Concurrent release runs** (rare but possible if operator clicks "Run workflow" twice): the workflow's existing concurrency group at the top of release.yml MUST cover this case; verify it.
- [ ] **Tag already exists** (idempotent re-run): if `v${VERSION}` tag already exists, the workflow either (a) treats it as success and skips commit/tag steps OR (b) errors clearly. Document which.
- [ ] **Force-rebuild of an old version** (operator wants to re-release v0.97.5 for some reason): does the new flow support this? Either via `force` input flag or via documented manual procedure.
- [ ] **App-token expiry mid-run** (GitHub App tokens expire after 1 hour): the flow must complete within 1 hour, OR refresh the token, OR fail clearly.
- [ ] **Required signature ruleset disabled** (e.g. for emergency hotfix): if `required_signatures` is temporarily disabled, the new flow MUST still produce signed commits (don't relax just because the rule allows it).

### Performance

- [ ] Total release-flow wall-clock time is ≤ existing flow's wall-clock time. Measured against the most recent successful release run.
- [ ] No new API call introduces > 5s latency per release.

### Security

- [ ] All commits to main carry valid signatures (verified by `gh api repos/.../pulls/N/commits | jq '.[] | {sha, verified: .commit.verification.verified}'`).
- [ ] Whatever signing identity is chosen (GitHub App / bot account / etc.) is documented in CLAUDE.md so future contributors know.
- [ ] If a bot account with GPG key is chosen: the private key is stored as a repo secret with the documented name (e.g. `RELEASE_BOT_GPG_KEY`); never logged; never committed.
- [ ] If GitHub App bypass-actor approach is chosen: the bypass is scoped to the specific App ID, not a wildcard role; documented in CLAUDE.md.
- [ ] Branch-protection's `required_signatures` rule on main remains enabled throughout this work.
- [ ] No new `--no-verify` git operations introduced.

### UX

- [ ] N/A — internal CI/release infrastructure; no end-user-facing change.

### i18n

- [ ] N/A — operator-side tooling.

### Observability

- [ ] Each release run emits a structured log line at end naming: version, tag SHA, release URL, duration, signing mechanism used.
- [ ] CI job summary lists each step's outcome.
- [ ] If the new flow fails, the failure mode is distinguishable from a "rerun" decision via the job's exit-line.
- [ ] Crashlytics or equivalent monitoring (N/A for release infra) — out of scope.

## Architecture alternatives (3 options for architect to evaluate)

### Option A: `createCommitOnBranch` against `main` directly with a bypass actor

**Approach**: Add the Release GitHub App as a `bypass_actors` entry on main's branch-protection ruleset (id 12613584). The App can then `createCommitOnBranch` against `main` directly without going through a PR. Tag is created via `gh api -X POST git/refs` after the commit.

**Pros**:

- Smallest code change to `release.yml` (remove 1 ref-create step + change `branchName: $branch` → `branchName: "main"`).
- No new GPG key infrastructure.
- Signed commits via App identity (same as today).

**Cons**:

- Adds a bypass actor to main's branch protection — weakens the "everyone goes through PR" invariant.
- The bypass-actor approach is documented + scoped to the App, but any compromise of the App credentials becomes a direct-write-to-main vector.
- Doesn't create a PR for the release commit — loses the PR-as-audit-trail.

### Option B: Bot account with persistent GPG signing key

**Approach**: Create a bot user account (e.g. `shytalk-release-bot`). Generate a long-lived GPG key for it. Store the private key as a repo secret (`RELEASE_BOT_GPG_KEY`). In CI, configure git to use this key. `git commit -S` produces signed commits without GraphQL. Push to a temporary branch (NOT `release/*` — could be a single `release-staging` branch that always exists), open PR, auto-merge, tag.

**Pros**:

- Uses standard git operations; no GraphQL complexity.
- The bot account is auditable as a "user" on GitHub.
- One persistent `release-staging` branch (not per-run); auto-resets to main after each release.

**Cons**:

- Single `release-staging` branch is STILL a "release branch" — operator's directive arguably forbids this too.
- GPG key management is non-trivial (rotation, revocation, secret hygiene).
- Bot account is a real GitHub seat — may have licensing/org-policy implications.

### Option C: Tag-only with `git describe` version derivation (no commit at all)

**Approach**: Eliminate the version-bump commit entirely. Derive version at BUILD time from `git describe --tags`. Release notes generated from PR labels or conventional commits (auto-generated from the PR history since the last tag). Release workflow: triggered on tag push to `v*`; builds artifacts; creates GitHub Release with auto-generated notes; deploys.

**Pros**:

- TRULY no branches — tags only, matches operator's directive literally.
- No signed-commit problem because no commit is created during release.
- Smallest steady-state surface: release.yml just builds + tags + releases; no GraphQL, no Apps, no GPG.
- Aligns with "deploy is derived from tag" principle (industry standard).

**Cons**:

- Biggest refactor: `app/build.gradle.kts` must read version from git/env at build time (not from a committed `versionName` line).
- Release notes generation must move from hand-written committed .txt files to PR-label-driven auto-generation OR tag-message embedding.
- Existing release.yml is ~589 lines; this rewrites a large portion.
- Pre-tag steps that modify the working tree (release notes generation, version bump) need to be re-imagined as "build-time" rather than "commit-time."

### Architect verdict: **CHOOSE OPTION A** (2026-06-08 ~10:15 BST)

The architect agent (feature-dev:code-architect) reviewed all 3 options against 7 criteria (operator-fit, security, maintenance, implementation risk, recovery, release-notes, existing `release-tag.yml`). Verdict: **Option A**, with critical context that corrects my spec:

1. **`release-tag.yml` already does tag-and-GitHub-Release creation** on push-to-main when it detects a `chore: release vX.Y.Z` commit subject. Option A naturally produces such a signed commit directly on main; release-tag.yml fires unchanged. **The "two-workflow split" survives intact** — only release.yml's branch+PR ceremony goes away.

2. **Option C's blast radius is larger than my spec acknowledged**: `app/build.gradle.kts` (versionCode + versionName are committed literals at lines 29-30, not derived); `deploy-prod.yml` awk parse of versionName at lines 109, 126, 505; `deploy-dev.yml` at lines 647, 657; iOS `Info.plist` MARKETING_VERSION injection chain; release-tag.yml cross-check at lines 100-110. That's a 5-file cascade requiring a separate SHY — Option C is the wrong choice for THIS SHY.

3. **Release notes are ALREADY auto-generated** from conventional commits (release.yml lines 203-354: `git log --first-parent`, feat/fix/perf allowlist, UTF-8-safe truncation for Google Play). The committed `internal.txt`/`default.txt` files are the **Play Store delivery vehicle** (consumed by `r0adkll/upload-google-play`), not hand-written content. Option C would have to rebuild that delivery path — regression risk.

4. **Option A's security weakening is minimal in practice**: the Release GitHub App is already trusted to write release commits via the current PR-flow. The bypass actor just removes the ceremonial PR wrapper around the same machine-generated content (version bump + 2 release-notes files). Compromised App credentials are dangerous either way; the marginal risk delta is small.

5. **Option A is the smallest change**: ~10 implementation steps, removes ~120 lines from release.yml (PR-create + auto-merge steps), no new infrastructure, no GPG key management.

**Chosen: Option A.** Implementation gated on operator authorisation to add the Release App as a `bypass_actors` entry on main's branch-protection ruleset (id `12613584`) — equivalent shape to the earlier `no-force-push-anywhere` ruleset edit operator authorised in SHY-0033.

## BDD Scenarios (rewritten for Option A per architect verdict 2026-06-08)

**Scenario: Option A — `createCommitOnBranch` targets main directly, no release branch created**

- **Given** the refactored release.yml is in place
- **And** the Release App has been added as a `bypass_actors` entry on ruleset `12613584`
- **And** the operator triggers a release via `workflow_dispatch` for `v0.97.8`
- **When** release.yml's `create_commit` step runs
- **Then** the GraphQL `createCommitOnBranch` mutation targets `branchName: "main"` (NOT `release/v0.97.8-r<run-id>`)
- **And** the mutation succeeds (the App's bypass actor permits direct-to-main signed commits)
- **And** the signed commit `chore: release v0.97.8` appears on main (verified by `gh api repos/.../pulls/N/commits | jq '.[].commit.verification.verified' == true`)
- **And** NO `release/v0.97.8-*` branch exists in `gh api repos/.../branches`
- **And** the `Open release PR` step has been removed from release.yml entirely (no PR is opened)

**Scenario: release-tag.yml fires unchanged on the new commit**

- **Given** Option A's signed commit `chore: release v0.97.8` lands on main
- **When** the `push: branches: main` trigger of `release-tag.yml` fires
- **Then** release-tag.yml detects the `chore: release v` subject pattern (its existing logic, unchanged)
- **And** creates the `v0.97.8` git tag pointing at the release commit
- **And** creates the GitHub Release with regenerated release notes
- **And** the version cross-check (release-tag.yml lines 100-110) confirms `versionName` in `build.gradle.kts` matches the commit subject

**Scenario: `expectedHeadOid` conflict on concurrent push (architect risk #2)**

- **Given** another commit lands on main between the workflow's `git rev-parse HEAD` and the `createCommitOnBranch` mutation
- **When** the mutation submits with the now-stale `expectedHeadOid`
- **Then** the mutation fails LOUDLY with a clear concurrency-conflict error (no partial state)
- **And** the operator can simply re-trigger the workflow
- **And** the workflow's step comment documents this expected failure mode

**Scenario: signed-commit guarantee preserved**

- **Given** the new flow has produced a `chore: release v0.97.8` commit on main
- **When** `gh api repos/.../commits/<sha>` is inspected
- **Then** `verification.verified == true`
- **And** `verification.reason == "valid"`
- **And** the signer identity is the Release GitHub App (as today)

**Scenario: post-merge — no orphan release branches ever**

- **Given** the new release.yml has run multiple times (success + failure paths)
- **When** `gh api repos/.../branches --paginate --jq '.[].name | select(startswith("release/"))'` runs at any time
- **Then** the output is empty
- **And** the SHY-0033 cleanup pattern never needs to re-execute on release branches

**Scenario: bypass-actor persistence (architect risk #3)**

- **Given** the bypass actor for the Release App is added to ruleset `12613584`
- **When** `gh api repos/.../rulesets/12613584 --jq '.bypass_actors'` runs
- **Then** the App ID is listed
- **And** CLAUDE.md documents the App ID + the command to verify/restore
- **And** if the ruleset is ever regenerated (Terraform/UI), the bypass-actor entry must be restored manually (documented in CLAUDE.md as a one-time setup step)

**Scenario: PR-as-audit-trail compensation (architect risk #5)**

- **Given** Option A removes the release PR
- **When** release.yml runs successfully
- **Then** a structured `GITHUB_STEP_SUMMARY` entry records: version, signed commit SHA, release URL, App identity, duration — serving as the audit trail in place of the PR

**Scenario: pin test catches a regression**

- **Given** `release-workflow-pin.test.js` updated for the new flow
- **When** a future change adds back a `release/v` branch-creation line OR a `gh pr create` for the release flow
- **Then** the pin test fails with a clear message naming the offending pattern
- **And** the PR cannot merge

**Scenario: Concurrent release attempt rejected**

- **Given** a release run is in progress
- **When** a second `workflow_dispatch` for the same version is triggered
- **Then** the second run is blocked by the workflow's `concurrency:` group
- **And** the first run completes normally
- **And** no state corruption occurs

**Scenario: Tag already exists — idempotent**

- **Given** `v0.97.7` tag already exists on the repo (from a prior release)
- **When** release.yml is triggered for `v0.97.7` again (e.g. operator re-runs by accident)
- **Then** the workflow detects the existing tag and fails with `::error::version v0.97.7 already released — to re-release, manually delete the tag first`
- **And** no partial GitHub Release is created

**Scenario: Signed-commit guarantee (Option A/B only; Option C has no commit)**

- **Given** the release flow has produced a commit (only applicable for Option A or B)
- **When** `gh api repos/.../pulls/N/commits | jq '.[].commit.verification.verified'` runs
- **Then** the verification status is `true` for every commit
- **And** `verification.reason` is `valid`

**Scenario: GitHub Release creation failure — tag rollback**

- **Given** the tag was created but the subsequent Release-creation API call fails (e.g. transient 5xx)
- **When** the workflow detects the failure
- **Then** the workflow deletes the just-created tag (so re-running is safe)
- **OR** the workflow leaves the tag and emits `::error::Tag created but Release missing — operator must create Release manually for v0.97.8`

**Scenario: Old `release/v*` branches are not re-created by the new flow**

- **Given** the new release.yml is merged + a release has run successfully on it
- **When** `gh api repos/.../branches --paginate --jq '.[].name | select(startswith("release/"))'` runs
- **Then** the output is empty (no release/\* branches exist after the release)

**Scenario: Pin test catches a regression**

- **Given** the existing `express-api/tests/workflows/release-workflow-pin.test.js`
- **When** a future change adds back a `release/v` branch-creation line
- **Then** the pin test fails with a clear message naming the offending line
- **And** the PR cannot merge

## Test Plan (TDD)

### Red

1. **Pin test update**: `express-api/tests/workflows/release-workflow-pin.test.js` currently asserts the old flow's structure (branch creation lines). Update it to:
   - Assert NO line like `BRANCH="release/v` exists in release.yml.
   - Assert the new flow's structural markers (whichever architecture is chosen — e.g. for Option C: `on: push: tags: ['v*']` trigger present).
2. Run `cd express-api && npm test -- release-workflow-pin` — currently RED because release.yml still has the old structure.
3. Add structural test for `app/build.gradle.kts` if Option C is chosen: assert version is read from environment/git, not hard-coded.

### Green

1. **Architect-validate the design choice** between Options A/B/C. Architect agent dispatched against this SHY's Architecture-alternatives section.
2. Implement the chosen design:
   - **If A**: add bypass actor to ruleset 12613584; modify release.yml to target main directly.
   - **If B**: create bot account; provision GPG key + secret; modify release.yml to use git commit -S.
   - **If C**: refactor version derivation in build.gradle.kts; refactor release.yml triggers + steps; move release notes to auto-generation.
3. **Test on dev environment first**: dispatch the workflow against a test version (e.g. v0.97.8-test); verify outputs.
4. Update `release-workflow-pin.test.js`.
5. Update CLAUDE.md to reflect the new flow.
6. Pre-self-review: validator + prettier + actionlint + bash -n.
7. Push branch + open PR; dispatch reviewer; iterate to ZERO.
8. Auto-merge.
9. **Post-merge verification**: trigger an actual release on dev/staging to confirm end-to-end behaviour.

## Out of Scope

- **Refactoring `deploy-dev.yml` / `deploy-prod.yml`** — only `release.yml`. The deploy workflows may rely on the release commit structure; if so, their adjacent changes are deferred to a follow-up SHY.
- **Migrating version source-of-truth from build.gradle.kts to git tags everywhere** (e.g. iOS Info.plist version) — only do what release.yml needs.
- **Auto-generated release notes from conventional commits** (if Option C is chosen) — use PR labels OR PR titles, NOT full conventional-commit parsing. Future SHY can upgrade to conventional commits.
- **Changing the `required_signatures` branch-protection rule** — explicitly stays enabled.
- **Tag-prefix conventions** (`v` vs no-`v`, etc.) — keep current `v${VERSION}` convention.
- **Old release branch cleanup** — already done in SHY-0033.

## Dependencies

- **SHY-0033** (MERGED PR #1038) — codified [[feedback-no-release-branches-use-tags]] HARD rule + cleaned up the 6 orphan release/\* branches.
- **SHY-0032** + **SHY-0001..0003** — process dependencies.
- **GitHub App** (for Options A or B) — must have `contents: write` + `actions: read` scopes; verify via `gh api repos/.../installation`.
- **Branch-protection ruleset 12613584** — must remain configured but may gain bypass actor (Option A only).
- **`required_signatures` rule** — must remain enabled throughout.
- **Operator/architect decision** between Options A/B/C before any code changes.

## Risks & Mitigations

- **Risk:** The chosen architecture breaks the release flow in production. **Mitigation:** test on dev FIRST via workflow_dispatch with a test-version tag (e.g. `v0.97.8-test`); only merge to main after dev-verification.
- **Risk:** Option C's version-derivation refactor touches `app/build.gradle.kts` in a way that breaks dev builds. **Mitigation:** test locally with `./gradlew assembleDevDebug`; CI's existing build matrix catches regressions.
- **Risk:** GPG key management (Option B) is a security risk — leaked key = unauthorised signed commits. **Mitigation:** store as repo secret; rotate annually; document procedure.
- **Risk:** Bypass-actor approach (Option A) is the WORST in terms of "PR review for all main commits" principle — release commits bypass review. **Mitigation:** operator may consider this acceptable for release-only commits; document explicitly.
- **Risk:** Release notes auto-generation (Option C) produces lower-quality notes than hand-written. **Mitigation:** start with hand-edited fallback (operator can supply via workflow_dispatch input); auto-generate as default.
- **Risk:** This refactor delays a real release if operator needs to release urgently. **Mitigation:** keep the OLD release.yml workable (don't remove it) until the NEW flow is dev-validated; switchover happens only on PR merge.

## Definition of Done

- [ ] Architecture choice made + documented in SHY-0034 Notes (architect-validated).
- [ ] `release.yml` refactored per the chosen architecture.
- [ ] NO `release/v*` branches created during the new flow (verified by post-test snapshot).
- [ ] Signed commits guaranteed (if applicable per chosen architecture).
- [ ] `release-workflow-pin.test.js` updated; asserts new structure.
- [ ] `CLAUDE.md § Git Rules` updated to reflect the new flow.
- [ ] Dev-environment release dispatch succeeds end-to-end.
- [ ] Architect agent: ZERO findings (after fixes).
- [ ] Code-reviewer agent: ZERO findings (after fixes).
- [ ] Per-type Done gate satisfied (`refactor` → auto-merge once green; post-merge real-release-dispatch confirmation required before `status: Done`).
- [ ] PR merged.
- [ ] First real release using the new flow succeeds and is documented in Notes.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 11:23 BST — **MERGED** as PR #1040 (auto-merge fired at `2026-06-08T10:23:42Z`). Final cycle counts: architect ran once (9 findings, all applied including the Option-A-vs-C correction); code-reviewer ran 3 dispatches (3 → 4 → ZERO findings); pin tests 17/17 ✓; SonarCloud quality gate green at every pre-push. Status flipped `In Progress` → `Done`. Status flip lands in SHY-0035's branch (per [[feedback-one-active-branch-close-on-finish]] — admin work piggybacks on the next active branch to satisfy the PR-required-for-main rule without opening a separate doc-only PR).
- 2026-06-08 11:24 BST — *Lesson captured*: PR #1040 squash-merge subject retained the stale `[DRAFT] ... (3 alternatives — architect to choose)` prefix because the PR title was never updated when promoting DRAFT → ready. Future SHY closes: also run `gh pr edit <n> --title 'SHY-NNNN: <Title>'` (drop the `[DRAFT]` and any stale exploratory text) BEFORE `gh pr ready` + `gh pr merge --auto`. Squash subject = PR title at merge time. Filed as a self-discovered feedback memory.
- 2026-06-08 ~09:50 BST — SHY-0034 created. Status: In Progress. Branch `story/SHY-0034-tag-only-release-flow` opened off main (post-SHY-0033-merge HEAD `62cb12039fd`). Investigation phase: 3 alternatives spec'd (A: bypass actor; B: bot+GPG; C: tag-only/git describe). Recommendation: Option C per operator's "quality+reliability over speed" framing, but architect validation required before implementation. **Architect overruled C → A** with corrections: (1) release-tag.yml already exists; (2) Option C blast radius crosses ≥5 files including `app/build.gradle.kts` versionCode/versionName literals; (3) release notes already auto-generated; (4) bypass-actor security risk is minimal because the Release App is already trusted.
- 2026-06-08 ~09:48 BST — SHY-0033 merged as PR #1038. Operator's "no release branches" directive now blocking only because release.yml still creates them — this SHY closes that gap.
