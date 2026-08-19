import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the admin age-verification i18n contract.
 *
 * Background: admin/index.html ships 24 data-i18n keys covering the
 * Age Verification sub-tab (panel title/subtitle, field labels, match
 * question, approve/reject/modify buttons, helper text) plus the
 * surrounding sub-tab labels (subtab_identity, subtab_age_verification,
 * tab_audit_log, tab_suggestions). Until this fix, none of these keys
 * existed in admin/translations.js — the orphan-key checker tolerated
 * them via i18n-orphan-allowlist.txt and they fell through to inline
 * HTML defaults across all 20 admin locales.
 *
 * The fix adds them to ADMIN_TRANSLATIONS.en (English source of truth)
 * and removes them from the orphan allowlist. Per the project's
 * "Translations: Google first, Claude fallback" rule, the other 19
 * locales fall back to English via `ADMIN_TRANSLATIONS[lang] ||
 * ADMIN_TRANSLATIONS.en` — they will be Google-translated in a future
 * batch run rather than Claude-translated now.
 *
 * This test pins the contract: the 24 keys MUST exist in `en`. If a
 * future edit drops any of them, this test fails — preventing silent
 * orphan regression and giving the next maintainer a clear pointer
 * to admin/translations.js when the orphan-checker complains.
 */

const ADMIN_AGE_VERIF_KEYS = [
  // Tabs / sub-tabs
  'tab_suggestions',
  'tab_audit_log',
  'subtab_identity',
  'subtab_age_verification',
  // Panel header
  'age_verif_panel_title',
  'age_verif_panel_subtitle',
  // Empty state
  'age_verif_no_pending_for_user',
  'age_verif_other_pending_label',
  'age_verif_jump_next',
  // Image disclaimer
  'age_verif_image_disclaimer',
  // Submission fields
  'age_verif_field_method',
  'age_verif_field_recorded_dob',
  'age_verif_field_submitted_at',
  'age_verif_field_submission_id',
  // DOB-match question
  'age_verif_match_question',
  'age_verif_match_yes',
  'age_verif_match_no',
  // Approve flow
  'age_verif_approve_help',
  'age_verif_approve_button',
  // Reject flow
  'age_verif_reject_summary',
  'age_verif_reject_button',
  // Modify-DOB flow
  'age_verif_modify_help',
  'age_verif_new_dob_label',
  'age_verif_modify_button',
];

test.describe('Admin age-verification i18n contract', () => {
  test('all 24 age-verification keys are defined in ADMIN_TRANSLATIONS.en', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Extract the `en: { ... }` block — the en row spans multiple lines
    // with grouped sections, terminated by `},` then the next locale row.
    // Use a non-greedy match anchored on `en: {` followed by the first
    // `},\n  ar:` (ar is the next locale alphabetically in ADMIN_TRANSLATIONS).
    const enMatch = src.match(/\ben:\s*\{([\s\S]*?)\},\s*\n\s*ar:/);
    expect(enMatch, 'en block not found in ADMIN_TRANSLATIONS').not.toBeNull();
    const enBlock = enMatch![1];

    for (const key of ADMIN_AGE_VERIF_KEYS) {
      // The keys are written as `key_name: 'value'` or `key_name: "value"`.
      // We match the key followed by `:` and a quote — proves it has a
      // string value, not just a comment mention.
      const re = new RegExp(`\\b${key}\\s*:\\s*['"]`);
      expect(enBlock, `${key} missing from ADMIN_TRANSLATIONS.en`).toMatch(re);
    }
  });

  test('applyAdminTranslations preserves badge children when key value matches HTML default', async ({ page }) => {
    // Regression: tab_suggestions and subtab_age_verification are on
    // <button> elements that contain a child <span class="*-badge">
    // for notification counts. Setting el.textContent = t[key] would
    // wipe the badge. The fix: when el.children.length > 0, replace
    // only the first text node, preserving the badge span.
    await page.goto(`${BASE}/admin/`);
    await page.waitForFunction(
      () => typeof (window as Window & { applyAdminTranslations?: (l: string) => void }).applyAdminTranslations === 'function',
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      const w = window as Window & { applyAdminTranslations?: (l: string) => void };
      if (typeof w.applyAdminTranslations === 'function') w.applyAdminTranslations('en');
    });
    const suggestionsBadge = await page.locator('#tab-suggestions #suggestions-badge').count();
    expect(suggestionsBadge, 'tab_suggestions badge must survive applyAdminTranslations').toBe(1);
    const ageBadge = await page.locator('button[data-subtab="age-verif"] #age-verif-pending-badge').count();
    expect(ageBadge, 'subtab_age_verification badge must survive applyAdminTranslations').toBe(1);
  });

  test('age_verif_panel_subtitle is non-empty (catches placeholder regressions)', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/translations.js`);
    const src = await res.text();
    // Match the value between quotes, allowing either ' or " delimiters.
    // Single-quote value can contain double-quotes and vice versa.
    const m = src.match(/age_verif_panel_subtitle:\s*(['"])(.+?)\1/);
    expect(m, 'age_verif_panel_subtitle value not found').not.toBeNull();
    const value = m![2];
    expect(value.length, 'age_verif_panel_subtitle should not be empty').toBeGreaterThan(20);
    // Spot-check it actually mentions ID / approve / reject — the three
    // user actions the subtitle is supposed to summarise.
    expect(value.toLowerCase()).toContain('id');
  });
});
