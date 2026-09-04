---
id: SHY-0508
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

# SHY-0508: The safety tools move into the portal

## User Story

As **an administrator**, I want the user, report, appeal, support and
suggestion tools inside the portal, so that I work from one place with one
sign-in and the separate admin page can go.

## Why

The dashboard's safety group — `users.js` (3,556 lines), `reports.js`,
`appeals.js`, `support.js`, `suggestions.js` under `public/admin/js/tabs/` —
is where moderation and safeguarding happen, and it is the group EPIC-0012's
support-agent module will sit beside. It moves first so the portal's `admin.
safety` permission is exercised by real tools before a second role is built on
it.

This is a move, not a rewrite. The tabs already follow the shell's module
contract (SHY-0507), and every one has browser specs (`tests/web/admin-users-
*.spec.ts`, `admin-appeals*.spec.ts`, `admin-support.spec.ts`,
`admin-suggestions.spec.ts`, `admin-realtime.spec.ts`) that define its
behaviour. Those specs move with the code and must pass at the new address
before the old tab is removed — "same assertions, new home" is the proof.

## Acceptance Criteria

### Happy path

- [ ] The five scripts move to `public/portal/js/modules/safety/` and are
      registered in the shell registry under `admin.safety` with ids `users`,
      `reports`, `appeals`, `support`, `suggestions`.
- [ ] Each tool behaves identically in the portal: every browser spec for the
      group passes against `/portal/#<id>` with only its URL and sign-in steps
      changed.
- [ ] The dashboard tab for each moved tool is replaced by a single line — "This
      tool has moved to the portal" with a link — so the tool has one home.
- [ ] The tabs' translation keys move from `public/admin/translations.js` to
      `public/portal/portal-translations.js` for all five shipped locales;
      unused admin keys are deleted.
- [ ] The `data-module-ready` signal the specs wait on is kept.

### Error paths

- [ ] A member who opens `/portal/#users` gets SHY-0507's not-available message;
      the users script is not fetched.
- [ ] An API refusal inside a moved tool renders the tool's existing error
      handling (partial-failure toasts etc.), unchanged.

### Edge cases

- [ ] Cross-tool navigation (`switchTab` from reports to a user record,
      `admin-cross-tab.spec.ts`) becomes `switchModule` and still lands on the
      right record.
- [ ] Realtime listeners (`admin-realtime.spec.ts`) keep working through the
      compatibility `clientDb` dep, with `// EPIC-0006: remove` at their use
      sites; no new direct Firestore access is added.
- [ ] Session storage keys the tabs use are namespaced to the portal so a
      dashboard tab left open in another window cannot collide.

### Performance

- [ ] `users.js` is imported only when Users is opened; the portal's initial
      load for an administrator fetches no safety script until a tool is
      activated (network log).

### Security

- [ ] Every API prefix the five tools call is guarded by `requireAdmin` or
      `requirePermission('admin.safety')` — the registry contract test
      (SHY-0506) is extended with the group's prefixes.
- [ ] XSS regressions guarded by the existing static pins
      (`express-api/tests/admin-client/reports-xss-static.test.js` and
      siblings) now pointing at the new paths.

### UX

- [ ] Tool headings, empty states and toasts read exactly as before; the only
      visible change is where the tools live.

### i18n

- [ ] All five locales render every moved string; parity test between the
      removed admin keys and the added portal keys.

### Observability

- [ ] Module activation logs (SHY-0507) name each safety tool; the dashboard's
      moved-tab line logs `tab:moved <id>` so remaining dashboard traffic to
      moved tools is visible before SHY-0511.

## BDD Scenarios

**Scenario: An administrator moderates from the portal**

- **Given** an administrator signed in to the portal
- **When** they open Users and search for a member
- **Then** they see the same record and actions they had on the old dashboard

**Scenario: The old dashboard points the way**

- **Given** an administrator who still opens the old dashboard
- **When** they click the Users tab
- **Then** they are told the tool has moved and are offered a link to it

**Scenario: A member cannot open the safety tools**

- **Given** a member signed in to the portal
- **When** they try to open Users by its address
- **Then** they are told the tool is not available to their account

**Scenario: Live updates keep arriving**

- **Given** an administrator watching the Reports tool in the portal
- **When** a new report is filed from the app
- **Then** it appears without a refresh

## Test Plan

### Red

- Move `tests/web/admin-users-*.spec.ts`, `admin-appeals*.spec.ts`,
  `admin-support.spec.ts`, `admin-suggestions.spec.ts`, `admin-cross-tab.
  spec.ts`, `admin-realtime.spec.ts` to `tests/web/portal-safety-*.spec.ts`
  with the portal sign-in helper; they fail until the modules exist.
- New: `portal-safety-moved.spec.ts` — dashboard tab shows the moved line;
  member refused by address; users script not fetched on load.
- `express-api/tests/admin-client/*-static.test.js` re-pointed to the new
  paths; translation parity test.

### Green

- Move, register, re-point, delete the old tab bodies.

## Out of Scope

- Changing any tool's behaviour.
- Removing direct Firestore reads — EPIC-0006.
- The support-agent view of the support tool — EPIC-0012.

## Dependencies

- SHY-0507 (the shell) Done.
- SHY-0506 (permissions) Done.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `users.js` at 3,556 lines hides coupling to dashboard globals | The move is spec-gated: every users spec must pass at the new address before the old tab body is deleted. |
| Two homes for one tool during the transition | The old tab is reduced to a link in the same PR; there is no state in which both work. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator opens Users, Reports, Appeals, Support and
      Suggestions in the dev portal and actions one item in each.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed with EPIC-0013. Group order rationale: safety first
  because EPIC-0012 builds beside it.
