import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads and displays app name in title', async ({ page }) => {
    await expect(page).toHaveTitle(/ShyTalk/i);
  });

  test('displays ShyTalk logo', async ({ page }) => {
    const logo = page.locator('.logo');
    await expect(logo).toBeVisible();
    await expect(logo).toContainText('ShyTalk');
  });

  test('displays tagline', async ({ page }) => {
    const tagline = page.locator('.tagline');
    await expect(tagline).toBeVisible();
    await expect(tagline).toContainText('Voice chat rooms');
  });

  test('displays Coming Soon badge', async ({ page }) => {
    const badge = page.locator('.badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Coming Soon');
  });

  test('has Google Play Store link', async ({ page }) => {
    const playLink = page.locator('a[href*="play.google.com"]');
    await expect(playLink).toBeVisible();
    await expect(playLink).toContainText('Google Play');
  });

  test('has App Store coming soon placeholder', async ({ page }) => {
    const appStoreLink = page.locator('.coming-soon-link');
    await expect(appStoreLink).toBeVisible();
    await expect(appStoreLink).toContainText('App Store');
  });

  test('has Privacy Policy link', async ({ page }) => {
    const link = page.locator('a[href="/privacy.html"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Privacy Policy');
  });

  test('has Terms of Service link', async ({ page }) => {
    const link = page.locator('a[href="/terms.html"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Terms of Service');
  });

  test('has Community Guidelines link', async ({ page }) => {
    const link = page.locator('a[href="/community-guidelines.html"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Community Guidelines');
  });

  test('has Cyber Bullying Policy link', async ({ page }) => {
    const link = page.locator('a[href="/cyber-bullying.html"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Cyber Bullying Policy');
  });

  test('footer links navigate to correct pages', async ({ page }) => {
    await page.locator('a[href="/privacy.html"]').click();
    await expect(page).toHaveTitle(/Privacy/i);
  });

  test('has i18n data attributes for translatable content', async ({ page }) => {
    const tagline = page.locator('[data-i18n="tagline"]');
    await expect(tagline).toBeVisible();
    const comingSoon = page.locator('[data-i18n="coming_soon"]');
    await expect(comingSoon).toBeVisible();
  });

  test('loads logger script', async ({ page }) => {
    const loggerLoaded = await page.evaluate(() => typeof (window as any).ShyTalkLogger !== 'undefined');
    expect(loggerLoaded).toBe(true);
  });

  test('has correct viewport meta tag', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('has Shyden Ltd copyright footer', async ({ page }) => {
    const copyright = page.locator('.copyright');
    await expect(copyright).toBeVisible();
    await expect(copyright).toContainText('© 2026 Shyden Ltd. All rights reserved.');
  });
});
