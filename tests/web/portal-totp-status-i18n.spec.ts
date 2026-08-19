import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the remaining 8 hardcoded English strings in
 * portal.js after PR #600. Each is a JS-driven `el.textContent = '...'`
 * that bypassed applyPortalTranslations's [data-i18n] walk.
 *
 * Strings translated:
 *   - "If an account exists with that email, a recovery code has been sent."
 *     → recovery_code_sent
 *   - "Two-factor authentication is managed by your sign-in provider."
 *     → security_totp_managed
 *   - "Two-factor authentication is enabled."  → security_totp_enabled
 *   - "Reset 2FA"                              → security_totp_btn_reset
 *   - "Two-factor authentication is not enabled." → security_totp_disabled
 *   - "Enable 2FA"                             → security_totp_btn_enable
 *   - "Copied!"                                → copy_feedback_copied
 *   - "Copy" (revert after copied feedback)    → enroll_copy (reuse existing)
 *
 * Adds 7 new keys × 21 locales = 147 strings to PORTAL_T.
 */

const PORTAL_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

const NEW_KEYS = [
  'recovery_code_sent',
  'security_totp_managed',
  'security_totp_enabled',
  'security_totp_btn_reset',
  'security_totp_disabled',
  'security_totp_btn_enable',
  'copy_feedback_copied',
];

test.describe('Portal TOTP + recovery + copy i18n', () => {
  test('PORTAL_T defines all 7 new keys for all 21 locales', async ({ request }) => {
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

  test('portal.js no longer hardcodes the 8 English strings', async ({ request }) => {
    const res = await request.get(`${BASE}/portal/portal.js`);
    const src = await res.text();
    expect(src, 'recovery message not hardcoded').not.toContain('If an account exists with that email');
    expect(src, 'totp managed not hardcoded').not.toContain('managed by your sign-in provider');
    expect(src, 'totp enabled not hardcoded').not.toContain("'Two-factor authentication is enabled.'");
    expect(src, 'totp disabled not hardcoded').not.toContain("'Two-factor authentication is not enabled.'");
    expect(src, 'reset 2FA not hardcoded').not.toContain("'Reset 2FA'");
    expect(src, 'enable 2FA not hardcoded').not.toContain("'Enable 2FA'");
    expect(src, 'copied! not hardcoded').not.toContain("'Copied!'");
    // The plain "Copy" string IS hardcoded once in portal/index.html as
    // the inline default for `data-i18n="enroll_copy"`. portal.js should
    // no longer have `'Copy'` as a textContent assignment fallback.
    expect(src, 'Copy fallback should use t(enroll_copy)').not.toMatch(/copyBtn\.textContent\s*=\s*['"]Copy['"]/);
    // Sanity: the new t() calls are present.
    expect(src).toContain("t('recovery_code_sent')");
    expect(src).toContain("t('security_totp_managed')");
    expect(src).toContain("t('copy_feedback_copied')");
  });

  test('Korean locale: portal t() resolves all 7 keys to Hangul', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/portal/`);
    await page.waitForFunction(
      () => typeof (window as Window & { PORTAL_T?: unknown }).PORTAL_T !== 'undefined',
      undefined,
      { timeout: 10_000 },
    );
    const sample = await page.evaluate((keys) => {
      const w = window as Window & {
        PORTAL_T?: Record<string, Record<string, string>>;
        ShyTalkLanguage?: { get: () => string };
      };
      const lang = (w.ShyTalkLanguage && w.ShyTalkLanguage.get()) || 'en';
      const dict = (w.PORTAL_T && w.PORTAL_T[lang]) || {};
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = dict[k] || null;
      return out;
    }, NEW_KEYS);
    for (const key of NEW_KEYS) {
      expect(sample[key], `ko.${key}`).toMatch(/[가-힯]|2FA/);
    }
  });
});
