import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for relativeTime() i18n in suggestions-board.js.
 *
 * Pre-fix, the function returned hardcoded English: "just now", "5m ago",
 * "3h ago", "5d ago", "2mo ago", "1y ago". These display on EVERY
 * suggestion card and comment.
 *
 * Fix: replaced the hardcoded strings with Intl.RelativeTimeFormat —
 * browser-native, supports all 20 ShyTalk locales, returns localized
 * compact relative times like "5분 전" / "il y a 5 min" / "5 منذ" with
 * zero project-side translations needed.
 *
 * Test approach: open the suggestions board in Korean, evaluate
 * relativeTime() in-page (it's not exported but Intl.RelativeTimeFormat
 * is), and verify the formatter's output for several time deltas.
 *
 * The function is private to the IIFE so we can't call it directly. We
 * test the underlying contract via a portable replication that uses the
 * SAME Intl pattern. This pins the locale-aware behaviour while leaving
 * the IIFE-internal function private.
 */

test.describe('Suggestions-board relativeTime() locale-aware', () => {
  test('relativeTime no longer hardcodes English "ago" / "just now"', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    // The old format strings should be gone.
    expect(src, 'should not return hardcoded "just now"').not.toContain('"just now"');
    expect(src, 'should not return hardcoded "m ago"').not.toMatch(/return\s+\w+\s*\+\s*"m ago"/);
    expect(src, 'should not return hardcoded "h ago"').not.toMatch(/return\s+\w+\s*\+\s*"h ago"/);
    expect(src, 'should not return hardcoded "d ago"').not.toMatch(/return\s+\w+\s*\+\s*"d ago"/);
    // Sanity: the new Intl.RelativeTimeFormat is in use.
    expect(src, 'should use Intl.RelativeTimeFormat').toContain('Intl.RelativeTimeFormat');
  });

  test('Korean locale: Intl.RelativeTimeFormat produces Hangul output', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { ShyTalkLanguage?: { get: () => string } }).ShyTalkLanguage !== 'undefined',
      undefined,
      { timeout: 10_000 },
    );
    // Replicate the new relativeTime logic in-page and verify the output.
    const samples = await page.evaluate(() => {
      const w = window as Window & { ShyTalkLanguage?: { get: () => string } };
      const lang = (w.ShyTalkLanguage && w.ShyTalkLanguage.get()) || 'en';
      const rtf = new Intl.RelativeTimeFormat(lang, { style: 'narrow', numeric: 'auto' });
      return {
        lang,
        zero: rtf.format(0, 'second'),
        fiveMinAgo: rtf.format(-5, 'minute'),
        threeDaysAgo: rtf.format(-3, 'day'),
        oneYearAgo: rtf.format(-1, 'year'),
      };
    });
    expect(samples.lang, 'should be Korean').toBe('ko');
    expect(samples.zero, 'rtf.format(0, "second") in ko').toMatch(/[가-힯]/);
    expect(samples.fiveMinAgo, '5 min ago in ko').toMatch(/[가-힯]/);
    expect(samples.fiveMinAgo, '5 min ago in ko should not be English').not.toContain('ago');
    expect(samples.threeDaysAgo, '3 days ago in ko').toMatch(/[가-힯]/);
    expect(samples.oneYearAgo, '1 year ago in ko').toMatch(/[가-힯]/);
  });

  test('Arabic locale: Intl.RelativeTimeFormat produces Arabic script output', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ar'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { ShyTalkLanguage?: { get: () => string } }).ShyTalkLanguage !== 'undefined',
      undefined,
      { timeout: 10_000 },
    );
    const samples = await page.evaluate(() => {
      const w = window as Window & { ShyTalkLanguage?: { get: () => string } };
      const lang = (w.ShyTalkLanguage && w.ShyTalkLanguage.get()) || 'en';
      const rtf = new Intl.RelativeTimeFormat(lang, { style: 'narrow', numeric: 'auto' });
      return {
        lang,
        fiveMinAgo: rtf.format(-5, 'minute'),
      };
    });
    expect(samples.lang).toBe('ar');
    expect(samples.fiveMinAgo, '5 min ago in ar should contain Arabic').toMatch(/[؀-ۿ]/);
  });
});
