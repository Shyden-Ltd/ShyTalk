/**
 * Waiting for the persona picker to ACTUALLY open (SHY-0447).
 *
 * The step did:
 *
 *   await tapId(device, 'persona_picker_open');
 *   await waitForText(device, 'Sign in as test persona', 8000);
 *   await selectPersonaByText(device, email);
 *
 * "Sign in as test persona" is the label of the BUTTON that opens the picker.
 * It is on screen before the tap, during the tap, and after it — so that wait
 * has never once waited for the sheet. It returned instantly, every time.
 *
 * It went unnoticed for as long as the walk was slow: `selectPersonaByText`
 * sleeps 700ms per scroll attempt and had eight of them, so the sheet always
 * arrived during the flailing. Once the Android screen read dropped from
 * 2332ms to ~65ms the walk got ahead of the animation, swiped at a SignIn
 * screen that had no list on it, and every iOS persona journey failed with
 * "persona not found in picker after scrolling" — with `persona_picker_open`
 * still sitting in the dump, which is the tell.
 *
 * A speed-up did not cause this. It removed the padding that was hiding it.
 */

const { openPersonaPicker } = require('../../scripts/device-journey-runner');

/** A phone that shows SignIn, and opens the picker only when told to. */
function signInScreen({ opensAfterTaps = 1 } = {}) {
  let taps = 0;
  const SIGN_IN =
    '<hierarchy>' +
    '<node resource-id="persona_picker_open" class="android.widget.Button" ' +
    'text="Sign in as test persona" bounds="[40,900][400,980]" enabled="true" />' +
    '</hierarchy>';
  const PICKER =
    '<hierarchy>' +
    '<node resource-id="persona_picker_list" class="android.widget.ScrollView" ' +
    'text="" bounds="[0,200][440,1400]" enabled="true" />' +
    '<node resource-id="persona_row_P-02" class="android.widget.Button" ' +
    'text="adult-power@shytalk.dev" bounds="[40,300][400,380]" enabled="true" />' +
    '</hierarchy>';
  return {
    kind: 'android',
    taps: 0,
    async dumpXml() {
      return taps >= opensAfterTaps ? PICKER : SIGN_IN;
    },
    tap() {
      taps += 1;
      this.taps = taps;
    },
    size: () => ({ w: 440, h: 1600 }),
  };
}

describe('openPersonaPicker', () => {
  test('returns once the LIST is on screen, not when the button is', async () => {
    const device = signInScreen({ opensAfterTaps: 1 });
    await openPersonaPicker(device, 4000);
    expect(device.taps).toBe(1);
  });

  test('a swallowed first tap is tapped again, not waited out', async () => {
    // Proven on the phone: the tap opens the picker in ~500ms when the screen
    // is settled. In a run it lands while SignIn is still animating in and is
    // simply eaten — so the answer is to press again, not to sleep before
    // pressing and hope. Waiting the full timeout on a tap that never
    // registered is a walk failing for something the phone never saw.
    const device = signInScreen({ opensAfterTaps: 3 });
    await openPersonaPicker(device, 6000);
    expect(device.taps).toBe(3);
  });

  test('a picker that never opens is a failure, not a silent carry-on', async () => {
    // THE REGRESSION. With the old text wait this resolved immediately against
    // the button's own label and the walk went on to scroll a screen with no
    // list on it, failing eight scrolls later with a message that blamed the
    // persona.
    const device = signInScreen({ opensAfterTaps: 99 });
    await expect(openPersonaPicker(device, 1200)).rejects.toThrow(/persona_picker_list/);
  });

  test('the failure names the picker, not the persona', async () => {
    // "persona X not found in picker after scrolling" sent three separate
    // investigations looking at seed data. The screen never had a picker on it.
    const device = signInScreen({ opensAfterTaps: 99 });
    await expect(openPersonaPicker(device, 1200)).rejects.toThrow(/picker/i);
  });
});

/**
 * SHY-0491 — the picker button has to EXIST before it is tapped.
 *
 * `openPersonaPicker` tapped `persona_picker_open` immediately. If the app had
 * not finished navigating to SignIn yet, the button was not on screen and
 * `tapId` threw "tap target #persona_picker_open not found on screen" — the
 * exact failure J-ALICE produced on every dev matrix run.
 *
 * The retry loop looks like it covers this, but it does not: after a failed
 * attempt it breaks out precisely when the button is absent (line "the button
 * is still there, so the tap was swallowed"). That guard is right for a
 * swallowed tap and wrong for a screen that has not arrived, and the FIRST tap
 * never had a wait at all.
 *
 * Why dev and not local: sign-out is a network round trip. On loopback it
 * finishes inside the walk's own latency; on dev's real network it does not.
 * The runner already documents this exact race for the iPhone and raised a
 * timeout for it — this is the same race, one screen earlier.
 */
function screenArrivingLate({ blankDumps = 3 } = {}) {
  let dumps = 0;
  let taps = 0;
  const BLANK =
    '<hierarchy><node resource-id="android:id/content" bounds="[0,0][440,1600]" /></hierarchy>';
  const SIGN_IN =
    '<hierarchy>' +
    '<node resource-id="persona_picker_open" class="android.widget.Button" ' +
    'text="Sign in as test persona" bounds="[40,900][400,980]" enabled="true" />' +
    '</hierarchy>';
  const PICKER =
    '<hierarchy>' +
    '<node resource-id="persona_picker_list" class="android.widget.ScrollView" ' +
    'text="" bounds="[0,200][440,1400]" enabled="true" />' +
    '</hierarchy>';
  return {
    kind: 'android',
    async dumpXml() {
      dumps += 1;
      if (dumps <= blankDumps) return BLANK; // still navigating away from the old screen
      return taps > 0 ? PICKER : SIGN_IN;
    },
    tap() {
      taps += 1;
    },
    size: () => ({ w: 440, h: 1600 }),
  };
}

describe('SHY-0491: a SignIn screen that arrives late', () => {
  test('the picker still opens when the screen has not landed yet', async () => {
    // Nothing about this phone is broken. It is mid-navigation, exactly as it
    // is on dev after a sign-out that took longer than loopback.
    await expect(openPersonaPicker(screenArrivingLate(), 8000)).resolves.toBeUndefined();
  });

  test('a screen that NEVER arrives still fails, and says the button never appeared', async () => {
    // The other half: waiting must not become waiting forever, and the message
    // has to name what was missing or the next person debugs the wrong thing.
    const neverArrives = {
      kind: 'android',
      async dumpXml() {
        return '<hierarchy><node resource-id="android:id/content" bounds="[0,0][440,1600]" /></hierarchy>';
      },
      tap() {},
      size: () => ({ w: 440, h: 1600 }),
    };
    await expect(openPersonaPicker(neverArrives, 300)).rejects.toThrow(/persona_picker_open/);
  });
});

/**
 * SHY-0495 — a modal that arrives AFTER SignIn is reached.
 *
 * `reachSignIn` clears overlays as it advances, and reported success. One step
 * later `openPersonaPicker` saw nothing but `android:id/content` and gave up
 * after five seconds.
 *
 * The daily-reward calendar is a Compose dialog, so it owns its own window and
 * the dump shows only the content root — the walk is blind to everything
 * behind it. It is DATE-TRIGGERED, which is why the matrix was 8/8 on
 * 2026-08-28 and this failed on 2026-08-30 with a 500-coin reward showing.
 *
 * `openPersonaPicker` took a bare dump, so it never ran the overlay handlers
 * that `advanceUntil` runs. Waiting for a control is not enough when something
 * can arrive and cover it.
 */
function rewardCalendarThenSignIn() {
  let taps = 0;
  let dismissed = false;
  const MODAL =
    '<hierarchy>' +
    '<node resource-id="android:id/content" bounds="[0,0][440,1600]" />' +
    '<node resource-id="dailyReward_claimButton" text="Claim Today\'s Reward" class="android.widget.Button" bounds="[120,1200][380,1270]" enabled="true" />' +
    '<node resource-id="dailyReward_dismissButton" text="Later" class="android.widget.Button" bounds="[40,1200][110,1270]" enabled="true" />' +
    '</hierarchy>';
  const SIGN_IN =
    '<hierarchy>' +
    '<node resource-id="persona_picker_open" class="android.widget.Button" ' +
    'text="Sign in as test persona" bounds="[40,900][400,980]" enabled="true" />' +
    '</hierarchy>';
  const PICKER =
    '<hierarchy>' +
    '<node resource-id="persona_picker_list" class="android.widget.ScrollView" ' +
    'text="" bounds="[0,200][440,1400]" enabled="true" />' +
    '</hierarchy>';
  return {
    kind: 'android',
    async dumpXml() {
      // The modal STAYS until something dismisses it. A double that lets it
      // fade on its own would pass against the broken code, which is what a
      // first version of this test did.
      if (!dismissed) return MODAL;
      return taps > 0 ? PICKER : SIGN_IN;
    },
    tap(x, y) {
      // A tap inside the modal's button row is the dismissal.
      if (!dismissed && y >= 1200 && y <= 1270) {
        dismissed = true;
        return;
      }
      taps += 1;
    },
    size: () => ({ w: 440, h: 1600 }),
  };
}

describe('SHY-0495: a modal covering the SignIn screen', () => {
  test('the reward calendar is dismissed and the picker still opens', async () => {
    // Nothing here is broken. A date-triggered dialog arrived after SignIn was
    // reached, which is a thing that will keep happening.
    await expect(openPersonaPicker(rewardCalendarThenSignIn(), 8000)).resolves.toBeUndefined();
  });
});

/**
 * SHY-0495 — the budget must fit CLEARING a dialog, not just waiting.
 *
 * An earlier version of this file tried to prove that with a fake phone. It
 * did not: the double polls in memory, so it finished inside any budget and
 * passed identically at 8000ms and 30000ms. A test that cannot fail proves
 * nothing, so it is gone.
 *
 * What is actually assertable is the NUMBER and the arithmetic behind it.
 * Clearing a dialog on dev is dump → tap → settle → dump, and one screen read
 * there costs ~2.2s — about 7s for a single dismissal. 8000ms left
 * `reachSignIn` 5.4s, which bought two reads and no dismissal, and J12 failed
 * with "Display over other apps" on screen and a handler for it going unused.
 */
describe('SHY-0495: the picker budget', () => {
  const { PICKER_OPEN_TIMEOUT_MS } = require('../../scripts/device-journey-runner');

  test('is large enough to clear two queued dialogs and still open the picker', () => {
    const DEV_SCREEN_READ_MS = 2200;
    const READS_PER_DISMISSAL = 3; // see, tap, confirm gone
    const QUEUED_DIALOGS = 2; // daily-reward calendar, overlay-bubble prompt
    const floor = DEV_SCREEN_READ_MS * READS_PER_DISMISSAL * QUEUED_DIALOGS;

    expect(PICKER_OPEN_TIMEOUT_MS).toBeGreaterThanOrEqual(floor);
  });

  test('is not so large that a genuinely stuck screen hangs the matrix', () => {
    // The other direction. A budget nobody bounds turns one broken journey
    // into a matrix that never finishes.
    expect(PICKER_OPEN_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });
});
