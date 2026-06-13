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

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits `allure-report.yml`) → the FULL protocol applies. No app/web surface; the proof is the **real allure-report workflow** behaving correctly on a real run. Companion to [[SHY-0053]] — `continue-on-error: true` is the same silent-swallow family as `|| true`.

**Frameworks exercised (RED→GREEN):**
- ✅ **actionlint** — the `allure-report.yml` edit (warnings = failures).
- ⬜ **Express Jest** — N/A unless an optional structural assertion is added against the **real** YAML (the allure step publishes a report; it doesn't run Jest).
- ⬜ **app/web/iOS UI · Kotlin/detekt/ktlint** — N/A.

**No-Stubs / verified-by-running:** whichever audit branch is chosen, **prove it on a real run** ([[feedback-workflow-verify-by-running]]) — if REMOVED, induce a real step failure on a scratch run and confirm the workflow goes red; if KEPT (genuinely best-effort, e.g. a gh-pages deploy that races per [[SHY-0031]]), induce a real failure and confirm the `if: failure()` step **really emits a visible `::warning::` + writes to `GITHUB_STEP_SUMMARY`** — a WARN that doesn't actually fire is a swallow in disguise ([[feedback-warnings-are-failures]]). Any pre-existing failure surfaced by removal is fixed in THIS PR ([[feedback-fix-pre-existing-and-new-same]]).

**LOCAL gauntlet:** actionlint clean; the induced-failure visibility proof done on a scratch run. Any failure → fix → restart.
**DEV gauntlet:** push to the branch and confirm the **real** allure-report workflow behaves per the audit decision (green on success; visibly red/WARNed on the induced failure). Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge.

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
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): actionlint clean + the audit decision proven on a real run (verified-by-running; the WARN path actually fires if kept) → `code-reviewer` 100% clean → push → CI green by name (real allure-report workflow) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 85 (G037). Reserved ID SHY-0054.
- 2026-06-13 ~01:21 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): companion to [[SHY-0053]] — `continue-on-error: true` is the same silent-swallow family. Proof = actionlint + **verified-by-running** the audit decision on a real run ([[feedback-workflow-verify-by-running]]): if removed → real induced failure goes red; if kept (best-effort gh-pages race per [[SHY-0031]]) → confirm the `if: failure()` step REALLY emits `::warning::` + `GITHUB_STEP_SUMMARY` (a non-firing WARN is a disguised swallow). No-Stubs ([[feedback-no-stubs-mocks-fakes-real-only]]): nothing to mock; the real workflow run is the proof. DoD swaps the stale Reviewer-ZERO line for protocol-satisfied + judgment-merge + released_in + `pr:`. Pickup-fitness: AC current; the `:117` line number + whether other `continue-on-error` exist in the file to re-confirm at pickup.
