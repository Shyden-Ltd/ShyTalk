---
id: SHY-0122
status: Draft
owner: claude
created: 2026-06-17
priority: P2
effort: L
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0122: Migrate Admin-portal tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Admin-portal test (alerts / logs / devices / economy / audit, ~25 files) moved off in-process doubles and onto the real Firestore emulator + real Express API,
**So that** admin actions are proven to propagate to real state (and to the app/portal), not just to confirm a mocked call shape.

## Why

The admin portal is where privileged mutations originate, and the /manual-qa principle "cross-platform integration is king" makes an admin action that works in the panel but doesn't propagate a Blocker, not a Minor. Mocked admin tests cannot prove propagation. ~25 files makes this an L area. It is P2 because most safety-critical admin behaviour (bans/warn/appeal) is already covered by the moderation area (SHY-0116) — this covers the remaining portal surfaces (alerts/logs/devices/economy/audit).

## Acceptance Criteria

### Happy path
- [ ] Every admin-portal test (alerts/logs/devices/economy/audit) runs against the real Firestore emulator + real Express API; no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains.
- [ ] An admin mutation (e.g. resolve an alert, adjust economy config) writes real state, and the real consumer surface (app/portal) observes it within the real window.
- [ ] Audit entries for admin actions are written to real state and readable via the real audit path.

### Error paths
- [ ] A non-admin attempting an admin route is denied by **real** auth/rules (not a mocked guard).
- [ ] Invalid admin input rejected by the real backend contract.
- [ ] A real empty-state (no alerts/logs) handled gracefully.

### Edge cases
- [ ] Cross-platform propagation: an admin action propagates to the app/portal within the real cache window (the king principle).
- [ ] Audit completeness: every mutating admin action leaves a real audit entry (boundary: read-only admin views leave none).
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Admin list/log render budgets asserted; migrated suite completes in a few seconds against a warm emulator.

### Security
- [ ] Admin-only enforcement by **real** auth/rules as the contract; audit immutability respected; no secrets logged.

### UX
- [ ] A real admin-action → consumer-sees-it flow is walked as the consumer (cross-platform).

### i18n
- [ ] Admin strings render in ≥1 RTL + ≥1 CJK locale on the real surface (spot-check) where user-facing.

### Observability
- [ ] Real admin/audit logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: an admin action propagates to real state and the consumer**
- **Given** an admin resolves an alert on the real portal
- **When** the consumer surface re-reads within the real window
- **Then** real state shows the alert resolved on both sides

**Scenario: a non-admin is denied for real**
- **Given** a non-admin user
- **When** they call an admin route
- **Then** real auth/rules deny it (no mocked guard)

**Scenario: every mutating admin action leaves a real audit entry**
- **Given** an admin performs a mutating action
- **When** the audit path is read
- **Then** a real audit entry exists for it

**Scenario: a surfaced admin bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each admin-portal test to require the real emulator + real Express API + real auth → fails until seeded real.

**GREEN:** seed real admin + consumer state; exercise real admin mutations + propagation + audit + negative paths; file + `@known-failure`-tag surfaced bugs. Canonical `npm test` green; cross-platform spot-check for propagation.

**Frameworks:** express Jest (real Firestore emulator + real API + real auth), Playwright/web for the portal where applicable, frontmatter validator. **Real backend:** Firestore emulator + real Express API + real rules.

## Out of Scope
- Bans/warn/appeal admin paths (covered by SHY-0116 moderation).
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- Sub-splitting: ~25 files delivered as 1-SHY-1-PR slices (alerts · logs · devices · economy-admin · audit) at pickup.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0114** (auth) — real admin sessions.
- **SHY-0109** + `firebase-emulator.js`.

## Risks & Mitigations
- **Risk:** propagation timing flakiness. **Mitigation:** bounded real waits on the real consumer read.
- **Risk:** L scope. **Mitigation:** vertical 1-SHY-1-PR slices.

## Definition of Done
- All admin-portal tests double-free + asserting real (propagated) state; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; `code-reviewer` + `security-reviewer` zero findings; CI green by name; cross-platform propagation spot-check passed.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P2, ~25 files L).** Privileged mutations; propagation proven cross-platform against real state. Safety-critical admin (bans/warn/appeal) lives in SHY-0116. L → sub-split at pickup.
