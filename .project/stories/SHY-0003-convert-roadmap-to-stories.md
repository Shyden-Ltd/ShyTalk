---
id: SHY-0003
status: Cancelled
owner: claude
created: 2026-06-06
priority: P1
effort: L
type: chore
roadmap_ids: [G054]
epic: EPIC-0001
pr:
mvp: true
---

# SHY-0003: Convert zero-gap roadmap to user stories + cross-label

## User Story

As the ShyTalk operator, I want the existing zero-gap remediation roadmap (`.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`) converted into individual SHY-NNNN story files — one per open PR-bundle per the architect's recommended PR sequencing — with the roadmap doc cross-labelled so every G-item links back to its SHY, plus a new G054 row added for the gh-pages-deploy serialization work — so that the backlog is visible in the SHY system, GitHub Issues auto-mirror the items via SHY-0002, and the roadmap remains the source-of-truth INDEX of which gaps map to which units of work.

## Why

The roadmap was authored 2026-06-05 as a one-shot architectural plan: 53 G-IDs across 9 phases, grouped into 33 recommended PR-bundles. Several of those bundles SHIPPED overnight (PR-B2 / PR-G1 / PR-I2 partial / PR-G034 / PR-G024 / PR-G050 / PR-G035 / PR-G036 / PR-G037 — see the 12 PRs #1015–#1026 in the prior session handoff). The remaining open bundles need a structured backlog representation:

1. **Visibility:** without SHYs, the backlog is invisible to anyone reading GitHub.
2. **Pickup discipline:** each child SHY enforces the rich template (8 AC dimensions, BDD scenarios, DoD) when it's picked up — preventing the "I'll just go fix G023" shortcut that skips architect/reviewer gates.
3. **Cross-reference:** roadmap rows cross-labelled with SHY-NNNN let either direction lookup work (G-ID → SHY, SHY → G-ID via `roadmap_ids` frontmatter).
4. **Add G054:** the gh-pages cross-workflow deploy race surfaced overnight (PRs #1024 + #1025 hit it; recovered via rerun). Per operator decision, G054 enters the roadmap with its own SHY in this conversion.

Once SHY-0003 ships:

- ~25 new SHY-NNNN-\*.md skeleton files exist as `status: Draft` with proper frontmatter and `roadmap_ids` populated.
- Each child SHY is **a skeleton, not a fully-fleshed story.** When picked up, the assignee REFINES the AC + BDD + Test Plan per the template (this refinement is part of the picked-up SHY's implementation work; architect re-validates the refinement).
- The roadmap doc has a `SHY` column populated for every G-row.
- SHIPPED G-items get `✅ PR #N` in the SHY column.
- DEFERRED-as-not-real-gap items (G048, G051 per handoff) get `❌ Not a gap (per …)` annotation.
- SHY-INDEX.md gains ~25 new rows.

## Acceptance Criteria

### Happy path

- [ ] `scripts/convert-roadmap-to-stories.sh` exists, mode 755, accepts: `--dry-run`, `--output-dir <path>` (default `.project/stories/`), `--start-id SHY-NNNN` (default = next free ID after the highest existing), `--roadmap <path>` (default `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`), `--help`, `--verbose`. **Local-run only — the roadmap doc lives under `.project/test-plans/` which is gitignored; CI does NOT invoke this script.** The lint.yml step continues to validate the generated `.project/stories/SHY-*.md` skeletons via `check-story-frontmatter.sh --scan`, not the conversion script itself.
- [ ] Running the script with no args parses the roadmap, identifies OPEN PR-bundles (skips bundles whose G-items are ALL shipped or marked not-a-gap), and emits one skeleton story file per open bundle
- [ ] Each generated skeleton has: valid frontmatter (9 fields), all 10 required `##` body sections present (plus the `# <Title>` h1 — not validator-enforced), AC `### N/A — TBD refinement on pickup` placeholders for each of the 8 dimensions as PROSE (no `- [ ]` bullets — so `ac_count == 0` in the validator's BDD presence check; BDD stubs are included for context only and do NOT trigger the validator's exit-13 gate), 1 BDD scenario stub per `roadmap_ids` entry, Test Plan with `(TBD on pickup)` placeholder, Notes log opening with the conversion timestamp + source PR-bundle ID
- [ ] Each generated skeleton's frontmatter derives: `priority` from worst severity in the bundle (Critical → P0; Important → P1; Polish → P2); `effort` from max of G-item efforts (XS<S<M<L<XL); `type` from category mapping table documented in `--help` (Test → `bug`, CI/Workflow/Dep → `infra`, Journey/BDD → `feature`, Doc → `docs`, Security → `bug`) — **multi-category tie-break: first matching token wins, in priority order Security > Test > CI/Workflow/Dep > Journey/BDD > Doc** (avoids ambiguity on G-items like "Test + CI"); `roadmap_ids` from the G-IDs in the bundle; `owner: claude`; `status: Draft`; `created: <today UTC>`
- [ ] Each generated skeleton's filename is `SHY-NNNN-<verb-led-slug>.md`; slug is derived from a per-PR-bundle LOOKUP TABLE embedded in the script (PR-A1 → `kotlin-2-4-0-stable-upgrade`, PR-B1 → `add-push-permission-tests`, etc. — explicit not algorithmic; the roadmap's "Fix" column wording is too varied for reliable keyword extraction). The lookup table is the canonical reference for skeleton filenames; missing entries fall back to `SHY-NNNN-pr-<bundle-id>-tbd.md` so the script never fails, and the operator/Claude renames on pickup.
- [ ] Each generated skeleton passes `scripts/check-story-frontmatter.sh` (verified by the script before writing each file)
- [ ] The roadmap doc (`.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`) is updated in-place: a new `SHY` column is added to each table; OPEN G-items get `SHY-NNNN` (linking to the file path); SHIPPED items get `✅ PR #N`; DEFERRED items get `❌ Not a gap — <reason>`
- [ ] A new row `G054` is added to Phase G's table for the gh-pages cross-workflow deploy serialization with: Sev = Important, Category = CI, Location = `.github/workflows/{allure-report,pr-checks,test-backend}.yml`, Gap = "kotlin-report + express-coverage deploys don't participate in `gh-pages-deploy` concurrency group; concurrent runs race on git push to gh-pages", Fix = "Split-job pattern: extract deploys into dedicated jobs with `concurrency: gh-pages-deploy, cancel-in-progress: false`", Scope = S, SHY = `SHY-NNNN` (the SHY this conversion creates for it)
- [ ] `.project/stories/SHY-INDEX.md` has ~25 new rows added (one per generated skeleton) under Active, sorted by priority ascending then created ascending
- [ ] `--dry-run` prints every action (files to create, roadmap edits, INDEX edits) without making any filesystem writes
- [ ] `--help` prints synopsis, flags, category-mapping table, exit codes, and one example invocation

### Error paths

- [ ] Roadmap file missing → exit 40, stderr `roadmap not found at <path>`
- [ ] Roadmap file parse error (malformed table row) → exit 41, stderr names the offending line number
- [ ] Output directory not writable → exit 42, stderr names the directory + permission issue
- [ ] SHY-ID collision (a SHY-NNNN file already exists in output-dir for the next ID) → exit 43, stderr names the collision and suggests `--start-id`
- [ ] Cross-check shipped-PR lookup fails (GitHub API unreachable or `gh` unauthenticated) → exit 44, stderr names the failure; in `--dry-run` mode this is a warning, not an error
- [ ] Generated skeleton fails `check-story-frontmatter.sh` validation → exit 45, stderr names the offending file + validation reason (means the template generator has a bug — should never happen, but pinned)
- [ ] G054 row insertion fails because Phase G's table is malformed → exit 46, stderr names the issue
- [ ] SHY-INDEX.md update fails (file write error or sort logic produces invalid markdown) → exit 47, stderr names the failure

### Edge cases

- [ ] Roadmap has trailing whitespace / blank lines / comments — parser tolerates
- [ ] PR-bundle with one G-item works (e.g. PR-A1 = G001 alone)
- [ ] PR-bundle with 10+ G-items works (theoretical; current max is PR-H2 with 6)
- [ ] Bundle where every G-item is shipped — bundle skipped; no SHY emitted
- [ ] Bundle where some G-items are shipped and others open — bundle still emitted as SHY; only OPEN G-IDs go into `roadmap_ids`; SHIPPED ones are documented in the SHY's Notes log
- [ ] G-item marked DEFERRED-as-not-a-gap (G048, G051): excluded from any SHY; roadmap row gets the `❌` annotation
- [ ] Re-running the script after some SHYs already exist (idempotent): script reads existing `.project/stories/` to determine next SHY-ID; does NOT regenerate existing SHYs (operator-edits are preserved); only creates SHYs for bundles that have no existing SHY mapping. **Detection is by `roadmap_ids` frontmatter overlap** — the script greps every existing `SHY-[0-9][0-9][0-9][0-9]-*.md` for the `roadmap_ids:` array values, builds a set of already-claimed G-IDs, and skips any bundle whose G-IDs are a subset of that set. Filename-glob is NOT used (a slug change would cause false re-generation).
- [ ] Operator manually deleted a generated skeleton: re-run regenerates it (the script treats "no SHY file for this open bundle" as needs-generation)
- [ ] G054 row already present in the roadmap: script detects and skips re-insertion; idempotent

### Performance

- [ ] Full conversion (~25 skeletons + roadmap update + INDEX update): <30s wall-clock
- [ ] Memory: <100MB resident
- [ ] No spawned background processes; single-threaded

### Security

- [ ] Script does NOT execute roadmap content (parse-only; no `eval`)
- [ ] All variable expansions quoted
- [ ] Output files written with permission 0644; script does not chmod or setuid
- [ ] Roadmap edits are atomic per-table (write to temp file + rename) so a partial write doesn't corrupt the roadmap
- [ ] When cross-checking shipped PRs via `gh`, the script uses read-only API access; no write permission required

### UX

- [ ] Sync output is structured per generated skeleton: `SHY-NNNN: created from PR-X (G-IDs: G001, G002) -> <output-path>`
- [ ] Shipped-bundle skips logged as: `PR-X: all G-IDs shipped (G011 -> #1016, G024 -> #1021); skipping`
- [ ] Roadmap-update progress: `roadmap: added SHY column to Phase A table (4 rows updated)`, etc.
- [ ] INDEX-update summary: `SHY-INDEX.md: added 25 new rows under Active`
- [ ] `--dry-run` actions prefixed with `DRY-RUN:`
- [ ] On failure, the script reports what it completed before the failure and what would need manual cleanup
- [ ] `--help` lists the category-mapping table so operator can predict the `type` field of each generated SHY

### i18n

- [ ] Roadmap content (Gap / Fix columns) tolerates Unicode (CJK, emoji) — passed through to generated SHY body verbatim
- [ ] Generated SHY frontmatter uses ASCII values for all enums; slug uses kebab-case ASCII-only (Unicode in titles is OK but slug is sanitized)
- [ ] Script works correctly under `LC_ALL=C`, `LC_ALL=en_GB.UTF-8`, `LC_ALL=ja_JP.UTF-8`

### Observability

- [ ] Exit codes documented in `--help` and CLAUDE.md:
  - 0 = success
  - 2 = usage error
  - 40 = roadmap not found
  - 41 = roadmap parse error
  - 42 = output directory not writable
  - 43 = SHY-ID collision
  - 44 = shipped-PR lookup failure (only fatal outside `--dry-run`)
  - 45 = generated skeleton fails frontmatter validation
  - 46 = G054 row insertion failure
  - 47 = INDEX update failure
- [ ] Stderr is structured: `<event-type>: <details>` per event
- [ ] Final summary line on stdout (only on success): `Created N SHYs (PR-X1 through PR-XN); roadmap updated; INDEX updated`

## BDD Scenarios

### Conversion-run scenarios

**Scenario: First run creates ~25 skeletons for all open bundles**

- **Given** the roadmap at the canonical path is well-formed
- **And** `.project/stories/` contains SHY-0001 + SHY-0002 + SHY-0003 (the highest existing is SHY-0003)
- **And** the operator has authenticated `gh` and is online
- **When** the operator runs `scripts/convert-roadmap-to-stories.sh`
- **Then** the script parses the roadmap into PR-bundles
- **And** cross-checks each G-item's shipped status via merged PR history
- **And** emits ~25 skeleton SHYs starting from SHY-0004 sequentially
- **And** each skeleton passes `scripts/check-story-frontmatter.sh` immediately after creation
- **And** the roadmap is updated in-place with the new SHY column
- **And** G054 row appears at the bottom of Phase G's table with the documented values
- **And** SHY-INDEX.md grows by ~25 rows under Active
- **And** the final summary line reads `Created 25 SHYs (PR-A1 through PR-I8); roadmap updated; INDEX updated`
- **And** exit code is 0

**Scenario: Second run is idempotent — no duplicates**

- **Given** the first run created SHY-0004 through SHY-0028
- **And** no roadmap edits have occurred since
- **When** the operator re-runs the script
- **Then** the script detects existing SHYs (matching each PR-bundle's `roadmap_ids` set)
- **And** generates ZERO new files
- **And** the roadmap edits are also idempotent (no duplicate SHY columns added)
- **And** the G054 row is NOT re-inserted (script detects its presence)
- **And** exit code is 0
- **And** the summary line reads `0 new SHYs; roadmap unchanged; INDEX unchanged`

**Scenario: `--dry-run` makes no filesystem mutations**

- **Given** the operator wants to preview the conversion
- **When** they run `--dry-run`
- **Then** every planned action is printed to stderr with `DRY-RUN:` prefix
- **And** zero files are created or modified
- **And** the roadmap file's modification timestamp is unchanged
- **And** exit code is 0

**Scenario: Bundle with one shipped + one open G-item**

- **Given** PR-Y bundles G001 (shipped as #999) + G002 (open)
- **When** the conversion runs
- **Then** a SHY is created with `roadmap_ids: [G002]` only
- **And** the SHY's Notes log includes `G001 was already shipped as #999; only G002 is in scope for this SHY`
- **And** the roadmap row for G001 gets `✅ PR #999`
- **And** the roadmap row for G002 gets `SHY-NNNN`

**Scenario: Bundle where every G-item is shipped**

- **Given** PR-Y bundles G001 + G002 + G003 (all shipped overnight)
- **When** the conversion runs
- **Then** no SHY is emitted for PR-Y
- **And** stderr prints `PR-Y: all G-IDs shipped (G001 -> #1015, G002 -> #1016, G003 -> #1017); skipping`
- **And** the three roadmap rows each get their `✅ PR #N` annotation

**Scenario: G054 row insertion**

- **Given** the roadmap's Phase G table currently has rows G011 through G037 + G049
- **When** the conversion runs
- **Then** a new row G054 is appended to Phase G's table with the documented Gap / Fix / Scope values
- **And** the row's SHY column is populated with the SHY ID generated for G054 (e.g. SHY-0029)
- **And** the row's severity is `🟠 Important` (matches the operator-discovered CI race priority)

**Scenario: Generated skeleton has the right `type` derivation**

- **Given** PR-Y bundles G023 (category: Playwright test.skip)
- **When** the SHY is generated
- **Then** the frontmatter has `type: bug` (Test → bug per the mapping table)

**Scenario: Generated skeleton has correct `priority` derivation**

- **Given** PR-Y bundles G003 (Critical) + G027 (Important)
- **When** the SHY is generated
- **Then** the frontmatter has `priority: P0` (worst severity in the bundle is Critical)

### Adversarial scenarios

**Scenario: Roadmap parser tolerates a malformed row**

- **Given** the roadmap has a row missing the `Fix` column (only 6 of 7 cells)
- **When** the script parses it
- **Then** the script exits 41
- **And** stderr names the line number and the cell count mismatch
- **And** ZERO files have been modified
- **And** the roadmap file is unchanged

**Scenario: SHY-ID collision blocks generation**

- **Given** `.project/stories/` already has SHY-0004 (operator-created manually) and the conversion's next-free-ID logic picks SHY-0004 for the first new generation
- **When** the script runs
- **Then** before writing, it checks for SHY-0004 collision
- **And** the script exits 43
- **And** stderr suggests `--start-id SHY-0005` to skip the collision

**Scenario: `gh` unauthenticated outside `--dry-run` is fatal**

- **Given** `gh auth status` reports no auth
- **When** the script runs (without `--dry-run`)
- **Then** the script exits 44
- **And** stderr instructs `gh auth login`

**Scenario: `gh` unauthenticated inside `--dry-run` is a warning, not fatal**

- **Given** `gh auth status` reports no auth
- **When** the script runs with `--dry-run`
- **Then** the script SKIPS the shipped-PR cross-check
- **And** stderr prints `WARNING: gh unauthenticated; all G-items assumed open for dry-run`
- **And** the dry-run continues with the assumption-all-open behavior
- **And** exit code is 0

## Test Plan (TDD)

### Red — write failing tests FIRST

Create `express-api/tests/scripts/convert-roadmap-to-stories.test.js`. Tests use small fixture roadmaps + a stub `gh` (PATH override pointing to a Bash mock script).

**Parsing (5 tests):**

- `it('parses Phase A table correctly (4 PR-bundles)')`
- `it('parses Phase B table correctly (2 PR-bundles)')`
- `it('exits 41 on malformed row')`
- `it('tolerates trailing whitespace on rows')`
- `it('tolerates blank lines between tables')`

**Bundle classification (6 tests):**

- `it('classifies a bundle with all G-items shipped as "skip"')`
- `it('classifies a bundle with no G-items shipped as "open"')`
- `it('classifies a bundle with mixed shipped/open as "open" with subset roadmap_ids')`
- `it('excludes G048 (operator-flagged not-a-gap) from any bundle')`
- `it('excludes G051 (operator-flagged not-a-gap) from any bundle')`
- `it('derives roadmap_ids correctly for each generated SHY')`

**Frontmatter derivation (8 tests):**

- `it('derives priority P0 from Critical-severity bundle')`
- `it('derives priority P1 from Important-severity bundle')`
- `it('derives priority P2 from Polish-severity bundle')`
- `it('derives priority P0 from mixed-severity bundle (worst wins)')`
- `it('derives effort from max XS<S<M<L<XL')`
- `it('derives type=bug from Test category')`
- `it('derives type=infra from CI category')`
- `it('derives type=feature from Journey category')`

**File generation (5 tests):**

- `it('generates a skeleton that passes check-story-frontmatter.sh')`
- `it('generates a slug from the bundle purpose (kebab-case)')`
- `it('generates the Notes log with conversion timestamp and source PR-bundle ID')`
- `it('generates a TBD-on-pickup AC placeholder for each of the 8 dimensions')`
- `it('generates one BDD scenario stub per roadmap_id')`

**Idempotency (4 tests):**

- `it('second run with no roadmap changes emits zero new SHYs')`
- `it('second run does not duplicate roadmap SHY columns')`
- `it('second run does not duplicate G054 row')`
- `it('detects existing SHY by roadmap_ids overlap, not filename')`

**Roadmap update (4 tests):**

- `it('adds SHY column to every table')`
- `it('annotates shipped G-items with ✅ PR #N')`
- `it('annotates not-a-gap G-items with ❌ Not a gap — <reason>')`
- `it('inserts G054 row with the documented values')`

**INDEX update (3 tests):**

- `it('appends new rows to Active table')`
- `it('sorts Active by priority asc, created asc')`
- `it('does not modify Done or Cancelled tables')`

**CLI flags (5 tests):**

- `it('--dry-run makes no filesystem mutations')`
- `it('--output-dir overrides the default')`
- `it('--start-id overrides the auto-detected next free ID')`
- `it('--roadmap overrides the default path')`
- `it('--help exits 0 and lists exit codes + category mapping')`

**Error paths (8 tests):** one per exit code 40–47

Fixtures: 4 fixture roadmaps (well-formed, malformed, all-shipped phase, mixed-status phase); 3 stub `gh` scripts (auth-success, auth-fail, network-fail).

### Green — implement until red flips

1. **Create `scripts/convert-roadmap-to-stories.sh`** — bash 3.2-compatible; uses `awk` for table parsing (matches the sectional-counting approach from SHY-0001); uses `gh search prs` for shipped-PR cross-check
2. **Implement skeleton template logic** — embed the skeleton template inline in the script (or read from a `scripts/templates/story-skeleton.md.tpl` file); template uses `${SHY_ID}`, `${ROADMAP_IDS}`, `${PRIORITY}`, `${EFFORT}`, `${TYPE}`, `${SLUG}`, `${TITLE}`, `${BUNDLE_ID}`, `${G_ID_LIST}` placeholders
3. **Implement category mapping** as a case statement; `--help` echoes it for operator transparency
4. **Implement roadmap update** atomically: read full file → modify in memory → write to tempfile → `mv` to target
5. **Implement INDEX update** by inserting rows into the Active table; sort the whole table by `priority asc, created asc`
6. Run Jest tests — every red flips green
7. Run `shellcheck` + `actionlint` (if any GitHub Actions are added) — clean

## Out of Scope

- Fully fleshing out the AC + BDD + Test Plan of each generated child SHY (refinement happens when each is picked up; the skeleton is `Draft` status)
- Auto-assigning the child SHYs to dates / sprints (no sprint concept; continuous flow per operator's earlier decision)
- Auto-creating GitHub Issues for the generated SHYs (that's SHY-0002's sync workflow — runs automatically after SHY-0003 ships)
- Re-ordering the PR-bundle sequence (we accept the architect's original Phase A→I order)
- Backfilling SHYs for ALREADY-SHIPPED roadmap items (the operator chose "skip shipped, cross-label with ✅ PR #N" in earlier alignment)
- Migrating the roadmap doc to live INSIDE the SHY system (the roadmap remains a separate planning artifact at `.project/test-plans/exhaustive/`)
- A migration of OLDER test-plans (`.project/test-plans/exhaustive/2026-05-30-qa-runner-framework-gaps.md` etc.) — those predate this workflow and stay archival
- Running the conversion script in CI — the roadmap source doc is gitignored (it lives at `.project/test-plans/`, which is local-only per `.gitignore`). The script is operator-run locally; CI does not invoke `convert-roadmap-to-stories.sh`. The `lint.yml` step validates the generated `.project/stories/SHY-*.md` files via `check-story-frontmatter.sh --scan`, NOT the conversion script itself.
- Multi-roadmap support (this conversion runs against one roadmap file; future roadmaps would each get their own conversion SHY)

## Dependencies

- **Blocks:** every child SHY-NNNN this story generates (~25 stories, each picked up later)
- **Blocked by:** SHY-0001 (the frontmatter validator must exist — script calls it per generated skeleton); SHY-0002 (generated SHYs auto-sync to GitHub Issues; if SHY-0002 hasn't shipped yet, the generated SHYs exist locally without GitHub mirrors until SHY-0002 ships)
- **Blocked by:** Repo migration to company GitHub org (per 2026-06-06 ~12:15 BST directive)
- **Tool-version assumptions:** `gh` CLI for shipped-PR lookups; `awk` (BSD + GNU compatible); bash 3.2+; `jq` for `gh` JSON parsing

## Risks & Mitigations

- **Risk:** Roadmap rows have inconsistent column counts across phases (some phases have 7 cells, some 6). **Mitigation:** Parser validates column count per row and exits 41 if mismatched. Tests cover both well-formed and malformed cases.
- **Risk:** Generated skeleton's `type` derivation is wrong (e.g. a G-item labelled "Test — VM coverage" derives `type: bug` but operator considers it `type: feature` because it's adding new behavior). **Mitigation:** Category mapping is documented in `--help`; operator can manually edit `type` in the skeleton; future `convert-roadmap-to-stories.sh --refresh-types <SHY-NNNN>` could re-derive (out of scope for first version).
- **Risk:** Shipped-PR cross-check via `gh search` returns a false negative (PR exists but didn't reference the G-ID). **Mitigation:** Cross-check looks at PR titles AND PR bodies for G-ID mentions; falls back to "open" classification if uncertain (better to over-generate than skip a real open item; operator can delete a wrongly-generated SHY).
- **Risk:** Skeleton's "TBD on pickup" placeholders are too vague — pickup engineer doesn't know where to start. **Mitigation:** Skeleton's User Story + Why + Notes log include the source PR-bundle ID and the original roadmap row's Gap + Fix columns verbatim — the pickup engineer reads the roadmap row and the SHY-0003-generated Notes to understand context.
- **Risk:** Roadmap update is partially atomic but the script crashes mid-write. **Mitigation:** Use tempfile + `mv` pattern; verify by re-reading after write; on crash, the original roadmap is untouched.
- **Risk:** Generated skeleton fails `scripts/check-story-frontmatter.sh` (template bug). **Mitigation:** Script validates each skeleton before moving to the next; exits 45 immediately so the bug is caught early; test fixture exercises every template branch.
- **Risk:** SHY-INDEX.md update sorts incorrectly (priority comparison wrong, lexical not numeric). **Mitigation:** Explicit priority ordering (`P0` < `P1` < `P2` < `P3`); test covers sort stability.
- **Risk:** G054 row is duplicated on re-run. **Mitigation:** Detect G054 presence via `grep -q '^| G054 |'` before insertion; idempotent.
- **Risk:** Generated skeletons accidentally inherit incorrect default values (operator manually set priority on a G-item but the script ignores per-item priority). **Mitigation:** Script reads severity from the roadmap row (not from operator memory); if operator wants a different priority, they edit the generated SHY post-conversion (the AC says skeletons are TBD-on-pickup anyway).

## Definition of Done

- [ ] All Acceptance Criteria boxes across the 8 dimensions are checked
- [ ] `cd express-api && npm test -- convert-roadmap-to-stories` green locally
- [ ] `shellcheck scripts/convert-roadmap-to-stories.sh` exits 0
- [ ] `scripts/convert-roadmap-to-stories.sh --dry-run` against the live roadmap exits 0 with the expected preview output (operator verifies the preview before merge)
- [ ] `scripts/convert-roadmap-to-stories.sh` against the live roadmap creates the expected ~25 SHYs, updates the roadmap with cross-refs, adds G054, updates INDEX
- [ ] Each generated SHY passes `scripts/check-story-frontmatter.sh`
- [ ] `scripts/check-story-frontmatter.sh --scan .project/stories` exits 0 (entire stories directory healthy)
- [ ] Branch is `story/SHY-0003-convert-roadmap-to-stories`
- [ ] All commits' subjects start with `[SHY-0003]`
- [ ] PR title is `SHY-0003: Convert zero-gap roadmap to user stories + cross-label`
- [ ] PR body opens with `Implements SHY-0003 — see .project/stories/SHY-0003-convert-roadmap-to-stories.md for full spec, AC, BDD scenarios, and DoD.\nCloses #<issue-N>`
- [ ] Architect agent dispatched; concerns addressed
- [ ] Code-reviewer agent reports ZERO findings
- [ ] PR pushed, auto-merge armed, ScheduleWakeup on CI
- [ ] PR merged via auto-merge
- [ ] **Per-type Done gate:** `type: chore` → Done = auto-merge fires. No dev verify required.
- [ ] `status: Done` set in frontmatter; `pr:` populated
- [ ] Notes log records PR URL + merge timestamp + reviewer cycle count
- [ ] `SHY-INDEX.md` row for SHY-0003 moved from Active to Done (the ~25 new SHYs already there from this story's execution)
- [ ] SHY-0002's sync workflow runs on the merge commit and auto-creates ~25 GitHub Issues + Project v2 cards for the generated SHYs (this is a downstream effect of SHY-0002 being live, not a SHY-0003 deliverable per se)

## Notes (running log)

- 2026-06-06 12:40 BST — Draft v1 created. Scope confirmed in operator Q&A: 1 PR-bundle = 1 SHY; skip shipped items + cross-label with ✅ PR #N; add G054 (gh-pages) as a new roadmap row + a SHY; same strict template + 8-dimension AC + BDD for every generated SHY (although skeletons start as TBD-on-pickup placeholders); `type: chore` so Done = auto-merge fires. Blocked by SHY-0001 + SHY-0002 + repo migration. Ready for operator review of this draft.
- 2026-06-12 ~22:56 BST — **CANCELLED** (operator decision during SHY-0091's dedup/closeout pass). Deliverable already shipped: the zero-gap roadmap carries 60 SHY cross-labels, the 91-story corpus exists, and the one-time `convert-roadmap-to-stories.sh` skeleton generator's output was refined under SHY-0032. Stale Draft superseded by SHY-0032; distinct from SHY-0062 (the PUBLIC `phases[].features[]` migration, still open). Cancelled rather than Done per operator.
