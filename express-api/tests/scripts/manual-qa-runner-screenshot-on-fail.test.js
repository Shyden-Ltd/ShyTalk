/**
 * manual-qa-runner-screenshot-on-fail.test.js
 *
 * Integration test for gap C3 — per-scenario-failure screenshot capture.
 * Exercises the hook in runFeatureFile (~line 14826) end-to-end against
 * the existing sample-failures.feature fixture.
 *
 * Hook contract (must hold for every code change):
 *   1. Scenario fails AND ctx.reportDir set AND ctx.webDriver has
 *      takeScreenshot → takeScreenshot is called with reportDir.
 *   2. Returned paths are persisted on scenarioReports[].screenshots.
 *   3. Scenario passes → takeScreenshot is NEVER called.
 *   4. No reportDir → takeScreenshot is NEVER called.
 *   5. No webDriver → no crash, no screenshots field.
 *   6. webDriver lacks takeScreenshot → no crash, no screenshots field.
 *   7. takeScreenshot throws → swallowed, scenario still reported as
 *      fail with no screenshots field.
 *   8. takeScreenshot returns [] → no empty screenshots field added.
 *
 * Best-effort guarantee: a failing screenshot must NEVER mask the
 * scenario failure itself nor crash the runner.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const { runFeatureFile } = require(path.join(REPO_ROOT, 'scripts/manual-qa-runner.js'));

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const FAILURES_FIXTURE = path.join(FIXTURE_DIR, 'sample-failures.feature');

/**
 * Write a one-scenario passes-by-default fixture to a tmp path so the
 * "pass → no screenshot call" assertion is hermetic — independent of
 * sample-auth's multi-persona fetch contract.
 */
function writePassingFixture() {
  const tmp = path.join(os.tmpdir(), `qa-passing-fixture-${process.pid}-${Date.now()}.feature`);
  fs.writeFileSync(
    tmp,
    [
      'Feature: Single passing scenario for screenshot hook test',
      '',
      '  Scenario: Healthcheck',
      '    Given the local stack is healthy',
      '',
    ].join('\n'),
  );
  return tmp;
}

/**
 * Minimal ctx — mirrors makeCtx() in manual-qa-runner.test.js but
 * adds the C3-specific fields (reportDir + webDriver). Default fetch
 * is a stub that returns enough to let the auth Given pass and the
 * GET succeed; the assertion-mismatch is what drives the failure.
 */
function makeCtx(overrides = {}) {
  return {
    apiBase: 'https://dev-api.example',
    firebaseApiKey: 'fake-key',
    personasPassword: 'fake-pw-not-real-just-stub-fixture',
    sessions: new Map(),
    personaPlatforms: new Map(),
    personaPaths: new Map(),
    lastResponse: null,
    locale: 'en',
    fetch: jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const claims = { uniqueId: 50000010, admin: false };
        const idToken = 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/users/')) {
        return {
          status: 200,
          text: async () => JSON.stringify({ uniqueId: 50000010, displayName: 'Alice' }),
        };
      }
      return { status: 200, text: async () => '{}' };
    }),
    ...overrides,
  };
}

describe('runFeatureFile screenshot-on-failure hook (C3)', () => {
  test('failing scenario + reportDir + webDriver.takeScreenshot → screenshots captured', async () => {
    const takeScreenshot = jest.fn(async () => ['/tmp/qa-report/screenshot-chromium-Alice.png']);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toEqual(['/tmp/qa-report/screenshot-chromium-Alice.png']);
    // The hook passes a per-failure subdir `<reportDir>/scenario-<N>/`
    // so multiple failures in the same feature don't overwrite each
    // other's PNGs (reviewer I1 fix).
    expect(takeScreenshot).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/qa-report\/scenario-\d+$/),
    );
    // Called once per failing scenario (sample-failures has 3, so ≥1).
    expect(takeScreenshot).toHaveBeenCalled();
  });

  test('passing scenario → takeScreenshot is NEVER called (no wasted I/O on green path)', async () => {
    const takeScreenshot = jest.fn(async () => ['unused.png']);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const passingFixture = writePassingFixture();
    try {
      const { scenarioReports } = await runFeatureFile(passingFixture, ctx);
      expect(scenarioReports[0].status).toBe('pass');
      // If a future runner change wrongly fires the hook on pass, this throws.
      expect(takeScreenshot).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(passingFixture);
    }
  });

  test('no reportDir → takeScreenshot is NEVER called even on fail (operator opt-out)', async () => {
    const takeScreenshot = jest.fn(async () => ['unused.png']);
    const ctx = makeCtx({
      // no reportDir
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    expect(takeScreenshot).not.toHaveBeenCalled();
    // Still reports the failure normally — no screenshots field.
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toBeUndefined();
  });

  test('no webDriver → no crash, scenario still reported as fail (native/headless cells)', async () => {
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      // no webDriver — e.g. android-adb or ios-devicectl runs
    });
    const { scenarioReports, findings } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toBeUndefined();
    // Failure still classified normally.
    expect(findings.some((f) => f.scenario === wrongStatus.scenario)).toBe(true);
  });

  test('webDriver without takeScreenshot method → no crash, no screenshots field (older driver versions)', async () => {
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { close: async () => {} }, // driver predates C3
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toBeUndefined();
  });

  test('takeScreenshot throws → swallowed, scenario reported as fail without screenshots (best-effort)', async () => {
    const takeScreenshot = jest.fn(async () => {
      throw new Error('Playwright context closed');
    });
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports, findings } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    expect(takeScreenshot).toHaveBeenCalled();
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    // Critical invariant: a broken screenshot helper must NEVER mask the
    // underlying test failure or crash the runner.
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toBeUndefined();
    expect(findings.some((f) => f.scenario === wrongStatus.scenario)).toBe(true);
  });

  test('takeScreenshot returns [] → no empty screenshots field on report', async () => {
    // Helper returns [] when outputDir is falsy or all per-persona
    // captures error; mirror that here. Empty array MUST NOT be
    // serialized as `screenshots: []` — it would pollute every report
    // JSON with empty arrays.
    const takeScreenshot = jest.fn(async () => []);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toBeUndefined();
  });

  test('takeScreenshot returns null → no crash, no screenshots field', async () => {
    // Defensive: future helper bug returning null shouldn't crash the
    // `screenshotPaths.length` check. The hook coerces via `|| []`.
    const takeScreenshot = jest.fn(async () => null);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const wrongStatus = scenarioReports.find(
      (s) => s.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus.status).toBe('fail');
    expect(wrongStatus.screenshots).toBeUndefined();
  });

  test('multiple failing scenarios in one file → takeScreenshot called per failure', async () => {
    // sample-failures has 3 failing scenarios; each should trigger the
    // hook independently (one screenshot batch per failure).
    const takeScreenshot = jest.fn(async () => ['shot.png']);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const failingReports = scenarioReports.filter((s) => s.status === 'fail');
    expect(failingReports.length).toBeGreaterThanOrEqual(2);
    expect(takeScreenshot.mock.calls.length).toBe(failingReports.length);
    for (const r of failingReports) {
      expect(r.screenshots).toEqual(['shot.png']);
    }
  });

  test('multi-failure: each scenario gets a UNIQUE outputDir (collision-proof per reviewer I1)', async () => {
    // Reviewer-flagged: prior helper-level filename pattern
    // `screenshot-<slug>-<persona>.png` had no scenario qualifier, so
    // a second failing scenario with the same persona would overwrite
    // the first. Fix: runner passes `<reportDir>/scenario-<N>/` as the
    // outputDir, where N is the failure ordinal. Helper writes inside
    // that subdir → no collision possible.
    const takeScreenshot = jest.fn(async (outputDir) => [`${outputDir}/shot.png`]);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    await runFeatureFile(FAILURES_FIXTURE, ctx);
    const uniqueDirs = new Set(takeScreenshot.mock.calls.map((c) => c[0]));
    // If two failures shared an outputDir, set size would be < calls length.
    expect(uniqueDirs.size).toBe(takeScreenshot.mock.calls.length);
    // Each call gets a `scenario-N` suffix.
    for (const [dir] of takeScreenshot.mock.calls) {
      expect(dir).toMatch(/\/tmp\/qa-report\/scenario-\d+$/);
    }
    // Reviewer I-NEW-2 — pin EXACT indices: failures form a contiguous
    // zero-based sequence so screenshot dir N correlates with findings[N].
    // Catches off-by-one regressions if a future refactor reorders the
    // findings.push vs screenshot block (the index is computed from
    // findings.length - 1).
    //
    // Reviewer round-3 I-1 — pin per-CALL order, not just the set.
    // sample-failures.feature scenarios run in Gherkin order; failure
    // ordinal MUST match call ordinal so scenarioReports[i].screenshots
    // points to the right scenario's artifacts. A future refactor that
    // sorts failures (e.g. by severity) before screenshots would pass a
    // set-equality assertion but break the correlation. The per-call
    // pin catches that class of regression.
    for (let i = 0; i < takeScreenshot.mock.calls.length; i++) {
      expect(takeScreenshot.mock.calls[i][0]).toBe(`/tmp/qa-report/scenario-${i}`);
    }
  });

  test('empty-string screenshot paths are filtered out (reviewer P3)', async () => {
    // Defense-in-depth: if a future helper bug returned `['']`, the
    // runner's `length > 0` guard would attach `screenshots: ['']` —
    // a garbage path for any downstream artifact consumer. The
    // `.filter(Boolean)` in the runner strips falsy entries first.
    const takeScreenshot = jest.fn(async () => ['', '/real/path.png', '']);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const failingReports = scenarioReports.filter((s) => s.status === 'fail');
    for (const r of failingReports) {
      expect(r.screenshots).toEqual(['/real/path.png']);
    }
  });

  test('helper returns only empty strings → screenshots field NOT attached', async () => {
    // Edge of P3: if every entry is falsy, the post-filter array is
    // empty → length-check skips the .screenshots assignment entirely.
    // No screenshots field is more honest than `screenshots: []`.
    const takeScreenshot = jest.fn(async () => ['', '']);
    const ctx = makeCtx({
      reportDir: '/tmp/qa-report',
      webDriver: { takeScreenshot },
    });
    const { scenarioReports } = await runFeatureFile(FAILURES_FIXTURE, ctx);
    const failingReports = scenarioReports.filter((s) => s.status === 'fail');
    for (const r of failingReports) {
      expect(r.screenshots).toBeUndefined();
    }
  });
});
