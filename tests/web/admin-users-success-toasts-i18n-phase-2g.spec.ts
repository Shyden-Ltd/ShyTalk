import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2g of the admin users-tab i18n campaign.
 *
 * Translates 9 success/auto-escalate/partial-failure strings across
 * 21 locales = 189 new translation entries:
 *   - btn_reset_device_binding (button revert text)
 *   - toast_auto_escalate_5_warnings (auto-suggest suspension)
 *   - toast_no_ip_found (validation)
 *   - toast_banned_n_devices ({count}) (interpolated success)
 *   - toast_removed_n_bans ({count}) (interpolated success)
 *   - toast_partial_retry ({summary}) (partial-failure aggregate)
 *   - toast_user_suspended (PartialFailureToast success)
 *   - toast_user_unsuspended (PartialFailureToast success)
 *   - toast_warning_issued_successfully (PartialFailureToast success)
 *
 * Out of scope (Phase 2h+):
 *   - "IP banned", "Identity graph suspended/unsuspended" toasts
 *   - prompt() dialogs ("Enter reason for account deletion (optional):", etc.)
 *   - <strong>Device:</strong>, Registered: HTML labels in biometric list
 *   - Edge-case partial-failure segment messages
 */

const PHASE_2G_KEYS = [
  'btn_reset_device_binding',
  'toast_auto_escalate_5_warnings',
  'toast_no_ip_found',
  'toast_banned_n_devices',
  'toast_removed_n_bans',
  'toast_partial_retry',
  'toast_user_suspended',
  'toast_user_unsuspended',
  'toast_user_already_unsuspended',
  'toast_warning_issued_successfully',
];

test.describe('Admin users-tab success + auto-escalate i18n (Phase 2g)', () => {
  test('users.js no longer hardcodes the Phase 2g strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['User suspended', /,\s*"User suspended"/],
      ['User unsuspended', /,\s*"User unsuspended"/],
      ['Warning issued successfully', /,\s*"Warning issued successfully"/],
      ['5+ warnings auto-escalate', /showToast\("This user has 5\+/],
      ['Reset Device Binding revert', /textContent\s*=\s*"Reset Device Binding";/],
      ['Partial retry message', /showToast\(`Partial: \$\{segments/],
      ['Banned N device(s) success', /showToast\(`Banned \$\{fulfilled/],
      ['No IP address found', /showToast\("No IP address found"/],
      ['Removed N ban(s)', /"Removed " \+ \(result\.removed/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    for (const key of PHASE_2G_KEYS) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\("${key}"`),
      );
    }
  });

  test('All 21 locales define every Phase 2g key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2G_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: success + partial-failure messages interpolate', async ({ page, request }) => {
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
        revert: w.tAdmin('btn_reset_device_binding'),
        escalate: w.tAdmin('toast_auto_escalate_5_warnings'),
        noIp: w.tAdmin('toast_no_ip_found'),
        banned: w.tAdminFmt('toast_banned_n_devices', { count: 3 }),
        unbanned: w.tAdminFmt('toast_removed_n_bans', { count: 2 }),
        partial: w.tAdminFmt('toast_partial_retry', { summary: '1/3 PMs failed' }),
        suspended: w.tAdmin('toast_user_suspended'),
        unsuspended: w.tAdmin('toast_user_unsuspended'),
        alreadyUnsuspended: w.tAdmin('toast_user_already_unsuspended'),
        warningIssued: w.tAdmin('toast_warning_issued_successfully'),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    // Hangul + non-English + interpolated values preserved
    expect(result!.revert).toMatch(/[가-힯]/);
    expect(result!.revert).not.toBe('Reset Device Binding');

    expect(result!.escalate).toMatch(/[가-힯]/);
    expect(result!.escalate).not.toBe('This user has 5+ warnings. Consider suspending.');

    expect(result!.noIp).toMatch(/[가-힯]/);
    expect(result!.noIp).not.toBe('No IP address found');

    expect(result!.banned).toMatch(/[가-힯]/);
    expect(result!.banned).toContain('3');

    expect(result!.unbanned).toMatch(/[가-힯]/);
    expect(result!.unbanned).toContain('2');

    expect(result!.partial).toMatch(/[가-힯]/);
    expect(result!.partial).toContain('1/3 PMs failed');

    expect(result!.suspended).toMatch(/[가-힯]/);
    expect(result!.suspended).not.toBe('User suspended');

    expect(result!.unsuspended).toMatch(/[가-힯]/);
    expect(result!.unsuspended).not.toBe('User unsuspended');

    expect(result!.alreadyUnsuspended).toMatch(/[가-힯]/);
    expect(result!.alreadyUnsuspended).not.toBe('User is already unsuspended');

    expect(result!.warningIssued).toMatch(/[가-힯]/);
    expect(result!.warningIssued).not.toBe('Warning issued successfully');
  });
});
