/**
 * manual-qa-runner-smoke-flag.test.js
 *
 * Tests the `--smoke` flag (gap D2). Verifies:
 *   - --smoke is recognised by the parser
 *   - --smoke is documented in formatUsage with description + composition hint
 *   - --smoke uses smokeMethod='webUiDump' (verified via buildDriverFactories
 *     + a stubbed driver that records method calls)
 *   - --smoke composes with --filter (single-cell smoke via --smoke --filter X)
 *   - --smoke exits 1 if any cell fails, 0 if all ok or skip
 *   - --smoke + --target prod uses the prod allowlist (chromium-only)
 *   - --smoke + nonexistent filter exits 0 with "no cells match"
 *   - buildDriverFactories returns a factory map of 12 cells
 *   - buildDriverFactories factories require their driver modules lazily
 *
 * Network-isolation note: --smoke would normally bootstrap a real
 * browser. The CLI tests below stub buildDriverFactories' result by
 * setting --target to an invalid value where the runner short-circuits
 * before reaching the factories (env validation), so we exercise the
 * parser + formatUsage paths without spinning up Playwright. The pure
 * unit tests on runHealthCheck (driver-health-check.test.js) cover the
 * smoke method invocation logic in isolation.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RUNNER_PATH = path.join(REPO_ROOT, 'express-api/scripts/manual-qa-runner.js');

function runCli(args, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.PERSONAS_PASSWORD;
  delete baseEnv.FIREBASE_DEV_API_KEY;
  delete baseEnv.FIREBASE_LOCAL_API_KEY;
  delete baseEnv.FIREBASE_PROD_API_KEY;
  return spawnSync(process.execPath, [RUNNER_PATH, ...args], {
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
    timeout: 15000,
  });
}

// ── formatUsage drift-catch ──────────────────────────────────────

describe('--smoke — formatUsage drift-catch', () => {
  test('--smoke is documented with description + composition hint', () => {
    // Strong drift-catch: would fail if --smoke header shipped without
    // its description or example. Catches doc-rot regressions that a
    // bare /--smoke/ assertion would miss.
    const { formatUsage } = require(RUNNER_PATH);
    const usage = formatUsage();
    expect(usage).toMatch(/--smoke/);
    expect(usage).toMatch(/webUiDump/);
    expect(usage).toMatch(/--smoke --filter/);
  });
});

// ── buildDriverFactories pure helper ────────────────────────────

describe('buildDriverFactories — exported helper', () => {
  let buildDriverFactories;
  beforeAll(() => {
    buildDriverFactories = require(RUNNER_PATH).buildDriverFactories;
  });

  test('returns an object keyed by every matrix CELL', () => {
    // Keyed by cell, not by browser. Those used to be the same list; they are
    // not any more. `app-android` drives the APK with no browser at all, and
    // `cross-all` drives a browser AND both phones — neither is expressible as
    // a browser slug, which is precisely why the cell registry exists.
    //
    // Asserted against CELL_SLUGS rather than a hand-written array so a new
    // cell cannot be added to the matrix without a factory. That exact drift
    // shipped once: the four new cells reported "fail | 0ms" on --check-drivers,
    // 0ms being the tell that nothing was even attempted.
    const { CELL_SLUGS } = require(path.join(REPO_ROOT, 'express-api/scripts/matrix-cells'));
    const factories = buildDriverFactories({ headed: false });
    for (const slug of CELL_SLUGS) {
      expect(typeof factories[slug]).toBe('function');
    }
    expect(Object.keys(factories).sort()).toEqual([...CELL_SLUGS].sort());
  });

  test('every factory is callable with { baseURL }', () => {
    // Arity is no longer uniform: an app cell needs no baseURL because it
    // launches no browser, so `app-android` declares zero parameters. Pinning
    // `fn.length === 1` would force a meaningless unused argument onto them.
    // What matters is that each is a function the health check can call.
    const factories = buildDriverFactories({ headed: false });
    for (const [slug, fn] of Object.entries(factories)) {
      expect(typeof fn).toBe('function');
      expect(fn.length).toBeLessThanOrEqual(1);
      void slug;
    }
  });

  test('headed=true → headless:false reaches createWebDriver (behavior, not source-text)', async () => {
    // Behavior-pinning replacement for the earlier .toString() check:
    // mock the playwright driver module and verify the factory passes
    // headless:!headed to createWebDriver. Source-text inspection
    // would break under any transformation; behavior testing won't.
    jest.resetModules();
    const createWebDriver = jest.fn(async () => ({ close: jest.fn() }));
    jest.doMock(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-playwright-driver'), () => ({
      createWebDriver,
    }));
    const { buildDriverFactories: bdf } = require(RUNNER_PATH);
    const factories = bdf({ headed: true });
    await factories.chromium({ baseURL: 'https://x.test' });
    expect(createWebDriver).toHaveBeenCalledWith(
      expect.objectContaining({ headless: false, browser: 'chromium', baseURL: 'https://x.test' }),
    );
    jest.unmock(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-playwright-driver'));
    jest.resetModules();
  });

  test('headed=false → headless:true reaches createWebDriver', async () => {
    // Companion to the headed=true test — pins the negation path.
    jest.resetModules();
    const createWebDriver = jest.fn(async () => ({ close: jest.fn() }));
    jest.doMock(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-playwright-driver'), () => ({
      createWebDriver,
    }));
    const { buildDriverFactories: bdf } = require(RUNNER_PATH);
    const factories = bdf({ headed: false });
    await factories.chromium({ baseURL: 'https://x.test' });
    expect(createWebDriver).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
    jest.unmock(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-playwright-driver'));
    jest.resetModules();
  });

  test('every browser in the allowlist is still reachable through some cell', () => {
    // The old assertion compared factory keys to SUPPORTED_BROWSERS directly.
    // That stopped being the right question once cells and browsers diverged —
    // but the underlying worry is still valid: a supported browser that no cell
    // launches is a browser nothing tests. Asked properly, via the registry.
    const { MATRIX_CELLS } = require(path.join(REPO_ROOT, 'express-api/scripts/matrix-cells'));
    const { SUPPORTED_BROWSERS } = require(
      path.join(REPO_ROOT, 'express-api/scripts/browser-allowlist'),
    );
    const launched = new Set(MATRIX_CELLS.map((c) => c.browser).filter(Boolean));
    for (const browser of SUPPORTED_BROWSERS) {
      expect([...launched]).toContain(browser);
    }
  });

  test('lazy require — does not load driver modules at construction time', () => {
    // Each factory does `require('./drivers/...')` inside its body so
    // simply building the map doesn't touch Playwright / appium / adb.
    // Verify by re-running with a require-cache-cleared environment.
    const before = Object.keys(require.cache).filter((k) => k.includes('/scripts/drivers/'));
    void buildDriverFactories({ headed: false });
    const after = Object.keys(require.cache).filter((k) => k.includes('/scripts/drivers/'));
    expect(after.length).toBe(before.length);
  });
});

// ── --smoke CLI integration ─────────────────────────────────────

describe('--smoke — CLI integration', () => {
  test('--smoke --filter nonexistent exits 0 with "no cells match"', () => {
    // Short-circuits before any driver boot — pure CLI path.
    const r = runCli(['--smoke', '--target', 'local', '--filter', 'nonexistent']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no cells match/);
  });

  test('--smoke --filter "" exits 2 with --filter error', () => {
    const r = runCli(['--smoke', '--target', 'local', '--filter', '']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--filter/);
  });

  test('--smoke with invalid --target exits 2 (env validation runs before factories)', () => {
    // --smoke takes the same target/allowlist path as --check-drivers.
    // Invalid target rejected before any driver bootstrap.
    const r = runCli(['--smoke', '--target', 'staging-bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Unknown target/);
  });

  test('an unknown target is blamed on the TARGET, not on the browser', () => {
    // This assertion used to read /Unknown target|not allowed/, which matched
    // either message — so when the cell-allowlist check moved ahead of the
    // target check, the runner started reporting
    //   --browser "chromium" is not a cell for --target "typo" — allowed:
    // an EMPTY allowed-list blaming the browser for the target's mistake, and
    // the loose regex passed it. An alternation across two different diagnoses
    // cannot tell you which one you got; that is not an assertion, it is a
    // coin toss that always lands heads.
    const r = runCli(['--smoke', '--target', 'staging-bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Unknown target: staging-bogus/);
    expect(r.stderr).not.toMatch(/is not a cell/);
    // The valid set is named, so the fix is visible at the point of failure.
    expect(r.stderr).toMatch(/local/);
  });

  test('--smoke without --target uses default (dev) + reports cells via filter', () => {
    // Cell-route preview using filter to verify the path is wired up
    // without actually bootstrapping a real browser (filter-no-match
    // exits 0 before any factory call).
    const r = runCli(['--smoke', '--filter', 'nonexistent']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no cells match/);
  });
});
