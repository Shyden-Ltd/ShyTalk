---
id: SHY-0121
status: Draft
owner: claude
created: 2026-06-17
priority: P2
effort: XL
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0121: Migrate Suggestions / Roadmap tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Suggestions / Roadmap test (lifecycle / contracts / voting, ~45 files) moved off in-process doubles and onto the real Firestore emulator,
**So that** the suggestion lifecycle (submit → vote → status transitions → roadmap sync) is proven against real state, not mocked transitions.

## Why

Suggestions is a large fake cluster (~45 files) but lower user-risk than safety/economy, so it sits in P2. The lifecycle has many state transitions + voting integrity (one-vote-per-user, tally correctness) that mocks confirm only structurally. Migrating to real state proves the transitions + tallies actually hold, and exercises the roadmap-sync contracts against the real datastore.

## Acceptance Criteria

### Happy path
- [ ] Every suggestions/roadmap test runs against the real Firestore emulator; no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains.
- [ ] A real suggestion submitted → voted → transitioned through its real lifecycle states is asserted via real reads at each step; the real vote tally reflects real votes.
- [ ] Roadmap-sync contracts produce the real expected roadmap state from real suggestion state.

### Error paths
- [ ] Duplicate vote by the same real user is prevented by the **real** backend (one-vote-per-user), asserted on real tally.
- [ ] Invalid state transition / unauthorised status change rejected by the real contract.
- [ ] A real empty-suggestions state is handled gracefully.

### Edge cases
- [ ] Vote tally boundary (concurrent votes converge to the correct real count — no lost/duplicate vote).
- [ ] Lifecycle terminal-state behaviour (a closed/shipped suggestion rejects further votes) at the real value level.
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Suggestion-list/vote budgets asserted on the real surface; migrated suite completes in a few seconds against a warm emulator.

### Security
- [ ] Real-rules enforcement (a user votes/edits only as permitted); no secrets logged.

### UX
- [ ] The real submit → vote → see-status flow is walked as the consumer.

### i18n
- [ ] Suggestion + status strings render in ≥1 RTL + ≥1 CJK locale on the real surface (spot-check).

### Observability
- [ ] Real suggestions/roadmap logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: a real suggestion moves through its lifecycle**
- **Given** a real suggestion submitted by persona A
- **When** it is voted and transitioned through its real states
- **Then** real reads show each state + the correct real tally

**Scenario: a duplicate vote is prevented for real**
- **Given** persona A has voted on a suggestion
- **When** A votes again
- **Then** the real backend keeps the tally unchanged (one-vote-per-user)

**Scenario: concurrent votes converge to the right count**
- **Given** N real personas voting concurrently
- **When** all votes land
- **Then** the real tally equals N (no lost/duplicate vote)

**Scenario: a surfaced suggestions bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each suggestions/roadmap test to require the real emulator → fails until seeded real; a concurrent-vote test fails until real tally integrity holds.

**GREEN:** seed real suggestions/votes; exercise real lifecycle/voting/roadmap-sync/negative paths; assert real value-level outcomes; file + `@known-failure`-tag surfaced bugs. Canonical `npm test` green; device/web spot-check where a suggestions UI path is involved.

**Frameworks:** express Jest (real Firestore emulator), Playwright/web + device gauntlet where a suggestions UI path is touched, frontmatter validator. **Real backend:** Firestore emulator + real rules.

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- Sub-splitting: ~45 files delivered as 1-SHY-1-PR slices (lifecycle · voting · contracts · roadmap-sync) at pickup.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0114** (auth) — real signed-in voters.
- **SHY-0109** + `firebase-emulator.js`.

## Risks & Mitigations
- **Risk:** large file count balloons effort. **Mitigation:** vertical 1-SHY-1-PR slices; lower P2 priority means it follows the higher-risk areas.
- **Risk:** concurrent-vote flakiness. **Mitigation:** drive genuine concurrency + assert converged real tally.

## Definition of Done
- All suggestions/roadmap tests double-free + asserting real state; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; `code-reviewer` zero findings; CI green by name; gauntlet/web where a UI path is touched.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P2, ~45 files XL).** Large but lower user-risk; lifecycle transitions + voting integrity proven against real state. XL → sub-split at pickup.
