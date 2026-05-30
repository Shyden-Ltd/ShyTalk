/**
 * driver-health-check.test.js
 *
 * Tests the diagnostic `runHealthCheck` helper used by the runner's
 * `--check-drivers` flag.
 *
 * Coverage areas:
 *   - Input validation (browsers not array, empty, factories missing)
 *   - Per-cell outcome classification:
 *     - factory returns driver → 'ok' + close() called
 *     - factory throws init-error → 'skip' with message captured
 *     - factory throws other error → 'fail' with message captured
 *     - missing factory for slug → 'fail' with "no factory registered"
 *   - close() error swallowed (doesn't downgrade 'ok' to 'fail')
 *   - baseURL forwarded to factories
 *   - onCellStart / onCellEnd callbacks
 *   - durationMs from injected nowMs
 *   - totals + summary string shape ("ok" prefix, not "pass")
 *   - ok flag (false iff any fail)
 *   - formatHealthCheckResult shape: header + row + summary line
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const { runHealthCheck, formatHealthCheckResult } = require(
  path.join(REPO_ROOT, 'express-api/scripts/driver-health-check'),
);

function makeFactoryReturning(driver) {
  return jest.fn(async () => driver);
}

function makeFactoryThrowing(err) {
  return jest.fn(async () => {
    throw err;
  });
}

function makeFakeDriver({ closeImpl = jest.fn() } = {}) {
  return { close: closeImpl };
}

// runHealthCheck — input validation ────────────────────────────────

describe('runHealthCheck — input validation', () => {
  test('throws when browsers is not an array', async () => {
    await expect(runHealthCheck({ browsers: 'chromium', factories: {} })).rejects.toThrow(
      /browsers.*must be an array/,
    );
  });

  test('throws when browsers is empty', async () => {
    await expect(runHealthCheck({ browsers: [], factories: {} })).rejects.toThrow(
      /browsers.*is empty/,
    );
  });

  test('throws when factories is missing', async () => {
    await expect(runHealthCheck({ browsers: ['chromium'] })).rejects.toThrow(
      /factories.*must be an object/,
    );
  });

  test('throws when factories is not an object', async () => {
    await expect(runHealthCheck({ browsers: ['chromium'], factories: 'oops' })).rejects.toThrow(
      /factories.*must be an object/,
    );
  });
});

// Per-cell outcome classification ──────────────────────────────────

describe('runHealthCheck — per-cell outcomes', () => {
  test('factory returning a driver → outcome="ok" + close() called', async () => {
    const closeImpl = jest.fn();
    const driver = makeFakeDriver({ closeImpl });
    const factory = makeFactoryReturning(driver);
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('ok');
    expect(closeImpl).toHaveBeenCalledTimes(1);
  });

  test('factory throwing init-error → outcome="skip" with message captured', async () => {
    const factory = makeFactoryThrowing(new Error('no Android device attached'));
    const r = await runHealthCheck({
      browsers: ['mobile-chrome-android'],
      factories: { 'mobile-chrome-android': factory },
    });
    expect(r.cells[0].outcome).toBe('skip');
    expect(r.cells[0].error).toMatch(/no Android device/);
  });

  test('factory throwing non-init Error → outcome="fail"', async () => {
    const factory = makeFactoryThrowing(new Error('TypeError: not a function'));
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].error).toMatch(/TypeError/);
  });

  test('factory throw with err.code=DRIVER_INIT_FAILED forces "skip"', async () => {
    const err = new Error('connection refused');
    err.code = 'DRIVER_INIT_FAILED';
    const factory = makeFactoryThrowing(err);
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('skip');
  });

  test('missing factory for slug → outcome="fail" with actionable message', async () => {
    const r = await runHealthCheck({
      browsers: ['mobile-unknown'],
      factories: {},
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].error).toMatch(/no factory registered/);
  });

  test('factory returning null → close skipped (no crash)', async () => {
    const factory = jest.fn(async () => null);
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('ok');
  });

  test('driver.close throwing does NOT downgrade outcome from "ok" to "fail"', async () => {
    const driver = makeFakeDriver({
      closeImpl: jest.fn(() => {
        throw new Error('close failed');
      }),
    });
    const factory = makeFactoryReturning(driver);
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('ok');
  });

  test('driver without a close method is tolerated', async () => {
    const factory = jest.fn(async () => ({
      /* no close */
    }));
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('ok');
  });
});

// Multi-cell + aggregation ─────────────────────────────────────────

describe('runHealthCheck — multi-cell aggregation', () => {
  test('mixed ok/skip/fail totals + summary string', async () => {
    const r = await runHealthCheck({
      browsers: ['chromium', 'mobile-chrome-android', 'unknown'],
      factories: {
        chromium: makeFactoryReturning(makeFakeDriver()),
        'mobile-chrome-android': makeFactoryThrowing(new Error('no Android device attached')),
      },
    });
    expect(r.totals).toEqual({ ok: 1, fail: 1, skip: 1 });
    expect(r.summary).toBe('1 ok / 1 fail / 1 skip');
    expect(r.ok).toBe(false);
  });

  test('all-ok matrix: ok=true', async () => {
    const r = await runHealthCheck({
      browsers: ['chromium', 'firefox'],
      factories: {
        chromium: makeFactoryReturning(makeFakeDriver()),
        firefox: makeFactoryReturning(makeFakeDriver()),
      },
    });
    expect(r.totals).toEqual({ ok: 2, fail: 0, skip: 0 });
    expect(r.ok).toBe(true);
  });

  test('skip outcomes do NOT make ok=false', async () => {
    const r = await runHealthCheck({
      browsers: ['mobile-chrome-android', 'mobile-safari-ios'],
      factories: {
        'mobile-chrome-android': makeFactoryThrowing(new Error('no Android device attached')),
        'mobile-safari-ios': makeFactoryThrowing(new Error('no connected iPhone found')),
      },
    });
    expect(r.totals.skip).toBe(2);
    expect(r.totals.fail).toBe(0);
    expect(r.ok).toBe(true);
  });

  test('cell order is preserved', async () => {
    const browsers = ['firefox', 'chromium', 'webkit'];
    const factories = Object.fromEntries(
      browsers.map((b) => [b, makeFactoryReturning(makeFakeDriver())]),
    );
    const r = await runHealthCheck({ browsers, factories });
    expect(r.cells.map((c) => c.browser)).toEqual(browsers);
  });
});

// baseURL + callbacks ─────────────────────────────────────────────

describe('runHealthCheck — baseURL + callbacks', () => {
  test('factories are invoked with the supplied baseURL', async () => {
    const factory = jest.fn(async () => makeFakeDriver());
    await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
      baseURL: 'http://localhost:9999',
    });
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://localhost:9999' }),
    );
  });

  test('baseURL defaults to localhost:8888 when omitted', async () => {
    const factory = jest.fn(async () => makeFakeDriver());
    await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(factory).toHaveBeenCalledWith({ baseURL: 'http://localhost:8888' });
  });

  test('onCellStart fires per cell with browser slug', async () => {
    const events = [];
    await runHealthCheck({
      browsers: ['chromium', 'firefox'],
      factories: {
        chromium: makeFactoryReturning(makeFakeDriver()),
        firefox: makeFactoryReturning(makeFakeDriver()),
      },
      onCellStart: ({ browser }) => events.push(browser),
    });
    expect(events).toEqual(['chromium', 'firefox']);
  });

  test('onCellEnd fires per cell with outcome', async () => {
    const events = [];
    await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(makeFakeDriver()) },
      onCellEnd: (cell) => events.push(cell.outcome),
    });
    expect(events).toEqual(['ok']);
  });
});

// Timing ─────────────────────────────────────────────────────────

describe('runHealthCheck — timing', () => {
  test('durationMs from injected nowMs delta', async () => {
    let n = 1000;
    const r = await runHealthCheck({
      browsers: ['chromium', 'firefox'],
      factories: {
        chromium: makeFactoryReturning(makeFakeDriver()),
        firefox: makeFactoryReturning(makeFakeDriver()),
      },
      nowMs: () => {
        const v = n;
        n += 200;
        return v;
      },
    });
    expect(r.cells[0].durationMs).toBe(200);
    expect(r.cells[1].durationMs).toBe(200);
  });

  test('durationMs clamped to >= 0 (no negative even if clock skews)', async () => {
    let n = 0;
    const ticks = [1000, 500, 800, 1100];
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(makeFakeDriver()) },
      nowMs: () => ticks[n++],
    });
    expect(r.cells[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// formatHealthCheckResult ─────────────────────────────────────────

describe('formatHealthCheckResult', () => {
  test('header + per-cell rows + summary line with "Health:" prefix', async () => {
    const r = await runHealthCheck({
      browsers: ['chromium', 'mobile-safari-ios'],
      factories: {
        chromium: makeFactoryReturning(makeFakeDriver()),
        'mobile-safari-ios': makeFactoryThrowing(new Error('no connected iPhone found')),
      },
    });
    const text = formatHealthCheckResult(r);
    expect(text).toMatch(/browser/);
    expect(text).toMatch(/outcome/);
    expect(text).toMatch(/chromium/);
    expect(text).toMatch(/mobile-safari-ios/);
    expect(text).toMatch(/ok/);
    expect(text).toMatch(/skip/);
    expect(text).toMatch(/Health: 1 ok \/ 0 fail \/ 1 skip/);
  });

  test('column width adapts to longest slug', () => {
    const text = formatHealthCheckResult({
      cells: [
        { browser: 'c', outcome: 'ok', durationMs: 10 },
        { browser: 'mobile-firefox-android', outcome: 'fail', durationMs: 25 },
      ],
      summary: '1 ok / 1 fail / 0 skip',
    });
    expect(text).toMatch(/mobile-firefox-android/);
  });
});
