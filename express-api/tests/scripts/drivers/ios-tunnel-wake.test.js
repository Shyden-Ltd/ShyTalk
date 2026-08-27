'use strict';

/**
 * A dormant CoreDevice tunnel is not an absent iPhone.
 *
 * `devicectl list devices` reports the state of the tunnel AT THAT MOMENT, and
 * CoreDevice brings tunnels up on demand. After the phone reboots — or simply
 * sits idle — a passive `list` shows:
 *
 *     Sean's iPhone   ...   available (paired)   iPhone Air   physical
 *
 * The selector required the literal word `connected`, so it answered null and
 * the runner stopped with "No connected iPhone found" while the phone was
 * plugged in, unlocked and paired. Asking devicectl for anything about the
 * device opens the tunnel, after which the same command reports `connected`.
 *
 * Observed 2026-08-24: the operator rebooted the iPhone, every iOS journey
 * refused to start, and one `devicectl device info details` made the whole
 * matrix runnable.
 */

const { connectedPhoneIn, pairedPhoneIn } = require('../../../scripts/drivers/ios-journey-device');

const HEADER =
  'Name            Hostname                        Identifier                             State       Model                        Reality  \n' +
  '-------------   -----------------------------   ------------------------------------   ---------   --------------------------   ---------\n';

const SIMULATOR =
  'SHY-0146-gate                                   CEB70A3C-894C-471F-A1BA-6DBCB874CFB4   connected   iPhone 17 Pro (iPhone18,1)   simulated\n';

const phone = (state) =>
  `Sean’s iPhone   Seans-iPhone.coredevice.local   74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6   ${state}   iPhone Air (iPhone18,4)      physical\n`;

describe('connectedPhoneIn', () => {
  test('finds a physical phone with a live tunnel', () => {
    expect(connectedPhoneIn(HEADER + SIMULATOR + phone('connected'))).toBe(
      '74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6',
    );
  });

  test('never returns the simulator, even when it is the only connected thing', () => {
    // A simulator is not a substitute: SHY-0419 was invisible to everything
    // except the real device.
    expect(connectedPhoneIn(HEADER + SIMULATOR)).toBeNull();
  });

  test('a paired-but-dormant phone is not connected', () => {
    expect(connectedPhoneIn(HEADER + phone('available (paired)'))).toBeNull();
  });

  test('an unavailable phone is not connected', () => {
    expect(connectedPhoneIn(HEADER + phone('unavailable'))).toBeNull();
  });

  test('empty output yields nothing rather than throwing', () => {
    expect(connectedPhoneIn('')).toBeNull();
    expect(connectedPhoneIn(null)).toBeNull();
  });
});

describe('pairedPhoneIn', () => {
  test('finds the phone whose tunnel is merely dormant', () => {
    expect(pairedPhoneIn(HEADER + SIMULATOR + phone('available (paired)'))).toBe(
      '74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6',
    );
  });

  test('finds a phone that is already connected, so one wake is harmless', () => {
    expect(pairedPhoneIn(HEADER + phone('connected'))).toBe('74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6');
  });

  test('never returns the simulator', () => {
    // Waking a simulator would succeed and then hand the runner the wrong
    // device -- the single worst outcome available here.
    expect(pairedPhoneIn(HEADER + SIMULATOR)).toBeNull();
  });

  test('an unavailable phone is not worth waking', () => {
    // `unavailable` means devicectl knows of it and cannot reach it. Waking
    // that is a timeout, not a recovery.
    expect(pairedPhoneIn(HEADER + phone('unavailable'))).toBeNull();
  });

  test('no physical device at all yields nothing', () => {
    expect(pairedPhoneIn(HEADER)).toBeNull();
    expect(pairedPhoneIn('')).toBeNull();
  });
});
