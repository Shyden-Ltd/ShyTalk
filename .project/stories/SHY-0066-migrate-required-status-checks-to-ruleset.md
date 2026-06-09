---
id: SHY-0066
status: In Progress
owner: claude
created: 2026-06-09
priority: P0
effort: XS
type: infra
roadmap_ids: []
pr:
---

# SHY-0066: Migrate `required_status_checks` from classic branch protection to ruleset 12613584 (unblock sync + release main-mutating workflows)

## User Story

As **(a)** the operator depending on `release.yml` to ship App releases and `sync-roadmap-data.yml` to keep the public roadmap fresh, I want **the `required_status_checks` enforcement on `main` to live in ruleset 12613584 (where the Release App's `bypass_actors` entry actually applies)** so that the two main-mutating workflows that have been architected around `createCommitOnBranch` (SHY-0034 release + SHY-0038/0063/0064 sync) can actually do what they were designed to do — write App-signed commits directly to `main` — without being silently rejected by classic branch protection's no-bypass layer.

## Why

After SHY-0064 merged, the post-merge `sync-roadmap-data.yml` run (id `27198217568`) FAILED with:

```
gh: Repository rule violations found
3 of 3 required status checks are expected.
```

The SHY-0064 jq-ARG_MAX fix DID work — the mutation was reached and called. But the GraphQL `createCommitOnBranch` call was rejected because of an unbypassed `required_status_checks` rule.

**Diagnosis** (`gh api`):

- **Ruleset 12613584** (`name: main`, `enforcement: active`) has `bypass_actors: [{actor_id: 29110, actor_type: Integration, bypass_mode: always}, {actor_id: 3324562, ...}]`. App 29110 is the Release App. Rules: `deletion`, `non_fast_forward`, `pull_request`, `required_signatures`. **No `required_status_checks` rule.**
- **Classic branch protection** on `main` (the legacy system that predates rulesets): `required_status_checks: { strict: false, contexts: ["Detect Changes", "Analyze JavaScript", "PR Gate"], checks: [{context, app_id: 15368}*3] }`, `enforce_admins: true`. **Has the `required_status_checks` rule.**

Classic branch protection has NO `bypass_actors` concept — only rulesets do. The Release App correctly bypasses everything in ruleset 12613584, but the classic-protection layer still enforces. `enforce_admins: true` means even admins must satisfy. Result: every attempt to write directly to `main` (whether by the Release App via GraphQL `createCommitOnBranch` or any other path) is blocked.

**Latent scope:** this affects BOTH main-mutating workflows:

- `sync-roadmap-data.yml` (SHY-0038/0063/0064) — already actively failing as of run 27198217568.
- `release.yml` (SHY-0034) — has NEVER been exercised in production (last release was v0.97.7 on 2026-05-25, pre-SHY-0034). The next operator-triggered release would hit the same wall.

**Operator authorisation:** 2026-06-09 ~11:15 BST via plain-English options. Chosen: Option 1 — _migrate `required_status_checks` from classic protection to ruleset 12613584_ (smallest viable fix). Alternatives weighed:

- **Disable `enforce_admins`** — broader-privilege approach; weakens enforcement for any actual admin; rejected.
- **Architectural redesign** (drop auto-commit-to-main; use Pages artifact for sync) — large refactor; reserved as last resort.
- **Pause sync work** — doesn't actually help; problem is server-side branch protection, not the trigger.

## Acceptance Criteria

### Happy path

- [ ] Ruleset 12613584 has a new rule: `{ type: "required_status_checks", parameters: { required_status_checks: [{context: "Detect Changes", integration_id: 15368}, {context: "Analyze JavaScript", integration_id: 15368}, {context: "PR Gate", integration_id: 15368}], strict_required_status_checks_policy: false, do_not_enforce_on_create: false } }`.
- [ ] Ruleset 12613584's `bypass_actors` list is unchanged (still includes Release App 29110 + secondary App 3324562 with `bypass_mode: always`).
- [ ] Ruleset 12613584's other 4 rules (`deletion`, `non_fast_forward`, `pull_request`, `required_signatures`) are unchanged.
- [ ] Classic branch protection on `main` returns `required_status_checks: null` (the rule moved out).
- [ ] Classic branch protection on `main` preserves: `enforce_admins: true`, `required_pull_request_reviews: null`, `restrictions: null`, `allow_force_pushes: false`, `allow_deletions: false`.
- [ ] PR creation contracts unchanged for normal contributors — PR Gate / Detect Changes / Analyze JavaScript still REQUIRED before squash-merge can fire.
- [ ] A manual `gh workflow run sync-roadmap-data.yml` from `main` succeeds with `[sync] signed commit <oid> on main` in the log AND a new App-signed commit lands on origin/main.
- [ ] CLAUDE.md `## Git Rules` section gains a one-paragraph note describing the protection model (ruleset 12613584 = source of truth; classic protection = empty husk to be removed eventually).

### Error paths

- [ ] If the `gh api -X PUT` to add the rule fails partway (rule added but classic-DELETE not yet run), the worst-case is that the rule is enforced on BOTH layers — PRs still get blocked on the same checks (no false-positives); operator can re-run the DELETE to clean up. No data loss.
- [ ] If the classic-DELETE succeeds but the ruleset PUT had earlier failed for any reason, the rule is enforced on NEITHER layer — PRs could squash-merge without status checks. Reversible by re-adding to classic via the same API.
- [ ] If verification (manual workflow_dispatch) fails after the migration with the same `required_status_checks` error: the migration didn't take effect; investigate ruleset cache (~30s propagation delay) before declaring real failure.

### Edge cases

- [ ] **Existing open PRs:** the new ruleset rule applies immediately. Any open PR (e.g. this SHY-0066 PR once pushed) must satisfy the 3 contexts to squash-merge — same as before. No regression for in-flight work.
- [ ] **Dependabot PRs:** unaffected. Status checks still run + still required to merge.
- [ ] **Repo-Admin bypass:** the ruleset's `bypass_actors` is the only escape hatch. The 2 Integration App IDs (29110 + 3324562) retain it. No human admin needs to bypass.
- [ ] **Future `required_status_checks` updates** (e.g. adding a new required context): now done via ruleset API, not classic protection API. Update the SHY-0066 docs to reflect the canonical path.

### Performance

N/A — protection rules evaluate server-side per push event in ~1-10ms. Migration is a one-time API call pair.

### Security

- [ ] **No weakening of PR enforcement** — the same 3 contexts (`Detect Changes`, `Analyze JavaScript`, `PR Gate`) remain REQUIRED for PR squash-merge. PRs still need all green to merge.
- [ ] **Bypass surface is unchanged** — only the 2 Integration App IDs (Release App + the other one) can bypass. No new humans/Apps added.
- [ ] **`enforce_admins` semantics** — classic protection's `enforce_admins: true` no longer matters for `required_status_checks` (that rule moved). It still applies to `required_pull_request_reviews` (which is null), `restrictions` (null), and `required_signatures` (handled by ruleset). Net: enforce_admins is effectively a no-op now; could be removed in a follow-up cleanup but not in scope for this SHY.
- [ ] **Audit:** the gh-api before/after responses are captured verbatim in `## Notes (running log)` below.

### UX

N/A — internal CI/protection infrastructure. No user-facing surface.

### i18n

N/A.

### Observability

- [ ] The `## Notes` log captures the BEFORE state of both classic protection's `required_status_checks` block AND ruleset 12613584's full rules array. AFTER state captured for both.
- [ ] The manual workflow_dispatch run (verification step) is logged by run-id, conclusion, head SHA, and commit OID it produced.
- [ ] CLAUDE.md gains a permanent reference to ruleset 12613584's now-canonical role.

## BDD Scenarios

**Scenario: Sync workflow lands a signed commit on main after migration**

- **Given** the ruleset 12613584 has the new `required_status_checks` rule added and the Release App is in `bypass_actors: always`
- **And** classic branch protection's `required_status_checks` has been removed
- **When** `gh workflow run sync-roadmap-data.yml --ref main` is invoked
- **Then** the workflow's `Commit signed roadmap update via GraphQL createCommitOnBranch` step succeeds
- **And** a new commit by `shytalk-release-bot[bot]` lands on origin/main carrying only `public/roadmap-data.json`
- **And** `git log --show-signature -1 origin/main` shows the commit is App-signed

**Scenario: Normal PR still requires status checks**

- **Given** a contributor opens a PR against main with the 3 required checks failing (or not yet completed)
- **When** they attempt to squash-merge via `gh pr merge --squash`
- **Then** GitHub blocks the merge citing the 3 required status checks
- **And** the merge gate is identical to what it was pre-migration (the rule still applies; only its owning layer changed)

**Scenario: Release workflow's next run also succeeds**

- **Given** the migration is complete
- **When** operator triggers `release.yml` workflow_dispatch
- **Then** the `createCommitOnBranch` mutation in the `Create signed commit on main via GraphQL` step succeeds
- **And** a `chore: release vX.Y.Z` commit lands on main signed by the Release App
- **And** `release-tag.yml` fires on the push event and creates the tag

## Test Plan

### Red (operator-observable)

- BEFORE migration: `gh workflow run sync-roadmap-data.yml --ref main` → run fails with `gh: Repository rule violations found / 3 of 3 required status checks are expected` (already observed in run `27198217568`).
- BEFORE migration: ruleset 12613584 has 4 rules; classic protection has `required_status_checks` populated.

### Green (post-migration)

- `gh api repos/Shyden-Ltd/ShyTalk/rulesets/12613584 | jq '.rules | map(.type)'` returns `["deletion","non_fast_forward","pull_request","required_signatures","required_status_checks"]`.
- `gh api repos/Shyden-Ltd/ShyTalk/branches/main/protection | jq '.required_status_checks'` returns `null`.
- `gh workflow run sync-roadmap-data.yml --ref main` → run succeeds; `[sync] signed commit <oid> on main` in the log; new App-signed commit on origin/main.

### Live verification (BLOCKS Done per [[feedback-workflow-verify-by-running]])

1. Execute the migration via `gh api` (steps below).
2. Trigger the sync workflow manually.
3. Observe terminal state: `conclusion: success` + commit lands on main.
4. Verify `public/roadmap-data.json` post-pull contains the expected SHY entries (SHY-0038 + SHY-0060 + SHY-0063 + SHY-0064 + SHY-0066).
5. If failure: re-investigate; do NOT defer.

## Out of Scope

- **Cleanup of classic protection** beyond the `required_status_checks` removal — `enforce_admins: true` becomes effectively a no-op but stays; could be removed in a future SHY for tidiness.
- **SHY-0065 (release.yml single-jq refactor)** — separate concern; still needed for ARG_MAX safety when release.yml's commit files grow.
- **Status flip for SHY-0038/0060/0063/0064/0066** — release-gated per `[[feedback-done-equals-release-cut]]`.
- **A second App for sync** — could be cleaner separation-of-concerns but the Release App reuse is fine for now.

## Dependencies

- `gh auth` token must have admin perms on the Shyden-Ltd/ShyTalk repo to modify rulesets + branch protection. Confirmed: operator has the perms; my gh CLI uses operator's auth.
- Ruleset 12613584 must exist + have the Release App in bypass_actors. Confirmed via `gh api` pre-migration.
- Release App (App ID 29110) registered on Shyden-Ltd org with `contents: write`. Confirmed via SHY-0034's release.yml's documented configuration.

## Risks & Mitigations

- **Risk:** the `gh api PUT` to ruleset replaces the entire ruleset body. A wrong field name or missing field would corrupt the ruleset.
  - **Mitigation:** preserved every existing field via `jq '{name, target, enforcement, conditions, bypass_actors, rules: (.rules + [{new_rule}])}'`. Before/after `rules.length` comparison (4 → 5). Verified in Notes log.
- **Risk:** ruleset cache propagation (~30s on GitHub side) means the manual workflow_dispatch verification might still fail right after the migration.
  - **Mitigation:** wait ~30-60s after the migration before triggering. If verification fails with the same error, wait + retry once before declaring real failure.
- **Risk:** the `integration_id: 15368` for the 3 contexts might be different in the new ruleset rule (vs the classic protection's `app_id: 15368`). The two systems use the same App ID concept under different field names.
  - **Mitigation:** GitHub's docs confirm the field is `integration_id` in rulesets + `app_id` in classic protection. Both reference the same GitHub Apps API ID. Verified at migration time.
- **Risk:** the migration leaves some bypass-related capability accidentally enabled.
  - **Mitigation:** `bypass_actors` array preserved exactly; no new entries added.
- **Risk:** the operator wanted the migration but my interpretation drifts from their intent.
  - **Mitigation:** operator chose Option 1 in AskUserQuestion with the exact description: "_Add a `required_status_checks` rule to ruleset 12613584 with the same 3 contexts (Detect Changes, Analyze JavaScript, PR Gate). The Release App's existing `bypass_actors: [App 29110, bypass_mode: always]` entry will then waive the rule for both workflows. Then remove `required_status_checks` from classic branch protection._" — that's literally what this SHY implements.

## Definition of Done

- [ ] All AC bullets checked.
- [ ] Ruleset 12613584 has 5 rules including `required_status_checks` (verified via `gh api`).
- [ ] Classic protection has `required_status_checks: null` (verified via `gh api`).
- [ ] `gh workflow run sync-roadmap-data.yml --ref main` succeeded (run-id captured in Notes).
- [ ] A new App-signed commit landed on `origin/main` from that workflow run (commit OID captured in Notes).
- [ ] `public/roadmap-data.json` post-pull contains expected SHY entries (SHY-0038 + SHY-0060 + SHY-0063 + SHY-0064 + SHY-0066).
- [ ] PR opened with canonical title `SHY-0066: <Title>`; auto-merge armed; CI 3/3 required checks green; squash-merged.
- [ ] **`status:` for SHY-0066 STAYS `In Progress`** per [[feedback-done-equals-release-cut]]. Enters "Merged, awaiting release."
- [ ] `## Notes` log captures: BEFORE/AFTER ruleset state + BEFORE/AFTER classic-protection state + verification run-id + new commit OID.
- [ ] CLAUDE.md `## Git Rules` updated to note ruleset 12613584 as the canonical protection layer.

## Notes (running log)

**2026-06-09 ~10:10 BST — Post-SHY-0064 sync run 27198217568 FAILED.** Different failure mode from the SHY-0063 ARG_MAX issue: the jq pipeline worked (no more "Argument list too long"), but GitHub responded `gh: Repository rule violations found / 3 of 3 required status checks are expected`. Diagnosed via `gh api`: ruleset 12613584 has bypass_actors covering the Release App, but `required_status_checks` was enforced by **classic branch protection** (which has no bypass_actors concept). Affects both sync-roadmap-data.yml and release.yml.

**2026-06-09 ~11:15 BST — Operator chose Option 1** (plain-English options): migrate `required_status_checks` from classic protection to ruleset 12613584. Smallest viable fix; preserves all PR enforcement; the App's existing bypass entry waives it for the two main-mutating workflows.

**BEFORE state captured:**

- Classic protection `required_status_checks`:
  ```json
  {"strict": false, "contexts": ["Detect Changes", "Analyze JavaScript", "PR Gate"], "checks": [{"context": "Detect Changes", "app_id": 15368}, {"context": "Analyze JavaScript", "app_id": 15368}, {"context": "PR Gate", "app_id": 15368}]}
  ```
- Ruleset 12613584: 4 rules (`deletion`, `non_fast_forward`, `pull_request`, `required_signatures`); bypass_actors = `[{actor_id: 29110, actor_type: Integration, bypass_mode: always}, {actor_id: 3324562, actor_type: Integration, bypass_mode: always}]`.

**Migration executed via gh api:**

1. `gh api -X PUT 'repos/Shyden-Ltd/ShyTalk/rulesets/12613584' --input <new-body>` — added the `required_status_checks` rule with the same 3 contexts (integration_id 15368) + `strict_required_status_checks_policy: false`. Confirmed response: 5 rules; new rule present; bypass_actors unchanged.
2. `gh api -X DELETE 'repos/Shyden-Ltd/ShyTalk/branches/main/protection/required_status_checks'` — removed from classic protection. Confirmed response: `required_status_checks: null`.

**AFTER state captured:**

- Classic protection: `required_status_checks: null`; `enforce_admins: true`; everything else unchanged.
- Ruleset 12613584: 5 rules including the new `required_status_checks` with the 3 contexts.

**Verification — first dispatch (mutation path):**

- Run `27199389798` (workflow_dispatch on main at 10:15:32 UTC) — `conclusion: success`.
- Log line: `[sync] signed commit ce53436a6b0a246b8bc05f6e52d8d4cf19b581f8 on main`.
- Commit landed on origin/main: `ce53436a6b0a246b8bc05f6e52d8d4cf19b581f8` — author `shytalk-release-bot[bot] <274769163+shytalk-release-bot[bot]@users.noreply.github.com>`, subject `chore(roadmap): sync roadmap-data.json from SHY corpus`. Diff: `public/roadmap-data.json` +2477/−2434 lines.
- Post-pull JSON content verified: `currentlyWorkingOn: [SHY-0038, SHY-0060]` (both `public: true + status: In Progress`); `phases[0].items: [SHY-0060]` (Safety & Compliance); `phases[5].items: [SHY-0038]` (Website & Presence). `_meta: {schemaVersion: 2, shyCount: 2, epicCount: 1, generatedAt: 2026-06-09T10:15:46.815Z, generatedFrom: ".project/stories/"}`. SHY-0063/0064/0066 correctly ABSENT (internal infra, no `public: true`).

**Migration declared end-to-end functional.** The full SHY-0038 → SHY-0063 → SHY-0064 → SHY-0066 chain delivers what SHY-0038 originally promised: every SHY status flip auto-propagates to the public roadmap webpage. The sync workflow is live for the first time since the SHY-0038 attempt.

**Verification — second dispatch (no-op fast-path):**

- Run `27199521183` (workflow_dispatch on main at 10:18:13 UTC) — `conclusion: success`.
- Log lines: `[sync] regenerated public/roadmap-data.json — 2 public SHYs, 1 EPIC` then `[sync] no changes — public/roadmap-data.json is up to date`.
- No new commit on main (idempotent regen produced byte-identical output to the just-landed `ce53436a6b0`).
- Step summary shows `## Roadmap sync: no changes` block — matching SHY-0064's audit-trail design.

Both DoD live-verify gates GREEN. Migration complete + operational.

**Sibling SHY follow-ups recorded for clarity:**

- **SHY-0063 + SHY-0064** Notes logs updated to reflect that the full SHY-0038 → SHY-0063 → SHY-0064 → SHY-0066 chain is now live. All four SHYs stay `status: In Progress` per `[[feedback-done-equals-release-cut]]` until the next operator-triggered `release.yml vX.Y.Z`.
- **SHY-0065** (release.yml single-jq refactor) still pending — preventive fix only, no live bug.

CLAUDE.md `## Git Rules` updated with a new bullet codifying ruleset 12613584 as the canonical protection layer + the lesson that classic protection lacks bypass_actors.

**2026-06-09 ~11:30 BST — Stale `.husky/pre-push` hook block surfaced** during SHY-0066 commit. The hook still ran the deprecated `scripts/generate-roadmap-json.js` (pre-SHY-0038 generator) which produced old-format JSON (no `_meta`, no `items[]`) + silently amended every push, OVERWRITING the SHY-derived JSON in the working tree. Confirmed via diff: commit `b987d74ed47` accidentally rewrote `public/roadmap-data.json` to old-format shape (`currentlyWorkingOn: ['Age-gating per feature']` instead of `[SHY-0038, SHY-0060]`; no `_meta`). The post-merge workflow would have self-healed via the new sync, but the PR squash commit would have looked weird.

Operator authorised (AskUserQuestion ~11:30 BST) bundling the hook fix into SHY-0066 since: (a) the stale hook corrupted THIS very PR's diff, (b) fixing it is a 7-line surgical removal, (c) without the fix every future SHY-touching PR has the same noise. Removed the deprecated block from `.husky/pre-push` + restored `public/roadmap-data.json` to the workflow-generated SHY-derived state (origin/main's `ce53436a6b0`). Force-push not required since the restore is just a normal commit on top of the original SHY-0066 commit; squash-merge will collapse both.

— EOF.
