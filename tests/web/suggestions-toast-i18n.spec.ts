import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for hardcoded English toast / button strings in
 * suggestions-board.js across the vote / submit-suggestion / comment
 * flows.
 *
 * Pre-fix the file rendered 10 hardcoded user-facing strings that the
 * subscribe-dialog i18n PR (#606) deliberately left out of scope:
 *   - "Vote failed: " toast prefix (line 342) + "Unknown error" fallback
 *   - "Redirecting to existing suggestion" toast (line 843)
 *   - "Submitting..." button state (line 874)
 *   - "This topic is not allowed: " toast prefix (line 880)
 *   - "Submit" button reset (3 sites: lines 882, 903, 911)
 *   - "Suggestion submitted! It will be reviewed before publishing." toast
 *   - "Failed to submit: " toast prefix (line 901)
 *   - "Posting..." button state (line 1460)
 *   - "Comment posted" toast (line 1464)
 *   - "Failed to post comment: " toast prefix (line 1463) + "Unknown error"
 *   - "Post" button reset (line 1472)
 *
 * Fix: 10 new keys × 21 locales = 210 entries to SG_LABELS in
 * suggestions-i18n.js (`unknown_error`, `toast_vote_failed`,
 * `toast_redirecting_to_existing`, `btn_submitting`,
 * `toast_topic_not_allowed`, `toast_submit_failed`,
 * `toast_suggestion_submitted`, `btn_posting`, `toast_comment_posted`,
 * `toast_post_comment_failed`). Button resets reuse existing `submit`
 * and `postComment` keys.
 *
 * After this PR there should be zero hardcoded user-facing strings in
 * suggestions-board.js — verified by the negative regex assertions
 * below.
 */

const TOAST_KEYS = [
  'toast_vote_failed',
  'unknown_error',
  'toast_redirecting_to_existing',
  'btn_submitting',
  'toast_topic_not_allowed',
  'toast_submit_failed',
  'toast_suggestion_submitted',
  'btn_posting',
  'toast_comment_posted',
  'toast_post_comment_failed',
];

test.describe('Suggestions-board vote/submit/comment toast i18n', () => {
  test('All 10 toast/button keys are sgT()-wired in suggestions-board.js', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Every new key should be referenced by a sgT() call.
    for (const key of TOAST_KEYS) {
      expect(src, `suggestions-board.js should call sgT("${key}")`).toMatch(
        new RegExp(`sgT\\("${key}"\\)`),
      );
    }

    // Negative assertions: previously-hardcoded strings must not exist
    // as bare quoted literals in the file (sgT(...) calls preserve the
    // KEY literal but not the ENGLISH literal, so these checks are
    // robust).
    const hardcodedFails: Array<[string, RegExp]> = [
      ['Vote failed: in showToast', /showToast\("Vote failed:/],
      ['Redirecting in showToast', /showToast\("Redirecting to existing suggestion"\)/],
      ['Submitting... in textContent', /textContent\s*=\s*"Submitting\.\.\."/],
      ['Topic not allowed in showToast', /showToast\("This topic is not allowed:/],
      ['Submit reset in textContent', /submitBtn\.textContent\s*=\s*"Submit"/],
      ['Suggestion submitted toast', /showToast\("Suggestion submitted!/],
      ['Failed to submit in showToast', /showToast\("Failed to submit:/],
      ['Posting... in textContent', /btn\.textContent\s*=\s*"Posting\.\.\."/],
      ['Comment posted in showToast', /showToast\("Comment posted"\)/],
      ['Failed to post in showToast', /"Failed to post comment:/],
      ['Post reset in textContent', /btn\.textContent\s*=\s*"Post"/],
      ['Unknown error string', /"Unknown error"/],
    ];
    for (const [name, re] of hardcodedFails) {
      expect(src, `Should not contain hardcoded: ${name}`).not.toMatch(re);
    }
  });

  test('All 21 locales define every toast key in SG_LABELS', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const locales = [
      'en',
      'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
      'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
    ];

    for (const locale of locales) {
      const localeBlock =
        locale === 'en'
          ? src.match(/en:\s*\{([\s\S]*?)\n {4}\},/)
          : src.match(new RegExp(`${locale}:\\s*\\{([^{}]*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of TOAST_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean locale: sgT() returns Hangul for all toast keys', async ({ page }) => {
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
    }, TOAST_KEYS);

    const englishValues: Record<string, string> = {
      toast_vote_failed: 'Vote failed',
      unknown_error: 'Unknown error',
      toast_redirecting_to_existing: 'Redirecting to existing suggestion',
      btn_submitting: 'Submitting...',
      toast_topic_not_allowed: 'This topic is not allowed',
      toast_submit_failed: 'Failed to submit',
      toast_suggestion_submitted: 'Suggestion submitted! It will be reviewed before publishing.',
      btn_posting: 'Posting...',
      toast_comment_posted: 'Comment posted',
      toast_post_comment_failed: 'Failed to post comment',
    };
    for (const key of TOAST_KEYS) {
      const value = t[key];
      expect(value, `sgT(${key}) should not be null`).not.toBeNull();
      expect(value, `sgT(${key}) should not be English`).not.toBe(englishValues[key]);
      expect(value, `sgT(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
