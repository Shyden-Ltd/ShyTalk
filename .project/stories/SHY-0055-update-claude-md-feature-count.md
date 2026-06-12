---
id: SHY-0055
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: docs
roadmap_ids: [G040]
pr:
mvp: true
---

# SHY-0055: Update CLAUDE.md stale feature-file count (33 → 47)

## User Story

As a future ShyTalk Claude session reading CLAUDE.md for project context, I want **the "feature files" count on `CLAUDE.md:18`** (currently `~235 scenarios across 33 files` per the 2026-06-05 audit but actual count is 47 files) **updated to reflect reality**, so that the project-context briefing isn't subtly wrong from line 18.

## Why

Roadmap row (line 105, 2026-06-05): `G040 | 🟡 Polish | Doc — CLAUDE.md feature file count stale | CLAUDE.md:18 | Says "33 files, 141 scenarios" but actual is 47 files | Update count: grep -r "Scenario:" app/src/androidTest/assets/features/ | wc -l | XS`.

This is a tiny but real correctness gap. CLAUDE.md is read by every Claude session on this repo; stale counts erode trust in everything else on the file.

## Acceptance Criteria

### Happy path

- [ ] Run `ls app/src/androidTest/assets/features/*.feature | wc -l` and `grep -r '^[[:space:]]*Scenario:' app/src/androidTest/assets/features/ | wc -l` to get current file + scenario counts.
- [ ] Update `CLAUDE.md:18` (or wherever the stale count lives after any line shifts) to the actual counts.
- [ ] Inline comment: `<!-- last verified: 2026-06-08 -->` so future audits can spot staleness via the date.

### Error paths

- [ ] **Feature dir reorganised** (e.g. `app/src/androidTest/assets/features/` no longer exists): update CLAUDE.md to reference the new canonical path; verify with grep.
- [ ] **Some feature files use lowercase `scenario:`** (against Gherkin convention): grep should still match via `^[[:space:]]*[Ss]cenario:`; flag the inconsistency for follow-up.
- [ ] **Other stale counts in CLAUDE.md**: surface in PR but don't auto-fix unless trivially adjacent.

### Edge cases

- [ ] **A feature file is currently empty or in-progress**: count it anyway; counts are total file-set not active-scenarios.
- [ ] **Feature outline / scenario template scenarios**: grep `^[[:space:]]*Scenario:` excludes `Scenario Outline:` blocks. Decide based on convention — most projects count Outline as 1 scenario; per-example expansion is separate.
- [ ] **Lockfile-style `_BAK` files in the features dir**: grep should exclude `*.feature.bak` if any.

### Performance

- [ ] N/A.

### Security

- [ ] N/A.

### UX

- [ ] N/A — Claude-facing docs.

### i18n

- [ ] N/A.

### Observability

- [ ] Date stamp in the line tells future audits when last verified.

## BDD Scenarios

**Scenario: Counts reflect current state**

- **Given** `ls app/src/androidTest/assets/features/*.feature | wc -l` produces N
- **And** `grep -r '^[[:space:]]*Scenario:' app/src/androidTest/assets/features/ | wc -l` produces M
- **When** the contributor reads `CLAUDE.md:18`
- **Then** the line references `N files, ~M scenarios`

**Scenario: Stale-date protection**

- **Given** the line carries `last verified: YYYY-MM-DD`
- **When** a future audit reads the date
- **Then** they can decide if a re-count is due (e.g. >90 days)

## Test Plan

**Red:** count fresh; compare to CLAUDE.md current text.

**Green:** edit CLAUDE.md line; add date.

**Coverage gate:** counts match.

## Out of Scope

- Adding a CI gate that fails when the count is stale (consider for SHY-NN follow-up if recurrence becomes annoying).
- Refactoring the feature directory structure.

## Dependencies

- `app/src/androidTest/assets/features/` directory exists.
- `CLAUDE.md` exists.

## Risks & Mitigations

- **Risk: count drifts again within months.** Mitigation: date stamp helps; future SHY can add CI gate.
- **Risk: counting `Scenario Outline:` differently from `Scenario:` causes confusion.** Mitigation: explicit decision documented in this SHY.

## Definition of Done

- [ ] CLAUDE.md updated with fresh counts + date stamp.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`.

## Notes (running log)

- 2026-06-08 ~13:22 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 105 (G040). Reserved ID SHY-0055.
