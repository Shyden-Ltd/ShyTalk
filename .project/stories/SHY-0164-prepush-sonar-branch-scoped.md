---
id: SHY-0164
status: In Progress
owner: claude
created: 2026-07-08
priority: P0
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: true
---

# SHY-0164: Pre-push Sonar gates the pushed branch, not main

## User Story

As **a ShyTalk contributor pushing a feature branch**, I want **the pre-push SonarCloud scan to grade my branch's OWN new code** (via `sonar.branch.name`) rather than analysing the working tree against `main`'s quality gate, so that **a red `main` gate caused by pre-existing debt cannot block a clean feature-branch push**.

## Why

`.husky/pre-push` runs `./gradlew sonar -Dsonar.qualitygate.wait=true` with **no `sonar.branch.name`**. A local invocation has no CI environment for the SonarScanner to auto-detect a branch/PR from, so SonarCloud grades the analysis against the project's **main** branch and waits on **main's** quality gate.

Today `main`'s gate is **RED** (`new_reliability_rating` + `new_security_rating` failing on pre-existing issues that PR #1527/SHY-0152 fixes but hasn't merged). Consequence: **every** feature-branch push is blocked at the Sonar step — even a push whose own diff introduces zero new issues — because the gate being waited on is main's, not the branch's. This blocks the whole `develop`-integration flow (a newly-built ticket cannot be pushed).

The fix scopes the analysis per-change. Passing `sonar.branch.name=<current branch>` makes the local scan a branch analysis gated on the branch's own new code — a clean branch passes regardless of main's debt; a branch that introduces a real new issue still fails (the gate keeps its teeth — verified before merge, see Test Plan).

**Important — this hook is the ONLY enforcing Sonar gate.** CI's SonarCloud job (`.github/workflows/sonarcloud.yml`) runs `./gradlew sonar` WITHOUT overriding `sonar.qualitygate.wait`, and `build.gradle.kts` sets it to `false` (advisory-only on the free plan). So CI never fails on a red gate; the `gate`/"PR Gate" job `needs: sonarcloud` but that job effectively always succeeds. The pre-push hook (which overrides `wait=true`) is the sole place the quality gate blocks — so the branch-scoping must not weaken the negative path (a real new issue must still fail).

## Acceptance Criteria

### Happy path
- [ ] `.husky/pre-push`'s `./gradlew sonar` invocation passes `-Dsonar.branch.name="$SONAR_BRANCH"`, where `SONAR_BRANCH` is derived from the checked-out branch (`git rev-parse --abbrev-ref HEAD`), while retaining `-Dsonar.qualitygate.wait=true` (JVM `-D` order between distinct keys is irrelevant, so adjacency is not asserted).
- [ ] A dated `SHY-0164` comment above the sonar command explains why the branch scope is required (no CI env → would otherwise grade against main's gate).
- [ ] Pushing a feature branch whose own new code is clean SUCCEEDS even while main's gate is red — proven behaviourally by THIS story's own push (self-validating: the fixed hook is what runs on the push that lands it).

### Error paths
- [ ] A branch that introduces a genuine new SonarCloud issue (new bug / security hotspot / coverage drop below the branch gate) still FAILS the push — the gate is scoped, not disabled (`sonar.qualitygate.wait=true` retained).
- [ ] `SONAR_TOKEN` unset still blocks the push with the existing message (unchanged).
- [ ] The "No code changes — skip" short-circuit above is unchanged (a docs-only push still skips the scan).

### Edge cases
- [ ] Pushing `develop` or `main` themselves sets `sonar.branch.name` to that branch (correct long-lived analysis) — no behaviour change for those; only the default-to-main inference is removed.
- [ ] The force-push guard earlier in the hook (which reads the push refs from stdin) is untouched; `SONAR_BRANCH` uses `HEAD`, not stdin, so the two do not interfere.

### Performance
- [ ] N/A — one extra `-D` flag + a `git rev-parse`; no measurable change to scan time.

### Security
- [ ] N/A — no auth/secret/rule/user-facing surface. The gate stays enforcing (`wait=true`); scoping to the branch does not weaken it (a branch's own new issues still block).

### UX
- [ ] N/A — developer tooling; no end-user surface.

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The `→ SonarCloud analysis...` echo is unchanged; the SHY-0164 comment documents the branch-scope intent for the next reader.

## BDD Scenarios

**Scenario: pre-push scan targets the current branch**
- **Given** `.husky/pre-push` after this change
- **When** the `./gradlew sonar` command block is read
- **Then** it contains `-Dsonar.branch.name="$SONAR_BRANCH"`
- **And** `SONAR_BRANCH` is assigned from `git rev-parse --abbrev-ref HEAD`
- **And** `-Dsonar.qualitygate.wait=true` is retained (the gate is not disabled)

**Scenario: a clean feature branch pushes despite a red main gate**
- **Given** `main`'s SonarCloud gate is red on pre-existing debt
- **And** a feature branch whose own diff introduces no new Sonar issue
- **When** the branch is pushed
- **Then** the SonarCloud pre-push step passes (it gates on the branch's own new code)
- **And** the push completes

## Test Plan (TDD)

**Classification: CI-config-only** (per CLAUDE.md `### Exemptions` exemption 2, delivered by SHY-0163). The diff is confined to `.husky/pre-push` (a git-hook / dev-tooling script), its structural pin test, and the story `.md` — **no app / backend (`express-api/src`, `firestore.rules`) / website runtime surface**. So no device/browser gauntlet; the full relevant non-device gauntlet IS run.

### Red
1. Add `express-api/tests/scripts/prepush-sonar-branch-scoped.test.js` — reads `.husky/pre-push` and asserts: (a) the sonar command passes `-Dsonar.branch.name="$SONAR_BRANCH"`; (b) `SONAR_BRANCH` is assigned from `git rev-parse --abbrev-ref HEAD`; (c) `-Dsonar.qualitygate.wait=true` is still present (gate not disabled). Confirm RED against the pre-fix hook (`git stash` the hook change → the branch.name assertion fails).

### Green
2. `.husky/pre-push`: add `SONAR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"` + `-Dsonar.branch.name="$SONAR_BRANCH"` to the sonar command + the SHY-0164 comment → test GREEN.

### Verification
- `cd express-api && npx jest tests/scripts/prepush-sonar-branch-scoped.test.js` green; eslint `--max-warnings=0` + prettier clean.
- **Behavioural — happy path (self-validating):** the push that lands this branch runs the FIXED hook — its SonarCloud step must pass on the branch's own (clean) new code while main's gate is red. That successful push IS the proof the branch analysis runs + gates green on clean code (local stack up for the Express-tests step).
- **Behavioural — negative path (gate keeps its teeth):** because this hook is the ONLY enforcing gate (CI Sonar is advisory), prove a real new issue still FAILS. On a throwaway scratch branch introduce one deliberate new SonarCloud issue, run `./gradlew sonar -Dsonar.token=… -Dsonar.branch.name="scratch/…" -Dsonar.qualitygate.wait=true -x :app:sonar --no-configuration-cache` directly, and confirm it exits NON-ZERO (gate fails). Discard the scratch branch; record the outcome in `## Notes`. Also confirm via the SonarCloud API that the project's New Code Definition resolves per-branch (reference branch), so a branch's new code = its diff.

## Out of Scope
- Fixing main's red Sonar gate itself (that is PR #1527 / SHY-0152 — merges to main, separate + operator-gated).
- Changing the CI SonarCloud job (it already auto-detects PR context; unchanged).
- Reading the pushed ref from stdin instead of `HEAD` (the normal workflow pushes the checked-out branch; a stdin-based variant is a possible future refinement, not needed now).

## Dependencies
- SonarCloud branch analysis on the `ShydenMcM_ShyTalk` project (already used by CI per-PR).
- `SONAR_TOKEN` in `.env` (existing prerequisite).
- Local stack up for the hook's Express-tests step (Firebase emulators).

## Risks & Mitigations
- **Risk:** SonarCloud's new-code model grades the feature branch more broadly than its diff (e.g. "previous version" instead of reference-branch), so a clean branch still fails. **Mitigation:** the self-validating push proves the real behaviour before merge; if it fails for a non-main reason, diagnose (the story does not merge on an unproven fix).
- **Risk:** proliferation of short-lived branches in SonarCloud. **Mitigation:** SonarCloud auto-purges inactive short-lived branches; negligible.
- **Risk:** `HEAD` is detached during some CI/rebase flow → `git rev-parse --abbrev-ref HEAD` returns `HEAD`. **Mitigation:** the hook only runs on `git push` from a checked-out branch; a detached-HEAD push is not part of the workflow.

## Definition of Done
- [ ] `.husky/pre-push` passes `-Dsonar.branch.name`; `qualitygate.wait=true` retained; SHY-0164 comment added.
- [ ] `prepush-sonar-branch-scoped.test.js` added (RED-first, then GREEN).
- [ ] **CI-config-only non-device gauntlet green**: the pin test + eslint + prettier + story validator + `code-reviewer` 100% clean.
- [ ] **Self-validating push succeeds** (the fixed hook gates the branch on its own clean new code while main is red) → merged into `develop`.
- [ ] `released_in:` set after release cut; `status: Done`.

## Notes (running log)
- 2026-07-08 — Filed to unblock the `develop`-integration flow. Root cause: the pre-push Sonar scan has no CI env → SonarCloud defaults to grading against main's (currently red) gate, blocking every clean feature-branch push. Operator (2026-07-08) chose the per-branch fix over merging #1527 to main or approving `--no-verify`. Self-validating: the push that lands this branch is the behavioural proof. Targets `develop` (not main, per operator).

Reviewed-up-to: PENDING_COMMIT_SHA
