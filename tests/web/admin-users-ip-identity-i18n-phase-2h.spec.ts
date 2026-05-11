import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2h of the admin users-tab i18n campaign.
 *
 * Translates 9 IP/identity-graph + prompts + biometric-list strings
 * across 21 locales = 189 new translation entries:
 *   - toast_ip_banned (PartialFailureToast success on IP ban)
 *   - toast_identity_graph_suspended/unsuspended (success toasts)
 *   - prompt_deletion_reason ("Enter reason for account deletion (optional):")
 *   - prompt_ban_reason ("Reason (optional):") — used 2× (ban-all-devices + ban-IP)
 *   - bio_device_label / bio_registered_label (biometric-list HTML labels)
 *   - segment_ban_call_failed ({count}, {total}, {error}) — partial-failure sub-message
 *   - segment_pm_failed ({count}, {total}) — partial-failure sub-message
 *
 * Out of scope (Phase 2i+ — surfaced during 2h audit):
 *   - "No devices to ban" toast (line 1820)
 *   - Backpack flow: "Loading backpack...", "Backpack is empty", "Confirm Clear All", etc.
 *   - Economy: "Enter a positive amount", "Added/Deducted N coins/beans" toasts
 *   - Device list HTML labels (Manufacturer, Model, OS Version, …)
 *   - Temp ID: "Active temp ID: ...", "No temporary ID set"
 *   - Cascade preview "This will also affect N account(s)..."
 *   - Follow stats "Following: N | Followers: M | Stalkers: K"
 */

const PHASE_2H_KEYS = [
  'toast_ip_banned',
  'toast_identity_graph_suspended',
  'toast_identity_graph_unsuspended',
  'prompt_deletion_reason',
  'prompt_ban_reason',
  'bio_device_label',
  'bio_registered_label',
  'segment_ban_call_failed',
  'segment_pm_failed',
];

test.describe('Admin users-tab IP/identity + prompts + bio-labels i18n (Phase 2h)', () => {
  test('users.js no longer hardcodes the Phase 2h strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['IP banned', /,\s*"IP banned"\)/],
      ['Identity graph suspended', /showToast\("Identity graph suspended"/],
      ['Identity graph unsuspended', /showToast\("Identity graph unsuspended"/],
      ['Enter reason for account deletion prompt', /prompt\("Enter reason for account deletion/],
      ['Reason optional prompt', /prompt\("Reason \(optional\):"\)/],
      ['Device: biometric label (literal HTML)', /<strong>Device:<\/strong>/],
      ['Registered: biometric label', /">Registered: /],
      ['ban call(s) failed segment', /\$\{rejected\.length\}\/\$\{devices\.length\} ban call/],
      ['PMs failed segment', /\$\{aggregatePmFailed\}\/\$\{aggregatePmTotal\} PMs failed/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    for (const key of PHASE_2H_KEYS) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\("${key}"`),
      );
    }
    // prompt_ban_reason is used at ≥2 sites (ban-all-devices + ban-IP)
    const banReasonMatches = src.match(/tAdmin\("prompt_ban_reason"\)/g) || [];
    expect(banReasonMatches.length, 'prompt_ban_reason should be ≥2x').toBeGreaterThanOrEqual(2);
  });

  test('All 21 locales define every Phase 2h key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2H_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: IP/identity + prompts + partial-failure segments interpolate', async ({ page, request }) => {
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
        ipBanned: w.tAdmin('toast_ip_banned'),
        igSuspend: w.tAdmin('toast_identity_graph_suspended'),
        igUnsuspend: w.tAdmin('toast_identity_graph_unsuspended'),
        promptDel: w.tAdmin('prompt_deletion_reason'),
        promptBan: w.tAdmin('prompt_ban_reason'),
        bioDevice: w.tAdmin('bio_device_label'),
        bioReg: w.tAdmin('bio_registered_label'),
        segBan: w.tAdminFmt('segment_ban_call_failed', { count: 2, total: 5, error: 'timeout' }),
        segPm: w.tAdminFmt('segment_pm_failed', { count: 1, total: 3 }),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    expect(result!.ipBanned).toMatch(/[가-힯]/);
    expect(result!.ipBanned).not.toBe('IP banned');

    expect(result!.igSuspend).toMatch(/[가-힯]/);
    expect(result!.igSuspend).not.toBe('Identity graph suspended');

    expect(result!.igUnsuspend).toMatch(/[가-힯]/);
    expect(result!.igUnsuspend).not.toBe('Identity graph unsuspended');

    expect(result!.promptDel).toMatch(/[가-힯]/);
    expect(result!.promptDel).not.toBe('Enter reason for account deletion (optional):');

    expect(result!.promptBan).toMatch(/[가-힯]/);
    expect(result!.promptBan).not.toBe('Reason (optional):');

    expect(result!.bioDevice).toMatch(/[가-힯]/);
    expect(result!.bioDevice).not.toBe('Device:');

    expect(result!.bioReg).toMatch(/[가-힯]/);
    expect(result!.bioReg).not.toBe('Registered:');

    expect(result!.segBan).toMatch(/[가-힯]/);
    expect(result!.segBan).toContain('2');
    expect(result!.segBan).toContain('5');
    expect(result!.segBan).toContain('timeout');

    expect(result!.segPm).toMatch(/[가-힯]/);
    expect(result!.segPm).toContain('1');
    expect(result!.segPm).toContain('3');
  });
});
