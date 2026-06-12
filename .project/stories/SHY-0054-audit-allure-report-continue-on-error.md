---
id: SHY-0054
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: chore
roadmap_ids: [G037]
pr:
mvp: true
---

# SHY-0054: Audit `.github/workflows/allure-report.yml:117`'s `continue-on-error: true`

## User Story

As a CI-reliability-conscious ShyTalk maintainer, I want **`.github/workflows/allure-report.yml:117`'s `continue-on-error: true`** (which silently swallows step failures) **audited** — either the intent is documented inline AND the step's failures are surfaced via `::warning::`, OR the directive is removed entirely.

## Why

Roadmap row (line 85, 2026-06-05): `G037 | 🟡 Polish | CI — continue-on-error: true in allure-report | .github/workflows/allure-report.yml:117 | Intent unclear; confirm intentional or remove | Read step context, add comment if intentional, remove if not | XS`.

Companion pattern to [[SHY-0053]] (`|| true` swallow). Same [[feedback-warnings-are-failures]] hard rule applies.

## Acceptance Criteria

### Happy path

- [ ] Read `.github/workflows/allure-report.yml:117` + surrounding context to determine step intent.
- [ ] Categorise: (a) `continue-on-error` is INTENTIONAL — add an inline comment explaining why + add `::warning::` emission on failure; (b) `continue-on-error` is OVERSIGHT — remove it.
- [ ] If kept: `if: failure()` follow-up step emits `::warning::Allure report step failed: <reason>` so failure is at least visible in CI summary.
- [ ] `actionlint` clean.

### Error paths

- [ ] **Removing surfaces a pre-existing step failure**: fix in same PR per [[feedback-fix-pre-existing-and-new-same]].
- [ ] **Step is genuinely best-effort** (e.g. gh-pages deploy that races with another workflow): preserve `continue-on-error` + add the WARN.

### Edge cases

- [ ] **Other `continue-on-error` in the same file**: address all per HARD RULE.
- [ ] **The step's failure has downstream effects** (e.g. broken gh-pages site): WARN must be loud enough that someone notices.

### Performance

- [ ] N/A.

### Security

- [ ] N/A.

### UX

- [ ] N/A — CI.

### i18n

- [ ] N/A.

### Observability

- [ ] If kept: failures show in CI summary as `::warning::` annotations.
- [ ] Inline comment explains decision + rationale.

## BDD Scenarios

**Scenario: Failure surfaces (audit conclusion = oversight)**

- **Given** the step is removed
- **When** the underlying command fails
- **Then** the workflow run shows red

**Scenario: Intent documented (audit conclusion = intentional)**

- **Given** the step retains `continue-on-error: true`
- **When** a reader of the file scans line 117
- **Then** an inline comment explains the rationale
- **And** an `if: failure()` follow-up step exists to emit a `::warning::`

## Test Plan

**Red:** read the workflow file; characterise the step's intent.

**Green:**
- Make audit decision + apply.
- actionlint clean.

**Coverage gate:** actionlint pass; CI run green or instructive-failure.

## Out of Scope

- Other workflow files with `continue-on-error`.
- Re-architecting Allure report publishing.

## Dependencies

- `.github/workflows/allure-report.yml` exists.

## Risks & Mitigations

- **Risk: removing breaks gh-pages deploy chain.** Mitigation: read the step context first; preserve if needed.
- **Risk: WARN annotations get ignored.** Mitigation: also output to GITHUB_STEP_SUMMARY for visibility.

## Definition of Done

- [ ] Audit decision applied.
- [ ] actionlint clean.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 85 (G037). Reserved ID SHY-0054.
