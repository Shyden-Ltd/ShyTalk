/**
 * device-journey-element-locators.test.js
 *
 * Taps must LOCATE the element, not aim at pixels where one used to be.
 *
 * Operator, 2026-08-22:
 *
 *   "you're still using clicks based on coordinates of where you expect an
 *    element to be. this is really not working well, leading you to click the
 *    wrong things, see a result and assume it's passed. Instead you should be
 *    clicking elements like you would on playwright, via IDs or xpath or
 *    something."
 *
 * The runner did resolve by id — but from a dump taken EARLIER, then converted
 * the node to a centre point and tapped that. Everything between the dump and
 * the tap is a window in which the screen can move: a keyboard opening, a list
 * settling, a dialog arriving. The tap then lands on whatever now occupies
 * those pixels, the walk sees a plausible next screen, and the step passes.
 *
 * SHY-0428 is the same failure from the other side: Send's tappable centre
 * coincided with the system HOME button, so a tap "on Send" left the app.
 * A coordinate is not an element.
 *
 * iOS has had the right primitive all along and used it in exactly one place:
 * `typeText` resolves via `POST /element` and clicks `/element/{id}/click`,
 * which Appium performs server-side with no staleness window at all. Every
 * other tap ignored it.
 */

const fs = require('node:fs');
const path = require('node:path');

const RUNNER = path.resolve(__dirname, '../../scripts/device-journey-runner.js');
const IOS_DEVICE = path.resolve(__dirname, '../../scripts/drivers/ios-journey-device.js');

const runnerSrc = fs.readFileSync(RUNNER, 'utf8');
const iosSrc = fs.readFileSync(IOS_DEVICE, 'utf8');

/** Source with comment lines removed — a guard must not fire on prose. */
const codeOf = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('taps locate elements rather than remembered pixels', () => {
  test('the iOS backend exposes an element-based tap', () => {
    // Appium resolves and clicks in one server-side operation, so nothing can
    // move between "where is it" and "click it".
    expect({ hasTapElement: /^ {2}async tapElement\(/m.test(iosSrc) }).toEqual({
      hasTapElement: true,
    });
  });

  test('the iOS element tap goes through /element and /element/{id}/click', () => {
    const method = iosSrc.match(/^ {2}async tapElement\([\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({
      resolves: /_post\('\/element'/.test(method),
      clicks: /\/element\/\$\{[^}]+\}\/click/.test(method),
    }).toEqual({ resolves: true, clicks: true });
  });

  test('tapId routes through tapResolved rather than clicking directly', () => {
    // tapId used to short-circuit to device.tapElement(id) when the backend
    // had one. That skipped the reachability check for exactly the platform
    // whose defect motivated it — iOS, and SHY-0419. Everything now goes
    // through tapResolved, which reads the tree, checks the control is not
    // covered, and THEN takes the element route.
    const fn = codeOf(runnerSrc).match(/^async function tapId\([\s\S]*?^\}/m)?.[0] ?? '';
    expect({ found: fn !== '' }).toEqual({ found: true });
    expect({ delegates: /await tapResolved\(/.test(fn) }).toEqual({ delegates: true });
    expect({ shortCircuits: /device\.tapElement\(/.test(fn) }).toEqual({
      shortCircuits: false,
    });
  });

  test('the element route is taken only AFTER reachability is checked', () => {
    const fn = codeOf(runnerSrc).match(/^async function tapResolved\([\s\S]*?^\}/m)?.[0] ?? '';
    const check = fn.indexOf('assertReachable(');
    const click = fn.indexOf('device.tapElement(');
    expect({ checks: check !== -1, clicks: click !== -1 }).toEqual({
      checks: true,
      clicks: true,
    });
    expect({ checkedFirst: check < click }).toEqual({ checkedFirst: true });
  });

  test('no tap uses a coordinate captured before an await', () => {
    // The staleness window, stated as a rule. What this forbids is
    // `const n = await dump(); ...await something else...; device.tap(n.center)`
    // — anything between resolving and tapping is time in which the screen can
    // move, and the tap then lands on whatever now occupies those pixels.
    //
    // Scanned over CLASS METHODS and journey `run` bodies as well as top-level
    // functions. An earlier version of this guard checked only
    // `async function`, and a tap inside J38's own `run` sat outside it — the
    // same "guarded the instance, not the class" mistake this project keeps
    // making.
    const code = codeOf(runnerSrc);
    const offenders = [];
    const blocks = [
      ...code.matchAll(/^async function (\w+)\([\s\S]*?^\}/gm),
      ...code.matchAll(/^ {2}async (\w+)\([\s\S]*?^ {2}\}/gm),
    ];
    for (const m of blocks) {
      const body = m[0];
      // `tapResolved` IS the re-resolve, so its own raw tap is the point.
      if (m[1] === 'tapResolved') continue;
      let from = 0;
      for (;;) {
        const tap = body.indexOf('await device.tap(', from);
        if (tap === -1) break;
        from = tap + 1;
        const resolve = body.lastIndexOf('await dump(', tap);
        if (resolve === -1) continue;
        const between = body.slice(resolve, tap).match(/await (?!dump\()/g) || [];
        if (between.length > 0) offenders.push(`${m[1]} (${between.length} awaits between)`);
      }
    }
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test('only tapResolved taps a raw coordinate from a node', () => {
    // Everything else goes through it. A new `device.tap(n.center...)` added
    // straight into a journey is the regression this catches.
    const code = codeOf(runnerSrc);
    const raw = code.match(/await device\.tap\(\w+\.center\.x/g) || [];
    expect({ rawNodeTaps: raw.length }).toEqual({ rawNodeTaps: 1 });
  });

  test('the iOS backend can locate a control by its label, not just its id', () => {
    // Not every control has an accessibility identifier — the daily-reward
    // dialog's "Later" is matched by text alone. A predicate locates it as an
    // ELEMENT; a coordinate cannot. Leaving that case on coordinates is how a
    // reward calendar survived the tap meant to dismiss it, and the walk then
    // sat waiting for a tab the dialog was covering.
    const method = iosSrc.match(/^ {2}async tapElementByLabel\([\s\S]*?^ {2}\}/m)?.[0] ?? '';
    expect({ exists: method !== '' }).toEqual({ exists: true });
    expect({
      usesPredicate: /-ios predicate string/.test(method),
      clicksElement: /\/element\/\$\{[^}]+\}\/click/.test(method),
    }).toEqual({ usesPredicate: true, clicksElement: true });
  });

  test('tapResolved takes the element route before any coordinate', () => {
    // Every dialog handler comes through tapResolved. Giving tapId the element
    // path and leaving this one on coordinates was an incomplete fix.
    const fn = codeOf(runnerSrc).match(/^async function tapResolved\([\s\S]*?^\}/m)?.[0] ?? '';
    const elementUse = fn.indexOf('tapElement');
    const coordinateUse = fn.indexOf('device.tap(');
    expect({ hasElementRoute: elementUse !== -1 }).toEqual({ hasElementRoute: true });
    expect({ elementBeforeCoordinate: elementUse < coordinateUse }).toEqual({
      elementBeforeCoordinate: true,
    });
  });

  test('the Android coordinate tap re-checks the element has not moved', () => {
    // adb offers `input tap x y` and nothing else — there is no element click
    // to reach for. So the mitigation is to confirm the node is still where it
    // was immediately before tapping, and to say so when it is not.
    const fn = codeOf(runnerSrc).match(/^async function tapResolved\([\s\S]*?^\}/m)?.[0] ?? '';
    expect({ hasTapResolved: fn !== '' }).toEqual({ hasTapResolved: true });
    expect({ reChecks: /await dump\(/.test(fn) }).toEqual({ reChecks: true });
  });
});
