---
id: SHY-0071
status: Draft
owner: claude
created: 2026-06-10
priority: P1
effort: M
type: refactor
roadmap_ids: []
pr:
---

# SHY-0071: Sync wall-clock — batch per-file gh lookups + scan-mode validation

## User Story

As the ShyTalk maintainer, I want the story→issues sync to stop paying a network round-trip and a validator sub-bash per story file, so that the `--all` path scales to the post-SHY-0062 corpus (~150 files) within a single-digit-seconds local dry-run and a fast CI sync.

## Why

SHY-0040 (2026-06-10) made the parse phase single-pass and measured what actually owns the wall-clock for `--all --dry-run` over 66 files (36.2s total):

- **~0.38s/file = `gh issue list` lookup per story** (`find_issue_for`, real network even in dry-run) ≈ 25s
- **~0.14s/file = `check-story-frontmatter.sh` sub-bash** (full second bash + its own awk/grep tree) ≈ 9s
- ~0.07s/file = everything else (post-SHY-0040)

Both levers were explicitly out of scope there (API patterns + the validator's independent exit-code contract). This story pulls them in with the contracts preserved.

## Acceptance Criteria

### Happy path
- [ ] **Lookup batching:** `--all` mode performs ONE `gh issue list` (paginated, `--limit` high enough for the corpus with a documented headroom assertion) up front, building a bash associative map `SHY-ID → issue_number`; `find_issue_for` consults the map with zero network. `--story` mode keeps the existing single lookup (one file = one lookup is already optimal).
- [ ] **Validation batching:** `--all` mode runs `check-story-frontmatter.sh --scan` ONCE over the stories dir; per-file validity is derived by parsing the scan's per-file stderr failure lines into a bash invalid-set. `sync_one` consults the set — same skip/emit/N_FAILED semantics per invalid file as today, byte-identical stderr `validate` category lines. `--story` mode keeps the per-file validator call (exit-code contract untouched where it is user-visible).
- [ ] `--all --dry-run` over the 66-file corpus completes in ≤6s wall locally (baseline 36.2s; recorded in Notes — informational, never a CI assertion).
- [ ] Non-dry `--all` behaviour: identical create/update/skip decisions on identical inputs (the lookup map returns exactly what per-file lookups returned), pinned by mock-gh recording-diff tests.

### Error paths
- [ ] Upfront `gh issue list` fails (non-zero rc): `--all` aborts with the existing `api` failure category and a non-zero exit — fail-closed, never silently proceeding to create duplicates of every issue.
- [ ] Scan invocation fails in a way that names NO file (global validator crash): `--all` aborts fail-closed with a `validate` category global error (never "all files valid by default").
- [ ] A story added between scan and sync (impossible in one process, but the map/set are built from the same `find` snapshot used by the loop — asserted structurally).

### Edge cases
- [ ] Corpus larger than one `gh issue list` page: pagination handled (or `--limit` set above corpus size with an explicit assertion that fails loudly when the corpus approaches the limit — choose at implementation with the architect; document the choice).
- [ ] Issue titles containing `\x1f`/newlines cannot corrupt the map (build it from `gh issue list --json` + jq, not text parsing).
- [ ] Mixed valid/invalid corpus: invalid files skip with today's exact per-file emit lines; valid files sync normally (mock-gh test with a 3-file fixture: valid + malformed + valid).

### Performance
- [ ] Network calls in `--all` over N files: from N+k to 1+k (k = per-create/update calls, unchanged). Validator sub-bash invocations: from N to 1.

### Security
- [ ] The issue map keys derive from the `SHY-NNNN` pattern in titles via anchored jq selection — a malicious issue titled to collide cannot shadow a legitimate story's mapping in a way that silently UPDATEs the wrong issue (collision → fail loudly; test pins it).

### UX
- [ ] N/A — internal tooling; emit format unchanged (pinned by the 48-test suite).

### i18n
- [ ] N/A — ops output English by convention.

### Observability
- [ ] `--verbose` logs the map size + scan result count once up front (new lines, additive only — existing emit lines untouched).

## BDD Scenarios

**Scenario: one lookup serves the whole corpus**
- **Given** a fixture corpus of 3 stories and a mock gh recording invocations
- **When** `--all` runs (non-dry)
- **Then** exactly ONE `issue list` invocation is recorded
- **And** the create/update decisions equal the pre-batching behaviour on the same fixtures

**Scenario: upfront lookup failure is fail-closed**
- **Given** mock gh exits non-zero for `issue list`
- **When** `--all` runs
- **Then** the script exits non-zero with an `api` category error and zero `issue create` calls recorded

**Scenario: scan-derived invalid set preserves per-file semantics**
- **Given** a 3-file fixture (valid, malformed, valid)
- **When** `--all` runs
- **Then** stderr contains the malformed file's `validate` line exactly as today, N_FAILED=1, and both valid files sync

## Test Plan

**Red first:** extend the SHY-0040 characterization harness (tests/scripts/sync-stories-to-issues-parse-characterization.test.js pattern — temp repo skeleton + mock-gh recording): invocation-count assertions (currently N `issue list` calls — red target: 1), fail-closed lookup-failure test, mixed-corpus scan test. These are behavioural (recording-based), not wall-clock.
**Green:** implement the map + scan-set; full 48-test suite UNCHANGED + new tests green; shellcheck clean; wall-clock re-measured for Notes.

## Out of Scope

- Caching across runs (the map lives for one process).
- Any Project-v2 GraphQL batching (different API; separate evidence needed).
- Parallelism (same rejection rationale as SHY-0040).

## Dependencies

- SHY-0040 merged (single-pass parse layer + the characterization harness this story extends) — PR #1121.
- `check-story-frontmatter.sh --scan` per-file stderr format: verify it names each failing file parseably BEFORE implementation; if it doesn't, a `--scan --porcelain` output mode is a prerequisite mini-scope (flag with architect at gate time).

## Risks & Mitigations

- **Risk:** scan stderr format isn't machine-parseable per-file → set derivation fragile. **Mitigation:** named as a gate-time architect checkpoint; porcelain mode added if needed (additive flag, validator's exit codes untouched).
- **Risk:** lookup map hides per-file lookup errors that today surface per story. **Mitigation:** fail-closed AC + the recording-diff tests pin decision parity.
- **Risk:** `gh issue list --limit` ceiling silently truncates on corpus growth. **Mitigation:** explicit loud assertion (edge-case AC) chosen over silent pagination complexity, or pagination — architect decides at gate.

## Definition of Done

- [ ] All AC checked; 48 pre-existing tests UNCHANGED + new behavioural tests green; shellcheck clean.
- [ ] Reviewer at ZERO findings before push; PR auto-merged.
- [ ] Wall-clock before/after in Notes; `status: Done` deferred to release cut; SHY-INDEX synced.

## Notes (running log)

- 2026-06-10 ~04:30 BST — Authored fully-refined from SHY-0040's measurements (the evidence is hours old: 0.38s/file network + 0.14s/file validator of 36.2s total). Architect gate still required at pickup per lifecycle; the scan-stderr parseability checkpoint is pre-flagged for it.
