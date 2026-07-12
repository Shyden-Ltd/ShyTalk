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
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl');
  });

  test('an unsupported ?lang= is ignored (falls back, never applied)', async ({ page }) => {
    // clean slate so the fallback is navigator/en, not a stale localStorage.
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.removeItem('shytalk_language'));
    const lang = await resolvedLang(page, '/?lang=xx-not-a-locale');
    expect(lang).not.toBe('xx-not-a-locale');
    expect(['en', 'de']).toContain(lang); // navigator default in CI is en (allow de for a de runner)
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
