/**
 * What each matrix cell actually drives — the single home for that fact.
 *
 * THE BUG THIS MODULE EXISTS TO REMOVE (operator, 2026-08-01):
 *
 *   "why is the browser cell carrying the android app driver? that doesn't
 *    sound correct. maybe that's been the problem all this time?"
 *
 * It was. The matrix was keyed entirely by browser slug — every cell was a
 * browser cell — so the native app had no cell of its own. App-driving was
 * bolted onto whichever cells happened to own the phone, decided by a single
 * expression in matrix-dispatch:
 *
 *   defaultResourceKey('mobile-chrome-android') === 'android'
 *
 * That expression was made to answer TWO different questions:
 *
 *   1. "which hardware does this cell contend for?"
 *        → the phone. TRUE — Chrome for Android runs ON the device over
 *          CDP-over-adb, so the cell genuinely owns it and must serialise
 *          against other cells that do.
 *
 *   2. "whose native app does this cell drive?"
 *        → the phone. FALSE. A browser cell drives a browser. Owning the
 *          device says nothing about whether the APK should be launched.
 *
 * One answer, two questions, and the second one wrong: all four
 * `mobile-*-android` cells attached the Android app driver. Measured on the one
 * connected phone — 125 device-scenario runs needed, 500 performed, 375 wasted,
 * each of those a duplicate `uiautomator dump` contending with three siblings
 * for the same binary. That is the stalling the operator kept seeing.
 *
 * So the two questions get two fields, and neither is derived from a string
 * suffix ever again:
 *
 *   resource   — the physical thing this cell contends for (serialisation)
 *   appDevice  — the device whose NATIVE APP this cell drives (null = none)
 *
 * THE CELL TAXONOMY THAT FALLS OUT OF IT (operator's three lists):
 *
 *   app    — appDevice set, no browser. The APK alone.
 *   web    — browser set, no appDevice. A browser alone, wherever it runs.
 *   cross  — both. ONE cell holding two surfaces, which is the only way a
 *            "send a gift on the phone, see it on the web" journey can run.
 *
 * Cross-over deliberately pairs the app with a DESKTOP browser. Pairing it with
 * a phone browser would make one device play both actors — driving the same
 * hardware twice to test a handoff no real pair of users performs.
 */

const CHROMIUM = 'chromium';

/**
 * Every cell, in dispatch order.
 *
 * Order is load-bearing: matrix-dispatch groups by `resource` and runs each
 * group sequentially, so the order here is the order the phone is asked to do
 * things. App cells first means the APK work finishes before the browser cells
 * start competing for the same device.
 */
const MATRIX_CELLS = [
  // ── app: the native app, alone ──────────────────────────────────────────
  { cell: 'app-android', browser: null, appDevice: 'android', resource: 'android' },
  { cell: 'app-ios', browser: null, appDevice: 'ios', resource: 'iphone' },

  // ── web: a browser, alone ───────────────────────────────────────────────
  { cell: 'chromium', browser: 'chromium', appDevice: null, resource: 'mac' },
  { cell: 'firefox', browser: 'firefox', appDevice: null, resource: 'mac' },
  { cell: 'webkit', browser: 'webkit', appDevice: null, resource: 'mac' },
  { cell: 'edge', browser: 'edge', appDevice: null, resource: 'mac' },
  // These run ON the phone (CDP-over-adb) so they contend for it — but they
  // drive a browser, not the APK. That distinction is the whole point.
  {
    cell: 'mobile-chrome-android',
    browser: 'mobile-chrome-android',
    appDevice: null,
    resource: 'android',
  },
  {
    cell: 'mobile-samsung-android',
    browser: 'mobile-samsung-android',
    appDevice: null,
    resource: 'android',
  },
  {
    cell: 'mobile-edge-android',
    browser: 'mobile-edge-android',
    appDevice: null,
    resource: 'android',
  },
  {
    cell: 'mobile-firefox-android',
    browser: 'mobile-firefox-android',
    appDevice: null,
    resource: 'android',
  },
  { cell: 'mobile-safari-ios', browser: 'mobile-safari-ios', appDevice: null, resource: 'iphone' },
  { cell: 'mobile-chrome-ios', browser: 'mobile-chrome-ios', appDevice: null, resource: 'iphone' },
  {
    cell: 'mobile-firefox-ios',
    browser: 'mobile-firefox-ios',
    appDevice: null,
    resource: 'iphone',
  },
  { cell: 'mobile-edge-ios', browser: 'mobile-edge-ios', appDevice: null, resource: 'iphone' },

  // ── cross: both surfaces in one cell ────────────────────────────────────
  // Keyed to the DEVICE, not the Mac: the phone is the scarce resource, and a
  // cross cell keyed to 'mac' would run concurrently with the browser cells
  // already using the phone — the deadlock this exercise removed.
  { cell: 'cross-android', browser: CHROMIUM, appDevice: 'android', resource: 'android' },
  { cell: 'cross-ios', browser: CHROMIUM, appDevice: 'ios', resource: 'iphone' },
];

const BY_SLUG = new Map(MATRIX_CELLS.map((c) => [c.cell, c]));
const CELL_SLUGS = MATRIX_CELLS.map((c) => c.cell);

/** Execution order. App proves the product, web proves the site, cross proves the seam. */
const PHASES = ['app', 'web', 'cross'];

/** Resource key per app device — the physical thing, not the platform word. */
const RESOURCE_FOR_DEVICE = { android: 'android', ios: 'iphone' };

/**
 * @param {string} cell
 * @returns {{cell:string, browser:string|null, appDevice:string|null, resource:string}}
 * @throws when the slug is not a cell — never guesses.
 */
function cellSpec(cell) {
  const spec = BY_SLUG.get(cell);
  if (!spec) {
    // The old rule guessed: anything containing 'android' drove the phone, and
    // everything else was the Mac — so a typo silently produced a working-looking
    // cell that ran on the wrong hardware. Naming the valid set makes the fix
    // obvious at the point of failure.
    throw new Error(
      `"${cell}" is not a matrix cell. Known cells: ${CELL_SLUGS.join(', ')}. ` +
        `Add it to MATRIX_CELLS with an explicit browser + appDevice rather than ` +
        `relying on the slug's shape.`,
    );
  }
  return spec;
}

/** Non-throwing membership test, for callers that must not throw. */
function isKnownCell(cell) {
  return BY_SLUG.has(cell);
}

/** The Playwright/mobile browser slug this cell launches, or null. */
function browserFor(cell) {
  return cellSpec(cell).browser;
}

/** The device whose NATIVE APP this cell drives, or null. */
function appDeviceFor(cell) {
  return cellSpec(cell).appDevice;
}

/** The physical resource this cell contends for: 'mac' | 'android' | 'iphone'. */
function resourceKeyFor(cell) {
  return cellSpec(cell).resource;
}

/**
 * The surfaces this cell can drive, in `scenario-surface` vocabulary.
 *
 * Order is stable ('web' first) so tests and dashboard columns can compare
 * arrays directly without sorting at every call site.
 */
function capsFor(cell) {
  const { browser, appDevice } = cellSpec(cell);
  const caps = [];
  if (browser) caps.push('web');
  if (appDevice) caps.push(appDevice);
  return caps;
}

/**
 * Which of the three lists this cell belongs to.
 *
 * DERIVED, never stored. A stored phase is a second source of truth for a fact
 * the surfaces already state, and two sources of truth for "what kind of cell
 * is this" is exactly how the dashboard and the runner came to disagree.
 */
function phaseOf(cell) {
  const { browser, appDevice } = cellSpec(cell);
  if (browser && appDevice) return 'cross';
  if (appDevice) return 'app';
  if (browser) return 'web';
  return null;
}

/** Every cell in a phase, in dispatch order. */
function cellsInPhase(phase) {
  return MATRIX_CELLS.filter((c) => phaseOf(c.cell) === phase);
}

/** Cell slugs for a phase — the shape the allowlist and dispatcher want. */
function slugsInPhase(phase) {
  return cellsInPhase(phase).map((c) => c.cell);
}

/** Which devices a target is willing to drive at all. */
const TARGET_DEVICES = {
  // Full protocol: real Android + real iPhone + every browser.
  local: ['mac', 'android', 'iphone'],
  // CLAUDE.md: dev runs real-iOS app journeys too; only the BROWSER fan-out
  // collapses to Chrome. Under the old browser-keyed matrix those were the same
  // dial, so narrowing browsers silently dropped the devices as well.
  dev: ['mac', 'android', 'iphone'],
  // Read-only verification gate against production. Never touches a device.
  prod: ['mac'],
};

/**
 * Parse a comma-separated scope into a list, or null when unset.
 *
 * POSITIVE filter throughout: the caller names what to RUN. A negative
 * ("exclude these") list silently runs everything on a typo, whereas naming
 * what to run runs too little — which the `unknown` check below turns into an
 * immediate loud failure rather than a green run that tested nothing.
 */
function parseScope(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

function rejectUnknown(kind, wanted, valid, envName) {
  const unknown = wanted.filter((w) => !valid.includes(w));
  if (unknown.length) {
    throw new Error(
      `${envName} names ${kind} ${unknown.join(', ')}, which this target does not have. ` +
        `Available: ${valid.join(', ') || '(none)'}. ` +
        `Silently ignoring it would exit 0 having tested nothing.`,
    );
  }
}

/**
 * The cells to run for a target, honouring what hardware is actually present.
 *
 * Scoping knobs, applied in order — each narrows what the previous allowed:
 *
 *   GAUNTLET_DEVICES  'mac,android'  — what is plugged in. The honest knob: the
 *                     operator's "the iPhone will be out of action" is one word
 *                     here, versus seven browser slugs under the old scheme,
 *                     where a typo in any one of them ran too little in silence.
 *   GAUNTLET_BROWSERS 'chromium,…'   — the pre-cell knob, still honoured because
 *                     50-matrix.sh has passed it since before cells existed. It
 *                     scopes the BROWSER side only: an app cell has no browser,
 *                     so it survives — otherwise "test only Chrome" would stop
 *                     testing the product itself.
 *   GAUNTLET_CELLS    'app-android,…' — exact cells, for a targeted re-run.
 *
 * @param {string} target 'local' | 'dev' | 'prod'
 * @returns {string[]} cell slugs in MATRIX_CELLS order
 */
function allowedCellsFor(target, env = process.env) {
  const { allowedBrowsersFor } = require('./browser-allowlist');
  const devices = TARGET_DEVICES[target];
  if (!devices) return [];

  // The target's browser policy, already scoped by GAUNTLET_BROWSERS.
  const browsers = allowedBrowsersFor(target);

  let cells = MATRIX_CELLS.filter((c) => devices.includes(c.resource)).filter(
    (c) => c.browser === null || browsers.includes(c.browser),
  );

  const wantedDevices = parseScope(env.GAUNTLET_DEVICES);
  if (wantedDevices) {
    rejectUnknown('device', wantedDevices, devices, 'GAUNTLET_DEVICES');
    cells = cells.filter((c) => wantedDevices.includes(c.resource));
  }

  const wantedCells = parseScope(env.GAUNTLET_CELLS);
  if (wantedCells) {
    rejectUnknown(
      'cell',
      wantedCells,
      cells.map((c) => c.cell),
      'GAUNTLET_CELLS',
    );
    cells = cells.filter((c) => wantedCells.includes(c.cell));
  }

  // MATRIX_CELLS order, never the caller's: cell order drives the resource
  // grouping in matrix-dispatch, so reordering would change which cells run in
  // parallel and therefore which of them contend for the same device.
  return cells.map((c) => c.cell);
}

module.exports = {
  MATRIX_CELLS,
  CELL_SLUGS,
  PHASES,
  TARGET_DEVICES,
  allowedCellsFor,
  RESOURCE_FOR_DEVICE,
  cellSpec,
  isKnownCell,
  browserFor,
  appDeviceFor,
  resourceKeyFor,
  capsFor,
  phaseOf,
  cellsInPhase,
  slugsInPhase,
};
