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
// `on the app` is the PLATFORM-NEUTRAL form: this step runs on the native app,
// whichever one the cell drives.
//
// Operator 2026-08-01: "why are most of the app scenarios android only??? all
// app scenarios must be on both apps". Measured at the time: 114 Android-only
// scenarios against 12 iOS-only, and the iOS cell skipping 282 of 228×… because
// the corpus says "on Android" in 376 steps for behaviour that is identical on
// both. A skip looks like a decision, so the skew was invisible.
//
// Naming a concrete platform still works and still pins — some scenarios ARE
// specific (an APK install, a Play billing dialog) and erasing that distinction
// would be its own bug.
const PLATFORM_PHRASE = /\bon\s+(?:the\s+)?(Android|iOS|iPhone|Web|app)\b/gi;

const NORMALISE = { android: 'android', ios: 'ios', iphone: 'ios', web: 'web', app: 'app' };

/**
 * Platforms that any ONE native app satisfies.
 *
 * `app` is a requirement for *a* device, not a specific one, so a cell holding
 * either phone can run it — which is exactly what doubles the app corpus
 * without writing a new scenario.
 */
const ANY_APP = new Set(['android', 'ios']);

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
 * Platforms whose absence is FATAL to a step, and therefore the only ones that
 * may gate a scenario.
 *
 * The runner has exactly one hard driver requirement — `UI step requires
 * ctx.uiDriver`, raised from ten sites in manual-qa-runner.js. There is no
 * equivalent `requires ctx.webDriver`: web steps fall back to API/state
 * assertions, which is why `runFeatureFile` fixtures have always executed
 * `Given Alice [P-02] on Web has shyCoins=42` against a fake db and no browser.
 *
 * Gating on `web` therefore converted passing scenarios into skips — the same
 * false claim this module exists to remove, aimed the other way. It cost the
 * matrix nothing to drop: every one of the 12 cells is a browser cell, so `web`
 * is universal there and never told two cells apart.
 */
const GATING_PLATFORMS = new Set(['android', 'ios', 'app']);

/**
 * @returns {{ok: boolean, missing: string[]}} `missing` is always empty when ok,
 * so a caller that reads it without checking ok cannot be misled.
 */
function canRunScenario(required = new Set(), capabilities = new Set()) {
  const missing = [...required]
    .filter((p) => {
      if (!GATING_PLATFORMS.has(p)) return false;
      // `app` is satisfied by EITHER native app — that is the whole point of
      // the neutral form. Everything else must match exactly.
      if (p === 'app') return ![...ANY_APP].some((d) => capabilities.has(d));
      return !capabilities.has(p);
    })
    .sort();
  return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing };
}

/**
 * The runner's ONE hard driver requirement, as raised by ten sites in
 * manual-qa-runner.js. Matching this error is how a cell learns it cannot drive
 * a surface — exactly, at the moment it matters.
 *
 * Why match the error instead of predicting from the step text: the corpus says
 * "on Android" in steps that need no device at all. `Given Marcus [P-04] is
 * signed in on Android` mints an auth token; `Given Alice [P-02] on Web has
 * shyCoins=42` writes a document. Predicting from the phrase skipped 16
 * scenarios that in fact run — trading the original false FAIL for a false SKIP,
 * which hides coverage just as effectively.
 */
const UI_DRIVER_REQUIRED = /UI step requires ctx\.uiDriver/;

/** True iff this step failed *only* because the cell has no device UI driver. */
function isMissingUiDriver(error) {
  return UI_DRIVER_REQUIRED.test(String(error || ''));
}

/**
 * Which ctx driver a failure blames, or null if it blames neither.
 *
 * The runner reports a missing driver in two shapes, and both must be read:
 *   - `UI step requires ctx.uiDriver (…)` / `Web step requires ctx.webDriver (…)`
 *     — the driver object is absent.
 *   - `ctx.uiDriver.androidUiDump not configured` — a named METHOD is absent.
 *
 * Anchored on `ctx.<driver>` immediately followed by `.` or the word `requires`
 * preceding it, so prose that merely mentions a driver name is not a match.
 */
const DRIVER_BLAME =
  /(?:requires\s+ctx\.(uiDriver|webDriver)\b|\bctx\.(uiDriver|webDriver)\.[A-Za-z0-9_]+\s+not configured)/;

/**
 * The PLATFORM-NEUTRAL form, e.g. "the app driver has no TapUserCard".
 *
 * Matchers now resolve app methods through `appMethod(ctx, 'X')`, which tries
 * `appX` then `androidX` then `iosX` — so its failure message names no single
 * platform, and the `ctx.uiDriver.androidX not configured` shape above no longer
 * appears for those steps.
 *
 * THIS IS WHY IT IS HERE. When the message changed and this file was not
 * updated, every step a cell could not perform stopped being SKIPPED and became
 * a FAILURE. Measured 2026-08-02: a full matrix run finished with PASS=0 on all
 * four cells and ~500 findings, the great majority of them cells being marked
 * down for surfaces they never had.
 */
const NEUTRAL_APP_BLAME = /\bthe app driver has no [A-Za-z0-9_]+/;

function blamedDriver(error) {
  const text = String(error || '');
  const m = DRIVER_BLAME.exec(text);
  if (m) return m[1] || m[2];
  // The neutral form always blames the device-UI driver — that is the only
  // driver `appMethod` ever resolves against.
  return NEUTRAL_APP_BLAME.test(text) ? 'uiDriver' : null;
}

/**
 * True iff this failure means "this CELL cannot drive this surface" — as opposed
 * to "this driver is missing a method", which is real framework debt.
 *
 * The discriminator is whether the blamed driver object exists on ctx, never the
 * wording. Measured on the 2026-08-01 run: chromium produced 97 driver findings,
 * 51 blaming `uiDriver` (which chromium does not have — wrong surface, skip) and
 * 45 blaming `webDriver` (which chromium DOES have — genuine gaps, keep them
 * red; they are SHY-0259's backlog and hiding them would erase it).
 */
function isSurfaceUnavailable(error, ctx = {}, step = null) {
  const driver = blamedDriver(error);
  if (!driver) return false;
  if (!ctx[driver]) return true;

  // Neutral-form failure with a uiDriver present: the driver exists but is for
  // the WRONG PHONE. The message names no platform, so the STEP is asked
  // instead — `has the local-flavor APK installed on Android` needs android, and
  // an iPhone cell that cannot supply it is a surface mismatch, not framework
  // debt. Without the step this fell through to `return false` and the cell was
  // failed for a scenario it was never able to run.
  if (driver === 'uiDriver' && step && NEUTRAL_APP_BLAME.test(String(error || ''))) {
    // Asked through canRunScenario, NOT by set membership: `app` is satisfied by
    // EITHER phone, so `caps.has('app')` is false on both and a membership test
    // would skip every neutral step on every cell — halving the app corpus
    // again, silently, in the name of fixing it.
    const needed = requiredPlatforms([step]);
    if (needed.size && !canRunScenario(needed, cellCapabilities(ctx)).ok) return true;
  }

  // The driver OBJECT exists but may not drive the platform the method belongs
  // to. On mobile-safari-ios, ctx.uiDriver is the iOS driver, so
  // `ctx.uiDriver.androidOpenScreen not configured` is a surface mismatch, not
  // framework debt — and the object-existence check alone called it a FAIL.
  // Seen on the 2026-08-01 run: an iOS cell reporting Android methods missing.
  if (driver === 'uiDriver') {
    const platform = methodPlatform(error);
    if (platform) return !cellCapabilities(ctx).has(platform);
  }
  return false;
}

/** Which platform a blamed uiDriver method belongs to, from its name prefix. */
function methodPlatform(error) {
  const m = /ctx\.uiDriver\.(android|ios)[A-Z]/.exec(String(error || ''));
  return m ? m[1] : null;
}

/** Human reason recorded on the skipped scenario, so the skip is never mysterious. */
function skipReason(missing = [], driver = null) {
  if (missing.length) return `surface not available on this cell — needs ${missing.join(' + ')}`;
  // NAME THE DRIVER THAT WAS ACTUALLY ABSENT.
  //
  // `missing` only ever holds GATING_PLATFORMS, and `web` is deliberately not
  // one — so every web scenario skipped on an app cell arrived here with an
  // empty set and got "the step needs a device UI driver", on a cell whose
  // device UI driver was present and working.
  //
  // Measured on run 20260803-011547-local: 70 of app-android's 111 skips carried
  // that message. The skips were CORRECT (an app cell drives no browser); the
  // explanation sent the reader hunting a device problem that did not exist,
  // which is worse than no explanation because it looks like one.
  if (driver === 'webDriver') {
    return 'surface not available on this cell — needs a browser, and this cell drives none';
  }
  return 'surface not available on this cell — the step needs a device UI driver';
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
  ANY_APP,
  requiredPlatforms,
  cellCapabilities,
  canRunScenario,
  applicableCells,
  isMissingUiDriver,
  isSurfaceUnavailable,
  blamedDriver,
  methodPlatform,
  skipReason,
  GATING_PLATFORMS,
};
