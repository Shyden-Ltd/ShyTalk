---
id: SHY-0063
status: In Progress
owner: claude
created: 2026-06-09
priority: P0
effort: S
type: bug
roadmap_ids: []
pr:
---

# SHY-0063: Fix SHY-0038 sync-roadmap-data workflow — push to main was rejected by branch-protection (signed-commit + bypass-actor missing)

## User Story

As **(a)** a ShyTalk maintainer relying on the SHY → `public/roadmap-data.json` automated sync, and **(b)** an outside visitor of `shytalk.com/roadmap` seeing stale `phases[].items[]` and `currentlyWorkingOn` content, I want **the `sync-roadmap-data` workflow to actually succeed in writing its regenerated `public/roadmap-data.json` back to `main`** so that the [[feedback-stories-epics-and-two-surface-sync]] HARD rule (every SHY status flip auto-propagates to the public webpage) is actually delivered — not theoretically delivered with a broken commit-back step that silently fails every run.

## Why

SHY-0038 (PR #1044, merged 2026-06-09 01:58 BST) shipped `.github/workflows/sync-roadmap-data.yml` whose last step does:

```yaml
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add public/roadmap-data.json
git commit -m 'chore(roadmap): sync roadmap-data.json from SHY corpus'
git pull --rebase --no-edit origin main
git push origin HEAD:main
```

On the very first push-to-main trigger (the SHY-0038 squash-merge itself), the push was rejected:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 3 of 3 required status checks are expected.
remote: - Commits must have verified signatures.
remote:   Found 1 violation:
remote:   4aa1e3ce09c5ea172ac062b32d13db352f3d86a7
remote: ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
```

Root cause (3 stacked constraints from ruleset `12613584`):

1. `pull_request` requirement — direct pushes blocked unless the pusher is in `bypass_actors`. The default `github-actions[bot]` identity is NOT in the bypass list.
2. `required_signatures` — `git commit` from a workflow runner uses no GPG/SSH key, so the resulting commit is unsigned. Even if (1) were waived, (3) would block.
3. `required_status_checks` — direct pushes can't run the 3 required checks, so they'd be blocked by (3) too.

The same constraints apply to `release.yml` (SHY-0034 refactor, 2026-06-08). `release.yml` solves them by using a registered "Release" GitHub App (App ID stored in `RELEASE_APP_ID`; private key in `RELEASE_APP_PRIVATE_KEY`) that IS listed in `bypass_actors` on ruleset `12613584`, plus calling GitHub's GraphQL `createCommitOnBranch` mutation — which produces server-side **signed** commits as the App identity. That pattern satisfies all three rules in one go.

**Discovery + verification-discipline failure:** this defect was NOT surfaced before SHY-0038 merged, despite SHY-0038's own AC line 60 saying `workflow_dispatch` was added "to enable hand-firing for pre-merge testing." That step was never executed. The LOCAL `scripts/test-sync-e2e.sh` (4 steps; reviewer C4 finding) exercises only the Node script half of the workflow — not the `git push` half — so it cannot catch this class of failure. Codified second incident in [[feedback-workflow-verify-by-running]] (now STRENGTHENED 2x: PR #813 gh-api-404 + PR #1044 sync).

**Approach alternatives explored (recorded for architect/operator review):**

- **Option A — Reuse the existing Release App for `createCommitOnBranch` on the sync workflow (CHOSEN).** Add a step that mints an App-token via `actions/create-github-app-token` with the same `RELEASE_APP_ID`/`RELEASE_APP_PRIVATE_KEY` secrets, then replaces the `git commit` + `git push` with a GraphQL `createCommitOnBranch` mutation. Pros: matches `release.yml` proven pattern; no new App registration; signed commits via App identity; no new secrets; no ruleset change. Cons: conceptual concern-mixing (Release App now also writes sync commits).
- **Option B — Provision a dedicated "Sync GitHub App" with its own `bypass_actors` entry.** Pros: separation of concerns; per-workflow audit trail; least-privilege scoping. Cons: requires operator-side setup (new App registration on github.com, secret provisioning, ruleset update at github.com/Shyden-Ltd/ShyTalk/rules/12613584) — high friction for a low-novelty pattern. Captured as a future "Out of Scope" SHY-0064 if separation matters.
- **Option C — Use a PAT in `bypass_actors`.** Eliminated: PATs CANNOT produce signed commits. Ruleset rule (3) `required_signatures` would still block. Same problem the default bot token has.
- **Option D — Open a self-PR for each sync commit (workflow opens PR → auto-merge fires).** Eliminated on TWO counts: (i) doesn't solve signed-commits — squash-merge subject is signed by GitHub, but only when the actor doing the merge satisfies the `required_signatures` rule on the squash commit; the auto-merge actor here is still the bot. (ii) every sync = a new PR = full CI run (~70min). $0-tier cost concern + noise explosion. Inverts the "automated invisible sync" value-prop.
- **Option E — Refactor to commit-on-source-PR instead of main.** Eliminated: the trigger is `push: main` — there is no "source PR" once the SHY-0038 merge has happened. The sync runs in response to merged-to-main events, not PR events.
- **Option F — Drop the auto-commit; have the renderer read SHYs directly at request-time.** Eliminated under SHY-0038's already-decided Option E rejection ("anonymous GH API rate limit (60 req/hr/IP) breaks the page at scale"). Same problem applies to having the page read `.md` files directly.

**Operator-anchored constraints (still in force):**

- `quality + reliability + free cost > speed` ([[feedback-quality-explore-alternatives-validate]]).
- `every SHY status flip MUST sync to the public webpage; automated; never manual-edit the surfaces` ([[feedback-stories-epics-and-two-surface-sync]]).
- `One active branch` ([[feedback-one-active-branch-close-on-finish]]). SHY-0061 + SHY-0062 deferred until this lands.
- `Reviewer BEFORE push` ([[feedback-reviewer-before-push-not-parallel]]). One cycle. Apply all in one batch.
- `Dispatch any main-mutating workflow BEFORE flipping the SHY to Done` ([[feedback-workflow-verify-by-running]], STRENGTHENED 2x). This SHY's own DoD enforces this in `### Definition of Done` below.

## Acceptance Criteria

### Happy path

- [ ] `.github/workflows/sync-roadmap-data.yml` no longer contains `git push origin HEAD:main` or `git config user.name 'github-actions[bot]'` for the commit-back step. Replaced by a step that mints an App token via `actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0` (same SHA-pin used in `release.yml`) using `client-id: ${{ secrets.RELEASE_APP_ID }}` + `private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}`.
- [ ] The commit-back step uses GitHub's GraphQL `createCommitOnBranch` mutation (via `gh api graphql --input -`) with:
  - `branch: { repositoryNameWithOwner: $repo, branchName: 'main' }`
  - `expectedHeadOid: $parent_sha` (optimistic concurrency)
  - `fileChanges.additions[0]: { path: 'public/roadmap-data.json', contents: <base64-encoded file content> }`
  - `message.headline: 'chore(roadmap): sync roadmap-data.json from SHY corpus'`
- [ ] If `git diff --quiet public/roadmap-data.json` shows no diff post-regen, the workflow exits 0 with log `[sync] no changes — public/roadmap-data.json is up to date` (preserves the existing no-op fast path; do not call the mutation for an empty diff).
- [ ] On a successful mutation, the workflow logs `[sync] signed commit <oid> on main` and writes a `$GITHUB_STEP_SUMMARY` block with: workflow run-id, parent SHA, new commit OID, file path, byte count.
- [ ] The actor loop-guard (`if: github.actor != 'github-actions[bot]'`) is preserved as the OUTER skip for the bot's own push event. The inner condition still applies even when the App writes (the App's commit fires a new `push` event whose `github.actor` is the App, not `github-actions[bot]`; per SHY-0034 Notes for the Release App, GitHub records the App's bot-account as the actor — we update the guard accordingly: `if: github.actor != 'github-actions[bot]' && github.actor != 'shytalk-release-bot[bot]'` — verified by reading the Release App's bot account name from the most recent `release.yml` run; placeholder until confirmed in implementation).
- [ ] `actions/checkout` step's `token: ${{ secrets.GITHUB_TOKEN }}` is replaced with the App token (so the local working copy is read with the same identity that pushes — keeps blame attribution coherent in audit logs).

### Error paths

- [ ] If the App-token step fails (missing secret, App revoked, key rotated incorrectly), the workflow exits non-zero at THAT step with the action's own error message. NO partial commit is written. NO downstream JSON regen runs.
- [ ] If `createCommitOnBranch` returns a GraphQL error (e.g. `expectedHeadOid` mismatch when another commit landed between checkout and mutation), the workflow exits 1, logs `::error::createCommitOnBranch mutation failed — response below.` followed by `jq .` of the response, and DOES NOT retry silently. The operator + next workflow trigger naturally re-runs against the new HEAD.
- [ ] If `jq -n --rawfile c1 public/roadmap-data.json '...'` fails (e.g. file deleted between regen + base64 encoding), the workflow exits 1 with `set -euo pipefail` propagating the failure.
- [ ] If the mutation succeeds but the response body is empty/null (anomalous; theoretically impossible per the GraphQL schema but defensively guarded the same way `release.yml` does), the workflow exits 1 — see step-output capture pattern in `release.yml:391-395`.
- [ ] If the `github.actor` of the trigger event is the Release App's bot account (post-sync auto-fire from the App's own commit), the workflow MUST skip — verified by a Jest assertion that the `if:` includes both `github-actions[bot]` AND `shytalk-release-bot[bot]` (or whatever the App account turns out to be).

### Edge cases

- [ ] **Concurrent commits on main:** between this workflow's `git rev-parse HEAD` and the `createCommitOnBranch` mutation, another commit may land (Dependabot merge, release commit, manual merge). The mutation's `expectedHeadOid` guards this: it fails LOUD with a conflict error, this workflow exits 1, and the NEXT `push: main` event re-fires the workflow against the new HEAD. The regen is idempotent so retrigger Just Works™ — no manual recovery needed.
- [ ] **Multiple SHY changes in one PR squash:** the squash-merge of a single PR may touch N SHY `.md` files. The Node script handles this (it scans the whole `.project/stories/**` corpus on every run); the GraphQL mutation only ever commits the SINGLE regenerated `public/roadmap-data.json`. Verified by a Jest test asserting the additions array has exactly one entry.
- [ ] **Empty SHY corpus during a transient state:** if the corpus is somehow empty (e.g. mid-rebase), the regen would produce a valid-but-empty JSON. The diff-check fast-path skips the commit. Verified by a Jest test feeding an empty fixture directory + asserting `[sync] no changes` log line + no mutation called.
- [ ] **workflow_dispatch manual trigger:** the App-token step still runs; the mutation still fires; the `expectedHeadOid` is the current HEAD of main when the action checks out. Tested by manual dispatch as part of the verification step in DoD.
- [ ] **Sync workflow file itself modified:** the trigger path includes `.github/workflows/sync-roadmap-data.yml` (per SHY-0038 line 25). After this SHY merges, the FIRST run of the new code will be the run triggered by THIS SHY's squash-merge — i.e. self-bootstrapping. Verified by post-merge dispatch (DoD).

### Performance

- [ ] Wall-clock budget: ≤ 30 seconds from `Regenerate roadmap-data.json` step start to `createCommitOnBranch` mutation completion (the previous broken `git push` was ~2s; GraphQL mutation adds ~1s; full regen takes ~150ms per `release.yml` historical timings — total stays well under 5s of additional latency vs the failed prior run).
- [ ] No extra `actions/checkout` step is needed — the workflow keeps its single SHA-pinned checkout. App-token mint is fast (~1s).

### Security

- [ ] `RELEASE_APP_ID` + `RELEASE_APP_PRIVATE_KEY` secrets are referenced via `${{ secrets.* }}` — never echoed, never logged. Confirmed by a Jest assertion that the YAML does not contain `echo` / `set -x` near the secret-using steps.
- [ ] The Release App's permissions on the repo (per SHY-0034) include `contents: write`; no broader scopes are needed for this commit-back step. Audited + documented in `## Dependencies` below.
- [ ] No new path-restricted bypass-actor entries are created on ruleset `12613584` — the existing Release App entry already covers `contents: write` on `main`. Confirmed by `gh api repos/Shyden-Ltd/ShyTalk/rules/branches/main` post-merge (manual; recorded in PR description).
- [ ] The signed-commit guarantee is preserved (the App-signed commit IS verified). `git log --show-signature -1` on main after the post-merge dispatch records `Good "github" signature for <App's noreply>`.

### UX

N/A — internal CI infrastructure with no user-facing surface. The downstream effect is that `shytalk.com/roadmap` content stays fresh (positive UX), but this SHY does not change any rendering — only restores the data-write half of an already-built pipeline. SHY-0061 will pick up the renderer half.

### i18n

N/A — no user-facing strings introduced. The sync produces no localised content; it only writes the JSON data file. The existing 20-locale `legal-translations.js` is not touched.

### Observability

- [ ] Workflow step summary (`$GITHUB_STEP_SUMMARY`) gains a sync-result table per run: parent SHA, new commit OID (or `(no change — fast-path)`), additions byte-count, regen wall-clock ms. Matches the `release.yml:402-414` audit-trail pattern.
- [ ] The workflow's `concurrency.group` stays `sync-roadmap-data-${{ github.ref }}` (unchanged from SHY-0038). The `cancel-in-progress: false` setting is preserved (we want serial runs, not cancellation of in-flight syncs).
- [ ] Log line `[sync] signed commit <oid> on main` is the post-success grep-anchor for any future incident triage. Documented in CLAUDE.md's "Tooling" subsection (small edit).

## BDD Scenarios

**Scenario: SHY status flip propagates to public/roadmap-data.json on main**

- **Given** a SHY's frontmatter is changed (e.g. `status: In Progress` → `Done`) and merged to `main` via a squash-merge PR
- **When** the `sync-roadmap-data.yml` workflow runs on the `push: main` event
- **Then** the App-token step mints a token for the Release App
- **And** the regen step runs the Node script and produces a non-empty diff vs the current `public/roadmap-data.json`
- **And** the `createCommitOnBranch` mutation completes successfully
- **And** a signed commit by the Release App identity lands on `main` carrying ONLY the updated `public/roadmap-data.json`
- **And** the workflow exits 0 with `[sync] signed commit <oid> on main` logged

**Scenario: No-op fast-path when SHY changes don't affect public surfacing**

- **Given** a SHY's frontmatter is changed but the change is to an internal-only field (e.g. `owner` or `notes`) on a SHY with `public: false`
- **When** the workflow runs on push-to-main
- **Then** the Node script regen produces a JSON byte-identical to the current `public/roadmap-data.json` (deterministic; smart-timestamp from SHY-0038 ensures `generatedAt` is reused)
- **And** `git diff --quiet public/roadmap-data.json` exits 0
- **And** the workflow logs `[sync] no changes — public/roadmap-data.json is up to date`
- **And** the App-token mint step does NOT run (or runs but the mutation is skipped — either ordering is acceptable; the test asserts the mutation step is `if: <changed-condition>`)
- **And** the workflow exits 0 in under 10 seconds total

**Scenario: Loop guard prevents re-fire on App's own commit-back**

- **Given** the sync workflow has just successfully pushed `chore(roadmap): sync...` to main via the App
- **And** GitHub fires a new `push: main` event for that commit
- **When** the workflow attempts to start
- **Then** the job-level `if: github.actor != 'github-actions[bot]' && github.actor != 'shytalk-release-bot[bot]'` evaluates false
- **And** the run is skipped at the job level with no Node execution

**Scenario: Concurrent main-mutation loses the mutation race**

- **Given** the workflow has checked out main at SHA `A` and regenerated the JSON
- **And** a separate commit lands on main between checkout and mutation, advancing HEAD to SHA `B`
- **When** the `createCommitOnBranch` mutation fires with `expectedHeadOid: A`
- **Then** the mutation returns a conflict error
- **And** the workflow exits 1 with the response printed via `jq .`
- **And** a fresh `push: main` event for SHA `B` queues a new run that succeeds against the new HEAD

## Test Plan

### Red (new tests added FIRST that fail against the current `sync-roadmap-data.yml`)

- `express-api/tests/scripts/sync-roadmap-data-workflow.test.js`:
  - **new case** `uses Release App createCommitOnBranch (not git push)`: parse YAML, assert `git push origin HEAD:main` is ABSENT and `createCommitOnBranch` appears in at least one step's `run:` body. FAILS today.
  - **new case** `mints an App token via create-github-app-token v3.2.0 SHA-pin`: assert step `uses` matches `actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1`. FAILS today.
  - **new case** `references both RELEASE_APP_ID and RELEASE_APP_PRIVATE_KEY secrets`. FAILS today.
  - **new case** `actor-guard includes both bot accounts`: assert `if:` contains both `'github-actions[bot]'` AND the Release App bot string. FAILS today.
  - **new case** `no echo near secret env`: assert no `echo "$GH_TOKEN"` or `set -x` in steps with `env:` referencing the App token. PASSES today (no such echo exists); kept as regression guard.
  - **new case** `expectedHeadOid is parsed from local HEAD`: assert the mutation payload references the SHA via `$PARENT_SHA` or `$(git rev-parse HEAD)`. FAILS today.

### Green (refactor `sync-roadmap-data.yml` until all red tests pass)

- Replace `Commit + push if changed` step with two new steps:
  1. `Generate app token` — `uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1` (same SHA as `release.yml`). Outputs `token`.
  2. `Commit signed roadmap update via GraphQL` — bash with `set -euo pipefail`. Diff-check fast-path. `jq` to build base64-encoded additions array. `gh api graphql --input -` with the same mutation shape as `release.yml`. Logs + step summary.
- Update job-level `if:` to include the App bot account.
- Replace `token: ${{ secrets.GITHUB_TOKEN }}` on the checkout with the App token.
- Run the full Jest suite locally: `cd express-api && npm test`. All 11k+ tests pass; the 6 new SHY-0063 cases pass.

### Live verification (BLOCKS marking SHY-0063 Done per [[feedback-workflow-verify-by-running]] STRENGTHENED rule)

1. Merge PR.
2. Confirm the `push: main` event fires `sync-roadmap-data.yml`.
3. Open the workflow run; observe step exits + `[sync] signed commit <oid> on main` log line.
4. Run `git log --show-signature -1 origin/main` and verify the commit is App-signed.
5. Pull main; open `public/roadmap-data.json`; verify SHY-0038 + SHY-0060 + SHY-0063 (this very PR) now appear in `phases[].items[]` / `currentlyWorkingOn` as appropriate.
6. ALSO trigger `gh workflow run sync-roadmap-data.yml` manually post-merge and verify the no-op fast-path runs in ~1s.
7. If ANY step fails: re-open with a hotfix commit on a new SHY-0063 follow-up branch (do NOT amend the merged PR).

## Out of Scope

- **SHY-0061 (renderer reads `items[]`)** — restored as the next SHY in the queue once this is verified live. Not bundled (1-PR-1-SHY rule).
- **SHY-0062 (legacy `features[]` → SHYs migration)** — depends on SHY-0061.
- **Provisioning a dedicated "Sync GitHub App"** (Option B from `## Why`). The Release App reuse is the right call for now; if audit-log noise becomes a problem later, file SHY-0064.
- **Optimising `sync-stories-to-issues.sh`** — that's SHY-0040, unrelated to the roadmap-data workflow.
- **Allure report CI-time reduction** — SHY-0038's `## Open questions for operator` item #3, separate cost-optimisation concern.
- **Status flips for SHY-0038 + SHY-0061 + SHY-0062 frontmatter** — SHY-0038's pending flip (per its handoff `Pending status flips` list) WILL roll into THIS PR per the established pattern, but the SHY-0061/SHY-0062 flips remain pending under their own future SHYs.

## Dependencies

**Existing infrastructure (verified present):**

- `RELEASE_APP_ID` repository secret — exists; used by `release.yml:67`. The same value is reusable here.
- `RELEASE_APP_PRIVATE_KEY` repository secret — exists; used by `release.yml:68`. Same private key reusable.
- Release GitHub App registered on the Shyden-Ltd org (App ID `29110` per `release.yml:32` comment) with `contents: write` permission on the ShyTalk repo. Reused as-is.
- Ruleset `12613584` on `main` — has the Release App in `bypass_actors` (per SHY-0034 architecture, `release.yml:32-38`). No ruleset modification needed.

**Auth-chain walk-through (per [[feedback-workflow-verify-by-running]] STRENGTHENED rule):**

- Workflow job runs as default `GITHUB_TOKEN` initially → mints Release App token via `create-github-app-token` (input: `client-id` + `private-key` secrets) → all subsequent steps use the App token → `gh api graphql` mutation runs under App identity → mutation server-side records the commit author as `Release App` and signs with GitHub's `github` GPG key (verified-signature satisfied) → branch-protection ruleset checks the actor → App is in `bypass_actors` → write permitted → commit lands on main.

**New dependencies introduced by this SHY:** none. Pure reuse of existing infrastructure.

**Verifiable pre-conditions before marking SHY-0063 Done:**

- `gh api -H "Accept: application/vnd.github+json" /repos/Shyden-Ltd/ShyTalk/actions/secrets | jq '.secrets[].name' | grep -E '^"RELEASE_APP_(ID|PRIVATE_KEY)"$'` returns both names. (Can't read values; existence is enough.)
- The most recent `release.yml` run (any) succeeded — proves the App + ruleset wiring is currently functional.

## Risks & Mitigations

- **Risk:** The Release App bot account name in `github.actor` isn't `shytalk-release-bot[bot]` as I'm guessing; the actor-guard fails to skip on the App's own commit-back and the workflow loops forever.
  - **Mitigation:** confirm the actor string by reading any successful `release.yml` run via `gh run view <id> --json triggeringActor` BEFORE finalising the guard. If wrong, fix the string in this PR. Also add a hard backstop: the no-op fast-path (`git diff --quiet`) will trip on the second run (App commit produces identical content) and exit 0 with no further mutation — even if the actor-guard string is wrong, the loop bottoms out in ~1 wall-clock cycle, not infinite.
- **Risk:** App permission scope is insufficient for writing arbitrary paths (e.g. App is scoped to `app/build.gradle.kts` + release-notes only).
  - **Mitigation:** GitHub Apps grant permissions at REPO scope, not path scope. The App's `contents: write` covers all files in the repo. Verified by reading the App's manifest in the operator's GitHub Apps settings. If wrong, escalate to operator for App-permission update.
- **Risk:** Reusing the Release App for sync mixes concerns; future audit-log review might struggle to distinguish "release" vs "sync" commits.
  - **Mitigation:** commit message prefix is canonical — release commits are `chore: release vX.Y.Z`; sync commits are `chore(roadmap): sync roadmap-data.json from SHY corpus`. `git log --grep` filters reliably. If audit-noise grows beyond tolerance, SHY-0064 separates into a dedicated Sync App.
- **Risk:** Operator-managed prerequisite (ruleset bypass-actor entry) drifts: e.g. App removed from ruleset by a future security-tightening PR. Sync silently breaks again.
  - **Mitigation:** add a sentinel Jest test that scans the workflow file for the presence of `createCommitOnBranch` + the App-token step + the App-secret references. If a future maintainer rips them out, CI fails loud. This doesn't catch ruleset drift on GitHub's side, but it does prevent the workflow from reverting to a broken state.
- **Risk:** The post-merge dispatch verification (per DoD) reveals ANOTHER class of failure not anticipated by static review.
  - **Mitigation:** this risk is the whole point of [[feedback-workflow-verify-by-running]]. If a new failure is found, fix it in a same-session follow-up PR (SHY-0063 stays Open until verified green); per [[feedback-fix-pre-existing-and-new-same]] no deferral.

## Definition of Done

- [ ] All AC bullets checked (`### Happy path`, `### Error paths`, `### Edge cases`, `### Performance`, `### Security`, `### Observability`).
- [ ] All 6 new red-then-green Jest cases passing locally + in CI.
- [ ] `actionlint` + `scripts/check-action-shas.sh` + `scripts/check-workflow-concurrency-scoping.sh` + `scripts/check-no-paid-runners.sh` all exit 0 on the modified workflow.
- [ ] ONE code-reviewer agent dispatch on the local commit per [[feedback-reviewer-before-push-not-parallel]]; ALL findings applied in one batch per [[feedback-rate-limit-slowdown-strategies]].
- [ ] PR pushed; CI 3/3 required checks green (Lint / Tests / SonarCloud).
- [ ] Auto-merge armed AFTER reviewer reports ZERO findings (per [[feedback-auto-merge-race-with-reviewer]]); PR title is the canonical `SHY-0063: <title>` (per [[feedback-update-pr-title-before-promote]]).
- [ ] PR squash-merges to main.
- [ ] **LIVE DISPATCH VERIFICATION (BLOCKS Done):**
  - [ ] On merge, the `push: main` event fires `sync-roadmap-data.yml`.
  - [ ] The run completes successfully (exit 0).
  - [ ] `git log --show-signature -1 origin/main` shows the App-signed commit (or `gh run view <id> --json conclusion` returns `success` + grep the log for `[sync] signed commit <oid> on main`).
  - [ ] `public/roadmap-data.json` post-pull contains SHY-0038, SHY-0060, AND SHY-0063 entries in `phases[].items[]` / `currentlyWorkingOn` per their public-surfacing rules.
  - [ ] `gh workflow run sync-roadmap-data.yml` manual dispatch ALSO succeeds (no-op fast-path).
  - [ ] If ANY of the above fail: SHY-0063 status STAYS `In Review`; a new follow-up SHY-0064 is filed and worked same-session per [[feedback-fix-pre-existing-and-new-same]].
- [ ] SHY-0038 frontmatter updated with `pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1044` (administrative metadata only; status flip to Done is release-gated per [[feedback-done-equals-release-cut]] and waits for the next `release.yml vX.Y.Z` run).
- [ ] `.project/stories/SHY-INDEX.md` adds SHY-0063 to Active. SHY-0038 stays in Active until the next release flips both SHYs to Done together via the `released_in: vX.Y.Z` tag-back chore PR.
- [ ] **`status: Done` for SHY-0063 itself is NOT set in this PR.** Per [[feedback-done-equals-release-cut]] (operator 2026-06-09 ~09:40 BST): merge alone is insufficient. SHY-0063 enters "Merged, awaiting release" state on squash-merge (frontmatter `status:` remains `In Progress` until the validator formalises `Merged` under SHY-0064; the `## Notes` log captures the merge fact + commit SHA). The next operator-triggered `release.yml` run flips SHY-0063 to `Done` + sets `released_in: vX.Y.Z`.
- [ ] `## Notes` log on this SHY captures: original sync failure run-id, root-cause analysis, reviewer cycle findings (verbatim per [[feedback-cross-session-continuity-rigor]]), live-dispatch verification run-id + observed signed-commit OID.

## Notes (running log)

**2026-06-09 02:00 BST — SHY-0038 sync workflow ran on merge of PR #1044 (squash-merge sha 5f45dcc).** Workflow run ID 27176921623. Conclusion: failure. Failure step: `Commit + push if changed`. Failure reason: `GH013: Repository rule violations found for refs/heads/main` listing three rule violations (`pull_request` requirement, 3-of-3 status checks, `required_signatures`). Bot's regen commit OID `4aa1e3ce09c5ea172ac062b32d13db352f3d86a7` rejected by branch-protection.

**2026-06-09 ~09:18 BST — Session resumed.** Operator selected SHY-0061 (renderer change) as next pickup; pre-flight inspection of `public/roadmap-data.json` showed all `phases[].items[]` empty + `currentlyWorkingOn` missing SHY-0038 (which is `public: true + status: In Progress`). Investigation of the sync workflow run-id 27176921623 surfaced the root-cause above. Pivoted SHY-0061 → SHY-0063 (operator-directed via AskUserQuestion 09:24 BST).

**2026-06-09 ~09:30 BST — Verification-discipline failure acknowledged.** Operator (verbatim): _"if you have been verifying your work correctly, this would have been found earlier without a new ticket being started"_. SHY-0038's own AC line 60 said `workflow_dispatch` was "for pre-merge testing" — never executed. Codified as second incident in `[[feedback-workflow-verify-by-running]]`. SHY-0063's DoD now embeds explicit post-merge dispatch verification BLOCKING the live-function gate.

**2026-06-09 ~09:45 BST — New lifecycle rule (`Done = release cut`) landed mid-PR.** Operator (verbatim): _"tickets should only be marked as 'done' when a release has been cut. therefore creating the release should be the final piece where the story ends. We should also mark the release in the story so we can easily see if it's live in prod or not"_. Scope chosen via plain-English options: **Unified release tag** — every SHY waits for next `release.yml vX.Y.Z` run regardless of type. Codified as `[[feedback-done-equals-release-cut]]`. **Impact on this SHY:** SHY-0063 merges in this PR but DOES NOT flip Done. It enters "Merged, awaiting release" (held as `status: In Progress` in frontmatter until SHY-0064 formalises the `Merged` state value). The next operator-triggered `release.yml` will produce vX.Y.Z; Claude monitors that run, captures the tag, then flips SHY-0063 (and SHY-0038, and any other since-v0.97.7 merges) to `Done` + sets `released_in: vX.Y.Z` via a `chore/tag-release-vX.Y.Z` follow-up PR.

**2026-06-09 ~09:55 BST — Framework formalisation deferred to SHY-0064.** Per [[feedback-one-active-branch-close-on-finish]] HARD rule + [[feedback-rate-limit-slowdown-strategies]] one-PR-one-SHY discipline, SHY-0063 stays narrowly the sync-workflow fix. SHY-0064 (filed in the next session) will: (a) add `Merged` to the validator's accepted state values; (b) add the `released_in: vX.Y.Z` frontmatter field (pattern `^v[0-9]+\.[0-9]+\.[0-9]+$`, required when `status: Done`); (c) update CLAUDE.md `## Agile Way of Working > Lifecycle` to reflect the release-gated Done; (d) backfill the 9 existing Done SHYs (SHY-0001/0002/0003/0032/0033/0034/0035/0036/0037) that predate this rule — operator decides between re-flipping to Merged for inclusion in next release vs grandfathering with `released_in: pre-rule` sentinel; (e) document the release-monitoring + auto-tag procedure.

**2026-06-09 09:08:16Z — PR #1045 squash-merged.** Merge commit `1ed6fc8e04f9aae2fbdd2faba0533ebc19a83fee`. Per `[[feedback-done-equals-release-cut]]` the SHY stays at `status: In Progress` ("Merged, awaiting release") until the next operator-triggered `release.yml vX.Y.Z` flip.

**2026-06-09 ~10:25 BST — Post-merge live-verify gate FAILED.** sync-roadmap-data.yml run `27195846958` on the merge commit exited 126 with `/usr/bin/jq: Argument list too long` on the second `jq -n --argjson additions "$ADDITIONS"` invocation. Root cause: 177KB `public/roadmap-data.json` → ~237KB base64 → exceeded Linux runner's effective ARG_MAX when passed as a jq argv string. The two-step jq pattern was mirrored verbatim from `release.yml` but `release.yml`'s files total ~14KB base64 so the pattern never hit the limit there. This is the THIRD documented incident of `[[feedback-workflow-verify-by-running]]` catching a defect that all static gates passed (PR #813 gh-api-404 → PR #1044 signed-commit → PR #1045 jq ARG_MAX). The DoD's live-verify gate worked exactly as designed. Filed **SHY-0064** as the hotfix per `[[feedback-fix-pre-existing-and-new-same]]` + the explicit DoD escalation rule. Fix: combine both jq invocations into ONE that constructs additions inline via `--rawfile + ($c1|@base64)`; the only large value is PAYLOAD which pipes to `gh api graphql --input -` via stdin (no argv limit). Local dry-run pre-push verified the new pipeline produces a valid 237KB JSON payload — the verification step that should have been part of SHY-0063 itself.

**2026-06-09 ~10:05 BST — Code-reviewer agent `a0530c52e4032cb9a` returned 2 actionable findings on local commit `5e029bc196c`** (1 Critical, 1 Important, 1 Verified-clean noted as I2). Applied BOTH in this batch per [[feedback-100-percent-clean-reviews]] + [[feedback-rate-limit-slowdown-strategies]] (ONE cycle, no iterate-to-ZERO).

- **C1 (Critical, confidence 90)** — _Cross-workflow SHA parity is claimed in the comment but not enforced by the test_. The single-workflow assertion at `sync-roadmap-data-workflow.test.js` only hardcodes the expected SHA against `sync-roadmap-data.yml`; it never reads `release.yml`. If a future Dependabot or manual bump updates only one of the two workflows, the silent drift would go undetected. **Resolution:** added a new Jest test `SHY-0063: create-github-app-token SHA matches release.yml exactly (cross-workflow parity)` that reads both files via `fs.readFileSync`, extracts the App-token SHA via a single regex, and asserts byte-equality. Kept the existing hardcoded-SHA test as the known-good locked baseline. Future bumps must update BOTH workflows atomically or this test fails fast.
- **I1 (Important, confidence 82)** — _`git diff --quiet <path>` exits non-zero when the file is absent, causing a cryptic `set -euo pipefail` early-exit_. If the regen script silently fails without producing `public/roadmap-data.json`, the next step's diff guard aborts the run with no useful error. **Resolution:** added a `[ ! -f public/roadmap-data.json ]` existence check at the top of the commit-back step's `run:`, before the diff. If absent, the workflow emits `::error::public/roadmap-data.json was not produced by the sync script — aborting.` and exits 1. Locked into the contract via a new Jest assertion `SHY-0063 (I1 from reviewer): file-absent guard precedes the diff`.
- **I2 (Verified-clean, confidence 85)** — `client-id` field name on `actions/create-github-app-token` was verified against the proven `release.yml` pattern; same field in both. No action needed; flagged for completeness.
- **Edge-case gap (confidence 65)** — _Partial-success GraphQL shape (`{ data: null, errors: [...] }`) not explicitly asserted_. Existing `// empty` jq fallback handles it correctly (proven in `release.yml`); explicit assertion deferred — the existing `if [ -z "$COMMIT_OID" ]` guard at runtime is the canonical defense. Reviewer-low-confidence + no real-world incident → not worth a brittle fixture test.

Jest count: 28 (was 26; +2 new cases for C1 + I1). All green. Workflow checkers all clean. The new commit (this one) is the local push candidate.

— EOF for now; post-merge + release-tag entries will land in this section as they happen.
