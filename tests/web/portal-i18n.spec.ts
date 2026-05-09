import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression: portal/index.html had no language-selector UI and no RTL
 * dir handling — found 2026-05-09 via /manual-qa.
 *
 * Two distinct gaps:
 *
 * 1. portal/index.html didn't load /js/language-selector.js, so the
 *    floating globe button never appeared. Users couldn't switch
 *    language on the unified login portal even though
 *    portal-translations.js had `window.applyLanguage` defined and
 *    PORTAL_T data for all 20 locales.
 *
 * 2. portal-translations.js's `applyPortalTranslations` set
 *    document.documentElement.lang but NOT dir — same RTL gap PR #569
 *    fixed in language-selector.js. So Arabic would translate text but
 *    leave layout LTR.
 *
 * The portal has a strict CSP (style-src 'self' — no `unsafe-inline`),
 * so language-selector.js's runtime <style> injection would be blocked
 * by browser. Fix: extracted styles to /css/language-selector.css,
 * added a `data-language-selector-styles` sentinel guard in
 * language-selector.js so it skips injection when the link tag is
 * present, and portal/index.html ships the link tag + script.
 *
 * portal-translations.js gained an inline-script-free initial-application
 * bridge at its bottom (an IIFE) — portal CSP forbids inline scripts so
 * the bridge has to live in an external file rather than the inline
 * <script>...</script> pattern terms.html uses.
 */

test.describe('Portal i18n', () => {
  test('globe button appears on /portal/', async ({ page }) => {
    await page.goto(`${BASE}/portal/`);
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="language-selector"]'),
      null,
      { timeout: 5_000 },
    );
    const btn = page.locator('[data-testid="language-selector"]');
    await expect(btn).toBeVisible();
  });

  test('Arabic preference applies dir=rtl + lang=ar on initial load', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('shytalk_language', 'ar');
    });
    await page.goto(`${BASE}/portal/`);
    // portal-translations.js's bottom IIFE runs synchronously at script
    // parse time; by the time domcontentloaded fires, lang+dir are set.
    await page.waitForFunction(
      () => document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl',
      null,
      { timeout: 5_000 },
    );
    expect(await page.locator('html').getAttribute('lang')).toBe('ar');
    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  });

  test('English (default) applies dir=ltr', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('shytalk_language', 'en');
    });
    await page.goto(`${BASE}/portal/`);
    await page.waitForFunction(
      () => document.documentElement.dir !== '',
      null,
      { timeout: 5_000 },
    );
    expect(await page.locator('html').getAttribute('dir')).toBe('ltr');
  });

  test('extracted CSS file is served and language-selector.js skips injection', async ({ page, request }) => {
    // The CSS file must be available — pages relying on the sentinel
    // would silently lose styles if it 404s.
    const cssRes = await request.get(`${BASE}/css/language-selector.css`);
    expect(cssRes.status()).toBe(200);
    expect(await cssRes.text()).toContain('.stl-lang-btn');

    // Visit /portal/ and assert there's no `<style>` tag injected by
    // language-selector.js (since the link sentinel is present, the
    // guard should fire). The link tag itself IS present.
    await page.goto(`${BASE}/portal/`);
    const linkExists = await page
      .locator('link[data-language-selector-styles]')
      .count();
    expect(linkExists).toBe(1);
    // Count style elements that contain `.stl-lang-btn` — there should
    // be ZERO since injection was skipped.
    const injectedStyleCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('style')).filter((s) =>
        (s.textContent || '').includes('.stl-lang-btn'),
      ).length;
    });
    expect(
      injectedStyleCount,
      'language-selector.js should NOT inject inline <style> when external CSS link is present (CSP would block it on portal anyway)',
    ).toBe(0);
  });

  test('legacy pages (no link sentinel) still get inline-injected styles — backwards compat', async ({ page }) => {
    await page.goto(`${BASE}/terms.html`);
    // terms.html does NOT have the data-language-selector-styles link
    // (it's still using inline injection). So the JS should inject
    // styles as before — backwards-compat for non-CSP pages.
    const linkExists = await page
      .locator('link[data-language-selector-styles]')
      .count();
    expect(linkExists, 'terms.html should NOT have the link sentinel').toBe(0);
    const injectedStyleCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('style')).filter((s) =>
        (s.textContent || '').includes('.stl-lang-btn'),
      ).length;
    });
    expect(injectedStyleCount, 'terms.html should still get inline-injected styles').toBeGreaterThanOrEqual(1);
  });
});
