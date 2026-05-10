import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for language-selector modal i18n.
 *
 * Background: language-selector.js builds a modal at page init with
 * hardcoded English strings — "Select Language" (h2), "Search
 * languages..." (placeholder), "No languages found" (empty state),
 * plus several aria-labels. The modal is loaded on every page with
 * shared-header (8+ pages), so non-English users see English in the
 * UI they're using to CHANGE language away from English.
 *
 * This PR translates the two highest-impact visible strings:
 *  - lang_select_title  (h2 — most prominent text in modal)
 *  - lang_empty_state   (visible when search filter matches nothing)
 *
 * Placeholder + aria-labels deferred to a follow-up — they need
 * data-i18n-placeholder + data-i18n-aria-label iterator support which
 * doesn't exist in the existing translation modules yet.
 */

test.describe('Language selector modal i18n', () => {
  test('Spanish locale on /privacy.html shows translated modal title', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    // Wait for legal-translations applyLanguage chain to fire.
    await page.waitForFunction(
      () => {
        const h2 = document.querySelector('[data-i18n="lang_select_title"]');
        return !!(h2 && h2.textContent && h2.textContent.includes('Seleccionar'));
      },
      null,
      { timeout: 10_000 },
    );

    const title = (await page.locator('[data-i18n="lang_select_title"]').textContent())?.trim();
    expect(title, 'lang_select_title in es should NOT be English').not.toBe('Select Language');
    expect(title, 'lang_select_title in es should be "Seleccionar idioma"').toBe('Seleccionar idioma');
  });

  test('Spanish locale empty-state renders Spanish text', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    // Open the modal via the globe button, type a nonsense query that
    // matches zero languages, and assert the empty-state text.
    await page.locator('[data-testid="language-selector"]').click();
    await page.locator('.stl-lang-search').fill('nonsense_no_match');
    await page.waitForFunction(
      () => {
        const list = document.querySelector('.stl-lang-list');
        return !!(list && list.textContent && list.textContent.length > 0);
      },
      null,
      { timeout: 5_000 },
    );

    const listText = (await page.locator('.stl-lang-list').textContent())?.trim();
    expect(listText, 'empty-state in es should NOT be "No languages found"').not.toBe(
      'No languages found',
    );
    expect(listText, 'empty-state in es should be "No se encontraron idiomas"').toBe(
      'No se encontraron idiomas',
    );
  });

  test('English locale renders inline HTML defaults', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    const title = (await page.locator('[data-i18n="lang_select_title"]').textContent())?.trim();
    expect(title).toBe('Select Language');

    await page.locator('[data-testid="language-selector"]').click();
    await page.locator('.stl-lang-search').fill('nonsense_no_match');
    await page.waitForFunction(
      () => {
        const list = document.querySelector('.stl-lang-list');
        return !!(list && list.textContent && list.textContent.length > 0);
      },
      null,
      { timeout: 5_000 },
    );

    const listText = (await page.locator('.stl-lang-list').textContent())?.trim();
    expect(listText).toBe('No languages found');
  });

  test('LEGAL_T.footer defines lang_select_title + lang_empty_state for all 20 locales', async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const SUPPORTED = [
      'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi',
      'tr', 'ru', 'uk', 'th', 'vi', 'id', 'pl', 'nl', 'sv', 'km',
    ];
    for (const lang of SUPPORTED) {
      const rowRe = new RegExp(
        `${lang}:\\s*\\{[^{}]*lang_select_title:[^,}]+,[^{}]*lang_empty_state:`,
      );
      expect(src, `${lang} missing lang_select_title or lang_empty_state`).toMatch(rowRe);
    }
  });
});
