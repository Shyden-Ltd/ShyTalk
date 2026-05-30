/**
 * ios-driver-loader.js — small routing helper that picks the right iOS
 * driver implementation given the runner's `--driver` flag + env.
 *
 * Extracted from manual-qa-runner.js so the routing decision has a
 * unit-testable surface independent of the (very large) runner test
 * file. The runner's main() should require this helper, hand it the
 * two driver-factory functions (devicectl + appium) it already needs,
 * then use the returned `{ iosDriver, mode }`.
 *
 * Routing matrix:
 *   driver=devicectl|simctl   → devicectl  (UI methods are stubs)
 *   driver=appium             → appium     (real UI, requires WDA_TEAM_ID)
 *   driver=all + WDA_TEAM_ID  → appium     (best UI coverage)
 *   driver=all (no env var)   → devicectl  (silent loss of UI coverage,
 *                                          warn on stderr)
 *   anything else             → returns null (caller skips iOS wiring)
 *
 * `target` is forwarded to the appium factory so it can pick the right
 * device id per environment if needed; the devicectl factory ignores it.
 *
 * The env object is injectable for tests (default: process.env).
 * The warn fn is injectable for tests (default: writes to process.stderr).
 *
 * Default `warn` uses process.stderr.write directly (not console.error)
 * to keep this file off the no-console eslint suppression that the
 * sibling CLI drivers carry. The semantics are identical for the
 * runner — stderr text, one line per call.
 */

const APPIUM_FALLBACK_WARNING =
  '[runner] --driver all + no WDA_TEAM_ID set → falling back to ios-devicectl-driver (UI methods are stubs). Set WDA_TEAM_ID + run an Appium server to enable real iOS UI testing.';

function shouldLoadIos(driver) {
  return driver === 'devicectl' || driver === 'simctl' || driver === 'appium' || driver === 'all';
}

function pickIosMode(driver, env) {
  if (driver === 'appium') return 'appium';
  if (driver === 'all' && env && env.WDA_TEAM_ID) return 'appium';
  return 'devicectl';
}

async function loadIosUiDriver({
  driver,
  target,
  env = process.env,
  warn = (msg) => process.stderr.write(`${msg}\n`),
  createAppiumDriver,
  createDevicectlDriver,
} = {}) {
  if (!shouldLoadIos(driver)) return null;

  const mode = pickIosMode(driver, env);

  if (mode === 'appium') {
    if (typeof createAppiumDriver !== 'function') {
      throw new Error('loadIosUiDriver: createAppiumDriver factory is required for appium mode');
    }
    const iosDriver = await createAppiumDriver({ target });
    return { iosDriver, mode };
  }

  // devicectl mode (incl. --driver all fallback)
  if (driver === 'all' && !(env && env.WDA_TEAM_ID)) {
    warn(APPIUM_FALLBACK_WARNING);
  }
  if (typeof createDevicectlDriver !== 'function') {
    throw new Error(
      'loadIosUiDriver: createDevicectlDriver factory is required for devicectl mode',
    );
  }
  const iosDriver = await createDevicectlDriver({});
  return { iosDriver, mode };
}

module.exports = {
  APPIUM_FALLBACK_WARNING,
  shouldLoadIos,
  pickIosMode,
  loadIosUiDriver,
};
