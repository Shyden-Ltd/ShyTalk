import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the 2 hardcoded English buttons in suggestions-board.js's
 * duplicate-detection modal.
 *
 * When a user types a suggestion title that matches an existing
 * suggestion (≥3 chars, debounced), the page renders a "Possible
 * duplicates" panel with up to 3 candidate suggestions. Each candidate
 * has 2 action buttons — pre-fix, both were hardcoded English:
 *   - "Yes, this is what I meant" (navigate to the matching suggestion)
 *   - "No, my idea is different" (dismiss, continue with own)
 *
 * These render inside the suggest-modal, which is opened by users in
 * any locale. Hardcoding English meant non-English users saw English
 * buttons inside an otherwise-translated modal — the same in-flow
 * accessibility-vs-visual divergence pattern we just fixed for
 * aria-labels in PR #595.
 *
 * Fix: replace hardcoded strings with `escapeHtml(sgT(key))` and add
 * 2 new keys to SG_LABELS × 21 locales (duplicate_match,
 * duplicate_different).
 */

const SG_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

const KEYS = ['duplicate_match', 'duplicate_different'];

test.describe('Suggestions-board duplicate-detection buttons i18n', () => {
  test('SG_LABELS defines duplicate_match + duplicate_different for all 21 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    for (const lang of SG_LOCALES) {
      const blockRe = new RegExp(`    ${lang}:\\s*\\{([^{}]*?)\\}`);
      const blockMatch = src.match(blockRe);
      expect(blockMatch, `${lang} block not found`).not.toBeNull();
      const block = blockMatch![1];
      for (const key of KEYS) {
        expect(block, `${lang} missing ${key}`).toMatch(new RegExp(`\\b${key}:\\s*['"][^'"]+['"]`));
      }
    }
  });

  test('suggestions-board.js no longer hardcodes the duplicate-button English strings', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    const src = await res.text();
    expect(src, 'should not contain hardcoded "Yes, this is what I meant"').not.toContain('Yes, this is what I meant');
    expect(src, 'should not contain hardcoded "No, my idea is different"').not.toContain('No, my idea is different');
    // Sanity: confirms we DID swap to sgT
    expect(src, 'should now use sgT("duplicate_match")').toContain('sgT("duplicate_match")');
    expect(src, 'should now use sgT("duplicate_different")').toContain('sgT("duplicate_different")');
  });

  test('Korean locale: sgT returns Hangul for both keys', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const t = await page.evaluate(() => {
      const w = window as Window & { sgT?: (k: string) => string };
      return {
        match: w.sgT ? w.sgT('duplicate_match') : null,
        diff: w.sgT ? w.sgT('duplicate_different') : null,
      };
    });
    expect(t.match, 'sgT(duplicate_match) in ko').not.toBe('Yes, this is what I meant');
    expect(t.match, 'sgT(duplicate_match) ko should contain Hangul').toMatch(/[가-힯]/);
    expect(t.diff, 'sgT(duplicate_different) ko should contain Hangul').toMatch(/[가-힯]/);
  });
});
