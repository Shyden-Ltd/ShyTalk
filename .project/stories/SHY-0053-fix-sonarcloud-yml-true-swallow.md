---
id: SHY-0053
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: bug
roadmap_ids: [G036]
pr:
mvp: true
---

# SHY-0053: Remove `|| true` from sonarcloud.yml coverage step (was silently swallowing Jest failures)

## User Story

As a CI-reliability-conscious ShyTalk maintainer, I want **`.github/workflows/sonarcloud.yml:63`'s `|| true`** (which causes the coverage step to exit 0 even when the underlying Jest run fails) **removed OR replaced with `::warning::` emission**, so that Jest test failures during the coverage step surface visibly instead of being silently absorbed into a "coverage was successful" green check.

## Why

Roadmap row (line 84, 2026-06-05): `G036 | 🟡 Polish | CI — || true swallows Jest failures in Sonar coverage | .github/workflows/sonarcloud.yml:63 | Coverage step exits 0 even on test failure | Remove || true OR emit ::warning:: on non-zero | XS`.

[[feedback-warnings-are-failures]] HARD CRITICAL GLOBAL RULE: silent failures are critical. `|| true` is the textbook silent-failure pattern.

## Acceptance Criteria

### Happy path

- [ ] Open `.github/workflows/sonarcloud.yml:63`; identify the exact command being suppressed by `|| true`.
- [ ] Choose between (a) REMOVE — let the step fail loudly when Jest fails; (b) WARN — capture exit code, emit `::warning::` if non-zero, then continue.
- [ ] **Prefer (a) REMOVE** unless the operator has documented a reason coverage-step Jest failures shouldn't fail the workflow.
- [ ] Update inline comment to explain the new behaviour.
- [ ] `actionlint` clean.

### Error paths

- [ ] **Removing `|| true` reveals a pre-existing Jest failure** that was being silently swallowed: fix the Jest failure in the same PR per [[feedback-fix-pre-existing-and-new-same]].
- [ ] **Coverage step requires specific exit code semantics** (e.g. Sonar tolerates exit 0 only): use the WARN path to preserve workflow continuation while still surfacing the failure visibly.

### Edge cases

- [ ] **Multiple `|| true` patterns in the same file**: address all in this PR per the HARD RULE.
- [ ] **Comment style consistency** with other workflow files.

### Performance

- [ ] N/A.

### Security

- [ ] N/A.

### UX

- [ ] N/A — CI.

### i18n

- [ ] N/A.

### Observability

- [ ] On Jest failure post-fix: step exits non-zero + workflow run shows red + Jest error logs visible.
- [ ] Commit: `[SHY-0053] sonarcloud.yml: remove `|| true` Jest failure swallow (G036)`.

## BDD Scenarios

**Scenario: Jest passes → step still passes**

- **Given** sonarcloud.yml's coverage step runs successfully
- **When** Jest exits 0
- **Then** the step exits 0
- **And** the workflow run is green

**Scenario: Jest fails → step now fails loudly (the bug fix)**

- **Given** sonarcloud.yml's coverage step runs
- **When** Jest exits non-zero
- **Then** the step exits non-zero (was: 0 due to || true)
- **And** the workflow run shows red
- **And** Jest error logs are visible in CI

**Scenario: Pre-existing failure surfaced by removing the swallow**

- **Given** removing `|| true` reveals a Jest failure
- **When** the PR's CI runs
- **Then** the failure is visible
- **And** the same PR includes the fix for the surfaced failure (per [[feedback-fix-pre-existing-and-new-same]])

## Test Plan

**Red:** read the workflow file; identify the suppressed command. Hypothesise + verify a Jest failure would surface post-fix.

**Green:**
- Edit sonarcloud.yml line 63.
- Run actionlint.
- If Jest fails post-edit: fix the underlying issue in same PR.

**Coverage gate:** actionlint clean; CI run on the PR succeeds.

## Out of Scope

- Other `|| true` patterns in OTHER workflow files (separate SHYs).
- Re-designing Sonar coverage upload itself.

## Dependencies

- `.github/workflows/sonarcloud.yml` exists.
- `actionlint` for verification.

## Risks & Mitigations

- **Risk: removing the swallow surfaces a long-standing Jest failure.** Mitigation: fix it in same PR.
- **Risk: Sonar genuinely needs exit 0 even on test fail.** Mitigation: WARN path.

## Definition of Done

- [ ] `|| true` removed or replaced with WARN.
- [ ] actionlint clean.
- [ ] Any surfaced Jest failure fixed in same PR.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 84 (G036). Reserved ID SHY-0053.
