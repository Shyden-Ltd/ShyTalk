---
id: SHY-0042
status: Draft
owner: claude
created: 2026-06-08
priority: P0
effort: XS
type: docs
roadmap_ids: [G003]
pr:
mvp: true
---

# SHY-0042: G003 ViewModel-coverage tracker (meta — links the 3 implementation SHYs)

## User Story

As the ShyTalk operator who codified [[feedback-stories-epics-and-two-surface-sync]] ("every roadmap G-ID gets a SHY (no gaps)"), I want **a SHY explicitly mapped to G003** ("15 ViewModels uncovered") so the roadmap-to-SHY surjection is complete — even though G003's IMPLEMENTATION work is split across three already-filed SHYs ([[SHY-0010]], [[SHY-0011]], [[SHY-0012]]). This is a tracker-only SHY; its `status` flips to `Done` when all three implementation SHYs have shipped.

## Why

The original roadmap row (line 28, 2026-06-05): `G003 | 🔴 Critical | Test — 15 ViewModels uncovered | ... Only EmailOtp, LockScreen, PinSetup, AgeVerificationSubmit have tests; HomeViewModel + GachaViewModel + WalletViewModel + 12 others uncovered | Per-VM TDD: state machine (initial/loading/success/error/cancel) + adversarial (null user, network fail, concurrent launches) | L`.

The L-scope was infeasible as one PR (15 VMs × per-VM TDD ≈ 30+ tests + fake-graph extraction), so it was split per Phase D of the roadmap (lines 53-56):

- **G003-D1** → [[SHY-0010]] (HomeViewModel + GachaViewModel)
- **G003-D2** → [[SHY-0011]] (WalletViewModel + GiftingViewModel + TransactionHistoryViewModel)
- **G003-D3** → [[SHY-0012]] (10 remaining VMs)

This SHY-0042 exists purely so the G003 top-level identifier resolves to a SHY when scanned. Its body delegates all acceptance to the three sub-SHYs; its `status` is `Draft` until all three merge, at which point it flips to `Done` with `pr:` linking to a virtual aggregate (e.g. the last-merged sub-SHY's PR).

**Scope rationale:** filing a tracker SHY is XS (this file itself is the only deliverable). The implementation work lives in the three sub-SHYs.

## Acceptance Criteria

### Happy path

- [ ] This file exists at `.project/stories/SHY-0042-viewmodel-coverage-tracker.md` with valid frontmatter + 10 required body sections.
- [ ] `## Why` references [[SHY-0010]] + [[SHY-0011]] + [[SHY-0012]] explicitly.
- [ ] When all three sub-SHYs reach `status: Done`, SHY-0042's frontmatter `status:` flips to `Done` and `pr:` is populated with a meta-entry like `Closed via SHY-0010 #N, SHY-0011 #N, SHY-0012 #N`.
- [ ] Roadmap row for G003 (line 28) gains a SHY annotation pointing at this file: `SHY-0042 (tracker)`.

### Error paths

- [ ] **A sub-SHY (SHY-0010/0011/0012) gets cancelled**: SHY-0042's `## Notes` records the reason; G003 may need a new replacement implementation SHY filed.
- [ ] **A sub-SHY's scope drifts away from G003** (e.g. covers VMs not in the original 15): tracker Notes record the deviation; G003 row in roadmap may need to be split.
- [ ] **One sub-SHY ships but another is blocked indefinitely**: SHY-0042 stays `Draft` until all three reach `Done` (no partial-Done state allowed for the tracker).

### Edge cases

- [ ] **The 15-VM list changes** (new ViewModel added to the codebase): file a follow-up SHY (e.g. SHY-NN-add-new-vm-test) explicitly cross-linked to G003; SHY-0042 still maps to the original 15.
- [ ] **A sub-SHY's PR is split into multiple PRs** (e.g. SHY-0012's 10 VMs split across 2 PRs): tracker stays bound to the sub-SHY, not its PR shape.
- [ ] **Order of completion**: any order is fine; tracker waits for ALL three.

### Performance

- [ ] N/A — tracker file, no runtime impact.

### Security

- [ ] N/A — no code, no permissions changes.

### UX

- [ ] N/A — internal docs.

### i18n

- [ ] N/A — internal docs, English-only.

### Observability

- [ ] When SHY-0042 flips to Done, the Notes entry includes the three sub-SHY PR numbers + merge dates so the audit trail from G003 to PRs is one click.
- [ ] PR-creation for SHY-0042 itself is part of SHY-0036's bundle; no separate PR.

## BDD Scenarios

**Scenario: G003 roadmap row resolves to a SHY**

- **Given** the zero-gap roadmap file contains `G003` at line 28
- **When** the operator scans roadmap rows for SHY annotations
- **Then** the G003 row references `SHY-0042 (tracker)` either inline or in a new SHY column
- **And** `.project/stories/SHY-0042-viewmodel-coverage-tracker.md` exists

**Scenario: SHY-0042 flips to Done after all sub-SHYs ship**

- **Given** [[SHY-0010]], [[SHY-0011]], [[SHY-0012]] all have `status: Done` in their frontmatter
- **When** the operator (or Claude during a sweep) reviews SHY-0042
- **Then** SHY-0042's `status:` should flip to `Done`
- **And** its `## Notes` records the three sub-SHY PR numbers + merge dates

## Test Plan

**Red:**
- `grep -n 'SHY-0042' .project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md` — must return at least one line (the cross-label).
- `bash scripts/check-story-frontmatter.sh --story SHY-0042` — must exit 0.

**Green:**
- This file is the entire deliverable.
- Roadmap cross-label is one line edit on the G003 row.

**Coverage gate:** frontmatter validator + grep for cross-label both succeed.

## Out of Scope

- The IMPLEMENTATION of any VM test — that's [[SHY-0010]], [[SHY-0011]], [[SHY-0012]]'s scope.
- ViewModels outside the G003-roadmap-listed 15 — file separately.
- Architectural refactoring of the VM test framework — out of scope; tracker only.

## Dependencies

- [[SHY-0010]] (G003-D1, Draft)
- [[SHY-0011]] (G003-D2, Draft)
- [[SHY-0012]] (G003-D3, Draft)

## Risks & Mitigations

- **Risk: tracker-SHY pattern is novel; future Claude sessions may misclassify it as "implementation work"** and try to author VM tests under SHY-0042. Mitigation: `type: docs` + explicit prose in `## Why` + `## Out of Scope` referencing the three sub-SHYs.
- **Risk: a tracker-SHY violates the "1 PR-bundle = 1 SHY" convention.** Mitigation: SHY-0042's PR-bundle IS the SHY-0036 batch (the spec file's creation); the tracker has no follow-up PR of its own. Documented.

## Definition of Done

- [ ] File exists with valid frontmatter + 10 body sections + 8 AC sub-headings.
- [ ] Roadmap cross-label exists.
- [ ] Reviewer ZERO findings on the spec (this SHY ships as part of SHY-0036).
- [ ] `status: Draft` at creation; flips to `Done` later when sub-SHYs all ship (managed by a future sweep).

## Notes (running log)

- 2026-06-08 ~12:58 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 28 (G003 parent). Per Edge-case AC in SHY-0036, this is the tracker pattern for G-IDs whose implementation is split into pre-existing sub-SHYs.
