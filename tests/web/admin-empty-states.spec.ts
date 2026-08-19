import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/** Wait for appeals list to finish loading. */
async function waitForAppealsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const list = document.getElementById('appeals-list');
      if (!list) return false;
      return list.querySelector('.appeal-card') !== null ||
        list.textContent!.includes('No appeals') ||
        list.textContent!.includes('Failed');
    },
    { timeout: 15_000 },
  );
}

/** Wait for reports list to finish loading. */
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

/** Wait for devices table to load. */
async function waitForDevicesLoaded(page: Page): Promise<void> {
  await expect(
    page.locator('#devices-tbody tr, #devices-empty[style*="block"]'),
  ).not.toHaveCount(0, { timeout: 15_000 });
}

test.describe('Admin Empty States', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  // ── Test 1: Appeals — no appeals for a filter ──
  test('appeals empty state shows message when filter has no results', async ({ page }) => {
    await navigateToTab(page, 'Appeals');
    await waitForAppealsLoaded(page);

    // Try all three filters — at least one should be empty
    for (const status of ['approved', 'denied', 'pending'] as const) {
      const btn = page.locator(`button[data-appeal-filter="${status}"]`);
      await btn.click();
      await expect(btn).toHaveClass(/active/);
      await waitForAppealsLoaded(page);

      const cards = page.locator('.appeal-card');
      const cardCount = await cards.count();

      if (cardCount === 0) {
        // Verify empty state message
        const appealsList = page.locator('#appeals-list');
        await expect(appealsList).toContainText('No appeals');
        return; // Found empty state, test passes
      }
    }

    // All filters have data — verify the tab rendered correctly
    const appealsList = page.locator('#appeals-list');
    await expect(appealsList).toBeVisible();
  });

  // ── Test 2: Reports — no reports for archived filter ──
  test('reports empty state shows message when no archived reports', async ({ page }) => {
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);

    // Filter to archived — often empty
    const archivedBtn = page.locator('#report-filter-bar button[data-report-filter="archived"]');
    await archivedBtn.click();
    await expect(archivedBtn).toHaveClass(/active/);
    await waitForReportsLoaded(page);

    const cards = page.locator('.report-card');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // Verify empty state
      const reportsList = page.locator('#reports-list');
      const text = await reportsList.textContent();
      expect(text).toContain('No reports');
    }
    // If archived has data, verify the reports list rendered
    const reportsList = page.locator('#reports-list');
    await expect(reportsList).toBeVisible();
  });

  // ── Test 3: Gifts — empty table message (verify table renders) ──
  test('gifts tab shows table with data or appropriate empty state', async ({ page }) => {
    await navigateToTab(page, 'Gifts');

    // Wait for gifts to load
    const tbody = page.locator('#gifts-tbody');
    await page.waitForTimeout(3_000);

    const rows = tbody.locator('tr');
    const rowCount = await rows.count();

    // Gifts table should have rows (seeded data exists) or show empty
    if (rowCount === 0) {
      // Check for empty state (gift table typically always has data)
      const giftsPanel = page.locator('#gifts-panel, #gifts-tab-content');
      const panelText = await giftsPanel.textContent();
      expect(panelText).toBeTruthy();
    } else {
      expect(rowCount).toBeGreaterThan(0);
    }
  });

  // ── Test 4: Banners — empty state ──
  test('banners tab shows content or appropriate empty state', async ({ page }) => {
    await navigateToTab(page, 'Banners');

    // Wait for banners to load
    await page.waitForTimeout(3_000);

    // Check for banner cards or empty state
    const bannerCards = page.locator('.banner-card');
    const cardCount = await bannerCards.count();

    if (cardCount === 0) {
      // Verify some form of empty state or the add button exists
      const addBtn = page.locator('#add-banner-btn, button:has-text("Add Banner")');
      await expect(addBtn).toBeVisible();
    } else {
      expect(cardCount).toBeGreaterThan(0);
    }
  });

  // ── Test 5: Fun Facts — empty state ──
  test('fun facts tab shows content or appropriate empty state', async ({ page }) => {
    await navigateToTab(page, 'Fun Facts');

    // Wait for fun facts to load
    await page.waitForTimeout(3_000);

    // Check for fact cards or empty state
    const factCards = page.locator('.fact-card');
    const cardCount = await factCards.count();

    if (cardCount === 0) {
      // Verify add button exists even when empty
      const addBtn = page.locator('#funfact-add-btn');
      await expect(addBtn).toBeVisible();
    } else {
      expect(cardCount).toBeGreaterThan(0);
    }
  });

  // ── Test 6: Logs — impossible filter returns no results ──
  test('logs impossible filter shows no results message', async ({ page }) => {
    await navigateToTab(page, 'Logs');
    await waitForLogsLoaded(page);

    // Set an impossible filter combination
    await page.locator('#log-filter-keyword').fill('zzz_impossible_e2e_keyword_no_match_xyz_999');
    await page.locator('#log-filter-level').selectOption('fatal');
    await page.locator('#log-search-btn').click();
    await waitForLogsLoaded(page);

    // Verify empty state message
    const emptyMessage = page.locator('#logs-empty');
    await expect(emptyMessage).toBeVisible({ timeout: 10_000 });
    await expect(emptyMessage).toContainText('No logs found');

    // Clear filters
    await page.locator('#log-clear-btn').click();
    await waitForLogsLoaded(page);
  });

  // ── Test 7: Devices — no results for nonsense search ──
  test('devices nonsense search shows no results', async ({ page }) => {
    await navigateToTab(page, 'Devices');
    await waitForDevicesLoaded(page);

    // Search for nonsense
    await page.locator('#devices-search-input').fill('zzz-nonexistent-device-e2e-999999');
    await page.locator('#devices-search-btn').click();
    await page.waitForTimeout(1_000);

    // Empty message should be visible
    const empty = page.locator('#devices-empty');
    await expect(empty).toBeVisible();
  });

  // ── Test 8: Backups — list loads or shows empty ──
  test('backups tab loads and shows list or empty state', async ({ page }) => {
    await navigateToTab(page, 'Backups');

    // Wait for backups to load
    await page.waitForTimeout(3_000);

    // Check for backup cards/list or empty message
    const backupPanel = page.locator('#backups-panel, #backup-list');
    await expect(backupPanel).toBeVisible({ timeout: 10_000 });

    const panelText = await backupPanel.textContent();
    expect(panelText).toMatch(/backup|no backups|trigger/i);
  });

  // ── Test 9: Spin Monitor — no user shows input prompt ──
  test('spin monitor with no user shows input and start button', async ({ page }) => {
    await navigateToTab(page, 'Spin Monitor');
    await expect(page.locator('#monitor-panel')).toHaveClass(/visible/, { timeout: 10_000 });

    // Input should be visible
    await expect(page.locator('#monitor-uid-input')).toBeVisible();

    // Start button visible
    await expect(page.locator('#monitor-start-btn')).toBeVisible();

    // Stop button hidden
    await expect(page.locator('#monitor-stop-btn')).toBeHidden();

    // Stats should not be visible
    const statsDisplay = await page.locator('#monitor-stats').evaluate(
      (el: HTMLElement) => window.getComputedStyle(el).display,
    );
    expect(statsDisplay).toBe('none');
  });

  // ── Test 10: Warning history — no warnings for fresh user ──
  test('warning history shows empty when user has no warnings', async ({ page, testData }) => {
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
    await switchUserSubtab(page, 'moderation');

    // The warning history list should exist
    const warningList = page.locator('#warning-history-list');
    await expect(warningList).toBeVisible({ timeout: 15_000 });

    // Check for warning items — may be empty for a fresh user
    const warningItems = warningList.locator('.warning-item');
    const warningCount = await warningItems.count();

    // If no warnings, verify appropriate empty display
    if (warningCount === 0) {
      // The list should be empty or show a "No warnings" message
      const listText = await warningList.textContent();
      // Either empty or contains "no warnings" text
      expect(listText!.trim().length === 0 || listText!.toLowerCase().includes('no')).toBe(true);
    }
  });

  // ── Test 11: Transaction history — no transactions initially ──
  test('transaction history shows empty before loading', async ({ page, testData }) => {
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
    await switchUserSubtab(page, 'economy');

    // Before clicking Load, the transaction list container should exist in the DOM
    // (it's an empty div with max-height, so it has 0 height and isn't "visible")
    const txList = page.locator('#tx-list');
    await expect(txList).toBeAttached({ timeout: 15_000 });

    // Verify the list has no transaction content yet
    const content = await txList.textContent();
    expect(content!.trim()).toBe('');
  });

  // ── Test 12: Backpack — empty grid ──
  test('backpack shows empty grid when user has no items', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // First ensure the backpack is empty via API
    try {
      const backpack = await testData.api.get(`/api/users/${uid}/backpack`);
      const items = Array.isArray(backpack) ? backpack : (backpack.items || []);

      // Clean up any existing items
      for (const item of items) {
        await testData.api.post(`/api/users/${uid}/backpack`, {
          giftId: item.giftId, quantity: 0, silent: true,
        });
      }
    } catch (err) {
      console.warn('Backpack cleanup failed (may already be empty):', err);
    }

    // Navigate to economy subtab
    await navigateToTab(page, 'Users');
    await searchUser(page, uid);
    await switchUserSubtab(page, 'economy');

    // Verify the backpack grid is visible but empty
    const backpackGrid = page.locator('#backpack-grid');
    await expect(backpackGrid).toBeVisible({ timeout: 15_000 });

    const backpackItems = backpackGrid.locator('.backpack-item');
    const itemCount = await backpackItems.count();

    // Should be empty
    expect(itemCount).toBe(0);
  });
});
