---
id: SHY-0176
status: Draft
owner: claude
created: 2026-07-11
priority: P2
effort: S
type: infra
roadmap_ids: []
---

# SHY-0176: Playwright WebKit engine crashes abort full-suite serial runs on macOS

## User Story

As the release engineer running the pre-merge browser gauntlet,
I want the WebKit project to complete a full 1392-spec serial run without engine crashes,
So that the local matrix can certify Safari-engine behaviour without manual crash-triage on every run.

## Why

During SHY-0149's verification (2026-07-10/11), three consecutive full-suite WebKit runs on macOS crashed the browser process mid-run ("Target page, context or browser has been closed", 31 per-test timeouts in one run, 9+ crash markers in another), each aborting 29–34 queued specs as "did not run". Every spec that COMPLETED passed (1278 passed per run; the only hard failures were a real CSP defect fixed under SHY-0149), and the same specs are green on chromium, firefox, mobile-chrome, and mobile-safari — so the instability is engine-environment, not product. Until fixed, WebKit certification relies on targeted re-runs, which weakens the full-matrix guarantee for the Safari engine.

## Acceptance Criteria

### Happy path
- [ ] `npx playwright test --project=webkit` completes all 1392 specs on the local stack with exit 0 (flaky-on-retry tolerated) in 3 consecutive runs.
- [ ] Zero "browser has been closed" markers attributable to engine crashes in those runs' logs.

### Error paths
- [ ] If the engine still crashes, the run's failure output names the crash count and the aborted spec list explicitly (no silent "did not run" without a cause line in the runner summary).

### Edge cases
- [ ] The fix holds for the retry tail (crashes tonight clustered past spec ~1300, in long-session territory).
- [ ] mobile-safari (same engine, mobile emulation) completes under the same conditions.

### Performance
- [ ] Full webkit run wall-clock ≤ 45 min on the reference machine (tonight's crashing runs took 1.2–1.3 h; healthy pace projects ~30 min).

### Security
- N/A — test-infrastructure stability; no security surface.

### UX
- N/A — no user-facing surface; developer-facing output covered under Error paths.

### i18n
- N/A — no strings.

### Observability
- [ ] The matrix runner's per-project summary line includes the crash-marker count for webkit runs (grep-able, so a crash-free certification is provable from the log alone).

## BDD Scenarios

**Scenario: full WebKit suite completes without engine crashes**

- **Given** the local stack is up and seeded and the machine has no other browser load
- **When** the full WebKit project runs serially to completion
- **Then** the run exits 0 with zero "did not run" specs
- **And** the log contains zero engine-crash markers

**Scenario: a crash, if it still occurs, is loudly attributed**

- **Given** a WebKit run in which the engine crashes
- **When** the runner prints its per-project summary
- **Then** the summary names the crash count and the number of aborted specs rather than only a bare non-zero exit

## Test Plan

- **Red:** a stress harness re-running tonight's crash window (`tests/web/admin-suggestions.spec.ts` + `admin-users-*.spec.ts` tail, ~200 specs) 3× consecutively on webkit; red = any engine-crash marker. Candidate fixes to evaluate (in order): Playwright/WebKit build upgrade (`npx playwright install webkit` on the latest Playwright release), per-project `retries` isolation via a fresh browser per file (`test.describe.configure` / launch options), splitting the webkit project into 2 shards locally, bumping per-test timeout for webkit only.
- **Green:** 3 consecutive full webkit runs exit 0 with zero crash markers; runner summary line carries `webkit-crash-markers=0`.
- Runner-side observability change is pinned by a fixture test on the summary-line generator if the runner script gains one (scripts are currently session-local; if promoted into `scripts/`, add a bats/jest pin per repo convention).

## Out of Scope

- Product-code changes (none are implicated — all completed specs pass).
- CI webkit jobs (Linux WebKit builds have not exhibited the crash; this is the macOS local gauntlet).
- The mobile-safari flaky rate beyond the shared-engine crash mode.

## Dependencies

- SHY-0149's matrix-runner infrastructure (python http.server swap, fresh-API rule, connection-error hard gate) — this story builds on that runner.

## Risks & Mitigations

- **Risk:** the crash is a machine-load artifact (5+ hours of continuous browser testing preceded tonight's runs) and vanishes on a fresh boot, making red unreproducible. **Mitigation:** the stress harness runs after a reboot first; if unreproducible in 3 attempts, close as environmental-transient with the evidence recorded and keep only the observability AC.
- **Risk:** a Playwright upgrade changes behaviour across all engines mid-sprint. **Mitigation:** upgrade in this story's branch only, full 5-engine matrix before merge per protocol.

## Definition of Done

- All AC checked; 3 consecutive clean full webkit runs recorded in Notes with log paths; runner observability line present; merged to develop; released per the standard release-cut flow.

## Notes (running log)

- 2026-07-11 — Filed from SHY-0149's verification session. Evidence: matrix run webkit exit=1 (1278p/19 flaky/29 did-not-run, 31 test-timeouts, 1.3h); re-run v2 (1278p/18 flaky/34 did-not-run, 9+ crash markers, 1.2h); all completed specs pass; same specs green on 4 other engines; targeted webkit re-verify 18/18. Machine had been under continuous browser-test load ~5h.
