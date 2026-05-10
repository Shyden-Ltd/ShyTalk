import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2a of the admin users-tab i18n campaign.
 *
 * Translates 9 simple (non-interpolated) confirm/alert dialogs across
 * 21 locales = 189 new translation entries:
 *   - confirm_remove_all_device_bindings
 *   - confirm_remove_device_ban (inline forEach handler)
 *   - confirm_remove_network_ban (inline forEach handler)
 *   - confirm_unban_device
 *   - confirm_ban_all_devices
 *   - confirm_remove_all_bans
 *   - confirm_unsuspend_identity_graph
 *   - alert_deletion_cancelled
 *   - confirm_clear_temp_id
 *
 * Out of scope (Phase 2b — needs placeholder helper):
 *   - "Revoke this warning? +N GCS will be restored."
 *   - "Revoke biometric key for device X?"
 *   - "Issue a warning for "X" (severity Y, -Z GCS)?"
 *   - "Failed to schedule deletion: ERR"
 *   - "Failed to cancel deletion: ERR"
 *   - "Ban IP X.X.X.X?"
 *   - "Suspend identity graph for this user (DURATION, SCOPE)?"
 *
 * Out of scope (Phase 2c — toasts/inline strings):
 *   - "Device ban removed", "Network ban removed",
 *     "Identity graph suspended/unsuspended", "Temporary ID cleared"
 *   - "Remove" button textContent (×2)
 *   - "No reason", "permanent", "(auto)" inline ban-list strings
 */

const PHASE_2A_KEYS = [
  'confirm_remove_all_device_bindings',
  'confirm_remove_device_ban',
  'confirm_remove_network_ban',
  'confirm_unban_device',
  'confirm_ban_all_devices',
  'confirm_remove_all_bans',
  'confirm_unsuspend_identity_graph',
  'alert_deletion_cancelled',
  'confirm_clear_temp_id',
];

test.describe('Admin users-tab confirm/alert i18n (Phase 2a)', () => {
  test('users.js no longer hardcodes the 9 in-scope dialogs', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Remove all device bindings', /confirm\("Remove all device bindings/],
      ['Remove this device ban', /confirm\("Remove this device ban\?"\)/],
      ['Remove this network ban', /confirm\("Remove this network ban\?"\)/],
      ['Unban this device', /confirm\("Unban this device\?"\)/],
      ['Ban all devices', /confirm\("Ban all devices for this user\?"\)/],
      ['Remove all bans', /confirm\("Remove all bans for this user\?"\)/],
      ['Unsuspend identity graph', /confirm\("Unsuspend identity graph/],
      ['Account deletion cancelled', /alert\("Account deletion cancelled\."\)/],
      ['Clear temporary ID', /confirm\("Clear the temporary ID\?"\)/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    for (const key of PHASE_2A_KEYS) {
      expect(src, `users.js should call tAdmin("${key}")`).toMatch(
        new RegExp(`window\\.tAdmin\\("${key}"\\)`),
      );
    }
  });

  test('All 21 locales define every Phase 2a key in ADMIN_TRANSLATIONS', async ({ request }) => {
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
      // Single-line locale rows now contain values with `{name}`
      // placeholders (added in Phase 2b), so the regex must allow
      // braces inside placeholder tokens. Match either non-brace
      // chars OR `{wordchars}` placeholder tokens.
      const localeBlock = multiLine.has(locale)
        ? src.match(new RegExp(`${locale}:\\s*\\{([\\s\\S]*?)\\n  \\},`))
        : src.match(new RegExp(`${locale}:\\s*\\{((?:[^{}]|\\{\\w+\\})*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of PHASE_2A_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean locale: tAdmin returns Hangul for all 9 dialog keys', async ({ page, request }) => {
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
    }, PHASE_2A_KEYS);

    expect(t, 'tAdmin should be defined').not.toBeNull();

    const englishValues: Record<string, string> = {
      confirm_remove_all_device_bindings: 'Remove all device bindings for this user?',
      confirm_remove_device_ban: 'Remove this device ban?',
      confirm_remove_network_ban: 'Remove this network ban?',
      confirm_unban_device: 'Unban this device?',
      confirm_ban_all_devices: 'Ban all devices for this user?',
      confirm_remove_all_bans: 'Remove all bans for this user?',
      confirm_unsuspend_identity_graph: 'Unsuspend identity graph for this user?',
      alert_deletion_cancelled: 'Account deletion cancelled.',
      confirm_clear_temp_id: 'Clear the temporary ID?',
    };
    for (const key of PHASE_2A_KEYS) {
      const value = t![key];
      expect(value, `tAdmin(${key}) should not be null`).not.toBeNull();
      expect(value, `tAdmin(${key}) should not be English`).not.toBe(englishValues[key]);
      expect(value, `tAdmin(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
