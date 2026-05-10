import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for hardcoded English STATUS_OPTIONS labels in
 * suggestions-board.js.
 *
 * Pre-fix, the status-filter dropdown rendered:
 *   "Pending", "Accepted", "Planned", "Completed", "Rejected"
 * — hardcoded English, even though SG_LABELS already had localised
 * pending/accepted/planned/completed/rejected keys for ALL 21 locales
 * (used elsewhere on the suggestion-card status badge). The constants
 * were captured at IIFE-load time and never updated.
 *
 * Fix: replace each hardcoded label with sgT(key). Because sgLang is
 * initialised from `window.ShyTalkLanguage.get()` in suggestions-i18n.js
 * BEFORE suggestions-board.js's IIFE executes, the saved language wins
 * at module load — exactly what we want.
 *
 * Limitation (out of scope): if the user switches language AFTER page
 * load, the dropdown values stay frozen at the initial-load language.
 * The page-load-language-wins property is a known limitation of the
 * eval-once constants pattern across the project and is consistent
 * with other similar constants (TAG_OPTIONS, LANG_OPTIONS, etc.). A
 * subsequent PR could refactor to compute options at render time.
 */

const STATUS_KEYS = ['pending', 'accepted', 'planned', 'completed', 'rejected'];

test.describe('Suggestions-board STATUS_OPTIONS i18n', () => {
  test('STATUS_OPTIONS labels are sgT()-driven, not hardcoded', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Extract the STATUS_OPTIONS array literal — first 200 chars from
    // the const declaration suffice (5 entries on 7 lines).
    const statusBlock = src.match(/var STATUS_OPTIONS = \[([\s\S]*?)\];/);
    expect(statusBlock, 'STATUS_OPTIONS array not found').not.toBeNull();
    const arrSrc = statusBlock![1];

    // Hardcoded fail-cases: any of the 5 status names appearing as a
    // bare quoted string label.
    const hardcodedNames = ['Pending', 'Accepted', 'Planned', 'Completed', 'Rejected'];
    for (const name of hardcodedNames) {
      expect(arrSrc, `STATUS_OPTIONS should not hardcode "${name}"`).not.toMatch(
        new RegExp(`label:\\s*"${name}"`),
      );
    }

    // Sanity: verify the new sgT()-driven form is present for each key.
    for (const key of STATUS_KEYS) {
      expect(arrSrc, `STATUS_OPTIONS should use sgT("${key}")`).toMatch(
        new RegExp(`label:\\s*sgT\\("${key}"\\)`),
      );
    }
  });

  test('Korean locale: sgT() returns Hangul for all 5 status keys', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const t = await page.evaluate((keys) => {
      const w = window as Window & { sgT?: (k: string) => string };
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = w.sgT ? w.sgT(k) : null;
      return out;
    }, STATUS_KEYS);

    const englishValues = new Set(['Pending', 'Accepted', 'Planned', 'Completed', 'Rejected']);
    for (const key of STATUS_KEYS) {
      const value = t[key];
      expect(value, `sgT(${key}) should not be English`).not.toBeNull();
      expect(englishValues.has(value!), `sgT(${key}) should not be English: got ${value}`).toBe(false);
      expect(value, `sgT(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
