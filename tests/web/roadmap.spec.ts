import { test, expect } from '@playwright/test';

/**
 * Roadmap page tests.
 *
 * Verifies the public roadmap page loads correctly, renders features
 * from roadmap-data.json, and handles edge cases.
 */

test.describe('Roadmap Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  // ── Loading & Structure ──

  test('page loads with title', async ({ page }) => {
    await expect(page).toHaveTitle(/ShyTalk.*Roadmap/i);
  });

  test('intro screen is visible on load', async ({ page }) => {
    const intro = page.locator('.intro-screen');
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('codebase');
  });

  test('logo screen shows ShyTalk branding', async ({ page }) => {
    const logo = page.locator('.logo-text');
    await expect(logo).toContainText('SHYTALK');
  });

  test('subtitle shows The Roadmap Awakens', async ({ page }) => {
    const sub = page.locator('.logo-sub');
    await expect(sub).toContainText('Roadmap Awakens');
  });

  // ── Roadmap data rendering ──

  test('renders at least one phase section', async ({ page }) => {
    const sections = page.locator('.crawl-section');
    await expect(sections.first()).toBeVisible({ timeout: 10_000 });
    const count = await sections.count();
    // Episode intro + at least 2 feature phases
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('renders feature cards with names', async ({ page }) => {
    const features = page.locator('.crawl-feature h3');
    await expect(features.first()).toBeVisible({ timeout: 10_000 });
    const count = await features.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('each feature has a status badge', async ({ page }) => {
    await page.locator('.crawl-feature').first().waitFor({ timeout: 10_000 });
    const features = page.locator('.crawl-feature');
    const count = await features.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const badge = features.nth(i).locator('.feat-badge');
      await expect(badge).toBeVisible();
    }
  });

  test('Account Deletion shows as DONE', async ({ page }) => {
    await page.locator('.crawl-feature').first().waitFor({ timeout: 10_000 });
    const deletionFeature = page.locator('.crawl-feature', { hasText: 'Account Deletion' });
    await expect(deletionFeature).toBeVisible();
    const badge = deletionFeature.locator('.feat-badge');
    await expect(badge).toHaveClass(/feat-done/);
  });

  test('phase sections have status indicators', async ({ page }) => {
    await page.locator('.section-status').first().waitFor({ timeout: 10_000 });
    const statuses = page.locator('.section-status');
    const count = await statuses.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // ── Last updated ──

  test('shows last updated date in footer', async ({ page }) => {
    const lastUpdated = page.locator('#last-updated');
    await expect(lastUpdated).toContainText(/\d{4}-\d{2}-\d{2}/, { timeout: 10_000 });
  });

  // ── Footer ──

  test('footer shows Shyden Ltd branding', async ({ page }) => {
    const footer = page.locator('.crawl-footer');
    await expect(footer).toContainText('Shyden Ltd');
  });

  // ── No internal details exposed ──

  test('does not expose PR numbers', async ({ page }) => {
    await page.locator('.crawl-feature').first().waitFor({ timeout: 10_000 });
    const body = await page.locator('.crawl-content').textContent();
    expect(body).not.toMatch(/PR\s*#\d+/);
  });

  test('does not expose file paths', async ({ page }) => {
    await page.locator('.crawl-feature').first().waitFor({ timeout: 10_000 });
    const body = await page.locator('.crawl-content').textContent();
    expect(body).not.toMatch(/\.project\//);
    expect(body).not.toMatch(/express-api\//);
  });

  test('does not expose SonarCloud or internal tooling', async ({ page }) => {
    await page.locator('.crawl-feature').first().waitFor({ timeout: 10_000 });
    const body = await page.locator('.crawl-content').textContent();
    expect(body).not.toMatch(/SonarCloud/i);
    expect(body).not.toMatch(/ktlint/i);
    expect(body).not.toMatch(/OnPush/i);
  });

  // ── Music button ──

  test('music button is visible', async ({ page }) => {
    const btn = page.locator('#musicBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(/Play/i);
  });

  // ── Star canvas ──

  test('star canvas is present', async ({ page }) => {
    const canvas = page.locator('#stars');
    await expect(canvas).toBeAttached();
  });

  // ── Scroll hint ──

  test('scroll hint is visible initially', async ({ page }) => {
    const hint = page.locator('#scrollHint');
    await expect(hint).toBeVisible();
  });

  // ── Error handling ──

  test('shows fallback message when JSON fails to load', async ({ page }) => {
    await page.route('**/roadmap-data.json', (route) => route.abort());
    await page.goto('/roadmap.html');
    const fallback = page.locator('.loading-msg');
    await expect(fallback).toBeVisible({ timeout: 10_000 });
    await expect(fallback).toContainText(/GitHub/i);
  });
});
