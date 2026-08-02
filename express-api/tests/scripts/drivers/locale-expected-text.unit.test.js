/**
 * Running a journey in Thai must assert the THAI string, not the English one.
 *
 * The corpus asserts English literals — `Then Adam's app UI shows "Not enough
 * coins"`. Repeating that journey in the other four MVP locales (zh, id, vi, th)
 * without translating the expectation would fail every text assertion for a
 * reason that has nothing to do with the product, and prove nothing about the
 * translation.
 *
 * So the expected text is resolved English -> KEY -> target locale, against the
 * bundle the app actually ships (`composeResources/values-<locale>/strings.xml`).
 * Going through the key is what makes this a real check: a hard-coded Thai
 * expectation here would drift the first time a translator changed a word, and
 * would be asserting this file rather than the product.
 *
 * NOT EVERYTHING IS TRANSLATABLE, and pretending otherwise would make the whole
 * mechanism useless. Measured across the corpus: 22 text literals, of which only
 * 2 name a shipped UI string. The rest are DATA — `"6,000"`, a room called
 * `"Theo's Test Room"`, a message the scenario itself typed — which belong in no
 * string bundle and must pass through untouched. A guard that flagged every room
 * name would be deleted within a week, and rightly.
 */
const {
  expectedTextForLocale,
  keyForEnglishText,
  localisedString,
} = require('../../../scripts/drivers/app-ui-methods');

/** The MVP set. Anything outside it is not part of this contract yet. */
const MVP_LOCALES = ['en', 'zh', 'id', 'vi', 'th'];

describe('the string bundles are actually readable', () => {
  it('finds a known English string and its key', () => {
    // Calibration. If the index came back empty every check below would pass
    // while translating nothing.
    expect(keyForEnglishText('Not enough coins')).toBe('error_not_enough_coins');
  });

  it.each(MVP_LOCALES)('%s ships a translation for that key', (locale) => {
    expect(localisedString('error_not_enough_coins', locale)).toBeTruthy();
  });
});

describe('a UI string is translated for the run locale', () => {
  it.each([
    ['zh', '金币不够'],
    ['id', 'Koin tidak cukup'],
    ['vi', 'Không đủ xu'],
  ])('%s expects the shipped translation', (locale, expected) => {
    const r = expectedTextForLocale('Not enough coins', locale);
    expect(r).toEqual({ text: expected, translated: true, key: 'error_not_enough_coins' });
  });

  it('English is passed through without a lookup', () => {
    const r = expectedTextForLocale('Not enough coins', 'en');
    expect(r).toEqual({ text: 'Not enough coins', translated: false, key: null });
  });

  it('no locale behaves as English rather than throwing', () => {
    expect(expectedTextForLocale('Not enough coins', null).text).toBe('Not enough coins');
    expect(expectedTextForLocale('Not enough coins', undefined).text).toBe('Not enough coins');
  });
});

describe('data is left alone', () => {
  it.each([
    ['6,000', 'a formatted number'],
    ["Theo's Test Room", 'a room name the scenario created'],
    ['hello, alice — first PM from a new adult', 'a message the scenario typed'],
  ])('%s passes through untranslated (%s)', (text) => {
    const r = expectedTextForLocale(text, 'th');
    expect(r).toEqual({ text, translated: false, key: null });
  });

  it('a blank expectation stays blank and never matches everything', () => {
    expect(expectedTextForLocale('', 'th').text).toBe('');
    expect(expectedTextForLocale('   ', 'th').text).toBe('');
    expect(expectedTextForLocale(null, 'th').text).toBe('');
  });
});

describe('a missing translation is reported, not silently accepted', () => {
  it('flags a key with no entry in the target locale', () => {
    // An untranslated string in a SHIPPED locale is a real finding. Falling back
    // to English silently would make a locale run green while the user sees the
    // wrong language — the exact failure this whole exercise exists to catch.
    const key = keyForEnglishText('Not enough coins');
    expect(localisedString(key, 'xx-nonexistent')).toBeNull();
    const r = expectedTextForLocale('Not enough coins', 'xx-nonexistent');
    expect(r.missing).toBe(true);
    expect(r.translated).toBe(false);
    expect(r.key).toBe(key);
  });
});

describe('every MVP locale ships a complete bundle', () => {
  // The premise of repeating journeys per locale: if a bundle is short, the
  // locale run reports product failures that are really missing translations.
  const fs = require('fs');
  const path = require('path');
  const RES = path.resolve(__dirname, '../../../../shared/src/commonMain/composeResources');
  const countStrings = (dir) =>
    (fs.readFileSync(path.join(RES, dir, 'strings.xml'), 'utf8').match(/<string name="/g) || [])
      .length;

  it.each(MVP_LOCALES)('%s has the same number of strings as English', (locale) => {
    const dir = locale === 'en' ? 'values' : `values-${locale}`;
    expect(countStrings(dir)).toBe(countStrings('values'));
  });
});
