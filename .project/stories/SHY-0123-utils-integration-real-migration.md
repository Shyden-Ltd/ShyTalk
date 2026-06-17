---
id: SHY-0123
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

# SHY-0123: Migrate Utils-integration tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** the integration-layer utility tests (firebase / email / fcm / r2 / alertManager / data-export, ~25 files) moved off in-process doubles and onto their real local backends (Firebase emulator / Mailpit / FCM sandbox / MinIO),
**So that** the shared infrastructure helpers every route depends on are proven against the real services, not mocked clients — closing the gap where a broken util passes because its collaborator was faked.

## Why

The utility layer (firebase wrapper, email via Mailpit, fcm, r2/MinIO storage, alertManager, data-export) is foundational: a faked storage client or email sender means every downstream route inherits an unverified dependency. The local stack already provides the real backends (Mailpit, MinIO, FCM sandbox, Firebase emulator — all $0), so these can be proven for real. **Classification note:** only utils that exercise a real collaborator are integration (migrate here); any util that is genuinely pure logic stays a unit test with doubles permitted per the keystone policy — each file is classified before migration.

## Acceptance Criteria

### Happy path
- [ ] Every integration-layer util test runs against its real local backend (firebase→emulator, email→Mailpit, fcm→sandbox, r2→MinIO, alertManager→real path, data-export→real datastore); no `jest.mock`/`jest.fn` collaborator/fetch-mock/`makeStatefulFakeDb` remains in the integration ones.
- [ ] A real email send lands in Mailpit (asserted via the Mailpit API); a real r2 upload lands in MinIO (asserted via a real read-back); a real data-export produces the real expected artifact from real datastore content.

### Error paths
- [ ] Each util's failure path is induced for real (e.g. a real Mailpit-unreachable / real MinIO-denied / real export-of-empty) — not a mocked rejection — and surfaced correctly.
- [ ] A genuinely un-inducible third-party failure → operator escape-hatch escalation (never a silent mock).

### Edge cases
- [ ] Boundary inputs (empty email body, max-size upload, empty export) handled at the real value level.
- [ ] Pure-logic utils correctly classified as unit (doubles allowed) and moved to a unit-test location per the keystone convention — not force-migrated.
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Real-backend util tests complete within a reasonable budget; uploads/exports batched; no round-trip storm.

### Security
- [ ] Sandbox/local backends only (Mailpit/MinIO/emulator/FCM sandbox); no real credentials/secrets; no secrets logged.

### UX
- [ ] N/A — infrastructure utilities; no direct user-facing surface (downstream UIs covered by their feature areas).

### i18n
- [ ] Email/export templates render correctly in ≥1 RTL + ≥1 CJK locale against the real backend where user-facing content is produced (spot-check).

### Observability
- [ ] Real util logs (alertManager etc.) run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: a real email lands in Mailpit**
- **Given** the real Mailpit backend up
- **When** the email util sends a message
- **Then** the message is retrievable via the real Mailpit API (no mocked transport)

**Scenario: a real upload lands in MinIO and reads back**
- **Given** the real MinIO backend up
- **When** the r2 util uploads an object
- **Then** a real read-back returns the same bytes

**Scenario: a pure-logic util is classified unit, not force-migrated**
- **Given** a util with no real collaborator
- **When** it is reviewed for migration
- **Then** it is marked a unit test (double allowed) and placed in a unit-test location per the keystone convention

**Scenario: a surfaced util bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each integration util test to require its real local backend → fails until pointed at the real service.

**GREEN:** point each at its real backend (Mailpit/MinIO/emulator/FCM sandbox); exercise real send/upload/export/failure paths; classify + relocate pure-logic utils as unit; file + `@known-failure`-tag surfaced bugs. Bring up local stack → canonical `npm test` green.

**Frameworks:** express Jest (real Firebase emulator + Mailpit + MinIO + FCM sandbox), frontmatter validator. **Real backend:** the full local stack utility backends. **Gauntlet exemption:** backend utility harness — no app/web/device surface; authoritative proof = CI-green (Test Backend exercises the real backends).

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- The feature routes that consume these utils (their own area SHYs).
- Pure-logic utils beyond classifying + relocating them (no behavioural change).
- Sub-splitting: ~25 files delivered as 1-SHY-1-PR slices (email · storage · fcm · alertManager · data-export · firebase-wrapper) at pickup.

## Dependencies
- **SHY-0112** (keystone) — the unit↔integration classification convention is essential here (utils straddle the boundary).
- **SHY-0109** + `firebase-emulator.js`; local stack (Mailpit/MinIO/FCM sandbox).

## Risks & Mitigations
- **Risk:** mis-classifying a pure-logic util as integration (or vice-versa). **Mitigation:** apply the keystone "by what it exercises" rule per file; `code-reviewer` checks the Test Plan names the real backend (or confirms genuine purity).
- **Risk:** real third-party (non-local) dependency un-inducible. **Mitigation:** operator escape-hatch, never a silent mock.

## Definition of Done
- All integration util tests double-free + asserting real backend outcomes; pure-logic utils classified + relocated; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; `code-reviewer` zero findings; CI green by name incl. Test Backend.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P2, ~25 files L).** Foundational infra utils proven against the real local backends (Mailpit/MinIO/emulator/FCM sandbox). The keystone classification rule is load-bearing here — utils straddle the unit↔integration line. L → sub-split at pickup.
