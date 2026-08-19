import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression: language picker MUST set `dir="rtl"` on Arabic and
 * `dir="ltr"` on every other supported language.
 *
 * Pre-fix: `setLanguage()` only set `document.documentElement.lang`,
 * leaving `dir` as whatever HTML default (`""` → browser-default LTR).
 * Switching to Arabic kept the page LTR, so Arabic readers saw a
 * backwards-mirrored UX (logo on left, Sign In on right is wrong for
 * RTL). Found 2026-05-09 during /manual-qa.
 */

const SUPPORTED_LANGS = [
  'en', 'de', 'es', 'fr', 'hi', 'id', 'it', 'km', 'ja', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

test.describe('Language selector — RTL direction (regression)', () => {
  test('switching to Arabic sets dir=rtl', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLanguage !== 'undefined');

    const result = await page.evaluate(() => {
      (window as any).ShyTalkLanguage.set('ar');
      return {
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
      };
    });

    expect(result.lang).toBe('ar');
    expect(result.dir).toBe('rtl');
  });

  test('switching from Arabic back to English resets dir=ltr', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLanguage !== 'undefined');

    const result = await page.evaluate(() => {
      // Go to Arabic first
      (window as any).ShyTalkLanguage.set('ar');
      // Then back to English — must explicitly reset dir, otherwise
      // a page-load-with-Arabic-saved-then-switch-to-English session
      // would keep RTL.
      (window as any).ShyTalkLanguage.set('en');
      return {
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
      };
    });

    expect(result.lang).toBe('en');
    expect(result.dir).toBe('ltr');
  });

  test('all 19 non-RTL supported languages set dir=ltr', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLanguage !== 'undefined');

    const results = await page.evaluate((langs: string[]) => {
      return langs.map((lang) => {
        (window as any).ShyTalkLanguage.set(lang);
        return { lang, dir: document.documentElement.dir };
      });
    }, SUPPORTED_LANGS);

    for (const r of results) {
      expect(r.dir, `${r.lang} should be LTR`).toBe('ltr');
    }
  });

  test('saved Arabic preference applies dir=rtl on page load', async ({ page }) => {
    // Set the localStorage marker BEFORE the page loads so the IIFE
    // init path picks it up — exercises the line 220+ block, not the
    // setLanguage() path.
    await page.addInitScript(() => {
      localStorage.setItem('shytalk_language', 'ar');
    });

    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.documentElement.lang === 'ar');

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
  });
});
