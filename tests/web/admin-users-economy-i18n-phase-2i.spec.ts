import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Phase 2i of the admin users-tab i18n campaign.
 *
 * Translates 9 economy + ban-validation + gift-add strings across
 * 21 locales = 189 new translation entries:
 *   - toast_no_devices_to_ban (validation)
 *   - toast_enter_positive_amount (validation, ×2 sites: coins + beans)
 *   - toast_coins_added / toast_coins_deducted ({amount}, {balance})
 *   - toast_beans_added / toast_beans_deducted ({amount}, {balance})
 *   - toast_select_gift_qty (validation)
 *   - toast_gift_added ({qty}, {total}) (success)
 *   - toast_backpack_empty_already (validation)
 *
 * Note: Op direction (add/deduct) is one key per direction rather than
 * a single verb-interpolated key. Some locales (notably Romance/Slavic)
 * need different word order when verb changes, so per-direction keys
 * give translators full control.
 */

const PHASE_2I_KEYS = [
  'toast_no_devices_to_ban',
  'toast_enter_positive_amount',
  'toast_coins_added',
  'toast_coins_deducted',
  'toast_beans_added',
  'toast_beans_deducted',
  'toast_select_gift_qty',
  'toast_gift_added',
  'toast_backpack_empty_already',
];

test.describe('Admin users-tab economy + validation i18n (Phase 2i)', () => {
  test('users.js no longer hardcodes the Phase 2i strings', async ({ request }) => {
    const res = await request.get(`${BASE}/admin/js/tabs/users.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const hardcoded: Array<[string, RegExp]> = [
      ['No devices to ban', /showToast\("No devices to ban"/],
      ['Enter a positive amount', /showToast\("Enter a positive amount"/],
      ['Added/Deducted N coins (op string concat)', /\(op === "add" \? "Added" : "Deducted"\) \+ " " \+ amount \+ " coins/],
      ['Added/Deducted N beans (op string concat)', /\(op === "add" \? "Added" : "Deducted"\) \+ " " \+ amount \+ " beans/],
      ['Select a gift', /showToast\("Select a gift and enter a quantity"/],
      ['Added N (total now M)', /"Added " \+ qty \+ " \(total now /],
      ['Backpack already empty', /showToast\("Backpack is already empty"/],
    ];
    for (const [name, re] of hardcoded) {
      expect(src, `Should not hardcode: ${name}`).not.toMatch(re);
    }

    // Note: `tAdminFmt(op === "add" ? "k1" : "k2", ...)` ternary form
    // puts the key after an expression rather than immediately after `(`.
    // Allow anything before the key inside the args list, up to the
    // first `)`.
    for (const key of PHASE_2I_KEYS) {
      expect(src, `users.js should reference "${key}"`).toMatch(
        new RegExp(`tAdmin(?:Fmt)?\\([^)]*?"${key}"`),
      );
    }
    // toast_enter_positive_amount is shared (coins + beans validation) — must appear ≥2x
    const positiveMatches = src.match(/tAdmin\("toast_enter_positive_amount"\)/g) || [];
    expect(positiveMatches.length, 'toast_enter_positive_amount should appear ≥2x').toBeGreaterThanOrEqual(2);
  });

  test('All 21 locales define every Phase 2i key in ADMIN_TRANSLATIONS', async ({ request }) => {
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

      for (const key of PHASE_2I_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean runtime: economy + validation messages interpolate', async ({ page, request }) => {
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
        noDevices: w.tAdmin('toast_no_devices_to_ban'),
        positive: w.tAdmin('toast_enter_positive_amount'),
        coinsAdd: w.tAdminFmt('toast_coins_added', { amount: 100, balance: 500 }),
        coinsDeduct: w.tAdminFmt('toast_coins_deducted', { amount: 50, balance: 450 }),
        beansAdd: w.tAdminFmt('toast_beans_added', { amount: 25, balance: 175 }),
        beansDeduct: w.tAdminFmt('toast_beans_deducted', { amount: 10, balance: 165 }),
        selectGift: w.tAdmin('toast_select_gift_qty'),
        giftAdded: w.tAdminFmt('toast_gift_added', { qty: 3, total: 8 }),
        bpEmpty: w.tAdmin('toast_backpack_empty_already'),
      };
    });

    expect(result, 'tAdmin/tAdminFmt should be defined').not.toBeNull();

    expect(result!.noDevices).toMatch(/[가-힯]/);
    expect(result!.noDevices).not.toBe('No devices to ban');

    expect(result!.positive).toMatch(/[가-힯]/);
    expect(result!.positive).not.toBe('Enter a positive amount');

    expect(result!.coinsAdd).toMatch(/[가-힯]/);
    expect(result!.coinsAdd).toContain('100');
    expect(result!.coinsAdd).toContain('500');

    expect(result!.coinsDeduct).toMatch(/[가-힯]/);
    expect(result!.coinsDeduct).toContain('50');
    expect(result!.coinsDeduct).toContain('450');
    // Make sure deducted is distinguishable from added (i.e., not the same string)
    expect(result!.coinsDeduct).not.toBe(result!.coinsAdd);

    expect(result!.beansAdd).toMatch(/[가-힯]/);
    expect(result!.beansAdd).toContain('25');
    expect(result!.beansAdd).toContain('175');

    expect(result!.beansDeduct).toMatch(/[가-힯]/);
    expect(result!.beansDeduct).toContain('10');
    expect(result!.beansDeduct).toContain('165');

    expect(result!.selectGift).toMatch(/[가-힯]/);
    expect(result!.selectGift).not.toBe('Select a gift and enter a quantity');

    expect(result!.giftAdded).toMatch(/[가-힯]/);
    expect(result!.giftAdded).toContain('3');
    expect(result!.giftAdded).toContain('8');

    expect(result!.bpEmpty).toMatch(/[가-힯]/);
    expect(result!.bpEmpty).not.toBe('Backpack is already empty');
  });
});
