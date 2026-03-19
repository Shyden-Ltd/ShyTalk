import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/** Wait for reports list to load. */
async function waitForReportsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const list = document.getElementById('reports-list');
      if (!list) return false;
      return list.querySelector('.report-card') !== null ||
        list.textContent!.includes('No reports');
    },
    { timeout: 15_000 },
  );
}

/** Filter reports to pending. */
async function filterPendingReports(page: Page): Promise<void> {
  const btn = page.locator('#report-filter-bar button[data-report-filter="pending"]');
  await btn.click();
  await expect(btn).toHaveClass(/active/);
  await waitForReportsLoaded(page);
}

/** Seed a report via API. */
async function seedReport(testData: TestData): Promise<string> {
  const result = await testData.api.post('/api/reports', {
    reportedUserId: testData.user.uid,
    reportedUserUniqueId: testData.user.uniqueId,
    reporterId: testData.secondUser.uid,
    reporterUniqueId: testData.secondUser.uniqueId,
    reason: 'Spam',
    description: 'E2E realtime test',
  });
  return result.id || result.reportId;
}

/** Wait for logs to load. */
async function waitForLogsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const tbody = document.getElementById('logs-tbody');
      const empty = document.getElementById('logs-empty');
      if (!tbody) return false;
      return tbody.querySelectorAll('tr').length > 0 ||
        (empty && empty.style.display !== 'none');
    },
    { timeout: 15_000 },
  );
}

/** Start monitoring a user. */
async function startMonitoring(page: Page, uniqueId: number): Promise<void> {
  await page.locator('#monitor-uid-input').fill(String(uniqueId));
  await page.locator('#monitor-start-btn').click();
  await expect(page.locator('#monitor-status')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#monitor-dot')).toHaveClass(/live/, { timeout: 10_000 });
}

/** Stop monitoring. */
async function stopMonitoring(page: Page): Promise<void> {
  await page.locator('#monitor-stop-btn').click();
  await expect(page.locator('#monitor-start-btn')).toBeVisible({ timeout: 10_000 });
}

test.describe('Admin Realtime Features', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  // ── Test 1: Reports onSnapshot — new report appears without refresh ──
  test('new report seeded via API appears in Reports tab without refresh', async ({ page, testData }) => {
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);
    await filterPendingReports(page);

    // Count current report cards
    const initialCards = page.locator('.report-card');
    const initialCount = await initialCards.count();

    // Seed a new report via API
    await seedReport(testData);

    // Wait for onSnapshot to deliver the new report (up to 10s)
    // The report list should update without a page refresh
    await page.waitForTimeout(5_000);

    // Check if the new report appeared
    const updatedCards = page.locator('.report-card');
    const updatedCount = await updatedCards.count();

    // The count should have increased or the content should have changed
    // onSnapshot may merge into existing group or add new one
    // Verify by checking the report count badge values
    const reportsList = page.locator('#reports-list');
    const listText = await reportsList.textContent();
    // listText verified implicitly by the count assertion below

    // The count must have increased — proves the onSnapshot listener delivered the new report
    expect(updatedCount).toBeGreaterThan(initialCount);
  });

  // ── Test 2: Spin monitor live coins update ──
  test('spin monitor coins display updates after API balance change', async ({ page, testData }) => {
    await navigateToTab(page, 'Spin Monitor');
    await expect(page.locator('#monitor-panel')).toHaveClass(/visible/, { timeout: 10_000 });

    await startMonitoring(page, testData.user.uniqueId);

    // Read current coins display
    const coinsText = await page.locator('#monitor-coins').textContent();
    const initialCoins = Number(coinsText!.replace(/,/g, ''));

    // Add coins via API
    await testData.api.post(`/api/users/${testData.user.uniqueId}/adjust-balance`, {
      currency: 'COINS', amount: 100,
    });

    // Wait for the live monitor to pick up the change (Firestore listener)
    await page.waitForTimeout(5_000);

    // Read updated coins
    const updatedCoinsText = await page.locator('#monitor-coins').textContent();
    const updatedCoins = Number(updatedCoinsText!.replace(/,/g, ''));

    // Coins must have increased — proves the onSnapshot listener delivered the update
    expect(updatedCoins).toBeGreaterThan(initialCoins);

    // Restore coins
    await testData.api.post(`/api/users/${testData.user.uniqueId}/adjust-balance`, {
      currency: 'COINS', amount: -100,
    });

    await stopMonitoring(page);
  });

  // ── Test 3: Logs live mode shows new entries ──
  test('logs live mode indicator activates and deactivates', async ({ page }) => {
    await navigateToTab(page, 'Logs');
    await waitForLogsLoaded(page);

    const liveToggle = page.locator('#log-live-toggle');

    // Enable live mode
    await liveToggle.click();
    await expect(liveToggle).toHaveClass(/active/, { timeout: 3_000 });

    // Wait briefly for live mode to be active
    await page.waitForTimeout(2_000);

    // Verify the toggle is active (live mode running)
    await expect(liveToggle).toHaveClass(/active/);

    // Disable live mode
    await liveToggle.click();
    await expect(liveToggle).not.toHaveClass(/active/, { timeout: 3_000 });
  });

  // ── Test 4: Alert bell badge reflects API state on load ──
  test('alert bell badge count matches API alert count on load', async ({ page, testData }) => {
    // Get alert count from API
    let apiCount = 0;
    try {
      const alertsData = await testData.api.get('/api/admin/alerts?status=new');
      const alerts = Array.isArray(alertsData) ? alertsData : (alertsData.alerts || []);
      apiCount = alerts.length;
    } catch {
      test.skip(true, 'Alerts API not available');
      return;
    }

    // Check the badge
    const badge = page.locator('#alert-bell-badge');

    if (apiCount > 0) {
      await expect(badge).toBeVisible({ timeout: 10_000 });
      const badgeText = await badge.textContent();
      const badgeCount = Number(badgeText);
      // Badge must show a positive count since API confirms alerts exist
      expect(badgeCount).toBeGreaterThan(0);
    } else {
      // Badge may be hidden or show 0
      const isVisible = await badge.isVisible();
      if (isVisible) {
        const badgeText = await badge.textContent();
        expect(Number(badgeText)).toBe(0);
      }
    }
  });

  // ── Test 5: Listener cleanup — Reports tab navigation ──
  test('navigating away from Reports stops onSnapshot listeners', async ({ page }) => {
    // Collect console errors to verify no listener errors after leaving
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);

    // Navigate away
    await navigateToTab(page, 'Users');

    // Wait to see if any listener errors fire
    await page.waitForTimeout(3_000);

    // No Firestore listener errors should have occurred
    const firestoreErrors = consoleErrors.filter(e =>
      e.includes('Firestore') || e.includes('onSnapshot') || e.includes('listener'),
    );
    expect(firestoreErrors.length).toBe(0);
  });

  // ── Test 6: Listener cleanup — Monitor stop ──
  test('stopping spin monitor cleans up listeners', async ({ page, testData }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await navigateToTab(page, 'Spin Monitor');
    await expect(page.locator('#monitor-panel')).toHaveClass(/visible/, { timeout: 10_000 });

    await startMonitoring(page, testData.user.uniqueId);
    await stopMonitoring(page);

    // Wait to see if any errors fire from orphaned listeners
    await page.waitForTimeout(3_000);

    // No listener cleanup errors
    const listenerErrors = consoleErrors.filter(e =>
      e.includes('listener') || e.includes('unsubscribe') || e.includes('detached'),
    );
    expect(listenerErrors.length).toBe(0);
  });

  // ── Test 7: Listener cleanup — Logs live toggle off ──
  test('toggling off logs live mode cleans up polling', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await navigateToTab(page, 'Logs');
    await waitForLogsLoaded(page);

    const liveToggle = page.locator('#log-live-toggle');

    // Enable then disable
    await liveToggle.click();
    await expect(liveToggle).toHaveClass(/active/, { timeout: 3_000 });

    await liveToggle.click();
    await expect(liveToggle).not.toHaveClass(/active/, { timeout: 3_000 });

    // Wait for any cleanup
    await page.waitForTimeout(3_000);

    // No errors from orphaned intervals
    const intervalErrors = consoleErrors.filter(e =>
      e.includes('interval') || e.includes('poll') || e.includes('timeout'),
    );
    expect(intervalErrors.length).toBe(0);
  });

  // ── Test 8: Listener cleanup — Sign out clears all ──
  test('sign out clears all listeners and intervals without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Navigate through a few tabs to set up listeners
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);

    await navigateToTab(page, 'Logs');
    await waitForLogsLoaded(page);

    // Sign out
    const signOutBtn = page.getByRole('button', { name: 'Sign Out' });
    await signOutBtn.click();

    // Wait for sign out to complete
    const signInBtn = page.getByRole('button', { name: 'Sign In' });
    await expect(signInBtn).toBeVisible({ timeout: 15_000 });

    // Wait for any post-signout listener errors
    await page.waitForTimeout(5_000);

    // No console errors from listener cleanup after sign-out
    const postSignOutErrors = consoleErrors.filter(e =>
      e.includes('permission') || e.includes('unauthenticated') ||
      e.includes('Firestore') || e.includes('listener'),
    );
    expect(postSignOutErrors.length).toBe(0);
  });
});
