---
id: SHY-0510
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: L
type: refactor
roadmap_ids: []
mvp: false
epic: EPIC-0013
---

# SHY-0510: The operations tools move into the portal

## User Story

As **an administrator**, I want the logs, audit log, devices, backups,
maintenance and age tools inside the portal, so that the last of the old
dashboard can be retired.

## Why

The dashboard's operations group — `logs.js`, `audit-log.js`, `devices.js`,
`backups.js`, `maintenance.js`, `age-segregation.js` with `age-verification.js`
under `public/admin/js/tabs/`, plus the maintenance sub-features
`nuclear-reset.js` and `sync-prod.js` in `public/admin/js/` — is the group with
the most dangerous actions (nuclear reset, prod sync, backups). It moves last,
once the recipe is proven twice, and its destructive actions gain nothing and
lose nothing in the move: the same confirmations, the same guards.

A move, not a rewrite; specs move with the code (`tests/web/admin-logs.spec.
ts`, `admin-audit-log.spec.ts`, and the operations sections of
`admin-panel.spec.ts`).

## Acceptance Criteria

### Happy path

- [ ] The scripts move to `public/portal/js/modules/ops/` and register under
      `admin.ops` with ids `logs`, `audit-log`, `devices`, `backups`,
      `maintenance`, `age-tools`.
- [ ] Every browser spec for the group passes against `/portal/#<id>`.
- [ ] Nuclear reset and prod sync keep their existing in-page confirmations and
      their existing server guards; the maintenance module wires them through
      `deps` exactly as `main.js:356-370` does today.
- [ ] Old tabs become the single "moved" line with a link.
- [ ] Translation keys move for all five shipped locales; unused admin keys are
      deleted.

### Error paths

- [ ] A member opening `/portal/#maintenance` gets the not-available message
      and no script is fetched.
- [ ] A destructive action refused by the server shows the tool's existing
      message; nothing is retried automatically.

### Edge cases

- [ ] Log streaming stops on `deactivate` and sign-out (`stopAll`, `main.js:
      482`).
- [ ] The audit-log tool shows SHY-0505's `GRANT_ADMIN` / `REVOKE_ADMIN`
      entries with the same rendering as other actions.
- [ ] Age tools keep the official-account exemption (`admin-age-verification.
      js:397-417`) — behaviour is server-side and unchanged; the spec asserts
      it from the portal.

### Performance

- [ ] No operations script is fetched until opened; log streaming runs only
      while the tool is active.

### Security

- [ ] Every API prefix the group calls is guarded by `requireAdmin` or
      `requirePermission('admin.ops')`; the registry contract test is extended.
- [ ] Nuclear reset and prod sync remain unreachable outside the environments
      that allow them (existing server guards, asserted from the portal).

### UX

- [ ] Identical headings, confirmations and outcomes.

### i18n

- [ ] All five locales render every moved string; parity test.

### Observability

- [ ] Module activation logs name each tool; old tabs log `tab:moved <id>`.

## BDD Scenarios

**Scenario: An administrator reads the audit log in the portal**

- **Given** an administrator signed in to the portal
- **When** they open Audit log
- **Then** they see the same entries they saw on the old dashboard

**Scenario: Log streaming stops when the tool is left**

- **Given** an administrator streaming logs in the portal
- **When** they switch to another tool
- **Then** the stream stops

**Scenario: A destructive action still asks first**

- **Given** an administrator in Maintenance on the local stack
- **When** they choose a destructive action
- **Then** they are asked to confirm in the page before anything happens

**Scenario: A member cannot open the operations tools**

- **Given** a member signed in to the portal
- **When** they try to open Maintenance by its address
- **Then** they are told the tool is not available to their account

## Test Plan

### Red

- Move `tests/web/admin-logs.spec.ts`, `admin-audit-log.spec.ts` and the
  operations sections of `admin-panel.spec.ts` to `tests/web/portal-ops-*.
  spec.ts`; new `portal-ops-moved.spec.ts` (moved line, member refused,
  streaming stops, confirmation appears).
- Static pins re-pointed; translation parity test.

### Green

- Move, register, re-point, reduce old tabs.

## Out of Scope

- Changing any tool's behaviour or guards.
- Deleting `/admin/` — SHY-0511.

## Dependencies

- SHY-0507 Done; SHY-0506 Done; SHY-0505 Done (audit entries to render).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A destructive action loses a guard in the move | Guards are server-side and unchanged; the spec drives each action from the portal and asserts the refusal outside allowed environments. |
| Log streaming leaks after switching tools | Asserted by request counting after `deactivate`. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator opens each operations tool in the dev portal
      and reads one entry from the audit log.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed with EPIC-0013. Last of the three groups by design.
