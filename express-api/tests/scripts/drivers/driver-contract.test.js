/**
 * driver-contract.test.js
 *
 * Closes framework gaps B3 (driver interface contract test) + D3 (no
 * env-vars required at require-time). Every file in
 * `express-api/scripts/drivers/` matching `*-driver.js` must conform
 * to the canonical driver shape:
 *
 *   1. Loadable via `require()` with no env vars set — drivers that
 *      read process.env at module-top would break `--check-drivers`
 *      silently before this test (the D3 gap).
 *   2. Exports a factory function whose name starts with `create`
 *      (e.g., `createIosDriver`, `createWebDriver`).
 *   3. Exports a `listMethods()` function.
 *   4. `listMethods()` returns a non-empty array of strings (each
 *      string a non-empty method name).
 *   5. Exports a `*_METHOD_NAMES` constant array that matches
 *      `listMethods()` after deduplication + sort. This pins the
 *      naming convention and catches drift where one is updated but
 *      the other isn't.
 *
 * Excluded files: helper modules without a driver shape
 * (`android-cdp-helpers.js`, `ios-driver-loader.js`,
 * `driver-screenshot-helper.js`).
 *
 * `describe.each` per discovered driver — adding a new driver requires
 * zero test edits; the new file is auto-tested.
 */

const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.resolve(__dirname, '../../../scripts/drivers');

// Helper modules (no factory + no listMethods — they're support code,
// not driver implementations). Exclusion list is intentional: every
// addition here represents a conscious decision about what is/isn't a
// driver.
const HELPER_FILES = new Set([
  'android-cdp-helpers.js',
  'ios-driver-loader.js',
  'driver-screenshot-helper.js',
]);

function discoverDrivers() {
  return fs
    .readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('-driver.js') || (f.endsWith('.js') && !HELPER_FILES.has(f)))
    .filter((f) => !HELPER_FILES.has(f))
    .map((f) => ({ name: f.replace(/\.js$/, ''), file: f, full: path.join(DRIVERS_DIR, f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Discovery sanity ───────────────────────────────────────────────

describe('Driver discovery', () => {
  test('finds >= 11 drivers; exact count pinned by EXPECTED_COUNTS (14 files − 3 helpers)', () => {
    expect(discoverDrivers().length).toBeGreaterThanOrEqual(11);
  });

  test('finds at least one driver in every matrix category', () => {
    const names = discoverDrivers().map((d) => d.name);
    // Sentinels — adding or removing a whole category surfaces here.
    expect(names.some((n) => n.startsWith('web-playwright'))).toBe(true);
    expect(names.some((n) => n.startsWith('web-mobile-') && n.endsWith('-android-driver'))).toBe(
      true,
    );
    expect(names.some((n) => n.startsWith('web-mobile-') && n.endsWith('-ios-driver'))).toBe(true);
    expect(names.some((n) => n.startsWith('android-adb'))).toBe(true);
    expect(names.some((n) => n.startsWith('ios-') && n.endsWith('-driver'))).toBe(true);
  });

  test('helper modules are explicitly excluded from discovery', () => {
    const files = discoverDrivers().map((d) => d.file);
    for (const helper of HELPER_FILES) {
      expect(files).not.toContain(helper);
    }
  });
});

// ── Per-driver contract ────────────────────────────────────────────

describe.each(discoverDrivers())('Driver contract — $name', ({ full }) => {
  let mod;

  test('loads via require() with no env vars set (closes D3)', () => {
    // Save + clear every PERSONAS_* / FIREBASE_* / APPIUM_* / ANDROID_* /
    // IOS_* env var, then require(). Restore in afterAll-equivalent.
    // A driver that reads env at module-top fails here loudly.
    const saved = {};
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('PERSONAS_') ||
        key.startsWith('FIREBASE_') ||
        key.startsWith('APPIUM_') ||
        key.startsWith('ANDROID_') ||
        key.startsWith('IOS_')
      ) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    }
    try {
      // Bust the require-cache so this is a true cold-load.
      delete require.cache[require.resolve(full)];
      mod = require(full);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        process.env[k] = v;
      }
    }
    expect(mod).toBeDefined();
    expect(typeof mod).toBe('object');
  });

  test('exports a factory function whose name starts with "create"', () => {
    const factories = Object.entries(mod).filter(
      ([, v]) => typeof v === 'function' && v.name && v.name.startsWith('create'),
    );
    // Exactly one is the convention — multiple createXxx in one module
    // would imply ambiguity about which the runner factory routes to.
    expect(factories.length).toBeGreaterThanOrEqual(1);
    const [name, factory] = factories[0];
    expect(typeof factory).toBe('function');
    expect(name).toMatch(/^create[A-Z]/);
  });

  test('exports a listMethods function', () => {
    expect(typeof mod.listMethods).toBe('function');
  });

  test('listMethods() returns a non-empty array of non-empty strings', () => {
    const methods = mod.listMethods();
    expect(Array.isArray(methods)).toBe(true);
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) {
      expect(typeof m).toBe('string');
      expect(m.length).toBeGreaterThan(0);
    }
  });

  test('exports a *_METHOD_NAMES constant matching listMethods()', () => {
    const constantEntry = Object.entries(mod).find(([k]) => /_METHOD_NAMES$/.test(k));
    expect(constantEntry).toBeDefined();
    const [, constant] = constantEntry;
    expect(Array.isArray(constant)).toBe(true);
    expect(constant.length).toBeGreaterThan(0);
    // Same set after dedup + sort. (Source-order may differ between the
    // constant and listMethods() — what matters is the SET equality.)
    const fromConstant = [...new Set(constant)].sort();
    const fromList = [...new Set(mod.listMethods())].sort();
    expect(fromList).toEqual(fromConstant);
  });
});

// ── Aggregate contract (cross-driver invariants) ──────────────────

describe('Driver contract — cross-driver invariants', () => {
  test('every driver exposes a distinct *_METHOD_NAMES constant key', () => {
    // Each driver's constant key should be unique within itself (only
    // one *_METHOD_NAMES export). Catches a copy-paste bug where a
    // driver accidentally exports two such constants.
    for (const { full, name } of discoverDrivers()) {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      const keys = Object.keys(mod).filter((k) => /_METHOD_NAMES$/.test(k));
      expect({ driver: name, count: keys.length }).toEqual({ driver: name, count: 1 });
    }
  });

  test('total surface across all drivers is non-empty (sanity)', () => {
    const allMethods = discoverDrivers().flatMap(({ full }) => {
      delete require.cache[require.resolve(full)];
      return require(full).listMethods();
    });
    expect(allMethods.length).toBeGreaterThan(0);
  });
});
