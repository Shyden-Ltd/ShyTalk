/**
 * SHY-0271 — locale strings are CONTENT, and nothing was checking their content.
 *
 * The operator read `Driver\'s license` — with a literal backslash — off the
 * age-verification screen. It had shipped. Every existing check passed it:
 *
 *   - key-parity across the 21 locales counts KEYS, never their values
 *   - journey and instrumented assertions match by testTag, so a control with
 *     a corrupt label is still "found"
 *   - nothing at all reads the locale files as text
 *
 * The trap: `\'` and `\"` are ANDROID XML escaping. Compose Multiplatform's
 * `composeResources` does NOT unescape them, so they render literally. The
 * English file already carried 11 correctly-unescaped apostrophes ALONGSIDE 17
 * escaped ones, so the corpus contradicted itself and no one noticed.
 *
 * `\n` is deliberately still allowed — it is a real line break and renders
 * correctly. This checks the escapes that are known to leak to the screen.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RES_DIR = path.join(REPO_ROOT, 'shared', 'src', 'commonMain', 'composeResources');

function localeFiles() {
  return fs
    .readdirSync(RES_DIR)
    .filter((d) => d === 'values' || d.startsWith('values-'))
    .map((d) => ({ locale: d, file: path.join(RES_DIR, d, 'strings.xml') }))
    .filter(({ file }) => fs.existsSync(file));
}

/** [{ locale, name, value }] for every <string> in every locale. */
function allStrings() {
  const out = [];
  for (const { locale, file } of localeFiles()) {
    const xml = fs.readFileSync(file, 'utf8');
    for (const m of xml.matchAll(/<string name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
      out.push({ locale, name: m[1], value: m[2] });
    }
  }
  return out;
}

describe('locale strings render as written', () => {
  const strings = allStrings();

  test('the locale corpus was actually read (vacuous-pass guard)', () => {
    expect(localeFiles().length).toBeGreaterThanOrEqual(20);
    expect(strings.length).toBeGreaterThan(15000);
  });

  test('no string carries an Android-style escaped apostrophe or quote', () => {
    // These reach the screen verbatim under Compose Multiplatform. The user
    // sees the backslash.
    const offenders = strings
      .filter((s) => /\\['"]/.test(s.value))
      .map((s) => `${s.locale}/${s.name}: ${s.value.slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });

  test('no string is empty or whitespace-only', () => {
    const offenders = strings
      .filter((s) => s.value.trim() === '')
      .map((s) => `${s.locale}/${s.name}`);
    expect(offenders).toEqual([]);
  });

  test('no string leaks a developer marker left in place of copy', () => {
    // TODO is deliberately NOT checked in es/pt: "todo" is the ordinary word
    // for "all" there, and `RECOGER TODO` ("collect all") is correct Spanish.
    // Flagging it would be the classic locale false positive — the detector
    // would be wrong, not the translation.
    const TODO_IS_A_REAL_WORD = new Set(['values-es', 'values-pt']);
    const offenders = strings
      .filter((s) => {
        if (/\b(FIXME|XXX|PLACEHOLDER)\b/.test(s.value)) return true;
        if (TODO_IS_A_REAL_WORD.has(s.locale)) return false;
        return /\bTODO\b/.test(s.value);
      })
      .map((s) => `${s.locale}/${s.name}: ${s.value.slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });

  test('no string contains a stray XML/HTML tag', () => {
    // Compose renders these literally; they are almost always a paste error.
    const offenders = strings
      .filter((s) => /<\/?(?:div|span|p|br|b|i|html|body)\b/i.test(s.value))
      .map((s) => `${s.locale}/${s.name}: ${s.value.slice(0, 60)}`);
    expect(offenders).toEqual([]);
  });

  test('the escape detector actually fires (mutation guard)', () => {
    // Proves the regex above can fail — a content check that cannot detect its
    // own target is the reason this shipped in the first place.
    const sample = [{ locale: 'values', name: 'probe', value: "Driver\\'s license" }];
    const caught = sample.filter((s) => /\\['"]/.test(s.value));
    expect(caught).toHaveLength(1);
  });
});
