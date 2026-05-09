import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the shared-header signIn/signOut i18n gap.
 *
 * Background: shared-header.js renders the page header with `<button
 * data-i18n="signIn">Sign In</button>` (or signOut for authenticated
 * users). The data-i18n keys were defined in suggestions-i18n.js
 * which only loads on roadmap.html. On the homepage, 404, and all 5
 * legal pages, the buttons rendered English in every locale.
 *
 * Two-part fix:
 *  1. Add signIn/signOut to LEGAL_T.footer in legal-translations.js
 *     for all 20 locales (already loaded by all shared-header pages).
 *  2. Re-apply window.applyLanguage(savedLang) at the end of
 *     shared-header's render() — its DOM is injected at
 *     DOMContentLoaded, AFTER deferred language-selector.js has
 *     already fired the initial applyLanguage call. Without the
 *     re-apply, the freshly-injected button has no translation
 *     pass to find it.
 *
 * Test pages: privacy.html and index.html (both static, both load
 * legal-translations.js, both render the unauthenticated Sign In
 * variant in tests since we don't seed Firebase auth).
 */

test.describe('Shared header signIn i18n', () => {
  test('Spanish locale on /privacy.html renders Sign In button in Spanish', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'es');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    // Wait for shared-header injection + applyLanguage re-apply.
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="header-signin-btn"]');
        return !!(btn && btn.textContent && btn.textContent.includes('Iniciar'));
      },
      null,
      { timeout: 10_000 },
    );

    const btn = page.locator('[data-testid="header-signin-btn"]');
    await expect(btn).toBeVisible();
    const text = (await btn.textContent())?.trim();
    expect(text, 'Sign In button must NOT be English in Spanish locale').not.toBe('Sign In');
    expect(text, 'Sign In button must contain "Iniciar" (Spanish)').toContain('Iniciar');
  });

  test('Spanish locale on /index.html (homepage) renders Sign In button in Spanish', async ({
    page,
  }) => {
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
        const btn = document.querySelector('[data-testid="header-signin-btn"]');
        return !!(btn && btn.textContent && btn.textContent.includes('Iniciar'));
      },
      null,
      { timeout: 10_000 },
    );

    const btn = page.locator('[data-testid="header-signin-btn"]');
    await expect(btn).toBeVisible();
    const text = (await btn.textContent())?.trim();
    expect(text, 'Sign In button must contain "Iniciar" (Spanish)').toContain('Iniciar');
  });

  test('English locale on /privacy.html renders inline English Sign In default', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/privacy.html`);

    await page.waitForSelector('[data-testid="header-signin-btn"]');
    const btn = page.locator('[data-testid="header-signin-btn"]');
    await expect(btn).toContainText('Sign In');
  });

  test('LEGAL_T.footer defines signIn + signOut for all 20 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const SUPPORTED = [
      'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi',
      'tr', 'ru', 'uk', 'th', 'vi', 'id', 'pl', 'nl', 'sv', 'km',
    ];
    for (const lang of SUPPORTED) {
      // Each locale row in LEGAL_T.footer must include signIn + signOut.
      const rowRe = new RegExp(`${lang}:\\s*\\{[^{}]*signIn:[^,}]+,[^{}]*signOut:`);
      expect(src, `${lang} missing signIn+signOut in LEGAL_T.footer`).toMatch(rowRe);
    }
  });
});
