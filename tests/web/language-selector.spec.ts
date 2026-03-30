import { test, expect } from '@playwright/test';

/**
 * Language selector tests.
 * Verifies the shared language selector works across pages.
 */

test.describe('Language Selector', () => {
  test('globe button is visible on homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.stl-lang-btn')).toBeVisible();
  });

  test('globe button is visible on roadmap', async ({ page }) => {
    await page.goto('/roadmap.html');
    await expect(page.locator('.stl-lang-btn')).toBeVisible();
  });

  test('clicking globe opens language modal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    await expect(page.locator('.stl-lang-overlay')).toHaveClass(/open/);
    await expect(page.locator('.stl-lang-search')).toBeFocused();
  });

  test('modal shows all 20 languages', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    const items = page.locator('.stl-lang-item');
    await expect(items).toHaveCount(20);
  });

  test('search filters languages', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    await page.locator('.stl-lang-search').fill('Viet');
    const items = page.locator('.stl-lang-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Tiếng Việt');
  });

  test('selecting a language closes modal and updates page', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    await page.locator('.stl-lang-item[data-lang="es"]').click();
    await expect(page.locator('.stl-lang-overlay')).not.toHaveClass(/open/);
    // Homepage tagline should be in Spanish
    await expect(page.locator('[data-i18n="tagline"]')).toContainText('reinventadas');
  });

  test('language persists across page navigation', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    await page.locator('.stl-lang-item[data-lang="fr"]').click();
    // Navigate to roadmap
    await page.goto('/roadmap.html');
    // Should still be French
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('fr');
  });

  test('escape key closes modal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    await expect(page.locator('.stl-lang-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.stl-lang-overlay')).not.toHaveClass(/open/);
  });

  test('close button closes modal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    await page.locator('.stl-lang-close').click();
    await expect(page.locator('.stl-lang-overlay')).not.toHaveClass(/open/);
  });

  test('current language is highlighted in modal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    const englishItem = page.locator('.stl-lang-item[data-lang="en"]');
    await expect(englishItem).toHaveClass(/active/);
  });

  test('keyboard navigation works in language list', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stl-lang-btn').click();
    // Arrow down from search to first item
    await page.keyboard.press('ArrowDown');
    const firstItem = page.locator('.stl-lang-item').first();
    await expect(firstItem).toBeFocused();
  });

  test('globe button has aria-label for accessibility', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('.stl-lang-btn');
    await expect(btn).toHaveAttribute('aria-label', 'Change language');
  });

  test('modal has proper aria attributes', async ({ page }) => {
    await page.goto('/');
    const overlay = page.locator('.stl-lang-overlay');
    await expect(overlay).toHaveAttribute('role', 'dialog');
    await expect(overlay).toHaveAttribute('aria-modal', 'true');
  });
});
