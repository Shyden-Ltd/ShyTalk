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
