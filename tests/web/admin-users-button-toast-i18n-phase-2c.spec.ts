import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2c of the admin users-tab i18n campaign.
 *
 * Translates 10 simple button states + toasts across 21 locales = 210
 * new translation entries. Also wires 2 existing keys (`btn_search`,
 * `msg_loading`) into JS-driven textContent assignments.
 *
 * New keys:
 *   - btn_searching, btn_email_show, btn_email_hide, btn_email_saving,
 *     btn_undo, msg_no_warnings, btn_revoke
 *   - toast_display_name_empty, toast_undo_successful, toast_already_in_list
 *
 * Reused keys:
 *   - btn_search (line 177): reset state after search completes
 *   - msg_loading (line 1032): "Loading..." in warnings list
 *
 * Out of scope (Phase 2d):
 *   - Interpolated toasts: "Auto-save failed: " + err.message, etc.
 *   - Status badges: "Suspended since X until Y", "Severity N (-X GCS)",
 *     "Deletion scheduled — N days remaining"
 *   - "No reason provided" inline string in suspension status
 */

const PHASE_2C_NEW_KEYS = [
  'btn_searching',
  'btn_email_show',
  'btn_email_hide',
  'btn_email_saving',
  'btn_undo',
  'msg_no_warnings',
  'btn_revoke',
  'toast_display_name_empty',
  'toast_undo_successful',
  'toast_already_in_list',
];

test.describe('Admin users-tab button/toast i18n (Phase 2c)', () => {
  test('users.js no longer hardcodes the 12 in-scope strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Searching...', /textContent\s*=\s*"Searching\.\.\."/],
      ['Search reset', /searchBtnEl\.textContent\s*=\s*"Search"/],
      ['Show (email toggle)', /emailToggle\.textContent\s*=\s*"Show"/],
      ['Hide (email toggle)', /emailToggle\.textContent\s*=\s*"Hide"/],
      ['Saving… (email)', /text\.textContent\s*=\s*"Saving…"/],
      ['Undo link', /undoLink\.textContent\s*=\s*"Undo"/],
      ['Display name empty toast', /showToast\("Display name cannot be empty"/],
      ['Undo successful toast', /showToast\("Undo successful"\)/],
      ['Already in list toast', /showToast\("Already in list"/],
      ['Loading...', /ld\.textContent\s*=\s*"Loading\.\.\."/],
      ['No warnings', /ed\.textContent\s*=\s*"No warnings"/],
      ['Revoke button', /rb\.textContent\s*=\s*"Revoke"/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Verify each new key + the 2 reused keys are wired
    const allKeys = [...PHASE_2C_NEW_KEYS, 'btn_search', 'msg_loading'];
    for (const key of allKeys) {
      expect(src, `users.js should call tAdmin("${key}")`).toMatch(
        new RegExp(`window\\.tAdmin\\("${key}"\\)`),
      );
    }
  });

  test('All 21 locales define every new Phase 2c key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2C_NEW_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean locale: tAdmin returns Hangul for all 10 new keys', async ({ page, request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const translationsSrc = await res.text();

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
    }, PHASE_2C_NEW_KEYS);

    expect(t, 'tAdmin should be defined').not.toBeNull();

    const englishValues: Record<string, string> = {
      btn_searching: 'Searching...',
      btn_email_show: 'Show',
      btn_email_hide: 'Hide',
      btn_email_saving: 'Saving…',
      btn_undo: 'Undo',
      msg_no_warnings: 'No warnings',
      btn_revoke: 'Revoke',
      toast_display_name_empty: 'Display name cannot be empty',
      toast_undo_successful: 'Undo successful',
      toast_already_in_list: 'Already in list',
    };
    for (const key of PHASE_2C_NEW_KEYS) {
      const value = t![key];
      expect(value, `tAdmin(${key}) should not be null`).not.toBeNull();
      expect(value, `tAdmin(${key}) should not be English`).not.toBe(englishValues[key]);
      expect(value, `tAdmin(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
