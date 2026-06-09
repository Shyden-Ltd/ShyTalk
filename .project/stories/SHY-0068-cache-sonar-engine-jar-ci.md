---
id: SHY-0068
status: Draft
owner: claude
created: 2026-06-09
priority: P1
effort: S
type: infra
roadmap_ids: []
pr:
---

# SHY-0068: Cache SonarCloud scanner-engine JAR in CI (eliminate WAF-flake download)

## User Story

As the ShyTalk maintainer, I want CI's SonarCloud scanner-engine JAR served from the Actions cache instead of re-downloaded each run, so that AWS-WAF blocks of GitHub-runner IPs (the 2026-06-09 PR #1049 failure mode, and the HTTP-403 CDN flakes from PR #1001) stop failing the required `sonarcloud` job — fixed at the root per the no-auto-retry rule, not retried around.

## Why

2026-06-09 (PR #1049): SonarCloud's CDN behind AWS WAF intermittently blocks GitHub-hosted runner IPs during the scanner-engine JAR download → `sonarcloud / SonarCloud Analysis` fails/cancels → PR Gate red → wasted CI cycles and manual reruns. Verification cycle V1–V4 (2026-06-09 18:03–18:31 BST, logged in memory) validated Phase 1 (cache the artefact) as sound; rejected upload-replay (relies on Sonar-internal API) and SHA-keyed cache (engine artefact is immutable per version — version key suffices). Operator selected Phase 1. Aligns with the cache-everything-version-aware CI rule and the no-auto-retry-workflows rule (cache the artefact, don't rerun the failure).

## Acceptance Criteria

### Happy path
- [ ] The sonarcloud workflow job restores the scanner-engine JAR from `actions/cache` keyed on the engine version (derived from the scanner/engine version the sonar scanner resolves, not a hardcoded string); on hit, NO network fetch of the engine occurs (assert via scanner debug log grep in the workflow step).
- [ ] On miss, the engine downloads once, the cache saves, and the subsequent run hits (verified by two consecutive workflow_dispatch runs in Dependencies' verification step).
- [ ] Engine prefetch/restore runs as an early, parallel step relative to `Detect Changes` so a hard download failure surfaces fail-fast rather than after test jobs.

### Error paths
- [ ] Cache service unavailable: job falls through to direct download (current behaviour) — cache is an optimisation, never a new single point of failure.
- [ ] Download fails on a cache miss (WAF block): job fails with the real HTTP error visible in the log (no retry-wrapper, no suppression).

### Edge cases
- [ ] Sonar scanner version bump (renovate/dependabot or sonar-project.properties change) changes the cache key → old cache ignored, new engine fetched + cached (version-aware keying per CI cache rule).
- [ ] Concurrent PRs on a cold cache: both may download (acceptable; GitHub cache handles last-write; no corruption because the artefact is immutable).

### Performance
- [ ] Cache-hit path saves the full engine download (~50–80MB) per run; sonarcloud job wall-clock reduction recorded in the story Notes after first week.

### Security
- [ ] Cache key includes the engine version only; no tokens/credentials in key or cached content (JAR is a public artefact). `SONAR_TOKEN` usage unchanged.

### UX
- [ ] N/A — CI-internal; no user-facing surface.

### i18n
- [ ] N/A — CI-internal.

### Observability
- [ ] Workflow step summary line states `engine-cache: HIT` or `engine-cache: MISS (downloaded + saved)` so flake triage can see the path taken at a glance.

## BDD Scenarios

**Scenario: warm cache serves the engine without network**
- **Given** a prior run populated the engine cache for the current scanner version
- **When** the sonarcloud job runs on a new commit
- **Then** the cache step reports a hit and the scanner log shows no engine download
- **And** analysis completes using the cached JAR

**Scenario: version bump busts the cache**
- **Given** the scanner version changes in the workflow/properties
- **When** the job runs
- **Then** the old cache key misses, the new engine downloads once, and the new key saves

**Scenario: WAF block on cold cache fails loudly**
- **Given** an empty cache and the CDN returning 403
- **When** the job runs
- **Then** the job fails with the 403 visible in the step log
- **And** no auto-retry fires (manual rerun per feedback-sonar-cdn-403-rerun-not-code remains the operator action)

## Test Plan

**Red first** (workflow assertions live in `express-api/tests/scripts/` per repo pattern):
- New `express-api/tests/scripts/sonarcloud-engine-cache.test.js`: asserts the sonarcloud workflow YAML contains an `actions/cache` (SHA-pinned) step for the engine path; key contains a version expression (not a literal); cache step ordered before the scan step; summary-line echo present; NO `gh run rerun` / retry wrapper anywhere in the workflow.
**Green**: edit `.github/workflows/<sonarcloud workflow>` accordingly.
**Verify-by-running (MANDATORY per workflow-verify-by-running):** two `workflow_dispatch` runs post-merge — first MISS+save, second HIT — run-links + grep evidence appended to Notes before Done-eligibility.

## Out of Scope

- Upload-replay of analysis reports (rejected: Sonar-internal API).
- SHA-keyed caching (rejected: artefact immutable per version).
- Self-hosting SonarQube (separate cost/benefit discussion).
- Any `workflow_run` auto-retry (forbidden by no-auto-retry rule).

## Dependencies

- None blocking. Local pre-push Sonar scan already caches its scanner (~/.sonar) — unaffected.
- Post-merge verification needs two manual workflow dispatches (Claude-runnable).

## Risks & Mitigations

- **Risk:** cache key derivation drifts from actual engine version → stale engine served. **Mitigation:** key derives from the same source the scanner reads (workflow-pinned scanner version); version bump test (BDD #2) covers it.
- **Risk:** 10GB repo cache budget pressure evicting hot caches. **Mitigation:** single ~80MB entry; monitor via cache list in verification step.

## Definition of Done

- [ ] All AC checked; YAML assertions red→green; actionlint + SHA-pin lint green.
- [ ] Reviewer at ZERO findings before push; PR auto-merged.
- [ ] Post-merge MISS→HIT dispatch pair verified + logged in Notes.
- [ ] `status: Done` deferred to next release cut (`released_in` set then); SHY-INDEX synced.

## Notes (running log)

- 2026-06-09 ~23:00 BST — Authored fully-refined during overnight autonomous run from the V1–V4 verification evidence (18:03–18:31 BST session); operator chose Phase 1 scope earlier today. Filed as Draft alongside SHY-0069's PR; implementation queued after SHY-0061 unless prioritised.
