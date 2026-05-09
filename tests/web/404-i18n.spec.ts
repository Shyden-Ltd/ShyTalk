import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Pin the contract that the branded 404 page renders translated content
 * for all 20 supported locales — not just English.
 *
 * Background: PR #572 added /404.html as a branded fallback for
 * Cloudflare Pages' generic 404, but shipped English-only with a
 * follow-up tracked in task #19. This is that follow-up — it wires
 * `LEGAL_PAGE_TYPE='notfound'` + `legal-translations.js` + an inline
 * init bridge mirroring the terms.html pattern, plus adds the
 * `LEGAL_T.notfound[lang]` section for all 20 locales (excluding en
 * which falls back to the inline HTML default).
 *
 * Test design: hit Arabic (RTL + non-Latin script — easiest to detect
 * remaining English) for the deepest functional check, plus a
 * structural test asserting all 20 locales define the 3 keys.
 */

test.describe('404.html i18n', () => {
  test('Arabic switch translates title, description, and home link', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('shytalk_language', 'ar');
    });
    await page.goto(`${BASE}/404.html`);
    // Wait for inline init bridge to apply translations.
    await page.waitForFunction(
      () => document.documentElement.lang === 'ar',
      null,
      { timeout: 5_000 },
    );

    // Each translated element must NOT contain its English default.
    const title = await page.locator('h1').textContent();
    expect(title?.trim(), '404 title stayed in English after Arabic switch').not.toBe('Page not found');
    expect(title, 'title should contain Arabic chars').toMatch(/[؀-ۿ]/);

    const desc = await page.locator('main p').textContent();
    expect(desc?.trim(), '404 description stayed in English after Arabic switch').not.toContain('The page you were looking for');
    expect(desc, 'description should contain Arabic chars').toMatch(/[؀-ۿ]/);

    const home = await page.locator('[data-testid="404-home-link"]').textContent();
    expect(home?.trim(), '404 home link stayed in English after Arabic switch').not.toBe('Back to ShyTalk');
    expect(home, 'home link should contain Arabic chars').toMatch(/[؀-ۿ]/);
  });

  test('English (default) renders the inline HTML defaults', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('shytalk_language', 'en');
    });
    await page.goto(`${BASE}/404.html`);
    // No explicit Arabic-style wait needed — inline HTML is already English.
    await expect(page.locator('h1')).toContainText('Page not found');
    await expect(page.locator('[data-testid="404-home-link"]')).toContainText('Back to ShyTalk');
  });

  test('legal-translations.js defines notfound section for all 20 locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/legal-translations.js`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const locales = ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko', 'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];
    // Find the notfound section block. Use a non-greedy match to find each
    // locale's line within the notfound object.
    const notfoundStart = text.indexOf('notfound: {');
    expect(notfoundStart, 'notfound section missing from legal-translations.js').toBeGreaterThan(0);
    // Find the end of the notfound object — first `\n  },\n` after start.
    const notfoundEnd = text.indexOf('\n  },\n', notfoundStart);
    expect(notfoundEnd, 'notfound section close not found').toBeGreaterThan(notfoundStart);
    const notfoundBlock = text.slice(notfoundStart, notfoundEnd);
    for (const locale of locales) {
      const re = new RegExp(`\\s${locale}: \\{ [^\\n]*not_found_title:[^\\n]*not_found_desc:[^\\n]*not_found_home:`);
      expect(notfoundBlock, `${locale} missing or has incomplete notfound entry`).toMatch(re);
    }
  });
});
