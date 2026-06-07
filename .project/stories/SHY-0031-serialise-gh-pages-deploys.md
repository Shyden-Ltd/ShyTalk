---
id: SHY-0031
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: S
type: infra
roadmap_ids: [G055]
pr:
---

# SHY-0031: Serialise gh-pages cross-workflow deploys (split-job + shared concurrency group)

## User Story

As the ShyTalk operator, I want **every workflow that deploys to GitHub Pages to share a single concurrency group so cross-workflow deploys are serialised**, so that two PRs landing in rapid succession (or two distinct workflows triggering simultaneous deploys) can never race and corrupt the published site.

## Why

Multiple workflows currently publish to GitHub Pages independently (the public site, the Allure report deploys, the roadmap webpage rebuild that SHY-0035 will add). Each workflow uses its OWN concurrency group (e.g. `concurrency: group: deploy-pages-${{ github.ref }}` per workflow file).

**The bug**: GitHub Pages has ONE deploy target per repo. If two workflows hit it concurrently, both push to the `gh-pages` branch (or the same artifact) in interleaved fashion — the second push wins, but its content is built from the older source. Result: stale or corrupt published site.

This was observed twice in the SHY-0032 session itself: a documentation PR's Pages deploy raced a roadmap-script PR's Pages deploy; the public page briefly showed mixed content from both.

Roadmap row G055 is a self-discovered entry (post-roadmap-generation; mentioned in [[feedback-yaml-structure-grep-tests]] context as the recurring CI flake source). The fix per the operator's earlier framing: split each Pages-deploying workflow into two jobs — a `build` job (parallelisable) and a `deploy` job (serialised via a SHARED concurrency group across all workflows).

P1 Tier-2 CI reliability — affects EVERY PR's deploy + every cron-triggered deploy. Eliminating the race eliminates a class of post-merge surprise.

## Acceptance Criteria

### Happy path

- [ ] Every workflow in `.github/workflows/` that publishes to GitHub Pages (whether via `actions/deploy-pages@*`, direct `gh-pages` branch push, or `peaceiris/actions-gh-pages@*`) is identified and refactored to the split-job pattern.
- [ ] Each refactored workflow has:
  - A `build` job that produces the artifact (no Pages writes; parallel-safe).
  - A `deploy` job that depends on `build` (`needs: [build]`) and uses the SHARED concurrency group `group: gh-pages-deploy, cancel-in-progress: false`.
- [ ] The shared concurrency group is consistent across ALL Pages-deploying workflows — verified by `grep -rn "concurrency:" .github/workflows/ | grep -i pages` showing the same group name everywhere relevant.
- [ ] `cancel-in-progress: false` ensures pending deploys queue rather than cancel (data integrity > latency).
- [ ] A new lint test in `express-api/tests/workflows/gh-pages-concurrency.test.js` asserts the invariant: every workflow that touches Pages declares the shared concurrency group on the deploy job.

### Error paths

- [ ] **Deploy job fails mid-flight** → the concurrency lock releases on failure (default behaviour); the next queued deploy starts normally; the failed deploy's PR shows the failure clearly.
- [ ] **Build job fails** → deploy doesn't run; no concurrency-lock churn.
- [ ] **Workflow added without the shared group** → the lint test fails CI before merge.
- [ ] **Two workflows accidentally use slightly-different group names** (typo: `gh-pages-deploy` vs `gh_pages_deploy`) → the lint test catches this via regex.

### Edge cases

- [ ] **Stuck deploy** (network hang for >timeout): the workflow times out; concurrency releases; next deploy proceeds.
- [ ] **Manual workflow_dispatch deploy** (operator-triggered) honours the same lock — verified by dispatching two simultaneous instances and observing serialisation.
- [ ] **Branch-protection-required deploy check** still passes — the split-job pattern doesn't break any required check name (verify against branch protection).
- [ ] **`gh-pages` branch push pattern** (older workflows using `peaceiris/actions-gh-pages`): still subject to the same serialisation — they share the group too.
- [ ] **Cross-environment deploys** (if any workflow deploys to a SEPARATE Pages target via subdir): not affected; only single-target deploys share the lock.

### Performance

- [ ] Deploy latency increases by at most the lock-wait time (typically <30s in practice).
- [ ] Build jobs continue to run in parallel — the split prevents the lock from serializing build work too.
- [ ] No regression in the build artifact size or deploy-time.

### Security

- [ ] The shared concurrency group does NOT widen permissions — each workflow's `permissions:` block is unchanged.
- [ ] Cancellation tokens (`cancel-in-progress: false`) prevent a malicious PR from cancelling an in-flight deploy.
- [ ] Pages deploy artifacts are still signed via the existing `actions/deploy-pages@v5` attestation (or equivalent) — verify the split-job pattern preserves this.

### UX

- [ ] PR authors see deploy status in the PR checks panel; if their deploy is queued behind another, the status shows "queued" not "stuck".
- [ ] Operator can monitor deploy queue via `gh run list --workflow="*pages*"`.

### i18n

- [ ] N/A — CI workflow change.

### Observability

- [ ] Each deploy job emits a `::notice::` line on start: `::notice::Pages deploy starting (group=gh-pages-deploy, run=${{ github.run_id }})`.
- [ ] Each deploy job emits a `::notice::` on completion or failure.
- [ ] The lint test's failure message clearly names the workflow + line that violates the invariant.
- [ ] Job summary on the deploy job includes the artifact size + deploy URL.

## BDD Scenarios

**Scenario: Two concurrent merges serialise their deploys**

- **Given** PR A and PR B both merge to main within 30 seconds
- **When** both PRs' deploy workflows enqueue
- **Then** PR A's deploy runs first (FIFO based on `github.run_id` ordering)
- **And** PR B's deploy waits in the concurrency queue
- **And** when PR A's deploy completes (success or fail), PR B's deploy starts
- **And** both deploys ultimately complete; the final published site reflects PR B's content (the later merge)
- **And** no interleaved partial deploys are observed

**Scenario: Build jobs run in parallel; only deploy serialises**

- **Given** the same two PRs A and B
- **When** both workflows trigger
- **Then** both `build` jobs run in parallel (no concurrency conflict)
- **And** only the `deploy` jobs serialise via the shared group

**Scenario: Build failure short-circuits before lock acquisition**

- **Given** PR A's build job fails
- **When** the deploy job is evaluated
- **Then** the deploy job is skipped (failed `needs:` dependency)
- **And** the concurrency lock is not held; another PR's deploy proceeds immediately

**Scenario: Lint catches a missing shared-group declaration**

- **Given** a new workflow `.github/workflows/new-thing.yml` is added that deploys to Pages without the shared concurrency group
- **When** the lint test runs in CI
- **Then** the test fails with `MISSING shared concurrency group on Pages-deploying workflow: new-thing.yml`

**Scenario: Group name typo detected**

- **Given** a workflow uses `concurrency.group: gh_pages_deploy` (underscore variant)
- **When** the lint runs
- **Then** the test fails with `WRONG group name 'gh_pages_deploy', expected 'gh-pages-deploy'`

**Scenario: Manual dispatch honours the lock**

- **Given** the Allure-report workflow is dispatched manually
- **And** a separate roadmap-rebuild workflow is dispatched in the same 5-second window
- **When** both reach their deploy jobs
- **Then** only one runs at a time
- **And** the other shows "Queued" in the Actions UI

## Test Plan (TDD)

### Red

1. Add `express-api/tests/workflows/gh-pages-concurrency.test.js`:
   - Walk every `.github/workflows/*.yml` file.
   - Identify Pages-deploying workflows by grep'ing for `actions/deploy-pages` OR `peaceiris/actions-gh-pages` OR direct `gh-pages` branch push.
   - For each identified workflow, parse YAML; assert the deploy job has `concurrency.group: gh-pages-deploy` and `cancel-in-progress: false`.
   - List of identified workflows expected: the public site deploy, allure-report, (future) roadmap-webpage-rebuild.
2. Run `cd express-api && npm test -- gh-pages-concurrency` → RED (currently each workflow has its own group OR no group).

### Green

1. For each Pages-deploying workflow:
   - Refactor into `build` + `deploy` jobs if monolithic.
   - Add `concurrency: group: gh-pages-deploy, cancel-in-progress: false` to the deploy job.
2. Re-run lint test → GREEN.
3. Manual verification: trigger two simultaneous workflow_dispatches; observe serialisation in the Actions UI.

## Out of Scope

- **Redesigning the Pages deploy artifact format** — only concurrency.
- **Migrating to a different Pages provider** — out of scope.
- **Adding a cron-triggered Pages rebuild** — separate concern (covered by SHY-0036 if needed).
- **Reducing deploy time** — not in scope; serialisation may increase wall-clock for some flows.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- All Pages-deploying workflow files in `.github/workflows/`.
- The lint test harness existing pattern (verify `express-api/tests/workflows/`).
- Per [[feedback-workflow-verify-by-running]]: dispatch + observe post-merge.

## Risks & Mitigations

- **Risk:** The split-job refactor breaks a workflow's required-check name (branch protection). **Mitigation:** identify required check names before refactoring; preserve names or update branch protection in the same PR.
- **Risk:** Some workflows publish to a DIFFERENT Pages target (subdomain). **Mitigation:** verify per workflow; only single-target deploys share the lock.
- **Risk:** Serialisation adds wall-clock latency that frustrates contributors. **Mitigation:** documented trade-off; data integrity > latency. Monitor lock-wait times via job summaries.
- **Risk:** A workflow uses an unusual Pages-deploy mechanism not caught by the lint's grep. **Mitigation:** lint uses multiple detection patterns; reviewer agent verifies coverage.

## Definition of Done

- [ ] All Pages-deploying workflows use the shared `gh-pages-deploy` concurrency group.
- [ ] Lint test passes; no workflow violates the invariant.
- [ ] Two-deploy serialisation verified via manual dispatch.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`infra` → auto-merge + workflow-verified).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; serialisation-verification outcome in Notes.

## Notes (running log)

- 2026-06-07 ~21:03 BST — Refined under SHY-0032. P1 Tier 2 CI reliability. G055 was self-discovered post-roadmap; eliminates a recurring CI race.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-G6` (roadmap_ids: G055).
