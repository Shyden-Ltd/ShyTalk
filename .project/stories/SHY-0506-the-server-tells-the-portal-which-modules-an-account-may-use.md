---
id: SHY-0506
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: false
epic: EPIC-0013
---

# SHY-0506: The server tells the portal which modules an account may use

## User Story

As **somebody signing in to the ShyTalk portal**, I want to see only the tools
my account is allowed to use, decided by the server, so that a member, a
support agent and an administrator each get the right portal and nobody can
grant themselves more by editing a page.

## Why

Today the identity call (`GET /api/portal/me`,
`express-api/src/routes/portal.js:197-304`) answers `userType` and
`isAdmin`, and each page works out for itself what to show: the portal shows
fixed sections, the dashboard shows every tab to anyone with the admin flag.
A support-agent role (EPIC-0012) would mean teaching two pages a new rule and
guarding a new set of routes by hand. Every future role repeats that.

EPIC-0013's decision is that **the server decides**. The identity call gains
the account's `permissions` and `modules`; the shell (SHY-0507) renders only
what it is told; and the API routes behind each module are guarded by the same
permission, so a page that shows more than it should still cannot *do* more.

The alternative — the page deriving modules from `userType` and `isAdmin` —
duplicates the rule in the page and its tests and makes each role a page
change. Modules in the Firebase token were rejected too: claims are size-capped
and stale for up to an hour, the very window the live admin check exists to
close.

## Acceptance Criteria

### Happy path

- [ ] `express-api/src/utils/portal-access.js` exports a pure
      `resolvePortalAccess({ userType, isAdmin, isSuspended })` returning
      `{ permissions: string[], modules: string[] }` from a registry in
      `express-api/src/utils/portal-modules.js` (module id, required
      permission, group).
- [ ] Permissions: `member.profile`, `member.security`, `member.data-privacy`
      for every account in good standing; `admin.safety`, `admin.config`,
      `admin.ops` for the admin role. Module ids: `profile`, `security`,
      `data-privacy`; `users`, `reports`, `appeals`, `support`, `suggestions`
      (safety); `economy`, `gifts`, `spins`, `banners`, `starting-screens`
      (config); `logs`, `audit-log`, `devices`, `backups`, `maintenance`,
      `age-tools` (ops).
- [ ] `GET /api/portal/me` adds `permissions` and `modules` to its OK answer;
      every existing field is unchanged.
- [ ] `express-api/src/middleware/permissions.js` exports
      `requirePermission(name)`, built on the same resolver plus the live admin
      re-check (`isLiveAdmin`), refusing with `code: 'permission_required'`. New
      routes in this epic use it; existing `requireAdmin` routes are equivalent
      to `admin.*` and are left in place.

### Error paths

- [ ] A suspended account answers `modules: []` and `permissions: []`; the
      existing suspension fields still drive the suspension screen.
- [ ] A banned account never reaches the route (existing ban gate); no change.
- [ ] `requirePermission` for an unknown permission name throws at startup, not
      at request time — a typo cannot silently open a route.
- [ ] A caller whose permissions do not include the required one is refused
      even if their token claims admin but the live claim does not.

### Edge cases

- [ ] `userType` missing or unknown resolves to member permissions only.
- [ ] `TEACHER`, `MC_SINGER`, `MC_EVENT_HOST` and `SHYTALK_OFFICIAL` resolve to
      member permissions; the registry has the slot for their modules but
      defines none (nothing exists to show).
- [ ] The registry is the single list: a contract test asserts every module id
      the shell (SHY-0507) knows is in the server registry and vice versa, and
      that every module's API prefix is guarded by the module's permission or
      by `requireAdmin` for `admin.*`.
- [ ] Adding a role is one resolver change and zero page changes — asserted by
      a table test that a hypothetical `support.tickets` permission flows to
      `modules` without touching route code.

### Performance

- [ ] No extra reads: the resolver runs on data `/portal/me` already fetched.
      The route's median latency on the local stack is unchanged within 5 ms.

### Security

- [ ] Permissions are computed per request from the `users` document and the
      live claim; nothing is cached across requests except the existing 60 s
      admin-claim cache.
- [ ] The response lists only the caller's own permissions; no route exposes
      another account's.

### UX

- [ ] N/A — this story has no visible surface; SHY-0507 renders the result.

### i18n

- [ ] N/A — module and permission ids are internal identifiers, never shown.

### Observability

- [ ] `requirePermission` refusals log `{ uid, uniqueId, permission, path }` at
      warn, distinguishable from `no_identity` and `admin_required`.

## BDD Scenarios

**Scenario: A member is offered only their own tools**

- **Given** a member in good standing
- **When** they sign in to the portal
- **Then** they are offered their profile, security and privacy tools and nothing else

**Scenario: An administrator is offered administration**

- **Given** an administrator
- **When** they sign in to the portal
- **Then** they are offered the safety, configuration and operations tools as well as their own

**Scenario: A suspended person is offered no tools**

- **Given** a member whose account is suspended
- **When** they sign in to the portal
- **Then** they see the suspension notice and no tools

**Scenario: A tool cannot be used without the right**

- **Given** a member who has worked out the address of an administration tool
- **When** they try to use it
- **Then** they are refused and told the tool is not available to their account

**Scenario: A change of rights shows on the next sign-in**

- **Given** a member who has just been made an administrator
- **When** they sign in to the portal again
- **Then** they are offered the administration tools

## Test Plan

### Red

- `express-api/tests/utils/portal-access.test.js` — table test over every
  `userType` × admin × suspended combination; unknown type; the
  hypothetical-role assertion.
- `express-api/tests/routes/portal-me-modules.test.js` (real emulators) — the
  answer carries `permissions` and `modules` for a member persona and the
  admin persona; a suspended persona gets empty lists; every pre-existing field
  is byte-identical to before.
- `express-api/tests/middleware/require-permission.test.js` — refusal code and
  log line; unknown permission throws at construction; live-claim downgrade is
  honoured.
- `express-api/tests/contracts/portal-module-registry.test.js` — registry ↔
  route-guard mapping; fails on an unguarded module route prefix.

### Green

- Registry, resolver, middleware, route change.

## Out of Scope

- Rendering modules — SHY-0507.
- Teacher, MC or official modules — none defined; product work first.
- The support-agent permission and role — EPIC-0012 adds `support.tickets`
  and the account type that grants it, on this model.
- Migrating existing `requireAdmin` call sites to `requirePermission` — they
  are equivalent today; a later refactor if the registry grows finer.

## Dependencies

- SHY-0505 — the admin role has an owner before it becomes a permission
  source.
- SHY-0503 — identity is verified before permissions mean anything.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Server registry and shell registry drift | The contract test in this story fails the build on either side adding an id the other lacks. |
| A permission name typo opens or closes a route silently | `requirePermission` validates the name against the registry at startup. |
| Suspension or ban logic duplicated in the resolver | The resolver only empties the lists; the existing gates keep deciding suspension and ban. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the identity call on dev answers `modules` for the seeded
      member and admin personas as specified; SHY-0507 consumes it.

## Notes

- **2026-09-04** — Filed with EPIC-0013. Alternatives considered and rejected
  are recorded in the Why and in the epic's decisions table.
