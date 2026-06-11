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
- [ ] `status: Done` deferred to the release cut after batch 8; SHY-INDEX synced throughout.

## Notes (running log)

- 2026-06-10 ~10:25 BST — Meta-story authored after the operator's three-round design session (full migration greenlit; full refinement re-affirmed with the new pickup-review net; translations = web-layer lazy service; stories English-only; gated GitHub links). Filed alongside EPIC-0002 + SHY-0072 + SHY-0073.
