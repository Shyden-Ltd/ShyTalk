import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Translation verification tests — prove that changing language
 * ACTUALLY changes visible text on every translatable page.
 *
 * Each test: select a non-English language, verify text changed
 * from English to the target language.
 */
test.describe('Translation Verification', () => {

  // Helper: open language modal, select a language, close modal
  async function changeLanguage(page: import('@playwright/test').Page, langCode: string) {
    const langBtn = page.locator('.stl-lang-btn');
    await expect(langBtn).toBeVisible({ timeout: 5_000 });
    await langBtn.click();
    const overlay = page.locator('.stl-lang-overlay');
    await expect(overlay).toHaveClass(/open/, { timeout: 3_000 });
    const langItem = page.locator(`.stl-lang-item[data-lang="${langCode}"]`);
    await langItem.click();
    // Wait for modal to close
    await expect(overlay).not.toHaveClass(/open/, { timeout: 3_000 });
  }

  test.describe('Landing Page', () => {
    test('tagline changes when language is set to Thai', async ({ page }) => {
      await page.goto(BASE);
      const tagline = page.locator('.tagline');
      await expect(tagline).toContainText('Voice chat rooms', { timeout: 5_000 });
      await changeLanguage(page, 'th');
      await expect(tagline).not.toContainText('Voice chat rooms', { timeout: 5_000 });
    });

    test('CTA button changes when language is set to Vietnamese', async ({ page }) => {
      await page.goto(BASE);
      await changeLanguage(page, 'vi');
      const cta = page.locator('.roadmap-cta');
      await expect(cta).not.toContainText('See What', { timeout: 5_000 });
    });
  });

  test.describe('Privacy Policy', () => {
    test('title changes when language is set to Indonesian', async ({ page }) => {
      await page.goto(`${BASE}/privacy.html`);
      const title = page.locator('[data-i18n="pp_title"]');
      await expect(title).toBeVisible({ timeout: 5_000 });
      const englishText = await title.textContent();
      await changeLanguage(page, 'id');
      const germanText = await title.textContent();
      expect(germanText).not.toBe(englishText);
    });
  });

  test.describe('Terms of Service', () => {
    test('title changes when language is set to Chinese', async ({ page }) => {
      await page.goto(`${BASE}/terms.html`);
      const title = page.locator('[data-i18n="tos_title"]');
      await expect(title).toBeVisible({ timeout: 5_000 });
      await changeLanguage(page, 'zh');
      // Asserted as "no longer English", like every other case in this file,
      // rather than against a hardcoded translation. The old literal was the
      // JAPANESE for Terms of Service and survived the locale swap unnoticed —
      // a pinned translation is a second copy of the string table, and it goes
      // stale silently (SHY-0289).
      await expect(title).not.toContainText('Terms of Service', { timeout: 5_000 });
      await expect(title).toHaveText(/\S/, { timeout: 5_000 });
    });
  });

  test.describe('Community Guidelines', () => {
    test('title changes when language is set to Vietnamese', async ({ page }) => {
      await page.goto(`${BASE}/community-guidelines.html`);
      const title = page.locator('[data-i18n="cg_title"]');
      await expect(title).toBeVisible({ timeout: 5_000 });
      const englishText = await title.textContent();
      await changeLanguage(page, 'vi');
      const koreanText = await title.textContent();
      expect(koreanText).not.toBe(englishText);
    });
  });

  test.describe('Cyber Bullying Policy', () => {
    // SHY-0502: this page is translated into NO language ShyTalk ships. Every
    // other legal section carries all five; LEGAL_T.cyber carried only ar, de
    // and km, and all three were retired by SHY-0289. Marked fixme rather than
    // deleted: the coverage is right and the PRODUCT is wrong, so this should
    // start passing when the translations land, not quietly disappear.
    test.fixme('title changes when language is set to Thai', async ({ page }) => {
      await page.goto(`${BASE}/cyber-bullying.html`);
      const title = page.locator('[data-i18n="title"]');
      await expect(title).toBeVisible({ timeout: 5_000 });
      const englishText = await title.textContent();
      await changeLanguage(page, 'th');
      const translatedText = await title.textContent();
      expect(translatedText).not.toBe(englishText);
    });
  });

  test.describe('Thai New Year Page', () => {
    test('section headings change when language is set to Thai', async ({ page }) => {
      await page.goto(`${BASE}/events/khmer-new-year.html`);
      const heading = page.locator('[data-i18n="kny_what_h"]');
      await expect(heading).toBeVisible({ timeout: 5_000 });
      const englishText = await heading.textContent();
      await changeLanguage(page, 'th');
      const spanishText = await heading.textContent();
      expect(spanishText).not.toBe(englishText);
    });

    test('tradition descriptions change when language is set to Chinese', async ({ page }) => {
      await page.goto(`${BASE}/events/khmer-new-year.html`);
      const desc = page.locator('[data-i18n="kny_what_p1"]');
      await expect(desc).toBeVisible({ timeout: 5_000 });
      const englishText = await desc.textContent();
      await changeLanguage(page, 'zh');
      const chineseText = await desc.textContent();
      expect(chineseText).not.toBe(englishText);
    });

    test('hero title stays in Thai script regardless of language', async ({ page }) => {
      await page.goto(`${BASE}/events/khmer-new-year.html`);
      const hero = page.locator('h1[lang="km"]');
      await expect(hero).toContainText('សួស្តីឆ្នាំថ្មី');
      await changeLanguage(page, 'id');
      // Hero greeting should stay in Thai for all languages (no data-i18n, always Thai)
      await expect(hero).toContainText('សួស្តីឆ្នាំថ្មី');
    });
  });

  test.describe('Roadmap Page', () => {
    test('content changes when language is set to Thai', async ({ page }) => {
      await page.goto(`${BASE}/roadmap.html`);
      await page.waitForTimeout(2_000);
      await changeLanguage(page, 'th');
      await page.waitForTimeout(1_000);
      const html = await page.locator('body').innerHTML();
      expect(html).toMatch(/[\u0E00-\u0E7F]/);
    });

    test('in-progress section appears at top when items are in progress', async ({ page }) => {
      await page.goto(`${BASE}/roadmap.html`);
      await page.waitForTimeout(3_000);
      const inProgressSection = page.locator('#in-progress-section');
      const count = await inProgressSection.count();
      if (count > 0) {
        await expect(inProgressSection).toBeVisible();
        // Should be the first .phase-card in the container (index 0)
        const firstCard = page.locator('#roadmap-container > .phase-card').first();
        const firstId = await firstCard.getAttribute('id');
        expect(firstId).toBe('in-progress-section');
      }
    });

    test('progress disclaimer is visible', async ({ page }) => {
      await page.goto(`${BASE}/roadmap.html`);
      const disclaimer = page.locator('.stats-disclaimer');
      await expect(disclaimer).toBeVisible({ timeout: 5_000 });
      await expect(disclaimer).toContainText('Progress may go up or down');
    });

    test('progress disclaimer translates when language changes', async ({ page }) => {
      await page.goto(`${BASE}/roadmap.html`);
      const disclaimer = page.locator('.stats-disclaimer');
      await expect(disclaimer).toBeVisible({ timeout: 5_000 });
      const englishText = await disclaimer.textContent();
      await changeLanguage(page, 'th');
      await page.waitForTimeout(1_000);
      const spanishText = await disclaimer.textContent();
      expect(spanishText).not.toBe(englishText);
    });
  });

  test.describe('Language Persistence', () => {
    test('language selection persists across page navigation', async ({ page }) => {
      // Set language on landing page
      await page.goto(BASE);
      await changeLanguage(page, 'vi');
      // Navigate to privacy page
      await page.goto(`${BASE}/privacy.html`);
      // The privacy page should auto-apply Vietnamese
      await page.waitForTimeout(2_000);
      const title = page.locator('[data-i18n="pp_title"]');
      const text = await title.textContent({ timeout: 5_000 }).catch(() => '');
      // Should not be the English "Privacy Policy"
      expect(text).not.toBe('Privacy Policy');
    });
  });
});
