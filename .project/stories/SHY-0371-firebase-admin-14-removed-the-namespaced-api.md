---
id: SHY-0371
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0371: firebase-admin 14 removed the namespaced API and dev crash-looped

## User Story

As **anyone using dev**, I want the API to start, so that the app can reach a
backend at all.

## Why

**Dev has been returning 502 on every endpoint.** pm2 reported `online` with
**37,572 restarts** and 0s uptime — a crash loop, not a stopped process. The
error log, taken from the VM:

```
TypeError: Cannot read properties of undefined (reading 'cert')
    at Object.<anonymous> (/home/ubuntu/express-api/src/utils/firebase.js:71:49)
    ...
    at Object.<anonymous> (/home/ubuntu/express-api/src/middleware/auth.js:8:22)
```

### Root cause

firebase-admin **14 removed the entire namespaced root surface**. Verified
against the exact version the VM runs (14.2.0), its root entry exports only:

```
AppErrorCode FirebaseAppError FirebaseError SDK_VERSION applicationDefault
cert deleteApp getApp getApps initializeApp refreshToken
```

`admin.credential`, `admin.auth`, `admin.firestore`, `admin.database`,
`admin.messaging`, `admin.appCheck`, `admin.apps` and `admin.app` are all
**gone**, and the `App` object the SDK returns carries only `name` and
`options` — every `.firestore()` / `.auth()` / `.database()` accessor with it.

The 13→14 bump (#1520) migrated `admin.apps` and `admin.firestore` but left
`admin.credential.cert()` at `utils/firebase.js:71`. `middleware/auth.js`
requires that module, and `index.js` requires it transitively, so the
`TypeError` fired **during startup** — every endpoint 502'd, including every
endpoint with nothing to do with credentials.

### Why nothing caught it

Two independent gaps, and each alone was enough:

1. **The branch is never exercised.** Line 71 sits inside
   `if (serviceAccountPath)`. `FIREBASE_SERVICE_ACCOUNT_PATH` is set on the VM
   and unset in CI, so in every test environment that line is dead code. The
   SHY-0370 startup guard strips only `/SECRET|_KEY$|PASSWORD/i`, so it asserts
   the *unconfigured* production box and structurally cannot reach line 71.
2. **Local `node_modules` was stale.** `package.json` declares `^14.1.0` and the
   lockfile resolves 14.2.0, but the working copy still had **13.10.0**, where
   `admin.credential` exists. Local probes and local tests therefore ran against
   an API surface production does not have. (CI runs `npm ci` and did have
   14.2.0 — gap 1 is what kept CI green.)

SHY-0369 explicitly suspected this bump and recorded that it was "checked and
cleared … no removed namespace API remains anywhere". That clearance was wrong:
it grepped the names already known to be removed instead of diffing every member
access against what v14 actually keeps.

## Acceptance Criteria

### Happy path

- [ ] `src/index.js` loads with a service-account path configured — the case the
      VM runs — without throwing.
- [ ] Dev API health returns 200 and pm2 shows a stable uptime with no climbing
      restart count.
- [ ] Firestore, Auth, RTDB and messaging clients still resolve and behave as
      before.

### Error paths

- [ ] **At startup**, a malformed or missing service-account file fails with a
      message naming the file, not a `TypeError` on `undefined`. The operator
      reads this in the process log, so naming the path is correct there.
- [ ] **Over HTTP**, `admin-migrate.js` fails with a message naming
      `PROD_SERVICE_ACCOUNT_PATH` and **never the path it holds**. Node's
      `MODULE_NOT_FOUND` embeds the absolute path and that message is returned in
      the response body — a different trust boundary from a startup log.
- [ ] `admin-migrate.js` `getProdDb()` opens the secondary prod app and returns
      a Firestore handle rather than throwing.

### Edge cases

- [ ] **No `admin.<member>` access anywhere in the repo resolves to `undefined`
      on 14.2.0.** Enforced by diffing every access against the SDK's real
      export surface, across `src/`, `scripts/` and `local/`.
- [ ] Every spelling of that access is covered, not just the obvious one: a
      plain binding, a destructure straight off the root, a member chained onto
      an unbound `require('firebase-admin')`, and bracket access. A shape the
      detector cannot see is a shape the outage can return through.
- [ ] Objects the SDK *returns* are covered by an **allowlist** — an App carries
      only `name` and `options`, so `app.remoteConfig()` and every accessor
      nobody has enumerated are findings too, not just `.firestore()`.
- [ ] Importing `middleware/app-check` does not configure Firebase, so the
      module stays safe to load before the SDK is initialised.
- [ ] The installed firebase-admin matches the lockfile, so local runs cannot
      pass against an older major.

### Performance

- [ ] None. Same calls, resolved from the modular entry point instead of a
      deleted namespace.

### Security

- [ ] Credential handling is unchanged — the same service-account file, the same
      `cert()` implementation, reached by its supported import.
- [ ] No service-account contents, key material or path are logged.

### UX

- [ ] The app can reach a backend again. That is the entire point.

### i18n

- [ ] N/A — server startup.

### Observability

- [ ] The startup guard now covers the **configured** box, so this class of
      failure surfaces in CI as a named test failure instead of as a 502 found
      by a person.

## BDD Scenarios

**Scenario: The backend is reachable**

- **Given** the dev backend has been deployed
- **When** someone opens the app
- **Then** it loads their account instead of failing to connect

**Scenario: An upgraded library does not silently break startup**

- **Given** a dependency has removed part of its interface
- **When** the checks run
- **Then** they fail and name the removed call

## Test Plan

**RED first, and the failing state is a live outage** — dev 502, 37,572 pm2
restarts.

1. **Reproduce against the real version.** `npm ci` so the working copy is
   14.2.0, not 13.10.0. Without this the RED test passes trivially.
2. **Startup with a service account configured** — load `src/index.js` with
   `FIREBASE_SERVICE_ACCOUNT_PATH` pointing at a real, throwaway service-account
   JSON (freshly generated RSA key, written to a temp dir). This is the VM's
   shape and **fails before the fix** with the exact `TypeError`. No mocks: the
   real SDK, a real key, the real entry point.
3. **Export-surface diff** — a test that reads the installed SDK's real exports
   and asserts every `admin.<member>` in the repo is present on it. Validated by
   pointing it at the pre-fix code and confirming it goes RED.
4. **Installed-vs-locked version assertion** — fails if `node_modules` drifts
   from the lockfile major.
5. `getProdDb()` returns a Firestore handle for the secondary app.
6. Full express suite via `npm test`, then dev deploy with the health gate
   **observed** passing.

## Out of Scope

- **Provisioning `MFA_REMEMBER_SECRET` and `EXPORT_DOWNLOAD_SECRET`.** Still
  unset on the VM; still needs the operator. Tracked on SHY-0369 / SHY-0370.
- **PR #1882 (SHY-0370).** A separate module-load throw, already fixed and
  awaiting merge. It is **not** part of this outage and merging it would not have
  restored dev: its throw and SHY-0369's are both gated on
  `NODE_ENV === 'production'`, the dev VM has run `NODE_ENV=development` since
  2026-05-16, and both sit behind `index.js:14` while this crash is at
  `index.js:7`. Worth merging on its own terms — it protects production.
- **The duplicate `FIREBASE_WEB_API_KEY` line in the VM's `.env`.** Noted while
  reading key names; harmless last-wins today. Worth its own tidy-up.

## Dependencies

- Caused by #1520 (firebase-admin 13→14).
- Blocks the dev deploy, and therefore every device journey against dev.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A fourth removed member is still hiding | The fix ships the allowlist diff as a test, so the question is answered by CI on every run instead of by a grep someone remembers to write. |
| The throwaway key in the startup test looks like a secret | Generated at test time into a temp dir, never committed, never valid for any real project. |
| `npm ci` churns unrelated packages | Only firebase-admin was adrift; every other spot-checked package already matched the lockfile. |

## Definition of Done

- [ ] Dev API healthy; pm2 uptime stable and restarts not climbing.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched **and its
      health gate observed passing**.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20 — found by reading the VM, not the repo.** The handover said one
  merge would clear the outage. It would not have: the live crash was neither of
  the two documented module-load throws. `pm2 logs --err` named the real one in
  seconds. When a diagnosis and a live system disagree, the live system wins.
- **2026-08-20 — review response.** A reviewer pass found four blind spots in the
  first cut of the scanner: it could not see a destructure off the root, a member
  chained onto an unbound `require()`, bracket access, or any App accessor
  outside a hardcoded five. The App half was a blocklist inside a file whose own
  header argues against blocklists. All four are closed, the App side is now an
  allowlist of `name`/`options`, and the self-test drives the REAL analyser over
  every shape instead of re-implementing its logic. It also found a live
  path-leak in `admin-migrate.js` (Node's `MODULE_NOT_FOUND` reaches the HTTP
  response body) and a sibling test still doubling `credential: { cert }`.
