import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for hardcoded English PHASE_OPTIONS labels in
 * suggestions-board.js.
 *
 * Pre-fix, the phase-filter dropdown rendered:
 *   "Compliance & Legal", "Platform Foundation", "Revenue Engine",
 *   "Core Social", "Quality of Life", "Entertainment",
 *   "Support & Specialised"
 * — hardcoded English across all 21 locales.
 *
 * Fix: replace each hardcoded label with sgT(key) and add the 7
 * phase keys to suggestions-i18n.js across all 21 locales (en + 20
 * non-en). Pattern mirrors PR #598 (STATUS_OPTIONS) and PR #603
 * (TAG_OPTIONS).
 *
 * Limitation (out of scope): eval-once-at-load — switching language
 * after the IIFE runs leaves the dropdown frozen. Same limitation as
 * STATUS_OPTIONS / TAG_OPTIONS / LANG_OPTIONS by design.
 */

const PHASE_KEYS = [
  'phaseCompliance',
  'phasePlatform',
  'phaseRevenue',
  'phaseSocial',
  'phaseQol',
  'phaseEntertainment',
  'phaseSupport',
];

const HARDCODED_LABELS = [
  'Compliance & Legal',
  'Platform Foundation',
  'Revenue Engine',
  'Core Social',
  'Quality of Life',
  'Entertainment',
  'Support & Specialised',
];

test.describe('Suggestions-board PHASE_OPTIONS i18n', () => {
  test('PHASE_OPTIONS labels are sgT()-driven, not hardcoded', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const phaseBlock = src.match(/var PHASE_OPTIONS = \[([\s\S]*?)\];/);
    expect(phaseBlock, 'PHASE_OPTIONS array not found').not.toBeNull();
    const arrSrc = phaseBlock![1];

    for (const name of HARDCODED_LABELS) {
      const escaped = name.replace(/[&]/g, '\\&');
      expect(arrSrc, `PHASE_OPTIONS should not hardcode "${name}"`).not.toMatch(
        new RegExp(`label:\\s*"${escaped}"`),
      );
    }

    for (const key of PHASE_KEYS) {
      expect(arrSrc, `PHASE_OPTIONS should use sgT("${key}")`).toMatch(
        new RegExp(`label:\\s*sgT\\("${key}"\\)`),
      );
    }
  });

  test('All 21 locales define every PHASE_OPTIONS key in SG_LABELS', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const locales = [
      'en',
      'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
      'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
    ];

    for (const locale of locales) {
      const localeBlock =
        locale === 'en'
          ? src.match(/en:\s*\{([\s\S]*?)\n {4}\},/)
          : src.match(new RegExp(`${locale}:\\s*\\{([^{}]*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of PHASE_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean locale: sgT() returns Hangul for all 7 phase keys', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const t = await page.evaluate((keys) => {
      const w = window as Window & { sgT?: (k: string) => string };
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = w.sgT ? w.sgT(k) : null;
      return out;
    }, PHASE_KEYS);

    const englishValues = new Set(HARDCODED_LABELS);
    for (const key of PHASE_KEYS) {
      const value = t[key];
      expect(value, `sgT(${key}) should not be null`).not.toBeNull();
      expect(englishValues.has(value!), `sgT(${key}) should not be English: got ${value}`).toBe(false);
      expect(value, `sgT(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
