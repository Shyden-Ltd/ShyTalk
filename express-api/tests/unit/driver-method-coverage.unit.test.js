/**
 * The corpus must never outrun its drivers again.
 *
 * SHY-0259. On 2026-08-01 this repo had **179 of 217** driver methods that the
 * runner could call and no driver defined. Every one produced
 * `ctx.<driver>.<name> not configured` at runtime — a harness gap that reads
 * exactly like a product defect in a matrix report, which is why a whole
 * gauntlet run could not be used as a quality signal.
 *
 * That was allowed to happen because nothing checked. The corpus and the
 * drivers were edited independently and drifted for months, and the drift only
 * became visible when failure reasons started being saved.
 *
 * This test is the check. It is deliberately mechanical: it reads every
 * `ctx.uiDriver.X` / `ctx.webDriver.X` the runner mentions and asserts each
 * name is defined somewhere under scripts/drivers/. It needs no device, no
 * emulator and no browser, so it can gate a PR in milliseconds — the whole
 * point being that a device-time discovery of this class costs hours.
 */
const fs = require('fs');
const path = require('path');

const RUNNER = path.join(__dirname, '../../scripts/manual-qa-runner.js');
const DRIVERS_DIR = path.join(__dirname, '../../scripts/drivers');

const runnerSrc = fs.readFileSync(RUNNER, 'utf8');
const driverSrc = fs
  .readdirSync(DRIVERS_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(DRIVERS_DIR, f), 'utf8'))
  .join('\n');

/** Every driver method name the runner can demand at runtime. */
function referencedMethods() {
  const found = new Map();
  for (const m of runnerSrc.matchAll(/ctx\.(uiDriver|webDriver)\.([A-Za-z0-9_]+)/g)) {
    if (!found.has(m[2])) found.set(m[2], m[1]);
  }
  return found;
}

describe('every driver method the runner calls exists', () => {
  it('has at least a hundred references — proof the scan actually found them', () => {
    // A regex that silently matched nothing would make this whole suite pass
    // vacuously, which is the failure mode of most "check everything" tests.
    expect(referencedMethods().size).toBeGreaterThan(100);
  });

  it('leaves ZERO methods undefined', () => {
    const missing = [...referencedMethods().keys()].filter((name) => !driverSrc.includes(name));
    // Named in the failure so the fix is obvious without re-running anything.
    expect(missing).toEqual([]);
  });

  it('detects a genuinely absent method — the check is not vacuous', () => {
    // Mutation in miniature: a name that certainly does not exist must be
    // reported. Without this, an always-true `includes` would look healthy.
    const invented = 'androidDefinitelyNotARealDriverMethodXyz';
    expect(driverSrc.includes(invented)).toBe(false);
  });
});

describe('no driver method is a placeholder', () => {
  // A stub is worse than a missing method: the call resolves, the step passes,
  // and the cell goes green having exercised nothing. The repo bans doubles
  // outside unit-test locations for exactly this reason.
  it.each(
    fs
      .readdirSync(DRIVERS_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => [f]),
  )('%s contains no stub: markers', (file) => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    const stubs = [...src.matchAll(/'stub:[a-zA-Z0-9_]+'/g)].map((m) => m[0]);
    expect(stubs).toEqual([]);
  });
});

describe('capability reporting is honest where a surface genuinely cannot act', () => {
  // Three places cannot do what the corpus asks on the hardware available.
  // Each must SAY so rather than return a cheerful boolean — a silent no-op
  // lets a scenario pass having tested nothing, which is the precise species
  // of false confidence this story exists to remove.
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
});
