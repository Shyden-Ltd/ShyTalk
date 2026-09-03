import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the homepage roadmap CTA i18n completeness gap.
 *
 * Background: index.html ships an inline `t = { ... }` translation
 * dictionary with `roadmap_cta` and `roadmap_label` defined for only
 * three locales (es, fr, de). The other supported locales fell
 * through to the inline HTML default — "See What's Coming" /
 * "Explore our public roadmap" — even when the surrounding tagline /
 * coming_soon / app_store strings DID translate. Thai (km) was
 * missing from the dictionary entirely, so every Thai user saw a
 * fully-English homepage despite the project's stated five-locale
 * support.
 *
 * Test design: pick three high-signal locales — Chinese (CJK script,
 * detects English drift), Chinese (Cyrillic), Thai (entirely-missing
 * row). Plus one structural test asserting every supported locale
 * are present with both keys.
 */

const SUPPORTED_LOCALES = ['zh', 'th', 'vi', 'id'];

async function selectLocale(page: import('@playwright/test').Page, lang: string) {
  await page.addInitScript((target) => {
    try {
      localStorage.setItem('shytalk_language', target);
    } catch {
      /* ignore */
    }
  }, lang);
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(
    (target) => {
      const el = document.querySelector('[data-i18n="roadmap_cta"]');
      return !!(el && el.textContent && el.textContent.trim().length > 0);
    },
    lang,
    { timeout: 10_000 },
  );
}

test.describe('Homepage roadmap CTA i18n completeness', () => {
  // Three locales chosen for signal, not coverage: Chinese for a distinct CJK
  // block, Thai for a distinct Thai block, and Vietnamese because it is Latin
  // WITH diacritics — no character class can identify it, so it is asserted by
  // "no longer the English string", which is the property that actually matters.
  test('Chinese locale translates roadmap_cta away from English', async ({ page }) => {
    await selectLocale(page, 'zh');
    const cta = (await page.locator('[data-i18n="roadmap_cta"]').textContent())?.trim();
    const label = (await page.locator('[data-i18n="roadmap_label"]').textContent())?.trim();
    expect(cta, 'roadmap_cta in zh should not be English').not.toBe("See What's Coming");
    expect(cta, 'roadmap_cta in zh should contain Han characters').toMatch(/[一-鿿]/);
    expect(label, 'roadmap_label in zh should not be English').not.toBe('Explore our public roadmap');
  });

  test('Thai locale translates roadmap_cta away from English', async ({ page }) => {
    await selectLocale(page, 'th');
    const tagline = (await page.locator('[data-i18n="tagline"]').textContent())?.trim();
    const cta = (await page.locator('[data-i18n="roadmap_cta"]').textContent())?.trim();
    expect(tagline, 'tagline in th should contain Thai script').toMatch(/[ก-๛]/);
    expect(cta, 'roadmap_cta in th should contain Thai script').toMatch(/[ก-๛]/);
  });

  test('Vietnamese locale translates roadmap_cta away from English', async ({ page }) => {
    await selectLocale(page, 'vi');
    const cta = (await page.locator('[data-i18n="roadmap_cta"]').textContent())?.trim();
    expect(cta, 'roadmap_cta in vi should not be English').not.toBe("See What's Coming");
    expect(cta, 'roadmap_cta in vi should not be empty').toBeTruthy();
  });

  test('every supported locale defines both roadmap_cta and roadmap_label', async ({ request }) => {
    // Scrapes the externalized HOMEPAGE_T module (was inline in
    // index.html until the homepage-translations.js extraction).
    const res = await request.get(`${BASE}/js/homepage-translations.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    for (const lang of SUPPORTED_LOCALES) {
      // Match: e.g. `pt: { ... roadmap_cta: "..." ... roadmap_label: "..." ... }`
      // Use a tolerant regex — the keys can appear in any order on the
      // single-line locale rows we ship today.
      const rowRe = new RegExp(`${lang}:\\s*\\{[^{}]*\\}`);
      const rowMatch = src.match(rowRe);
      expect(rowMatch, `${lang} locale row not found in HOMEPAGE_T`).not.toBeNull();
      const row = rowMatch![0];
      expect(row, `${lang} missing roadmap_cta`).toMatch(/roadmap_cta:/);
      expect(row, `${lang} missing roadmap_label`).toMatch(/roadmap_label:/);
    }
  });
});
