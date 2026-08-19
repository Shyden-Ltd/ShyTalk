import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the portal's hardcoded aria-labels. Pre-fix,
 * applyPortalTranslations walked [data-i18n] and [data-i18n-placeholder]
 * but NOT [data-i18n-aria-label] — so screen-reader users on the
 * portal heard English labels even when the visible UI was translated.
 *
 * 5 portal aria-labels are now translated:
 *   - aria_loading (loading-section landmark)
 *   - aria_qr_code (TOTP enrolment QR container)
 *   - aria_secret_key (TOTP secret key input)
 *   - aria_copy_secret (copy-secret button — note: button TEXT
 *     translates via data-i18n="enroll_copy" already; the aria-label
 *     is independent and was untranslated)
 *   - aria_profile_avatar (avatar image)
 *
 * The 4 "ShyTalk" wordmark logos are intentionally left as English —
 * "ShyTalk" is the brand name, not a translatable string.
 */

const PORTAL_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

const ARIA_KEYS = [
  'aria_loading',
  'aria_qr_code',
  'aria_secret_key',
  'aria_copy_secret',
  'aria_profile_avatar',
];

test.describe('Portal aria-label i18n', () => {
  test('PORTAL_T defines all 5 aria_* keys for all 21 locales (en + 20)', async ({ request }) => {
    const res = await request.get(`${BASE}/portal/portal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    for (const lang of PORTAL_LOCALES) {
      // Each locale block is multi-line, terminated by `\n  },\n`. Match
      // a non-greedy block from `<lang>: {` to the first `\n  },`.
      const blockRe = new RegExp(`  ${lang}:\\s*\\{[\\s\\S]*?\\n  \\},`);
      const blockMatch = src.match(blockRe);
      expect(blockMatch, `${lang} block not found in PORTAL_T`).not.toBeNull();
      const block = blockMatch![0];
      for (const key of ARIA_KEYS) {
        const re = new RegExp(`\\b${key}:\\s*['"][^'"]+['"]`);
        expect(block, `${lang} missing ${key}`).toMatch(re);
      }
    }
  });

  test('Korean portal: aria-labels translate to Hangul after applyLanguage', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/portal/`);
    // Wait for portal-translations to apply Korean. The loading section
    // has aria-label translated by applyPortalTranslations.
    await page.waitForFunction(() => {
      const el = document.querySelector('#loading-section[aria-label]');
      return !!(el && el.getAttribute('aria-label') !== 'Loading');
    }, undefined, { timeout: 10_000 });

    const loadingAria = await page.locator('#loading-section').getAttribute('aria-label');
    expect(loadingAria, 'loading aria-label should not be English').not.toBe('Loading');
    expect(loadingAria, 'loading aria-label should contain Hangul').toMatch(/[가-힯]/);
  });

  test('Brand wordmarks intentionally remain "ShyTalk" (English) across all locales', async ({ page }) => {
    // Sanity: switching locale must NOT translate "ShyTalk" — it's the
    // brand name. Verifies we did NOT accidentally add data-i18n-aria-label
    // to the .portal-logo divs.
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ar'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/portal/`);
    await page.waitForFunction(
      () => typeof (window as Window & { applyLanguage?: (l: string) => void }).applyLanguage === 'function',
      undefined,
      { timeout: 5_000 },
    );
    const logos = await page.locator('.portal-logo').all();
    expect(logos.length, 'expected at least one .portal-logo on portal page').toBeGreaterThan(0);
    for (const logo of logos) {
      const aria = await logo.getAttribute('aria-label');
      expect(aria, 'brand wordmark aria-label must remain "ShyTalk"').toBe('ShyTalk');
    }
  });
});
