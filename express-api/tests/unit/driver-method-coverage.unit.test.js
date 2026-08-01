/**
 * The corpus must never outrun its drivers again.
 *
 * SHY-0259. On 2026-08-01 this repo had 179 driver methods the runner could
 * call and no driver defined. Every one produced `ctx.<driver>.<name> not
 * configured` at runtime — a harness gap that reads exactly like a product
 * defect in a matrix report, which is why a whole gauntlet run could not be
 * used as a quality signal.
 *
 * THE FIRST VERSION OF THIS GUARD DID NOT WORK, and how it failed is the
 * reason the checks below look the way they do. It asked
 * `allDriverSource.includes(name)`. That is a SUBSTRING test over the
 * concatenation of every driver file, so:
 *
 *   - `webTap` "existed" because `webTapNamedButton` does;
 *   - a name in a COMMENT satisfied it;
 *   - a method on ONE of the seven web drivers counted for all seven.
 *
 * The guard was green while 415 driver-cell combinations were missing, and a
 * live gauntlet run found them instead. So the extraction now lives in
 * scripts/driver-surface-report.js — one home for the fact — and this file
 * asserts against it rather than re-deriving it, because a test carrying its
 * own copy of the logic can pass while the thing it guards is broken.
 */
const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.join(__dirname, '../../scripts/drivers');
const report = require('../../scripts/driver-surface-report');
const { coverageGaps, referencedMethods, definedMethods, platformOf, MATRIX_DRIVERS } = report;

describe('every matrix driver answers everything the runner can ask it', () => {
  const gaps = coverageGaps();

  it('covers all nine drivers the twelve cells construct', () => {
    // A gate that silently measured zero drivers would pass vacuously — the
    // failure mode of most "check everything" tests.
    expect(gaps).toHaveLength(9);
    expect(MATRIX_DRIVERS.map((d) => d.file)).toContain('ios-appium-driver.js');
  });

  it.each(coverageGaps().map((g) => [g.driver, g]))('%s has no missing methods', (_name, gap) => {
    // Named in the failure so the fix list needs no second command.
    expect(gap.missing).toEqual([]);
  });

  it.each(coverageGaps().map((g) => [g.driver, g]))(
    '%s declares nothing it does not implement',
    (_name, gap) => {
      // A declared-but-unimplemented name used to be wired to a stub that
      // returned false, which the runner scored as the PRODUCT failing.
      expect(gap.stubbed).toEqual([]);
    },
  );
});

describe('the reference scan is not vacuous', () => {
  it('finds over a hundred runner-referenced methods', () => {
    const refs = referencedMethods();
    expect(refs.webDriver.size).toBeGreaterThan(100);
    expect(refs.uiDriver.size).toBeGreaterThan(100);
  });

  it('reads the ctx namespaces the runner actually uses', () => {
    expect(Object.keys(referencedMethods()).sort()).toEqual([
      'firebaseAdmin',
      'uiDriver',
      'webDriver',
    ]);
  });

  it('ignores ctx properties that are not drivers', () => {
    const refs = referencedMethods('ctx.sessions.get("a"); ctx.uiDriver.androidTap();');
    expect(Object.keys(refs)).toEqual(['uiDriver']);
    expect([...refs.uiDriver]).toEqual(['androidTap']);
  });
});

describe('definition detection, not substring matching', () => {
  // The exact bug that let 415 gaps through. If someone reaches for
  // `src.includes(name)` again, THIS fails rather than a gauntlet run.
  it('does not report a method present because a LONGER name contains it', () => {
    const defined = definedMethods('web-common-methods.js');
    // Both are real methods today, so the pair proves the discrimination
    // rather than merely asserting one absent name.
    expect(defined.has('webTapNamedButton')).toBe(true);
    expect(defined.has('webTap')).toBe(true);
    // The discriminator: a name that is a strict prefix of a defined one and
    // is NOT itself defined must be reported absent.
    expect(defined.has('webTapNamed')).toBe(false);
  });

  it('does not count a name that appears only in a comment', () => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, 'web-playwright-driver.js'), 'utf8');
    // `stub` appears in prose in that file; it is not a method.
    expect(src).toContain('stub');
    expect(definedMethods('web-playwright-driver.js').has('stub')).toBe(false);
  });

  it('finds a definition whose name prettier wrapped onto the next line', () => {
    // Measured 2026-08-01: running prettier over web-common-methods.js moved
    // four `def(` calls onto their own line, and an extraction that required
    // `def('` adjacent silently reported 24 methods missing. The regex must
    // describe the CODE, not its layout — the same class as the earlier test
    // that pinned a swipe duration prettier then re-wrapped.
    const src = fs.readFileSync(path.join(DRIVERS_DIR, 'web-common-methods.js'), 'utf8');
    const wrapped = [...src.matchAll(/\bdef\(\n\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
    expect(wrapped.length).toBeGreaterThan(0); // the fixture is real, not hypothetical
    const defined = definedMethods('web-common-methods.js');
    for (const name of wrapped) expect(defined.has(name)).toBe(true);
  });

  it('resolves the shared web surface through the mixin', () => {
    // A mobile driver defines four methods of its own; everything else it
    // answers comes from attachCommonWebMethods. Counting only its own file
    // is what made six of seven web drivers look complete.
    const own = definedMethods('web-common-methods.js');
    const mobile = definedMethods('web-mobile-safari-ios-driver.js');
    expect(own.size).toBeGreaterThan(90);
    for (const m of own) expect(mobile.has(m)).toBe(true);
    expect(mobile.has('webUiDump')).toBe(true); // its own, not the mixin's
  });
});

describe('platform routing', () => {
  it.each([
    ['androidTap', 'android'],
    ['iosUiDump', 'ios'],
    ['webOpenScreen', 'web'],
    ['showsCardBadge', null],
    // Prefix must be followed by a capital: `iosolate` is not an iOS method.
    ['android', null],
    ['iosolate', null],
  ])('%s belongs to %s', (name, expected) => {
    expect(platformOf(name)).toBe(expected);
  });

  it('does not hold a driver accountable for another platform', () => {
    // The naive union asked android-adb for 47 `ios*` methods and called them
    // gaps. Holding a driver to work it can never do inflates the number and
    // buries the real ones.
    const android = coverageGaps().find((g) => g.driver === 'android-adb-driver');
    expect(android.missing).toEqual([]);
    expect(referencedMethods().uiDriver.has('iosUiDump')).toBe(true);
    expect(definedMethods('android-adb-driver.js').has('iosUiDump')).toBe(false);
  });
});

describe('no driver wires a stub loop', () => {
  const DRIVER_FILES = fs.readdirSync(DRIVERS_DIR).filter((f) => f.endsWith('.js'));

  it.each(DRIVER_FILES)('%s does not mass-assign placeholder bodies', (file) => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    // The previous stub detector matched /'stub:[a-zA-Z0-9_]+'/ — single
    // quotes — while every actual stub was a BACKTICK template
    // (`stub:${methodName}`). It matched nothing for as long as it existed.
    // This matches the real shape, in either quoting.
    expect(src).not.toMatch(/stub:\$\{|['"`]stub:[a-zA-Z0-9_]+/);
    // The loop itself, independent of what it logs.
    expect(src).not.toMatch(/for\s*\(\s*const\s+\w+\s+of\s+listMethods\(\)\s*\)/);
  });
});

describe('capability reporting is honest where a surface genuinely cannot act', () => {
  // Some things cannot be done on the hardware available. Each must SAY so
  // rather than return a cheerful boolean — a silent no-op lets a scenario
  // pass having tested nothing, which is the precise species of false
  // confidence this story exists to remove.
  const cases = [
    [
      'ios-appium-driver.js',
      'iosNetworkLinkConditioner',
      'network conditioning needs Developer settings',
    ],
    ['web-playwright-driver.js', 'webSetNetwork', 'CDP emulation is Chromium-only'],
    ['web-playwright-driver.js', 'advanceClockToStartsAt', 'the emulator has no time travel'],
    ['android-adb-driver.js', 'androidPerformAuthenticatedCall', 'needs the in-app debug hook'],
  ];

  it.each(cases)('%s :: %s reports supported:false with a reason (%s)', (file, method) => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    const at = src.indexOf(`driver.${method} =`);
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1200);
    expect(body).toContain('supported: false');
    expect(body).toMatch(/why:/);
  });

  it('the shared web surface refuses network shaping it cannot perform', () => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, 'web-common-methods.js'), 'utf8');
    const at = src.indexOf("def('webSetNetwork'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 800)).toContain('supported: false');
  });
});

describe('every WEB driver carries the shared web surface', () => {
  const WEB_DRIVERS = fs.readdirSync(DRIVERS_DIR).filter((f) => /^web-.*-driver\.js$/.test(f));

  it('finds all seven web drivers', () => {
    expect(WEB_DRIVERS).toHaveLength(7);
  });

  it.each(WEB_DRIVERS)('%s answers the full referenced web surface', (file) => {
    // Checked against the WHOLE referenced set, not a representative sample.
    // The sample version passed while sixty-eight methods were missing from
    // six of these seven drivers.
    const wanted = [...referencedMethods().webDriver].filter(
      (n) => platformOf(n) === null || platformOf(n) === 'web',
    );
    const defined = definedMethods(file);
    expect(wanted.filter((n) => !defined.has(n))).toEqual([]);
  });
});
