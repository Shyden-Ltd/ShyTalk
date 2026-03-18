import { Page, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/**
 * Sign into the admin panel. When used with the shared admin fixture,
 * Firebase Auth tokens persist in IndexedDB across pages in the same
 * BrowserContext — so this usually just waits for auto-login.
 */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto('/admin/');

  // Wait for the page to settle — Firebase Auth may auto-sign-in from IndexedDB
  const dashboard = page.locator('#dashboard-screen');
  const signInBtn = page.getByRole('button', { name: 'Sign In' });
  await Promise.race([
    dashboard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    signInBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
  ]);

  // Already authenticated (shared context with IndexedDB tokens)
  if (await dashboard.isVisible()) return;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required');
  }

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
 * Retries the search once if the backend doesn't respond in time —
 * the dev API on Oracle Cloud free tier intermittently drops requests.
 */
export async function searchUser(page: Page, uniqueId: string): Promise<void> {
  const apiResponses: string[] = [];
  const networkErrors: string[] = [];
  const consoleErrors: string[] = [];
  const onResponse = (response: any) => {
    const url: string = response.url();
    if (url.includes('/api/')) {
      apiResponses.push(`${response.status()} ${url.split('/api/')[1]}`);
    }
  };
  const onRequestFailed = (request: any) => {
    networkErrors.push(`${request.failure()?.errorText}: ${request.url()}`);
  };
  const onConsoleError = (msg: any) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  page.on('console', onConsoleError);

  const subtab = page.locator('.user-subtab[data-subtab="profile"]');
  const searchBtn = page.getByRole('button', { name: 'Search' });

  async function doSearch(): Promise<boolean> {
    await page.getByRole('spinbutton', { name: 'ShyTalk User ID' }).fill(uniqueId);
    await searchBtn.click();
    try {
      await expect(subtab).toBeVisible({ timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  try {
    // First attempt
    if (await doSearch()) return;

    // Retry once — transient backend failures are common on dev
    const firstAttemptDiag = {
      api: [...apiResponses],
      net: [...networkErrors],
      console: [...consoleErrors],
    };
    apiResponses.length = 0;
    networkErrors.length = 0;
    consoleErrors.length = 0;
    if (await doSearch()) return;

    // Both attempts failed — build a full diagnostic message
    const lines: string[] = [`User search failed after 2 attempts (user ${uniqueId})`];
    lines.push(`  Attempt 1: API=[${firstAttemptDiag.api.join('; ')}] Net=[${firstAttemptDiag.net.join('; ')}] Console=[${firstAttemptDiag.console.join('; ')}]`);
    lines.push(`  Attempt 2: API=[${apiResponses.join('; ')}] Net=[${networkErrors.join('; ')}] Console=[${consoleErrors.join('; ')}]`);
    throw new Error(lines.join('\n'));
  } finally {
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
    page.off('console', onConsoleError);
  }
}

/**
 * Switch to a user subtab.
 */
export async function switchUserSubtab(page: Page, subtab: string): Promise<void> {
  const btn = page.locator(`.user-subtab[data-subtab="${subtab}"]`);
  await btn.click();
  await expect(btn).toHaveClass(/active/);
}
