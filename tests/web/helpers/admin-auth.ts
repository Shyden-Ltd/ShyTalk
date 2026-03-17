import { Page, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

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
  await expect(signInBtn).toBeVisible({ timeout: 10_000 });

  await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN_PASSWORD);
  await signInBtn.click();

  await expect(dashboard).toBeVisible({ timeout: 30_000 });
}

/**
 * Navigate to the admin panel (assumes already signed in within this context).
 */
export async function goToAdmin(page: Page): Promise<void> {
  await page.goto('/admin/');
  await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate to a specific tab.
 */
export async function navigateToTab(page: Page, tabName: string): Promise<void> {
  const tabBtn = page.getByRole('button', { name: tabName, exact: true });
  await tabBtn.click();
  await expect(tabBtn).toHaveClass(/active/);
}

/**
 * Search for a user by unique ID and wait for profile data to load.
 * Monitors API responses to fail fast on backend errors instead of timing out.
 */
export async function searchUser(page: Page, uniqueId: string): Promise<void> {
  // Monitor for API errors during search
  const apiErrors: string[] = [];
  const errorHandler = (response: any) => {
    if (response.status() >= 500) {
      apiErrors.push(`${response.status()}: ${response.url()}`);
    }
  };
  page.on('response', errorHandler);

  const searchInput = page.getByRole('spinbutton', { name: 'ShyTalk User ID' });
  await searchInput.fill(uniqueId);
  await page.getByRole('button', { name: 'Search' }).click();

  try {
    await expect(page.locator('.user-subtab[data-subtab="profile"]')).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    // If search timed out, report any API errors that might explain why
    if (apiErrors.length > 0) {
      throw new Error(`User search failed — backend API errors:\n${apiErrors.join('\n')}`);
    }
    throw err;
  } finally {
    page.off('response', errorHandler);
  }

  await page.waitForTimeout(500);
}

/**
 * Switch to a user subtab.
 */
export async function switchUserSubtab(page: Page, subtab: string): Promise<void> {
  const btn = page.locator(`.user-subtab[data-subtab="${subtab}"]`);
  await btn.click();
  await expect(btn).toHaveClass(/active/);
}
