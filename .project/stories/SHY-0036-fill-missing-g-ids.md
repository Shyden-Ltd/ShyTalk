---
id: SHY-0036
status: Done
owner: claude
created: 2026-06-08
priority: P0
effort: XL
type: chore
roadmap_ids: [G001, G003, G006, G011, G018, G024, G025, G031, G032, G034, G035, G036, G037, G040, G041, G048, G050, G051, G053]
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1042
---

# SHY-0036: Fill 19 missing G-IDs as fully-refined SHYs (close the roadmap-to-SHY gap)

## User Story

As the ShyTalk operator who codified [[feedback-stories-epics-and-two-surface-sync]] HARD GLOBAL rule ("every roadmap G-ID gets a SHY (no gaps)") on 2026-06-07 ~20:48 BST, I want **every currently-unmapped G-ID in `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md` to be born as a fully-refined SHY .md file**, so that the SHY backlog is a complete mirror of the roadmap and no gap can be silently dropped by future Claude sessions or operator scans.

## Why

Investigation (2026-06-08 ~12:55 BST, cross-referencing the roadmap against the current SHY-INDEX.md):

The roadmap lists 52 G-IDs (G001..G055 with some gaps). Of those, **33 already map** to one of the SHY-0004..SHY-0031 specs (a single SHY can cover multiple G-IDs — e.g. SHY-0006 covers G005+G013+G029). **19 G-IDs are currently unmapped** — they exist in the roadmap but no SHY references them in `roadmap_ids` frontmatter:

| G-ID | Sev      | Category | Source-roadmap line | Why-not-yet                                                                   |
| ---- | -------- | -------- | ------------------- | ----------------------------------------------------------------------------- |
| G001 | Critical | Dep      | line 24             | Kotlin 2.4.0-RC2 → stable upgrade — was deferred because RC2 was the latest at SHY-0024 time |
| G003 | Critical | Test     | line 28             | Parent epic of 15-VM coverage; D1/D2/D3 mapped, parent unmapped               |
| G006 | Critical | Journey  | line 31             | push_permission.feature BDD — surfaced post-PR #1010                          |
| G011 | Important| CI       | line 79             | floating Action tags SHA-pin (post-#1016)                                     |
| G018 | Important| Journey  | line 48             | gift_wall verify e2e — small but real gap                                     |
| G024 | Important| Test     | line 92             | admin-core-modules unconditional `test.skip()` — needs rationale or fix       |
| G025 | Critical | Security | line 27             | `firestore.rules:140` direct admin-claim access throws — use isAdmin()        |
| G031 | Polish   | Dep      | line 107            | CI gate for pre-release Kotlin (companion to G001)                            |
| G032 | Polish   | Dep      | line 108            | biometric alpha rationale comment (companion to SHY-0005's G002)              |
| G034 | Polish   | Test     | line 94             | Firefox/WebKit touch → mouse-event drag rewrite                               |
| G035 | Polish   | Test     | line 95             | Mobile FF/WebKit isMobile-context → viewport sizing rewrite                   |
| G036 | Polish   | CI       | line 84             | sonarcloud.yml `\|\| true` swallows Jest failures                              |
| G037 | Polish   | CI       | line 85             | allure-report.yml `continue-on-error: true` audit                             |
| G040 | Polish   | Doc      | line 105            | CLAUDE.md feature file count stale (33 → 47)                                  |
| G041 | Polish   | Doc      | line 106            | App Lock navigation intercept undocumented                                    |
| G048 | Polish   | Test     | line 96             | admin-keyboard mobile-viewport skip → split tests                             |
| G050 | Polish   | Test     | line 97             | dev-sanity API-not-running skip → assertion error                             |
| G051 | Polish   | Test     | line 98             | admin-users-moderation conditional skip → seed in global-setup                |
| G053 | Important| Dep      | line 118            | detekt 2.0 Kotlin 2.4 metadata — wait-for-stable tracker                      |

These 19 will be filed as SHY-0041 through SHY-0059 (one per G-ID, sequential numbering). Each SHY is born **fully refined** per [[feedback-no-skeleton-stories-fully-refined]] HARD RULE — no `N/A — TBD refinement on pickup` placeholders, all 8 AC dimensions verifiable, BDD scenarios present, Test Plan named with real file paths, Dependencies/Risks/Out-of-Scope/DoD concrete.

**Why all 19 in ONE PR (not 19 separate PRs):** these are SPECS, not shipped code. The deliverable of SHY-0036 is the 19 spec files themselves; each spec will be picked up later as its own one-spec-one-PR work item per the standard Agile flow ([[feedback-agile-user-stories]]). Bundling 19 specs in one PR is structurally identical to SHY-0032's "28 skeletons refined in one PR" precedent (merged as PR #1037).

**Out-of-scope:** implementing the work each new SHY describes. That happens in the follow-up PRs once each SHY is picked up.

## Acceptance Criteria

### Happy path

- [ ] 19 new files created at `.project/stories/SHY-NNNN-<kebab-slug>.md` where NNNN ∈ {0041..0059} and each file's `id:` frontmatter matches.
- [ ] Each new file passes `bash scripts/check-story-frontmatter.sh --scan .project/stories` (exit 0 — all 9 frontmatter fields valid; 10 required `##` body sections present; 8 required `###` AC sub-headings present; ≥1 BDD scenario when AC has bullets).
- [ ] Each new file is **fully refined** per [[feedback-no-skeleton-stories-fully-refined]]: every `### <dim>` AC has either ≥1 verifiable `- [ ]` bullet OR `N/A — <specific reason>` (NOT `N/A — TBD …`); `## Test Plan` Red + Green name real files + test names; `## Dependencies` + `## Risks & Mitigations` + `## Out of Scope` + `## Definition of Done` contain concrete content.
- [ ] Each new file's `roadmap_ids:` frontmatter contains the corresponding G-ID (single-element array).
- [ ] `SHY-INDEX.md` updated: 19 new rows in the Active table, sorted by priority asc + created asc within ties; the Reserved table forward-reference for SHY-0041..0058 is replaced/extended to SHY-0041..0059.
- [ ] `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md` cross-labelled: each of the 19 affected G-ID rows gains a new `SHY` column entry (or inline annotation) pointing to its SHY-NNNN.
- [ ] SHY-0035 status flip is committed in this branch's FIRST commit (already landed as `83e4ab182bb`).

### Error paths

- [ ] **Frontmatter validator fails on any new file**: PR cannot merge; fix in-place rather than weakening the validator. Specific exit codes: 10 missing field, 11 invalid value, 12 missing ## section, 13 BDD coverage gap, 14 missing ### AC sub-heading.
- [ ] **Two new files claim the same SHY-NNNN id**: validator catches via duplicate-id check. Fix by re-numbering.
- [ ] **A new file's slug doesn't match its title's kebab-case form**: handled by file-naming convention; cross-check at write time.
- [ ] **Roadmap cross-label mis-references a SHY-NNNN that doesn't exist**: caught by reviewer cycle; fix by aligning.
- [ ] **A new SHY's `roadmap_ids:` references a G-ID already mapped to another SHY**: would be a duplicate mapping; cross-check before write.

### Edge cases

- [ ] **G003 is the parent of G003-D1/D2/D3** (already mapped to SHY-0010/0011/0012). The new SHY-0042 (for G003) is a meta-tracker spec that links to the 3 sub-SHYs; its `## Acceptance Criteria` defers all implementation to the sub-SHYs and its `status:` is `Draft` (tracking-only).
- [ ] **G032 is a companion to G002** (already mapped to SHY-0005 biometric-alpha-to-stable). The new SHY-0049 (for G032) explicitly defers to SHY-0005 in its `## Dependencies` section and may be marked `Done` immediately if SHY-0005's PR includes the rationale comment.
- [ ] **G031 is a companion to G001**. Similar handling: SHY-0048 depends on SHY-0041 (G001).
- [ ] **G049 is companion to G022** (mapped to SHY-0020 E2 event-driven matrix); G049 is NOT in the 19 because G022 already covers the design intent.
- [ ] **Some test-skip G-IDs (G034, G035, G048, G050, G051)** all touch `tests/web/*.spec.ts` files; specs may share patterns (Given test-skip at file:line → When fixture seeded / behaviour fixed → Then test runs) but each must reference its specific file:line + test name.
- [ ] **Polish-priority G-IDs (G031, G032, G034, G035, G036, G037, G040, G041, G048, G050, G051)** are P2 — sorted to the bottom of the Active table per the sort rules.

### Performance

- [ ] Authoring the 19 specs locally: <1 hour wall-clock (target — operator AFK so no hard deadline, but bounded so the PR doesn't sit DRAFT for days).
- [ ] `check-story-frontmatter.sh --scan` against the full `.project/stories` directory: <30 seconds (currently ~21s with 34 files; will be ~33s with 53 files — well within bounds).
- [ ] No CI runtime impact — this PR is `.md`-only outside `.project/stories/` so most CI jobs no-op (Sonar skipped per the `HAS_CODE=false` guard in pre-push).

### Security

- [ ] N/A — meta-SHY produces spec files only; no code, no secrets, no permissions changes. The individual SHYs each have their own Security AC for their downstream implementations.

### UX

- [ ] N/A — operator + Claude-facing internal docs only; no end-user UX.

### i18n

- [ ] N/A — internal docs, English-only.

### Observability

- [ ] PR description lists the 19 new SHY-NNNN ↔ G-ID mappings table for easy reviewer scanning.
- [ ] Each new SHY's `## Notes (running log)` opens with a creation-timestamp + reference back to SHY-0036 + the source-roadmap line number, so future audits can trace lineage.
- [ ] Roadmap cross-label edits use a consistent format (e.g. inline `**SHY-NNNN**` next to the G-ID column entry).
- [ ] Commit message names the count: `[SHY-0036] file 19 SHYs for the 19 missing G-IDs (SHY-0041..0059)`.

## BDD Scenarios

**Scenario: 19 new SHY files exist after the commit**

- **Given** the working tree is on `story/SHY-0036-fill-missing-g-ids` at HEAD
- **When** the contributor runs `ls .project/stories/SHY-{0041..0059}-*.md | wc -l`
- **Then** the count is exactly 19
- **And** every file has a frontmatter `id:` matching its filename's SHY-NNNN
- **And** every file has a `roadmap_ids:` array containing exactly one of the 19 missing G-IDs

**Scenario: Frontmatter validator accepts all 19 new files**

- **Given** the 19 new SHYs exist on disk
- **When** the contributor runs `bash scripts/check-story-frontmatter.sh --scan .project/stories`
- **Then** the script exits 0
- **And** stderr does NOT contain `::error::`

**Scenario: No skeleton placeholders escape the no-skeleton rule**

- **Given** the 19 new SHYs exist on disk
- **When** the contributor runs `grep -rn 'TBD refinement on pickup' .project/stories/SHY-{0041..0059}*.md`
- **Then** the grep exits 1 (no matches)
- **And** stderr is empty

**Scenario: SHY-INDEX.md lists all 19 new SHYs in the Active table**

- **Given** the 19 new SHYs exist on disk
- **When** the contributor reads `.project/stories/SHY-INDEX.md`
- **Then** the Active table contains exactly 19 new rows (one per SHY-0041..0059)
- **And** each row's link `[SHY-NNNN](SHY-NNNN-slug.md)` resolves to an existing file

**Scenario: Roadmap is cross-labelled for all 19 affected G-IDs**

- **Given** the 19 G-IDs have new SHYs assigned
- **When** the contributor reads `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`
- **Then** each of the 19 G-ID rows has a SHY-NNNN reference (inline or new column)
- **And** the SHY-NNNN matches the new SHY file's `id:`

**Scenario: Closing the previous PR's status (SHY-0035)**

- **Given** SHY-0035 merged as PR #1041 at 2026-06-08T11:54:59Z
- **When** the contributor reads `.project/stories/SHY-0035-investigate-repo-size.md` frontmatter
- **Then** the `status:` is `Done`
- **And** the `pr:` is `https://github.com/Shyden-Ltd/ShyTalk/pull/1041`

## Test Plan

**Red (the validator + grep gates):**
- `bash scripts/check-story-frontmatter.sh --scan .project/stories` — must exit 0 after all 19 files written.
- `grep -rn 'TBD refinement on pickup' .project/stories/SHY-{0041..0059}*.md` — must exit 1 (no matches).
- `ls .project/stories/SHY-{0041..0059}-*.md | wc -l` — must print `19`.
- `awk -F: '/^id:/{print $2}' .project/stories/SHY-{0041..0059}*.md | sort -u | wc -l` — must print `19` (no duplicate IDs).

**Green:**
- Author the 19 spec files using the canonical template + content adapted from the roadmap row for each G-ID.
- Update `.project/stories/SHY-INDEX.md` with the 19 new rows in the Active table.
- Cross-label `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md` for each of the 19 G-IDs.
- Run the Red commands locally to verify.

**Coverage gate:** the four Red commands above all pass.

## Out of Scope

- **Implementing the work each new SHY describes** — that's the downstream one-spec-one-PR work, picked up in priority order.
- **Updating the SHY corpus's `roadmap_ids` for pre-existing SHYs** — those mappings are correct as-is.
- **Renaming or re-numbering existing SHYs** — all SHY-NNNN IDs are immutable per CLAUDE.md "no recycling" rule.
- **Architectural changes to the SHY framework itself** — see SHY-0037 (introduce EPICs) for the next-phase refinement.
- **Force-pushing to rewrite the SHY-0035 close-out commit into this PR** — separate commits is fine; squash-merge bundles them.

## Dependencies

- **SHY-0035 (merged as #1041)** — branch off post-merge main; admin commit ride-along already landed (`83e4ab182bb`).
- **`scripts/check-story-frontmatter.sh`** — must exist + be executable (delivered by SHY-0001).
- **`.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`** — must exist (it does, 203 lines).
- **CLAUDE.md § Agile Way of Working** — the spec for SHY frontmatter + body sections; this PR conforms.

## Risks & Mitigations

- **Risk: 19 specs in one PR is too much to review.** Mitigation: each spec is independently scoped + short; reviewer can chunk by G-ID. The SHY-0032 precedent (28 skeleton refinements in one PR) confirmed this scale is reviewable.
- **Risk: I'll author skeletons under time pressure.** Mitigation: the no-skeleton rule is enforced by structural review; every spec must concretely name files/tests/scenarios. Skeleton detection is a grep-able pattern.
- **Risk: A spec misclaims a G-ID's scope** (e.g. says XS but actual is M). Mitigation: source scope from the roadmap row; cross-check.
- **Risk: SHY-INDEX sort order drifts.** Mitigation: tested by frontmatter validator + reviewed; manual sort by priority asc + created asc.
- **Risk: Roadmap cross-label format inconsistent across the 19 edits.** Mitigation: use a single edit-format string applied to every row.
- **Risk: G003's meta-tracker pattern is novel and might confuse future Claude.** Mitigation: explicit prose in SHY-0042's `## Notes` explaining the tracker-vs-implementation split; status starts as `Draft` to signal tracking-only.

## Definition of Done

- [ ] All 19 SHY files created with valid frontmatter + fully-refined bodies.
- [ ] `bash scripts/check-story-frontmatter.sh --scan .project/stories` exits 0.
- [ ] `grep -rn 'TBD refinement on pickup' .project/stories/SHY-{0041..0059}*.md` exits 1 (no skeletons).
- [ ] SHY-INDEX.md updated with all 19 new rows + Reserved table cleaned.
- [ ] Roadmap cross-labelled for all 19 G-IDs.
- [ ] Architect agent: ZERO findings on the batch.
- [ ] Code-reviewer agent: ZERO findings on the batch.
- [ ] Per-type Done gate (`chore` → auto-merge once green; no dev-deploy required).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~12:55 BST — SHY-0036 spec authored on `story/SHY-0036-fill-missing-g-ids`. Branch opened off post-merge main HEAD `c0b9905f90a` (SHY-0035 merge). Operator wake-up prompt said "18 missing G-IDs" but enumeration shows 19; spec uses the accurate count of 19 (SHY-0041..0059 instead of SHY-0041..0058). SHY-INDEX promoted SHY-0036 Reserved → Active in the close-out commit.
