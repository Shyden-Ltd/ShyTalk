---
id: SHY-0068
status: In Progress
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

**Scope addition (2026-06-10 ~02:00 BST):** `.github/workflows/sonarcloud-auto-retry.yml` still exists despite the operator directing its removal (2026-06-09 ~18:30 BST, codified in [[feedback-no-auto-retry-workflows]]) — the node-26 push-hang crisis consumed that evening. Its deletion belongs HERE: the cache is the real fix that replaces the retry patch. Only other repo reference is an unrelated comment in release-tag.yml (verified 2026-06-10).

2026-06-09 (PR #1049): SonarCloud's CDN behind AWS WAF intermittently blocks GitHub-hosted runner IPs during the scanner-engine JAR download → `sonarcloud / SonarCloud Analysis` fails/cancels → PR Gate red → wasted CI cycles and manual reruns. Verification cycle V1–V4 (2026-06-09 18:03–18:31 BST, logged in memory) validated Phase 1 (cache the artefact) as sound; rejected upload-replay (relies on Sonar-internal API) and SHA-keyed cache (engine artefact is immutable per version — version key suffices). Operator selected Phase 1. Aligns with the cache-everything-version-aware CI rule and the no-auto-retry-workflows rule (cache the artefact, don't rerun the failure).

## Acceptance Criteria

### Happy path
- [ ] The sonarcloud workflow job restores `~/.sonar/cache` via `actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae # v5` (repo's existing pin, asserted EXACTLY in the test) with `key: ${{ runner.os }}-sonar-${{ github.run_id }}` and `restore-keys: ${{ runner.os }}-sonar` — SonarSource's OS-scoped pattern adapted for GitHub cache immutability: a constant key would exact-hit forever and NEVER re-save (frozen stale content); the run-unique key always restores the newest entry via prefix match and saves a fresh additive snapshot. On restore-hit the scanner finds the engine locally and performs no engine download.
- [ ] On miss, the engine downloads once, the cache saves, and the subsequent run hits (verified by two consecutive workflow_dispatch runs in Dependencies' verification step).
- [ ] The cache restore step is placed immediately after `actions/checkout` and before `setup-jdk-gradle`, so a cache miss that proceeds to download surfaces fail-fast before the test-compilation steps run (steps are sequential; "parallel" is not a thing within a job).
- [ ] `.github/workflows/sonarcloud-auto-retry.yml` is DELETED (operator-directed 2026-06-09 ~18:30; the cache replaces the patch). The YAML-assertion test verifies the file is absent AND no `gh run rerun` appears anywhere in `.github/workflows/`.

### Error paths
- [ ] Cache service unavailable: job falls through to direct download (current behaviour) — cache is an optimisation, never a new single point of failure.
- [ ] Download fails on a cache miss (WAF block): job fails with the real HTTP error visible in the log (no retry-wrapper, no suppression).

### Edge cases
- [ ] Engine/scanner version changes server-side or via plugin bump: the key does NOT change (intentional — additive cache); the new engine version downloads ONCE into the existing `~/.sonar/cache` and is included in the next cache save. Documented divergence from the version-keyed-cache rule: the cache DIR is the versioned artefact here, satisfying the rule's intent (never serve a stale artefact — the scanner always resolves its exact version inside the dir).
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
- [ ] Workflow step summary states `engine-cache: HIT` or `engine-cache: MISS` derived from a restored-content directory check — NOT from `outputs.cache-hit`, which is 'true' only on exact key match and therefore never with the run-unique key (reviewer finding). The test asserts both branch literals AND the absence of any `outputs.cache-hit` reference.

## BDD Scenarios

**Scenario: warm cache serves the engine without network**
- **Given** a prior run populated the engine cache for the current scanner version
- **When** the sonarcloud job runs on a new commit
- **Then** the cache step reports a hit and the scanner log shows no engine download
- **And** analysis completes using the cached JAR

**Scenario: engine version change is additive, not key-busting**
- **Given** a warm cache and a new engine version advertised server-side
- **When** the job runs
- **Then** the prefix restore still hits, the scanner downloads only the new engine version once
- **And** the next cache save includes both versions in `~/.sonar/cache`

**Scenario: WAF block on cold cache fails loudly**
- **Given** an empty cache and the CDN returning 403
- **When** the job runs
- **Then** the job fails with the 403 visible in the step log
- **And** no auto-retry fires (manual rerun per feedback-sonar-cdn-403-rerun-not-code remains the operator action)

## Test Plan

**Red first** (workflow assertions live in `express-api/tests/scripts/` per repo pattern):
- New `express-api/tests/scripts/sonarcloud-engine-cache.test.js` (reuse the extractStep helper pattern from deploy-dev-ios-cache-share.test.js + the file-level not.toMatch pattern from release-workflow-pin.test.js), as SEPARATE test blocks:
  1. sonarcloud.yml contains `actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae` (exact SHA) with `path` covering `~/.sonar/cache`, `key:` containing `${{ runner.os }}-sonar-${{ github.run_id }}`, and `restore-keys` containing the `${{ runner.os }}-sonar` prefix.
  2. The cache step appears after `actions/checkout` and before `setup-jdk-gradle`.
  3. HIT/MISS summary echo writes to `$GITHUB_STEP_SUMMARY` containing `engine-cache:`.
  4. `SONAR_USER_HOME` appears NOWHERE in sonarcloud.yml (path-consistency with local pre-push cache).
  5. `fs.existsSync('.github/workflows/sonarcloud-auto-retry.yml')` is false.
  6. Glob ALL `.github/workflows/*.yml`: no file contains `gh run rerun` (guards reintroduction, independent of #5).
**Green**: edit `.github/workflows/<sonarcloud workflow>` accordingly.
**Verify-by-running (MANDATORY per workflow-verify-by-running):** two `workflow_dispatch` runs post-merge — first MISS+save, second HIT — run-links + grep evidence appended to Notes before Done-eligibility.

## Out of Scope

- Upload-replay of analysis reports (rejected: Sonar-internal API).
- SHA-keyed caching (rejected: artefact immutable per version).
- Self-hosting SonarQube (separate cost/benefit discussion).
- The pre-existing `if: env.SONAR_TOKEN != ''` step-gating quirk in sonarcloud.yml:95 (env declared step-locally yet referenced in the step's own `if:`): currently functional in practice (analysis demonstrably runs; Dependabot skip works) — refactoring it risks Dependabot-PR regressions; deferred to a future SHY.
- Any `workflow_run` auto-retry (forbidden by no-auto-retry rule).

## Dependencies

- None blocking. Local pre-push Sonar scan already caches its scanner (~/.sonar) — unaffected ONLY IF the workflow never sets `SONAR_USER_HOME`; do NOT set it (asserted by the test).
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

- 2026-06-10 ~03:05 BST — **Reviewer cycle 1 (feature-dev:code-reviewer): 0 Critical, 2 Important, both applied.** (1, conf-95) `outputs.cache-hit` is exact-match-only → always-MISS with the run-unique key; echo replaced with a restored-content dir check (HIT/MISS both meaningful now). (2, conf-82) untested `id:`/steps-reference — resolved structurally: the dead `id:` and steps-expression were removed with fix 1; test now pins both branch literals + forbids `outputs.cache-hit`. Reviewer verified clean: ruleset required-check names unaffected by the deletion; cache-poisoning negligible (branch-scoped + checksummed artefact); no eviction pressure on macos caches (separate pool); Dependabot no-op save pre-deferred. Re-verified: 6/6 + canonical actionlint green.

- 2026-06-10 ~02:50 BST — **TDD red→green complete.** RED 5/6 failed → GREEN 6/6 (runner exit 0) + full scripts dir 6,289/6,289. Implementation: cache step (run-unique key + prefix restore-keys, exact pinned SHA) after checkout/before JDK; block-scalar HIT/MISS step-summary echo (unquoted `engine-cache:` colon broke YAML scalar parsing — actionlint caught it); sonarcloud-auto-retry.yml DELETED (git rm). Canonical actionlint (`-shellcheck='-e SC2086'` per lint.yml/pre-push) green — direct un-flagged invocation false-alarmed on a pre-existing line. Test self-collision fixed: the workflow's own "Do NOT set SONAR_USER_HOME" comment tripped the substring assertion → sharpened to setting-only patterns (env key / shell assignment).

- 2026-06-10 ~02:40 BST — **Implementation deviation from architect blocking-1 (substance preserved, mechanism corrected):** GitHub cache entries are immutable per key — the literal `key: ${{ runner.os }}-sonar` would exact-hit forever and never re-save, freezing stale engine content (contradicts the additive BDD scenario). Adopted the standard additive-cache pattern instead: `key: ${{ runner.os }}-sonar-${{ github.run_id }}` (always saves fresh) + `restore-keys: ${{ runner.os }}-sonar` (always restores newest). Still OS-scoped, still no version-endpoint curl. ~10GB repo budget: entries LRU-evict; one ~100MB entry/run is the accepted GitHub-recommended trade for additive caches.
- 2026-06-10 ~02:30 BST — **Architect verdict: APPROVE-WITH-CHANGES** (2 blocking + 4 must-fix applied, 1 rejected w/ evidence). Blocking-1: curl-to-version-endpoint key derivation was CIRCULAR (same WAF'd host) → replaced with SonarSource's documented `${{ runner.os }}-sonar` + restore-keys additive-cache pattern; BDD scenario 2 rewritten. Blocking-2: `SONAR_USER_HOME` must stay unset for CI/local path consistency → Dependencies + test assertion added. Also applied: SONAR_TOKEN-gating quirk → Out of Scope (deferred SHY); "early, parallel" wording fixed; test split into 6 explicit blocks incl. exact-SHA + file-absence + glob-no-rerun; **Rejected concern-7** ("release-tag.yml has no auto-retry reference — remove the claim"): the comment EXISTS at release-tag.yml:212-216 ("no auto-retry — the merged release commit is on main...") — verified first-hand 2026-06-10 ~00:14 BST via grep -B2 -A2; architect used narrower patterns. Claim stands as written.

- 2026-06-09 ~23:00 BST — Authored fully-refined during overnight autonomous run from the V1–V4 verification evidence (18:03–18:31 BST session); operator chose Phase 1 scope earlier today. Filed as Draft alongside SHY-0069's PR; implementation queued after SHY-0061 unless prioritised.
