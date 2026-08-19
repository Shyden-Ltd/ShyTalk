import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression: footer i18n was silently broken across the legal pages.
 *
 * Two distinct gaps surfaced 2026-05-09 via /manual-qa:
 *
 * 1. `footer_privacy` was REFERENCED in HTML (terms / community-guidelines /
 *    privacy / cyber-bullying / do-not-sell) but UNDEFINED in
 *    legal-translations.js for all 20 locales — so "Privacy Policy" stayed
 *    in English even after switching to e.g. Arabic. The
 *    `applyLegalTranslations` pattern (`if (t[key]) el.innerHTML = t[key]`)
 *    silently no-ops on undefined keys, hiding the gap from visual scan.
 *
 * 2. `footer_do_not_sell` was MISSING entirely — neither the HTML referenced
 *    it nor the JS defined it. The "Do Not Sell or Share My Personal
 *    Information" link stayed English regardless of locale.
 *
 * Plus cyber-bullying.html and do-not-sell.html footer links had NO
 * `data-i18n` attributes at all (whole footer untranslated), and
 * do-not-sell.html wasn't loading legal-translations.js OR setting
 * window.LEGAL_PAGE_TYPE — so even adding data-i18n there required wiring
 * the i18n bridge first.
 *
 * The test suite hits Arabic (RTL + non-Latin script — easiest to detect
 * remaining English) on all 5 legal pages and asserts every footer link's
 * text changed away from English defaults.
 */

const ENGLISH_FOOTER_TEXTS = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  guidelines: 'Community Guidelines',
  cyber: 'Cyber Bullying Policy',
  do_not_sell: 'Do Not Sell or Share My Personal Information',
};

const PAGES = [
  { path: '/terms.html', selfKey: 'terms' },
  { path: '/privacy.html', selfKey: 'privacy' },
  { path: '/community-guidelines.html', selfKey: 'guidelines' },
  { path: '/cyber-bullying.html', selfKey: 'cyber' },
  { path: '/do-not-sell.html', selfKey: 'do_not_sell' },
];

test.describe('Legal footer i18n — every page, every locale-switch', () => {
  for (const { path, selfKey } of PAGES) {
    test(`${path} translates every footer link to Arabic`, async ({ page }) => {
      // Pre-set the saved language so applyLanguage fires on init via the
      // legal-translations.js inline bridge, not via the language-selector
      // modal click flow (faster + more deterministic).
      await page.addInitScript(() => {
        localStorage.setItem('shytalk_language', 'ar');
      });
      await page.goto(`${BASE}${path}`);
      // Wait for the inline init script to apply translations.
      await page.waitForFunction(
        () => document.documentElement.lang === 'ar',
        null,
        { timeout: 5_000 },
      );

      // Every footer link visible on this page must NOT contain its English
      // default text after the locale switch. (The page's self-link isn't
      // rendered in its own footer — skip it.)
      for (const [key, englishText] of Object.entries(ENGLISH_FOOTER_TEXTS)) {
        if (key === selfKey) continue;
        const link = page.locator(`footer a[data-i18n="footer_${key}"]`);
        const count = await link.count();
        if (count === 0) continue; // page doesn't link to this policy
        const text = await link.first().textContent();
        expect(
          text?.trim(),
          `${path} footer link footer_${key} stayed in English ("${text?.trim()}") after Arabic switch — likely missing translation key in legal-translations.js or missing data-i18n attribute`,
        ).not.toBe(englishText);
        // Sanity: should contain non-Latin Arabic characters (؀-ۿ block).
        expect(text).toMatch(/[؀-ۿ]/);
      }
    });
  }

  test('legal-translations.js defines footer_privacy + footer_do_not_sell for all 20 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const locales = ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko', 'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];
    for (const locale of locales) {
      // Find this locale's line in the footer object (locale: { ... })
      const localeLineMatch = new RegExp(`\\s${locale}: \\{ [^\\n]*footer_copy:`, 'g').exec(text);
      expect(localeLineMatch, `${locale} footer line not found`).not.toBeNull();
      const localeLine = localeLineMatch![0];
      expect(localeLine, `${locale} missing footer_privacy`).toContain('footer_privacy:');
      expect(localeLine, `${locale} missing footer_do_not_sell`).toContain('footer_do_not_sell:');
    }
  });
});
