import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2d of the admin users-tab i18n campaign.
 *
 * Translates 9 interpolated toasts + status badges + inline fallbacks
 * across 21 locales = 189 new translation entries:
 *   - toast_autosave_failed ({error})  — used at 2 sites
 *   - toast_undo_failed ({error})
 *   - status_suspended_badge ({since}, {until}, {reason})
 *   - status_not_suspended (simple)
 *   - status_deletion_scheduled ({days}, {date})
 *   - status_severity_gcs ({severity}, {deduction})
 *   - msg_permanent (simple, used as until fallback)
 *   - msg_no_reason_provided (simple, used as reason fallback)
 *   - msg_suspended_since_until_format ({since}, {until}) — unused
 *     yet but reserved for the no-reason rendering path
 *
 * Out of scope (future Phase 2e+ — surfaced during Phase 2d audit):
 *   - "Revoked" inline label, "Note: " / "By: ... | GCS: ..." meta
 *   - "Warning revoked, +N GCS restored" interpolated toast
 *   - "PIN lockout reset", "Biometric key revoked", "GCS reset to 100"
 *   - "Failed: " + err.message (×N — generic-failure toast pattern)
 *   - "Issuing...", "Issue Warning", "Resetting...", "No user loaded"
 *   - "Reason is required", "Select a reason", "5+ warnings" toasts
 *   - "Removed N device binding(s)" interpolated toast
 * Larger than originally scoped — needs further phasing.
 */

const PHASE_2D_KEYS = [
  'toast_autosave_failed',
  'toast_undo_failed',
  'status_suspended_badge',
  'status_not_suspended',
  'status_deletion_scheduled',
  'status_severity_gcs',
  'msg_permanent',
  'msg_no_reason_provided',
  'msg_suspended_since_until_format',
];

test.describe('Admin users-tab interpolated i18n (Phase 2d)', () => {
  test('users.js no longer hardcodes the Phase 2d in-scope strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['Auto-save failed (toast)', /showToast\("Auto-save failed: " \+ err\.message/],
      ['Undo failed (toast)', /showToast\("Undo failed: " \+ err\.message/],
      ['Suspended since (badge)', /"Suspended since " \+ since/],
      ['Not Suspended badge', /textContent\s*=\s*"Not Suspended"/],
      ['Deletion scheduled badge', /"Deletion scheduled — "/],
      ['Severity ... GCS', /"Severity " \+ w\.severity/],
      ['permanent fallback', /:\s*"permanent"/],
      ['No reason provided fallback', /\|\| "No reason provided"/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Verify each key is wired (tAdmin or tAdminFmt depending on shape)
    for (const key of PHASE_2D_KEYS.filter(k => k !== 'msg_suspended_since_until_format')) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\("${key}"`),
      );
    }
  });

  test('All 21 locales define every Phase 2d key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2D_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: status badges interpolate correctly', async ({ page, request }) => {
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
        suspended: w.tAdminFmt('status_suspended_badge', {
          since: '2026-05-10',
          until: '2026-05-20',
          reason: 'spam',
        }),
        notSuspended: w.tAdmin('status_not_suspended'),
        deletion: w.tAdminFmt('status_deletion_scheduled', { days: 7, date: '2026-05-17' }),
        severity: w.tAdminFmt('status_severity_gcs', { severity: 2, deduction: 10 }),
        permanent: w.tAdmin('msg_permanent'),
        noReason: w.tAdmin('msg_no_reason_provided'),
        autoSaveFail: w.tAdminFmt('toast_autosave_failed', { error: 'network' }),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    // All values should contain Hangul + interpolated values
    expect(result!.suspended, 'suspended badge should be Korean').toMatch(/[가-힯]/);
    expect(result!.suspended).toContain('2026-05-10');
    expect(result!.suspended).toContain('2026-05-20');
    expect(result!.suspended).toContain('spam');

    expect(result!.notSuspended, 'not-suspended should be Korean').toMatch(/[가-힯]/);
    expect(result!.notSuspended).not.toBe('Not Suspended');

    expect(result!.deletion).toMatch(/[가-힯]/);
    expect(result!.deletion).toContain('7');
    expect(result!.deletion).toContain('2026-05-17');

    expect(result!.severity).toMatch(/[가-힯]/);
    expect(result!.severity).toContain('2');
    expect(result!.severity).toContain('10');

    expect(result!.permanent).toMatch(/[가-힯]/);
    expect(result!.permanent).not.toBe('permanent');

    expect(result!.noReason).toMatch(/[가-힯]/);
    expect(result!.noReason).not.toBe('No reason provided');

    expect(result!.autoSaveFail).toMatch(/[가-힯]/);
    expect(result!.autoSaveFail).toContain('network');
  });
});
