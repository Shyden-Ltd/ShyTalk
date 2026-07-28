import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * The tag dropdown must be translated AND must offer tags the API accepts.
 *
 * Originally this pinned nine invented tag keys — tagVoice / tagChat /
 * tagModeration / tagUi / tagPrivacy / tagSocial / tagEconomy /
 * tagAccessibility / tagOther. They were translated beautifully into 21
 * locales and eight of the nine were rejected by the API with 400 "Invalid
 * tag", which made submitting a suggestion impossible (SHY-0248). Pinning the
 * translation of a wrong vocabulary is worse than not pinning it: it makes the
 * wrong thing look deliberate.
 *
 * So this file now covers only the i18n half — no hardcoded English, and real
 * translations in the supported locales. Whether the VALUES are ones the API
 * accepts is checked live against the API in `suggestions-submit-tags.spec.ts`,
 * which cannot go stale the way a transcribed list does.
 */

/** Tags are the roadmap's own phases, so they reuse the phase label keys. */
const TAG_LABEL_KEYS = [
  'phaseCompliance',
  'phasePlatform',
  'phaseRevenue',
  'phaseSocial',
  'phaseQol',
  'phaseEntertainment',
  'phaseSupport',
  'phaseWebsite',
];

/**
 * The non-English locales ShyTalk actively maintains (SHY-0194). `sgT()` falls
 * back to English for anything else, so an unmaintained locale degrades to
 * readable English rather than a missing string — which is why the "is it
 * actually translated" assertion is scoped to these.
 */
const SUPPORTED_LOCALES = ['zh', 'id', 'vi'];

test.describe('Suggestions-board TAG_OPTIONS i18n', () => {
  test('TAG_OPTIONS labels are sgT()-driven, not hardcoded', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();
    const tagBlock = src.match(/var TAG_OPTIONS = \[([\s\S]*?)\];/);
    expect(tagBlock, 'TAG_OPTIONS array not found').not.toBeNull();
    const arrSrc = tagBlock![1];

    // Every entry's label must come from sgT(...) — a bare quoted label is a
    // string only English readers can use.
    const labels = [...arrSrc.matchAll(/label:\s*([^,\n]+?)\s*\}/g)].map((m) => m[1].trim());
    expect(labels.length, 'TAG_OPTIONS should have entries').toBeGreaterThan(1);
    for (const label of labels) {
      expect(label, `TAG_OPTIONS label must be sgT()-driven, got: ${label}`).toMatch(
        /^sgT\("[a-zA-Z_]+"\)$/,
      );
    }

    for (const key of TAG_LABEL_KEYS) {
      expect(arrSrc, `TAG_OPTIONS should use sgT("${key}")`).toMatch(
        new RegExp(`label:\\s*sgT\\("${key}"\\)`),
      );
    }
  });

  test('SG_LABELS defines every tag label key for the supported locales', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    const src = await res.text();
    for (const lang of ['en', ...SUPPORTED_LOCALES]) {
      const blockRe =
        lang === 'en'
          ? /\n {4}en:\s*\{([\s\S]*?)\n {4}\},/
          : new RegExp(`\\n {4}${lang}:\\s*\\{([^{}]*?)\\}`);
      const blockMatch = src.match(blockRe);
      expect(blockMatch, `${lang} block not found`).not.toBeNull();
      const block = blockMatch![1];
      for (const key of TAG_LABEL_KEYS) {
        expect(block, `${lang} missing ${key}`).toMatch(new RegExp(`\\b${key}:\\s*['"][^'"]+['"]`));
      }
    }
  });

  test('supported locales return a real translation, not the English string', async ({ page }) => {
    // A key that merely EXISTS proves nothing — it could hold the English
    // text. Comparing against English is what catches a copy-paste.
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );

    const byLocale = await page.evaluate(
      ({ keys, locales }) => {
        const w = window as Window & { SG_LABELS?: Record<string, Record<string, string>> };
        const out: Record<string, Record<string, string>> = {};
        for (const l of ['en', ...locales]) {
          out[l] = {};
          for (const k of keys) out[l][k] = w.SG_LABELS?.[l]?.[k] ?? '';
        }
        return out;
      },
      { keys: TAG_LABEL_KEYS, locales: SUPPORTED_LOCALES },
    );

    for (const locale of SUPPORTED_LOCALES) {
      for (const key of TAG_LABEL_KEYS) {
        expect(byLocale[locale][key], `${locale}.${key} must exist`).toBeTruthy();
        expect(byLocale[locale][key], `${locale}.${key} is still the English string`).not.toBe(
          byLocale.en[key],
        );
      }
    }
  });
});
