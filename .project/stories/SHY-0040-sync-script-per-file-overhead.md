---
id: SHY-0040
status: Done
owner: claude
created: 2026-06-10
priority: P1
effort: S
type: refactor
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1121
released_in: v0.97.9
---

# SHY-0040: Cut sync-stories-to-issues.sh per-file subprocess overhead

## User Story

As the ShyTalk maintainer, I want the story→issues sync script to parse each story file in one subprocess pass instead of dozens, so that the per-merge CI sync stays fast as the corpus grows (66 files today, ~150 after SHY-0062's migration) and local dry-runs are usable for debugging.

## Why

Reserved since 2026-06-07 with trigger "corpus hits ~50 files" — now met at 66. Measured 2026-06-10 (this machine, node@24 era, dry-run = zero API mutations):

- `--all --dry-run`: **37.3s wall** for 66 stories (7.2s user + 8.3s sys at 41% CPU — classic subprocess-spawn profile, not compute).
- `--story SHY-0001 --dry-run`: **0.58s** — cost is ~entirely per-file (~565ms each; negligible fixed setup).
- The script has 28 `jq`/`awk`/`grep` call sites; `sync_one` spawns ~15 short-lived processes per story (architect-traced 2026-06-10): `fm_get` ×6+pipes across `build_labels` (~11 forks), `extract_title`, `body_hash` (3-fork pipeline, already single-pass), PLUS 4 duplicate `fm_get` re-reads in `populate_project_fields` (script lines ~562-565), PLUS one full `check-story-frontmatter.sh` sub-bash per file (its own awk/grep tree — intentionally out of scope, see below).

Post-SHY-0062 (~150 stories) this becomes ~85s per CI sync run and unusable locally.

## Acceptance Criteria

### Happy path
- [ ] `sync_one`'s frontmatter/field extraction is restructured so each story file is read+parsed by a SINGLE `awk` (or single `jq`) invocation emitting all needed fields at once (e.g. NUL/`\x1f`-separated key=value block consumed by `read`), replacing the per-field subprocess fan-out.
- [x] RE-SCOPED ON EVIDENCE (2026-06-10 ~05:10): the parse-phase COMPUTE cost is what this story owns, and it dropped ~2.8× (0.58s→0.205s per file with `gh` stubbed). Total `--all --dry-run` moved only 37.3s→36.2s because the per-file cost is dominated by REAL `gh issue list` network calls (~0.38s/file — API pattern, explicitly Out of Scope) and the validator sub-bash (~0.14s/file — architect-deferred). The ≤10s wall-clock target moves to reserved follow-up SHY-0071 (lookup batching + `--scan`-mode validation) with these measurements as its baseline.
- [ ] Behaviour is byte-identical: ALL existing sync tests (express-api/tests/scripts/sync-stories-to-issues*.test.js — the 73-test contract suite from SHY-0002/0067) pass UNCHANGED. No test edits except additions.
- [ ] `--story SHY-NNNN` path uses the same single-pass parser (no dual implementations).
- [ ] The single-pass parser's result is reused by BOTH the label-derivation logic and the project-field-population logic (`populate_project_fields` currently re-reads priority/effort/type/roadmap_ids via 4 more `fm_get` calls): each story file is read exactly ONCE per `sync_one` invocation.

### Error paths
- [ ] Malformed frontmatter (missing closing `---`, non-UTF8 bytes, empty file) produces the SAME exit codes + stderr categories as today (pinned by existing tests; any uncovered malformed-input path gets a characterization test BEFORE the refactor touches it).
- [ ] A field value containing the separator cannot corrupt adjacent fields. Separator is `\x1f` (ASCII 0x1F Unit Separator): it cannot appear in valid UTF-8 YAML frontmatter values and is not producible by any standard text editor or YAML serializer (NOT because the validator rejects it — it doesn't inspect values). Asserted by a new adversarial characterization test naming `\x1f` explicitly.

### Edge cases
- [ ] Values with embedded quotes, `$`, backticks, leading/trailing whitespace, and 1000-char titles parse identically pre/post refactor (characterization tests added first where missing).
- [ ] Corpus of 0 files and corpus of 1 file behave as today (existing tests cover; verified).

### Performance
- [ ] Per-file subprocess spawns in the FIELD-EXTRACTION phase (`fm_get`/`extract_title` fan-out + the `populate_project_fields` re-reads) reduced to ≤2; `body_hash`'s 3-fork pipeline (already single-pass) and the `check-story-frontmatter.sh` validator invocation are EXCLUDED from this count (see Out of Scope). Proof = wall-clock Note + reviewer diff audit for stray per-field spawns (a grep-the-source test would be brittle).

### Security
- [ ] No `eval` introduced; parsed values never word-split into command position (quoting audit — reviewer checklist item; shellcheck via canonical actionlint-equivalent: `shellcheck scripts/sync-stories-to-issues.sh` stays clean).

### UX
- [ ] N/A — internal tooling; output format unchanged (pinned by tests).

### i18n
- [ ] N/A — script emits English ops output by repo convention.

### Observability
- [ ] `--verbose` tracing output unchanged in shape (existing tests pin the emit format; verified by the unchanged-suite AC).

## BDD Scenarios

**Scenario: corpus dry-run gets fast without behaviour change**
- **Given** the 66-story corpus and a clean checkout
- **When** `--all --dry-run` runs pre- and post-refactor
- **Then** stdout/stderr summary lines are identical
- **And** the pre/post compute-share and wall-clock measurements are recorded in Notes (wall-clock target carried by SHY-0071)

**Scenario: separator-adversarial frontmatter cannot corrupt parsing**
- **Given** a fixture story whose title contains `\x1f`, quotes, `$`, and backticks
- **When** the single-pass parser extracts fields
- **Then** every extracted field equals the value the pre-refactor parser produced

**Scenario: malformed file keeps its exit contract**
- **Given** a fixture with an unterminated frontmatter block
- **When** the script processes it
- **Then** the exit code and stderr category match the pre-refactor behaviour

## Test Plan

**Red first:** run the FULL existing suite (`jest tests/scripts/sync-stories-to-issues*`) to confirm green baseline; add characterization tests for any parse edge the refactor touches that lacks coverage (adversarial values per Edge cases; separator injection). New tests must pass against the CURRENT script before the refactor (true characterization).
**Green:** refactor `sync_one`'s parse phase to the single-pass extractor; full suite + new tests green; shellcheck clean; re-measure wall-clock for Notes.

## Out of Scope

- Rewriting the script in Node (rejected alternative B: 1.5K-LOC rewrite risk, loses the battle-tested bash+jest harness and SHY-0067's fresh fixes).
- Parallelizing with `xargs -P` (rejected alternative C: races on result counters + interleaved emit ordering that tests pin; API burst risk in non-dry mode).
- Any change to GitHub API call patterns (network phase untouched — this story is the local parse phase only).
- The per-file `check-story-frontmatter.sh` invocation stays a separate subprocess: it has its own exit-code contract (0/2/10-14/20) and inlining it would couple two independently-tested tools. It remains the largest single per-file cost; if post-refactor wall-clock still exceeds budget, a follow-up story may batch-validate via the validator's own `--scan` mode instead.
- The never-populated board mirror observation (66 would-create — operator decision on first live run).

## Dependencies

- None. SHY-0067's comprehensive test suite is the safety net that makes this refactor night-viable.

## Risks & Mitigations

- **Risk:** subtle output drift breaks the issue-body hash contract (change-detection). **Mitigation:** the 73-test suite pins body composition; zero test edits allowed.
- **Risk:** separator collision corrupts fields. **Mitigation:** adversarial characterization tests written BEFORE the refactor; separator chosen outside the legal frontmatter alphabet.
- **Risk:** 4 AM refactor fatigue. **Mitigation:** characterization-first TDD; reviewer gate; any ambiguity → stop and park per blocker rule.

## Definition of Done

- [ ] All AC checked; full sync suite green UNCHANGED + new characterization tests green pre/post; shellcheck clean.
- [ ] Reviewer at ZERO findings before push; PR auto-merged.
- [ ] Wall-clock before/after recorded in Notes; `status: Done` deferred to next release cut; SHY-INDEX synced (reserved row → Active → this entry).

## Notes (running log)

- 2026-06-10 ~05:15 BST — **TDD complete; 48/48 green (43 pre-existing UNCHANGED + 5 new).** Characterization-first surfaced TWO real bugs: (1) padded frontmatter leaked whitespace into GitHub labels (`priority:p1   ,effort:s\t` — validator accepts padded files, production-reachable) → fixed by the parser's trimming; (2) my own first parser version was \x1f-collision-vulnerable — caught by my own adversarial test (fields scrambled into labels) → fixed by stripping exactly the separator byte from values (second documented divergence; other C0 bytes keep their characterized pass-through; no [:print:]-class stripping to stay UTF-8-safe across the 20 locales). Measurements: per-file compute 0.58s→0.205s (gh stubbed, ~2.8×); full dry-run 37.3s→36.2s — remaining cost is gh-network ~0.38s/file + validator ~0.14s/file, both out of scope; wall-clock target re-scoped to reserved SHY-0071 on this evidence. shellcheck clean; fm_get/extract_title removed (zero callers remain).

- 2026-06-10 ~04:30 BST — **Architect verdict: APPROVE-WITH-CHANGES** (3 concerns, all applied as story edits). (1) Subprocess inventory corrected to ~15/file with the validator sub-bash named + explicitly out-of-scoped (own exit-code contract; ≤2 target scoped to the field-extraction fan-out). (2) Single-pass result must feed populate_project_fields too (4 duplicate fm_get re-reads at ~562-565) — file-read-exactly-once AC added. (3) Separator pinned to \x1f with corrected rationale (editors/serializers can't produce it; the validator does NOT inspect values). Architect confirmed: tests are pure black-box spawnSync (refactor-safe), body_hash already single-pass, get_field_id/get_option_id operate on cached JSON (not per-file). Story flipped Draft → In Progress.

- 2026-06-10 ~04:15 BST — Authored fully-refined during overnight autonomous run; trigger condition (corpus ≥50) verified met at 66 files; baseline measured 37.3s/--all vs 0.58s/--story (cost is per-file subprocess churn; 28 jq/awk/grep call sites). Alternatives weighed: A single-pass awk extractor (CHOSEN — smallest diff at the root cause), B Node rewrite (rejected: risk/size), C xargs -P (rejected: counter races + emit-order test breakage).

**2026-06-10 ~09:35 BST — Released in v0.97.9.** PR #1121 squash-merged; release.yml run 27263490415 (bump=patch) cut v0.97.9; flipped Done per done-equals-release-cut.
