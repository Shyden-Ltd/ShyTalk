/**
 * Surface gating: which platforms a scenario needs, and which a cell can drive.
 *
 * Operator 2026-07-31: "fix the framework defect so web cells skip device-only
 * scenarios."
 *
 * The journey corpus is surface-specific — 151 steps say "on Android", 159
 * "on Web", 46 "on iOS", 4 "on iPhone" — but every matrix cell walks all 226
 * scenarios. A web-only cell has no `ctx.uiDriver`, so its first Android step
 * returned `UI step requires ctx.uiDriver` and the scenario was recorded FAILED.
 *
 * The measured cost: an identical 40-fail / 2-pass split across chromium,
 * mobile-chrome-android and mobile-safari-ios. Three unrelated surfaces failing
 * exactly the same scenarios is the harness scoring cells on work they cannot
 * perform — and it buried real defects under ~90% noise.
 *
 * A skip states a fact: this cell cannot drive this surface. A fail asserts
 * something false about the product.
 */

// "Adam on Android taps ..." / "Alice on Web sees ..." / "Mia on iPhone opens ..."
// Anchored on the ` on <Platform> ` phrasing the corpus uses for the actor's
// surface, so a platform word inside a quoted value is not mistaken for one.
const PLATFORM_PHRASE = /\bon\s+(Android|iOS|iPhone|Web)\b/gi;

const NORMALISE = { android: 'android', ios: 'ios', iphone: 'ios', web: 'web' };

/** Every platform a scenario's steps demand. Empty means "runs anywhere". */
function requiredPlatforms(steps = []) {
  const needed = new Set();
  for (const step of steps) {
    const text = String(step?.text || '');
    // Strip quoted values first: `the report reason is "Android bug"` names no
    // platform, and treating it as one would skip a valid web scenario.
    const unquoted = text.replace(/"[^"]*"/g, '""');
    for (const match of unquoted.matchAll(PLATFORM_PHRASE)) {
      const platform = NORMALISE[match[1].toLowerCase()];
      if (platform) needed.add(platform);
    }
  }
  return needed;
}

/**
 * What this cell can actually drive.
 *
 * Keyed on the driver METHODS that do the driving, not on a flag or a browser
 * slug: a `uiDriver` object can exist without Android support, and claiming the
 * platform anyway is exactly how a scenario fails deep inside a step instead of
 * skipping cleanly at the top.
 */
function cellCapabilities(ctx = {}) {
  const caps = new Set();
  if (ctx.webDriver) caps.add('web');
  if (ctx.uiDriver) {
    if (typeof ctx.uiDriver.androidUiDump === 'function') caps.add('android');
    if (typeof ctx.uiDriver.iosUiDump === 'function') caps.add('ios');
  }
  return caps;
}

/**
 * @returns {{ok: boolean, missing: string[]}} `missing` is always empty when ok,
 * so a caller that reads it without checking ok cannot be misled.
 */
function canRunScenario(required = new Set(), capabilities = new Set()) {
  const missing = [...required].filter((p) => !capabilities.has(p)).sort();
  return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing };
}

/** Human reason recorded on the skipped scenario, so the skip is never mysterious. */
function skipReason(missing) {
  return `surface not available on this cell — needs ${missing.join(' + ')}`;
}

/**
 * Which cells a scenario can actually run on.
 *
 * The dashboard needs this to tell "not applicable to this surface" apart from
 * "queued": rendering an Android-only scenario as pending on chromium promises
 * work that will never happen, and inflates the denominator — 2712 claimed
 * combinations versus 948 that can genuinely run.
 *
 * @param {Array} steps
 * @param {Object<string,string[]>} capsByCell cell slug -> platforms it drives
 * @returns {Object<string,boolean>}
 */
function applicableCells(steps, capsByCell = {}) {
  const required = requiredPlatforms(steps);
  const out = {};
  for (const [cell, caps] of Object.entries(capsByCell)) {
    out[cell] = canRunScenario(required, new Set(caps)).ok;
  }
  return out;
}

module.exports = {
  requiredPlatforms,
  cellCapabilities,
  canRunScenario,
  applicableCells,
  skipReason,
};
