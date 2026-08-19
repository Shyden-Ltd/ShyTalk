import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2j of the admin users-tab i18n campaign.
 *
 * Translates 9 backpack-panel UX strings across 21 locales = 189 entries:
 *   - msg_loading_backpack / msg_backpack_empty / msg_no_matching_gifts
 *   - btn_confirm_clear_all / btn_confirming ({countdown}) / btn_clearing
 *   - toast_backpack_cleared ({count}) / toast_cleared_with_errors ({cleared}, {errors})
 *   - toast_failed_to_save ({error})
 *
 * The clear-all confirmation flow involves a 5-second countdown:
 *   1. Click "Clear all" → button shows "Confirm (5)" → ... → "Confirm (1)"
 *   2. After countdown: button shows "Confirm Clear All" + enabled
 *   3. Click confirm → button shows "Clearing..." while operation runs
 *   4. Success toast: "Backpack cleared (N items removed)" OR
 *      "Cleared M, failed K" if any errors
 *
 * Out of scope (Phase 2k+): device-list HTML labels, temp-ID display,
 * cascade preview, follow stats line.
 */

const PHASE_2J_KEYS = [
  'msg_loading_backpack',
  'msg_backpack_empty',
  'msg_no_matching_gifts',
  'btn_confirm_clear_all',
  'btn_confirming',
  'btn_clearing',
  'toast_backpack_cleared',
  'toast_cleared_with_errors',
  'toast_failed_to_save',
];

test.describe('Admin users-tab backpack panel i18n (Phase 2j)', () => {
  test('users.js no longer hardcodes the Phase 2j strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Loading backpack...', /textContent\s*=\s*"Loading backpack\.\.\."/],
      ['Backpack is empty (ternary)', /\?\s*"Backpack is empty"/],
      ['No matching gifts (ternary)', /:\s*"No matching gifts"/],
      ['Confirm (countdown) initial', /textContent\s*=\s*"Confirm \(" \+ countdown/],
      ['Confirm Clear All revert', /textContent\s*=\s*"Confirm Clear All"/],
      ['Clearing... loading', /textContent\s*=\s*"Clearing\.\.\."/],
      ['Backpack cleared (N items removed)', /showToast\("Backpack cleared \("/],
      ['Cleared N, failed N', /showToast\("Cleared " \+ cleared/],
      ['Failed to save:', /showToast\("Failed to save: "/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Tolerant regex — allows ternary like (X ? "k1" : "k2") form
    for (const key of PHASE_2J_KEYS) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\([^)]*?"${key}"`),
      );
    }
    // btn_confirming used at 2 sites (initial + countdown tick)
    const confirmingMatches = src.match(/tAdminFmt\("btn_confirming"/g) || [];
    expect(confirmingMatches.length, 'btn_confirming should appear ≥2x').toBeGreaterThanOrEqual(2);
  });

  test('All 21 locales define every Phase 2j key in ADMIN_TRANSLATIONS', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const locales = [
      'en',
      'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
      'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
    ];
    const multiLine = new Set(['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko']);

    for (const locale of locales) {
      const localeBlock = multiLine.has(locale)
        ? src.match(new RegExp(`${locale}:\\s*\\{([\\s\\S]*?)\\n  \\},`))
        : src.match(new RegExp(`${locale}:\\s*\\{((?:[^{}]|\\{\\w+\\})*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of PHASE_2J_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: backpack UX strings interpolate', async ({ page, request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const translationsSrc = await res.text();

    await page.goto('about:blank');
    await page.addScriptTag({
      content: 'window.ShyTalkLanguage = { get: function() { return "ko"; } };',
    });
    await page.addScriptTag({ content: translationsSrc });

    const result = await page.evaluate(() => {
      const w = window as Window & {
        tAdmin?: (k: string) => string;
        tAdminFmt?: (k: string, v: Record<string, unknown>) => string;
      };
      if (typeof w.tAdmin !== 'function' || typeof w.tAdminFmt !== 'function') return null;
      return {
        loading: w.tAdmin('msg_loading_backpack'),
        empty: w.tAdmin('msg_backpack_empty'),
        noMatch: w.tAdmin('msg_no_matching_gifts'),
        confirmAll: w.tAdmin('btn_confirm_clear_all'),
        confirming: w.tAdminFmt('btn_confirming', { countdown: 3 }),
        clearing: w.tAdmin('btn_clearing'),
        cleared: w.tAdminFmt('toast_backpack_cleared', { count: 7 }),
        withErrors: w.tAdminFmt('toast_cleared_with_errors', { cleared: 5, errors: 2 }),
        failedSave: w.tAdminFmt('toast_failed_to_save', { error: 'Network error' }),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    // Hangul + non-English + interpolated values preserved
    expect(result!.loading).toMatch(/[가-힯]/);
    expect(result!.loading).not.toBe('Loading backpack...');
    expect(result!.empty).toMatch(/[가-힯]/);
    expect(result!.noMatch).toMatch(/[가-힯]/);
    expect(result!.confirmAll).toMatch(/[가-힯]/);

    expect(result!.confirming).toMatch(/[가-힯]/);
    expect(result!.confirming).toContain('3');

    expect(result!.clearing).toMatch(/[가-힯]/);

    expect(result!.cleared).toMatch(/[가-힯]/);
    expect(result!.cleared).toContain('7');

    expect(result!.withErrors).toMatch(/[가-힯]/);
    expect(result!.withErrors).toContain('5');
    expect(result!.withErrors).toContain('2');

    expect(result!.failedSave).toMatch(/[가-힯]/);
    expect(result!.failedSave).toContain('Network error');
  });
});
