import { test, expect } from '@playwright/test';

/**
 * Homepage roadmap CTA tests.
 * Verifies the roadmap call-to-action is visible and links correctly.
 */

test.describe('Homepage Roadmap CTA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('roadmap CTA button is visible', async ({ page }) => {
    const cta = page.locator('.roadmap-cta');
    await expect(cta).toBeVisible();
  });

  test('roadmap CTA links to /roadmap.html', async ({ page }) => {
    const cta = page.locator('.roadmap-cta');
    await expect(cta).toHaveAttribute('href', '/roadmap.html');
  });

  test('roadmap CTA has descriptive text', async ({ page }) => {
    const cta = page.locator('.roadmap-cta');
    await expect(cta).toContainText(/coming|roadmap/i);
  });

  test('roadmap label is visible below CTA', async ({ page }) => {
    const label = page.locator('.roadmap-label');
    await expect(label).toBeVisible();
    await expect(label).toContainText(/roadmap/i);
  });

  test('clicking CTA navigates to roadmap page', async ({ page }) => {
    await page.locator('.roadmap-cta').click();
    await expect(page).toHaveURL(/roadmap/);
    await expect(page).toHaveTitle(/Roadmap/i);
  });
});
