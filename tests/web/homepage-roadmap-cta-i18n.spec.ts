import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for the homepage roadmap CTA i18n completeness gap.
 *
 * Background: index.html ships an inline `t = { ... }` translation
 * dictionary with `roadmap_cta` and `roadmap_label` defined for only
 * three locales (es, fr, de). The other 17 supported locales fell
 * through to the inline HTML default — "See What's Coming" /
 * "Explore our public roadmap" — even when the surrounding tagline /
 * coming_soon / app_store strings DID translate. Khmer (km) was
 * missing from the dictionary entirely, so every Khmer user saw a
 * fully-English homepage despite the project's stated 20-locale
 * support.
 *
 * Test design: pick three high-signal locales — Korean (CJK script,
 * detects English drift), Russian (Cyrillic), Khmer (entirely-missing
 * row). Plus one structural test asserting all 20 supported locales
 * are present with both keys.
 */

const SUPPORTED_LOCALES = [
  'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi',
  'tr', 'ru', 'uk', 'th', 'vi', 'id', 'pl', 'nl', 'sv', 'km',
];

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
  test('Korean locale translates roadmap_cta away from English', async ({ page }) => {
    await selectLocale(page, 'ko');
    const cta = (await page.locator('[data-i18n="roadmap_cta"]').textContent())?.trim();
    const label = (await page.locator('[data-i18n="roadmap_label"]').textContent())?.trim();
    expect(cta, 'roadmap_cta in ko should not be English').not.toBe("See What's Coming");
    expect(cta, 'roadmap_cta in ko should contain hangul').toMatch(/[가-힯]/);
    expect(label, 'roadmap_label in ko should not be English').not.toBe('Explore our public roadmap');
  });

  test('Russian locale translates roadmap_cta away from English', async ({ page }) => {
    await selectLocale(page, 'ru');
    const cta = (await page.locator('[data-i18n="roadmap_cta"]').textContent())?.trim();
    expect(cta, 'roadmap_cta in ru should not be English').not.toBe("See What's Coming");
    expect(cta, 'roadmap_cta in ru should contain Cyrillic').toMatch(/[Ѐ-ӿ]/);
  });

  test('Khmer locale: entire homepage row exists and translates', async ({ page }) => {
    await selectLocale(page, 'km');
    const tagline = (await page.locator('[data-i18n="tagline"]').textContent())?.trim();
    const cta = (await page.locator('[data-i18n="roadmap_cta"]').textContent())?.trim();
    expect(tagline, 'tagline in km should contain Khmer script').toMatch(/[ក-៿]/);
    expect(cta, 'roadmap_cta in km should contain Khmer script').toMatch(/[ក-៿]/);
  });

  test('all 20 supported locales define both roadmap_cta and roadmap_label', async ({ request }) => {
    const res = await request.get(`${BASE}/index.html`);
    expect(res.ok()).toBe(true);
    const html = await res.text();

    for (const lang of SUPPORTED_LOCALES) {
      // Match: e.g. `pt: { ... roadmap_cta: "..." ... roadmap_label: "..." ... }`
      // Use a tolerant regex — the keys can appear in any order on the
      // single-line locale rows we ship today.
      const rowRe = new RegExp(`${lang}:\\s*\\{[^{}]*\\}`);
      const rowMatch = html.match(rowRe);
      expect(rowMatch, `${lang} locale row not found in inline dictionary`).not.toBeNull();
      const row = rowMatch![0];
      expect(row, `${lang} missing roadmap_cta`).toMatch(/roadmap_cta:/);
      expect(row, `${lang} missing roadmap_label`).toMatch(/roadmap_label:/);
    }
  });
});
