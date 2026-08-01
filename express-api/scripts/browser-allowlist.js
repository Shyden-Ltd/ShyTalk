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
// Order intentional: Android slugs first, then iOS — keeps test
// `.toEqual` expectations stable across PRs that add more of either.
const MOBILE_BROWSERS = [
  'mobile-chrome-android',
  'mobile-samsung-android',
  'mobile-edge-android',
  'mobile-firefox-android',
  'mobile-safari-ios',
  'mobile-chrome-ios',
  'mobile-firefox-ios',
  'mobile-edge-ios',
];

const SUPPORTED_BROWSERS = [...DESKTOP_BROWSERS, ...MOBILE_BROWSERS];

// Per-target allowlist:
//   local — full matrix (every desktop browser + every mobile slug).
//   dev   — operator policy 2026-05-30: chromium on Mac + mobile-chrome
//           on Android. Mobile Safari is local-only because the
//           dev-tier Android-Chrome cell + Mac-Chrome cell are the
//           operator's chosen dev gate; iOS WebKit coverage lives in
//           the local matrix.
//   prod  — chromium only (read-only verification gate).
const TARGET_BROWSER_ALLOWLIST = {
  local: [...DESKTOP_BROWSERS, ...MOBILE_BROWSERS],
  dev: ['chromium', 'mobile-chrome-android'],
  prod: ['chromium'],
};

/**
 * Narrow a browser list to the hardware actually present.
 *
 * Devices come and go. On 2026-08-01 the iPhone became unavailable mid-session
 * while the Android device stayed, and there was no way to say so — the run
 * could only spend driver-init time on five iOS cells that could not work, or
 * have its allowlist hand-edited. An absent device is a normal operating
 * condition, not an error.
 *
 * POSITIVE filter (name what to run), never negative: a typo in an exclusion
 * list silently runs everything, while a typo here runs too little and is
 * caught immediately — by throwing rather than by quietly returning less.
 *
 * @param {string[]} allowed the target's full allowlist
 * @param {string} [scope] comma-separated slugs; falsy means "no narrowing"
 * @returns {string[]} in ALLOWLIST order, not the caller's
 */
function scopeToHardware(allowed, scope) {
  const wanted = String(scope || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.length === 0) return allowed;

  const unknown = wanted.filter((b) => !allowed.includes(b));
  if (unknown.length > 0) {
    // Loud at configuration time. Silently dropping an unknown name is how a
    // run ends up testing nothing while still exiting 0.
    throw new Error(
      `browser scope names ${unknown.join(', ')}, which this target does not allow. ` +
        `Available: ${allowed.join(', ') || '(none)'}`,
    );
  }
  // Allowlist order is preserved because cell order drives the resource
  // grouping in matrix-dispatch — reordering would change what runs in
  // parallel, and therefore which cells contend for the same device.
  return allowed.filter((b) => wanted.includes(b));
}

/**
 * Returns the allowed-browser list for the given target, or [] if the
 * target is unknown.
 *
 * Honours `GAUNTLET_BROWSERS` so an unattended run can be scoped to whatever
 * hardware is plugged in without editing this file.
 */
function allowedBrowsersFor(target) {
  const allowed = TARGET_BROWSER_ALLOWLIST[target] || [];
  // An unknown target has no allowlist to narrow; returning [] beats throwing
  // about a scope that was never going to apply.
  if (allowed.length === 0) return allowed;
  return scopeToHardware(allowed, process.env.GAUNTLET_BROWSERS);
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
  scopeToHardware,
  isMobileBrowser,
};
