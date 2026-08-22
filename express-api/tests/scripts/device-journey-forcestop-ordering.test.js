/**
 * device-journey-forcestop-ordering.test.js
 *
 * Stopping the app and starting it again is two operations that MUST happen in
 * that order. On iOS they did not.
 *
 * `IosDevice.forceStop()` issued `POST /appium/device/terminate_app` and threw
 * the promise away:
 *
 *     this._post('/appium/device/terminate_app', {...}).catch(() => {});
 *
 * The very next line, `device.launch()`, runs `xcrun devicectl` SYNCHRONOUSLY.
 * So the launch completed while the terminate was still in flight, and the
 * terminate then landed on the freshly-launched app and killed it — leaving the
 * phone sitting on the iOS Home screen. A/B tested on the real device, 2/2
 * deterministic: no gap → home screen; a 2s gap → app in front.
 *
 * Android never had this: its `forceStop` is a synchronous
 * `adb shell am force-stop`, which has finished by the time it returns. Which is
 * the trap — the shared journey code reads identically on both platforms, and is
 * correct on only one.
 *
 * The failure it produced blamed the wrong thing entirely: the journey reported
 * "SignIn or Home not reached", i.e. a product that would not load, when the
 * driver had shot the app in the back.
 *
 * These are source guards because the behaviour lives across a process boundary
 * and a real device. What they pin is the ORDERING CONTRACT, which is where the
 * bug was.
 */

const fs = require('node:fs');
const path = require('node:path');

const RUNNER = path.resolve(__dirname, '../../scripts/device-journey-runner.js');
const IOS_DEVICE = path.resolve(__dirname, '../../scripts/drivers/ios-journey-device.js');

const runnerSrc = fs.readFileSync(RUNNER, 'utf8');
const iosSrc = fs.readFileSync(IOS_DEVICE, 'utf8');

describe('forceStop must complete before launch', () => {
  test('every forceStop call in the runner is awaited', () => {
    // Anchored on the CALL, not on the word. `forceStop` also appears in
    // docstrings, in the method-name inventory, and — as this guard's own first
    // run proved — inside a COMMENT explaining the very fix it checks. A guard
    // that reddens on prose is a guard the next person deletes, so comment
    // lines are dropped before anything is counted.
    const code = runnerSrc
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    const calls = code.match(/^[^\n]*\bdevice\.forceStop\(/gm) || [];
    const unawaited = calls
      .map((line) => line.trim())
      .filter((line) => !/\bawait\s+(?:ctx\.)?device\.forceStop\(/.test(line));

    // The list itself is the failure message: whoever breaks this sees the
    // offending lines rather than a bare count.
    expect({ callSites: calls.length > 0, unawaited }).toEqual({
      callSites: true,
      unawaited: [],
    });
  });

  test('the iOS forceStop awaits the terminate rather than discarding it', () => {
    const method = iosSrc.match(/^ {2}async forceStop\(\)[\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({ isAsync: method !== '' }).toEqual({ isAsync: true });
    expect({
      awaitsTerminate: /await this\._post\('\/appium\/device\/terminate_app'/.test(method),
    }).toEqual({ awaitsTerminate: true });
  });

  test('the iOS forceStop no longer fires and forgets', () => {
    // The exact shape of the bug: a promise created, a rejection swallowed, and
    // nothing waiting for either.
    const method = iosSrc.match(/^ {2}async forceStop\(\)[\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({
      fireAndForget: /this\._post\([^)]*\)\.catch\(/.test(method),
    }).toEqual({ fireAndForget: false });
  });

  test('a failure to stop still does not end the run', () => {
    // Awaiting must not turn a best-effort stop into a fatal one. The next
    // launch brings the app to the front either way, so a terminate that fails
    // (app already dead) is not a reason to abandon a journey.
    const method = iosSrc.match(/^ {2}async forceStop\(\)[\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({ tolerant: /catch|\.catch\(/.test(method) }).toEqual({ tolerant: true });
  });

  test('both platforms expose forceStop the same way', () => {
    // The shared journeys call one method name on two backends. If only one is
    // awaitable, `await` at the call site is correct on one platform and
    // meaningless on the other — which is how this survived.
    const androidIsAsync = /^ {2}async forceStop\(pkg\)/m.test(runnerSrc);
    const iosIsAsync = /^ {2}async forceStop\(\)/m.test(iosSrc);
    expect({ androidIsAsync, iosIsAsync }).toEqual({
      androidIsAsync: true,
      iosIsAsync: true,
    });
  });
});
