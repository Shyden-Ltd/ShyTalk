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

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits `sonarcloud.yml`) → the FULL protocol applies. No app/web surface; the proof is the **real SonarCloud workflow** behaving correctly on a real run. (This ticket is itself the No-Stubs / warnings-are-failures principle in CI form — a `|| true` is "make it green without making it real.")

**Frameworks exercised (RED→GREEN):**
- ✅ **actionlint** — the `sonarcloud.yml` edit (warnings = failures).
- ✅ **Express Jest** — the coverage step runs the **real** Jest suite; the fix is that a real Jest failure now surfaces (red) instead of being swallowed. If an optional assertion is added, it reads the **real** `sonarcloud.yml` and asserts no `|| true` remains on the coverage step.
- ⬜ **app/web/iOS UI · Kotlin/detekt/ktlint** — N/A.

**No-Stubs / verified-by-running:** the loud-failure behaviour is **proven by inducing a REAL Jest failure** on a scratch run and confirming the step + workflow go red (then revert) — NOT asserted from the YAML alone (per [[feedback-workflow-verify-by-running]]); the green path is a real passing run. If removing `|| true` surfaces a real pre-existing Jest failure, fix it in THIS PR ([[feedback-fix-pre-existing-and-new-same]]). The WARN-path fallback still **emits a visible `::warning::`** — never a silent swallow ([[feedback-warnings-are-failures]]); a warning counts as a failure to fix, not to tolerate.

**LOCAL gauntlet:** actionlint clean; the real Jest suite green locally; the induced-failure proof done on a scratch run. Any failure → fix → restart.
**DEV gauntlet:** push to the branch and confirm the **real** SonarCloud workflow's coverage step is green on a passing Jest run (and would go red on failure, per the scratch proof). Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge.

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
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): actionlint clean + real Jest green + the loud-failure behaviour proven by a real induced failure (verified-by-running) → `code-reviewer` 100% clean → push → CI green by name (real SonarCloud workflow) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 84 (G036). Reserved ID SHY-0053.
- 2026-06-13 ~01:18 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): this ticket IS the No-Stubs/warnings-are-failures principle in CI form (`|| true` = green-without-real). Proof framework = actionlint + the real Jest coverage run + **verified-by-running** the loud-failure path via a REAL induced Jest failure on a scratch run ([[feedback-workflow-verify-by-running]]), not YAML-only assertion; any surfaced pre-existing failure fixed in-PR ([[feedback-fix-pre-existing-and-new-same]]); the WARN fallback still emits a visible `::warning::` (never a silent swallow). DoD swaps the stale Reviewer-ZERO line for protocol-satisfied + judgment-merge + released_in + `pr:`. Pickup-fitness: AC current; the `:63` line number + whether multiple `|| true` exist in the file to re-confirm at pickup.
