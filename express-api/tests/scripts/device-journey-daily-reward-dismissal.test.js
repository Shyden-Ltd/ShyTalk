/**
 * device-journey-daily-reward-dismissal.test.js — SHY-0527
 *
 * The daily-reward calendar is presented a moment AFTER Home renders. "Land on
 * Home" can therefore declare arrival before the sheet exists, and the next
 * preamble step — "Confirm the phone is signed in as N" — polled raw dumps
 * with no overlay handling. On Android a dialog window is all uiautomator
 * reports while it is up, so the debug overlay's `UID:` line was invisible
 * for the whole eight-second poll (dev run dev-2026-09-06T02-52-39-583Z, J08).
 *
 * Two contracts pinned here:
 *   1. `confirmAccountOnDevice` clears overlays on every poll, then reads the
 *      account line — and its failures still say WHAT hid the line.
 *   2. `handleRewardCalendar` closes the sheet by test tag only, never by a
 *      localised label, and never by claiming the reward on the persona's
 *      behalf (the old handler tapped "Claim Today" when "Later" was absent).
 */

const {
  confirmAccountOnDevice,
  overlays,
  handleRewardCalendar,
  dump,
} = require('../../scripts/device-journey-runner');

const nodeXml = (attrs) =>
  `<node ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')} />`;

const node = (id, text, bounds) =>
  nodeXml({ 'resource-id': id, text, bounds, enabled: 'true', clickable: 'true' });

const HOME_TABS = ['main_roomsTab', 'main_messagesTab', 'main_profileTab']
  .map((id, i) => node(id, '', `[${i * 300},2600][${i * 300 + 280},2700]`))
  .join('');
const ACCOUNT_LINE = (uid) => node('', `UID: ${uid}`, '[0,120][600,160]');
const HOME_AS = (uid) => `<hierarchy>${HOME_TABS}${ACCOUNT_LINE(uid)}</hierarchy>`;

/** The J08 dump: the dialog window alone — no tabs, no account line. */
const SHEET_UNCLAIMED = `<hierarchy>${node('dailyReward_dialog', '', '[100,700][1160,2100]')}${node(
  'dailyReward_claimButton',
  'Claim Today',
  '[600,1900][1100,2000]',
)}${node('dailyReward_dismissButton', 'Later', '[300,1900][500,2000]')}</hierarchy>`;
const SHEET_CLAIMED = `<hierarchy>${node('dailyReward_dialog', '', '[100,700][1160,2100]')}${node(
  'dailyReward_closeButton',
  'Close',
  '[600,1900][1100,2000]',
)}</hierarchy>`;
/** An older build: the sheet with its buttons reachable only by label. */
const SHEET_UNTAGGED = `<hierarchy>${node('dailyReward_dialog', '', '[100,700][1160,2100]')}${node(
  'dailyReward_claimButton',
  'Claim Today',
  '[600,1900][1100,2000]',
)}${node('', 'Later', '[300,1900][500,2000]')}</hierarchy>`;

const DISMISS_CENTRE = { x: 400, y: 1950 };
const CLOSE_CENTRE = { x: 850, y: 1950 };

/**
 * A phone showing `frames` in order. It advances to the next frame only when
 * it is TAPPED: a real screen does not change between the runner finding a
 * button and tapping it, and the runner re-reads the tree before every tap
 * (SHY-0441), so a stub that advanced on every read would report the button
 * as vanished and never tap at all -- a double less complete than reality.
 */
function deviceServing(frames) {
  const queue = [...frames];
  const taps = [];
  return {
    kind: 'ios',
    taps,
    async dumpXml() {
      return queue[0];
    },
    async tap(x, y) {
      taps.push({ x, y });
      if (queue.length > 1) queue.shift();
    },
  };
}

describe('confirmAccountOnDevice clears the daily-reward sheet before reading the account', () => {
  test('a sheet presented after Home is dismissed by tag, then the account is read', async () => {
    const device = deviceServing([SHEET_UNCLAIMED, HOME_AS(50000040)]);

    const message = await confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev');

    expect({ message, taps: device.taps }).toEqual({
      message:
        'debug overlay shows account 50000040 after dismissing the daily-reward sheet via dailyReward_dismissButton',
      taps: [DISMISS_CENTRE],
    });
  });

  test('the already-claimed sheet is closed through its Close button', async () => {
    const device = deviceServing([SHEET_CLAIMED, HOME_AS(50000040)]);

    const message = await confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev');

    expect({ message, taps: device.taps }).toEqual({
      message:
        'debug overlay shows account 50000040 after dismissing the daily-reward sheet via dailyReward_closeButton',
      taps: [CLOSE_CENTRE],
    });
  });

  test('what was cleared is recorded for the step report, not only in the account message', async () => {
    const before = overlays.cleared.length;
    const device = deviceServing([SHEET_UNCLAIMED, HOME_AS(50000040)]);

    await confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev');

    expect(overlays.cleared.slice(before)).toEqual([
      'the daily-reward sheet via dailyReward_dismissButton',
    ]);
  });

  test('a clean Home is read without a single tap', async () => {
    const device = deviceServing([HOME_AS(50000040)]);

    await confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev');

    expect(device.taps).toEqual([]);
  });

  test('a sheet with no tagged dismiss or close button fails at once, naming the ids, with zero taps', async () => {
    const device = deviceServing([SHEET_UNTAGGED, HOME_AS(50000040)]);

    await expect(
      confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev'),
    ).rejects.toThrow(
      /dailyReward_dialog.*dailyReward_claimButton|dailyReward_claimButton.*dailyReward_dialog/,
    );
    expect(device.taps).toEqual([]);
  });

  test('the wrong account still fails with the wrong-person message', async () => {
    const device = deviceServing([HOME_AS(50000041)]);

    await expect(
      confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev', 1500),
    ).rejects.toThrow(/signed in as 50000041 but adult-prober@shytalk\.dev is account 50000040/);
  });

  test('no account line for the whole poll still fails with the missing-overlay message', async () => {
    const device = deviceServing([`<hierarchy>${HOME_TABS}</hierarchy>`]);

    await expect(
      confirmAccountOnDevice(device, 50000040, 'adult-prober@shytalk.dev', 1500),
    ).rejects.toThrow(/the debug overlay is not showing an account id/);
  });
});

describe('handleRewardCalendar closes the sheet by tag and never claims the reward', () => {
  test('the unclaimed sheet is dismissed through dailyReward_dismissButton', async () => {
    const device = deviceServing([SHEET_UNCLAIMED]);

    const handled = await handleRewardCalendar(device, await dump(device));

    expect({ handled, taps: device.taps }).toEqual({
      handled: 'dailyReward_dismissButton',
      taps: [DISMISS_CENTRE],
    });
  });

  test('a sheet reachable only by label is refused, not claimed', async () => {
    const device = deviceServing([SHEET_UNTAGGED]);

    await expect(handleRewardCalendar(device, await dump(device))).rejects.toThrow(
      /dailyReward_dialog/,
    );
    expect(device.taps).toEqual([]);
  });

  test('a screen without the sheet is left alone', async () => {
    const device = deviceServing([HOME_AS(50000040)]);

    const handled = await handleRewardCalendar(device, await dump(device));

    expect({ handled, taps: device.taps }).toEqual({ handled: false, taps: [] });
  });
});
