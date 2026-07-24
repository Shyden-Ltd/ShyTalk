---
id: SHY-0233
status: In Review
owner: claude
created: 2026-07-24
priority: P1
effort: S
type: infra
roadmap_ids: []
---

# SHY-0233: Web prod rollback — instant Cloudflare Pages re-promote (no rebuild)

## User Story

As the **operator responsible for keeping shytalk.shyden.co.uk up**,
I want **a one-click workflow that instantly re-promotes the previous good Cloudflare Pages production deployment**,
So that **when a prod web deploy ships broken, I can recover in seconds without waiting for a rebuild or an approval gate**.

## Why

ShyTalk's web deploys via `deploy-prod.yml` (`wrangler pages deploy public --project-name shytalk-site`), but there is **no rollback mechanism** today — recovery from a broken prod web deploy is a manual scramble in the Cloudflare dashboard or a full re-dispatch of `deploy-prod.yml` against an older tag (minutes, and it rebuilds). Cloudflare Pages keeps every prior deployment and exposes an instant-promote API; a thin `workflow_dispatch` around it turns "broken prod" into a seconds-long, no-rebuild recovery. This is the unambiguous gap identified in the #1653 review (shyden.co.uk already ships this exact mechanism; ShyTalk should mirror it). The deploy-before-merge half of #1653 is re-spec'd separately (SHY-0234) because it is a genuine architectural decision, not a straight port.

## Acceptance Criteria

### Happy path
- [ ] A new `.github/workflows/rollback.yml` exposes a manual **Run workflow** (`workflow_dispatch`) with a single optional `deployment_id` input.
- [ ] With `deployment_id` **blank**, the workflow resolves the CF Pages **previous** production deployment of `shytalk-site` (newest-first list, index `[1]`) and promotes it live via the CF API `POST …/deployments/{id}/rollback`.
- [ ] With `deployment_id` **set**, the workflow promotes exactly that deployment.
- [ ] On success the run log prints the target deployment ID and the resulting live deployment ID + URL.

### Error paths
- [ ] Missing `CLOUDFLARE_API_TOKEN` secret → fail fast with a clear `::error::` before any API call (exit 1).
- [ ] No previous production deployment exists (only one, or none) → `::error::No previous production deployment found` (exit 1), no promote attempted.
- [ ] CF API returns `success:false` → the run fails (exit 1) and echoes the `.errors` array from the response.
- [ ] Any curl failure (network / auth / bad ID) aborts the run (`curl -fsS` + `set -euo pipefail`).

### Edge cases
- [ ] Exactly one production deployment (nothing to roll back to) → the "no previous" error path fires (never promotes index `[0]`, the current live one).
- [ ] A `deployment_id` that isn't a real deployment → the CF API rejects it → run fails loud (no silent no-op).

### Performance
- [ ] Recovery is a single API promote — **no rebuild, no `wrangler` deploy**. Job caps at `timeout-minutes: 10` (real path is seconds).

### Security
- [ ] **No `production` approval gate** — deliberate, so recovery is never blocked by an absent approver while prod is down. Dispatch is inherently restricted to repo collaborators (GitHub `workflow_dispatch` permission model).
- [ ] `permissions: contents: read` only (least privilege — the job needs no write scopes).
- [ ] **Workflow-injection hygiene:** the operator-typed `deployment_id` is passed via `env: TARGET_ID:` and referenced only as the quoted shell var `$TARGET_ID` — never interpolated into the `run:` script. No `github.event.*` attacker-controllable data is used.
- [ ] `CLOUDFLARE_API_TOKEN` comes from a repo secret and is never echoed; the account ID is inlined (non-secret — already present in `deploy-prod.yml`).

### UX
- [ ] The `deployment_id` input description tells the operator that blank = previous live deployment and where to find explicit IDs (CF dashboard, project `shytalk-site`).
- [ ] Run-log output is human-readable at a glance: which deployment was promoted and the new live URL.

### i18n
- [ ] N/A — CI workflow with no user-facing product strings.

### Observability
- [ ] Every outcome is visible in the run log: the resolved target ID, the promote result (new live ID + URL), and actionable `::error::` annotations on every failure branch.

## BDD Scenarios

**Scenario: Blank input rolls back to the previous production deployment**
- **Given** `shytalk-site` has ≥2 production deployments in Cloudflare Pages
- **When** a collaborator dispatches `rollback.yml` with `deployment_id` blank
- **Then** the workflow promotes the deployment at newest-first index `[1]`
- **And** the run succeeds and logs the new live deployment ID + URL

**Scenario: Explicit deployment ID is promoted verbatim**
- **Given** a collaborator knows a specific good deployment ID
- **When** they dispatch `rollback.yml` with that `deployment_id`
- **Then** the workflow promotes exactly that deployment (skips the previous-deployment lookup)

**Scenario: No previous deployment fails loud**
- **Given** `shytalk-site` has zero or exactly one production deployment
- **When** a collaborator dispatches `rollback.yml` with `deployment_id` blank
- **Then** the run exits non-zero with `::error::No previous production deployment found to roll back to.`
- **And** no rollback API call is made

**Scenario: Missing token fails before any API call**
- **Given** the `CLOUDFLARE_API_TOKEN` secret is unset
- **When** the workflow runs
- **Then** it exits 1 with a clear `::error::` naming the missing secret, before contacting Cloudflare

**Scenario: Cloudflare API error surfaces**
- **Given** the CF API responds `success:false` (e.g. an invalid target ID)
- **When** the promote step runs
- **Then** the run fails (exit 1) and echoes the `.errors` array from the response

## Test Plan

**Classification: CI-config-only** (`feedback-ci-config-only-merge-to-main`). The change is confined to `.github/workflows/rollback.yml` + a CI-structure pin test + this story doc — **no** app / backend / website runtime surface is touched or affected. Per the CLAUDE.md CI-config-only exemption, the real-device / all-browser gauntlet does **not** apply; the full relevant non-device gauntlet still runs.

- **Red → Green (structure pin test):** `express-api/tests/scripts/rollback-workflow-structure.test.js` parses `.github/workflows/rollback.yml` and asserts the emergency-recovery invariants that must never silently regress — project `shytalk-site`, the CF `/rollback` endpoint, `production`-environment filtering with the `[1]` previous-deployment selection, **no** `environment:`/approval gate, the dedicated `rollback-web-prod` concurrency group (not `deploy-prod`), `permissions: contents: read`, and that `deployment_id` is consumed via `env:` (not inlined). Written to fail against the pre-workflow tree (RED), pass once `rollback.yml` exists (GREEN).
- **actionlint** (+ embedded shellcheck) over `rollback.yml` — pre-push hook + CI `lint.yml`.
- **prettier `--check`** (from `express-api` cwd) over the YAML.
- **eslint** `--max-warnings=0` over the new Jest test.
- **Story-frontmatter validator** (`scripts/check-story-frontmatter.sh`) green.
- **`code-reviewer`** 100% clean on the local commit before push.
- **CI required checks** green by name: Detect Changes · Analyze JavaScript · PR Gate.

## Out of Scope

- Rolling back **backend / Android / iOS** — those recover by re-dispatching `deploy-prod.yml` against the last-good tag; a unified multi-surface rollback is not attempted here.
- The **deploy-before-merge** migration of the web deploy — re-spec'd as **SHY-0234** (a design decision, brought for approval before build).
- Automatic rollback on failed smoke tests — this is an operator-triggered manual tool; auto-rollback-on-smoke-failure is a possible follow-up, not this story.
- Any change to `deploy-prod.yml` / `deploy-dev.yml` / `release.yml`.

## Dependencies

- The `CLOUDFLARE_API_TOKEN` repo secret (already provisioned — used by `deploy-prod.yml` / `deploy-dev.yml`).
- The `shytalk-site` Cloudflare Pages project (already the prod web target).
- No dependency on SHY-0234; this story ships standalone.

## Risks & Mitigations

- **Risk:** rollback races an in-flight web `deploy-prod`. **Mitigation:** documented as vanishingly unlikely (deploy-prod is rare + deliberate) and self-correcting; a dedicated concurrency group is chosen over sharing `deploy-prod` so an emergency rollback is never blocked behind a ~100-min iOS build.
- **Risk:** no approval gate could let a rollback be triggered casually. **Mitigation:** `workflow_dispatch` is collaborator-only; the trade-off (recover-fast vs. gate) is intentional and mirrors the approved shyden.co.uk mechanism.
- **Risk:** promoting the wrong deployment. **Mitigation:** the default (`[1]`) is deterministic (newest-first, previous); an explicit ID is available for precise control; every run logs exactly what it promoted.
- **Risk:** CF API shape drift. **Mitigation:** `success` + `.errors` are asserted; `curl -fsS` + `set -euo pipefail` fail the run on any non-2xx / malformed response rather than silently "succeeding".

## Definition of Done

- `rollback.yml` merged to **main** (CI-config-only → main, autonomous merge with all main gates green by name + `pre-merge-check.sh` OK), so the emergency tool is dispatchable on the release branch.
- Structure pin test green; actionlint / prettier / eslint / story-validator green; `code-reviewer` 100% clean.
- Story flipped **Done on main-merge** (Notes records it; no release-cut wait, per `feedback-ci-config-only-merge-to-main`).
- **main → develop back-merged immediately** afterwards, carrying the Done flip + the SHY-INDEX row so the board sync fires.
- A dry-run is deferred to the next real prod web deploy (so a genuine "previous deployment" exists to promote); not gated on it for merge.

## Notes

**2026-07-24 (running log):**
- Filed + implemented in one pass (CI-config-only, well-specified port of the shyden.co.uk `rollback.yml` proven live in prod). Architect self-approval: scope is a single additive workflow + its pin test; no runtime surface; mirrors an already-approved mechanism.
- Supersedes the rollback half of placeholder GitHub issue **#1653**; the deploy-before-merge half is re-spec'd as **SHY-0234**.
- Adaptations from the shyden reference: project `shyden-site`→`shytalk-site`; account ID inlined (matches `deploy-prod.yml`); dedicated `rollback-web-prod` concurrency group (shyden shared its web-only deploy group; ShyTalk's `deploy-prod` group covers a multi-platform deploy, so sharing it would queue an emergency rollback behind unrelated platform builds).
- **Code-review R1** (`code-reviewer` agent): 1 Critical + 6 Important, ALL applied. C1 — pin test only covered the lookup half; added coverage for the POST method, the no-previous-deployment guard, the `success:false` failure branch (incl. an inversion guard on `!= "true"`), and the success echo. I1 — token-guard test was tautological (`CLOUDFLARE_API_TOKEN` also appears in the auth header); now asserts the real guard message precedes the first curl. I2/I6 — pinned trigger-exclusivity + `timeout-minutes`. I3 — selection logic now exercised against fixtures (JS mirror of the verbatim-pinned jq filter; jq/bash spawns dropped to avoid `sonarjs/no-os-command-from-path` warnings — fixed, not suppressed). I4 — wrapped both curls so an HTTP-status failure fails loud with a clear message instead of an opaque `set -e` death (strict improvement over the shyden reference; a backport there is optional). I5 — added static allowlist-coverage for the guard entry. Fix round self-certified: pin test 16/16, eslint 0-warnings, prettier + actionlint + all workflow guards + story-validator green.
- **CI blocker healed (folded in):** the PR's `test-backend` + `sonarcloud` + `PR Gate` came back red — root-caused (reproduced locally) to a **pre-existing** `actions/setup-java` pin drift inherited from `origin/main` (Dependabot #1646 bumped 5.5.0→5.6.0 in `test-backend.yml` but not the `setup-jdk-gradle` composite action). Adding a file under `express-api/tests/` flipped Detect Changes' `backend_changed`, running the full backend suite, which grades repo-wide CI health via `ci-action-pin-consistency.test.js`. Healed by aligning the composite action to `03ad4de0…` (v5.6.0 — verified via the git tag, never a downgrade); consistency test now 15/15. Folded here rather than a separate PR because it is the CI-prerequisite for THIS PR and is the same CI-config-only class. Mechanical Dependabot-completion — self-certified (pin test green).
- Reviewed-up-to: tip of `story/SHY-0233` after R1 + the setup-java heal (both self-certified, no re-dispatch — small mechanical deltas over a reviewed base).
