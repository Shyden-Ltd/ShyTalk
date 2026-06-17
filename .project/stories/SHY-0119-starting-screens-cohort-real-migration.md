---
id: SHY-0119
status: Draft
owner: claude
created: 2026-06-17
priority: P1
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0119: Migrate Starting-screens / cohort-gated tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** the Starting-screens / cohort-gated read-write tests (~5 files) moved off in-process doubles and onto the real Firestore emulator + real rules,
**So that** the cohort gate — which decides what a user is even allowed to see on entry — is proven against real rules, not a mocked allow/deny.

## Why

A cohort gate that "works" against a mock but lets the wrong cohort through is a Blocker-class defect (the /manual-qa skill flags cohort gates as needing full cross-platform re-verification after any change). The starting screens are the first thing a user sees, so a faked gate corrupts the entire entry experience. ~5 files makes this a tight M-sized area to fully migrate.

## Acceptance Criteria

### Happy path
- [ ] Every starting-screen/cohort test runs against the real Firestore emulator + **real rules**; no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains.
- [ ] A real user in cohort X sees exactly the cohort-X starting content (real gated read returns the right set); a real user not in the cohort does not.

### Error paths
- [ ] A cohort-gated write attempted by an out-of-cohort user is denied by **real rules** (not a mocked guard), asserted on real state.
- [ ] A real empty/uninitialised cohort state is handled as a genuine clean slate (graceful, not a crash).

### Edge cases
- [ ] Cohort boundary: a user exactly on the inclusion boundary is gated correctly at the real value level.
- [ ] Cohort transition (user moves in/out of a cohort) reflects in the real gated read within the real cache window.
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Starting-screen render budget asserted on the real surface; migrated suite completes quickly against a warm emulator.

### Security
- [ ] Cohort gating enforced by **real rules** as the contract; no secrets logged; any rules change → operator rules-deploy checkpoint.

### UX
- [ ] The real entry → correct-cohort-content flow is walked as the consumer.

### i18n
- [ ] Starting-screen strings render in ≥1 RTL + ≥1 CJK locale on the real surface (spot-check).

### Observability
- [ ] Real cohort/gate logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: an in-cohort user sees the gated content (real rules)**
- **Given** real rules + a real user in cohort X
- **When** they reach the starting screen
- **Then** the real gated read returns exactly the cohort-X content

**Scenario: an out-of-cohort write is denied for real**
- **Given** a real user not in cohort X
- **When** they attempt a cohort-X-gated write
- **Then** real rules deny it (no mocked guard)

**Scenario: a cohort transition reflects in real state**
- **Given** a real user added to cohort X
- **When** the starting screen re-reads within the real cache window
- **Then** the cohort-X content now appears

**Scenario: a surfaced cohort bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each starting-screen/cohort test to require the real emulator + real rules → fails until seeded real.

**GREEN:** seed real cohort membership + content; exercise real gated reads/writes/transitions; file + `@known-failure`-tag surfaced bugs. Canonical `npm test` green; cross-platform spot-check on the real surface (cohort gates need it).

**Frameworks:** express Jest (real Firestore emulator + real rules), frontmatter validator; gauntlet/cross-platform spot-check for the gate. **Real backend:** Firestore emulator + real rules.

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- Sub-splitting: ~5 files — likely a single PR, split only if a surfaced blocker forces it.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0114** (auth) — real signed-in cohort members.
- **SHY-0109** + `firebase-emulator.js`; real rules deployed to the emulator.

## Risks & Mitigations
- **Risk:** cohort logic depends on rules (operator-gated). **Mitigation:** prepare rules diff + real failing test → operator checkpoint.
- **Risk:** cache-window timing flakiness. **Mitigation:** bounded real waits on the real read.

## Definition of Done
- All starting-screen/cohort tests double-free + asserting real gated state; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; cross-platform spot-check passed; `code-reviewer` zero findings; CI green by name.
- Judgment-merge. Story → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P1, ~5 files, tight M).** Cohort gate is Blocker-class if wrong; proven against real rules, not a mocked allow/deny. Likely a single PR.
