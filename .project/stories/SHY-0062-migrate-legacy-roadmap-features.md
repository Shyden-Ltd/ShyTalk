---
id: SHY-0062
status: Draft
owner: claude
created: 2026-06-10
priority: P1
effort: XL
type: chore
roadmap_ids: []
pr:
epic: EPIC-0002
mvp: true
---

# SHY-0062: Migrate ~95 legacy roadmap features into tracked stories (meta/tracker)

## User Story

As the ShyTalk operator, I want every hand-written `phases[].features[]` entry on the public roadmap converted into a tracked, fully-refined SHY story, so the public page and the backlog are one system with no dual-source drift.

## Why

Reserved since 2026-06-07; operator greenlit FULL migration 2026-06-10 ("Yes, start it today"). The renderer reads `items[]` (SHY-0061, v0.97.9); the always-translated guarantee is carried by SHY-0072/0073. This meta-story coordinates the 8 phase batches and pins the conversion conventions so every batch is mechanical and reviewable.

## Acceptance Criteria

### Happy path (tracking-only — implementation lives in the batch SHYs)
- [ ] Batch table below reaches 8/8 shipped; all 95 features exist as `public: true` SHYs with `phase` set; EPIC-0002 `child_shys` updated per batch.
- [ ] **Conversion conventions (binding on every batch):**
  - status mapping: `done` → `status: Done` + `released_in: pre-rule` (historic-shipped sentinel, SHY-0064-notes precedent) + `pr:` left empty with a Notes line "migrated historic feature; shipped pre-framework"; `in-progress` → `In Progress`; `planned` → `Draft`.
  - every migrated SHY is FULLY REFINED at authoring (operator re-affirmed 2026-06-10) — descriptions seed the User Story/Why; AC across all 8 dimensions derived from the feature's meaning; the pickup-fitness-review gate (every-story rule) is the staleness net.
  - English-only content (web translations are SHY-0072/0073's runtime concern — NO i18n payloads in story files; the legacy `i18n` data is left in place in roadmap-data.json's features[] until the phase's features[] entries are retired, then dropped with the batch that retires them).
  - one batch = one PR = one batch-SHY; the batch PR contains: the batch-SHY file + that phase's feature-SHY files + removal of the migrated entries from the phase's `features[]` (sync regenerates `items[]` on merge; SHY-0073's renderer translates them lazily).
  - ID allocation: batch SHYs and feature SHYs consume sequential IDs at filing time (no pre-reservation — gaps invite collisions; the table records actuals as they land).
- [ ] Ordering: batches ship AFTER SHY-0072 + SHY-0073 are live (otherwise non-English visitors see untranslated migrated entries — violates the always-translated rule). Smallest phase first (Revenue & Status, 3) as the pilot to validate conventions cheaply, then by size.

### Error paths
- [ ] A migrated entry that proves unmappable to a sensible story (pure marketing copy, duplicates an existing SHY) → recorded in the batch-SHY Notes with disposition (merged-into-SHY-NNNN / dropped-with-operator-ack) — never silently skipped.

### Edge cases
- [ ] Features duplicating EXISTING tracked SHYs (e.g. "Age-gating per feature" = SHY-0060) → the existing SHY absorbs (gets `public: true` + phase if missing); no duplicate file.
- [ ] `done` features that match already-shipped tracked work → cross-referenced in Notes rather than duplicated.

### Performance
- [ ] N/A — content migration; sync-perf is SHY-0040/0071 territory.

### Security
- [ ] Migrated public content review: no entry may leak internal infra detail beyond what the public page already showed (batch reviewer checklist item).

### UX
- [ ] Public page entry count never dips mid-migration (each batch PR removes features[] entries and adds items[] sources atomically in one merge).

### i18n
- [ ] Covered by SHY-0072/0073 (runtime); batches MUST NOT ship before those are live (ordering AC above).

### Observability
- [ ] Batch table below is the audit trail; per-batch Notes record counts + dispositions.

## Batch tracker

| # | Phase | Features | Batch SHY | Status |
|---|---|---|---|---|
| 1 | Revenue & Status (pilot) | 3 | TBD at filing | Pending |
| 2 | Support & Feedback | 6 | TBD | Pending |
| 3 | Entertainment | 8 | TBD | Pending |
| 4 | Social & Discovery | 8 | TBD | Pending |
| 5 | Quality of Life | 11 | TBD | Pending |
| 6 | Platform & iOS | 17 | TBD | Pending |
| 7 | Safety & Compliance | 20 | TBD | Pending |
| 8 | Website & Presence | 22 | TBD | Pending |

## BDD Scenarios

**Scenario: a batch lands atomically**
- **Given** SHY-0072 + SHY-0073 are live and batch 1's PR merges
- **When** the sync regenerates roadmap-data.json
- **Then** Revenue & Status shows its 3 entries as story-derived items (badged, linked, lazily translated) and its features[] array is empty
- **And** the page's total visible entry count is unchanged

**Scenario: duplicate-of-existing absorbs**
- **Given** a feature matching an existing tracked SHY
- **When** its batch is authored
- **Then** the existing SHY gains public/phase fields and the batch Notes record the absorption — no new file

## Test Plan

Tracking-only: each batch SHY carries its own Test Plan (validator scan green; sync-regen assertions; entry-count parity check per the UX AC — a Playwright fixture test comparing pre/post counts ships with batch 1 and runs for every batch).

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Meta/tracker story — the protocol binds on each of the 8 BATCH PRs, not on this coordinator.** Editing *this* file touches no code, so the SHY-0062 coordinator merge is itself `*.md`-only (device/browser gauntlet exempt: validator + review only). But every batch PR it tracks is a **public-web change** (removes `features[]` entries + adds migrated `public: true` SHYs + the sync regenerates `items[]` + SHY-0073's renderer translates them lazily) → each batch runs the FULL protocol:

**Per-batch frameworks exercised (RED→GREEN):**
- ✅ **Web E2E Playwright** — the **entry-count parity** test (UX AC: total visible count unchanged across the batch's atomic merge) + badge/link/lazy-translation render, run against the **REAL rendered public page off the real sync-regenerated `roadmap-data.json`** — NOT a mocked roadmap payload (per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only); on ALL browsers (Mac chromium/firefox/webkit/edge + Android + iOS device browsers).
- ✅ **Express Jest** — only if a batch touches the sync/regen script itself (pure content batches do not; the relevant batch flags it in its own Test Plan if so).
- ✅ **`scripts/check-story-frontmatter.sh --scan` + `check-epic-frontmatter.sh --scan`** — green after each batch (new SHY files + EPIC-0002 `child_shys` update well-formed).
- ⬜ **Android/iOS app · Kotlin/detekt/ktlint** — N/A (web-content migration; no app surface).

**LOCAL gauntlet (per batch):** the parity + render Playwright pack green on the real local-stack-served page across all Mac browsers + real Android + real iPhone browsers; validator scans exit 0. Any failure → fix TDD → restart.
**DEV gauntlet (per batch):** redeploy the unmerged batch branch via Deploy-To-Dev `ref`; re-run the parity + render pack on Chrome against the real dev-served page. Restart from LOCAL on failure.
**Judgment-merge** each batch only when production-ready with zero doubt; the coordinator flips Done only once 8/8 batches have each passed their own gauntlet AND the post-batch-8 release is cut.

## Out of Scope

- The translation service + renderer work (SHY-0072/0073).
- Retiring the `features[]` SCHEMA (only emptied per phase; schema removal is a follow-up once 8/8).
- Backfilling `pr:` for historic done features (none exists; sentinel convention covers it).

## Dependencies

- SHY-0072 → SHY-0073 (hard ordering, then batches).
- Operator decisions all captured 2026-06-10 (memory: feedback-public-translations-lazy-architecture; ask-freely posture remains in force for batch-time questions).

## Risks & Mitigations

- **Risk:** 95 fully-refined specs drift before pickup. **Mitigation:** the new every-story pickup-fitness-review rule exists precisely for this (operator chose full refinement with that net).
- **Risk:** batch PRs balloon (20+ stories each for late phases). **Mitigation:** conventions validated on the 3-entry pilot; late phases may sub-split if review quality demands (operator informed first — ask-freely).

## Definition of Done

- [ ] 8/8 batches shipped + table complete; all conventions held; EPIC-0002 DoD items relating to migration satisfied; entry-count parity held at every step.
- [ ] **Pre-Merge Testing Protocol satisfied** on every batch PR (`CLAUDE.md` § Pre-Merge Testing Protocol): each batch's Web E2E parity + render pack green on ALL browsers (real Mac + real Android + real iPhone) against the real sync-regenerated page → `code-reviewer` 100% clean → CI green by name → DEV (Chrome) parity green → judgment-merge. The SHY-0062 coordinator merge is itself `*.md`-only → device gauntlet exempt.
- [ ] `status: Done` deferred to the release cut after batch 8; SHY-INDEX synced throughout.

## Notes (running log)

- 2026-06-10 ~10:25 BST — Meta-story authored after the operator's three-round design session (full migration greenlit; full refinement re-affirmed with the new pickup-review net; translations = web-layer lazy service; stories English-only; gated GitHub links). Filed alongside EPIC-0002 + SHY-0072 + SHY-0073.
- 2026-06-13 ~00:44 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): meta/tracker → the protocol binds on the 8 BATCH PRs (each a public-web change: Web E2E entry-count parity + render on ALL browsers against the REAL sync-regenerated page), not on this coordinator (whose own merge is `*.md`-only-exempt). No-Stubs ([[feedback-no-stubs-mocks-fakes-real-only]]): the parity "fixture" test is bound to the REAL rendered page off real `roadmap-data.json` — no mocked roadmap payload; the subsection supersedes the older "fixture" wording. DoD gains a per-batch protocol-satisfied bullet. Pickup-fitness: AC current; the hard ordering (gated behind SHY-0072+0073 live) + the smallest-phase-first pilot both stand; no stale cross-refs.
