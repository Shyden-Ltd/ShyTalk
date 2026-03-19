import { test as base, BrowserContext, expect } from '@playwright/test';
import { AdminApi, SetupResult } from '../helpers/api';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export interface TestData {
  testRunId: string;
  prefix: string;
  user: { uid: string; uniqueId: number; displayName: string };
  secondUser: { uid: string; uniqueId: number; displayName: string };
  gift: { id: string; name: string; coinValue: number };
  banner: { id: string; title: string };
  funFact: { id: string; text: string };
  report: { id: string; reportedUserId: string; reporterId: string };
  appeal: { id: string };
  alert: { id: string };
  conversation: { id: string };
  economyConfig: Record<string, any>;
  api: AdminApi;
}

export const test = base.extend<{}, { adminContext: BrowserContext; testData: TestData }>({
  adminContext: [async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/admin/');
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

  testData: [async ({ adminContext }, use, workerInfo) => {
    const page = await adminContext.newPage();
    const api = new AdminApi(page);
    let testRunId: string | undefined;

    try {
      // Register token interceptor BEFORE navigating — otherwise the
      // admin panel's initial API calls fire before the listener is attached
      await page.goto('/admin/');
      await page.locator('#dashboard-screen').waitFor({ state: 'visible', timeout: 15_000 });
      await api.waitForToken();

      const prefix = `${workerInfo.project.name}-w${workerInfo.workerIndex}`;
      const result: SetupResult = await api.testSetup({
        users: [
          {
            name: `e2e-${prefix}-user`,
            shyCoins: 1000,
            shyBeans: 500,
            deviceInfo: {
              deviceId: `e2e-${prefix}-device`,
              manufacturer: 'Google',
              model: 'Pixel 6',
              lastIp: '203.0.113.1',
              isp: 'Test ISP',
            },
          },
          {
            name: `e2e-${prefix}-user2`,
            shyCoins: 500,
            shyBeans: 250,
          },
        ],
        banners: [{ title: `e2e-${prefix}-banner` }],
        funFacts: [{ text: `e2e-${prefix}-fact`, category: 'Science', emoji: '🔬' }],
        conversations: [{
          participants: ['placeholder'],
          messages: [{ text: 'test message', senderId: 'placeholder' }],
        }],
        reports: [{ reportedUserIndex: 0, reporterUserIndex: 1, reason: 'Spam', conversationIndex: 0 }],
        appeals: [{ userIndex: 0, appealText: 'I did not do this' }],
        alerts: [{ type: 'error_rate', severity: 'high', message: `e2e-${prefix}-alert` }],
      });
      testRunId = result.testRunId;

      await use({
        testRunId: result.testRunId,
        prefix,
        user: result.users[0],
        secondUser: result.users[1],
        gift: result.gifts?.[0] || { id: '', name: '', coinValue: 0 },
        banner: result.banners?.[0] || { id: '', title: '' },
        funFact: result.funFacts?.[0] || { id: '', text: '' },
        report: result.reports?.[0] || { id: '', reportedUserId: '', reporterId: '' },
        appeal: result.appeals?.[0] || { id: '' },
        alert: result.alerts?.[0] || { id: '' },
        conversation: result.conversations?.[0] || { id: '' },
        economyConfig: result.economyConfig || {},
        api,
      });
    } finally {
      // Cleanup — always runs even if setup or tests throw
      if (testRunId) {
        await api.testTeardown(testRunId).catch((err) => {
          console.warn(`[fixture] Teardown failed for ${testRunId}: ${err.message}`);
        });
      }
      await page.close();
    }
  }, { scope: 'worker' }],

  // Override page: open in shared context, clear sessionStorage
  page: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await page.addInitScript(() => sessionStorage.clear());
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
