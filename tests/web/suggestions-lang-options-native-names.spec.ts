import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for LANG_OPTIONS native-name labels in suggestions-board.js.
 *
 * Pre-fix, the language filter dropdown rendered English language NAMES
 * ("Arabic", "German", "Korean") for every locale option. A French user
 * filtering by Arabic suggestions would see the option as "Arabic"
 * instead of "العربية". This breaks the standard convention of
 * displaying language names in their NATIVE script (cf. Wikipedia's
 * language sidebar, YouTube's language picker).
 *
 * Fix: replace English names with native names. Reference:
 * `language-selector.js`'s `LANGUAGES` array, where each entry has
 * a `native` field that this PR copies into LANG_OPTIONS.
 *
 * No new translations needed — native names are language-property
 * data, not user-facing translation strings.
 */

const NATIVE_NAMES = {
  en: 'English',
  ar: 'العربية',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  km: 'ភាសាខ្មែរ',
  ko: '한국어',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  sv: 'Svenska',
  th: 'ไทย',
  tr: 'Türkçe',
  uk: 'Українська',
  vi: 'Tiếng Việt',
  zh: '中文',
};

test.describe('Suggestions-board LANG_OPTIONS native names', () => {
  test('LANG_OPTIONS labels use native script for each language', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Extract just the LANG_OPTIONS array literal.
    const langBlock = src.match(/var LANG_OPTIONS = \[([\s\S]*?)\];/);
    expect(langBlock, 'LANG_OPTIONS array not found').not.toBeNull();
    const arrSrc = langBlock![1];

    for (const [code, native] of Object.entries(NATIVE_NAMES)) {
      const re = new RegExp(`value:\\s*"${code}",\\s*label:\\s*"${native.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}"`);
      expect(arrSrc, `${code} label should be native "${native}"`).toMatch(re);
    }
  });

  test('LANG_OPTIONS no longer hardcodes English language names', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    const src = await res.text();
    const langBlock = src.match(/var LANG_OPTIONS = \[([\s\S]*?)\];/);
    const arrSrc = langBlock![1];
    // English language NAMES that should NOT appear (en is intentional).
    const englishNames = [
      'Arabic', 'German', 'Spanish', 'French', 'Hindi', 'Indonesian',
      'Italian', 'Japanese', 'Khmer', 'Korean', 'Dutch', 'Polish',
      'Portuguese', 'Russian', 'Swedish', 'Thai', 'Turkish', 'Ukrainian',
      'Vietnamese', 'Chinese',
    ];
    for (const name of englishNames) {
      expect(arrSrc, `English name "${name}" should not be in LANG_OPTIONS`).not.toMatch(
        new RegExp(`label:\\s*"${name}"`),
      );
    }
  });
});
