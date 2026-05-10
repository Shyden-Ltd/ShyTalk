import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for Phase 1 of the admin users-tab i18n campaign.
 *
 * Two coupled changes:
 * 1. Adds runtime translation helper `window.tAdmin(key)` to
 *    public/admin/translations.js. The existing applyAdminTranslations
 *    function only handles HTML attribute walking — JS-generated
 *    strings (confirm, alert, showToast) need a plain function call.
 * 2. Replaces 6 hardcoded English confirm/alert dialogs in users.js
 *    with tAdmin() calls covering 21 locales = 126 new translation
 *    entries.
 *
 * Out of scope (multi-PR campaign):
 *   - 24 remaining users.js confirm/alert sites (warning-issue,
 *     biometric-revoke, identity-graph, etc.) — many use string
 *     interpolation that needs a placeholder helper first.
 *   - Other admin tab files (gifts, banners, etc.).
 */

const ADMIN_KEYS = [
  'confirm_reset_pin_lockout',
  'confirm_unsuspend_user',
  'confirm_reset_gcs',
  'confirm_schedule_deletion',
  'alert_deletion_scheduled',
  'confirm_cancel_deletion',
];

test.describe('Admin users-tab confirm/alert i18n (Phase 1)', () => {
  test('translations.js exposes window.tAdmin helper with key fallback chain', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // tAdmin function must be defined
    expect(src).toMatch(/function tAdmin\s*\(/);
    // Must be exposed on window
    expect(src).toMatch(/window\.tAdmin\s*=\s*tAdmin/);
    // Fallback chain: current-lang → en → key (never undefined)
    expect(src).toMatch(/ADMIN_TRANSLATIONS\.en/);
  });

  test('users.js no longer hardcodes the 6 in-scope dialogs', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Negative assertions: hardcoded English literals are gone
    const hardcoded: Array<[string, RegExp]> = [
      ['Reset PIN lockout', /confirm\("Reset PIN lockout for this user\?"\)/],
      ['Unsuspend this user', /confirm\("Unsuspend this user\?/],
      ['Reset GCS', /confirm\("Reset this user's GCS/],
      ['Schedule deletion', /confirm\("Are you sure you want to schedule/],
      ['Account deletion scheduled', /alert\("Account deletion scheduled\."\)/],
      ['Cancel deletion', /confirm\("Cancel the scheduled account deletion\?"\)/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Positive assertions: tAdmin call is wired for each
    for (const key of ADMIN_KEYS) {
      expect(src, `users.js should call tAdmin("${key}")`).toMatch(
        new RegExp(`window\\.tAdmin\\("${key}"\\)`),
      );
    }
  });

  test('All 21 locales define every dialog key in ADMIN_TRANSLATIONS', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const locales = [
      'en',
      'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
      'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
    ];
    // Multi-line locales: en, ar, de, es, fr, hi, id, it, ja, km, ko
    // Single-line locales: nl, pl, pt, ru, sv, th, tr, uk, vi, zh
    const multiLine = new Set(['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko']);

    for (const locale of locales) {
      const localeBlock = multiLine.has(locale)
        ? src.match(new RegExp(`${locale}:\\s*\\{([\\s\\S]*?)\\n  \\},`))
        : src.match(new RegExp(`${locale}:\\s*\\{([^{}]*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of ADMIN_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean locale: tAdmin runtime — eval translations.js standalone', async ({ page, request }) => {
    // Don't goto /admin/ (gated by auth). Fetch translations.js directly
    // and eval it in a blank-page context, then exercise tAdmin against
    // a Korean-set localStorage. This isolates the helper from the
    // admin app's auth flow while still providing real-runtime coverage
    // of the helper logic + Korean locale translations.
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const translationsSrc = await res.text();

    // about:blank has no origin, so localStorage may not persist there.
    // Stub window.ShyTalkLanguage instead — tAdmin checks it first
    // (before falling back to localStorage), so this reliably wins.
    await page.goto('about:blank');
    await page.addScriptTag({
      content: 'window.ShyTalkLanguage = { get: function() { return "ko"; } };',
    });
    await page.addScriptTag({ content: translationsSrc });

    const t = await page.evaluate((keys) => {
      const w = window as Window & { tAdmin?: (k: string) => string };
      if (typeof w.tAdmin !== 'function') return null;
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = w.tAdmin(k);
      return out;
    }, ADMIN_KEYS);

    expect(t, 'tAdmin should be defined after evaluating translations.js').not.toBeNull();

    const englishValues: Record<string, string> = {
      confirm_reset_pin_lockout: 'Reset PIN lockout for this user?',
      confirm_unsuspend_user: 'Unsuspend this user? Their account will be fully restored.',
      confirm_reset_gcs: "Reset this user's GCS to 100 and clear all warnings?",
      confirm_schedule_deletion: 'Are you sure you want to schedule this account for deletion?',
      alert_deletion_scheduled: 'Account deletion scheduled.',
      confirm_cancel_deletion: 'Cancel the scheduled account deletion?',
    };
    for (const key of ADMIN_KEYS) {
      const value = t![key];
      expect(value, `tAdmin(${key}) should not be null`).not.toBeNull();
      expect(value, `tAdmin(${key}) should not be English`).not.toBe(englishValues[key]);
      expect(value, `tAdmin(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
