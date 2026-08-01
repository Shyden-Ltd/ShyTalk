/**
 * NO driver may talk to a device without a bound and a breaker.
 *
 * THE BUG THIS EXISTS TO PREVENT: I fixed the unbounded-I/O stall by wrapping
 * the Appium drivers and adb — and MISSED web-mobile-firefox-android-driver,
 * which speaks HTTP to geckodriver and was equally unbounded. Nothing failed.
 * The per-driver tests all passed, because each one only checks the driver it
 * is about, and no test asked the question that actually matters:
 *
 *   "is there ANY driver left that can block forever?"
 *
 * That is the same shape as the coverage guard that reported zero gaps while
 * 415 existed: a per-instance check cannot answer a universal question. So
 * this file DISCOVERS the drivers rather than listing them — a new driver is
 * held to the rule the moment it is added, without anyone remembering to come
 * back here.
 */
const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.join(__dirname, '../../scripts/drivers');

/** Modules that are support code, not device-driving drivers. */
const NOT_DRIVERS = new Set([
  'android-cdp-helpers.js',
  'ios-driver-loader.js',
  'driver-screenshot-helper.js',
  'ui-dump-retry.js',
  'ui-dump-query.js',
  'ios-element-query.js',
  'web-common-methods.js',
  'device-lock.js',
  'render-timing.js',
  'device-io-timeout.js',
  'device-shell.js',
  'surface-circuit-breaker.js',
  'firebase-admin-driver.js', // talks to Firebase Admin, not a device
]);

function driverFiles() {
  return fs.readdirSync(DRIVERS_DIR).filter((f) => f.endsWith('.js') && !NOT_DRIVERS.has(f));
}

const read = (f) => fs.readFileSync(path.join(DRIVERS_DIR, f), 'utf8');

/** Drivers that reach a device over HTTP (Appium, geckodriver, WebDriver). */
function httpDrivers() {
  return driverFiles().filter((f) => /fetchImpl|globalThis\.fetch/.test(read(f)));
}

/** Source with comments stripped — a mention in prose is not a call site. */
function code(file) {
  return (
    read(file)
      // The classic linear-time block-comment pattern. A lazy `[\s\S]*?`
      // backtracks super-linearly on a file with many comments, which every
      // driver here is — and these files are large.
      .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '')
      // `[ \t]*` for indentation and `[^\n]*` for the body: `\s` matches
      // newlines and `.*$` with /m invites the same backtracking.
      .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  );
}

/** Drivers that shell out to a device tool (adb, xcrun, devicectl). */
function execDrivers() {
  // Comments stripped first: web-mobile-chrome-android-driver only MENTIONS
  // execFileSync in its docstring, and counting that reported it as an
  // unbounded exec driver when it shells out via a helper module.
  return driverFiles().filter((f) => /exec(?:File)?Sync\(/.test(code(f)));
}

describe('the scan finds real drivers — not vacuously empty', () => {
  it('discovers the driver set', () => {
    expect(driverFiles().length).toBeGreaterThanOrEqual(9);
  });

  it('finds several HTTP-speaking drivers', () => {
    // Appium native iOS, Safari, WebKit-family, geckodriver — at least four.
    expect(httpDrivers().length).toBeGreaterThanOrEqual(4);
  });

  it('finds the exec-based drivers', () => {
    expect(execDrivers().length).toBeGreaterThanOrEqual(2);
  });
});

describe('every HTTP-speaking driver bounds its calls', () => {
  it.each(httpDrivers())('%s wraps fetch in boundedFetch', (file) => {
    // Node's fetch waits FOREVER. One unbounded call is a two-hour cell.
    const src = read(file);
    expect(src).toContain('boundedFetch');
  });

  it.each(httpDrivers())('%s does not use the raw fetch parameter directly', (file) => {
    // The giveaway for an unbounded driver: `fetchImpl = globalThis.fetch`
    // used as-is, rather than renamed to a raw handle and wrapped.
    const src = read(file);
    // `[ \t]*` not `\s*`: what precedes it is indentation, and \s matches
    // newlines, letting the engine backtrack across the whole file.
    const usesRawParam = /^[ \t]*fetchImpl = globalThis\.fetch,/m.test(src);
    expect(usesRawParam).toBe(false);
  });
});

describe('every device-driving surface has a circuit breaker', () => {
  it.each([...new Set([...httpDrivers(), ...execDrivers()])])(
    '%s can stop grinding on a dead surface',
    (file) => {
      // Bounding one call is not enough: after the surface dies, EVERY
      // remaining call pays its full timeout. Run 20260801-113726-local spent
      // the rest of its life at 30s per call against a destroyed session.
      const src = read(file);
      expect(src).toContain('surface-circuit-breaker');
    },
  );
});

describe('every exec-based driver bounds its subprocesses', () => {
  it.each(execDrivers())('%s passes a timeout to every exec', (file) => {
    // `execSync`/`execFileSync` block forever without one.
    const src = code(file);
    // Either the shared helper, or an explicit timeout on every call.
    const usesHelper = src.includes('execBounds');
    const execCalls = (src.match(/exec(?:File)?Sync\(/g) || []).length;
    const withTimeout = (src.match(/timeout:\s*\d+/g) || []).length;
    expect(usesHelper || withTimeout >= execCalls).toBe(true);
  });

  it.each(execDrivers())('%s never builds a shell command string', (file) => {
    // execSync(string) runs a shell; execFileSync(file, argv) does not.
    // The adb driver interpolated arguments into a command line until
    // 2026-08-01 — a command-injection surface AND, because it hid the
    // device-side shell, a live escaping bug.
    const src = code(file);
    const shellCalls = src.match(/\bexecSync\(/g) || [];
    expect(shellCalls).toEqual([]);
  });
});

describe('the bound is a guarantee, not a request', () => {
  it('boundedFetch races rather than only aborting', () => {
    // An AbortController only ASKS the transport to stop. A transport that
    // has stopped responding — the exact case — may never honour it. My
    // first version did abort-only and hung exactly like the unbounded call
    // it replaced.
    const src = fs.readFileSync(path.join(DRIVERS_DIR, 'device-io-timeout.js'), 'utf8');
    expect(src).toMatch(/Promise\.race/);
  });
});

/**
 * "The module loads" proves nothing about code inside a function body.
 *
 * THE BUG THIS EXISTS TO PREVENT: while wiring the breaker into the
 * geckodriver driver, the `require` lines were never added — the anchor my
 * edit looked for was not in that file. `node -e "require(driver)"` still
 * succeeded, because the undefined references live inside the factory, which
 * nothing had called. I read that as proof the change was fine.
 *
 * Same shape as `exit 0 ≠ it ran`: a check that cannot reach the code it is
 * supposed to be checking.
 */
describe('every symbol a driver uses is actually imported', () => {
  const SHARED_HELPERS = [
    'boundedFetch',
    'createSurfaceBreaker',
    'execBounds',
    'describeExecFailure',
    'quoteAdbArgs',
    'deviceShellArg',
    'createSubmitClock',
    'attachCommonWebMethods',
  ];

  it.each(driverFiles())('%s imports every shared helper it references', (file) => {
    const src = code(file);
    const missing = SHARED_HELPERS.filter((name) => {
      // Referenced as a call, but never bound by a require/destructure.
      const called = new RegExp(`\\b${name}\\s*\\(`).test(src);
      if (!called) return false;
      const imported =
        new RegExp(`\\b${name}\\b[^\\n]*=\\s*require`).test(src) ||
        new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require`, 's').test(src) ||
        new RegExp(`require\\([^)]*\\)\\.${name}`).test(src) ||
        new RegExp(`function\\s+${name}\\b`).test(src) ||
        new RegExp(`const\\s+${name}\\s*=`).test(src);
      return !imported;
    });
    expect(missing).toEqual([]);
  });
});
