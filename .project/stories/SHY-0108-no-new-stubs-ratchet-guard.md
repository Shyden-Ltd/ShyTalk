---
id: SHY-0108
status: In Review
owner: claude
created: 2026-06-16
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0108: Anti-regression "no new stubs" ratchet guard (Phase X)

## User Story

**As** the team draining EPIC-0003's ~238-file mock/fake debt to zero,
**I want** a CI + pre-push guard that fails any commit introducing a **new** in-process double (`jest.mock`, `Fake*Repository`, `page.route` fulfilment) while tolerating the known-and-shrinking baseline of existing ones,
**So that** the debt can only ever shrink — no migration slice silently regrows it, and "baseline empty" becomes the provable definition of the drain being complete.

## Why

EPIC-0003 (Phase X, cross-cutting) calls for exactly this: *"a lint guard prevents any new in-process double from regrowing the debt"* / *"fail any NEW `jest.mock`/`Fake*Repository`/`page.route`"* (CLAUDE.md § No Stubs + the EPIC charter). The drain spans Phases 2–6 (~238 files: 196 `jest.mock` express-api, 34 `Fake*Repository` Kotlin, 8 `page.route` Playwright). Without a ratchet, every multi-week phase risks a new PR re-adding a double faster than we remove them. The guard must be built **early** (pulled forward from its nominal last position) so it protects the drain *while in progress*, per the operator decision 2026-06-16 ("build the lint guard next"). It is device-independent: pure static analysis over git-tracked sources against the real local repo.

## Acceptance Criteria

### Happy path
- [ ] `node scripts/check-no-new-stubs.js` scans every **git-tracked** test source for the three banned patterns (`jest.mock(`, `Fake<Word>Repository`, `page.route(`), compares the offending-file set to the committed `scripts/no-stubs-baseline.json`, and **exits 0** when the live set equals the baseline (the green-on-main state).
- [ ] `node scripts/check-no-new-stubs.js --generate-baseline` writes a **deterministic** (sorted, stable-keyed) baseline JSON capturing the current offenders per category — the one-time seed + the command a migrator runs to shrink it.

### Error paths
- [ ] A **new** offender (a tracked file matching a banned pattern that is NOT in the baseline) → **exit non-zero** with a `::error::` annotation naming the file, the category, and the remediation (migrate to the real local stack; or, if a real condition is genuinely un-inducible, the operator-approved-exception escape hatch — never a silent mock).
- [ ] A **stale** baseline entry (a baseline path that no longer matches any banned pattern) → **exit non-zero** instructing the author to remove it ("the ratchet only tightens"), so a migration that forgot to update the baseline is caught.
- [ ] A **missing or malformed** `no-stubs-baseline.json` → loud non-zero exit (never a silent pass that would let the guard no-op).

### Edge cases
- [ ] The guard **excludes its own** `scripts/check-no-new-stubs.js` + `express-api/tests/scripts/check-no-new-stubs.test.js` from the scan (they contain the patterns as literal test data / detection regexes).
- [ ] Only **git-tracked** files are scanned — `node_modules/`, build dirs, and `.claude/worktrees/` copies are excluded for free (they are untracked/ignored), preventing the worktree-copy false positives observed during design.
- [ ] A banned pattern appearing inside a **comment or string** still counts (conservative ratchet — documented; a doc-only mention of `jest.mock` in a test file is rare and, if legitimate, goes through the baseline like any other entry).
- [ ] A **renamed** offender surfaces as both a stale old-path AND a new new-path → forces a deliberate baseline update (correct: the ratchet must be re-acknowledged on move).

### Performance
- [ ] One `git ls-files` invocation + bounded per-file reads (O(tracked files)); no repeated full-tree walks; completes in a few seconds in CI (no busy-spin, no network).

### Security
- [ ] Read-only: the guard **never executes** scanned files; `git ls-files` is spawned without a shell (arg array, not a command string); no network access; no credentials read.

### UX
- [ ] Output clearly separates **"NEW — fix these"** from **"STALE baseline — remove these"**, names exact `file:line` + category per offender, and states both the escape hatch and the `--generate-baseline` regeneration command — a reader fixes it without re-deriving anything.

### i18n
- N/A — engineering tooling output is English (internal CI/CLI surface, not a translated user surface).

### Observability
- [ ] A summary line reports per-category counts (live vs baseline) + the delta (new / stale) so a CI-log reader sees the ratchet's exact state at a glance; on success it prints the remaining baseline size (the "how much debt is left" signal).

## BDD Scenarios

**Scenario: clean tree (offenders == baseline) → pass**
- **Given** the committed baseline matches the repo's current offenders
- **When** `node scripts/check-no-new-stubs.js` runs
- **Then** it exits 0
- **And** it prints the remaining baseline size per category

**Scenario: a new in-process double is introduced → fail loud**
- **Given** a tracked test file adds `jest.mock(...)` and is NOT in the baseline
- **When** the guard runs
- **Then** it exits non-zero
- **And** a `::error::` line names the file + category + remediation

**Scenario: a migrated file leaves a stale baseline entry → fail loud**
- **Given** a baseline path no longer contains any banned pattern
- **When** the guard runs
- **Then** it exits non-zero
- **And** it instructs the author to remove the stale entry (ratchet only tightens)

**Scenario: baseline regeneration is deterministic**
- **Given** the repo's current offenders
- **When** `--generate-baseline` is run twice
- **Then** both outputs are byte-identical (sorted, stable-keyed)

## Test Plan

Touches `.js` + a JSON baseline + CI/pre-push wiring → **NOT `*.md`-only → runs the FULL Pre-Merge Testing Protocol**; the device gauntlet's role here is only to prove the wiring change did not break CI/push for any surface. Per CLAUDE.md § No Stubs the guard logic is tested against **real** temp file trees (real `fs`, no `jest.mock` — that would be self-defeating) + the **real repo**.

**Red → Green (framework by framework):**
- **Express/Node (Jest)** `cd express-api && npm test` — new `tests/scripts/check-no-new-stubs.test.js`:
  - `classifyContent()` value matrix: each of the 3 patterns present/absent → exact `{jestMock, fakeRepository, pageRoute}` booleans (banned patterns built by string concatenation so the literal does not appear in the committed test source).
  - `scanFiles()` over a **real** temp dir with planted real offender files → exact offending-set per category.
  - `diffBaseline()`: a planted new offender → reported under `new`; a planted stale entry → reported under `stale`; equal sets → both empty.
  - **Baseline-in-sync integration:** run the real scan over the real repo and assert it equals the committed `no-stubs-baseline.json` (`new` empty + `stale` empty) — proves the guard is green on this branch AND the baseline is accurate. RED before the script/baseline exist, GREEN after.
- **eslint** `npm run lint` → 0 warnings (the new script + test).
- **actionlint** — the new `lint.yml` step is shellcheck/actionlint-clean.
- **Guard self-run:** `node scripts/check-no-new-stubs.js` exits 0 locally on this branch.
- **Device gauntlet (Phase 1 LOCAL):** full matrix on real Android + real iPhone + all browsers proves the CI/pre-push wiring change broke nothing (no app/web runtime surface touched — the device leg is the no-corruption proof, batched with the EPIC's other parked device legs).
- **Phase 2:** `code-reviewer` 100% clean → push → CI green by name (Detect Changes / Analyze JavaScript / PR Gate) + the new guard step itself green.
- **Phase 3 (DEV):** re-run on dev (web = Chrome).

## Out of Scope
- Actually migrating any of the 238 baseline offenders to real (that is Phases 2–6 — this story only freezes the ceiling).
- Banning `jest.fn` / `mockk` / `Mockito` (permitted in unit tests per the EPIC's real-captured-fixture clause; CLAUDE.md's guard spec names exactly the three patterns — `mockk`/`Mockito` ratcheting is a possible Phase-4 extension, flagged not built).
- An auto-fixer / codemod (the guard only detects + blocks; migration is human/Claude work).

## Dependencies
- `git ls-files` (real git) for the tracked-file enumeration.
- `lint.yml` + `.husky/pre-push` (present) for wiring the guard as a required gate.
- The EPIC-0003 charter (Phase X) for the patterns + the ratchet semantics.

## Risks & Mitigations
- **Risk:** the guard flags its own test/detection source. **Mitigation:** explicit self-exclusion of the two guard files + banned literals built via concatenation in the test (belt + braces; covered by the baseline-in-sync test).
- **Risk:** a regex false-positive (e.g. `Fake*Repository` matching an unrelated identifier). **Mitigation:** anchored patterns + the baseline absorbs any current edge; a NEW false positive is visible + can be added to the baseline with a comment, or the regex tightened (covered by the value-matrix test).
- **Risk:** baseline drift (someone migrates a file but forgets the baseline). **Mitigation:** the stale-entry check fails loud — that is the feature, not a bug.
- **Risk:** running the full device gauntlet for a static-analysis guard feels disproportionate. **Mitigation:** the protocol's only exemption is `*.md`-only; this is `.js`+CI, so it runs — and the run usefully reconfirms the matrix is operational (same rationale as SHY-0092). A test-tooling exemption is an operator call, not assumed.

## Definition of Done
- [ ] `scripts/check-no-new-stubs.js` (scan + diff + `--generate-baseline` + `--help`) + committed `scripts/no-stubs-baseline.json` + the `lint.yml` step + the `.husky/pre-push` call implemented.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): Jest RED→GREEN (classify value-matrix + scan + diff + baseline-in-sync) + eslint 0 + actionlint clean + guard self-run exit 0 → LOCAL device gauntlet green (no-corruption proof) → `code-reviewer` 100% clean → push → CI green by name (incl. the new guard step) → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-06-16 ~20:05 BST — **CREATED + PICKED UP in one session** (authored fully-refined per [[feedback-no-skeleton-stories-fully-refined]], status In Progress immediately) after the operator chose **"Build the lint guard next"** (AskUserQuestion at the SHY-0092 milestone) — pulling Phase X forward to protect the EPIC-0003 drain while it is in progress. **Architect gate skipped** per [[feedback-rate-limit-slowdown-strategies]] (low-risk infra guard, spec fully-refined; flagged, not silently bypassed). Branch `story/SHY-0108-no-new-stubs-ratchet-guard` off `origin/main` (4th in-flight branch — operator-authorised; device legs batch for the supervised session). **Live offender survey (per [[feedback-never-guess-always-investigate]]):** `jest.mock(` = 196 express-api test files; `Fake<Word>Repository` = 34 Kotlin files (app+shared); `page.route(` = 8 Playwright specs in `tests/web/` (the `.claude/worktrees/` hits are a SHY-0101 worktree copy — excluded for free by `git ls-files`). **SHY-INDEX + EPIC `child_shys` listing DEFERRED** to the consolidation/merge to avoid cross-branch divergence with the parked branches (validator-safe: a SHY referencing an existing EPIC needs no reciprocal `child_shys` entry; only listed children are existence-checked). **Device leg DEFERRED** to the supervised window (no-corruption proof + reviewers + push + CI + DEV + judgment-merge). NOT pushed this session.
