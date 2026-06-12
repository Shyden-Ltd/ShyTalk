---
id: SHY-0020
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: S
type: infra
roadmap_ids: [G022, G049]
pr:
mvp: true
---

# SHY-0020: release.yml → manual-qa-matrix.yml workflow_call (event-driven E2 matrix)

## User Story

As the ShyTalk operator committed to $0 hosting + event-driven (not cron-driven) automation, I want **`release.yml` to invoke `manual-qa-matrix.yml` via `workflow_call` post-release with `target: dev` + `filter: chromium,firefox,webkit`**, so that the deferred E2 nightly matrix re-eval becomes event-driven (zero extra cron minutes) rather than time-driven.

## Why

The 2026-05-30 framework gaps doc deferred E2 (nightly matrix re-eval) on $0-tier cost grounds — running a matrix every night costs minutes; running it after each release ties cost to delivery cadence.

Roadmap rows G022 (line 82) + G049 (line 83):

> G022: Sev: 🟠 Important. CI — E2 deferred nightly matrix re-eval. Location: `.project/test-plans/exhaustive/2026-05-30-qa-runner-framework-gaps.md` E2 entry. Gap: Skip rationale was $0-tier cron cost; under no-shortcuts, event-driven equivalent required. Fix: `workflow_call` from `release.yml` → `manual-qa-matrix.yml` (post-release only, zero extra minutes). Scope: S.
>
> G049: Sev: 🟡 Polish. E2 event-driven impl design. Same as G022. Design specification: `release.yml` calls `manual-qa-matrix.yml` with `target: dev`, `filter: chromium,firefox,webkit` after release PR merges. Scope: S.

Demoted P1 → P2 under SHY-0032 (Tier 5 — CI nice-to-have; doesn't block users or quality).

## Acceptance Criteria

### Happy path

- [ ] `.github/workflows/manual-qa-matrix.yml` gains a `workflow_call:` trigger block with documented inputs (`target`, `filter`).
- [ ] `.github/workflows/release.yml` gains a `qa-matrix-post-release` job that calls `manual-qa-matrix.yml` via `uses: ./.github/workflows/manual-qa-matrix.yml` with `target: dev` + `filter: chromium,firefox,webkit`.
- [ ] The call happens AFTER the release PR's main artifacts are deployed (`needs: [deploy]` or equivalent).
- [ ] Call is non-blocking for the release job's success (release ships even if matrix fails; matrix failure surfaces as separate issue).
- [ ] No new cron triggers added.
- [ ] On a real release: matrix runs once; results visible in Actions UI.

### Error paths

- [ ] Matrix call fails (e.g. caller's permissions insufficient) → release job not blocked; failure logged.
- [ ] Matrix flake → operator sees failure but release status unchanged.
- [ ] Filter validation: an unknown browser value rejected by `manual-qa-matrix.yml` with clear error.

### Edge cases

- [ ] Manual dispatch of `manual-qa-matrix.yml` still works (workflow_dispatch trigger preserved alongside workflow_call).
- [ ] Two simultaneous releases (rare) honour the SHY-0031 gh-pages serialization for any artifact-publishing the matrix does.
- [ ] If release.yml doesn't have a clearly-named "deploy" job to depend on, the new job depends on the last success-required job.

### Performance

- [ ] Matrix job adds <20 minutes to overall release latency (matrix runs in parallel cells).
- [ ] No regression in release.yml's existing wall-clock time.

### Security

- [ ] Inherited secrets minimum: only what manual-qa-matrix.yml's own permissions need.
- [ ] No new permission grants required.

### UX

- [ ] Release PR's checks panel shows the matrix outcome as a separate check.
- [ ] Operator can re-run just the matrix without re-triggering the entire release.

### i18n

- [ ] N/A — CI YAML.

### Observability

- [ ] Each cell's outcome visible in Actions UI.
- [ ] Matrix job summary lists per-cell PASS/FAIL.
- [ ] No silent skips (per [[feedback-warnings-are-failures]] + SHY-0019's anti-pattern).

## BDD Scenarios

**Scenario: Release triggers matrix post-deploy**

- **Given** a release PR merges to main
- **And** release.yml's deploy job completes
- **When** the post-release matrix job evaluates
- **Then** `manual-qa-matrix.yml` is invoked with `target: dev, filter: chromium,firefox,webkit`
- **And** matrix results appear as a separate check on the release PR

**Scenario: Matrix failure doesn't block release**

- **Given** matrix cell fails
- **When** release job evaluates
- **Then** release status remains success
- **And** matrix failure surfaces independently

**Scenario: Manual dispatch still works**

- **Given** workflow_dispatch trigger preserved
- **When** operator dispatches manually
- **Then** matrix runs identically to the post-release call

**Scenario: No new cron triggers**

- **Given** grep `.github/workflows/manual-qa-matrix.yml` for `schedule:`
- **When** the PR diff is inspected
- **Then** no `schedule:` block exists
- **And** the file's triggers are `workflow_dispatch` + `workflow_call` only

## Test Plan (TDD)

### Red

1. Add `express-api/tests/workflows/release-calls-matrix.test.js`:
   - Parse `release.yml`; assert a job uses `./.github/workflows/manual-qa-matrix.yml`.
   - Parse `manual-qa-matrix.yml`; assert `on.workflow_call` block exists with inputs.
   - Assert no `schedule:` trigger anywhere.
2. Run `cd express-api && npm test -- release-calls-matrix` → RED.

### Green

1. Add `workflow_call:` block to manual-qa-matrix.yml.
2. Add `qa-matrix-post-release` job to release.yml.
3. Test on a dry-run release (workflow_dispatch with `dry-run=true` if supported).
4. Re-run lint test → GREEN.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits `release.yml` + `manual-qa-matrix.yml`) → the FULL protocol applies. No rendered app/web surface changes here — the behavioural proof is a **real release that actually triggers the real browser matrix** against the real dev backend, not a simulated pipeline.

**Frameworks exercised (RED→GREEN):**
- ✅ **Express Jest** (`release-calls-matrix.test.js`) — parses the **real** `release.yml` + `manual-qa-matrix.yml` on disk (a `workflow_call` job wiring `target: dev` + `filter: chromium,firefox,webkit`; an `on.workflow_call` block with inputs; NO `schedule:` trigger). Real YAML, no fixture workflow.
- ✅ **eslint** (`--max-warnings=0`) — the new test file.
- ✅ **actionlint** — both workflow edits (warnings = failures).
- ⬜ **`scripts/check-action-shas.sh`** — only if a new external action ref is introduced; the `uses: ./.github/workflows/...` local reusable-workflow ref is a path, not a SHA-pinnable marketplace action.
- ⬜ **app/web/iOS UI · Kotlin/detekt/ktlint** — N/A (CI wiring; no app/web/shared code).

**LOCAL gauntlet:** Jest + eslint + actionlint green locally; the web E2E matrix itself (chromium/firefox/webkit on Mac + device browsers) is the regression net for the surfaces a release touches. Any failure → fix TDD → restart.
**DEV gauntlet:** trigger the wired path on the branch `ref` (a real `workflow_dispatch`/dry-run release) and confirm `manual-qa-matrix.yml` is actually invoked post-deploy with the right inputs and runs the real 3-browser matrix non-blocking; web = Chrome for the apps regression. Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt — confirmed on a **real release's** post-deploy matrix invocation (per [[feedback-workflow-verify-by-running]]); NO auto-merge.

## Out of Scope

- **Replacing the existing matrix-cell scripts** — only wiring.
- **Adding new matrix cells** — only the existing 3-browser set.
- **Re-architecting release.yml** — minimum invasive change.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0031** — gh-pages serialization (matrix may publish artifacts via Pages).
- `.github/workflows/release.yml` + `.github/workflows/manual-qa-matrix.yml`.

## Risks & Mitigations

- **Risk:** matrix is slow + blocks operator's perception of release. **Mitigation:** non-blocking; release status unaffected.
- **Risk:** matrix consumes minutes faster than expected. **Mitigation:** monitor via Actions billing page first month; revisit cadence if needed.
- **Risk:** workflow_call permissions don't inherit cleanly. **Mitigation:** document explicit `permissions:` block in manual-qa-matrix.yml.

## Definition of Done

- [ ] workflow_call block added; release.yml calls matrix.
- [ ] Lint test passes; no cron triggers.
- [ ] Tested via real release (post-merge observation).
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): Jest workflow-assertion + eslint + actionlint green → `code-reviewer` 100% clean → push → CI green by name → DEV dispatch confirms the matrix is really invoked post-deploy with the right inputs ([[feedback-workflow-verify-by-running]]) → verified on a real release's post-deploy matrix → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-07 ~21:37 BST — Refined under SHY-0032. Demoted P1 → P2 (Tier 5 CI improvement).
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-G3` (G022, G049).
- 2026-06-13 ~00:50 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): CI-wiring ticket → NOT `*.md`-only → full protocol but no rendered surface; the behavioural proof is a real release actually triggering the real 3-browser matrix against the real dev backend (verified-by-running, [[feedback-workflow-verify-by-running]]). Jest parses the REAL workflow YAML (no fixture). No-Stubs ([[feedback-no-stubs-mocks-fakes-real-only]]): nothing to scrub — real YAML + real release + real matrix. DoD swaps the stale Reviewer-ZERO / `infra→auto-merge` / PR-merged lines for protocol-satisfied + judgment-merge + released_in. Pickup-fitness: AC current; the `filter: chromium,firefox,webkit` web cells are operational today (independent of EPIC-0003's pending device cells), so this is runnable now; SHY-0031 gh-pages serialization dependency stands.
