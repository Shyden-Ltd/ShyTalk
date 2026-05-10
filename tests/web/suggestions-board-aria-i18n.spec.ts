import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for hardcoded aria-labels on suggestions-board.js
 * dynamic modals and suggestion cards. Pre-fix, the file rendered 11
 * aria-labels via innerHTML strings that were hardcoded English:
 *   - "Sign in required" / "Close" (sign-in modal)
 *   - "Sign in with Google" / "Sign in with Apple" (auth buttons)
 *   - "Subscribe to updates" / "Close" (subscribe modal)
 *   - "Suggest a feature" / "Close" (suggest modal)
 *   - "Upvote" / "Downvote" (vote buttons on cards)
 *   - "Watch this suggestion" (bell button on cards)
 *
 * The visible text already translated via window.sgT — but the
 * aria-labels were skipped, so screen-reader users in non-English
 * locales heard the visible text in their language but the
 * accessibility hint in English. Fix replaces all 11 with
 * `escapeHtml(sgT(key))` and adds 4 new keys to SG_LABELS:
 *   close, aria_upvote, aria_downvote, aria_watch
 *
 * (signInRequired / signInGoogle / signInApple / subscribe /
 * suggestFeature were reused — already in SG_LABELS.)
 */

const SG_LOCALES = [
  'en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

const NEW_ARIA_KEYS = ['close', 'aria_upvote', 'aria_downvote', 'aria_watch'];

test.describe('Suggestions-board aria-label i18n', () => {
  test('SG_LABELS defines all 4 new aria_* keys for all 21 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Most locale rows are single-line (`<lang>: { ... },` on one line).
    // English is multi-line. Use [^{}]*? to match the row contents
    // without crossing into another locale's braces — simpler than
    // trying to match the close cleanly across both shapes.
    for (const lang of SG_LOCALES) {
      const blockRe = new RegExp(`    ${lang}:\\s*\\{([^{}]*?)\\}`);
      const blockMatch = src.match(blockRe);
      expect(blockMatch, `${lang} block not found in SG_LABELS`).not.toBeNull();
      const block = blockMatch![1];
      for (const key of NEW_ARIA_KEYS) {
        const re = new RegExp(`\\b${key}:\\s*['"][^'"]+['"]`);
        expect(block, `${lang} missing ${key}`).toMatch(re);
      }
    }
  });

  test('suggestions-board.js no longer contains hardcoded English aria-labels', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    // Hardcoded aria-label="Word" / aria-label="Multi Word" pattern.
    // Allow `aria-label="'+sgT(...)` (the new translated form) and
    // `aria-label='"+sgT(...)` etc., but reject pure-string english.
    // The matches we'd care about are inside JS string literals.
    const hardcoded = [...src.matchAll(/aria-label="([A-Z][a-z]+(?: [a-z]+)*)"/g)];
    expect(hardcoded.map(m => m[1]), 'all aria-labels should be sgT()-driven').toEqual([]);
  });

  test('Korean locale: voting button aria-labels translate to Hangul', async ({ page }) => {
    // Suggestions board mounts on roadmap.html.
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    // Wait for the suggestions board to render at least one card with a
    // vote button. The roadmap loads suggestions via an API call so we
    // need a generous timeout. If no suggestions exist yet (clean db),
    // the test still passes — we just won't have any vote buttons to
    // assert on.
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const sgT = await page.evaluate(() => {
      const w = window as Window & { sgT?: (k: string) => string };
      return {
        upvote: w.sgT ? w.sgT('aria_upvote') : null,
        downvote: w.sgT ? w.sgT('aria_downvote') : null,
        watch: w.sgT ? w.sgT('aria_watch') : null,
        close: w.sgT ? w.sgT('close') : null,
      };
    });
    expect(sgT.upvote, 'sgT(aria_upvote) in ko should not be English').not.toBe('Upvote');
    expect(sgT.upvote, 'sgT(aria_upvote) in ko should contain Hangul').toMatch(/[가-힯]/);
    expect(sgT.downvote, 'sgT(aria_downvote) in ko should contain Hangul').toMatch(/[가-힯]/);
    expect(sgT.watch, 'sgT(aria_watch) in ko should contain Hangul').toMatch(/[가-힯]/);
    expect(sgT.close, 'sgT(close) in ko should contain Hangul').toMatch(/[가-힯]/);
  });
});
