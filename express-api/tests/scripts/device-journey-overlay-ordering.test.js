/**
 * device-journey-overlay-ordering.test.js
 *
 * "We have arrived" must be decided AFTER clearing what is covering the screen.
 *
 * `advanceUntil` checked `isDone(nodes)` first and ran its overlay handlers
 * only if that failed. On iOS that races a modal's presentation animation:
 * for exactly one dump the tree contains BOTH the screen behind AND the
 * modal, so `anyMainTab` matched, `settle` returned "Home reached", and the
 * reward dialog was never dismissed.
 *
 * One dump later iOS marks the whole covered subtree inaccessible and the tab
 * ids disappear for as long as the sheet is up. `openSupport`'s next line —
 * `waitForId('main_profileTab', 20000)` — has no overlay handling, so it
 * stares for twenty seconds at a screen that can never satisfy it. Measured on
 * the device: seventeen consecutive `GET /source` polls, byte-identical, and
 * not one tap attempted.
 *
 * It is a race, which is why it passed on one run and failed on the next, and
 * why only the run that force-stops and relaunches hits it — that is the only
 * place a modal is presented while the walk is already looking for Home.
 */

const { advanceUntil, byId } = require('../../scripts/device-journey-runner');
const fs = require('node:fs');
const path = require('node:path');

const nodeXml = (attrs) =>
  `<node ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')} />`;

const TABS = ['main_roomsTab', 'main_messagesTab', 'main_profileTab'].map((id, i) =>
  nodeXml({
    'resource-id': id,
    text: '',
    bounds: `[${i * 300},2600][${i * 300 + 280},2700]`,
    enabled: 'true',
    clickable: 'true',
  }),
);

/** The one-dump window: Home's tabs AND the reward sheet, together. */
const MID_PRESENTATION = `<hierarchy>${TABS.join('')}${nodeXml({
  'resource-id': 'dailyReward_dialog',
  text: '',
  bounds: '[100,700][1160,2100]',
  enabled: 'true',
})}${nodeXml({
  'resource-id': '',
  text: 'Later',
  bounds: '[300,1900][500,2000]',
  enabled: 'true',
  clickable: 'true',
})}</hierarchy>`;

/** After the sheet finishes presenting: the tabs are gone from the tree. */
const MODAL_SETTLED = `<hierarchy>${nodeXml({
  'resource-id': 'dailyReward_dialog',
  text: '',
  bounds: '[100,700][1160,2100]',
  enabled: 'true',
})}${nodeXml({
  'resource-id': '',
  text: 'Later',
  bounds: '[300,1900][500,2000]',
  enabled: 'true',
  clickable: 'true',
})}</hierarchy>`;

const HOME = `<hierarchy>${TABS.join('')}</hierarchy>`;

const anyMainTab = (nodes) => Boolean(byId(nodes, 'main_profileTab'));

describe('advanceUntil clears overlays before declaring arrival', () => {
  test('a screen showing Home AND a modal is not "arrived"', async () => {
    // The exact failure. Serve the mid-presentation frame first; if the modal
    // is dismissed the device serves Home and the walk proceeds. If arrival is
    // declared on the first frame instead, the tap never happens.
    const served = [MID_PRESENTATION, MODAL_SETTLED, HOME, HOME, HOME];
    let i = 0;
    const device = {
      kind: 'ios',
      taps: [],
      async dumpXml() {
        return served[Math.min(i++, served.length - 1)];
      },
      async tap(x, y) {
        this.taps.push({ x, y });
      },
    };

    await advanceUntil(device, anyMainTab, 12000, 'Home');

    expect({ dismissedTheModal: device.taps.length > 0 }).toEqual({
      dismissedTheModal: true,
    });
  }, 20000);

  test('a clean Home screen still arrives immediately, with no taps', async () => {
    // The fix must not turn "already there" into extra work.
    const device = {
      kind: 'ios',
      taps: [],
      async dumpXml() {
        return HOME;
      },
      async tap(x, y) {
        this.taps.push({ x, y });
      },
    };

    const nodes = await advanceUntil(device, anyMainTab, 12000, 'Home');

    expect({ arrived: anyMainTab(nodes), taps: device.taps.length }).toEqual({
      arrived: true,
      taps: 0,
    });
  }, 20000);
});

/**
 * The runner must hand the device session back.
 *
 * Nothing ever did. `IosDevice.quit()` existed and was called from nowhere, so
 * every run abandoned its Appium session to die of `newCommandTimeout` five
 * minutes later. Two runs inside that window collide — which is how a
 * WebDriverAgent "failed to initialize" took out a run that had nothing wrong
 * with it, and cost a whole diagnostic cycle to attribute correctly.
 *
 * A source guard because the teardown lives in `main()`, past device and
 * Firestore setup that cannot be entered from a test.
 */
describe('the run closes the device session', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/device-journey-runner.js'),
    'utf8',
  );
  const code = src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  test('quit is called, and awaited', () => {
    expect({ quits: /await device\.quit\(\)/.test(code) }).toEqual({ quits: true });
  });

  test('it happens in the finally, so a failed walk still hands the session back', () => {
    // A run that throws is exactly the one that leaves a session behind, and
    // exactly the one somebody re-runs immediately.
    const tail = code.slice(code.lastIndexOf('} finally {'));
    expect({ inFinally: /await device\.quit\(\)/.test(tail) }).toEqual({ inFinally: true });
  });

  test('a teardown failure cannot change the verdict', () => {
    // The walk has already finished. Throwing here would turn a green run red
    // for something that happened after the last assertion.
    const tail = code.slice(code.lastIndexOf('} finally {'));
    const at = tail.indexOf('await device.quit()');
    const around = tail.slice(Math.max(0, at - 200), at + 200);
    expect({ guarded: /try\s*\{/.test(around) && /catch\s*\(/.test(around) }).toEqual({
      guarded: true,
    });
  });
});
