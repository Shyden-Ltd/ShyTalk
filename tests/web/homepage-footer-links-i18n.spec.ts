import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the homepage footer LINK i18n gap.
 *
 * Background: index.html shipped six hardcoded English footer strings
 * — Privacy Policy, Terms of Service, Community Guidelines, Cyber
 * Bullying Policy, Do Not Sell or Share My Personal Information, and
 * the © Shyden Ltd copyright line. None had `data-i18n` attributes,
 * so they rendered English in every locale even though the rest of
 * the homepage (tagline, Coming Soon, App Store, roadmap CTA)
 * translated correctly.
 *
 * Fix: load legal-translations.js (with `LEGAL_PAGE_TYPE='home'` —
 * no LEGAL_T.home section so only LEGAL_T.footer applies), refactor
 * the inline applyLanguage to chain with the prior handler, and add
 * `data-i18n` attributes to the six footer texts.
 */

test.describe('Homepage footer links + copyright i18n', () => {
  test('Spanish locale translates all five footer links + copyright', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/index.html`);

    // Wait for legal-translations chain to fire via the inline IIFE init.
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
    const cyber = (await page.locator('[data-i18n="footer_cyber"]').textContent())?.trim();
    const dns = (await page.locator('[data-i18n="footer_do_not_sell"]').textContent())?.trim();
    const copyright = (await page.locator('[data-i18n="footer_copy"]').textContent())?.trim();

    expect(privacy, 'footer_privacy').not.toBe('Privacy Policy');
    expect(privacy).toContain('Política');
    expect(terms, 'footer_terms').not.toBe('Terms of Service');
    expect(guidelines, 'footer_guidelines').not.toBe('Community Guidelines');
    expect(cyber, 'footer_cyber').not.toBe('Cyber Bullying Policy');
    expect(dns, 'footer_do_not_sell').not.toBe('Do Not Sell or Share My Personal Information');
    expect(copyright, 'footer_copy').not.toBe('© 2026 Shyden Ltd. All rights reserved.');
    expect(copyright, 'footer_copy in Spanish should mention "derechos"').toContain('derechos');
  });

  test('English (default) renders the inline HTML defaults', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/index.html`);

    await expect(page.locator('[data-i18n="footer_privacy"]')).toContainText('Privacy Policy');
    await expect(page.locator('[data-i18n="footer_terms"]')).toContainText('Terms of Service');
    await expect(page.locator('[data-i18n="footer_guidelines"]')).toContainText(
      'Community Guidelines',
    );
    await expect(page.locator('[data-i18n="footer_cyber"]')).toContainText('Cyber Bullying Policy');
    await expect(page.locator('[data-i18n="footer_do_not_sell"]')).toContainText(
      'Do Not Sell or Share My Personal Information',
    );
    await expect(page.locator('[data-i18n="footer_copy"]')).toContainText('Shyden Ltd');
  });

  test('Homepage-specific keys (tagline, app_store) still translate after the chain refactor', async ({
    page,
  }) => {
    // Regression: ensure the chain refactor didn't break the inline
    // homepage translations. Spanish has tagline + app_store defined
    // in the inline `t` dict.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/index.html`);

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n="tagline"]');
        return !!(el && el.textContent && el.textContent.includes('Salas'));
      },
      null,
      { timeout: 10_000 },
    );

    const tagline = (await page.locator('[data-i18n="tagline"]').textContent())?.trim();
    expect(tagline, 'tagline in es').toContain('Salas');
  });
});
