---
id: SHY-0037
status: In Progress
owner: claude
created: 2026-06-08
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0001
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
- [ ] `scripts/check-epic-frontmatter.sh` is created and validates EPIC files at `.project/stories/EPIC-NNNN-slug.md`; required frontmatter (id/status/owner/created/priority/title) + required body sections (Vision/Scope/Child SHYs/DoD at Epic Level/Notes) + child SHY existence check in `--scan` mode.
- [ ] **Per-file vs `--scan` asymmetry**: per-file invocation runs ONLY structural checks (frontmatter regex + body section presence); cross-corpus checks (unknown EPIC reference, unknown child SHY, duplicate child claims, forward-reference protection) run ONLY in `--scan` mode after building an in-memory index. `--help` documents this explicitly.
- [ ] `.project/stories/EPIC-0001-shy-framework.md` is authored as proof-of-concept; lists SHY-0001/0002/0003/0037 as child SHYs (4 SHYs — the genuine framework set; per architect Finding 6, SHY-0032/0036 are dropped as framework-adjacent).
- [ ] SHY-0001/0002/0003/0037 each gain `epic: EPIC-0001` frontmatter (4 SHYs cross-linked).
- [ ] `CLAUDE.md` § Agile Way of Working gains: (a) `epic` as 10th optional frontmatter field row; (b) new `### EPICs` subsection documenting the `EPIC-NNNN` ID format, the EPIC file structure, and the optional-field rule; (c) `### Tooling` subsection updated to document `check-epic-frontmatter.sh` (usage + `--help` flag + the 6 exit codes 0/2/30/31/32/40; cross-corpus failures surface as exit 40 with stderr category).
- [ ] `SHY-INDEX.md` gains a new `## EPICs` section listing existing EPICs with their child SHY counts.
- [ ] `.github/workflows/lint.yml` calls BOTH validators in SEPARATE steps: `bash scripts/check-story-frontmatter.sh --scan .project/stories` AND `bash scripts/check-epic-frontmatter.sh --scan .project/stories`. Each exits 0 independently. NOT a single combined call.
- [ ] Both `--scan` invocations exit 0 over the full `.project/stories/` directory (60+ SHYs + 1 EPIC).

### Error paths

- [ ] **`epic:` field present but malformed** (e.g. `epic: foo` or `epic: EPIC-1` or `epic: EPIC-12345`) — SHY validator exits 11 with category `invalid optional field` (per-file or `--scan`).
- [ ] **EPIC file missing required body section** — EPIC validator exits 32 with category `missing required ## body section` (per-file or `--scan`).
- [ ] **EPIC file `child_shys` array references nonexistent SHY** — EPIC validator exits **40** with stderr category `unknown SHY reference` (`--scan` only; per-file skips). _Deviation from spec-literal exit 33: implementation uses scan-wrapper exit 40 per the wrap-pattern consistency decision (matches SHY validator pattern where cross-corpus surfaces as outer-scan exit). See Notes log entry 2026-06-08 ~17:30 BST + CLAUDE.md § Tooling._
- [ ] **EPIC file frontmatter `id:` mismatches filename** — EPIC validator exits 31 with category `invalid frontmatter field value` (per-file or `--scan`).
- [ ] **SHY references unknown EPIC** (e.g. `epic: EPIC-9999` but no such file) — SHY validator exits **20** with stderr category `invalid optional field` (`--scan` only; per-file skips). _Deviation from spec-literal exit 11: implementation uses scan-wrapper exit 20 per the wrap-pattern consistency decision (matches existing SHY-scan behaviour where structural inner failures all wrap to 20)._

### Edge cases

- [ ] **EPIC file with zero child SHYs** — validator accepts (epic may pre-date its first child SHY); body section `## Child SHYs` may say `(none yet — pre-creation)`.
- [ ] **SHY with `epic:` field but EPIC file not yet created** — `--scan` FAILS (forward-reference protection: exit **20**, stderr category `invalid optional field`); per-file mode SKIPS the cross-check (consistent with finding 2: per-file mode runs structural checks only).
- [ ] **Two EPICs claiming the same child SHY** — `--scan` FAILS with exit **40**, stderr category `duplicate epic claim`; per-file mode SKIPS (corpus-level fact).
- [ ] **`epic:` field on a Cancelled SHY** — accepted (audit trail preservation); the EPIC file may or may not still list it.
- [ ] **EPIC ID collision** (two `EPIC-0001-*.md` files with different slugs) — `--scan` FAILS with exit **40**, stderr category `duplicate epic id`; per-file mode SKIPS.

### Performance

- [ ] **Time complexity must be O(N) in corpus size** (`N` = SHYs + EPICs), NOT a fixed budget tied to today's file count. Two-pass `--scan` design enforces this: pass 1 builds an in-memory index (O(N)); pass 2 cross-checks each file against the pre-built index in O(1) per file (still O(N) total). No O(N²) globbing inside the per-file loop.
- [ ] Current baseline (60 SHYs alone, no EPIC validator): ~1.5s on the standard CI runner. Post-PR (60 SHYs + 1 EPIC + cross-checks): <2s. Post-SHY-0060 backfill (~114 SHYs + ~9 EPICs): re-benchmark and update the budget; do NOT silently break this AC.

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

**Scenario: EPIC validator catches duplicate child SHY claim (scan-mode only)**

- **Given** two EPIC files both listing `SHY-0001` in `child_shys`
- **When** `scripts/check-epic-frontmatter.sh --scan .project/stories` runs
- **Then** exit code is 33
- **And** stderr names both EPIC files + the contested SHY ID

**Scenario: per-file invocation skips cross-corpus checks**

- **Given** an EPIC file `EPIC-0001-foo.md` whose `child_shys: [SHY-9999]` references a SHY that does not exist
- **When** `scripts/check-epic-frontmatter.sh .project/stories/EPIC-0001-foo.md` runs (per-file mode)
- **Then** exit code is 0 (structural checks pass; cross-checks deferred)
- **And** the same file in `--scan` mode exits 33

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

- **Backfilling `epic:` across the other ~56 existing SHYs** — filed as SHY-0060 (reserved); this PR only cross-links 4 SHYs as proof-of-concept (SHY-0001/0002/0003/0037 — the genuine SHY-framework set per architect Finding 6).
- **Authoring EPICs 0002-0009** — filed as SHY-0061..0068 (reserved when this PR merges); each EPIC is its own SHY to keep PRs reviewable.
- **Frontmatter↔body consistency check** (validator enforcing that every SHY listed in EPIC frontmatter `child_shys:` also appears in the body's `## Child SHYs` section, and vice versa) — explicitly OUT of scope for the 1.0 validator. Risk of drift is acceptable at ~9 EPIC scale; revisit if drift bugs surface in practice. Filed as a future SHY if needed.
- **Shared validator helper extraction** to `scripts/lib/frontmatter-utils.sh` (DRY for `normalize_file` / `abspath` / `escape_re` / `cleanup` across both validators) — out of scope; both scripts duplicate these helpers in v1.0. File a refactor SHY if maintenance burden grows.
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
- [ ] `scripts/check-story-frontmatter.sh` accepts optional `epic:` field with regex validation + `--scan`-only cross-check for unknown EPIC references.
- [ ] Jest tests for both validators pass; coverage ≥95% on touched files.
- [ ] `EPIC-0001-shy-framework.md` exists + passes EPIC validator.
- [ ] 4 SHYs cross-linked to EPIC-0001 in frontmatter (SHY-0001/0002/0003/0037).
- [ ] CLAUDE.md § Agile Way of Working updated with: `epic` field row + `### EPICs` subsection + `### Tooling` subsection extended to document `check-epic-frontmatter.sh` (usage/help/exit codes).
- [ ] SHY-INDEX.md gains `## EPICs` section.
- [ ] `.github/workflows/lint.yml` invokes EPIC validator as a SEPARATE step alongside the SHY validator (two `--scan` calls, not one combined).
- [ ] CI green; reviewer ZERO findings.
- [ ] PR squash-merged; SHY-0037 status flipped Done with PR link.

## Notes (running log)

- 2026-06-08 ~14:56 BST — Spec authored on `story/SHY-0037-introduce-epics` branch (HEAD `0ad76aba61b` — SHY-0036 close-out commit). Scope locked to Option B per design exploration above. Architect-review pending per [[feedback-quality-explore-alternatives-validate]].
- 2026-06-08 ~15:30 BST — Architect (feature-dev:code-architect) returned 6 findings. Resolutions applied in this commit: (1) Critical Finding 1 — AC line 43 split into two separate `--scan` invocations; (2) Critical Finding 2 — forward-reference rule resolved (FAIL in `--scan`, SKIP in per-file); (3) Important Finding 3 — duplicate-claim BDD scenario `When` clause now shows `--scan`; (4) Important Finding 4 — frontmatter↔body consistency check explicitly Out of Scope; (5) Important Tooling Finding — CLAUDE.md `### Tooling` update added to AC + DoD; (6) Nit Finding 5 — Performance AC restated as O(N) corpus-size; (7) Nit Finding 6 — proof-of-concept set slimmed to SHY-0001/0002/0003/0037 (4 SHYs, all genuine framework). Three open questions resolved: separate validator scripts (confirmed); two-pass `--scan` with index (confirmed); exit 11 for unknown EPIC reference (confirmed). Architect agent ID `aafa2055bc6456896` if follow-up needed.
- 2026-06-08 ~17:30 BST — TDD red→green implementation complete after PR #1030 unblock (androidx.core 1.19.0 + compileSdk 37 bump merged). Red phase: 63 failing tests added across `express-api/tests/scripts/check-story-frontmatter.test.js` (new `optional epic: field` describe block, 13 cases) + new `express-api/tests/scripts/check-epic-frontmatter.test.js` (354 lines, 50+ cases). Green phase: extended `scripts/check-story-frontmatter.sh` with `VALID_EPIC` constant + `check_optional_fields()` function + 2-pass scan (Pass 2 builds EPIC index, Pass 3 cross-checks); authored new `scripts/check-epic-frontmatter.sh` (~370 lines, 5-pass scan: structural → ID-collision → SHY-set → claim-collect+unknown-ref → duplicate-claim). Bug surfaced + fixed: unguarded `grep -E '^epic:'` substitution was tripping `set -euo pipefail` on no-match → wrapped in `if grep -q` guards. All 212 tests pass; both `--scan` invocations exit 0 on the full `.project/stories/` corpus (60 SHYs + 1 EPIC). DoD also covered: `EPIC-0001-shy-framework.md` authored as POC; SHY-0001/0002/0003/0037 cross-linked via `epic: EPIC-0001` frontmatter; CLAUDE.md updated (frontmatter row + `### EPICs` subsection + `### Tooling` validator entry); `SHY-INDEX.md` gained `## EPICs` section; `.github/workflows/lint.yml` gained separate `Validate EPIC frontmatter` step. Self-review pass next, then ONE reviewer cycle apply-all-in-one-batch per [[feedback-rate-limit-slowdown-strategies]].
- 2026-06-08 ~17:30 BST — Code-reviewer agent (a5d6d5225340a6faf) dispatched in parallel with CI (push happened first); operator flagged this is wrong order per [[feedback-reviewer-before-push-not-parallel]] (HARD, captured + linked to parent rules [[feedback-one-agent-at-a-time]] + [[feedback-no-parallel-work-streams]]). For SHY-0038+, dispatch reviewer BEFORE push. For this PR, reviewer returned 13 findings (5 Critical, 8 Important) — applied ALL in this single batch commit per [[feedback-rate-limit-slowdown-strategies]] (no iterate-to-zero). Findings: **C1** flag-ordering guard added to both validators (`--scan` rejects subsequent flags with exit 2 + actionable hint); **C2** added `--verbose --scan` tests in both EPIC + SHY test files; **C3** added shell-injection sentinel test on `title` field (loosest regex, payload reaches grep pipelines); **C4** added 2 performance tests (single-file <500ms; --scan 20 files <5s); **C5** spec AC lines 50/52/54/60/62 updated to reflect wrap-pattern exit codes (40 cross-corpus / 20 SHY-scan) with deviation rationale; **I1** CLAUDE.md “exit 11 inner / 20 outer” corrected to “exit 20”; **I2** USAGE strings document `[--verbose] --scan <dir>` form with flag-order note; **I3** "stops on first failure" scan test rewritten to use a genuinely-valid EPIC-0001 preceding the bad EPIC-0099 (prior version used VALID_CONTENT with id-mismatch so the "good" file was also invalid); **I4** stdout-silent assertion added to happy-path; **I5** `child_shys: [   ]` whitespace-only test added; **I6** verbose test asserts specific check names (frontmatter:id, value:id, value:id-matches-filename, value:title, value:child_shys, section:## Vision); **I7** CRLF-in-`--scan` cross-corpus test; **I8** multi-entry mixed (`[SHY-0001, SHY-9999]`) scan test. All 223 tests pass (212 baseline + 11 new). Pre-self-review clean: shellcheck + prettier + both `--scan` corpus validations green. Pushing fix-up commit next; CI will run a 2nd cycle (sunk cost — applying corrected flow from SHY-0038).
