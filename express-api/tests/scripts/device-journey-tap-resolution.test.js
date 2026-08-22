/**
 * device-journey-tap-resolution.test.js
 *
 * Which element does a tap actually land on?
 *
 * The sibling file `device-journey-element-locators.test.js` scans the SOURCE:
 * that an element route exists, that only one raw coordinate tap remains, that
 * nothing taps across an await. All useful, and all of it passed while
 * `tapResolved` was tapping the WRONG ELEMENT.
 *
 * The regression it missed, found on a real OnePlus: `tapLowestText` picks the
 * LOWEST node with a given text, because in a confirmation dialog the title and
 * the confirm button carry the same words. `tapResolved` then re-resolved with
 * `byText`, which is `.find()` — the first match in document order — and handed
 * back the TITLE. Tapping it did nothing, sign-out hung, and every journey after
 * the first would have failed. On the device: tapping the title left the dialog
 * open; tapping the button the caller chose dismissed it.
 *
 * A source-scanning guard cannot see that, because the code has exactly the
 * right shape. Only running it can. So this file EXECUTES `tapResolved` and
 * asserts the coordinates it chose.
 *
 * ## On the recording device
 *
 * The device here records what it was asked to tap and returns canned screens.
 * That is a double, which this repo normally refuses — justified because the
 * unit under test is pure resolution logic across a process boundary, and the
 * alternative is precisely the source-scanning that already failed. The REAL
 * proof stays where it belongs: the walk on the phone.
 */

const {
  tapResolved,
  tapLowestText,
  lowestWithText,
} = require('../../scripts/device-journey-runner');

/** A node shaped like the ones `parseNodes` produces. */
const node = (over) => ({
  id: '',
  text: '',
  desc: '',
  enabled: true,
  center: { x: 0, y: 0 },
  ...over,
});

/**
 * The exact screen that broke: a confirmation dialog whose TITLE and BUTTON
 * carry the same words, the title first in document order and the button lower.
 */
const signOutDialog = () => [
  node({ text: 'Sign Out', center: { x: 439, y: 1401 } }), // title, not clickable
  node({ text: 'Are you sure?', center: { x: 500, y: 1550 } }),
  node({ text: 'Cancel', center: { x: 300, y: 1739 } }),
  node({ text: 'Sign Out', center: { x: 1009, y: 1739 } }), // the confirm button
];

/** Records taps; returns the given screen from every dump. */
function recordingDevice(screen) {
  return {
    kind: 'android',
    taps: [],
    elementTaps: [],
    labelTaps: [],
    async dumpXml() {
      return screen;
    },
    async tap(x, y) {
      this.taps.push({ x, y });
    },
  };
}

// `dump()` inside the runner parses XML; the recording device returns nodes
// directly, so the runner's own dump is bypassed by handing tapResolved a
// relocate that closes over the screen. That keeps the unit under test the
// RESOLUTION, which is where the bug was.
const withScreen = (screen) => ({
  relocate: (_fresh) => lowestWithText(screen, 'Sign Out'),
});

describe('lowestWithText', () => {
  test('picks the LOWEST match, not the first', () => {
    // The whole point of the helper: in this dialog the first "Sign Out" is the
    // title at y=1401 and the button is at y=1739.
    expect(lowestWithText(signOutDialog(), 'Sign Out').center).toEqual({ x: 1009, y: 1739 });
  });

  test('returns null when nothing matches, rather than the nearest thing', () => {
    expect(lowestWithText(signOutDialog(), 'Delete Account')).toBeNull();
  });

  test('ignores nodes with no position', () => {
    const screen = [node({ text: 'Sign Out', center: null }), ...signOutDialog()];
    expect(lowestWithText(screen, 'Sign Out').center).toEqual({ x: 1009, y: 1739 });
  });
});

/**
 * REAL uiautomator XML for the dialog that broke, so `dump()` and `parseNodes`
 * run for real and the seam under test is the whole path from
 * `tapLowestText` to a coordinate.
 *
 * A first version of this file tested `tapResolved` with a relocate handed
 * straight to it. That asserted `tapResolved` HONOURS a rule — and the bug was
 * that `tapLowestText` never PASSED one. The mutation proved it: dropping the
 * rule left all seven tests green. Testing one side of a seam again.
 */
const SIGN_OUT_DIALOG_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<hierarchy>',
  '<node resource-id="" text="Sign Out" bounds="[0,1350][878,1452]" enabled="true" clickable="false" />',
  '<node resource-id="" text="Are you sure?" bounds="[0,1500][1000,1600]" enabled="true" clickable="false" />',
  '<node resource-id="" text="Cancel" bounds="[200,1690][400,1788]" enabled="true" clickable="true" />',
  '<node resource-id="" text="Sign Out" bounds="[900,1690][1118,1788]" enabled="true" clickable="true" />',
  '</hierarchy>',
].join('');

describe('tapLowestText — the whole path, as the device runs it', () => {
  /** Returns real XML from dumpXml, so parseNodes does its real work. */
  const xmlDevice = () => ({
    kind: 'android',
    taps: [],
    async dumpXml() {
      return SIGN_OUT_DIALOG_XML;
    },
    async tap(x, y) {
      this.taps.push({ x, y });
    },
  });

  test('taps the confirm BUTTON, never the identically-worded title', async () => {
    // Title centre y = 1401, button centre y = 1739. The device proved the
    // difference: tapping the title left the dialog open and sign-out hung.
    const device = xmlDevice();
    await tapLowestText(device, 'Sign Out');
    expect(device.taps).toEqual([{ x: 1009, y: 1739 }]);
  }, 15000);

  test('a text that is not on screen fails rather than tapping something else', async () => {
    const device = xmlDevice();
    await expect(tapLowestText(device, 'Delete Account')).rejects.toThrow(/no "Delete Account"/);
    expect(device.taps).toEqual([]);
  }, 15000);
});

describe('tapResolved keeps the caller’s choice', () => {
  test('taps the element the caller picked, not the first of that name', async () => {
    // THE REGRESSION. Without `relocate` this resolved to the title at y=1401.
    const screen = signOutDialog();
    const device = recordingDevice(screen);
    const target = lowestWithText(screen, 'Sign Out');

    await tapResolved(device, target, withScreen(screen));

    expect(device.taps).toEqual([{ x: 1009, y: 1739 }]);
  });

  test('an id goes straight to an element click, with no coordinate at all', async () => {
    const device = {
      ...recordingDevice(signOutDialog()),
      elementTaps: [],
      async tapElement(id) {
        this.elementTaps.push(id);
      },
    };
    device.taps = [];

    await tapResolved(device, node({ id: 'support_send', center: { x: 5, y: 5 } }));

    expect({ elements: device.elementTaps, coordinates: device.taps }).toEqual({
      elements: ['support_send'],
      coordinates: [],
    });
  });

  test('a target that has gone is a failure, not a tap at its last position', async () => {
    const device = recordingDevice([]);
    await expect(
      tapResolved(device, node({ text: 'Sign Out', center: { x: 1, y: 2 } }), {
        relocate: () => null,
        label: 'lowest "Sign Out"',
      }),
    ).rejects.toThrow(/vanished between being found and being tapped/);
    expect(device.taps).toEqual([]);
  });

  test('the failure names what it was looking for', async () => {
    // "something vanished" sends the reader nowhere. The label is the point.
    const device = recordingDevice([]);
    await expect(
      tapResolved(device, node({ text: 'Sign Out' }), {
        relocate: () => null,
        label: 'lowest "Sign Out"',
      }),
    ).rejects.toThrow(/lowest "Sign Out"/);
  });
});
