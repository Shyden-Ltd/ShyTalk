import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2f of the admin users-tab i18n campaign.
 *
 * Translates 8 generic-failure + warning-issuance + device-binding
 * strings across 21 locales = 168 new translation entries:
 *   - toast_action_failed ({error}) — shared across 6 generic catch sites
 *   - btn_issuing, btn_issue_warning (warning-issuance button states)
 *   - btn_resetting (device-binding reset button state)
 *   - toast_reason_required, toast_select_reason (validation toasts)
 *   - toast_no_user_loaded (validation toast)
 *   - toast_device_bindings_removed ({count}) — interpolated success
 *
 * Out of scope (Phase 2g+ — surfaced during 2f audit):
 *   - "Reset Device Binding" button revert text (line 1348)
 *   - "5+ warnings" auto-escalate toast (line 1317)
 *   - "Banned N device(s)", "Removed N ban(s)" partial-failure toasts
 *   - "Partial: ..." multi-step retry message
 *   - "No IP address found", "Identity graph suspended" toasts
 *   - <strong>Device:</strong>, Registered: HTML labels in biometric list
 */

const PHASE_2F_KEYS = [
  'toast_action_failed',
  'btn_issuing',
  'btn_issue_warning',
  'btn_resetting',
  'toast_reason_required',
  'toast_select_reason',
  'toast_no_user_loaded',
  'toast_device_bindings_removed',
];

test.describe('Admin users-tab failure + warnings i18n (Phase 2f)', () => {
  test('users.js no longer hardcodes the Phase 2f strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Failed: err toast', /showToast\("Failed: " \+ err\.message/],
      ['Reason is required', /showToast\("Reason is required"/],
      ['Select a reason', /showToast\("Select a reason"/],
      ['No user loaded', /showToast\("No user loaded"/],
      ['Issuing... loading', /textContent\s*=\s*"Issuing\.\.\.";/],
      ['Issue Warning revert', /textContent\s*=\s*"Issue Warning";/],
      ['Resetting... loading', /textContent\s*=\s*"Resetting\.\.\.";/],
      ['Removed N device binding(s)', /showToast\("Removed " \+ \(result\.deleted/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Each new key wired through tAdmin / tAdminFmt
    for (const key of PHASE_2F_KEYS) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\("${key}"`),
      );
    }
    // toast_action_failed must appear at least 6 times (shared across 6 catch sites)
    const actionFailedMatches = src.match(/tAdminFmt\("toast_action_failed"/g) || [];
    expect(actionFailedMatches.length, 'toast_action_failed should cover ≥6 sites').toBeGreaterThanOrEqual(6);
  });

  test('All 21 locales define every Phase 2f key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2F_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: generic failure + warning + device-binding interpolate', async ({ page, request }) => {
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
        actionFailed: w.tAdminFmt('toast_action_failed', { error: 'Network timeout' }),
        issuing: w.tAdmin('btn_issuing'),
        issueWarning: w.tAdmin('btn_issue_warning'),
        resetting: w.tAdmin('btn_resetting'),
        reasonReq: w.tAdmin('toast_reason_required'),
        selectReason: w.tAdmin('toast_select_reason'),
        noUser: w.tAdmin('toast_no_user_loaded'),
        bindingsRemoved: w.tAdminFmt('toast_device_bindings_removed', { count: 3 }),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    // Hangul present + NOT English source + interpolated value preserved
    expect(result!.actionFailed).toMatch(/[가-힯]/);
    expect(result!.actionFailed).toContain('Network timeout');

    expect(result!.issuing).toMatch(/[가-힯]/);
    expect(result!.issuing).not.toBe('Issuing...');

    expect(result!.issueWarning).toMatch(/[가-힯]/);
    expect(result!.issueWarning).not.toBe('Issue Warning');

    expect(result!.resetting).toMatch(/[가-힯]/);
    expect(result!.resetting).not.toBe('Resetting...');

    expect(result!.reasonReq).toMatch(/[가-힯]/);
    expect(result!.reasonReq).not.toBe('Reason is required');

    expect(result!.selectReason).toMatch(/[가-힯]/);
    expect(result!.selectReason).not.toBe('Select a reason');

    expect(result!.noUser).toMatch(/[가-힯]/);
    expect(result!.noUser).not.toBe('No user loaded');

    expect(result!.bindingsRemoved).toMatch(/[가-힯]/);
    expect(result!.bindingsRemoved).toContain('3');
  });
});
