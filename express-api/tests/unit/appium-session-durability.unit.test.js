/**
 * An Appium session must outlive the gaps between Appium calls.
 *
 * THE BUG THIS EXISTS TO PREVENT (found 2026-08-01, run 20260801-113726-local):
 *
 * Appium's `newCommandTimeout` defaults to SIXTY SECONDS. If no command
 * arrives in that window, Appium destroys the session. A journey scenario
 * routinely spends longer than that between device calls — it seeds Firestore,
 * calls the API, waits on assertions — so the session was being killed
 * mid-scenario through no fault of the device.
 *
 * Every call after that failed. With the new I/O bound each one failed after
 * thirty seconds instead of hanging forever, so the cell ground on at 30s per
 * call for the rest of the run:
 *
 *   [mobile-safari-ios] in-page evaluate failed: no response within 30000ms
 *   from http://localhost:4723/session… — the device or its agent stopped
 *   answering
 *
 * …repeated indefinitely. The timeout fix turned an infinite hang into a
 * survivable-but-useless crawl; THIS is the root cause underneath it.
 *
 * The capability is asserted from source rather than by opening a session,
 * because the point is that it can never be omitted again — including on a
 * driver added later, which is why every Appium-speaking driver is discovered
 * rather than listed.
 */
const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.join(__dirname, '../../scripts/drivers');

/** Every driver that creates an Appium session, found rather than enumerated. */
function appiumDrivers() {
  return fs
    .readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => {
      const src = fs.readFileSync(path.join(DRIVERS_DIR, f), 'utf8');
      return src.includes('/session') && src.includes('appium:automationName');
    });
}

/** The value given to a capability in a driver's session payload. */
function capabilityValue(src, name) {
  const m = new RegExp(`['"]${name}['"]\\s*:\\s*([^,\\n]+)`).exec(src);
  return m ? m[1].trim() : null;
}

describe('every Appium driver is discovered, not listed', () => {
  it('finds all three (native iOS, Safari, WebKit-family browsers)', () => {
    // A vacuous scan would make every assertion below pass silently.
    expect(appiumDrivers().length).toBeGreaterThanOrEqual(3);
  });
});

describe('newCommandTimeout is set high enough to survive a scenario', () => {
  it.each(appiumDrivers())('%s sets appium:newCommandTimeout', (file) => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    // Absent means Appium's 60s default, which is shorter than the gap
    // between device calls in a normal journey scenario.
    expect(capabilityValue(src, 'appium:newCommandTimeout')).not.toBeNull();
  });

  it.each(appiumDrivers())('%s allows well over Appium’s 60s default', (file) => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    const raw = capabilityValue(src, 'appium:newCommandTimeout');
    const value = Number(String(raw).replace(/[^0-9]/g, ''));
    // 0 means "never expire", which is also acceptable — the session then
    // lives until the driver closes it, which is exactly the desired
    // lifetime for a cell that owns the device for the whole run.
    const neverExpires = value === 0;
    expect(neverExpires || value >= 600).toBe(true);
  });

  it.each(appiumDrivers())('%s explains WHY, so nobody trims it back', (file) => {
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    const at = src.indexOf('newCommandTimeout');
    // A bare number invites a future reader to "tidy" it back to the default.
    const context = src.slice(Math.max(0, at - 600), at + 200);
    expect(context).toMatch(/60|default|expire|kill|destroy/i);
  });
});

describe('the session payload keeps the capabilities that make it usable', () => {
  it.each(appiumDrivers())('%s still pins the automation name and udid', (file) => {
    // Guards against a careless edit to the caps block: dropping either turns
    // every session into a different, silently-wrong target.
    const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
    expect(capabilityValue(src, 'appium:automationName')).toMatch(/XCUITest/);
    expect(capabilityValue(src, 'appium:udid')).not.toBeNull();
  });
});
