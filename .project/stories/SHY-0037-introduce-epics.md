---
id: SHY-0037
status: In Progress
owner: claude
created: 2026-06-08
priority: P0
effort: M
type: infra
roadmap_ids: []
pr:
---

# SHY-0037: Introduce EPICs concept + `epic:` frontmatter field + CLAUDE.md spec updates

## User Story

As a ShyTalk maintainer, I want **a documented EPIC concept (`EPIC-NNNN-slug.md` file format, optional `epic:` field on SHY frontmatter, validator support, CLAUDE.md spec)** so that related SHYs can be grouped under a coherent theme for prioritisation + roadmap surfacing, while keeping the existing SHY workflow intact and avoiding a forced migration of all 60+ existing SHYs in a single PR.

## Why

[[feedback-stories-epics-and-two-surface-sync]] HARD GLOBAL rule (operator 2026-06-07 ~20:48 BST) names EPICs as one of five rules: "EPICs group related SHYs for prioritisation. Each SHY's frontmatter gains an `epic:` field pointing at an `EPIC-NNNN` ID. An `.project/stories/EPIC-NNNN-slug.md` file documents the epic's vision + ordered child SHYs + DoD-at-epic-level."

The framework piece must land before SHY-0038 (public roadmap webpage refactor uses EPIC grouping as a key UX axis) and SHY-0039 (CI auto-sync needs the schema locked).

**Scope alternatives explored (recorded for architect-review)**:

- **Option A (Comprehensive)** — single PR: validator + EPIC file format + 9 EPIC files authored + `epic:` field backfilled across all 60+ existing SHYs + CLAUDE.md update. Diff ~2,500 lines. Rejected: review burden + merge-conflict risk during multi-hour review + rate-limit pressure per [[feedback-rate-limit-slowdown-strategies]] rule #8 ("terser specs").
- **Option B (Phased — chosen)** — this PR: validator + EPIC file format + 1 proof-of-concept EPIC + 6 demonstration SHYs cross-linked + CLAUDE.md update. Backfill of remaining ~54 SHYs deferred to a follow-up SHY (filed as SHY-0060 reserved). Diff ~1,000 lines.
- **Option C (Minimal)** — this PR: validator + EPIC file format + CLAUDE.md only; zero EPIC files, zero SHY cross-links. Rejected: doesn't demonstrate the design end-to-end; architect can't validate that the EPIC file format actually works without seeing one in practice.

Option B balances [[feedback-quality-explore-alternatives-validate]] (validate the design) against [[feedback-rate-limit-slowdown-strategies]] (don't author 2,500 lines in one PR).

## Acceptance Criteria

### Happy path

- [ ] `scripts/check-story-frontmatter.sh` accepts an optional `epic:` frontmatter field; when present, validates `^EPIC-[0-9]{4}$`; when absent, no failure.
- [ ] `scripts/check-epic-frontmatter.sh` is created and validates EPIC files at `.project/stories/EPIC-NNNN-slug.md`; required frontmatter (id/status/owner/created/priority/title) + required body sections (Vision/Scope/Child SHYs/DoD at Epic Level/Notes) + child SHY existence check.
- [ ] `.project/stories/EPIC-0001-shy-framework.md` is authored as proof-of-concept; lists SHY-0001/0002/0003/0032/0036/0037 as child SHYs.
- [ ] SHY-0001/0002/0003/0032/0036/0037 each gain `epic: EPIC-0001` frontmatter (6 SHYs cross-linked).
- [ ] `CLAUDE.md` § Agile Way of Working gains: (a) `epic` as 10th optional frontmatter field row; (b) new `### EPICs` subsection documenting the `EPIC-NNNN` ID format, the EPIC file structure, and the optional-field rule.
- [ ] `SHY-INDEX.md` gains a new `## EPICs` section listing existing EPICs with their child SHY counts.
- [ ] `.github/workflows/lint.yml` (or equivalent) calls the new EPIC validator alongside the SHY validator.
- [ ] Validator scan over the entire `.project/stories/` directory exits 0.

### Error paths

- [ ] **`epic:` field present but malformed** (e.g. `epic: foo` or `epic: EPIC-1` or `epic: EPIC-12345`) — validator exits 11 with category `invalid optional field`.
- [ ] **EPIC file missing required body section** — validator exits 32 with category `missing required ## body section`.
- [ ] **EPIC file `child_shys` array references nonexistent SHY** — validator exits 33 with category `unknown SHY reference`.
- [ ] **EPIC file frontmatter `id:` mismatches filename** — validator exits 31 with category `invalid frontmatter field value`.
- [ ] **SHY references unknown EPIC** (e.g. `epic: EPIC-9999` but no such file) — validator exits 11 (cross-check after EPIC discovery; or exit 16 if a separate code is preferred — architect to validate the choice).

### Edge cases

- [ ] **EPIC file with zero child SHYs** — validator accepts (epic may pre-date its first child SHY); body section `## Child SHYs` may say `(none yet — pre-creation)`.
- [ ] **SHY with `epic:` field but EPIC file not yet created** — validator FAILS (forward-reference protection); architect to confirm vs allow with warning.
- [ ] **Two EPICs claiming the same child SHY** — validator FAILS with category `duplicate epic claim`; child SHY must belong to ≤1 EPIC at a time.
- [ ] **`epic:` field on a Cancelled SHY** — accepted (audit trail preservation); the EPIC file may or may not still list it.
- [ ] **EPIC ID collision** (two `EPIC-0001-*.md` files with different slugs) — validator FAILS; one EPIC per ID.

### Performance

- [ ] Validator scan over 60 SHYs + 1 EPIC takes <2s on the standard CI runner (current baseline ~1.5s for 60 SHYs alone).
- [ ] No quadratic blowups: child-SHY existence check is `O(SHY × EPIC)` worst case — for 60×9 the limit is 540 path checks which is bounded.

### Security

- [ ] Validator does NOT follow symlinks (already enforced via `find -P ... ! -type l` in the existing SHY validator; replicate in EPIC validator).
- [ ] No user-controlled string is passed unquoted to shell commands; all regex matching uses bash built-ins, not eval.
- [ ] EPIC filename glob is anchored to `^EPIC-[0-9]{4}-[a-z0-9-]+\.md$` — no path traversal possible.

### UX

- [ ] CLAUDE.md update reads cleanly when viewed standalone — EPIC section is self-contained, doesn't require cross-references to understand.
- [ ] Validator failure messages name the violated rule (e.g. `epic: must match ^EPIC-[0-9]{4}$, got 'foo'`).
- [ ] EPIC-0001 file is concise (~80-120 lines, not a SHY-1 638-line behemoth) — sets the tone for future EPICs.

### i18n

- [ ] N/A — internal developer-facing tooling; no end-user strings.

### Observability

- [ ] CI lint job log shows separate lines for SHY validator + EPIC validator success counts.
- [ ] On scan failure: machine-parseable stderr per existing convention `<path>: <category>: <details>`.

## BDD Scenarios

**Scenario: SHY with valid epic field passes validation**

- **Given** a SHY file with `epic: EPIC-0001` frontmatter
- **And** `EPIC-0001-shy-framework.md` exists in `.project/stories/`
- **When** `scripts/check-story-frontmatter.sh <file>` runs
- **Then** exit code is 0
- **And** the SHY is valid

**Scenario: SHY without epic field still passes (backward compat)**

- **Given** a SHY file without `epic:` frontmatter (the existing default)
- **When** the SHY validator runs
- **Then** exit code is 0
- **And** the SHY is valid — `epic:` is optional

**Scenario: SHY with malformed epic field fails fast**

- **Given** a SHY file with `epic: foo` (not matching `^EPIC-[0-9]{4}$`)
- **When** the SHY validator runs
- **Then** exit code is 11
- **And** stderr names the violating field + the required regex

**Scenario: EPIC validator catches missing body section**

- **Given** an `EPIC-NNNN-*.md` file missing the `## Vision` section
- **When** `scripts/check-epic-frontmatter.sh <file>` runs
- **Then** exit code is 32
- **And** stderr names `missing required ## body section: Vision`

**Scenario: EPIC validator catches duplicate child SHY claim**

- **Given** two EPIC files both listing `SHY-0001` in `child_shys`
- **When** the EPIC validator scans the directory
- **Then** exit code is 33
- **And** stderr names both EPIC files + the contested SHY ID

## Test Plan

**Red:**
- Add a Jest test file `express-api/tests/scripts/check-epic-frontmatter.test.js` covering EPIC validator's required fields, body sections, child-SHY existence check, glob safety. Expected fail before script exists.
- Add Jest test cases to `express-api/tests/scripts/check-story-frontmatter.test.js` for the new `epic:` optional field — present/valid passes, present/malformed fails 11, absent passes. Expected fail before script modification.

**Green:**
- Author `scripts/check-epic-frontmatter.sh` mirroring the SHY validator structure (635 lines is overkill for the EPIC scope; aim ~200 lines).
- Modify `scripts/check-story-frontmatter.sh` — add `OPTIONAL_FIELDS` list, add `VALID_EPIC="^EPIC-[0-9]{4}$"` constant, add `validate_optional_epic_field()` check function.
- Wire `.github/workflows/lint.yml` to run the EPIC validator scan after the SHY validator.
- Run `bash scripts/check-story-frontmatter.sh --scan .project/stories` + `bash scripts/check-epic-frontmatter.sh --scan .project/stories` — both EXIT=0.
- Run `npx jest --testPathPattern check-(epic|story)-frontmatter` — all tests pass.

**Coverage gate:** Jest line-coverage on validator scripts ≥95% per existing project convention; mutation tests not required for shell scripts.

## Out of Scope

- **Backfilling `epic:` across the other ~54 existing SHYs** — filed as SHY-0060 (reserved); this PR only cross-links 6 SHYs as proof-of-concept (SHY-0001/0002/0003/0032/0036/0037).
- **Authoring EPICs 0002-0009** — filed as SHY-0061..0068 (reserved when this PR merges); each EPIC is its own SHY to keep PRs reviewable.
- **Public roadmap webpage refactor to surface EPICs** — SHY-0038 territory.
- **CI auto-sync from SHY .md to roadmap-data.json / GitHub Project board** — SHY-0039 territory.
- **Migrating GitHub Project board to add an `Epic` custom-field column** — operator manual provision (task #34); not blocking this PR.
- **Making `epic:` field required** — never automatic; if/when it should become required, file a new SHY with explicit operator approval (legacy SHYs would need migration first).

## Dependencies

- `scripts/check-story-frontmatter.sh` exists (delivered by SHY-0001 at #1034) — modify, don't recreate.
- `express-api/tests/scripts/check-story-frontmatter.test.js` exists (delivered by SHY-0001) — extend with new test cases.
- `.github/workflows/lint.yml` exists — extend with EPIC validator step.
- `CLAUDE.md` exists — extend § Agile Way of Working.
- No external API or service dependencies.

## Risks & Mitigations

- **Risk: validator scan slowdown** if EPIC cross-checks degrade to O(SHY²). Mitigation: build the EPIC→SHY claim index once at scan-start, then O(1) lookup per SHY. AC requires <2s on CI.
- **Risk: cross-link in SHY-0036 (already merged) requires touching a Done SHY** — could be seen as a backward edit. Mitigation: cross-linking is a frontmatter-only addition (`epic:` field), doesn't alter the story content; allowed under the audit-trail-preservation rule. Architect to confirm.
- **Risk: forward-reference protection (SHY claims EPIC that doesn't exist yet) may cause CI flakes** during multi-PR rollouts. Mitigation: in THIS PR, all 6 cross-linked SHYs reference EPIC-0001 which IS being created in the same PR. Future migrations stage EPIC-file-first, then SHY-cross-links.
- **Risk: operator wants `epic:` to be REQUIRED from day 1** — would force backfill into this PR. Mitigation: keep optional in this PR; ask operator before bumping to required (separate SHY).
- **Risk: EPIC file format requires lifecycle states (Active/Done/Cancelled) too** — adds complexity. Mitigation: mirror SHY lifecycle exactly; reuse `VALID_STATUS` regex constant.

## Definition of Done

- [ ] SHY-0037 spec passes the SHY frontmatter validator.
- [ ] `scripts/check-epic-frontmatter.sh` exists + is executable.
- [ ] `scripts/check-story-frontmatter.sh` accepts optional `epic:` field with regex validation.
- [ ] Jest tests for both validators pass; coverage ≥95% on touched files.
- [ ] `EPIC-0001-shy-framework.md` exists + passes EPIC validator.
- [ ] 6 SHYs cross-linked to EPIC-0001 in frontmatter.
- [ ] CLAUDE.md § Agile Way of Working updated with `epic` field row + `### EPICs` subsection.
- [ ] SHY-INDEX.md gains `## EPICs` section.
- [ ] `.github/workflows/lint.yml` invokes EPIC validator.
- [ ] CI green; reviewer ZERO findings.
- [ ] PR squash-merged; SHY-0037 status flipped Done with PR link.

## Notes (running log)

- 2026-06-08 ~14:56 BST — Spec authored on `story/SHY-0037-introduce-epics` branch (HEAD `0ad76aba61b` — SHY-0036 close-out commit). Scope locked to Option B per design exploration above. Architect-review pending per [[feedback-quality-explore-alternatives-validate]].
