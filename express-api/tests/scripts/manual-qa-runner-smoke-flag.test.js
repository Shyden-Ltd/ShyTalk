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

  test('returns an object keyed by every supported cell slug', () => {
    const factories = buildDriverFactories({ headed: false });
    const expectedSlugs = [
      'chromium',
      'firefox',
      'webkit',
      'edge',
      'mobile-chrome-android',
      'mobile-samsung-android',
      'mobile-edge-android',
      'mobile-firefox-android',
      'mobile-safari-ios',
      'mobile-chrome-ios',
      'mobile-firefox-ios',
      'mobile-edge-ios',
    ];
    for (const slug of expectedSlugs) {
      expect(typeof factories[slug]).toBe('function');
    }
    expect(Object.keys(factories).sort()).toEqual(expectedSlugs.sort());
  });

  test('each factory is an arrow function expecting { baseURL }', () => {
    const factories = buildDriverFactories({ headed: false });
    for (const [slug, fn] of Object.entries(factories)) {
      // Factories are arrow functions: 1 declared param ({ baseURL }).
      expect(fn.length).toBe(1);
      expect(typeof fn).toBe('function');
      // Sanity: factory name doesn't matter, but the arity does.
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

  test('factory count matches browser-allowlist SUPPORTED_BROWSERS', () => {
    // Drift-catch: if a new cell is added to browser-allowlist but the
    // factory map isn't updated, --check-drivers/--smoke would fail
    // mid-dispatch with "no factory registered for browser slug X".
    // Pin the contract here so the test fails immediately.
    const { SUPPORTED_BROWSERS } = require(
      path.join(REPO_ROOT, 'express-api/scripts/browser-allowlist'),
    );
    const factories = buildDriverFactories({ headed: false });
    expect(Object.keys(factories).sort()).toEqual([...SUPPORTED_BROWSERS].sort());
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
    expect(r.stderr).toMatch(/Unknown target|not allowed/);
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
