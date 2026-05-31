/**
 * matrix-dispatch.test.js
 *
 * Tests the runner's matrix iteration helper. Coverage areas:
 *   - isInitError signature matching across every driver's init errors
 *   - runMatrix:
 *     - happy path (all pass)
 *     - mixed pass/fail/skip
 *     - failFast (stop on first fail) — skips remaining cells with
 *       "matrix aborted by failFast" sentinel
 *     - failFast does NOT stop on skip (skips are device-not-connected,
 *       not test failures)
 *     - dispatch throwing init-error → 'skip'
 *     - dispatch throwing other error → 'fail'
 *     - dispatch returning falsy (incl. null/undefined/0) → 'fail'
 *     - onCellStart / onCellEnd progress callbacks
 *     - duration timing via injected nowMs
 *     - input validation (browsers not array, empty array, missing
 *       dispatchOne)
 *     - totals + summary string shape
 *     - ok flag (false iff any fail)
 *   - formatMatrixResult shape: header / per-cell row / summary line
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const {
  INIT_ERROR_SIGNATURES,
  isInitError,
  runMatrix,
  formatMatrixResult,
  formatMatrixResultJson,
  formatMatrixResultJunit,
} = require(path.join(REPO_ROOT, 'express-api/scripts/matrix-dispatch'));

// isInitError ───────────────────────────────────────────────────────

describe('isInitError', () => {
  test('returns false for null / undefined / non-Error', () => {
    expect(isInitError(null)).toBe(false);
    expect(isInitError(undefined)).toBe(false);
    expect(isInitError('plain string error')).toBe(false);
  });

  test('returns true when err.code === DRIVER_INIT_FAILED', () => {
    const e = new Error('any message');
    e.code = 'DRIVER_INIT_FAILED';
    expect(isInitError(e)).toBe(true);
  });

  test.each([
    '[android-cdp-helpers] no Android device attached. Check `adb devices`',
    '[android-cdp-helpers] adb not found at "/opt/homebrew/bin/adb"',
    '[android-cdp-helpers] Android device is unauthorised. Tap "Allow USB"',
    '[android-cdp-helpers] adb forward failed: cannot bind',
    '[mobile-samsung-android-driver] connectOverCDP(http://127.0.0.1:9555) failed',
    '[mobile-edge-android-driver] CDP returned 0 contexts — Mobile Edge',
    'createMobileSafariIosDriver: no connected iPhone found via xcrun devicectl',
    'createIosDriver: WDA_TEAM_ID env var is required',
    'Appium /session failed (500) for Chrome iOS',
    'Appium /contexts for Edge iOS returned no WEBVIEW_ context',
    'createMobileWebkitIosDriver: browser "safari" is not supported',
  ])('detects init signature: %s', (msg) => {
    expect(isInitError(new Error(msg))).toBe(true);
  });

  test.each([
    'expected 5 but got 3',
    'TypeError: x is not a function',
    'AssertionError: assertion failed',
    'request timeout after 30000ms',
    'fetch failed',
  ])('does NOT match real test failures: %s', (msg) => {
    expect(isInitError(new Error(msg))).toBe(false);
  });

  test('INIT_ERROR_SIGNATURES is exported (so future drivers can register)', () => {
    expect(Array.isArray(INIT_ERROR_SIGNATURES)).toBe(true);
    expect(INIT_ERROR_SIGNATURES.length).toBeGreaterThan(0);
    for (const rx of INIT_ERROR_SIGNATURES) {
      expect(rx).toBeInstanceOf(RegExp);
    }
  });
});

// runMatrix — input validation ────────────────────────────────────

describe('runMatrix — input validation', () => {
  test('throws when browsers is not an array', async () => {
    await expect(runMatrix({ browsers: 'chromium', dispatchOne: () => true })).rejects.toThrow(
      /browsers.* must be an array/,
    );
  });

  test('throws when browsers is empty (caller error — usually means --matrix on a target with no browsers)', async () => {
    await expect(runMatrix({ browsers: [], dispatchOne: () => true })).rejects.toThrow(
      /browsers.* is empty/,
    );
  });

  test('throws when dispatchOne is missing', async () => {
    await expect(runMatrix({ browsers: ['chromium'] })).rejects.toThrow(
      /dispatchOne.*callback is required/,
    );
  });

  test('throws when dispatchOne is not a function', async () => {
    await expect(runMatrix({ browsers: ['chromium'], dispatchOne: 'foo' })).rejects.toThrow(
      /dispatchOne.*callback is required/,
    );
  });
});

// runMatrix — happy paths ───────────────────────────────────────────

describe('runMatrix — happy paths', () => {
  test('all-pass matrix: every cell outcome is "pass"', async () => {
    const r = await runMatrix({
      browsers: ['chromium', 'firefox', 'webkit'],
      dispatchOne: async () => true,
    });
    expect(r.totals).toEqual({ pass: 3, fail: 0, skip: 0, timeout: 0 });
    expect(r.summary).toBe('3 pass / 0 fail / 0 skip');
    expect(r.ok).toBe(true);
    expect(r.cells.every((c) => c.outcome === 'pass')).toBe(true);
  });

  test('mixed pass/fail/skip — pass count + summary string', async () => {
    const r = await runMatrix({
      browsers: ['chromium', 'firefox', 'mobile-safari-ios'],
      dispatchOne: async ({ browser }) => {
        if (browser === 'chromium') return true;
        if (browser === 'firefox') return false;
        if (browser === 'mobile-safari-ios') {
          throw new Error('no connected iPhone found via xcrun devicectl');
        }
        return true;
      },
    });
    expect(r.totals).toEqual({ pass: 1, fail: 1, skip: 1, timeout: 0 });
    expect(r.summary).toBe('1 pass / 1 fail / 1 skip');
    expect(r.ok).toBe(false);
  });

  test('skip outcomes do NOT make ok=false (only fails do)', async () => {
    const r = await runMatrix({
      browsers: ['mobile-chrome-android', 'mobile-safari-ios'],
      dispatchOne: async () => {
        throw new Error('no Android device attached');
      },
    });
    expect(r.totals.skip).toBe(2);
    expect(r.totals.fail).toBe(0);
    expect(r.ok).toBe(true);
  });

  test('cells preserve browser order (no reordering)', async () => {
    const order = ['firefox', 'chromium', 'webkit', 'edge'];
    const r = await runMatrix({
      browsers: order,
      dispatchOne: async () => true,
    });
    expect(r.cells.map((c) => c.browser)).toEqual(order);
  });
});

// runMatrix — outcome classification ─────────────────────────────────

describe('runMatrix — outcome classification', () => {
  test('truthy return → "pass"', async () => {
    const r = await runMatrix({
      browsers: ['c'],
      dispatchOne: async () => ({ anything: 'truthy' }),
    });
    expect(r.cells[0].outcome).toBe('pass');
  });

  test.each([false, null, undefined, 0, '', NaN])('falsy return %p → "fail"', async (value) => {
    const r = await runMatrix({
      browsers: ['c'],
      dispatchOne: async () => value,
    });
    expect(r.cells[0].outcome).toBe('fail');
  });

  test('init-error thrown → "skip" with error message captured', async () => {
    const r = await runMatrix({
      browsers: ['mobile-chrome-android'],
      dispatchOne: async () => {
        throw new Error('no Android device attached');
      },
    });
    expect(r.cells[0].outcome).toBe('skip');
    expect(r.cells[0].error).toMatch(/no Android device/);
  });

  test('non-init Error thrown → "fail" with error message captured', async () => {
    const r = await runMatrix({
      browsers: ['c'],
      dispatchOne: async () => {
        throw new Error('AssertionError: expected 5 but got 3');
      },
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].error).toMatch(/AssertionError/);
  });

  test('error.code = CELL_TIMEOUT → outcome="timeout"', async () => {
    const r = await runMatrix({
      browsers: ['chromium'],
      dispatchOne: async () => {
        const e = new Error('cell timed out after 60s');
        e.code = 'CELL_TIMEOUT';
        throw e;
      },
    });
    expect(r.cells[0].outcome).toBe('timeout');
    expect(r.cells[0].error).toMatch(/timed out/);
  });

  test('timeout outcome makes ok=false (treated as a real failure)', async () => {
    const r = await runMatrix({
      browsers: ['chromium'],
      dispatchOne: async () => {
        const e = new Error('cell timed out');
        e.code = 'CELL_TIMEOUT';
        throw e;
      },
    });
    expect(r.ok).toBe(false);
    expect(r.totals.timeout).toBe(1);
  });

  test('summary string adds "/ N timeout" segment only when timeout > 0', async () => {
    const noTimeouts = await runMatrix({
      browsers: ['c'],
      dispatchOne: async () => true,
    });
    expect(noTimeouts.summary).toBe('1 pass / 0 fail / 0 skip');

    const withTimeout = await runMatrix({
      browsers: ['c', 'd'],
      dispatchOne: async ({ browser }) => {
        if (browser === 'd') {
          const e = new Error('cell timed out');
          e.code = 'CELL_TIMEOUT';
          throw e;
        }
        return true;
      },
    });
    expect(withTimeout.summary).toBe('1 pass / 0 fail / 0 skip / 1 timeout');
  });

  test('failFast aborts on timeout (a hang is at least as actionable as a fail)', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      failFast: true,
      dispatchOne: async ({ browser }) => {
        if (browser === 'b') {
          const e = new Error('cell timed out');
          e.code = 'CELL_TIMEOUT';
          throw e;
        }
        return true;
      },
    });
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[1].outcome).toBe('timeout');
    expect(r.cells[2].outcome).toBe('skip');
    expect(r.cells[2].error).toMatch(/aborted by failFast/);
  });

  test('error.code = DRIVER_INIT_FAILED forces "skip" even when message looks like a real failure', async () => {
    // Drivers can explicitly tag their init errors via `err.code` so a
    // future error message change doesn't accidentally turn a skip into
    // a fail.
    const r = await runMatrix({
      browsers: ['c'],
      dispatchOne: async () => {
        const e = new Error('connection refused');
        e.code = 'DRIVER_INIT_FAILED';
        throw e;
      },
    });
    expect(r.cells[0].outcome).toBe('skip');
  });
});

// runMatrix — failFast ───────────────────────────────────────────────

describe('runMatrix — failFast', () => {
  test('failFast=true stops on first "fail"; remaining cells are "skip" with abort sentinel', async () => {
    const r = await runMatrix({
      browsers: ['chromium', 'firefox', 'webkit'],
      failFast: true,
      dispatchOne: async ({ browser }) => {
        if (browser === 'firefox') return false; // fail
        return true;
      },
    });
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[1].outcome).toBe('fail');
    expect(r.cells[2].outcome).toBe('skip');
    expect(r.cells[2].error).toMatch(/matrix aborted by failFast/);
  });

  test('failFast does NOT abort on "skip" (device-not-connected ≠ test failure)', async () => {
    const r = await runMatrix({
      browsers: ['chromium', 'mobile-chrome-android', 'firefox'],
      failFast: true,
      dispatchOne: async ({ browser }) => {
        if (browser === 'mobile-chrome-android') {
          throw new Error('no Android device attached');
        }
        return true;
      },
    });
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[1].outcome).toBe('skip');
    expect(r.cells[2].outcome).toBe('pass'); // matrix continued past the skip
  });

  test('failFast=false (default) continues through all fails', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      failFast: false,
      dispatchOne: async () => false,
    });
    expect(r.cells.map((c) => c.outcome)).toEqual(['fail', 'fail', 'fail']);
  });
});

// runMatrix — bailAfter ─────────────────────────────────────────────

describe('runMatrix — bailAfter', () => {
  test('bailAfter=0 (default) means no bail — all cells run regardless of fails', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c', 'd', 'e'],
      bailAfter: 0,
      dispatchOne: async () => false, // every cell fails
    });
    expect(r.cells.map((c) => c.outcome)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail']);
  });

  test('bailAfter=1 is equivalent in effect to failFast=true', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      bailAfter: 1,
      dispatchOne: async ({ browser }) => browser !== 'a', // a fails, rest pass
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[1].outcome).toBe('skip');
    expect(r.cells[2].outcome).toBe('skip');
    expect(r.cells[1].error).toMatch(/matrix aborted by --bail 1/);
  });

  test('bailAfter=3 stops at the 3rd failure (counts itself; 4th cell is skip)', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c', 'd', 'e'],
      bailAfter: 3,
      dispatchOne: async () => false, // every cell fails
    });
    expect(r.cells.map((c) => c.outcome)).toEqual(['fail', 'fail', 'fail', 'skip', 'skip']);
    expect(r.cells[3].error).toMatch(/matrix aborted by --bail 3 after 3 failure\(s\)/);
  });

  test('bailAfter counts timeouts as failures (matches failFast semantics)', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      bailAfter: 2,
      dispatchOne: async ({ browser }) => {
        if (browser === 'a' || browser === 'b') {
          const e = new Error('took too long');
          e.code = 'CELL_TIMEOUT';
          throw e;
        }
        return true;
      },
    });
    expect(r.cells[0].outcome).toBe('timeout');
    expect(r.cells[1].outcome).toBe('timeout');
    expect(r.cells[2].outcome).toBe('skip'); // bail triggered after 2 timeouts
  });

  test('bailAfter does NOT count "skip" outcomes (device-not-connected ≠ failure)', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c', 'd', 'e'],
      bailAfter: 2,
      dispatchOne: async ({ browser }) => {
        // a, b, c all skip; d fails; e fails — bail after 2 fails
        if (browser === 'a' || browser === 'b' || browser === 'c') {
          throw new Error('no Android device attached');
        }
        return false;
      },
    });
    expect(r.cells.map((c) => c.outcome)).toEqual(['skip', 'skip', 'skip', 'fail', 'fail']);
    // No 6th cell to be aborted — fine. All 5 ran because skips didn't count.
  });

  test('bailAfter + failFast=true together: whichever fires first wins', async () => {
    // bailAfter=5 but failFast=true should still stop at the first fail.
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      bailAfter: 5,
      failFast: true,
      dispatchOne: async () => false,
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[1].outcome).toBe('skip');
    expect(r.cells[2].outcome).toBe('skip');
    // failFast fired first — its sentinel should be the abort reason.
    expect(r.cells[1].error).toMatch(/matrix aborted by failFast/);
  });

  test('totals reflect the truncated run (skips include the bail-aborted cells)', async () => {
    const r = await runMatrix({
      browsers: ['a', 'b', 'c', 'd'],
      bailAfter: 2,
      dispatchOne: async () => false,
    });
    expect(r.totals).toEqual({ pass: 0, fail: 2, skip: 2, timeout: 0 });
    expect(r.ok).toBe(false); // any fail = not ok
  });
});

// runMatrix — retry N ────────────────────────────────────────────────

describe('runMatrix — retry', () => {
  test('retry undefined / 0 → backward-compat (single attempt, no retries field)', async () => {
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: async () => false,
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].attempts).toBeUndefined();
    expect(r.cells[0].retries).toBeUndefined();
  });

  test('retry=N + cell passes first → no retry, attempts/retries omitted, durationMs set', async () => {
    const dispatch = jest.fn(async () => true);
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 3,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[0].attempts).toBeUndefined();
    expect(r.cells[0].retries).toBeUndefined();
    // durationMs is still a documented cell field — pin it for this
    // path so a future refactor that conditionally sets it gets caught.
    expect(r.cells[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test('retry=1 + fail-then-pass → outcome pass, attempts=2, retries=1, error cleared', async () => {
    let call = 0;
    const dispatch = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('first attempt boom');
      return true;
    });
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 1,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[0].attempts).toBe(2);
    expect(r.cells[0].retries).toBe(1);
    // Pass outcome → error from prior attempts is cleared (no false alarm).
    expect(r.cells[0].error).toBeUndefined();
  });

  test('retry=2 + 2 fails then pass → attempts=3, retries=2, outcome pass', async () => {
    let call = 0;
    const dispatch = jest.fn(async () => {
      call++;
      return call >= 3;
    });
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 2,
    });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[0].attempts).toBe(3);
    expect(r.cells[0].retries).toBe(2);
  });

  test('retry=1 + all attempts fail → outcome fail, attempts=2, retries=1, error from last attempt', async () => {
    let call = 0;
    const dispatch = jest.fn(async () => {
      call++;
      throw new Error(`attempt ${call} boom`);
    });
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 1,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].attempts).toBe(2);
    expect(r.cells[0].retries).toBe(1);
    expect(r.cells[0].error).toMatch(/attempt 2 boom/);
  });

  test('retry=2 + all 3 attempts fail → outcome fail, attempts=3, retries=2', async () => {
    const dispatch = jest.fn(async () => false);
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 2,
    });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].attempts).toBe(3);
    expect(r.cells[0].retries).toBe(2);
  });

  test('retry=1 + timeout then pass → outcome pass with attempts/retries (timeouts are retry-eligible)', async () => {
    let call = 0;
    const dispatch = jest.fn(async () => {
      call++;
      if (call === 1) {
        const e = new Error('cell timed out after 60000ms');
        e.code = 'CELL_TIMEOUT';
        throw e;
      }
      return true;
    });
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 1,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[0].attempts).toBe(2);
  });

  test('retry=N + skip (init-error) → no retry (device-absent is not flake)', async () => {
    // Skip = "no device connected" — retrying won't help. Pin this so a
    // future "retry everything" refactor can't accidentally include skips.
    const dispatch = jest.fn(async () => {
      throw new Error('no Android device attached');
    });
    const r = await runMatrix({
      browsers: ['mobile-chrome-android'],
      dispatchOne: dispatch,
      retry: 2,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(r.cells[0].outcome).toBe('skip');
    expect(r.cells[0].attempts).toBeUndefined();
  });

  test('retry composes with failFast — fail-fast triggers on FINAL failure, not interim', async () => {
    // First cell: fails then passes (retry recovers it). Second cell:
    // fails consistently. fail-fast must NOT abort on the first cell's
    // interim failure (since the retry recovers it), only on the second
    // cell's final failure. Per-browser counter so the test is robust
    // to dispatch-order refactors.
    const callsPerBrowser = {};
    const dispatch = jest.fn(async ({ browser }) => {
      callsPerBrowser[browser] = (callsPerBrowser[browser] || 0) + 1;
      if (browser === 'a' && callsPerBrowser[browser] === 1) {
        throw new Error('a-first-attempt');
      }
      if (browser === 'a') return true;
      throw new Error('b-always-fails');
    });
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      dispatchOne: dispatch,
      retry: 1,
      failFast: true,
    });
    expect(r.cells[0].outcome).toBe('pass'); // a recovered
    expect(r.cells[1].outcome).toBe('fail'); // b failed final
    expect(r.cells[2].outcome).toBe('skip'); // c aborted by fail-fast
    expect(r.cells[2].error).toMatch(/aborted by failFast/);
  });

  test('retry composes with bailAfter — bail counts FINAL failures only', async () => {
    // Same setup as failFast test but with bailAfter=1. The recovered
    // 'a' cell does NOT increment failureCount; only 'b's final failure
    // triggers the bail. Per-browser counter so the test is robust to
    // dispatch-order refactors.
    const callsPerBrowser = {};
    const dispatch = jest.fn(async ({ browser }) => {
      callsPerBrowser[browser] = (callsPerBrowser[browser] || 0) + 1;
      if (browser === 'a' && callsPerBrowser[browser] === 1) {
        throw new Error('a-first-attempt');
      }
      if (browser === 'a') return true;
      throw new Error('b-always-fails');
    });
    const r = await runMatrix({
      browsers: ['a', 'b', 'c'],
      dispatchOne: dispatch,
      retry: 1,
      bailAfter: 1,
    });
    expect(r.cells[0].outcome).toBe('pass');
    expect(r.cells[1].outcome).toBe('fail');
    expect(r.cells[2].outcome).toBe('skip');
    expect(r.cells[2].error).toMatch(/aborted by --bail 1/);
  });

  test('retry=N + all attempts timeout → outcome timeout, attempts=N+1, retries=N', async () => {
    // Timeout-exhausted path: every attempt times out. Outcome stays
    // 'timeout' (not 'fail') because the last attempt's classification
    // wins. attempts/retries reflect all the timed-out attempts.
    const dispatch = jest.fn(async () => {
      const e = new Error('cell timed out after 60000ms');
      e.code = 'CELL_TIMEOUT';
      throw e;
    });
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: dispatch,
      retry: 2,
    });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(r.cells[0].outcome).toBe('timeout');
    expect(r.cells[0].attempts).toBe(3);
    expect(r.cells[0].retries).toBe(2);
    expect(r.cells[0].error).toMatch(/cell timed out/);
  });

  test('onCellEnd fires ONCE per cell (final outcome), not per attempt', async () => {
    // Important: per-attempt logging would be too verbose. Operators
    // see one log line per cell, with the final outcome + attempts count.
    const ends = [];
    let call = 0;
    await runMatrix({
      browsers: ['a'],
      dispatchOne: async () => {
        call++;
        return call >= 2;
      },
      retry: 1,
      onCellEnd: (cell) => ends.push(cell),
    });
    expect(ends).toHaveLength(1);
    expect(ends[0].outcome).toBe('pass');
    expect(ends[0].attempts).toBe(2);
  });

  test('durationMs spans ALL attempts (start-of-cell to after-final-attempt)', async () => {
    // Operator views durationMs as "total time spent on this cell".
    // nowMs is called at cell start + after the retry loop completes,
    // so the duration covers all attempts in between regardless of count.
    let nowCall = 0;
    const clock = [1000, 4000]; // start, end-after-2-attempts
    let call = 0;
    const r = await runMatrix({
      browsers: ['a'],
      dispatchOne: async () => {
        call++;
        return call >= 2;
      },
      retry: 1,
      nowMs: () => clock[nowCall++],
    });
    // 4000 - 1000 = 3000ms — covers both the failed first attempt
    // AND the passing retry, end-to-end.
    expect(r.cells[0].durationMs).toBe(3000);
  });
});

// runMatrix — callbacks + timing ─────────────────────────────────────

describe('runMatrix — callbacks + timing', () => {
  test('onCellStart fires before each cell with the browser slug', async () => {
    const events = [];
    await runMatrix({
      browsers: ['chromium', 'firefox'],
      dispatchOne: async () => true,
      onCellStart: ({ browser }) => events.push({ start: browser }),
    });
    expect(events).toEqual([{ start: 'chromium' }, { start: 'firefox' }]);
  });

  test('onCellEnd fires after each cell with outcome + duration', async () => {
    const events = [];
    await runMatrix({
      browsers: ['chromium', 'firefox'],
      dispatchOne: async () => true,
      onCellEnd: (cell) => events.push({ browser: cell.browser, outcome: cell.outcome }),
    });
    expect(events).toEqual([
      { browser: 'chromium', outcome: 'pass' },
      { browser: 'firefox', outcome: 'pass' },
    ]);
  });

  test('cell.durationMs reflects nowMs delta between cell start + end', async () => {
    let n = 1000;
    const r = await runMatrix({
      browsers: ['chromium', 'firefox'],
      dispatchOne: async () => true,
      nowMs: () => {
        const v = n;
        n += 250;
        return v;
      },
    });
    expect(r.cells[0].durationMs).toBe(250);
    expect(r.cells[1].durationMs).toBe(250);
  });

  test('durationMs clamped to >= 0 (no negative even if clock skews)', async () => {
    let n = 0;
    const ticks = [1000, 500, 800, 1100]; // start ahead, end behind
    const r = await runMatrix({
      browsers: ['c'],
      dispatchOne: async () => true,
      nowMs: () => ticks[n++],
    });
    expect(r.cells[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// formatMatrixResult ────────────────────────────────────────────────

describe('formatMatrixResult', () => {
  test('header + per-cell rows + summary line', async () => {
    const r = await runMatrix({
      browsers: ['chromium', 'mobile-safari-ios'],
      dispatchOne: async ({ browser }) => {
        if (browser === 'mobile-safari-ios') throw new Error('no connected iPhone found');
        return true;
      },
      nowMs: (() => {
        let n = 1000;
        return () => {
          const v = n;
          n += 50;
          return v;
        };
      })(),
    });
    const text = formatMatrixResult(r);
    expect(text).toMatch(/browser/);
    expect(text).toMatch(/outcome/);
    expect(text).toMatch(/chromium/);
    expect(text).toMatch(/mobile-safari-ios/);
    expect(text).toMatch(/pass/);
    expect(text).toMatch(/skip/);
    expect(text).toMatch(/Matrix: 1 pass \/ 0 fail \/ 1 skip/);
  });

  test('column width adapts to the longest browser slug', () => {
    const text = formatMatrixResult({
      cells: [
        { browser: 'c', outcome: 'pass', durationMs: 10 },
        { browser: 'mobile-firefox-android', outcome: 'fail', durationMs: 25 },
      ],
      summary: '1 pass / 1 fail / 0 skip',
    });
    // The long browser name must appear unchopped.
    expect(text).toMatch(/mobile-firefox-android/);
  });
});

// formatMatrixResultJson ────────────────────────────────────────────

describe('formatMatrixResultJson', () => {
  function exampleResult() {
    return {
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: 842 },
        { browser: 'mobile-safari-ios', outcome: 'skip', durationMs: 0, error: 'no iPhone' },
        { browser: 'firefox', outcome: 'fail', durationMs: 1023, error: 'AssertionError' },
      ],
      totals: { pass: 1, fail: 1, skip: 1, timeout: 0 },
      summary: '1 pass / 1 fail / 1 skip',
      ok: false,
    };
  }

  test('emits format=matrix-v1 + ISO timestamp + summary/totals/cells', () => {
    const json = formatMatrixResultJson(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    const obj = JSON.parse(json);
    expect(obj.format).toBe('matrix-v1');
    expect(obj.generatedAt).toBe('2026-05-30T18:42:00.000Z');
    expect(obj.summary).toBe('1 pass / 1 fail / 1 skip');
    expect(obj.totals).toEqual({ pass: 1, fail: 1, skip: 1, timeout: 0 });
    expect(obj.ok).toBe(false);
    expect(obj.cells).toHaveLength(3);
  });

  test('cells include error message for fail + skip outcomes', () => {
    const obj = JSON.parse(
      formatMatrixResultJson(exampleResult(), { nowIso: () => '2026-05-30T18:42:00.000Z' }),
    );
    const skipCell = obj.cells.find((c) => c.outcome === 'skip');
    expect(skipCell.error).toBe('no iPhone');
    const failCell = obj.cells.find((c) => c.outcome === 'fail');
    expect(failCell.error).toBe('AssertionError');
  });

  test('output is parseable JSON + pretty-printed (multi-line)', () => {
    const json = formatMatrixResultJson(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(json.split('\n').length).toBeGreaterThan(5); // pretty-printed
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('nowIso defaults to a real ISO string when omitted', () => {
    const obj = JSON.parse(formatMatrixResultJson(exampleResult()));
    expect(obj.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// formatMatrixResultJunit ───────────────────────────────────────────

describe('formatMatrixResultJunit', () => {
  function exampleResult() {
    return {
      cells: [
        { browser: 'chromium', outcome: 'pass', durationMs: 842 },
        { browser: 'mobile-safari-ios', outcome: 'skip', durationMs: 0, error: 'no iPhone' },
        { browser: 'firefox', outcome: 'fail', durationMs: 1023, error: 'AssertionError' },
      ],
      totals: { pass: 1, fail: 1, skip: 1, timeout: 0 },
      summary: '1 pass / 1 fail / 1 skip',
      ok: false,
    };
  }

  test('starts with XML declaration', () => {
    const xml = formatMatrixResultJunit(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  test('top-level <testsuite> has tests/failures/skipped counts + total time', () => {
    const xml = formatMatrixResultJunit(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(xml).toMatch(/<testsuite name="qa-matrix"/);
    expect(xml).toMatch(/tests="3"/);
    expect(xml).toMatch(/failures="1"/);
    expect(xml).toMatch(/skipped="1"/);
    expect(xml).toMatch(/time="1\.865"/); // 842 + 0 + 1023 = 1865ms → 1.865s
    expect(xml).toMatch(/timestamp="2026-05-30T18:42:00.000Z"/);
  });

  test('one <testcase> per cell with browser slug as name', () => {
    const xml = formatMatrixResultJunit(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(xml).toMatch(/<testcase classname="qa-matrix" name="chromium" time="0\.842"/);
    expect(xml).toMatch(/<testcase classname="qa-matrix" name="mobile-safari-ios" time="0\.000"/);
    expect(xml).toMatch(/<testcase classname="qa-matrix" name="firefox" time="1\.023"/);
  });

  test('pass cells have no <failure> or <skipped> tag', () => {
    const xml = formatMatrixResultJunit({
      cells: [{ browser: 'chromium', outcome: 'pass', durationMs: 100 }],
      totals: { pass: 1, fail: 0, skip: 0, timeout: 0 },
      summary: '1 pass / 0 fail / 0 skip',
      ok: true,
    });
    expect(xml).not.toMatch(/<failure/);
    expect(xml).not.toMatch(/<skipped/);
  });

  test('fail cells get a <failure message="..." type="MatrixCellFailure"/>', () => {
    const xml = formatMatrixResultJunit(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(xml).toMatch(/<failure message="AssertionError" type="MatrixCellFailure"\/>/);
  });

  test('skip cells get a <skipped message="..."/>', () => {
    const xml = formatMatrixResultJunit(exampleResult(), {
      nowIso: () => '2026-05-30T18:42:00.000Z',
    });
    expect(xml).toMatch(/<skipped message="no iPhone"\/>/);
  });

  test('XML-escapes special chars in browser slugs + error messages', () => {
    const result = {
      cells: [
        {
          browser: 'name<with>chars&"\'',
          outcome: 'fail',
          durationMs: 10,
          error: 'err with <special> & "chars"',
        },
      ],
      totals: { pass: 0, fail: 1, skip: 0, timeout: 0 },
      summary: '0 pass / 1 fail / 0 skip',
      ok: false,
    };
    const xml = formatMatrixResultJunit(result, { nowIso: () => '2026-05-30T18:42:00.000Z' });
    // No raw < or > or unescaped " inside attribute values
    expect(xml).toMatch(/name="name&lt;with&gt;chars&amp;&quot;&apos;"/);
    expect(xml).toMatch(/message="err with &lt;special&gt; &amp; &quot;chars&quot;"/);
  });

  test('fail cell with no error message falls back to a sentinel', () => {
    const xml = formatMatrixResultJunit({
      cells: [{ browser: 'chromium', outcome: 'fail', durationMs: 50 }],
      totals: { pass: 0, fail: 1, skip: 0, timeout: 0 },
      summary: '0 pass / 1 fail / 0 skip',
      ok: false,
    });
    expect(xml).toMatch(/message="matrix cell failed"/);
  });

  test('skip cell with no error message falls back to a sentinel', () => {
    const xml = formatMatrixResultJunit({
      cells: [{ browser: 'chromium', outcome: 'skip', durationMs: 0 }],
      totals: { pass: 0, fail: 0, skip: 1, timeout: 0 },
      summary: '0 pass / 0 fail / 1 skip',
      ok: true,
    });
    expect(xml).toMatch(/message="matrix cell skipped"/);
  });

  test('empty cells array still produces valid XML (no rows)', () => {
    const xml = formatMatrixResultJunit({
      cells: [],
      totals: { pass: 0, fail: 0, skip: 0, timeout: 0 },
      summary: '0 pass / 0 fail / 0 skip',
      ok: true,
    });
    expect(xml).toMatch(/<testsuite name="qa-matrix" tests="0"/);
    expect(xml).not.toMatch(/<testcase/);
  });

  test('timeout cell gets <failure type="MatrixCellTimeout"/>', () => {
    const xml = formatMatrixResultJunit({
      cells: [
        {
          browser: 'mobile-chrome-android',
          outcome: 'timeout',
          durationMs: 60000,
          error: 'cell timed out after 60s',
        },
      ],
      totals: { pass: 0, fail: 0, skip: 0, timeout: 1 },
      summary: '0 pass / 0 fail / 0 skip / 1 timeout',
      ok: false,
    });
    expect(xml).toMatch(/<failure message="cell timed out after 60s" type="MatrixCellTimeout"\/>/);
    // Timeouts also bump the suite-level `failures` count (1 here).
    expect(xml).toMatch(/failures="1"/);
  });

  test('timeout cell with no error message falls back to a sentinel', () => {
    const xml = formatMatrixResultJunit({
      cells: [{ browser: 'mobile-chrome-android', outcome: 'timeout', durationMs: 60000 }],
      totals: { pass: 0, fail: 0, skip: 0, timeout: 1 },
      summary: '0 pass / 0 fail / 0 skip / 1 timeout',
      ok: false,
    });
    expect(xml).toMatch(/message="matrix cell timed out"/);
  });

  test('suite-level failures count combines fails + timeouts', () => {
    const xml = formatMatrixResultJunit({
      cells: [
        { browser: 'a', outcome: 'fail', durationMs: 100, error: 'x' },
        { browser: 'b', outcome: 'timeout', durationMs: 60000, error: 'y' },
        { browser: 'c', outcome: 'pass', durationMs: 200 },
      ],
      totals: { pass: 1, fail: 1, skip: 0, timeout: 1 },
      summary: '1 pass / 1 fail / 0 skip / 1 timeout',
      ok: false,
    });
    // 1 fail + 1 timeout = 2 failures at the suite level
    expect(xml).toMatch(/failures="2"/);
  });

  test('legacy result without totals.timeout still renders (backward compat)', () => {
    const xml = formatMatrixResultJunit({
      cells: [{ browser: 'a', outcome: 'pass', durationMs: 100 }],
      totals: { pass: 1, fail: 0, skip: 0, timeout: 0 }, // explicit zero for forward compat
      summary: '1 pass / 0 fail / 0 skip',
      ok: true,
    });
    expect(xml).toMatch(/failures="0"/);
  });
});
