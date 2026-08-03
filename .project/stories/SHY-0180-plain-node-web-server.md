---
id: SHY-0180
status: In Review
owner: claude
created: 2026-07-13
priority: P1
effort: S
type: infra
roadmap_ids: []
---

# SHY-0180: Replace `npx serve` with a zero-dependency static server for the local web tier

## User Story

As a ShyTalk contributor running the web test suite, I want the local static web server to survive an entire Playwright run, so that a push or local gauntlet isn't sabotaged by phantom `ERR_CONNECTION_REFUSED` failures when the web server dies mid-suite.

## Why

`npx serve public -l 8888` (used by `local/start.sh` step 6b and the pre-push hook's Playwright block) **dies ~15 minutes into a heavy Chromium suite**, turning the tail of the run into mass `ERR_CONNECTION_REFUSED` failures that look like product bugs. It blocked SHY-0095's push **three times** on 2026-07-12 (84 retried + 143 did-not-run; 83 phantom fails) and has ~5 confirmed deaths.

Root-caused 2026-07-13 by a controlled repro with a parent/child death-ordering capture: `serve` logs `INFO Gracefully shutting down` (its SIGINT/SIGTERM **signal handler** — a received signal, NOT a load crash or `EMFILE`; the `EBADF`-on-open is an in-flight read hitting a torn-down fd *during* graceful shutdown), and its `npm exec` parent dies at the same instant. The death only strikes `npx serve` under **active** suite load — an **idle** `npx serve` survived, and a plain-node static server serving the **identical** suite survived end-to-end (18+ min). Whether the trigger is macOS memory-pressure victim-selection (the GB-hungry Chromium suite) or an external signal targeting the `npm exec` layer, the fix is the same: drop the fragile `npm exec`-wrapped `serve` for a zero-dependency Node-core static server that is leaner and can't repeat serve's unhandled-`error` crash.

## Acceptance Criteria

### Happy path
- [ ] `node local/serve-web.js --port 8888 --root public` serves the app with `serve`-parity: clean URLs (`/admin/reports` → `admin/reports.html`), directory index (`/`, `/admin/` → `index.html`), correct `Content-Type` per asset type, `200` for real files.
- [ ] Every `npx serve public -l 8888` on the web-test path launches `serve-web.js` instead: `local/start.sh` step 6b, the pre-push Playwright hint, and `.github/workflows/playwright-tests.yml`'s "Serve admin panel" step (same port 8888, same fd-limit raise where applicable).

### Error paths
- [ ] Unresolved paths return `404` (never a hang, never a crash).
- [ ] A file-read error mid-response ends only THAT request (`500`), never the process — the specific failure mode that killed `serve`.

### Edge cases
- [ ] Path-traversal (`/../package.json`, encoded `%2e%2e`) resolves outside the web root → `404`, never serves a file above `public/`.
- [ ] `SIGINT`/`SIGTERM` closes the server and exits `0` cleanly (no half-torn-down fd race, no non-zero crash).
- [ ] A URL with a query string / fragment (`/admin/?tab=x`) resolves the path ignoring `?`/`#`.

### Performance
- [ ] Survives a full Chromium Playwright run (≥16 min) without dying — the whole point (verified by re-running the suite against it and confirming the process is still alive past the ~15 min mark where `serve` died).

### Security
- [ ] The web root is confined: a resolved path must equal the root or start with `root + sep`, else `404` — no traversal escape.
- [ ] Zero third-party dependencies (Node core `http`/`fs`/`path` only) — no supply-chain surface, nothing to `npm exec`.

### UX
- N/A — developer/test tooling; no user-facing surface.

### i18n
- N/A — static file server; serves the already-localized assets unchanged.

### Observability
- [ ] Startup logs the served root + port + pid; a mid-read error logs the file + error code (unless `--quiet`) so a genuine asset problem is diagnosable.

## BDD Scenarios

**Scenario: the web server survives the whole test suite**

- **Given** the local static server is `serve-web.js` on port 8888
- **When** a full Chromium Playwright suite runs for 16+ minutes against it
- **Then** the server is still alive at the end and no test fails with `ERR_CONNECTION_REFUSED`

**Scenario: clean URLs and directory indexes match `serve`**

- **Given** `serve-web.js` serving `public/`
- **When** a request arrives for `/admin/reports` or `/admin/`
- **Then** it returns `admin/reports.html` / `admin/index.html` with `Content-Type: text/html`

**Scenario: a path-traversal attempt is refused**

- **Given** `serve-web.js` serving `public/`
- **When** a request tries to escape the root (`/../package.json`)
- **Then** it returns `404` and never serves a file outside `public/`

**Scenario: a mid-read fd error doesn't take the server down**

- **Given** an in-flight response whose file read errors
- **When** the read stream emits `error`
- **Then** that request ends `500` and the server keeps serving every other request

## Test Plan

CI-config/dev-tooling classification: touches only `local/serve-web.js` (new dev-tooling), `local/start.sh` (dev bring-up), and the pre-push hook comment/launch — **no app, backend, or website runtime surface**, so the device/browser gauntlet is exempt (SHY-0163 CI-config-only rule). It STILL runs the full non-device gauntlet + the real-suite survival check below.

**Red → Green (Jest, real server — no mocks):**
- `express-api/tests/scripts/serve-web.test.js` (NEW) — pure helpers `parseArgs` (port/root/quiet, `-l`/`--no-clipboard` aliases), `contentType` (js/css/html/json/png/svg/octet-stream default), `resolveFile` (exact file, clean-URL `.html`, dir-index, query/fragment stripping, traversal refusal, missing → null), and `createServer` driven over a **real** `http` listener on an ephemeral port against a real temp web root (200 + correct type, 404, mid-read `error` → 500 + server stays up). REAL server, real sockets, real files — no doubles.
- **Real-suite survival (the perf AC):** re-run `npx playwright test --project=chromium` against `serve-web.js` on :8888 and confirm the process is alive past 16 min (the repro that killed `serve`). Recorded in Notes.
- **Static/quality:** `eslint --max-warnings=0` + prettier clean; `bash -n`/`actionlint` for the `start.sh` edit; story-frontmatter validator.

## Out of Scope

- Replacing `serve` on the **prod/dev server** path (those are Caddy/PM2, not `npx serve` — untouched).
- Removing the `serve` devDependency from `package.json` (a separate cleanup; leaving it installed is harmless).
- HTTPS / compression / caching headers beyond what the suite needs (the suite drives plain HTTP on localhost).
- Identifying the exact signal sender (memory-pressure vs external) — the immune-server fix makes it moot; a follow-up may `sudo dtrace` it if it ever recurs against `serve-web.js`.

## Dependencies

- None. Pure Node core; drops the `serve` devDependency from the local-web path (the package can stay installed for now — removing it from `package.json` is a separate cleanup).

## Risks & Mitigations

- **Parity gap with `serve`** (a header/behaviour the suite relied on) → the real-suite survival run exercises the actual asset requests the app makes; any 404/type mismatch shows up as a test failure, not a silent difference.
- **The death recurs against `serve-web.js`** (i.e. it WAS memory-pressure picking any node process) → then the perf AC's survival run fails and we escalate to Playwright worker-count / memory tuning; the empirical decoy evidence (survived 18 min) makes this low-probability.

## Definition of Done

- `serve-web.js` in the tree with full unit + real-`http` coverage green; `start.sh` + pre-push launch it; the real Chromium suite runs to completion with the server alive past 16 min (recorded in Notes); `code-reviewer` 100% clean; CI green by name; merged to develop; released with `released_in:`.

## Notes (running log)

- 2026-07-13 — Filed from the SHY-0095 serve-killer investigation (see `project-shy0095-merged-and-serve-killer` memory). Root cause: `npx serve` receives a signal ~15 min into a heavy suite and its `npm exec` wrapper's graceful-shutdown path crashes on EBADF; a zero-dep Node-core server (no npm-exec wrapper, per-stream error handling) is empirically immune. `type: infra`, dev-tooling — gauntlet-exempt but full non-device gauntlet + a real-suite survival run apply.
- 2026-07-13 04:33 — **PERF-AC SURVIVAL RUN: PASS (fix empirically verified).** A full `npx playwright test --project=chromium` (kicked 04:14:00) ran against `local/serve-web.js` on :8888: the server process (pid 80004) stayed ALIVE the entire **18.3 min** — clean past the ~15 min mark where `npx serve` died in the immediately-prior controlled repro (04:06:17 = 15m14s in). Result: **1366 passed / 1 flaky / SUITE_RC=0 / ZERO `ERR_CONNECTION_REFUSED`** — vs the `npx serve` run's 83 phantom fails + 143 did-not-run from the mid-suite death. Unit coverage: `serve-web.test.js` 37/37 after the R1 review (real `http` + real spawned child + real temp roots, no doubles). `local-start-serve-fdlimit-pin.test.js` updated to the new launch line, green. eslint/prettier clean (test file, express-api scope); `local/serve-web.js` follows the `local/` double-quote convention — not in the eslint/lint-staged glob, `node -c` clean; `start.sh` `bash -n` clean.
- 2026-07-13 — **code-reviewer R1: 2 Critical + 5 Important + 6 Minor — all verified then fixed (or accepted with rationale).** (C1) 3 pre-existing tests in `local-stack-resource-diet.test.js` hard-pinned the removed `npx serve public -l 8888` line → RED; confirmed by running the file, updated all 3 + the stale port-comment to the `serve-web.js --port 8888` launch (the launch now spans 2 lines, so the SERVE_PID pin anchors on `SERVE_PID=$!` and asserts the launch precedes it ≤3 lines with the `&` on the line above). (C2, REAL bug in my code) `res.writeHead(200)` ran synchronously BEFORE the read stream, so `headersSent` was already true when an open-error fired → the `if (!res.headersSent) res.writeHead(500)` was DEAD CODE and a failed read shipped a misleading `200 + empty body`. Fixed: headers now written on the stream's `open` event, so an open-error (ENOENT TOCTOU / EACCES / EMFILE) still owns the response and sends a real 500; proven by a new over-the-wire EACCES test (chmod 000, non-root-guarded — GH Actions runs non-root) asserting 500 + server-stays-up. (I3/I4/I12) stale `npx serve` strings fixed in `start.sh`'s death message, the pre-push enable-hint, AND `.github/workflows/playwright-tests.yml`'s "Serve admin panel" step (the CI instance of the same fragile tool — folded in). (I5) the sibling-prefix confinement test was tautological (no file created → null for the wrong reason); now creates a real `${root}-evil/secret` so the `startsWith(absRoot + sep)` guard is provably load-bearing (reverting to bare `startsWith` would serve it → red). (I6) `main()` + SIGINT/SIGTERM had zero coverage; added a real spawned-child test (`node serve-web.js --port 0`, send the signal, assert exit 0) for both signals. (I7) `--quiet` no longer suppresses read-error logs (only the one-line startup banner) so the Observability AC holds in the deployed `--quiet` config. Plus edge tests: parseArgs NaN/undefined boundaries, extensionless-dir-no-slash, real-dir-no-index→404. **serve-web.test.js 37/37.** (I8 Minor, ACCEPTED) symlink-escape inside `public/` is undefended (lexical confinement only, no `realpathSync`) — accepted: `public/` is git-committed with **zero** symlinks (verified), it's a read-only local test server, and planting a symlink needs a committed symlink (review-visible) or checkout write access; adding realpath would also mis-fire on macOS's symlinked `/tmp`. Documented here per the reviewer's "explicit acceptance" option. Remaining Minors (double-encoded/null-byte traversal already proven safe by the reviewer's own trace; HEAD/non-GET methods) folded into the coverage above or N/A.
- 2026-07-13 — **Reconciles the SHY-0095 #1583 fd-guard claim.** That PR's `start.sh` `ulimit -n 10240` guard (commit cdfa2f00f66) was justified as "the EMFILE mid-run serve killer" fix. This story's controlled repro proved the deaths are SIGNAL-driven (`serve` logs `Gracefully shutting down`), NOT `EMFILE` — the fd-raised serve died identically. So the fd-guard is **valid defensive hardening** (macOS 256 default IS low for a server under load) but was **NOT the root-cause fix** for the mid-suite deaths; SHY-0180 (dropping `npx serve` for a signal-safe zero-dep server) is. The guard is kept (correct hardening); this Notes entry is the honest correction of the earlier claim.
