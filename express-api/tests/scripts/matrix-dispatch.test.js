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
const { INIT_ERROR_SIGNATURES, isInitError, runMatrix, formatMatrixResult } = require(
  path.join(REPO_ROOT, 'express-api/scripts/matrix-dispatch'),
);

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
    expect(r.totals).toEqual({ pass: 3, fail: 0, skip: 0 });
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
    expect(r.totals).toEqual({ pass: 1, fail: 1, skip: 1 });
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
