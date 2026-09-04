'use strict';

/**
 * SHY-0500 review (2026-09-04) — `readAppLog()` tore down the capture it read.
 *
 * On Android the app log is a logcat dump: the runner can read it as many
 * times as a journey needs, and J40 does — `drawnFirst()` reads it on a
 * mismatched first frame and the next step reads it again for the
 * `confirm:` verdict. On the iPhone the first read killed `idevicesyslog` and
 * forgot it, so the SECOND read threw "readAppLog() before clearAppLog()",
 * and any line the app logged after the first read was never captured at all.
 *
 * A read reports what has been captured so far and leaves the capture
 * running. Only `clearAppLog()` starts over, and `quit()` stops whatever is
 * still running so no capture outlives the run.
 */

const { EventEmitter } = require('node:events');

const { createIosJourneyDevice } = require('../../../scripts/drivers/ios-journey-device');

const TEST_HARDWARE_UDID = '00008150-000954D90A20401C';
const TAG = 'ColdStartSequencer';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = 0;
  child.kill = () => {
    child.kills += 1;
  };
  return child;
}

function device() {
  const spawned = [];
  const d = createIosJourneyDevice({
    udid: 'A'.repeat(36),
    hardwareUdid: TEST_HARDWARE_UDID,
    bundleId: 'com.example',
    warn: () => {},
  });
  d._spawn = (cmd, args) => {
    const child = fakeChild();
    spawned.push({ cmd, args, child });
    return child;
  };
  return { d, spawned };
}

const syslogLine = (text) => `Sep  4 07:00:00 iPhone iosApp(ShyTalk)[123] <Notice>: ${text}\n`;

describe('the iPhone app log can be read more than once per capture, like logcat', () => {
  test('a second read after one clearAppLog() returns the lines instead of throwing', async () => {
    const { d, spawned } = device();
    await d.clearAppLog();
    spawned[0].child.stdout.emit(
      'data',
      syslogLine(`${TAG}: immediate: destination=Main (no I/O)`),
    );

    const first = await d.readAppLog(TAG);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('immediate: destination=Main');

    spawned[0].child.stdout.emit(
      'data',
      syslogLine(`${TAG}: confirmed: claim refreshed, reads starting`),
    );
    const second = await d.readAppLog(TAG);
    expect(second).toHaveLength(2);
    expect(second[1]).toContain('confirmed: claim refreshed');
  });

  test('reading leaves the capture running; only the next clearAppLog() stops it and starts over', async () => {
    const { d, spawned } = device();
    await d.clearAppLog();
    spawned[0].child.stdout.emit(
      'data',
      syslogLine(`${TAG}: immediate: destination=SignIn (no I/O)`),
    );
    await d.readAppLog(TAG);
    await d.readAppLog(TAG);
    expect(spawned[0].child.kills).toBe(0);

    await d.clearAppLog();
    expect(spawned[0].child.kills).toBe(1);
    expect(spawned).toHaveLength(2);
    spawned[1].child.stdout.emit(
      'data',
      syslogLine(`${TAG}: immediate: destination=Main (no I/O)`),
    );
    const fresh = await d.readAppLog(TAG);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toContain('destination=Main');
  });

  test('the capture follows the app PROCESS name, which is not the bundle name', async () => {
    const { d, spawned } = device();
    await d.clearAppLog();
    expect(spawned[0].cmd).toBe('idevicesyslog');
    expect(spawned[0].args).toEqual(['-u', TEST_HARDWARE_UDID, '-p', 'iosApp']);
  });

  test('readAppLog() before any clearAppLog() still refuses, so a journey cannot read a capture that never started', async () => {
    const { d } = device();
    await expect(d.readAppLog(TAG)).rejects.toThrow('readAppLog() before clearAppLog()');
  });

  test('quit() stops a capture left running, so no idevicesyslog outlives the run', async () => {
    const { d, spawned } = device();
    await d.clearAppLog();
    await d.readAppLog(TAG);
    expect(spawned[0].child.kills).toBe(0);
    await d.quit();
    expect(spawned[0].child.kills).toBe(1);
  });
});
