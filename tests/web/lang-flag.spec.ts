import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * SHY-0181 — the `?lang=<code>` URL flag must drive the language on EVERY
 * owned web page (all 11 load the shared `language-selector.js` resolver), so
 * the app (and any deep link) can force a locale regardless of the browser's
 * `navigator.language`. Priority: url param > localStorage > navigator > en.
 * A valid `?lang=` is validated against the 20-locale allowlist and persisted
 * so it sticks across internal navigation; an invalid value is ignored (no
 * fallback break, no reflected-XSS).
 *
 * Real browser + real pages (no mocks). Requires the static web server on
 * :8888 (serve-web.js).
 */

// Representative page per owned surface — all share the resolver.
const SURFACES = ['/', '/privacy.html', '/admin/', '/portal/'];

async function resolvedLang(page: any, url: string): Promise<string> {
  await page.goto(`${BASE}${url}`);
  await page.waitForFunction(() => typeof (window as any).ShyTalkLanguage !== 'undefined');
  return page.evaluate(() => (window as any).ShyTalkLanguage.get());
}

test.describe('SHY-0181 — ?lang= URL flag drives language site-wide', () => {
  // Pin the browser locale so the navigator-fallback tests are deterministic
  // (no reliance on the CI/runner OS language).
  test.use({ locale: 'en-US' });

  for (const url of SURFACES) {
    test(`?lang=fr forces French on ${url}`, async ({ page }) => {
      expect(await resolvedLang(page, `${url}?lang=fr`)).toBe('fr');
      // the resolver applied it to the document (translation ran)
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
    });
  }

  test('?lang= takes priority over a different persisted localStorage value', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.setItem('shytalk_language', 'de'));
    expect(await resolvedLang(page, '/?lang=fr')).toBe('fr');
  });

  test('a valid ?lang= persists across internal navigation (param dropped)', async ({ page }) => {
    expect(await resolvedLang(page, '/?lang=es')).toBe('es');
    // navigate to another page WITHOUT the param — the choice must stick
    expect(await resolvedLang(page, '/privacy.html')).toBe('es');
  });

  test('?lang=ar sets dir=rtl (forced RTL lays out correctly)', async ({ page }) => {
    await page.goto(`${BASE}/?lang=ar`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLanguage !== 'undefined');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('an unsupported ?lang= is ignored (falls back, never applied)', async ({ page }) => {
    // clean slate so the fallback is navigator/en, not a stale localStorage.
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.removeItem('shytalk_language'));
    const lang = await resolvedLang(page, '/?lang=xx-not-a-locale');
    // test.use locale=en-US makes the navigator fallback deterministic.
    expect(lang).toBe('en');
  });

  test('?lang= with a BCP-47 region (fr-CA) resolves to the base locale (fr)', async ({ page }) => {
    expect(await resolvedLang(page, '/?lang=fr-CA')).toBe('fr');
  });

  test('?lang= is case-insensitive (FR → fr)', async ({ page }) => {
    expect(await resolvedLang(page, '/?lang=FR')).toBe('fr');
  });

  test('ShyTalkLanguage.set() rejects an unsupported value (never written to the DOM)', async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.removeItem('shytalk_language'));
    await page.evaluate(() => (window as any).ShyTalkLanguage.set('not-a-locale'));
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    expect(htmlLang).not.toBe('not-a-locale');
    expect(await page.evaluate(() => localStorage.getItem('shytalk_language'))).not.toBe(
      'not-a-locale',
    );
  });

  test('a script-injection ?lang= is never applied to the document', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.removeItem('shytalk_language'));
    await page.goto(`${BASE}/?lang=${encodeURIComponent('<script>alert(1)</script>')}`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLanguage !== 'undefined');
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    expect(htmlLang).not.toContain('<');
    expect(htmlLang).not.toContain('script');
  });
});
