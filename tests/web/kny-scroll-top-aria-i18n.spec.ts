import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the khmer-new-year.html "Scroll to top" button
 * aria-label i18n.
 *
 * Background: the seasonal-event page (KNY) loads event-translations.js
 * which exposes EVENT_T per slug × locale. Pre-fix:
 *   1. event-translations.js's applyEventTranslations walked only
 *      [data-i18n] elements, NOT [data-i18n-aria-label]. The
 *      data-i18n-aria-label infrastructure (PR #589, generalised by
 *      PR #592's orphan-checker) was undiscovered here.
 *   2. The single hardcoded aria-label "Scroll to top" on the
 *      scroll-top button was English-only across all 20 supported
 *      KNY locales.
 *
 * This fix adds the aria-label walk to applyEventTranslations and
 * defines aria_scroll_to_top in all 20 KNY locales (en is skipped at
 * runtime — applyEventTranslations short-circuits on lang === 'en' —
 * so the HTML default "Scroll to top" stands for English users).
 */

const KNY_NON_EN_LOCALES = [
  'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

test.describe('KNY scroll-to-top aria-label i18n', () => {
  test('all 20 KNY non-en locales define aria_scroll_to_top', async ({ request }) => {
    const res = await request.get(`${BASE}/js/event-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    for (const lang of KNY_NON_EN_LOCALES) {
      // Each locale row contains its own `aria_scroll_to_top: '...'`
      // entry. Use a tolerant matcher anchored on the locale prefix
      // and `kny_footer:` (a stable end-of-row landmark).
      const rowRe = new RegExp(`    ${lang}:\\s*\\{[\\s\\S]*?kny_footer:[\\s\\S]*?\\},`);
      const rowMatch = src.match(rowRe);
      expect(rowMatch, `${lang} KNY row not found`).not.toBeNull();
      const row = rowMatch![0];
      expect(row, `${lang} missing aria_scroll_to_top`).toMatch(/aria_scroll_to_top:\s*['"][^'"]+['"]/);
    }
  });

  test('Khmer locale: scroll-top button aria-label translates to Khmer script', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'km'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/events/khmer-new-year.html`);
    await page.waitForFunction(() => {
      const el = document.querySelector('#scroll-top[aria-label]');
      return !!(el && el.getAttribute('aria-label') !== 'Scroll to top');
    }, undefined, { timeout: 10_000 });

    const aria = await page.locator('#scroll-top').getAttribute('aria-label');
    expect(aria, 'scroll-top aria-label should not be English').not.toBe('Scroll to top');
    expect(aria, 'scroll-top aria-label should contain Khmer script').toMatch(/[ក-៿]/);
  });

  test('English locale: scroll-top button keeps the HTML default (skip path)', async ({ page }) => {
    // applyEventTranslations short-circuits on lang === 'en', so the
    // HTML default "Scroll to top" stands for English users. This test
    // pins that contract — if someone refactors the function to no
    // longer skip English, they'll see English aria_scroll_to_top
    // need to be added.
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'en'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/events/khmer-new-year.html`);
    // Give the deferred scripts a moment to register their applyLanguage chain.
    await page.waitForFunction(
      () => typeof (window as Window & { applyLanguage?: (l: string) => void }).applyLanguage === 'function',
      undefined,
      { timeout: 5_000 },
    );
    const aria = await page.locator('#scroll-top').getAttribute('aria-label');
    expect(aria, 'scroll-top aria-label should be the English HTML default').toBe('Scroll to top');
  });
});
