---
id: SHY-0511
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: S
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0013
---

# SHY-0511: Retire the separate admin page

## User Story

As **the operator**, I want the old admin page gone once every tool lives in
the portal, so that there is exactly one door, one sign-in and one place to
maintain.

## Why

After SHY-0508, SHY-0509 and SHY-0510 every dashboard tab is a "moved" line
with a link. What remains under `public/admin/` is a second sign-in screen, a
second identity check and a second set of translations — three places for the
next SHY-0503 to happen. EPIC-0013's decision is one shell; this story is the
deletion that makes it true, plus the redirects so nobody's bookmark breaks.

## Acceptance Criteria

### Happy path

- [ ] `public/_redirects` sends `/admin/*` to `/portal/` permanently, and each
      former tab hash to the portal module of the same id (`/admin/#users` →
      `/portal/#users`), verified in the browser on local and dev.
- [ ] `public/admin/` is deleted: `index.html`, `js/`, `translations.js`,
      `config*.js`, `assets/`. No reference to `/admin/js/` remains in the tree
      (`grep` in CI).
- [ ] `tests/web/admin-*.spec.ts` no longer exist; every former assertion lives
      in a `portal-*.spec.ts` (SHY-0508 to SHY-0510 moved them; this story
      asserts none were left behind).
- [ ] The dashboard's lint scope (SHY-0448) and the root `.prettierignore` are
      updated for the removed paths.

### Error paths

- [ ] A deep link to a tab that never existed (`/admin/#nothing`) lands on the
      portal home, not a 404.
- [ ] The password sign-in form is now the portal's alone, still gated on
      `CONFIG.PASSWORD_SIGN_IN` (SHY-0504), still absent in production.

### Edge cases

- [ ] The device-journey runner mints the admin persona's token through the
      API, not the page (`express-api/scripts/device-journey-runner.js:2859`),
      and is unaffected — asserted by running the admin-flavoured journey once.
- [ ] Support tickets and other app copy that named "the admin dashboard" (see
      SHY-0380's interim surface) now say "the portal" where a person could
      read it; internal comments are updated in passing.
- [ ] `public/admin/config.dev.example.js` and `config.example.js` are deleted
      with their twins; `README`s that told a developer to copy them are
      corrected.

### Performance

- [ ] N/A — removal only; nothing new is loaded.

### Security

- [ ] The retired page's Firebase config is removed from the deployed site; a
      CI check asserts no `AIzaSy` key appears under a path that no longer
      serves a page.
- [ ] The redirects are permanent so a stale bookmark cannot be phished by a
      later re-creation of the path — the path is reserved by the redirect.

### UX

- [ ] Anyone landing on the old address arrives in the portal on the tool they
      meant, signed in if they already were.

### i18n

- [ ] N/A — all strings moved in SHY-0508 to SHY-0510; this story deletes the
      now-empty admin translation file and asserts the portal file lost
      nothing (parity test from those stories runs once more).

### Observability

- [ ] The `tab:moved` log line (SHY-0508 to SHY-0510) has shown no traffic for
      two weeks on dev before this story merges — recorded in Notes with the
      log query.

## BDD Scenarios

**Scenario: An old bookmark lands on the right tool**

- **Given** an administrator with a bookmark to the old Users tab
- **When** they open the bookmark
- **Then** they arrive at the Users tool in the portal

**Scenario: The old address for a tool that never existed goes home**

- **Given** somebody with a link to an old admin address that never had a tool
- **When** they open it
- **Then** they arrive at the portal home

**Scenario: Nothing is left of the old page**

- **Given** the site is deployed
- **When** anyone requests the old admin page's scripts
- **Then** nothing is served at that address

## Test Plan

### Red

- `tests/web/admin-retired.spec.ts` — redirects for `/admin/`, `/admin/#users`,
  `/admin/#nothing`; the old script path returns nothing.
- `express-api/tests/scripts/no-admin-page-remains.test.js` — tree scan for
  `public/admin/` and `/admin/js/` references; `tests/web/admin-*.spec.ts`
  absent.

### Green

- Delete, redirect, update lint scope and ignore file, fix copy.

## Out of Scope

- Any change to portal modules.
- Removing password sign-in from local and dev.

## Dependencies

- SHY-0508, SHY-0509, SHY-0510 Done, and two weeks of `tab:moved` silence on
  dev.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A tool nobody noticed still lives only on the old page | The tree scan and the moved-tab traffic log both have to be clean first. |
| A bookmark or doc points at a dead address | Permanent redirects for every former hash. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the old address redirects on dev; the operator's bookmark
      lands on the right tool.

## Notes

- **2026-09-04** — Filed with EPIC-0013. Last story of the epic by design.
