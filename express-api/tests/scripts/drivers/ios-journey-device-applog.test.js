/**
 * ios-journey-device-applog.test.js
 *
 * The iPhone's live syslog relay is lossy under WebDriverAgent load. On
 * 2026-09-05 it silently stopped delivering nearly every process's lines at
 * 08:35:17 WIB, before J40 began, and stayed that way for the rest of the run;
 * a second client got nothing either. The runner read an empty log and failed
 * the journey with "drew null" while the persisted archive on the device held
 * every line. So the driver no longer streams: clearAppLog() takes a mark from
 * the DEVICE clock, and readAppLog() pulls the persisted archive from that
 * mark and reads it back with `log show`.
 *
 * These tests hold the seam: which tool is asked what, in which order, and
 * that the mark, not the pull time, decides which lines are "this launch".
 * No device: every tool is a recorded fake; the real phone proves the lines.
 */

const fs = require('node:fs');

const { IosDevice } = require('../../../scripts/drivers/ios-journey-device');

const CORE_DEVICE_UUID = 'CEB70A3C-894C-471F-A1BA-6DBCB874CFB4';
const HARDWARE_UDID = '00008150-000954D90A20401C';

/** 2026-09-05 08:36:20.500 +07:00, between the two launches in the fixture. */
const MARK = 1788572180.5;

const FIXTURE = [
  '2026-09-05 08:36:16.100000+0700  localhost iosApp[1499]: (iosApp.debug.dylib) [com.shyden.shytalk:app] D/ColdStartSequencer: immediate: destination=SignIn (no I/O)',
  '2026-09-05 08:36:24.687692+0700  localhost iosApp[1501]: (iosApp.debug.dylib) [com.shyden.shytalk:app] D/ColdStartSequencer: immediate: destination=Main (no I/O)',
  '2026-09-05 08:36:25.000000+0700  localhost iosApp[1501]: (iosApp.debug.dylib) [com.shyden.shytalk:app] D/IosAuthRepository: persisted session: restored by the SDK',
  '2026-09-05 08:36:26.000000+0700  localhost iosApp[1501]: (iosApp.debug.dylib) [com.shyden.shytalk:app] D/ColdStartSequencer: confirmed: claim refreshed, reads starting',
  '',
].join('\n');

const fakeRun = (answers = {}) => {
  const calls = [];
  const run = (bin, args) => {
    calls.push([bin, args]);
    const answer = answers[bin];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(args) : (answer ?? '');
  };
  run.calls = calls;
  run.of = (bin) => calls.filter(([b]) => b === bin);
  return run;
};

const build = (run) => {
  const device = new IosDevice({
    coreDeviceUuid: CORE_DEVICE_UUID,
    hardwareUdid: HARDWARE_UDID,
    bundleId: 'com.shyden.shytalk.local',
  });
  device._run = run;
  device._warn = () => {};
  return device;
};

describe('clearAppLog() marks the device clock', () => {
  test('asks the phone for its own time and keeps it as the mark', async () => {
    const run = fakeRun({ ideviceinfo: `${MARK}\n` });
    const device = build(run);
    await device.clearAppLog();
    expect(run.calls).toEqual([
      ['ideviceinfo', ['-u', HARDWARE_UDID, '-k', 'TimeIntervalSince1970']],
    ]);
    expect(device._logMark).toBe(MARK);
  });

  test('a clock the phone did not report is an error, not a mark of zero', async () => {
    const device = build(fakeRun({ ideviceinfo: 'ERROR: No device found.\n' }));
    await expect(device.clearAppLog()).rejects.toThrow(/device clock/);
  });
});

describe('readAppLog() reads the persisted archive from the mark', () => {
  test('before clearAppLog() there is no mark to read from', async () => {
    const device = build(fakeRun());
    await expect(device.readAppLog('ColdStartSequencer')).rejects.toThrow(/clearAppLog/);
  });

  test('pulls the archive from just before the mark and shows only the app process', async () => {
    const run = fakeRun({ ideviceinfo: `${MARK}\n`, '/usr/bin/log': FIXTURE });
    const device = build(run);
    await device.clearAppLog();
    await device.readAppLog('ColdStartSequencer');

    const [pull] = run.of('idevicesyslog');
    expect(pull[1].slice(0, 3)).toEqual(['-u', HARDWARE_UDID, 'archive']);
    expect(pull[1][3]).toMatch(/\.tar$/);
    expect(pull[1].slice(4)).toEqual(['--start-time', String(Math.floor(MARK) - 2)]);

    const [untar] = run.of('tar');
    expect(untar[1][0]).toBe('-xf');
    expect(untar[1][1]).toBe(pull[1][3]);
    expect(untar[1][3]).toMatch(/\.logarchive$/);

    const [show] = run.of('/usr/bin/log');
    const args = show[1];
    expect(args[0]).toBe('show');
    expect(args[args.indexOf('--archive') + 1]).toBe(untar[1][3]);
    expect(args[args.indexOf('--predicate') + 1]).toBe('process == "iosApp"');
    expect(args).toEqual(expect.arrayContaining(['--info', '--debug', '--style', 'syslog']));
    // `--start` is the Mac's local time, one second before the mark; parsing
    // the bare date-time form back gives local time, so this holds in any zone.
    const start = args[args.indexOf('--start') + 1];
    expect(new Date(start.replace(' ', 'T')).getTime() / 1000).toBe(Math.floor(MARK) - 1);
  });

  test('keeps the tagged lines stamped at or after the mark and nothing else', async () => {
    const run = fakeRun({ ideviceinfo: `${MARK}\n`, '/usr/bin/log': FIXTURE });
    const device = build(run);
    await device.clearAppLog();
    const lines = await device.readAppLog('ColdStartSequencer');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('iosApp[1501]');
    expect(lines[0]).toContain('immediate: destination=Main (no I/O)');
    expect(lines[1]).toContain('confirmed: claim refreshed, reads starting');
    expect(lines.join('\n')).not.toContain('iosApp[1499]');
    expect(lines.join('\n')).not.toContain('IosAuthRepository');
  });

  test('can be read again without a new mark, like a logcat dump', async () => {
    const run = fakeRun({ ideviceinfo: `${MARK}\n`, '/usr/bin/log': FIXTURE });
    const device = build(run);
    await device.clearAppLog();
    await device.readAppLog('ColdStartSequencer');
    const again = await device.readAppLog('ColdStartSequencer');
    expect(again).toHaveLength(2);
    expect(run.of('idevicesyslog')).toHaveLength(2);
    expect(run.of('ideviceinfo')).toHaveLength(1);
  });

  test('removes the pulled archive once it has been read', async () => {
    const run = fakeRun({ ideviceinfo: `${MARK}\n`, '/usr/bin/log': FIXTURE });
    const device = build(run);
    await device.clearAppLog();
    await device.readAppLog('ColdStartSequencer');
    const [untar] = run.of('tar');
    expect(fs.existsSync(untar[1][3])).toBe(false);
    expect(fs.existsSync(untar[1][1])).toBe(false);
  });

  test('a pull that fails throws with the tool’s words, never an empty log', async () => {
    const failure = Object.assign(new Error('Command failed'), {
      stderr: 'ERROR: Could not connect to lockdownd: No device found (-3)\n',
    });
    const run = fakeRun({ ideviceinfo: `${MARK}\n`, idevicesyslog: failure });
    const device = build(run);
    await device.clearAppLog();
    await expect(device.readAppLog('ColdStartSequencer')).rejects.toThrow(
      /Could not connect to lockdownd/,
    );
    expect(run.of('/usr/bin/log')).toHaveLength(0);
  });
});

describe('quit()', () => {
  test('has no capture to stop and touches no log tool', async () => {
    const run = fakeRun();
    const device = build(run);
    await device.quit();
    expect(run.calls).toEqual([]);
  });
});
