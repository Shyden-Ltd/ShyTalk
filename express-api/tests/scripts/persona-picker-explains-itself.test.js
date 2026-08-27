/**
 * SHY-0416 — a picker that cannot work must SAY so, not render nothing.
 *
 * The dialog used to be gated on the credential itself:
 *
 *     if (showPersonaPicker && BuildVariant.isPersonaPickerAvailable) { … }
 *
 * so a build without one set `showPersonaPicker` and then rendered nothing. The
 * button looked broken, and the "actionable empty state" its own comment promised
 * was unreachable code. Every iOS dev build was in that state for months.
 *
 * This guard exists because the fix is one condition and the regression is
 * invisible: re-adding the credential to that gate compiles, passes every unit
 * test, and silently restores a dead button.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');

const SCREEN = 'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/SignInScreen.kt';
const repoRoot = path.resolve(__dirname, '../../..');

const codeOf = () => {
  const p = path.join(repoRoot, SCREEN);
  expect(fs.existsSync(p)).toBe(true);
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
};

describe('the persona picker explains itself when it cannot work', () => {
  test('the picker is still there (the guard is not vacuous)', () => {
    const code = codeOf();

    expect(code).toContain('showPersonaPicker');
    expect(code).toContain('isPersonaPickerAvailable');
  });

  test('opening the dialog is not gated on the credential', () => {
    // That gate is what made the button do nothing.
    expect(codeOf()).not.toMatch(
      /if\s*\(\s*showPersonaPicker\s*&&\s*BuildVariant\.isPersonaPickerAvailable\s*\)/,
    );
  });

  test('a build without the credential renders an explanation', () => {
    const code = codeOf();

    expect(code).toContain('persona_picker_unavailable');
    expect(code).toMatch(/DEV_QA_PERSONAS_PASSWORD/);
  });

  test('the sign-in path still fails closed without a credential', () => {
    // The security property the old gate was credited with. It lives in the row
    // handler, which is where it always actually lived.
    const code = codeOf();
    const handler = code.slice(code.indexOf('localDevPersonasPassword'));

    expect(handler).toMatch(/isNullOrEmpty\(\)/);
    expect(handler).toMatch(/return@PersonaPickerRow/);
  });
});
