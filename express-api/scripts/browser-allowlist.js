/**
 * Per-target browser allowlist for the manual QA runner.
 *
 * The matrix-completeness rule (operator directive 2026-05-30) defines:
 *   - local: full browser coverage (every supported browser on every
 *     supported device).
 *   - dev: physical Android device + Chrome on Mac + Chrome on Android
 *     ONLY. No Firefox/WebKit/Edge on dev — those are local-only.
 *   - prod: read-only verification; Chromium only.
 *
 * Mobile browser values use a `<browser>-<platform>` slug shape so the
 * runner can dispatch to the right driver factory without a separate
 * --platform flag.
 *
 * Extracted to its own module so unit tests can pin the matrix without
 * spawning the runner subprocess or regex-scraping its source.
 */

const DESKTOP_BROWSERS = ['chromium', 'firefox', 'webkit', 'edge'];

// Browsers that route through a non-default driver factory inside the
// runner's `--driver playwright|all` block. New mobile-browser drivers
// register their slug here AND in the per-target allowlist below.
const MOBILE_BROWSERS = ['mobile-chrome-android', 'mobile-samsung-android'];

const SUPPORTED_BROWSERS = [...DESKTOP_BROWSERS, ...MOBILE_BROWSERS];

const TARGET_BROWSER_ALLOWLIST = {
  local: [...DESKTOP_BROWSERS, ...MOBILE_BROWSERS],
  dev: ['chromium', 'mobile-chrome-android'],
  prod: ['chromium'],
};

/**
 * Returns the allowed-browser list for the given target, or [] if the
 * target is unknown. Pure — no side effects, safe to call repeatedly.
 */
function allowedBrowsersFor(target) {
  return TARGET_BROWSER_ALLOWLIST[target] || [];
}

/**
 * True if the given browser slug routes to a mobile-device driver
 * (CDP-over-adb, Appium safari context, etc.) rather than a desktop
 * Playwright launcher.
 */
function isMobileBrowser(browser) {
  return MOBILE_BROWSERS.includes(browser);
}

module.exports = {
  DESKTOP_BROWSERS,
  MOBILE_BROWSERS,
  SUPPORTED_BROWSERS,
  TARGET_BROWSER_ALLOWLIST,
  allowedBrowsersFor,
  isMobileBrowser,
};
