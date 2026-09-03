import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression: language picker MUST set `dir` EXPLICITLY rather than leaving
 * the HTML default. It once set `rtl` on Arabic and
 * `dir="ltr"` on every other supported language.
 *
 * Pre-fix: `setLanguage()` only set `document.documentElement.lang`,
 * leaving `dir` as whatever HTML default (`""` → browser-default LTR).
 * Switching to Thai kept the page LTR, so Thai readers saw a
 * backwards-mirrored UX (logo on left, Sign In on right is wrong for
 * RTL). Found 2026-05-09 during /manual-qa.
 */

const SUPPORTED_LANGS = ['en', 'id', 'th', 'vi', 'zh'];

test.describe('Language selector — RTL direction (regression)', () => {
  // The two Arabic cases that lived here are gone with SHY-0289: Arabic was
  // the only right-to-left language shipped, so `dir="rtl"` now has no
  // language that can produce it and a test asserting it would be asserting
  // something unreachable. What survives is the half that still bites — the
  // selector must set `dir` EXPLICITLY rather than leaving the HTML default,
  // which is the 2026-05-09 regression this file was written for.
  //
  // If an RTL language returns, restore both cases alongside its entry in
  // RTL_LANGS.
  test('every supported language set dir=ltr', async ({ page }) => {
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

});
