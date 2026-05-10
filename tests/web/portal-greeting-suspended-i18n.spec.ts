import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for 3 hardcoded English strings in portal.js that
 * applyPortalTranslations CANNOT reach (the JS overwrites textContent
 * AFTER the static [data-i18n] walk runs):
 *
 *   1. line 627: `'Reason: ' + profile.suspensionReason`
 *      The HTML's static `data-i18n="suspended_reason"` covers the
 *      boilerplate "Your account has been suspended..." message — but
 *      when an admin sets a custom reason, portal.js OVERWRITES that
 *      text with `Reason: <admin's text>`. The "Reason: " prefix was
 *      hardcoded English.
 *
 *   2. line 657: `'Welcome back, ' + escapeHtml(profile.displayName || 'User')`
 *      The dashboard greeting and the "User" fallback for users
 *      without a displayName.
 *
 *   3. line 635: `date.toLocaleDateString(undefined, ...)`
 *      `undefined` first arg defaults to navigator.language, NOT the
 *      portal's selected locale. A user whose browser is English but
 *      who picked Korean in the portal would see the date formatted
 *      US-style instead of Korean-style.
 *
 * Fix: introduce a `t(key)` helper in portal.js that reads from
 * `window.PORTAL_T[lang]` based on `window.ShyTalkLanguage.get()`.
 * Use `t('suspended_reason_label')`, `t('dashboard_welcome')`, and
 * `t('default_user_name')` for the three text gaps. Use `getCurrentLang()`
 * for the date format.
 *
 * Adds 2 new keys × 21 locales: suspended_reason_label, default_user_name.
 * (dashboard_welcome already exists in PORTAL_T for all 21 locales — see
 * portal-translations.js since the dashboard's first revision.)
 */

const PORTAL_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

const NEW_KEYS = ['suspended_reason_label', 'default_user_name'];

test.describe('Portal greeting + suspension i18n', () => {
  test('PORTAL_T defines suspended_reason_label + default_user_name × 21 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/portal/portal-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    for (const lang of PORTAL_LOCALES) {
      const blockRe = new RegExp(`  ${lang}:\\s*\\{[\\s\\S]*?\\n  \\},`);
      const blockMatch = src.match(blockRe);
      expect(blockMatch, `${lang} block not found`).not.toBeNull();
      const block = blockMatch![0];
      for (const key of NEW_KEYS) {
        expect(block, `${lang} missing ${key}`).toMatch(new RegExp(`\\b${key}:\\s*['"][^'"]+['"]`));
      }
    }
  });

  test('portal.js no longer hardcodes "Reason: " or "Welcome back, " or toLocaleDateString(undefined)', async ({ request }) => {
    const res = await request.get(`${BASE}/portal/portal.js`);
    const src = await res.text();
    expect(src, 'should not have "\'Reason: \' +" hardcoded').not.toContain("'Reason: ' +");
    expect(src, 'should not have "\'Welcome back, \' +" hardcoded').not.toContain("'Welcome back, ' +");
    expect(src, 'toLocaleDateString should not pass undefined as locale').not.toContain('toLocaleDateString(undefined,');
    // Sanity: the new helper + key references are present.
    expect(src, "should call t('suspended_reason_label')").toMatch(/t\(['"]suspended_reason_label['"]\)/);
    expect(src, "should call t('dashboard_welcome')").toMatch(/t\(['"]dashboard_welcome['"]\)/);
    expect(src, "should call getCurrentLang() for date format").toMatch(/toLocaleDateString\(getCurrentLang\(\),/);
  });

  test('Korean locale: portal t() helper resolves new keys to Hangul', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/portal/`);
    await page.waitForFunction(
      () => typeof (window as Window & { PORTAL_T?: unknown }).PORTAL_T !== 'undefined',
      undefined,
      { timeout: 10_000 },
    );
    const sample = await page.evaluate(() => {
      const w = window as Window & {
        PORTAL_T?: Record<string, Record<string, string>>;
        ShyTalkLanguage?: { get: () => string };
      };
      const lang = (w.ShyTalkLanguage && w.ShyTalkLanguage.get()) || 'en';
      const dict = (w.PORTAL_T && w.PORTAL_T[lang]) || {};
      return {
        lang,
        suspended_reason_label: dict.suspended_reason_label,
        default_user_name: dict.default_user_name,
        dashboard_welcome: dict.dashboard_welcome,
      };
    });
    expect(sample.lang).toBe('ko');
    expect(sample.suspended_reason_label, 'ko.suspended_reason_label').toMatch(/[가-힯]/);
    expect(sample.default_user_name, 'ko.default_user_name').toMatch(/[가-힯]/);
    expect(sample.dashboard_welcome, 'ko.dashboard_welcome').toMatch(/[가-힯]/);
  });
});
