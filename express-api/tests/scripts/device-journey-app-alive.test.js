/**
 * The Android side of "a dead app fails loudly" (SHY-0500), and the J40 seam
 * that uses it on BOTH backends: after the revoked-session redirect the app
 * must still be running. On the iPhone it was not (SHY-0523) and the journey
 * passed anyway, because nothing asked.
 */

const fs = require('node:fs');
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', '..', 'scripts', 'device-journey-runner.js');
const { AndroidJourneyDevice } = require(RUNNER);
const { AppProcessDiedError } = require('../../scripts/drivers/app-process-death');

const PKG = 'com.shyden.shytalk.local';
const CRASH_BUFFER =
  '--------- beginning of crash\n' +
  '1757040000.123  4242  4242 E AndroidRuntime: FATAL EXCEPTION: main\n' +
  '1757040000.124  4242  4242 E AndroidRuntime: java.lang.IllegalStateException: boom';

/** A Device whose `adb shell` is scripted: command prefix -> stdout | Error | function. */
function device(responses) {
  const d = new AndroidJourneyDevice('SERIAL');
  d.calls = [];
  d.shell = (args) => {
    d.calls.push(args);
    for (const [prefix, out] of Object.entries(responses)) {
      if (!args.startsWith(prefix)) continue;
      if (out instanceof Error) throw out;
      return typeof out === 'function' ? out() : out;
    }
    throw new Error(`unexpected adb shell ${args}`);
  };
  return d;
}

// pidof exits 1 when nothing matches, which the device turns into the word NONE
// so that an adb failure stays distinguishable from "not running".
const notRunning = () => 'NONE\n';

describe('AndroidJourneyDevice.assertAppAlive', () => {
  test('a running package is alive and yields its pid', async () => {
    const d = device({ [`'pidof ${PKG} || echo NONE'`]: '4242\n' });
    await expect(d.assertAppAlive(PKG, 'after the redirect')).resolves.toEqual({ pid: 4242 });
  });

  test('launch() records the pid the package got', async () => {
    const d = device({ 'monkey -p': '', [`'pidof ${PKG} || echo NONE'`]: '4242\n' });
    await d.launch(PKG);
    expect(d._launchedPid).toBe(4242);
    expect(d.calls[0]).toMatch(/^monkey -p com\.shyden\.shytalk\.local/);
  });

  test('a package that is not running fails loudly, with the crash buffer', async () => {
    const d = device({
      [`'pidof ${PKG} || echo NONE'`]: notRunning(),
      'logcat -d -b crash': CRASH_BUFFER,
    });
    d._launchedPid = 4242;
    const err = await d.assertAppAlive(PKG, 'after the redirect').catch((e) => e);
    expect(err).toBeInstanceOf(AppProcessDiedError);
    expect(err.message).toMatch(
      /^after the redirect: the app process died\. pid 4242 is gone and no com\.shyden\.shytalk\.local process is running/,
    );
    expect(err.message).toMatch(/FATAL EXCEPTION: main/);
    expect(err.message).toMatch(/IllegalStateException: boom/);
  });

  test('a different pid than the one launched is a relaunch, not survival', async () => {
    const d = device({ [`'pidof ${PKG} || echo NONE'`]: '5000\n', 'logcat -d -b crash': '' });
    d._launchedPid = 4242;
    await expect(d.assertAppAlive(PKG, 'x')).rejects.toThrow(
      /pid 5000\) is running now: something relaunched the app/,
    );
  });

  test('with no launch pid recorded, the running process is adopted', async () => {
    const d = device({ [`'pidof ${PKG} || echo NONE'`]: '5000\n' });
    await expect(d.assertAppAlive(PKG, 'x')).resolves.toEqual({ pid: 5000 });
    expect(d._launchedPid).toBe(5000);
  });

  test('an empty crash buffer is said to be empty, and a failing logcat does not hide the death', async () => {
    const quiet = device({
      [`'pidof ${PKG} || echo NONE'`]: notRunning(),
      'logcat -d -b crash': '\n',
    });
    await expect(quiet.assertAppAlive(PKG, 'x')).rejects.toThrow(/crash buffer: \(empty\)/);
    const broken = device({
      [`'pidof ${PKG} || echo NONE'`]: notRunning(),
      'logcat -d -b crash': new Error('device offline'),
    });
    await expect(broken.assertAppAlive(PKG, 'x')).rejects.toThrow(
      /the app process died[\s\S]*device offline/,
    );
  });
});

describe('J40 revoked cold start asserts the app survived the redirect', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');

  test('revokedColdStart checks liveness after sign-in is reached and before it reads the log', () => {
    const start = src.indexOf('async function revokedColdStart(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    const signIn = body.indexOf("'SignIn after the revoked session'");
    const alive = body.indexOf('await device.assertAppAlive(pkg,');
    const log = body.indexOf('await launchLog()');
    expect(signIn).toBeGreaterThan(0);
    expect(log).toBeGreaterThan(signIn);
    expect(alive).toBeGreaterThan(signIn);
    expect(alive).toBeLessThan(log);
  });

  test('the call site hands revokedColdStart the package it must check', () => {
    expect(src).toMatch(/await revokedColdStart\(device, reporter, \{[^}]*\bpkg\b[^}]*\}\)/);
  });
});
