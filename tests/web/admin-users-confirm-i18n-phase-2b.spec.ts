import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2b of the admin users-tab i18n campaign.
 *
 * Adds `window.tAdminFmt(key, vars)` helper and translates 7
 * interpolated confirm/alert dialogs across 21 locales = 147 new
 * translation entries:
 *   - confirm_revoke_warning ({deduction})
 *   - confirm_revoke_biometric ({deviceId})
 *   - confirm_issue_warning ({reason}, {severity}, {deduction})
 *   - alert_schedule_deletion_failed ({error})
 *   - alert_cancel_deletion_failed ({error})
 *   - confirm_ban_ip ({ip})
 *   - confirm_suspend_identity_graph ({duration}, {scope})
 *
 * Placeholder substitution uses `{name}` (vs printf-style `%s`)
 * so translators can reorder placeholders for grammar.
 *
 * Out of scope (Phase 2c): showToast calls + inline strings
 * ("Device ban removed", "Remove" button textContent, etc.)
 */

const PHASE_2B_KEYS = [
  'confirm_revoke_warning',
  'confirm_revoke_biometric',
  'confirm_issue_warning',
  'alert_schedule_deletion_failed',
  'alert_cancel_deletion_failed',
  'confirm_ban_ip',
  'confirm_suspend_identity_graph',
];

test.describe('Admin users-tab confirm/alert i18n (Phase 2b)', () => {
  test('translations.js exposes window.tAdminFmt with {placeholder} substitution', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    expect(src).toMatch(/function tAdminFmt\s*\(\s*key,\s*vars\s*\)/);
    expect(src).toMatch(/window\.tAdminFmt\s*=\s*tAdminFmt/);
    // Placeholder substitution uses {name} pattern
    expect(src).toMatch(/\\\{\(\\w\+\)\\\}/);
  });

  test('users.js no longer hardcodes the 7 in-scope dialogs', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Revoke this warning', /confirm\("Revoke this warning\? \+"/],
      ['Revoke biometric', /confirm\("Revoke biometric key for device "/],
      ['Issue a warning', /confirm\("Issue a warning for /],
      ['Failed to schedule deletion', /alert\("Failed to schedule deletion: "/],
      ['Failed to cancel deletion', /alert\("Failed to cancel deletion: "/],
      ['Ban IP', /confirm\("Ban IP "/],
      ['Suspend identity graph (interpolated)', /confirm\("Suspend identity graph for this user \("/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    for (const key of PHASE_2B_KEYS) {
      expect(src, `users.js should call tAdminFmt("${key}", ...)`).toMatch(
        new RegExp(`window\\.tAdminFmt\\("${key}"`),
      );
    }
  });

  test('All 21 locales define every Phase 2b key in ADMIN_TRANSLATIONS', async ({ request }) => {
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
      // placeholders, so the regex must allow them. Match either:
      // - non-brace chars, OR
      // - `{wordchars}` placeholder tokens
      const localeBlock = multiLine.has(locale)
        ? src.match(new RegExp(`${locale}:\\s*\\{([\\s\\S]*?)\\n  \\},`))
        : src.match(new RegExp(`${locale}:\\s*\\{((?:[^{}]|\\{\\w+\\})*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of PHASE_2B_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('tAdminFmt runtime: placeholder substitution works for Korean', async ({ page, request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const translationsSrc = await res.text();

    await page.goto('about:blank');
    await page.addScriptTag({
      content: 'window.ShyTalkLanguage = { get: function() { return "ko"; } };',
    });
    await page.addScriptTag({ content: translationsSrc });

    const result = await page.evaluate(() => {
      const w = window as Window & { tAdminFmt?: (k: string, v: Record<string, unknown>) => string };
      if (typeof w.tAdminFmt !== 'function') return null;
      return {
        warning: w.tAdminFmt('confirm_revoke_warning', { deduction: 5 }),
        biometric: w.tAdminFmt('confirm_revoke_biometric', { deviceId: 'abc-123' }),
        issue: w.tAdminFmt('confirm_issue_warning', { reason: 'spam', severity: 2, deduction: 10 }),
        ip: w.tAdminFmt('confirm_ban_ip', { ip: '1.2.3.4' }),
        graph: w.tAdminFmt('confirm_suspend_identity_graph', { duration: '7d', scope: 'global' }),
        missing: w.tAdminFmt('confirm_ban_ip', {}), // missing var should leave {ip} literal
      };
    });

    expect(result, 'tAdminFmt should be defined').not.toBeNull();

    // All values should:
    // 1. Contain Hangul characters (Korean translation active)
    // 2. NOT contain English fallback "Revoke" / "Ban IP" / etc.
    // 3. Substitute placeholders correctly
    expect(result!.warning, 'warning should contain Hangul').toMatch(/[가-힯]/);
    expect(result!.warning, 'warning should substitute deduction').toContain('5');
    expect(result!.warning, 'warning should not have raw placeholder').not.toContain('{deduction}');

    expect(result!.biometric, 'biometric should contain Hangul').toMatch(/[가-힯]/);
    expect(result!.biometric, 'biometric should substitute deviceId').toContain('abc-123');

    expect(result!.issue, 'issue should contain Hangul').toMatch(/[가-힯]/);
    expect(result!.issue, 'issue should substitute reason').toContain('spam');
    expect(result!.issue, 'issue should substitute severity').toContain('2');
    expect(result!.issue, 'issue should substitute deduction').toContain('10');

    expect(result!.ip, 'ip should contain Hangul').toMatch(/[가-힯]/);
    expect(result!.ip, 'ip should substitute ip').toContain('1.2.3.4');

    expect(result!.graph, 'graph should contain Hangul').toMatch(/[가-힯]/);
    expect(result!.graph, 'graph should substitute duration').toContain('7d');
    expect(result!.graph, 'graph should substitute scope').toContain('global');

    // Missing-var fallback: literal {ip} should remain in the output
    // so the problem is visible at runtime rather than silent 'undefined'.
    expect(result!.missing, 'missing var should leave {ip} literal').toContain('{ip}');
  });
});
