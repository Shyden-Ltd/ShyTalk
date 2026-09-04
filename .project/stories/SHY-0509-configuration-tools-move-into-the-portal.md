---
id: SHY-0509
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

# SHY-0509: The configuration tools move into the portal

## User Story

As **an administrator**, I want the economy, gift, spin, banner and
starting-screen tools inside the portal, so that everything I configure lives
behind the same sign-in as everything else.

## Why

The dashboard's configuration group — `economy-config.js`, `gifts.js`,
`spin-monitor.js`, `banners.js`, `starting-screens.js` under
`public/admin/js/tabs/` — changes what every user of the app sees and pays.
It is the second group to move because it has the fewest cross-tool links and
the clearest browser specs (`tests/web/admin-users-economy.spec.ts`,
`admin-banners.spec.ts`, `admin-panel.spec.ts` sections), so it proves the
migration recipe from SHY-0508 on a different shape of tool: forms and live
monitors rather than record search.

A move, not a rewrite: the tabs already meet the shell's module contract
(SHY-0507); their specs move with them and must pass at the new address before
the old tabs are reduced to links.

## Acceptance Criteria

### Happy path

- [ ] The five scripts move to `public/portal/js/modules/config/` and register
      under `admin.config` with ids `economy`, `gifts`, `spins`, `banners`,
      `starting-screens`.
- [ ] Every browser spec for the group passes against `/portal/#<id>` with
      only URL and sign-in steps changed.
- [ ] Each old dashboard tab becomes the single "moved" line with a link.
- [ ] Translation keys move to `public/portal/portal-translations.js` for all
      five shipped locales; unused admin keys are deleted.
- [ ] The pity-limit bridge (`window._updatePityHardLimit`, `getPityHardLimit`
      in `main.js:124-127`, `:151`) becomes a dep the economy and spins modules
      share, not a global.

### Error paths

- [ ] A member opening `/portal/#economy` gets the not-available message and
      the script is not fetched.
- [ ] A failed save in any form shows the tool's existing error toast; no
      silent failure is introduced by the move (the silent-failure pins in
      `express-api/tests/admin-client/` are re-pointed).

### Edge cases

- [ ] The spin monitor's polling stops on `deactivate` and on sign-out — the
      dashboard's `stopMonitoring` hook (`main.js:481`) is honoured by the
      shell's deactivate.
- [ ] Starting-screens' file uploads keep working from the portal origin (same
      origin; asserted, not assumed).
- [ ] The economy form's stale-write guard (`users-stale-write-guard-static.
      test.js` pattern) is unchanged.

### Performance

- [ ] No configuration script is fetched until its tool is opened; the monitor
      polls only while active.

### Security

- [ ] Every API prefix the group calls is guarded by `requireAdmin` or
      `requirePermission('admin.config')`; the registry contract test is
      extended with the group's prefixes.

### UX

- [ ] Forms, toasts and monitors read and behave exactly as before.

### i18n

- [ ] All five locales render every moved string; parity test between removed
      and added keys.

### Observability

- [ ] Module activation logs name each tool; the old tabs log `tab:moved <id>`.

## BDD Scenarios

**Scenario: An administrator changes the economy from the portal**

- **Given** an administrator signed in to the portal
- **When** they open Economy and save a change
- **Then** the change is saved and confirmed exactly as on the old dashboard

**Scenario: The spin monitor stops when it is left**

- **Given** an administrator watching the spin monitor in the portal
- **When** they switch to another tool
- **Then** the monitor stops updating in the background

**Scenario: A member cannot open the configuration tools**

- **Given** a member signed in to the portal
- **When** they try to open Economy by its address
- **Then** they are told the tool is not available to their account

**Scenario: The old dashboard points to the new home**

- **Given** an administrator on the old dashboard
- **When** they click Banners
- **Then** they are told the tool has moved and are offered a link

## Test Plan

### Red

- Move `tests/web/admin-users-economy.spec.ts`, `admin-banners.spec.ts` and the
  configuration sections of `admin-panel.spec.ts` to `tests/web/portal-config-
  *.spec.ts`; new `portal-config-moved.spec.ts` (moved line, member refused,
  monitor stops on switch — asserted by request counting).
- Static pins re-pointed; translation parity test.

### Green

- Move, register, share the pity-limit dep, re-point, reduce old tabs.

## Out of Scope

- Any change to what the tools do.
- Direct Firestore reads — EPIC-0006.

## Dependencies

- SHY-0507 Done; SHY-0506 Done. Independent of SHY-0508 and SHY-0510 beyond
  the board's one-at-a-time limit.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A background poller survives the move and keeps hitting the API | `deactivate` is asserted by request counting in the spec. |
| Global bridges (`window._updatePityHardLimit`) break silently in the portal | Replaced by a shared dep in this story; a static pin fails on any `window._` assignment in module code. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator saves one configuration change in each tool
      from the dev portal.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed with EPIC-0013.
