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
 *
 * Warning-state fixture (warning_acknowledgeButton) is captured + asserted once
 * androidSignOut can switch to P-10 (has hasActiveWarning) — sequenced within
 * SHY-0096; the classifier's warning branch is exercised by the synthetic-tag
 * cases below in the meantime so the branch is not untested.
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
