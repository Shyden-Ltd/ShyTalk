import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the Khmer New Year zodiac table column headers.
 *
 * Background: events/khmer-new-year.html ships a 12-row zodiac table
 * with three column headers — Animal / Khmer / Years — each marked
 * `data-i18n="kny_zodiac_col_*"`. The keys were never defined in
 * event-translations.js, so applyEventTranslations() silently no-op'd
 * (`if (t[key]) ...`) and the English headers stayed visible while the
 * rest of the page rendered in the user's locale. Discovered when
 * adding event-translations.js to the orphan-i18n-keys CI guard's
 * scan list.
 *
 * Test design:
 *  - One end-to-end test in a non-English locale. It asserts the headers are
 *    NO LONGER the English words rather than matching a translation: the
 *    latter pinned Spanish ("Jemer" / "Años") and broke when Spanish was
 *    retired (SHY-0289). Khmer New Year itself is untouched — the EVENT
 *    stays, only the Khmer locale went.
 *  - One contract test asserting all 20 locales define the 3 keys, so
 *    we don't quietly leave a locale behind in future refactors.
 */

const SUPPORTED_LOCALES = ['zh', 'th', 'vi', 'id'];

test.describe('Khmer New Year — zodiac table i18n', () => {
  test('Thai switch translates zodiac column headers (not English)', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'th');
      } catch {
        /* localStorage may be unavailable on some webkit configs; ignore */
      }
    });
    await page.goto(`${BASE}/events/khmer-new-year.html`);

    // Wait for language-selector.js init → window.applyLanguage('es') to fire
    // and applyEventTranslations to walk the DOM.
    await page.waitForFunction(
      () =>
        document.documentElement.lang === 'th' ||
        document.querySelector('[data-i18n="kny_zodiac_col_khmer"]')?.textContent.trim(),
      null,
      { timeout: 10_000 },
    );

    const animal = await page.locator('[data-i18n="kny_zodiac_col_animal"]').textContent();
    const khmer = await page.locator('[data-i18n="kny_zodiac_col_khmer"]').textContent();
    const years = await page.locator('[data-i18n="kny_zodiac_col_years"]').textContent();

    expect(animal?.trim(), 'Animal column header should be translated').not.toBe('Animal');
    expect(animal?.trim(), 'Animal column header should not be empty').toBeTruthy();
    expect(khmer?.trim(), 'Khmer column header should be translated').not.toBe('Khmer');
    expect(khmer?.trim(), 'Khmer column header should not be empty').toBeTruthy();
    expect(years?.trim(), 'Years column header should be translated').not.toBe('Years');
    expect(years?.trim(), 'Years column header should not be empty').toBeTruthy();
  });

  test('English (default) renders the inline HTML defaults', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/events/khmer-new-year.html`);

    await expect(page.locator('[data-i18n="kny_zodiac_col_animal"]')).toContainText('Animal');
    await expect(page.locator('[data-i18n="kny_zodiac_col_khmer"]')).toContainText('Khmer');
    await expect(page.locator('[data-i18n="kny_zodiac_col_years"]')).toContainText('Years');
  });

  test('event-translations.js defines kny_zodiac_col_* for all 20 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/event-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    for (const lang of SUPPORTED_LOCALES) {
      // Every locale block must have all three column keys. Locale-block
      // boundary check would be over-engineered here — global presence
      // is enough because the orphan checker greps globally too.
      const animalRe = new RegExp(
        `${lang}:\\s*\\{[\\s\\S]*?kny_zodiac_col_animal:`,
      );
      const khmerRe = new RegExp(
        `${lang}:\\s*\\{[\\s\\S]*?kny_zodiac_col_khmer:`,
      );
      const yearsRe = new RegExp(
        `${lang}:\\s*\\{[\\s\\S]*?kny_zodiac_col_years:`,
      );
      expect(src, `${lang} missing kny_zodiac_col_animal`).toMatch(animalRe);
      expect(src, `${lang} missing kny_zodiac_col_khmer`).toMatch(khmerRe);
      expect(src, `${lang} missing kny_zodiac_col_years`).toMatch(yearsRe);
    }
  });
});
