import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the roadmap footer copyright orphan retired in
 * the i18n-orphan cleanup work.
 *
 * Background: roadmap.html ships `<span data-i18n="copyright">© Shyden
 * Ltd</span>`, but `copyright` was undefined in roadmap-app.js. The
 * applyLanguage handler silently no-ops on missing keys, so the inline
 * default rendered as an English string in every locale — invisibly
 * "broken" because the value happens to be visually neutral.
 *
 * This test pins:
 *  1. The DOM update path runs (textContent populated by JS, not just
 *     inline default).
 *  2. The English fallback works for languages that don't define
 *     `copyright` explicitly (relies on `LABELS.en[key]` fallback in
 *     `t()` at roadmap-app.js).
 */

test.describe('Roadmap footer i18n', () => {
  test('copyright element is populated via t() — not left as raw HTML default', async ({ page }) => {
    await page.goto(`${BASE}/roadmap.html`);

    // Wait for roadmap-app.js to finish rendering (footer disclaimer
    // gets populated in the same code path as copyright).
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n="disclaimer"]');
        return !!(el && el.textContent && el.textContent.trim().length > 0);
      },
      null,
      { timeout: 10_000 },
    );

    const copyright = page.locator('[data-i18n="copyright"]');
    await expect(copyright).toBeVisible();
    const text = (await copyright.textContent())?.trim() || '';
    expect(text, 'copyright must contain Shyden Ltd brand').toContain('Shyden Ltd');
    expect(text, 'copyright must contain copyright symbol').toMatch(/©/);
  });

  test('copyright falls back to English when locale lacks the key', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'ar');
      } catch {
        /* localStorage may be unavailable on some webkit configs; ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n="copyright"]');
        return !!(el && el.textContent && el.textContent.includes('Shyden Ltd'));
      },
      null,
      { timeout: 10_000 },
    );

    const copyright = await page.locator('[data-i18n="copyright"]').textContent();
    expect(copyright, 'copyright must contain Shyden Ltd brand even in Arabic locale').toContain('Shyden Ltd');
  });

  test('roadmap-app.js defines copyright key (orphan-checker contract)', async ({ request }) => {
    const res = await request.get(`${BASE}/js/roadmap-app.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    expect(src, 'copyright key must be defined to satisfy orphan-i18n-keys check').toMatch(
      /copyright:\s*"[^"]*Shyden Ltd[^"]*"/,
    );
  });
});
