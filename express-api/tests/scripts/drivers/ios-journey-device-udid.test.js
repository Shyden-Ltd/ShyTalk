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
    //
    // `async` is optional because the anchor has already gone stale once: the
    // method became `async launch()` when it moved to `activate_app`, the
    // slice went empty, and BOTH assertions below started failing about the
    // uuid — which is not what had changed. That is the failure mode of every
    // source-scanning guard, and the reason `foundLaunchMethod` is asserted
    // separately: it names the drift instead of blaming the payload.
    const block = src.match(/^ {2}(?:async )?launch\(\) \{[\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({ foundLaunchMethod: block !== '' }).toEqual({ foundLaunchMethod: true });
    expect({
      passesCoreDevice: /'--device',\s*\n\s*this\.serial,/.test(block),
    }).toEqual({ passesCoreDevice: true });
  });
});

/**
 * A session is REPLACED, not reused, when WebDriverAgent dies with the app.
 *
 * The runner's dump-retry opens a fresh session and `_sessionId` moves on, so a
 * teardown that closes only the current id orphans the previous one. Measured on
 * a real run: 14 sessions created, 13 removed. The survivor then expires on
 * `newCommandTimeout` 300 seconds later, and two runs inside that window collide
 * — which is how a "test runner failed to initialize" took out a run that had
 * nothing else wrong with it.
 */
describe('IosDevice closes every session it opened', () => {
  const build = () =>
    new IosDevice({
      coreDeviceUuid: CORE_DEVICE_UUID,
      hardwareUdid: HARDWARE_UDID,
      bundleId: 'com.shyden.shytalk',
    });

  test('a replaced session is remembered so it can be closed', () => {
    const d = build();
    // Stand in for what `_session()` records as WDA dies and is replaced.
    d._allSessionIds.add('first');
    d._sessionId = 'second';
    d._allSessionIds.add('second');
    expect([...d._allSessionIds].sort()).toEqual(['first', 'second']);
  });

  test('quit deletes the superseded id as well as the current one', async () => {
    const deleted = [];
    const original = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts?.method === 'DELETE') deleted.push(String(url).split('/session/')[1]);
      return { ok: true, json: async () => ({}) };
    };
    try {
      const d = build();
      d._allSessionIds.add('superseded');
      d._sessionId = 'current';
      d._allSessionIds.add('current');
      await d.quit();
      expect(deleted.sort()).toEqual(['current', 'superseded']);
    } finally {
      global.fetch = original;
    }
  });

  test('one refusal does not strand the rest', async () => {
    // Best-effort per id. The superseded session's WDA is usually already dead,
    // so its DELETE is the one most likely to fail — and it must not prevent
    // the live one being released.
    const deleted = [];
    const original = global.fetch;
    global.fetch = async (url, opts) => {
      const id = String(url).split('/session/')[1];
      if (id === 'dead') throw new Error('ECONNREFUSED');
      if (opts?.method === 'DELETE') deleted.push(id);
      return { ok: true, json: async () => ({}) };
    };
    try {
      const d = build();
      d._allSessionIds.add('dead');
      d._sessionId = 'live';
      d._allSessionIds.add('live');
      await d.quit();
      expect(deleted).toEqual(['live']);
      expect(d._sessionId).toBeNull();
    } finally {
      global.fetch = original;
    }
  });
});
