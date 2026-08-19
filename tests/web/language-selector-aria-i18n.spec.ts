import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for language-selector aria-label i18n.
 *
 * Background: language-selector.js injects a globe button + modal with
 * five hardcoded English aria-labels: "Change language" (button),
 * "Select language" (overlay), "Close" (close button), "Search
 * languages" (input), "Languages" (listbox). Screen reader users in
 * non-English locales heard English labels even when navigating to
 * the very modal that lets them change language.
 *
 * Fix builds on PR #589's data-i18n-aria-label iterator: 5 aria_*
 * keys added to LEGAL_T.footer + 5 data-i18n-aria-label attributes
 * applied to the language-selector elements.
 *
 * Test design: Spanish locale on /privacy.html, assert all 5 elements
 * have Spanish aria-label after init. Plus structural test that all
 * 20 locales define all 5 keys.
 */

test.describe('Language selector aria-label i18n', () => {
  test('Spanish locale translates all 5 language-selector aria-labels', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    // Wait for legal-translations applyLanguage chain to fire and apply
    // aria-labels to the injected language-selector DOM.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n-aria-label="aria_change_language"]');
        return !!(el && el.getAttribute('aria-label') === 'Cambiar idioma');
      },
      null,
      { timeout: 10_000 },
    );

    // Open modal so the listbox/search/close are mounted (they're inside
    // overlay innerHTML so always in DOM, but openModal puts modal in view).
    await page.locator('[data-testid="language-selector"]').click();

    const cases: Array<[string, string]> = [
      ['aria_change_language', 'Cambiar idioma'],
      ['aria_select_language_dialog', 'Seleccionar idioma'],
      ['aria_close', 'Cerrar'],
      ['aria_search_languages', 'Buscar idiomas'],
      ['aria_languages_list', 'Idiomas'],
    ];

    for (const [key, expected] of cases) {
      const sel = `[data-i18n-aria-label="${key}"]`;
      const aria = await page.locator(sel).getAttribute('aria-label');
      expect(aria, `${key}`).toBe(expected);
    }
  });

  test('English locale leaves the inline HTML aria-label defaults', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    const sel = '[data-i18n-aria-label="aria_change_language"]';
    const aria = await page.locator(sel).getAttribute('aria-label');
    expect(aria).toBe('Change language');
  });

  test('LEGAL_T.footer defines all 5 language-selector aria_* keys for all 20 locales', async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const SUPPORTED = [
      'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi',
      'tr', 'ru', 'uk', 'th', 'vi', 'id', 'pl', 'nl', 'sv', 'km',
    ];
    const KEYS = [
      'aria_change_language',
      'aria_select_language_dialog',
      'aria_close',
      'aria_search_languages',
      'aria_languages_list',
    ];
    for (const lang of SUPPORTED) {
      for (const key of KEYS) {
        const rowRe = new RegExp(`${lang}:\\s*\\{[^{}]*${key}:`);
        expect(src, `${lang} missing ${key}`).toMatch(rowRe);
      }
    }
  });
});
