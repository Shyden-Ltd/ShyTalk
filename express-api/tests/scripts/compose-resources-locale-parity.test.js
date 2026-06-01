/**
 * Compose strings.xml locale parity.
 *
 * The shared/composeResources/values/strings.xml file is the canonical
 * source of every user-facing string in the Kotlin Multiplatform app.
 * Per CLAUDE.md ("Translations — user-facing strings must go in ALL 20
 * locale files"), each of the 20 translated locales MUST contain the
 * same set of keys — no missing, no extras.
 *
 * Asymmetry that bit us: a missing key falls back to the default-locale
 * value at runtime, so the user sees English in their selected locale.
 * Extra keys (drift) silently bloat the resource table and confuse
 * future translators about whether a key is current.
 *
 * Two assertions per locale:
 *   1. defaultKeys ⊆ localeKeys  (no missing)
 *   2. localeKeys ⊆ defaultKeys  (no drift / extras)
 *
 * Failure output shows the offending key list, not just a count, so a
 * single failing test pinpoints exactly what needs translating.
 */

const fs = require('node:fs');
const path = require('node:path');

const RESOURCES_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'shared',
  'src',
  'commonMain',
  'composeResources',
);

const ALL_LOCALES = [
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'km',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
];

function readKeys(localeDir) {
  const xmlPath = path.join(RESOURCES_DIR, localeDir, 'strings.xml');
  const content = fs.readFileSync(xmlPath, 'utf-8');
  const keys = new Set();
  for (const match of content.matchAll(/<string name="([^"]+)"/g)) {
    keys.add(match[1]);
  }
  return keys;
}

describe('Compose strings.xml locale parity', () => {
  test('default values/strings.xml exists', () => {
    const xmlPath = path.join(RESOURCES_DIR, 'values', 'strings.xml');
    expect(fs.existsSync(xmlPath)).toBe(true);
  });

  test.each(ALL_LOCALES)('values-%s/strings.xml exists', (locale) => {
    const xmlPath = path.join(RESOURCES_DIR, `values-${locale}`, 'strings.xml');
    expect(fs.existsSync(xmlPath)).toBe(true);
  });

  // The default-locale read happens inside describe so the test file
  // surfaces a clear error if values/strings.xml is itself broken,
  // rather than every test-each invocation echoing the same failure.
  const defaultKeys = readKeys('values');

  test('default values/strings.xml has at least 100 keys (sanity)', () => {
    expect(defaultKeys.size).toBeGreaterThanOrEqual(100);
  });

  test.each(ALL_LOCALES)('values-%s contains every default key', (locale) => {
    const localeKeys = readKeys(`values-${locale}`);
    const missing = [...defaultKeys].filter((k) => !localeKeys.has(k)).sort();
    expect({ locale, missing }).toEqual({ locale, missing: [] });
  });

  test.each(ALL_LOCALES)('values-%s has no extra keys (no drift)', (locale) => {
    const localeKeys = readKeys(`values-${locale}`);
    const extra = [...localeKeys].filter((k) => !defaultKeys.has(k)).sort();
    expect({ locale, extra }).toEqual({ locale, extra: [] });
  });
});
