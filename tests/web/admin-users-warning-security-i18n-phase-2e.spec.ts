import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2e of the admin users-tab i18n campaign.
 *
 * Translates 7 warning-revocation + security-reset strings across 21
 * locales = 147 new translation entries:
 *   - inline_revoked (simple)
 *   - inline_warning_note ({note})
 *   - inline_warning_meta ({issuedBy}, {gcsBefore}, {gcsAfter})
 *   - toast_warning_revoked_gcs ({deduction})
 *   - toast_pin_lockout_reset (simple)
 *   - toast_biometric_revoked (simple)
 *   - toast_gcs_reset_100 (simple)
 *
 * Also rewires one stray hardcoded `btn.textContent = "Revoke"` in the
 * revokeWarning catch handler to the existing `btn_revoke` key (Phase 2c).
 *
 * Out of scope (future phases — surfaced during 2e audit):
 *   - 6× "Failed: " + err.message generic-failure toasts (single key reuse)
 *   - "No user loaded", "Reason is required", "Select a reason" validation toasts
 *   - "Issuing..." / "Issue Warning" / "Resetting..." button states
 *   - "Removed N device binding(s)" interpolated toast
 */

const PHASE_2E_KEYS = [
  'inline_revoked',
  'inline_warning_note',
  'inline_warning_meta',
  'toast_warning_revoked_gcs',
  'toast_pin_lockout_reset',
  'toast_biometric_revoked',
  'toast_gcs_reset_100',
];

test.describe('Admin users-tab warning + security i18n (Phase 2e)', () => {
  test('users.js no longer hardcodes the Phase 2e strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Revoked inline label', /rs\.textContent\s*=\s*"Revoked"/],
      ['Note: prefix', /textContent\s*=\s*"Note: "\s*\+/],
      ['By: meta line', /textContent\s*=\s*"By: "\s*\+/],
      ['Warning revoked toast', /showToast\("Warning revoked, \+"\s*\+/],
      ['Revoke catch fallback', /btn\.textContent\s*=\s*"Revoke";/],
      ['PIN lockout reset toast', /showToast\("PIN lockout reset"\)/],
      ['Biometric key revoked toast', /showToast\("Biometric key revoked"\)/],
      ['GCS reset toast', /showToast\("GCS reset to 100"\)/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Each new key wired through tAdmin / tAdminFmt
    for (const key of PHASE_2E_KEYS) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\("${key}"`),
      );
    }
    // Reused key — must appear at least twice (Phase 2c primary site + Phase 2e catch fallback)
    const revokeMatches = src.match(/tAdmin\("btn_revoke"\)/g) || [];
    expect(revokeMatches.length, 'btn_revoke should be referenced ≥2x (primary + catch)').toBeGreaterThanOrEqual(2);
  });

  test('All 21 locales define every Phase 2e key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2E_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: warning meta + security toasts interpolate', async ({ page, request }) => {
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
        revoked: w.tAdmin('inline_revoked'),
        note: w.tAdminFmt('inline_warning_note', { note: 'spam detected' }),
        meta: w.tAdminFmt('inline_warning_meta', { issuedBy: 'AdminBob', gcsBefore: 90, gcsAfter: 80 }),
        revokedToast: w.tAdminFmt('toast_warning_revoked_gcs', { deduction: 10 }),
        pinReset: w.tAdmin('toast_pin_lockout_reset'),
        biometric: w.tAdmin('toast_biometric_revoked'),
        gcsReset: w.tAdmin('toast_gcs_reset_100'),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    // Korean translations must contain Hangul AND must NOT match the English source
    expect(result!.revoked).toMatch(/[가-힯]/);
    expect(result!.revoked).not.toBe('Revoked');

    expect(result!.note).toMatch(/[가-힯]/);
    expect(result!.note).toContain('spam detected');

    expect(result!.meta).toMatch(/[가-힯]/);
    expect(result!.meta).toContain('AdminBob');
    expect(result!.meta).toContain('90');
    expect(result!.meta).toContain('80');

    expect(result!.revokedToast).toMatch(/[가-힯]/);
    expect(result!.revokedToast).toContain('10');

    expect(result!.pinReset).toMatch(/[가-힯]/);
    expect(result!.pinReset).not.toBe('PIN lockout reset');

    expect(result!.biometric).toMatch(/[가-힯]/);
    expect(result!.biometric).not.toBe('Biometric key revoked');

    expect(result!.gcsReset).toMatch(/[가-힯]/);
    expect(result!.gcsReset).not.toBe('GCS reset to 100');
  });
});
