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

  test('factory throwing init-error → outcome="skip" with message captured + bootstrapMs recorded', async () => {
    // bootstrapMs is recorded even on skip-classified throws — the
    // factory ran (and threw), so its duration is meaningful. The
    // operator distinguishes "skipped immediately" from "skipped
    // after a slow timeout" via this field.
    const factory = makeFactoryThrowing(new Error('no Android device attached'));
    const r = await runHealthCheck({
      browsers: ['mobile-chrome-android'],
      factories: { 'mobile-chrome-android': factory },
    });
    expect(r.cells[0].outcome).toBe('skip');
    expect(r.cells[0].error).toMatch(/no Android device/);
    expect(typeof r.cells[0].bootstrapMs).toBe('number');
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

  test('missing factory for slug → outcome="fail" + all phase fields undefined', async () => {
    // No factory means no phase ran — bootstrap/smoke/close fields
    // must ALL be undefined (not 0 — a 0 would falsely imply the
    // phase ran instantly). Symmetric to other "phase didn't run"
    // pins above.
    const r = await runHealthCheck({
      browsers: ['mobile-unknown'],
      factories: {},
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].error).toMatch(/no factory registered/);
    expect(r.cells[0].bootstrapMs).toBeUndefined();
    expect(r.cells[0].smokeMs).toBeUndefined();
    expect(r.cells[0].closeMs).toBeUndefined();
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

  test('driver without a close method is tolerated + closeMs undefined', async () => {
    // No close method → close phase doesn't run → closeMs is
    // undefined (not 0). Symmetric to other "phase didn't run" pins.
    const factory = jest.fn(async () => ({
      /* no close */
    }));
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
    });
    expect(r.cells[0].outcome).toBe('ok');
    expect(r.cells[0].closeMs).toBeUndefined();
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
    // Phase timing (gap C5) added 4 additional nowMs() calls per cell
    // (no smoke):
    //   Before: t0 + final = 2 calls.
    //   After:  t0 + tBoot + bootstrapEnd + tClose + closeEnd + final
    //           = 6 calls.
    // With +200 per call, each cell spans 6*200 = 1200ms wall time;
    // durationMs = (6-1)*200 = 1000ms (final - t0).
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
    expect(r.cells[0].durationMs).toBe(1000);
    expect(r.cells[1].durationMs).toBe(1000);
  });

  test('durationMs clamped to >= 0 (no negative even if clock skews)', async () => {
    // 6 ticks per cell (phase timing): t0, tBoot, bootEnd, tClose,
    // closeEnd, final. Use deliberately-bad clock to force a negative
    // delta on final-t0 and assert clamp.
    let n = 0;
    const ticks = [1000, 500, 800, 1100, 900, 700]; // final < t0
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

  test('label option swaps "Health:" prefix to caller-supplied value', () => {
    // --smoke uses label="Smoke" so output reads "Smoke: 1 ok / ..."
    // — matches operator mental model. Default stays "Health" for
    // backward compat with --check-drivers.
    const text = formatHealthCheckResult(
      { cells: [], summary: '0 ok / 0 fail / 0 skip' },
      { label: 'Smoke' },
    );
    expect(text).toMatch(/Smoke: 0 ok/);
    expect(text).not.toMatch(/Health:/);
  });

  test('omitted label option defaults to "Health"', () => {
    const text = formatHealthCheckResult({
      cells: [],
      summary: '0 ok / 0 fail / 0 skip',
    });
    expect(text).toMatch(/Health: 0 ok/);
  });
});

// runHealthCheck — smoke method ────────────────────────────────────

describe('runHealthCheck — smokeMethod', () => {
  test('smokeMethod undefined → no smoke call (backward compat with --check-drivers)', async () => {
    // Driver has webUiDump but caller didn't request smoke; verify the
    // method is NOT called.
    const webUiDump = jest.fn(async () => 'dump');
    const driver = makeFakeDriver();
    driver.webUiDump = webUiDump;
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
    });
    expect(webUiDump).not.toHaveBeenCalled();
    expect(r.cells[0].outcome).toBe('ok');
  });

  test('smokeMethod present + driver implements it → outcome ok, method called', async () => {
    const webUiDump = jest.fn(async () => 'dump');
    const driver = makeFakeDriver();
    driver.webUiDump = webUiDump;
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
    });
    expect(webUiDump).toHaveBeenCalledTimes(1);
    expect(r.cells[0].outcome).toBe('ok');
  });

  test('smokeMethod throws → outcome fail with actionable smoke prefix + result.ok=false', async () => {
    // Pins the runner exit-code contract: smoke-fail → ok=false →
    // runner exits 1. The runner-side `process.exit(result.ok ? 0 : 1)`
    // is trivial mapping; pinning result.ok here pins the chain.
    const driver = makeFakeDriver();
    driver.webUiDump = jest.fn(async () => {
      throw new Error('page navigation timed out');
    });
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].error).toMatch(/smoke method "webUiDump" failed/);
    expect(r.cells[0].error).toMatch(/page navigation timed out/);
    expect(r.ok).toBe(false);
  });

  test('smokeMethod missing on driver → outcome fail with "not implemented" + smokeMs undefined', async () => {
    // Native drivers (android-adb, ios-*) don't implement webUiDump.
    // If operator runs --smoke against such a cell, we must fail
    // clearly rather than silently pass. Phase-field pin: smokeMs
    // is UNDEFINED (not 0) on the not-implemented path — the smoke
    // method was never called, so its timing is absent, not zero.
    const driver = makeFakeDriver(); // no webUiDump
    const r = await runHealthCheck({
      browsers: ['some-native-cell'],
      factories: { 'some-native-cell': makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(r.cells[0].error).toMatch(/smoke method "webUiDump" not implemented/);
    expect(r.cells[0].smokeMs).toBeUndefined();
  });

  test('bootstrap fails (non-init error) + smokeMethod set → outcome fail, smoke NOT called', async () => {
    const webUiDump = jest.fn();
    const factory = jest.fn(async () => {
      throw new Error('runtime error during init');
    });
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: factory },
      smokeMethod: 'webUiDump',
    });
    expect(webUiDump).not.toHaveBeenCalled();
    expect(r.cells[0].outcome).toBe('fail');
  });

  test('bootstrap fails (init error, no device) + smokeMethod set → outcome skip, smoke NOT called', async () => {
    // The skip-then-no-smoke path: bootstrap throws with an init-error
    // signature that isInitError() classifies as skip-worthy. Smoke
    // must NOT be called (no driver to call it on), and outcome must
    // be 'skip' (operator action: connect a device — not "driver
    // broken"). Pin both invariants here.
    const webUiDump = jest.fn();
    const factory = jest.fn(async () => {
      // "no Android device attached" matches the isInitError pattern
      // for init-time device-absent failures (see matrix-dispatch.js).
      throw new Error('no Android device attached');
    });
    const r = await runHealthCheck({
      browsers: ['mobile-chrome-android'],
      factories: { 'mobile-chrome-android': factory },
      smokeMethod: 'webUiDump',
    });
    expect(webUiDump).not.toHaveBeenCalled();
    expect(r.cells[0].outcome).toBe('skip');
    expect(r.cells[0].error).toMatch(/no Android device attached/);
  });

  test('close error after successful smoke does NOT downgrade outcome', async () => {
    const driver = makeFakeDriver({
      closeImpl: jest.fn(async () => {
        throw new Error('close timeout');
      }),
    });
    driver.webUiDump = jest.fn(async () => 'dump');
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
    });
    // smoke succeeded; close failed but swallowed.
    expect(r.cells[0].outcome).toBe('ok');
  });

  test('smokeMethod with multi-cell — independent per-cell results', async () => {
    const goodDriver = makeFakeDriver();
    goodDriver.webUiDump = jest.fn(async () => 'ok');
    const brokenDriver = makeFakeDriver();
    brokenDriver.webUiDump = jest.fn(async () => {
      throw new Error('runtime broken');
    });
    const r = await runHealthCheck({
      browsers: ['chromium', 'firefox'],
      factories: {
        chromium: makeFactoryReturning(goodDriver),
        firefox: makeFactoryReturning(brokenDriver),
      },
      smokeMethod: 'webUiDump',
    });
    expect(r.cells[0].outcome).toBe('ok');
    expect(r.cells[1].outcome).toBe('fail');
    expect(r.totals).toEqual({ ok: 1, fail: 1, skip: 0 });
  });
});

// runHealthCheck — per-cell phase timing breakdown ──────────────────

describe('runHealthCheck — phase timing breakdown (gap C5)', () => {
  test('bootstrapMs is set when factory succeeds', async () => {
    const driver = makeFakeDriver();
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
    });
    expect(typeof r.cells[0].bootstrapMs).toBe('number');
    expect(r.cells[0].bootstrapMs).toBeGreaterThanOrEqual(0);
  });

  test('bootstrapMs is set even when factory throws (measured before classify)', async () => {
    // Operator wants to know "how long did the failing bootstrap take?"
    // — useful for distinguishing "fails immediately" from "fails after
    // long timeout" (e.g., a flaky CDP connection). Pin the metric is
    // present on failure paths too.
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryThrowing(new Error('boom')) },
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(typeof r.cells[0].bootstrapMs).toBe('number');
    expect(r.cells[0].bootstrapMs).toBeGreaterThanOrEqual(0);
  });

  test('smokeMs is set when smoke method called successfully', async () => {
    const driver = makeFakeDriver();
    driver.webUiDump = jest.fn(async () => 'dump');
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
    });
    expect(typeof r.cells[0].smokeMs).toBe('number');
    expect(r.cells[0].smokeMs).toBeGreaterThanOrEqual(0);
  });

  test('smokeMs is set even when smoke method throws', async () => {
    const driver = makeFakeDriver();
    driver.webUiDump = jest.fn(async () => {
      throw new Error('navigation timed out');
    });
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
    });
    expect(r.cells[0].outcome).toBe('fail');
    expect(typeof r.cells[0].smokeMs).toBe('number');
  });

  test('smokeMs is undefined when smokeMethod not requested', async () => {
    // Backward compat: --check-drivers paths don't set smokeMethod;
    // smokeMs field must be omitted entirely (not set to 0).
    const driver = makeFakeDriver();
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
    });
    expect(r.cells[0].smokeMs).toBeUndefined();
  });

  test('smokeMs is undefined when bootstrap failed (smoke not called)', async () => {
    // Phase-omission invariant: if a phase didn't execute, its timing
    // field is undefined — not 0 (which would falsely imply the phase
    // ran in zero time).
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryThrowing(new Error('boom')) },
      smokeMethod: 'webUiDump',
    });
    expect(r.cells[0].smokeMs).toBeUndefined();
  });

  test('closeMs is set when close called', async () => {
    const driver = makeFakeDriver();
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
    });
    expect(typeof r.cells[0].closeMs).toBe('number');
  });

  test('closeMs is set even when close throws (swallowed)', async () => {
    const driver = makeFakeDriver({
      closeImpl: jest.fn(async () => {
        throw new Error('close error');
      }),
    });
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
    });
    // close error is swallowed; outcome stays ok; closeMs still recorded
    expect(r.cells[0].outcome).toBe('ok');
    expect(typeof r.cells[0].closeMs).toBe('number');
  });

  test('closeMs is undefined when bootstrap failed (no driver to close)', async () => {
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryThrowing(new Error('boom')) },
    });
    expect(r.cells[0].closeMs).toBeUndefined();
  });

  test('phase sum exactly equals durationMs with injected deterministic nowMs', async () => {
    // Structural invariant via injected clock — zero tolerance, no
    // flakiness from real-clock jitter. Tick sequence (smoke-method
    // path = 8 calls per cell):
    //   t0=1000, tBoot=1100 → bootstrapMs=200 (calc at 1300),
    //   tSmoke=1400 → smokeMs=300 (calc at 1700),
    //   tClose=1800 → closeMs=100 (calc at 1900),
    //   durationMs=1900-1000=900.
    // Expected: bootstrap(200) + smoke(300) + close(100) = 600,
    //   durationMs(900) - phaseSum(600) = 300 (inter-phase gaps).
    // The invariant is `durationMs >= phaseSum` (phase sum can't
    // exceed wall time), not equality, because inter-phase gaps are
    // legitimate. Pin the inequality structurally.
    let i = 0;
    const ticks = [1000, 1100, 1300, 1400, 1700, 1800, 1900, 1900];
    const driver = makeFakeDriver();
    driver.webUiDump = jest.fn(async () => 'ok');
    const r = await runHealthCheck({
      browsers: ['chromium'],
      factories: { chromium: makeFactoryReturning(driver) },
      smokeMethod: 'webUiDump',
      nowMs: () => ticks[i++],
    });
    const cell = r.cells[0];
    const phaseSum = (cell.bootstrapMs || 0) + (cell.smokeMs || 0) + (cell.closeMs || 0);
    expect(cell.durationMs).toBeGreaterThanOrEqual(phaseSum);
    // Exact values from the tick sequence above:
    expect(cell.bootstrapMs).toBe(200);
    expect(cell.smokeMs).toBe(300);
    expect(cell.closeMs).toBe(100);
    expect(cell.durationMs).toBe(900);
  });
});
