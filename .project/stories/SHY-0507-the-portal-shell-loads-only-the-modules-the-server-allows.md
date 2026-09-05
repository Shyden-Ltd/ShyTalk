---
id: SHY-0507
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: L
type: feature
roadmap_ids: []
mvp: false
epic: EPIC-0013
---

# SHY-0507: The portal shell loads only the modules the server allows

## User Story

As **somebody using the ShyTalk portal**, I want one place that signs me in
once and shows the tools I am allowed, so that members, staff and
administrators all use the same door and nothing I am not allowed to see is
ever loaded into my browser.

## Why

The portal (`public/portal/portal.js`, 1,609 lines in one closure on the
compat Firebase SDK) shows a fixed set of sections. The admin dashboard
(`public/admin/js/main.js`) has the module pattern the portal needs — a
registry of tab scripts, lazy `import()`, an `init` / `activate` /
`deactivate` contract (`main.js:88-121`, `:187-200`) — but its own door and its
own identity rule, which is today's defect (SHY-0503).

This story gives the portal a **shell**: one sign-in, one identity check, a
navigation built from the module list the server returns (SHY-0506), and the
dashboard's module contract, so the seventeen tabs can move across unchanged
(SHY-0508, SHY-0509, SHY-0510). The shell uses the modular Firebase SDK and ES
modules, as the dashboard does, because the tabs already import that SDK's
functions through their `deps`.

The alternative — one page per module under the portal path — was rejected:
each page would repeat the door, which is how the dashboard got its own.

## Acceptance Criteria

### Happy path

- [ ] `public/portal/js/shell.js` (ES module, modular SDK) signs in with Google
      or Apple (password only when `CONFIG.PASSWORD_SIGN_IN`, as SHY-0504),
      calls `GET /api/portal/me`, and builds the navigation from `modules` in
      the answer.
- [ ] `public/portal/js/modules/registry.js` maps module id → script path,
      label key and group, mirroring the server registry (SHY-0506's contract
      test covers both).
- [ ] A module is imported only when first activated, and only if its id is in
      the server's list. Contract: `{ init(deps), activate(deps), deactivate() }`
      — byte-compatible with the dashboard's tabs.
- [ ] `deps` = `{ apiBase, getToken, switchModule, auth, t }`. A compatibility
      `clientDb` and `firestoreFns` are provided **only** for migrated tabs that
      still read Firestore directly, marked `// EPIC-0006: remove` at the one
      place they are constructed.
- [ ] The existing profile, security and data-privacy sections become three
      member modules with their behaviour and specs intact. Sign-in, two-factor,
      suspension, ban and "no account" flows stay in the shell, before any
      module.
- [ ] Hash routing: `#<module-id>` activates a module after sign-in; the stored
      deep link (`portal_target_hash`) keeps working.

### Error paths

- [ ] An id in the server's list that the shell's registry lacks is skipped
      with a console warning; the rest of the navigation renders.
- [ ] A module script that fails to import shows "This tool could not be
      loaded. Try again." in its panel and leaves the others usable.
- [ ] A hash naming a module the server did not list shows "This tool is not
      available to your account." and activates nothing — the shell refuses ids
      outside the list even when the script exists.
- [ ] Identity refusals behave as SHY-0503 and SHY-0417 specify.

### Edge cases

- [ ] An account with only member modules sees no group headings for
      administration — not an empty heading.
- [ ] Switching modules calls `deactivate` on the old one before `activate` on
      the new; `init` runs once per module per page load.
- [ ] Sign-out deactivates the active module, clears module state and returns
      to sign-in; the next sign-in re-runs the identity check.
- [ ] Window resize and mobile widths: navigation collapses to a menu; every
      module panel scrolls inside itself, the page never scrolls sideways.

### Performance

- [ ] First module visible within one second of the identity answer on the
      local stack. Scripts for modules not in the list are never fetched —
      asserted from the browser's network log.

### Security

- [ ] The server's list is the only source of module ids the shell will
      activate; a static pin asserts no path calls `import()` with an id that
      was not checked against `modules`.
- [ ] No module receives a token; modules call `getToken()` per request as the
      tabs do today.

### UX

- [ ] Navigation is a `<nav>` landmark with the current module marked; focus
      moves to the module heading on switch; a skip link reaches the module
      panel; keyboard-only operation proven in `portal-a11y.spec.ts`.

### i18n

- [ ] Navigation labels and the three new messages in all five shipped locales
      in `public/portal/portal-translations.js`; rendered text asserted.

### Observability

- [ ] Each activation logs `module:activate <id>`; each import failure logs
      the id and error through the portal's logger, so a broken module is
      visible without a debugger.

## BDD Scenarios

**Scenario: A member sees only their own tools**

- **Given** a member in good standing
- **When** they sign in to the portal
- **Then** they see Profile, Security and Privacy in the navigation and nothing else

**Scenario: An administrator sees the administration groups**

- **Given** an administrator
- **When** they sign in to the portal
- **Then** they see Safety, Configuration and Operations alongside their own tools

**Scenario: A tool outside the account's rights cannot be opened**

- **Given** a member who types the address of an administration tool
- **When** the portal opens that address
- **Then** they are told the tool is not available to their account

**Scenario: A tool that fails to load says so**

- **Given** an administrator whose connection drops while a tool is loading
- **When** they open that tool
- **Then** the tool's panel says it could not be loaded and offers to try again
- **And** the other tools still work

**Scenario: A deep link opens the right tool after sign-in**

- **Given** somebody following a link straight to their Security tool
- **When** they sign in
- **Then** the Security tool opens

## Test Plan

### Red

- `tests/web/portal-shell.spec.ts` — member persona sees three modules and no
  admin scripts are fetched (network log); admin persona sees the groups;
  unknown hash shows the not-available message; deep link after sign-in;
  sign-out and re-sign-in re-runs the identity check.
- `tests/web/portal-a11y.spec.ts` — nav landmark, focus on switch, skip link,
  keyboard-only traversal.
- `tests/web/portal-auth.spec.ts` — existing two-factor, suspension and
  remember-browser specs pass unchanged against the shell.
- `express-api/tests/admin-client/portal-shell-static.test.js` — `import()`
  guarded by the server list; module contract exported by each member module.
- `express-api/tests/contracts/portal-module-registry.test.js` (SHY-0506) —
  the shell's registry is one side of the contract.

### Green

- Shell, registry, three member modules, translations, a11y fixes.

## Out of Scope

- Moving the admin tabs — SHY-0508, SHY-0509, SHY-0510.
- Retiring `/admin/` — SHY-0511.
- New member features.
- Removing direct Firestore reads from migrated tabs — EPIC-0006.

## Dependencies

- SHY-0506 — the `modules` list.
- SHY-0503 — the door.
- SHY-0147, SHY-0148 (Done) — the remember-browser and stay-signed-in
  behaviour the shell must keep.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Rewriting `portal.js` regresses two-factor or suspension flows | Those flows move into the shell as-is and the existing `portal-auth.spec.ts` must pass before and after. |
| compat → modular SDK changes persistence behaviour | `portal-auth.spec.ts` stay-signed-in cases and SHY-0148's cross-browser specs are the gate. |
| The shell grows into another monolith | Modules own their DOM; the shell owns sign-in, identity, navigation and routing only — a line-count pin on `shell.js` fails the build above 600 lines. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator signs in to the dev portal as an administrator
      and sees the groups; the seeded member persona sees three tools.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed with EPIC-0013. The module contract is the dashboard's
  existing one by design, so SHY-0508 to SHY-0510 move code rather than rewrite
  it.
