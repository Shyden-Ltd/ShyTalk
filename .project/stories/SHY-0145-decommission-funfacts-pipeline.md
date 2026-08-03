---
id: SHY-0145
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: M
type: chore
roadmap_ids: []
epic: EPIC-0004
pr:
mvp: true
---

# SHY-0145: Decommission the fun-facts pipeline (admin + backend + data)

## User Story

**As** the team shipping the MVP with the FunFact splash retired,
**I want** the now-orphaned fun-facts content pipeline removed end to end — the Express routes, the admin dashboard tab, the Firestore security rules, and the `funFacts` collection data,
**So that** the launch carries zero fun-facts remnants: no dead routes, no admin tab managing data nothing consumes, and no orphaned collection in production.

## Why

SHY-0144 removes the only **consumer** of fun facts (the splash + the app-side `FunFactRepository`). What remains is server-side and data-side: the `/api/fun-facts` + `/api/admin/fun-facts` Express routes (`express-api/src/routes/fun-facts.js`), the admin dashboard's fun-facts tab (`public/admin/index.html:1662-1663,3166` + `public/admin/js/tabs/fun-facts.js` + registration at `public/admin/js/main.js:84`), the `funFacts` Firestore rules block (`firestore.rules:588-590`), and the `funFacts` collection itself. The operator chose (2026-07-01) to make this **launch-blocking (`mvp:true`)** and to **delete the collection data** (after a backup export), so the launch ships fully clean rather than carrying dormant dead code + data.

The **banners** pipeline lives in the same neighbourhoods (`express-api/src/routes/banners.js`, a sibling admin tab, `firestore.rules` banners block, R2 images) but is an **independent, surviving feature** (it serves the home screen). The defining constraint of this story is therefore **surgical removal of fun-facts only, with banners provably untouched**.

The collection deletion is **irreversible**, so it is isolated in this small, auditable PR and run as an explicit **operator-approved** step against production (export archived first; fail-loud if the export didn't write).

## Acceptance Criteria

### Happy path
- [ ] `express-api/src/routes/fun-facts.js` is deleted and its route registration removed from the server entry; `GET /api/fun-facts` and the `/api/admin/fun-facts` CRUD endpoints no longer exist.
- [ ] The admin fun-facts tab is removed: the `#funfacts-panel` + `#tab-funfacts` markup (`public/admin/index.html:1662-1663,3166`), `public/admin/js/tabs/fun-facts.js`, and the `funfacts:` module registration (`public/admin/js/main.js:84`).
- [ ] The `funFacts` block in `firestore.rules:588-590` is removed.
- [ ] The `funFacts` collection is **exported to an archived JSON** (recoverable), then **deleted** — run as an explicit operator-approved migration step.

### Error paths
- [ ] A request to a removed route returns **404** (route absent), not 500.
- [ ] The export-then-delete migration **aborts loudly without deleting** if the export step did not write a non-empty archive (no partial/blind delete).
- [ ] Loading the admin dashboard with the fun-facts module gone produces **no console error** and **no broken tab** (clean removal from the module registry).

### Edge cases
- [ ] **Banners untouched (the critical guard):** `express-api/src/routes/banners.js` + `/api/banners*`, the banners admin tab, the `banners` Firestore rules block, and the R2 `banners/*` images all remain and function.
- [ ] Deleting an **already-empty or absent** `funFacts` collection is idempotent (the migration is safe to re-run).
- [ ] No surviving backend test or admin module imports the removed `fun-facts` route/handler.

### Performance
- N/A — removing routes + a small admin module; the one-time export is a bounded read of a small content collection (no production hot-path effect).

### Security
- [ ] Removing the `funFacts` server-only-write rules block is safe (the collection is gone) and the **banners** server-only-write rules are explicitly retained.
- [ ] The export/delete migration uses the admin SDK under operator-approved credentials; it logs **no** secrets and is **operator-gated** (irreversible prod data op — never auto-run in CI).

### UX
- [ ] The admin dashboard no longer shows a fun-facts tab; the remaining tabs (incl. **banners**) render and operate normally.

### i18n
- N/A — Express routes + the internal admin dashboard are English-only engineering surfaces (no translated user-facing string is touched).

### Observability
- [ ] The export-then-delete migration logs the **exported document count**, the **archive file path**, and a **delete confirmation** (post-delete count == 0) — an auditable trail for the irreversible step.

## BDD Scenarios

**Scenario: an admin no longer sees fun-facts management**

- **Given** an admin opening the dashboard after the fun-facts feature has been retired
- **When** they look at the available management tabs
- **Then** there is no fun-facts tab
- **And** the rest of the dashboard loads and works normally

**Scenario: the banners feature keeps working everywhere**

- **Given** the fun-facts removal is complete
- **When** an admin manages banners, and people use the app
- **Then** banners still appear and can still be managed, exactly as before

**Scenario: the fun-facts content is backed up before it's removed**

- **Given** the fun-facts content that is being retired
- **When** the removal is carried out
- **Then** a backup copy of all of it is saved first
- **And** only then is the original content removed

**Scenario: the removal refuses to delete anything if the backup didn't save**

- **Given** the backup step fails for any reason
- **When** the removal is carried out
- **Then** nothing is deleted, and the team is clearly alerted that it stopped

## Test Plan

Touches `express-api/**` (routes) + `firestore.rules` + `public/admin/**` → **backend change ⇒ Gate 4 forces the FULL app+web+device gauntlet** (per SHY-0127). The app/device legs here are a **regression proof** (no app-side change in this PR — SHY-0144 already removed the app's fun-fact code), and the meaningful new coverage is backend + admin (web) + rules + the migration. Per § No Stubs, backend/rules/migration run against the **real Firebase emulator**, not mocks.

**Red → Green (framework by framework):**
- **Express/Node (Jest, real emulator)** `cd express-api && node --experimental-vm-modules node_modules/.bin/jest`:
  - delete `express-api/tests/routes/fun-facts.test.js`.
  - `fun-facts-routes-removed.test.js` — boot the app and assert `GET /api/fun-facts` + `/api/admin/fun-facts` (GET/POST/PUT/DELETE) all return **404**; assert the route module is not registered. RED while the routes still exist.
  - `banners-routes-intact.test.js` (or extend `banners.test.js`) — assert `/api/banners/active` + the admin banners CRUD still respond (regression guard).
- **Firestore rules (real Rules engine, SHY-0129 pattern)**: a rules test asserting **no** `funFacts` match block is reachable (reads/writes to `funFacts` are default-deny) **and** the `banners` read (auth) / write (server-only) rules are unchanged.
- **Migration (real emulator)** — `migrate/export-then-delete-funfacts` test: seed `funFacts` docs → run the migration → assert the archive JSON contains every seeded doc, the collection is empty afterward, and the logged count matches; a second test forces an export failure and asserts **abort without delete**; an idempotent re-run on an empty collection is a no-op. Real emulator, no mocks.
- **Admin web (Playwright)** `tests/web/`: delete `admin-funfacts.spec.ts`; add/extend an admin spec asserting **no** fun-facts tab is present **and** the banners tab still loads + lists banners (regression). All browsers per the gauntlet.
- **Static/quality:** `npm run lint` 0 warnings (admin JS + express); `actionlint`/`shellcheck` clean if any workflow/script changes; `prettier` clean.
- **Phase 1 LOCAL gauntlet:** Gate-4-forced full matrix — real Android + real iPhone + all browsers — proves the app/web still work end to end (fun-facts gone, banners intact) and nothing regressed.
- **Phase 2:** `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name (incl. the backend-forced matrix).
- **Phase 3 (DEV):** re-run on dev; **the production `funFacts` deletion is a separate operator-approved step** executed after merge (export archived first), not run by CI.

## Out of Scope
- **App-side** fun-fact removal (splash, `FunFactRepository`/model/cache) — delivered by **SHY-0144** (must land first so nothing consumes the routes/data being removed here).
- **Banners** — entirely retained (routes, admin tab, R2 images, rules); only regression-guarded here.
- Any change to the **starting-screens** config collection (separate subsystem).
- Repurposing the fun-facts data for a future feature — the operator chose full deletion (after backup).

## Dependencies
- **SHY-0144 lands first** (removes the app-side consumer; this story then safely removes the server/data side).
- The real Firebase emulator (Firestore + rules) for backend/rules/migration tests; the admin SDK + operator-approved credentials for the production export+delete step.
- `firestore.rules` (the `funFacts` block to remove; the `banners` block to preserve) and the SHY-0129 real-Rules-engine test harness.
- The admin dashboard module registry (`public/admin/js/main.js`) + the banners admin tab (kept).

## Risks & Mitigations
- **Risk:** the irreversible `funFacts` deletion runs prematurely or loses data. **Mitigation:** export-to-archive **before** delete; the migration aborts if the export didn't write; the prod run is operator-gated (never CI-automated); isolated in this small auditable PR.
- **Risk:** collateral damage to **banners** (shared files/neighbourhoods). **Mitigation:** explicit banners-intact regression tests at every layer (route, rules, admin web); the diff touches only fun-facts identifiers.
- **Risk:** a missed route registration leaves a half-removed endpoint. **Mitigation:** the `fun-facts-routes-removed` test boots the real app and asserts 404 on every former endpoint.
- **Risk:** admin module registry left referencing a deleted module → console error. **Mitigation:** remove the `funfacts:` registration in the same change; a Playwright admin-load assertion checks for no console error.

## Definition of Done
- [ ] `fun-facts.js` routes + registration deleted; admin fun-facts tab + module + registration removed; `firestore.rules` `funFacts` block removed; export-then-delete migration implemented + tested; banners provably intact at every layer.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** Jest RED→GREEN (routes-removed · banners-intact · migration) + real-Rules-engine test + Playwright admin (no fun-facts tab · banners works) + lint/prettier clean → LOCAL full gauntlet green (real Android + real iPhone + all browsers — regression proof) → `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name → DEV gauntlet green → **judgment-merge** (NO auto-merge; notify operator) → **operator-approved production `funFacts` export+delete** executed post-merge.
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0004-persistent-session-instant-coldstart]]. Scope from the splash blast-radius Explore pass (fun-facts = `funFacts` collection + `/api/fun-facts` + admin tab + rules; banners independent + kept). Operator decisions (2026-07-01): launch-blocking (`mvp:true`) + **delete the collection after a backup export**. The irreversible prod deletion is operator-gated, post-merge. Lands last in EPIC-0004 (after SHY-0144 removes the consumer).
