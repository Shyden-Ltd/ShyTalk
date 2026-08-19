import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for two roadmap.html aria-label orphans:
 *   - <section id="suggestions" aria-label="Feature suggestions">
 *   - <nav class="footer-links" aria-label="Legal">
 *
 * Background: PRs #589 + #590 added the data-i18n-aria-label
 * infrastructure and translated 5 + 5 aria-labels respectively
 * (chart, progress overview, page sections, subscribe, roadmap;
 * language-selector trigger + modal close + locale rows). Two
 * roadmap aria-labels were missed in that sweep — "Feature
 * suggestions" on the suggestions section and "Legal" on the
 * footer nav.
 *
 * Without translation, screen-reader users in non-English locales
 * hear English aria-labels even when the visual UI translates
 * correctly — exactly the silent-i18n class of bug the new
 * infrastructure was built to retire.
 *
 * Test design: a structural test asserting the two new keys exist
 * in all 20 locales of LEGAL_T.footer, plus runtime tests in two
 * representative locales (Arabic for RTL, Korean for CJK)
 * confirming the translation actually reaches the DOM after
 * applyLanguage runs.
 */

const SUPPORTED_LOCALES = [
  'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

test.describe('Roadmap aria-label i18n: suggestions + legal nav', () => {
  test('LEGAL_T.footer defines aria_suggestions + aria_legal_links in all 20 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    for (const lang of SUPPORTED_LOCALES) {
      // Each locale row in LEGAL_T.footer is single-line:
      // `    <lang>: { ... aria_legal_links: '...' }`
      // Use a tolerant matcher anchored on the locale prefix.
      const rowRe = new RegExp(`^\\s+${lang}:\\s*\\{[^\\n]+aria_roadmap[^\\n]+\\}`, 'm');
      const rowMatch = src.match(rowRe);
      expect(rowMatch, `${lang} footer row not found`).not.toBeNull();
      const row = rowMatch![0];
      expect(row, `${lang} missing aria_suggestions`).toMatch(/aria_suggestions:\s*['"][^'"]+['"]/);
      expect(row, `${lang} missing aria_legal_links`).toMatch(/aria_legal_links:\s*['"][^'"]+['"]/);
    }
  });

  test('Arabic locale: roadmap aria-labels render in Arabic script after applyLanguage', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ar'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(() => {
      const el = document.querySelector('#suggestions[aria-label]');
      // Wait until aria-label has been replaced by applyLegalTranslations.
      return el && el.getAttribute('aria-label') !== 'Feature suggestions';
    }, undefined, { timeout: 10_000 });

    const suggestionsAria = await page.locator('#suggestions').getAttribute('aria-label');
    expect(suggestionsAria, 'suggestions aria-label should not be English').not.toBe('Feature suggestions');
    expect(suggestionsAria, 'suggestions aria-label should contain Arabic script').toMatch(/[؀-ۿ]/);

    const legalNavAria = await page.locator('nav.footer-links').getAttribute('aria-label');
    expect(legalNavAria, 'legal nav aria-label should not be English').not.toBe('Legal');
    expect(legalNavAria, 'legal nav aria-label should contain Arabic script').toMatch(/[؀-ۿ]/);
  });

  test('Korean locale: roadmap aria-labels render in Hangul', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(() => {
      const el = document.querySelector('#suggestions[aria-label]');
      return el && el.getAttribute('aria-label') !== 'Feature suggestions';
    }, undefined, { timeout: 10_000 });

    const suggestionsAria = await page.locator('#suggestions').getAttribute('aria-label');
    expect(suggestionsAria, 'suggestions aria-label should contain Hangul').toMatch(/[가-힯]/);
    const legalNavAria = await page.locator('nav.footer-links').getAttribute('aria-label');
    expect(legalNavAria, 'legal nav aria-label should contain Hangul').toMatch(/[가-힯]/);
  });
});
