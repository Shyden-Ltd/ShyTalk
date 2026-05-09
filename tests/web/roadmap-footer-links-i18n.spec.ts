import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the roadmap footer LINK i18n gap surfaced during
 * PR #579 manual-QA.
 *
 * Background: roadmap.html shipped four hardcoded English footer links
 * — Privacy Policy, Terms, Community Guidelines, Do Not Sell or Share
 * My Personal Information. The translations for these (footer_privacy,
 * footer_terms, footer_guidelines, footer_do_not_sell) had been added
 * to legal-translations.js in PR #573 for legal pages, but roadmap.html
 * never loaded that script — so its footer links rendered English in
 * every locale even though the rest of the page (disclaimer, copyright)
 * translated correctly.
 *
 * Fix: load legal-translations.js (with `LEGAL_PAGE_TYPE='roadmap'` —
 * no LEGAL_T.roadmap section so only LEGAL_T.footer applies), refactor
 * roadmap-app.js applyLanguage to chain (not replace) the prior
 * handler, and add `data-i18n` attributes to the four link texts.
 *
 * Test design: Spanish locale (Latin script, easiest to detect drift),
 * with a structural check that all four data-i18n attrs exist in HTML.
 */

test.describe('Roadmap footer links i18n', () => {
  test('Spanish locale translates all four footer links', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);

    // Wait for the legal-translations chain to apply via language-selector init.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n="footer_privacy"]');
        return !!(el && el.textContent && el.textContent.includes('Política'));
      },
      null,
      { timeout: 10_000 },
    );

    const privacy = (await page.locator('[data-i18n="footer_privacy"]').textContent())?.trim();
    const terms = (await page.locator('[data-i18n="footer_terms"]').textContent())?.trim();
    const guidelines = (await page.locator('[data-i18n="footer_guidelines"]').textContent())?.trim();
    const dns = (await page.locator('[data-i18n="footer_do_not_sell"]').textContent())?.trim();

    expect(privacy, 'footer_privacy should not be English').not.toBe('Privacy Policy');
    expect(privacy, 'footer_privacy in es').toContain('Política');
    expect(terms, 'footer_terms should not be English').not.toBe('Terms');
    expect(guidelines, 'footer_guidelines should not be English').not.toBe('Community Guidelines');
    expect(dns, 'footer_do_not_sell should not be English').not.toBe(
      'Do Not Sell or Share My Personal Information',
    );
  });

  test('English (default) renders the inline HTML defaults', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);

    await expect(page.locator('[data-i18n="footer_privacy"]')).toContainText('Privacy Policy');
    await expect(page.locator('[data-i18n="footer_terms"]')).toContainText('Terms');
    await expect(page.locator('[data-i18n="footer_guidelines"]')).toContainText(
      'Community Guidelines',
    );
    await expect(page.locator('[data-i18n="footer_do_not_sell"]')).toContainText(
      'Do Not Sell or Share My Personal Information',
    );
  });

  test('roadmap-app.js applyLanguage chains rather than replaces (preserves prior handlers)', async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/js/roadmap-app.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    // Look for the chain pattern: capture _prev, call it after own work.
    expect(src, 'roadmap-app.js must capture prior applyLanguage in _prev').toMatch(
      /var\s+_prev\s*=\s*window\.applyLanguage/,
    );
    expect(src, 'roadmap-app.js must call _prev to preserve chain').toMatch(
      /_prev\s*\(\s*lang\s*\)/,
    );
  });
});
