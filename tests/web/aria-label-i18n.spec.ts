import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the data-i18n-aria-label translation contract.
 *
 * Background: ARIA labels on roadmap.html were hardcoded English (5
 * landmarks + buttons). Screen reader users in non-English locales
 * heard English labels even when the visible page rendered in their
 * locale.
 *
 * Fix: extended applyLegalTranslations in legal-translations.js to
 * walk a new data-i18n-aria-label attribute (in addition to data-i18n).
 * Pages can now translate aria-labels per-locale by adding the
 * attribute and defining the key in LEGAL_T.footer.
 *
 * Test design: load /roadmap.html in Spanish (Latin script, easy to
 * detect drift), assert the 5 aria-labels are translated. Plus a
 * structural test asserting all 20 locales define the 5 keys.
 */

test.describe('Roadmap aria-label i18n', () => {
  test('Spanish locale translates all 5 roadmap aria-labels', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);

    // Wait for legal-translations applyLanguage to fire.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n-aria-label="aria_progress_overview"]');
        return !!(el && el.getAttribute('aria-label') === 'Resumen de progreso');
      },
      null,
      { timeout: 10_000 },
    );

    // Each landmark / button should now have the Spanish aria-label.
    const cases: Array<[string, string]> = [
      ['aria_progress_overview', 'Resumen de progreso'],
      ['aria_chart', 'Gráfico de finalización general'],
      ['aria_page_sections', 'Secciones de la página'],
      ['aria_subscribe', 'Suscribirse a actualizaciones'],
      ['aria_roadmap', 'Hoja de ruta de funciones'],
    ];

    for (const [key, expected] of cases) {
      const sel = `[data-i18n-aria-label="${key}"]`;
      const aria = await page.locator(sel).getAttribute('aria-label');
      expect(aria, `${key} aria-label`).toBe(expected);
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
    await page.goto(`${BASE}/roadmap.html`);

    const sel = '[data-i18n-aria-label="aria_progress_overview"]';
    const aria = await page.locator(sel).getAttribute('aria-label');
    // No translation pass for `en` runs (LEGAL_T.footer.en is undefined),
    // so the inline `aria-label="Progress overview"` from the HTML stays.
    expect(aria).toBe('Progress overview');
  });

  test('LEGAL_T.footer defines all 5 aria_* keys for all 20 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const SUPPORTED = [
      'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi',
      'tr', 'ru', 'uk', 'th', 'vi', 'id', 'pl', 'nl', 'sv', 'km',
    ];
    const KEYS = [
      'aria_progress_overview',
      'aria_chart',
      'aria_page_sections',
      'aria_subscribe',
      'aria_roadmap',
    ];
    for (const lang of SUPPORTED) {
      for (const key of KEYS) {
        const rowRe = new RegExp(`${lang}:\\s*\\{[^{}]*${key}:`);
        expect(src, `${lang} missing ${key}`).toMatch(rowRe);
      }
    }
  });
});
