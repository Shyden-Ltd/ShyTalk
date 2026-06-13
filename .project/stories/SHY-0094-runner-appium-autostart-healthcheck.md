---
id: SHY-0094
status: Draft
owner: claude
created: 2026-06-13
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0094: Runner auto-starts + health-checks the Appium server for native-iOS cells

## User Story

**As** a QA operator (or Claude session) running the matrix's native-iOS cells,
**I want** `manual-qa-runner.js` to ensure a healthy Appium server at `localhost:4723` automatically — starting one if absent, reusing one I already started, and tearing down only what it started,
**So that** the canonical real-iPhone native path (Appium + WebDriverAgent) "just works" without a manual `appium server` step, and a missing/broken Appium fails loud with exact remediation instead of a confusing connection error mid-run.

## Why

EPIC-0003's operator decision (2026-06-13) made Appium the canonical real-iPhone native path and chose **"runner auto-starts + health-checks"** the Appium server over the current "operator starts `appium server` once per session" model (CLAUDE.md § Local stack prerequisite still says a *running Appium server* is a manual precondition). `ios-appium-driver.js` already targets `DEFAULT_APPIUM_BASE_URL = 'http://localhost:4723'`, and `ios-driver-loader.js` routes to it — but nothing starts or verifies the server. This story adds that lifecycle to the runner so SHY-0095 (full native-iOS coverage) and the Pre-Merge gauntlet's iOS cells are runnable hands-free.

## Acceptance Criteria

### Happy path
- [ ] Before any native-iOS (Appium) cell, the runner's orchestrator calls an `ensureAppiumServer()` step that: probes `GET http://localhost:4723/status`; if **not** ready, spawns the Appium server; polls `/status` until it returns HTTP 200 with a ready payload (bounded timeout); then runs the iOS cells against it.
- [ ] The server is started **once by the parent orchestrator** and shared across the per-cell child processes (it is NOT started per cell), matching the runner's `spawnSync`-per-cell architecture.
- [ ] On run completion, the runner **stops the Appium server it started** (clean SIGTERM, no orphaned process — verify no listener remains on :4723).

### Error paths
- [ ] If the `appium` binary is **not installed** / fails to spawn (real `ENOENT`), the runner emits a **loud, actionable error** naming the remediation (`npm i -g appium` + `appium driver install xcuitest`) and the native-iOS cells **skip loudly** (recorded as env-skip) — never a silent pass.
- [ ] If `/status` never becomes ready within the bounded timeout, the runner fails loud, tears down the half-started server, and reports the timeout (no indefinite hang).
- [ ] If `WDA_TEAM_ID` (WebDriverAgent signing) is unset when an iOS cell needs the real app, the runner errors **before** attempting launch, naming the missing signing precondition.

### Edge cases
- [ ] **Operator-started server reuse:** if a healthy Appium is already listening on :4723 (e.g. the operator started it), the runner **reuses it** and does **NOT** kill it on teardown — it only stops a server it itself spawned (tracked by an "owned" flag).
- [ ] **Port already in use by a non-Appium process:** `/status` probe fails to return an Appium-ready payload → loud error (don't assume the port owner is Appium; don't kill it).
- [ ] **Re-entrancy:** two `ensureAppiumServer()` calls in one run do not start two servers (idempotent — second call sees the first healthy).

### Performance
- [ ] The `/status` health-check uses bounded polling with backoff (no busy-spin); a freshly-started server adds a one-time startup wait (not per-cell); a reused server adds ~0 overhead.

### Security
- [ ] The spawned Appium binds **localhost only** (no `--allow-cors`, no external bind); the child is launched without a shell (`spawn`/`execFile`, not `exec` of a command string) to avoid the command-injection class; the child is reliably reaped (no orphaned server holding :4723).

### UX
- [ ] The QA operator no longer runs `appium server` by hand; the runner's output clearly states whether it **reused** an existing server or **started** one, and (on failure) exactly what to install/do.

### i18n
- N/A — runner tooling output is English (internal engineering surface).

### Observability
- [ ] The run log records: probe result, started-vs-reused, health-check duration, and teardown (owned→stopped / reused→left running) — so a reader knows the server's provenance without re-deriving it.

## BDD Scenarios

**Scenario: server absent → runner starts + health-checks it**
- **Given** no Appium server on :4723
- **When** the runner reaches the native-iOS cells
- **Then** it spawns Appium and polls `/status` until ready
- **And** the iOS cells run against it
- **And** the runner stops the server it started on completion

**Scenario: operator-started server is reused, not killed**
- **Given** a healthy Appium the operator started on :4723
- **When** the runner runs the iOS cells
- **Then** it reuses that server (does not start a second)
- **And** on teardown it leaves the operator's server running

**Scenario: Appium not installed → loud skip, not silent pass**
- **Given** the `appium` binary cannot be spawned (ENOENT)
- **When** the runner tries to ensure the server
- **Then** it reports an actionable error naming the install steps
- **And** the native-iOS cells are recorded as env-skip, never passed

**Scenario: health-check times out → fail loud + teardown**
- **Given** a spawned Appium whose `/status` never goes ready
- **When** the bounded timeout elapses
- **Then** the runner fails loud and kills the half-started server

## Test Plan

Touches `manual-qa-runner.js` (+ likely a small `appium-server-lifecycle.js` helper) → **runs the FULL Pre-Merge Testing Protocol**. Per CLAUDE.md § No Stubs, the lifecycle is tested against a **real** Appium server (no `child_process` mock).

**Red → Green (framework by framework):**
- **Express/Node (Jest)** `cd express-api && npm test` — a new `tests/scripts/appium-server-lifecycle.test.js`:
  - **start path (real):** with :4723 free, `ensureAppiumServer()` spawns a **real** Appium, real `GET /status` returns 200, teardown stops it and :4723 is free again. RED before the helper exists.
  - **reuse path (real):** start a real Appium first, then `ensureAppiumServer()` → asserts it did **not** spawn a second (pid/owned-flag) and teardown leaves it running.
  - **ENOENT path (real condition induced, not mocked):** point the helper at a **bogus binary path** → real `ENOENT` → asserts the actionable error + env-skip outcome (inducing the real failure per the No-Stubs escape-hatch rule, not mocking a rejection).
  - **timeout path:** point the probe at a port with a non-ready listener → asserts bounded-timeout failure + teardown.
  - `qa-runner-driver-checks-pin.test.js` / `runner-driver-name-pin.test.js` green unchanged (no driver-name drift).
- **eslint** `npm run lint` → 0 warnings.
- **Device gauntlet (Phase 1 LOCAL):** with a **real iPhone** connected + `WDA_TEAM_ID` set, run a native-iOS cell **without** a manually-started Appium → the runner auto-starts it and the cell connects (the headline integration AC). Re-run with an operator-started Appium → reuse path proven on real hardware.
- **Phase 2:** `code-reviewer` 100% clean → push → CI green by name (Detect Changes / Analyze JavaScript / PR Gate). The lifecycle helper's pure logic is CI-testable; the real-iPhone integration is local-only (no device in CI — noted in PR).
- **Phase 3 (DEV):** re-run on dev (web = Chrome); native-iOS remains a local-gauntlet cell (no real device in CI/dev).

## Out of Scope
- Implementing the iOS driver's `iosShows*` coverage (that is SHY-0095 — this story only guarantees a healthy server for it to talk to).
- WebDriverAgent signing automation (the runner errors clearly if `WDA_TEAM_ID` is unset; provisioning is operator/hardware setup, SHY-0026).
- Running native-iOS cells in CI (no real iPhone on hosted runners; no self-hosted runners per policy).

## Dependencies
- `ios-appium-driver.js` (`DEFAULT_APPIUM_BASE_URL`, real Appium bridge) + `ios-driver-loader.js` routing (present).
- A **real iPhone** connected + trusted, `WDA_TEAM_ID` set, Appium + `@appium/xcuitest` installed for the real-hardware integration leg.
- SHY-0026 onboarding (`setup-ios-wda.sh`) for WDA signing preconditions.

## Risks & Mitigations
- **Risk:** the runner kills an operator-started Appium. **Mitigation:** the "owned" flag — teardown stops only a server the runner spawned; reuse path explicitly leaves external servers running (covered by a real-hardware test).
- **Risk:** an orphaned Appium holds :4723 across runs. **Mitigation:** reliable child reaping on all exit paths (incl. timeout/error) + a post-run :4723-free assertion.
- **Risk:** inducing the "appium not installed" path by uninstalling Appium is destructive. **Mitigation:** induce the **real** `ENOENT` by pointing the helper at a bogus binary path (real condition, no global uninstall, no mock).

## Definition of Done
- [ ] `ensureAppiumServer()` lifecycle (probe → start-if-absent → health-check → owned-teardown / reuse) implemented in the runner; CLAUDE.md § Local stack prerequisite updated to drop the manual `appium server` step.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): lifecycle Jest RED→GREEN against a real Appium (start/reuse/ENOENT/timeout) + runner pin tests green + eslint 0 → LOCAL gauntlet proves auto-start + reuse on the **real iPhone** → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-06-13 — Filed under EPIC-0003 (child build-order item **B**). Evidence at filing: runner spawns each cell as its own `spawnSync` child (~line 16118) → Appium must be a parent-owned shared server, not per-cell; `ios-driver-loader.js` (~16303) routes to `ios-appium-driver.createIosDriver`; no Appium lifecycle exists today (CLAUDE.md line 319 lists "a running Appium server" as a manual precondition — this story removes that manual step). No-Stubs: lifecycle tested against a real Appium + real `/status` + real induced `ENOENT`.
