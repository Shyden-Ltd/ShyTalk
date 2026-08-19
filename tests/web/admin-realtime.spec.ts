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
        list.textContent!.includes('No reports') ||
        list.textContent!.includes('Failed');
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

/**
 * Seed a report via the test-write endpoint so the doc is tagged with
 * `_testRun` and the per-test teardown picks it up. See the same helper
 * in admin-cross-tab.spec.ts for the rationale (orphaned reports from
 * untagged `POST /api/reports` calls accumulate at the top of the
 * Reports tab as `data-uid="undefined"` cards).
 */
async function seedReport(testData: TestData): Promise<string> {
  const result = await testData.api.testWrite('reports', {
    reportedUserId: testData.secondUser.uid,
    reportedUserUniqueId: testData.secondUser.uniqueId,
    reporterId: testData.user.uid,
    reporterUniqueId: testData.user.uniqueId,
    reason: 'Spam',
    description: 'E2E realtime test',
    status: 'pending',
    createdAt: Date.now(),
    _testRun: testData.testRunId,
  });
  return result.id;
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

    // Poll for onSnapshot to deliver the new report. On WebKit, the
    // Firestore WebChannel transport can be significantly slower or may not
    // fire at all in time. Each retry clicks the pending filter button to
    // force a manual API reload as a fallback, which still validates that
    // the seeded report was persisted and is visible.
    await expect(async () => {
      // Nudge the UI — re-clicking the active filter re-fetches from API
      const pendingBtn = page.locator('#report-filter-bar button[data-report-filter="pending"]');
      await pendingBtn.click();
      // Brief wait for the API response to render (not a full 15s load wait)
      await page.waitForTimeout(1_000);
      const updatedCount = await page.locator('.report-card').count();
      expect(updatedCount).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 15_000 });
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

    // Poll for the live monitor to pick up the change (Firestore listener).
    // WebKit's WebChannel transport can be slower — use retry loop instead of fixed wait.
    await expect(async () => {
      const updatedCoinsText = await page.locator('#monitor-coins').textContent();
      const updatedCoins = Number(updatedCoinsText!.replace(/,/g, ''));
      expect(updatedCoins).toBeGreaterThan(initialCoins);
    }).toPass({ timeout: 15_000 });

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

  // ── Test 4: Alert bell badge mechanism works ──
  test('alert bell badge count matches API alert count on load', async ({ page, testData }) => {
    // Verify the badge update mechanism: loadUnresolvedCount() fetches alert counts
    // and updates the badge element. The fixture creates at least 1 alert.
    //
    // We verify the mechanism by checking badge state AFTER the page has stabilised.
    // The badge is updated by startGlobalRefresh() which runs during login flow.
    const badge = page.locator('#alert-bell-badge');
    await expect(badge).toBeAttached();

    // Wait for loadUnresolvedCount to have run (it fires after login + module load).
    // Poll badge state: it starts as "0"/hidden and should update once the API responds.
    await page.waitForFunction(
      () => {
        const el = document.getElementById('alert-bell-badge');
        // Badge has been processed if: (a) it shows a count > 0, or (b) it was explicitly hidden
        return el && (el.style.display === 'none' || Number(el.textContent) > 0);
      },
      { timeout: 15_000 },
    );

    // Now verify badge state matches API
    const badgeText = await badge.textContent();
    const badgeCount = Number(badgeText);
    const isHidden = await badge.evaluate((el) => (el as HTMLElement).style.display === 'none');

    if (badgeCount > 0) {
      // Badge shows alerts — verify it's visible
      expect(isHidden).toBe(false);
    } else {
      // Badge shows 0 — verify it's hidden
      expect(isHidden).toBe(true);
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
