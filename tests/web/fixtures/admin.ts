import { test as base, BrowserContext, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/**
 * Worker-scoped fixture that logs in once and shares the authenticated
 * BrowserContext across all tests in the same worker.
 *
 * Firebase Auth stores tokens in IndexedDB, which is per-context —
 * by sharing the context, all pages inherit the authenticated session
 * without re-signing in.
 */
export const test = base.extend<{}, { adminContext: BrowserContext }>({
  adminContext: [async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/admin/');

    // Wait for the page to settle into either the login screen or an already-authenticated dashboard
    const dashboard = page.locator('#dashboard-screen');
    const signInBtn = page.getByRole('button', { name: 'Sign In' });
    await Promise.race([
      dashboard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      signInBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    ]);

    if (!await dashboard.isVisible()) {
      if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required');
      }
      await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
      await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN_PASSWORD);
      await signInBtn.click();
      await expect(dashboard).toBeVisible({ timeout: 30_000 });
    }

    await page.close();
    await use(context);
    await context.close();
  }, { scope: 'worker' }],

  // Override page to open in the shared authenticated context.
  // Clear sessionStorage so the admin panel doesn't restore a heavy tab
  // (like Logs with 4+ API calls) — prevents needless 429s from the rate limiter.
  page: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await page.addInitScript(() => sessionStorage.clear());
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
