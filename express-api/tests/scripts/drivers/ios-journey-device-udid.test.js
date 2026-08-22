/**
 * ios-journey-device-udid.test.js
 *
 * An iPhone has TWO identifiers that look alike and are not interchangeable:
 *
 *   CoreDevice UUID   CEB70A3C-894C-471F-A1BA-6DBCB874CFB4   <- xcrun devicectl
 *   hardware UDID     00008150-000954D90A20401C              <- appium:udid
 *
 * Both are dash-separated hex. Neither is labelled at the call site. Feed the
 * CoreDevice UUID to Appium and it answers:
 *
 *   Unknown device or simulator UDID: 'CEB70A3C-...'
 *
 * `IosDevice` stored ONE value and spent it on both, so it could never open a
 * session — every iOS journey died at capability negotiation, before a single
 * step ran. `ios-appium-driver.js` documents this exact trap in its own
 * docstring, and uses this exact UDID as the example, which is what makes the
 * conflation worth pinning: the knowledge existed and the seam still got it
 * wrong.
 *
 * That is the shape these tests defend. Each side is individually correct; only
 * the JUNCTION is wrong, and a test that exercises either side alone stays
 * green through it. See [[feedback-assert-the-seam-not-the-sides]].
 *
 * Pure construction — no device, no Appium, no mocks. The real phone proves the
 * session opens; this proves the right string reaches the right consumer.
 */

const fs = require('node:fs');
const path = require('node:path');

const { IosDevice } = require('../../../scripts/drivers/ios-journey-device');

/** Deliberately distinct, so a swap cannot pass by coincidence. */
const CORE_DEVICE_UUID = 'CEB70A3C-894C-471F-A1BA-6DBCB874CFB4';
const HARDWARE_UDID = '00008150-000954D90A20401C';

const build = (over = {}) =>
  new IosDevice({
    coreDeviceUuid: CORE_DEVICE_UUID,
    hardwareUdid: HARDWARE_UDID,
    bundleId: 'com.shyden.shytalk.local',
    ...over,
  });

describe('IosDevice identifier routing', () => {
  test('Appium is given the HARDWARE udid', () => {
    expect(build().capabilities()['appium:udid']).toBe(HARDWARE_UDID);
  });

  test('Appium is never given the CoreDevice UUID', () => {
    // Stated separately from the assertion above, because THIS is the failure
    // that was shipped, and it should be named in the output when it returns.
    expect({ sentToAppium: build().capabilities()['appium:udid'] }).toEqual({
      sentToAppium: HARDWARE_UDID,
    });
  });

  test('devicectl is given the CoreDevice UUID', () => {
    // `serial` is what launch() hands to `xcrun devicectl --device`.
    expect(build().serial).toBe(CORE_DEVICE_UUID);
  });

  test('both identifiers survive construction independently', () => {
    const d = build();
    expect({ core: d.coreDeviceUuid, hw: d.hardwareUdid }).toEqual({
      core: CORE_DEVICE_UUID,
      hw: HARDWARE_UDID,
    });
  });

  test('the capabilities name the app under test and pin XCUITest', () => {
    const caps = build().capabilities();
    expect({
      platform: caps.platformName,
      automation: caps['appium:automationName'],
      bundleId: caps['appium:bundleId'],
    }).toEqual({
      platform: 'iOS',
      automation: 'XCUITest',
      bundleId: 'com.shyden.shytalk.local',
    });
  });

  test('a missing hardware udid throws instead of sending undefined to Appium', () => {
    // Appium answers `Unknown device or simulator UDID: 'undefined'`, which
    // reads as a device problem and sends you to the cable. Failing here names
    // the real cause.
    expect(() => build({ hardwareUdid: undefined })).toThrow(/hardware udid/i);
  });

  test('a missing CoreDevice uuid throws instead of failing later at launch', () => {
    expect(() => build({ coreDeviceUuid: undefined })).toThrow(/coredevice/i);
  });

  test('the two identifiers must not be the same value', () => {
    // If a future caller resolves one detector for both, every test above
    // still passes while the bug is fully restored.
    expect(() => build({ hardwareUdid: CORE_DEVICE_UUID })).toThrow(/same/i);
  });
});

describe('source-level guard', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../scripts/drivers/ios-journey-device.js'),
    'utf8',
  );

  test('`appium:udid` is bound to the hardware udid at its only assignment', () => {
    // Anchored to the FIELD, not to the presence of the string anywhere in the
    // file — a docstring mentioning appium:udid would otherwise satisfy a
    // looser grep. See [[feedback-source-scanning-guards-need-their-own-anchors]].
    const assignments = src.match(/'appium:udid':\s*([^,\n]+)/g) || [];
    expect({ assignments }).toEqual({
      assignments: ["'appium:udid': this.hardwareUdid"],
    });
  });

  test('devicectl --device is bound to the CoreDevice uuid', () => {
    // Anchored to the METHOD DEFINITION at line start. `indexOf('launch()')`
    // matches the class docstring first — which listed both method names on
    // one line, so the slice was a fragment of a COMMENT and the regex could
    // never match. A guard that scans the wrong region reports on nothing.
    const block = src.match(/^ {2}launch\(\) \{[\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({ foundLaunchMethod: block !== '' }).toEqual({ foundLaunchMethod: true });
    expect({
      passesCoreDevice: /'--device',\s*\n\s*this\.serial,/.test(block),
    }).toEqual({ passesCoreDevice: true });
  });
});
