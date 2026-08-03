---
id: SHY-0154
status: In Review
owner: claude
created: 2026-07-01
priority: P1
effort: S
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1543
mvp: false
---

# SHY-0154: Harden the Android UI-dump helper with a settle-retry so cold-start dumps don't silently fail

## User Story

**As** the automated journey runner that drives the real Android device through cross-platform user journeys,
**I want** the Android UI-hierarchy dump to keep trying for a few seconds until the screen is in a stable, readable state,
**So that** a journey step doesn't spuriously "not find" an element just because the app was still finishing its cold-start when the dump was taken — which today silently sinks every cross-platform journey that hands off to Android.

## Why

Found while running #1527's local device gauntlet: the runner's Android driver captured the on-screen UI in a **single attempt** and, on any failure, logged a line and returned an **empty result** with no retry (`androidUiDump` in `express-api/scripts/drivers/android-adb-driver.js`). Android's `uiautomator dump` errors while the UI is **non-idle** — most importantly the app's ~4-second cold-start, but also any mid-animation/transition. So immediately after the driver launches the app, the dump fails, the helper returns empty, and the caller's element search finds nothing. Because the empty return is indistinguishable from "the element genuinely isn't there," the failure is **silent**: the journey just can't find what it's looking for and the whole cross-platform cell fails (or times out after ~20 minutes).

This is a **test-apparatus reliability bug**, not a product bug — it blocks Android journeys for **every** device-touching change this session (the SHY-0137/0138/0139 trio, SHY-0153, EPIC-0004/0005), which is why it is P1 and lands as the device-gauntlet **enabler**.

Reproduced first (not assumed): on the real CPH2653, a cold-launch followed by an **immediate** `uiautomator dump` fails; the **same** dump after a ~4s settle succeeds. The previous matrix run logged many `androidUiDump failed` lines and every cross-platform cell failed; after the fix the relaunched matrix logs **0** such failures and the Android handoffs proceed.

## Acceptance Criteria

### Happy path
- [ ] When the screen is already idle, the UI-dump returns a valid hierarchy on the **first** attempt (no added latency for the common case).
- [ ] When the app is still settling (cold-start), the UI-dump **retries** with a short backoff and returns a valid hierarchy once the screen becomes dumpable, within a bounded budget (~6.4s: 8 attempts × 800ms).

### Error paths
- [ ] If the screen never becomes dumpable within the budget, the helper returns an empty result (preserving the existing contract) **and** logs a single clear message that it exhausted all attempts (not one noisy line per internal try).
- [ ] A malformed/partial dump (no `<hierarchy>` root) is treated as a failure and retried, not returned as a valid dump.

### Edge cases
- [ ] A dump attempt that throws (device transiently busy) is caught and counted as a failed attempt, not propagated — the loop continues until success or budget exhaustion.
- [ ] The final attempt does **not** sleep after failing (no wasted tail latency).

### Performance
- [ ] Idle-screen dumps are unchanged in latency (return on attempt 1). Worst case adds ≤ ~6.4s only when the screen is genuinely non-idle — far cheaper than the ~20-min cell timeout the silent failure caused.

### Security
- N/A — engineering test tooling; no product surface, no auth, no user data, no network exposure change.

### UX
- N/A — no user-facing surface. Developer-facing: the exhaustion log line names the attempt count + last error so a genuinely-stuck screen is diagnosable.

### i18n
- N/A — internal test-runner code path; no translated strings.

### Observability
- [ ] On total failure the runner log states the helper failed after N attempts with the last underlying error — enough to distinguish "UI never settled" from "element absent" (the ambiguity that made the original bug silent).

## BDD Scenarios

**Scenario: the app is still starting up when the screen is read**

- **Given** the test runner has just opened the app on the real Android phone and it is still finishing loading
- **When** the runner reads the current screen contents to find a button
- **Then** it keeps trying for a few seconds until the screen is stable and returns the real contents, so the button is found instead of being wrongly reported as missing

**Scenario: the screen is already stable**

- **Given** the app is sitting on a settled screen
- **When** the runner reads the current screen contents
- **Then** it returns them immediately with no added delay

**Scenario: the screen never becomes readable**

- **Given** a screen that stays busy and never settles within the allowed time
- **When** the runner tries to read it
- **Then** it gives up after the bounded number of attempts and reports clearly that it could not read the screen, rather than silently pretending the screen was empty

## Test Plan

Touches `express-api/scripts/**` (test tooling) — no product/app/web runtime code.

**Red → Green (reproduce-first):**
- **RED (done, real device):** cold-launch `com.shyden.shytalk.local` on CPH2653 + immediate `uiautomator dump` → fails; +4s → succeeds. Previous matrix run `20260701-192635-local`: many `androidUiDump failed` lines, all cross-platform cells fail.
- **Refactor for testability:** extract the retry loop into a pure exported helper `retryDumpUntilValid(dumpOnce, { maxAttempts, backoffMs, isValid })` (no `adb` closure dependency — takes the single-dump function as a parameter); `androidUiDump` calls it with its `adb`-backed `dumpOnce`.
- **Unit test (GREEN):** `express-api/tests/drivers/android-uidump-retry.unit.test.js` (a unit-test location, so the controlled `dumpOnce` test-input is sanctioned): `returns on first success`, `retries then returns once dumpOnce yields <hierarchy> on the 4th call`, `returns '' after exhausting maxAttempts`, `treats a no-<hierarchy> result as invalid and retries`, `does not sleep after the final attempt`.
- **Real-device GREEN (the load-bearing proof):** relaunched matrix `20260701-200956-local` logs **0** `androidUiDump failed` and the Android cross-platform handoffs proceed.
- **Lint:** eslint `--max-warnings=0` + prettier clean on the driver + test; no-new-stubs ratchet green (the `dumpOnce` test input lives in a `*.unit.test.js`).

## Out of Scope
- iOS driver settle/robustness (WDA/Appium/LAN-bridge) — tracked separately if the iOS cells surface an analogous gap.
- The four launcher **environment** gaps fixed alongside this (`NODE_ENV=local`, `:8888` web server, emulator/web device tunnels) — those live in the `run-journeys` launcher (`~/.claude/skills/run-journeys/run.sh`), not the repo, and are operator tooling, not a repo PR.
- Any change to what the journeys assert — this only makes the screen-read reliable.

## Dependencies
- None blocking. The fix is self-contained in the Android driver. It is itself a **dependency of** every device-gauntlet run this session (#1527's device leg, the trio, SHY-0153, EPIC).

## Risks & Mitigations
- **Risk:** the retry masks a genuinely-broken screen. **Mitigation:** bounded budget (8×800ms) + an explicit exhaustion log naming the last error — a real hang still fails loudly, just diagnosably.
- **Risk:** added latency on every dump. **Mitigation:** returns on attempt 1 when idle (the common case); the backoff only engages while non-idle.
- **Risk:** `<hierarchy>` validity check rejects a legitimately-empty screen. **Mitigation:** `uiautomator` always emits a `<hierarchy>` root even for sparse screens; absence of it means the dump itself failed, which is exactly what we want to retry.

## Definition of Done
- [ ] Retry extracted to a pure helper + `androidUiDump` uses it; behaviour-preserving on the happy path.
- [ ] Unit test green (5 cases above); eslint/prettier/no-new-stubs clean.
- [ ] Real-device proof: a matrix run logs 0 `androidUiDump failed` and Android cross-platform cells proceed.
- [ ] `code-reviewer` 100% clean; pushed on `story/SHY-0154-android-uidump-settle-retry`; CI green; dev-verified; judgment-merged as the device-gauntlet enabler.
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 (AFK autonomous) — **CREATED + fix applied + real-device validated.** Surfaced while running #1527's local device gauntlet: cross-platform cells failed with repeated `[android-driver] androidUiDump failed`. Diagnosed on the real CPH2653 (not guessed): device Awake/unlocked/app-foreground, manual `uiautomator dump` succeeds; a **cold-launch + immediate** dump FAILS, **+4s** dump SUCCEEDS → the ~4s cold-start non-idle window. Root cause: `androidUiDump` did a single dump + returned `''` on failure with no retry ([[feedback-think-like-qa-real-fixes]] — a classic silent-failure: caller can't tell "not idle" from "element absent"). Applied a bounded settle-retry (8×800ms until valid `<hierarchy>`). Relaunched matrix `20260701-200956-local` → **0** `androidUiDump failed` (was many). Still TODO: refactor retry to a pure helper + unit test, then own branch/PR (enabler) → merge before #1527's device gauntlet can be green. Four adjacent launcher **environment** gaps (NODE_ENV, :8888, tunnels) were fixed in the same debugging pass but live in the runner-launcher tooling (out of scope here).
- 2026-07-01 (AFK) — **Refactor + unit test DONE.** Extracted the retry into a pure, injectable helper `express-api/scripts/drivers/ui-dump-retry.js` (`retryDumpUntilValid(dumpOnce, {maxAttempts, backoffMs, sleep})`); `androidUiDump` now calls it. Unit test `express-api/tests/drivers/ui-dump-retry.unit.test.js` **7/7 green** (first-success, retry-then-success on 4th call, exhaustion→ok:false/'', throw-then-retry, invalid-root retry, no-final-sleep, error-message surfacing) — plain-function `dumpOnce`/`sleep` inputs (no `jest.fn`/`Fake*`; ratchet clean, `.unit.test.js` location). eslint/prettier/node-c clean. Real-device: the inline version logged **0** `androidUiDump failed` on run `20260701-200956-local` (Android handoffs proceed); the refactored version is a behaviour-preserving extract-method (re-confirmed on-device via the next matrix). **NEW finding (separate concern → SHY-0155 perf):** with dumps now reliable, the matrix is FUNCTIONAL but SLOW — ~5 min/scenario (per-journey app cold-start ~4s settle + multi-dump retries), so a full 14-cell matrix is impractically long. Also observed 2 `manual-qa-runner` PIDs — possible orphan from a stopped run contending for the single device (cleanup at next check). The functional fix is proven; matrix *throughput* is the follow-up.
- 2026-07-01 (AFK) — **`code-reviewer` caught a BLOCKER I'd missed → right-sized the design.** The first cut added a strict `<hierarchy>` validity check (retry until the dump contains `<hierarchy`). The reviewer (verified: exactly **2** `<hierarchy` in the 17k-line `android-adb-driver.test.js`) showed this breaks the existing driver suite — ~1,223 inline mocks return partial `<node>` XML the matchers parse fine but which lacks the `<hierarchy>` root → all seen as "not idle" → retry → hang/fail. **Lesson: I verified only the new unit test, not the FULL driver suite** ([[feedback-workflow-verify-by-running]]). **Fix** ([[feedback-think-like-qa-real-fixes]]): the real cold-start failure is a THROW (`execSync` non-zero exit — "Command failed"), NOT a non-`<hierarchy>` return. Renamed `retryDumpUntilValid` → **`dumpWithRetry`**: retry ONLY on throw, return any non-throwing result as-is (matches the original contract) → fixes the cold-start bug + touches ZERO existing mocks. Also addressed the reviewer's 3 Major test-contract findings (assert `xml`/`lastErr` on success; verify `backoffMs`) — unit test now **8/8**. Full driver suite: 1333 passed + **2** error-path tests (`_tapByVisibleText` / `_dismissDailyRewardIfPresent` "UI dump failure") timed out — they mock a PERSISTENT dump-throw under fake timers without advancing through the new retry sleeps → fixed those 2 only (drain via `jest.runAllTimersAsync()`). eslint/prettier clean. Re-running the FULL suite to confirm 1335/1335 before push.
- 2026-07-01 (AFK) — **Re-review: 0 findings, safe to ship** — BLOCKER confirmed resolved (mocks untouched, retry-on-throw correct); the 2 error-path test fixes correct (`runAllTimersAsync` drains the bounded retry sleeps); 3 prior Majors addressed; `String(e)` fallback correct; 1335 test-count independently confirmed; 100% coverage. **Full driver suite 1335/1335** (exit 0). Status → In Review. Amended the SHY-0154 commit (helper + driver + 8/8 unit test + the 2 driver-test fixes + story) and pushed `story/SHY-0154-android-uidump-settle-retry` — the device-gauntlet enabler; operator-gated merge (NO auto-merge).
- 2026-07-08 — **Rebased onto develop (supersedes #1528) + fixed a driver-suite PERFORMANCE regression the retry had introduced.** #1528 was stacked on `fix/SHY-0152` (#1527); `git rebase --onto origin/develop b6fe10c8a91` replayed SHY-0154's single commit onto develop with zero conflicts (code files byte-identical to the reviewed content). **On the mandated full-suite re-run (the story's own lesson) I found the retry made `android-adb-driver.test.js` impractically SLOW:** every error-path test mocks a PERSISTENT adb throw, so `androidUiDump`'s 8-attempt retry burned 7×800ms of REAL backoff (~5.6s) per test × ~130 tests → the suite ran **>5 min** (green but unmergeably slow — the earlier "1335/1335 exit 0" was right on result, blind to duration). **Fix (TDD, think-like-QA — real fix not a plaster):** extracted a pure `resolveDumpBackoffMs(env)` in `ui-dump-retry.js` (defaults 800ms; honors `ANDROID_DUMP_BACKOFF_MS`, `env` injectable); `androidUiDump` passes `{ backoffMs: resolveDumpBackoffMs() }`; `android-adb-driver.test.js` sets `ANDROID_DUMP_BACKOFF_MS=0` in a saved/restored `beforeAll`. The retry COUNT (behaviour under test) is unchanged — only the wall-clock delay is removed in tests. 6 RED unit tests written first (default 800 / `0` / custom `250` / empty-string→800, then a hardening pair: non-numeric→800 / negative→800 — `resolveDumpBackoffMs` guards `Number.isFinite(n) && n >= 0`), watched fail, then GREEN. Full set **1409/1409 in ~1.7s** (was >5 min → ~180× faster). eslint `--max-warnings=0` + prettier clean. Fresh `code-reviewer` on the delta pending before push; `Reviewed-up-to` to be stamped at the reviewed fix commit. Shipped as a NEW branch (force-push is server-blocked for this account — ruleset `16058327`, no user bypass), superseding #1528.
- 2026-07-08 — **code-reviewer (delta on `2ed5db2d82b`): 1 Critical + 3 Important — ALL fixed.** (a) **Critical (coverage):** no test proved `androidUiDump` actually threads the resolved backoff into `dumpWithRetry` — a dropped-argument regression would stay green (just slow again). Added a wiring pin in `android-adb-driver.test.js` (`jest.spyOn(global,'setTimeout')` + env=5 + mocked persistent throw → asserts `setTimeout(fn, 5)`; ratchet-safe: `spyOn` is no tracked category and the file is already baselined). (b) **Important (whitespace):** `Number(' ')`=0 leaked past the empty-string guard → now `String(v).trim()` first (+ `'   '`→800 / `' 5 '`→5 tests). (c) **Important (null env):** `resolveDumpBackoffMs(null)` threw (a default param only substitutes `undefined`) → now `const e = env || process.env` (+ null test). (d) **Important (production leak — make bad state unrepresentable):** a bare `ANDROID_DUMP_BACKOFF_MS` read meant a stray shell export could defeat the real-device cold-start retry → now gated on `JEST_WORKER_ID` (set per Jest worker; `manual-qa-runner` never sets it), so the fast-backoff can exist ONLY under Jest (+ off-Jest gate test). Suite **1414/1414 in ~2.3s**; eslint `--max-warnings=0` + prettier + no-stubs ratchet all clean. Re-review of the fixes in flight → `Reviewed-up-to` stamped once clean.
- 2026-07-08 — **Re-review CLEAN — all 4 findings resolved, ZERO new issues** (same `code-reviewer`, re-read at HEAD `b2e825c966d`; traced each fix, confirmed the wiring pin genuinely fails on a dropped call-site arg — not a tautology — and that the `JEST_WORKER_ID` gate is a *structural* guarantee: a child process's env can't propagate to the parent shell, matching pre-existing precedent in `auth.js`/`sameCohort.js`/`segregation-audit.js`). The one non-blocking FYI (is `JEST_WORKER_ID` set under `jest --runInBand`?) I settled empirically: the driver suite runs **1336/1336 in 1.8s under `--runInBand`**, so the gate holds in band mode too — no debug-slowness exposure. `Reviewed-up-to: b2e825c966d`. Cleared to merge.
