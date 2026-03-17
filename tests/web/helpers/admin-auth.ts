import { Page, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// CI runners (US) calling dev API (London) need generous timeouts
const CI_TIMEOUT = 60_000;

/**
 * Sign into the admin panel. Firebase Auth uses IndexedDB so storageState
 * doesn't persist sessions — we must sign in per browser context.
 */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto('/admin/');

  // Check if already signed in
  const dashboard = page.locator('#dashboard-screen');
  const isVisible = await dashboard.isVisible().catch(() => false);
  if (isVisible) return;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required');
  }

  const signInBtn = page.getByRole('button', { name: 'Sign In' });
  await expect(signInBtn).toBeVisible({ timeout: 15_000 });

  await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN_PASSWORD);
  await signInBtn.click();

  await expect(dashboard).toBeVisible({ timeout: CI_TIMEOUT });
}

/**
 * Navigate to the admin panel (assumes already signed in within this context).
 */
export async function goToAdmin(page: Page): Promise<void> {
  await page.goto('/admin/');
  await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: CI_TIMEOUT });
}

/**
 * Navigate to a specific tab and wait for its panel to be visible.
 */
export async function navigateToTab(page: Page, tabName: string): Promise<void> {
  const tabBtn = page.getByRole('button', { name: tabName, exact: true });
  await tabBtn.click();
  await expect(tabBtn).toHaveClass(/active/, { timeout: 10_000 });
  // Wait for any API calls triggered by tab switch to settle
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Search for a user by unique ID and wait for profile data to load.
 */
export async function searchUser(page: Page, uniqueId: string): Promise<void> {
  const searchInput = page.getByRole('spinbutton', { name: 'ShyTalk User ID' });
  await searchInput.fill(uniqueId);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.user-subtab[data-subtab="profile"]')).toBeVisible({ timeout: CI_TIMEOUT });
  // Wait for user data API responses to complete
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Switch to a user subtab and wait for content to load.
 */
export async function switchUserSubtab(page: Page, subtab: string): Promise<void> {
  const btn = page.locator(`.user-subtab[data-subtab="${subtab}"]`);
  await btn.click();
  await expect(btn).toHaveClass(/active/, { timeout: 10_000 });
  // Wait for subtab API calls to complete (e.g., auth-status for security tab)
  await page.waitForLoadState('networkidle').catch(() => {});
}
