/**
 * classifyAndroidAuthState — pure-logic unit tests (SHY-0096, EPIC-0003 Phase 0)
 *
 * No-Stubs / Real-Only compliance: these fixtures are REAL uiautomator dumps
 * captured from the physical OnePlus CPH2653 (Android 16) on 2026-06-13 —
 * test DATA, not a mock collaborator. The classifier is a pure string→enum
 * function; the device/backend BEHAVIOUR it informs is proven on the real
 * gauntlet, not here. NO execSync mock is used.
 *
 * Fixtures (express-api/tests/scripts/drivers/fixtures/):
 *   - android-dump-picker.xml    — signed-out sign-in screen (persona_picker_open)
 *   - android-dump-legal-gate.xml — fresh-install legal acceptance (legal_continueButton)
 *   - android-dump-main.xml      — signed-in Rooms screen (main_roomsTab)
 *   - android-dump-splash.xml    — intro/splash screen (splash_continueButton)
 *   - android-dump-warning.xml   — moderation warning gate (warning_acknowledgeButton),
 *                                  captured 2026-06-13 on the OnePlus CPH2653 after
 *                                  androidSignOut switched to P-10 Theo (hasActiveWarning).
 *
 * The synthetic-tag cases below remain even with the real warning fixture in
 * place: they prove *precedence* (warning over signed_in, picker over signed_in),
 * which a single real dump can't — a real screen only ever shows one state at a
 * time, so the multi-tag tie-breaks need synthetic inputs.
 */

const fs = require('fs');
const path = require('path');
const { classifyAndroidAuthState } = require('../../../scripts/drivers/android-adb-driver');

const FX = path.join(__dirname, 'fixtures');
const fixture = (f) => fs.readFileSync(path.join(FX, f), 'utf8');

describe('classifyAndroidAuthState — real device-captured dumps', () => {
  // Value matrix: each real fixture → its exact expected classification.
  const cases = [
    ['android-dump-picker.xml', 'picker'],
    ['android-dump-legal-gate.xml', 'legal_gate'],
    ['android-dump-main.xml', 'signed_in'],
    ['android-dump-splash.xml', 'splash'],
    ['android-dump-warning.xml', 'warning'],
  ];
  test.each(cases)('fixture %s classifies as "%s"', (file, expected) => {
    expect(classifyAndroidAuthState(fixture(file))).toBe(expected);
  });
});

describe('classifyAndroidAuthState — branch + precedence (synthetic minimal dumps)', () => {
  const wrap = (tag) =>
    `<hierarchy><node resource-id="com.shyden.shytalk.local:id/${tag}" bounds="[0,0][1,1]" /></hierarchy>`;

  test('warning gate → "warning"', () => {
    expect(classifyAndroidAuthState(wrap('warning_acknowledgeButton'))).toBe('warning');
  });

  test('legal checkbox alone (no continue button yet) → "legal_gate"', () => {
    expect(classifyAndroidAuthState(wrap('legal_acceptTermsCheckbox'))).toBe('legal_gate');
  });

  test('signIn_googleButton alone (picker entry) → "picker"', () => {
    expect(classifyAndroidAuthState(wrap('signIn_googleButton'))).toBe('picker');
  });

  test('main_profileTab alone → "signed_in"', () => {
    expect(classifyAndroidAuthState(wrap('main_profileTab'))).toBe('signed_in');
  });

  test('splash intro → "splash"', () => {
    expect(classifyAndroidAuthState(wrap('splash_continueButton'))).toBe('splash');
  });

  // Precedence: a warning gate over a still-rendering splash must classify as
  // warning (the more-blocking state) so the caller signs out, not continues.
  test('warning + splash tags together → "warning" (warning takes precedence)', () => {
    const both = `<hierarchy>${wrap('warning_acknowledgeButton')}${wrap('splash_continueButton')}</hierarchy>`;
    expect(classifyAndroidAuthState(both)).toBe('warning');
  });

  // Precedence: a warning gate is shown OVER a signed-in session — it must win
  // so the caller signs out rather than treating the user as fully on main.
  test('warning + main tags together → "warning" (warning takes precedence)', () => {
    const both = `<hierarchy>${wrap('warning_acknowledgeButton')}${wrap('main_roomsTab')}</hierarchy>`;
    expect(classifyAndroidAuthState(both)).toBe('warning');
  });

  // Precedence: picker over signed_in (a stale main_* fragment must not mask a
  // visible picker on the sign-in screen).
  test('picker + main tags together → "picker" (picker takes precedence over signed_in)', () => {
    const both = `<hierarchy>${wrap('persona_picker_open')}${wrap('main_roomsTab')}</hierarchy>`;
    expect(classifyAndroidAuthState(both)).toBe('picker');
  });
});

describe('classifyAndroidAuthState — unknown / degenerate inputs', () => {
  test('empty hierarchy → "unknown"', () => {
    expect(classifyAndroidAuthState('<hierarchy></hierarchy>')).toBe('unknown');
  });
  test('empty string → "unknown"', () => {
    expect(classifyAndroidAuthState('')).toBe('unknown');
  });
  test('null → "unknown" (no throw)', () => {
    expect(classifyAndroidAuthState(null)).toBe('unknown');
  });
  test('undefined → "unknown" (no throw)', () => {
    expect(classifyAndroidAuthState(undefined)).toBe('unknown');
  });
  test('unrelated system-dialog dump → "unknown"', () => {
    expect(
      classifyAndroidAuthState(
        '<hierarchy><node resource-id="com.android.permissioncontroller:id/permission_allow_button" /></hierarchy>',
      ),
    ).toBe('unknown');
  });
});

/**
 * THE DEGRADED-MODE SCREEN — the state that cost a whole cell.
 *
 * Measured 2026-08-01. `app-android` produced 1 pass then 29 consecutive
 * failures, all "could not tap persona_picker_open". The classifier recognises
 * main by main_roomsTab / main_profileTab / main_settingsButton and returns
 * 'unknown' for anything else, and 'unknown' means "never act" — so no sign-out
 * ran and the next step tapped a button that was not on screen.
 *
 * What WAS on screen only became visible once the error reported evidence
 * instead of guesses:
 *
 *   Observed state: "unknown"
 *   testTags currently on screen: degraded_title, degraded_acknowledgeButton
 *
 * That is `DegradedModeScreen.kt`, a real product screen shown when the backend
 * is unreachable — which, on a device whose reverse tunnels have dropped, is
 * every launch. A screen the harness cannot name is a screen it cannot leave.
 */
describe('classifyAndroidAuthState — degraded mode', () => {
  test('recognises the degraded screen by its acknowledge button', () => {
    expect(
      classifyAndroidAuthState('<node resource-id="com.x:id/degraded_acknowledgeButton"/>'),
    ).toBe('degraded');
  });

  test('recognises it by its title too, so a mid-render dump still classifies', () => {
    expect(classifyAndroidAuthState('<node resource-id="com.x:id/degraded_title"/>')).toBe(
      'degraded',
    );
  });

  test('degraded wins over signed_in — the gate is ON TOP of the session', () => {
    // Same precedence reason as `warning`: the session may well be valid, but
    // nothing beneath the gate is reachable until it is cleared.
    const dump = '<node resource-id="a/degraded_title"/><node resource-id="a/main_roomsTab"/>';
    expect(classifyAndroidAuthState(dump)).toBe('degraded');
  });

  test('a moderation warning still outranks degraded', () => {
    // Warning is the more specific gate and has its own acknowledge flow.
    const dump =
      '<node resource-id="a/warning_acknowledgeButton"/><node resource-id="a/degraded_title"/>';
    expect(classifyAndroidAuthState(dump)).toBe('warning');
  });

  test('the picker still classifies as picker when no gate is present', () => {
    // Guard against the new branch swallowing the state it sits next to.
    expect(classifyAndroidAuthState('<node resource-id="a/persona_picker_open"/>')).toBe('picker');
  });

  test('a dump merely MENTIONING degradation is not the degraded screen', () => {
    // Anchored on testTags, never on prose: a room named "degraded" must not
    // send the driver into a recovery flow.
    expect(classifyAndroidAuthState('<node text="service degraded"/>')).toBe('unknown');
  });
});

/**
 * `androidShowsUserCard` must identify WHOSE card is open.
 *
 * Operator 2026-08-01: "fix the assertions and make sure they're doing the
 * right thing. 'it appears' isn't good enough."
 *
 * It used to be `async (_name, _target) => /userCard_/.test(dump)` — it took
 * the target and checked only that SOME card was on screen. It passed on the
 * wrong user's card, and on a card left open by an earlier step.
 *
 * The product now tags the sheet `userCard_${user.uniqueId}` (UserCardPopup.kt)
 * so the subject is checkable, and the runner resolves the persona name to that
 * id — a display name is neither unique nor stable, since a room alias replaces
 * it on screen.
 */
describe('androidShowsUserCard — identifies its subject', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const dumpFor = (id) =>
    `<node resource-id="com.shyden.shytalk.local:id/userCard_${id}" bounds="[0,0][100,100]" />`;

  function driverWithDump(dump) {
    return createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  }

  test('true for the card that IS the target', async () => {
    const d = await driverWithDump(dumpFor('50000010'));
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(true);
  });

  test('FALSE for a different user’s card — the whole point', async () => {
    const d = await driverWithDump(dumpFor('50000099'));
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(false);
  });

  test('a prefix does not satisfy a longer id', async () => {
    // `userCard_5000001` must not answer an assertion about `userCard_50000010`
    // — the anchored closing quote is what prevents it.
    const d = await driverWithDump(dumpFor('5000001'));
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(false);
  });

  test('false when no card is open at all', async () => {
    const d = await driverWithDump('<node resource-id="a/main_roomsTab" />');
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(false);
  });

  test('false when given no target, rather than passing vacuously', async () => {
    const d = await driverWithDump(dumpFor('50000010'));
    for (const bad of [undefined, null, '']) {
      expect(await d.androidShowsUserCard('Bea', bad)).toBe(false);
    }
  });
});
