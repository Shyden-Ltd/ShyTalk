import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for hardcoded English TAG_OPTIONS labels in
 * suggestions-board.js (parallel to PR #598 STATUS_OPTIONS).
 *
 * Pre-fix, the tag-filter dropdown rendered hardcoded English:
 *   "Voice", "Chat", "Moderation", "UI/UX", "Privacy", "Social",
 *   "Economy", "Accessibility", "Other"
 *
 * SG_LABELS already had `tagVoice`/`tagChat`/etc. keys defined for
 * `en` only — sgT() falling back to en for non-English locales meant
 * users in any non-English locale saw English labels.
 *
 * Fix: replace hardcoded labels with sgT() calls AND add the 9 keys
 * × 20 non-en locales (180 strings) so non-English users actually
 * see translated labels.
 */

const TAG_KEYS = [
  'tagVoice', 'tagChat', 'tagModeration', 'tagUi', 'tagPrivacy',
  'tagSocial', 'tagEconomy', 'tagAccessibility', 'tagOther',
];

const SG_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

test.describe('Suggestions-board TAG_OPTIONS i18n', () => {
  test('TAG_OPTIONS labels are sgT()-driven, not hardcoded', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    const tagBlock = src.match(/var TAG_OPTIONS = \[([\s\S]*?)\];/);
    expect(tagBlock, 'TAG_OPTIONS array not found').not.toBeNull();
    const arrSrc = tagBlock![1];

    const hardcoded = ['"Voice"', '"Chat"', '"Moderation"', '"UI/UX"', '"Privacy"', '"Social"', '"Economy"', '"Accessibility"', '"Other"'];
    for (const lit of hardcoded) {
      expect(arrSrc, `TAG_OPTIONS should not hardcode label: ${lit}`).not.toMatch(
        new RegExp(`label:\\s*${lit.replace(/[.*+?^${}()|[\]\\\/]/g, '\\\\$&')}\\b`),
      );
    }
    for (const key of TAG_KEYS) {
      expect(arrSrc, `TAG_OPTIONS should use sgT("${key}")`).toMatch(
        new RegExp(`label:\\s*sgT\\("${key}"\\)`),
      );
    }
  });

  test('SG_LABELS defines all 9 tag keys for all 21 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    const src = await res.text();
    for (const lang of SG_LOCALES) {
      const blockRe = new RegExp(`    ${lang}:\\s*\\{([^{}]*?)\\}`);
      const blockMatch = src.match(blockRe);
      expect(blockMatch, `${lang} block not found`).not.toBeNull();
      const block = blockMatch![1];
      for (const key of TAG_KEYS) {
        expect(block, `${lang} missing ${key}`).toMatch(new RegExp(`\\b${key}:\\s*['"][^'"]+['"]`));
      }
    }
  });

  test('Korean locale: sgT() returns Hangul for all 9 tag keys', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const results = await page.evaluate((keys) => {
      const w = window as Window & { sgT?: (k: string) => string };
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = w.sgT ? w.sgT(k) : null;
      return out;
    }, TAG_KEYS);
    // UI/UX is preserved as the literal "UI/UX" in many locales — accept
    // either Hangul characters OR the literal "UI/UX" string.
    for (const key of TAG_KEYS) {
      const v = results[key];
      expect(v, `sgT(${key}) in ko`).toBeTruthy();
      expect(v, `sgT(${key}) in ko should contain Hangul or be UI/UX literal`).toMatch(/[가-힯]|UI\/UX/);
    }
  });
});
