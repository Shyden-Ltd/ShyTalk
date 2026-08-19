import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';
import { expectListSettled } from './helpers/list-state';
import type { Page } from '@playwright/test';

/** Wait for appeals list to finish loading. */
async function waitForAppealsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const list = document.getElementById('appeals-list');
      if (!list) return false;
      return (
        list.querySelector('.appeal-card') !== null ||
        list.textContent!.includes('No appeals') ||
        list.textContent!.includes('Failed')
      );
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
      return (
        list.querySelector('.report-card') !== null ||
        list.textContent!.includes('No reports') ||
        list.textContent!.includes('Failed')
      );
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
      return tbody.querySelectorAll('tr').length > 0 || (empty && empty.style.display !== 'none');
    },
    { timeout: 15_000 },
  );
}

/** Wait for devices table to load. */
async function waitForDevicesLoaded(page: Page): Promise<void> {
  await expect(page.locator('#devices-tbody tr, #devices-empty[style*="block"]')).not.toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

test.describe('Admin Empty States', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  // ── Test 1: Appeals — no appeals for a filter ──
  test('appeals empty state shows message when filter has no results', async ({ page }) => {
    await navigateToTab(page, 'Appeals');
    await waitForAppealsLoaded(page);

    // EVERY filter is checked, and each one must settle into a valid state.
    // The old version returned on the FIRST empty filter and, if all three had
    // data, asserted only that the panel was visible — so the empty-state
    // message it is named after went unverified on every seeded run.
    const appealsList = page.locator('#appeals-list');
    for (const status of ['approved', 'denied', 'pending'] as const) {
      const btn = page.locator(`button[data-appeal-filter="${status}"]`);
      await btn.click();
      await expect(btn).toHaveClass(/active/);
      await waitForAppealsLoaded(page);
      await expectListSettled(appealsList, page.locator('.appeal-card'), 'No appeals');
    }
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

    // A visible panel proves nothing — a blank one is visible too. The archived
    // list must either show cards or SAY it is empty.
    await expectListSettled(
      page.locator('#reports-list'),
      page.locator('.report-card'),
      'No reports',
    );
  });

  // ── Test 3: Gifts — empty table message (verify table renders) ──
  test('gifts tab shows table with data or appropriate empty state', async ({ page }) => {
    await navigateToTab(page, 'Gifts');

    // navigateToTab already blocks on the panel's data-module-ready flag
    // (helpers/admin-auth.ts:76), so the table is loaded by the time we get
    // here — the 3s sleep was redundant.
    const tbody = page.locator('#gifts-tbody');

    // `expect(rowCount).toBeGreaterThan(0)` sat in the ELSE of `rowCount === 0`,
    // so it was true by construction and asserted nothing.
    await expectListSettled(
      page.locator('#gifts-panel, #gifts-tab-content'),
      tbody.locator('tr'),
      /no gifts|empty/i,
    );
  });

  // ── Test 4: Banners — empty state ──
  test('banners tab shows content or appropriate empty state', async ({ page, testData }) => {
    await navigateToTab(page, 'Banners');

    // Loaded already — navigateToTab waits for data-module-ready.

    // Check for banner cards or empty state
    // The admin fixture seeds `e2e-<prefix>-banner`, so this tab is NEVER
    // legitimately empty — the old empty branch could only ever mask a seeding
    // or rendering failure, and its else-branch was a tautology.
    await expect(
      page.locator('.banner-card').filter({ hasText: `e2e-${testData.prefix}-banner` }),
    ).toHaveCount(1);
  });

  // ── Test 5: Fun Facts — empty state ──
  test('fun facts tab shows content or appropriate empty state', async ({ page, testData }) => {
    await navigateToTab(page, 'Fun Facts');

    // Loaded already — navigateToTab waits for data-module-ready.

    // Check for fact cards or empty state
    // The admin fixture seeds `e2e-<prefix>-fact`, so an empty list is a real
    // failure rather than a branch to tolerate.
    await expect(
      page
        .locator('[data-testid="funfact-card"]')
        .filter({ hasText: `e2e-${testData.prefix}-fact` }),
    ).toHaveCount(1);
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

    // Empty message should be visible
    const empty = page.locator('#devices-empty');
    await expect(empty).toBeVisible();
  });

  // ── Test 8: Backups — list loads or shows empty ──
  test('backups tab loads and shows list or empty state', async ({ page }) => {
    await navigateToTab(page, 'Backups');

    // Wait for backups to load

    // Check for backup cards/list or empty message
    const backupPanel = page.locator('#backups-panel, #backup-list');
    await expect(backupPanel).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => await backupPanel.textContent())
      .toMatch(/backup|no backups|trigger/i);
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
    const statsDisplay = await page
      .locator('#monitor-stats')
      .evaluate((el: HTMLElement) => window.getComputedStyle(el).display);
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

    // The test user is WORKER-SCOPED and earlier files in the same worker issue
    // warnings to it, so "zero warnings" is not a safe constant — asserting it
    // outright made this fail depending on file order. Read the truth from the
    // API and hold the UI to it, which pins the empty state in the case the
    // test is named for AND the populated case in every other.
    const warnings = await testData.api.get(`/api/user/${testData.user.uniqueId}/warnings`);
    const expected = (warnings.warnings || warnings || []).length ?? 0;

    await expect(warningList.locator('.warning-item')).toHaveCount(expected);
    if (expected === 0) {
      await expect
        .poll(async () => {
          const text = ((await warningList.textContent()) ?? '').trim();
          return text === '' || /no warnings/i.test(text);
        })
        .toBe(true);
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
    await expect.poll(async () => (await txList.textContent())!.trim()).toBe('');
  });

  // ── Test 12: Backpack — empty grid ──
  test('backpack shows empty grid when user has no items', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // First ensure the backpack is empty via API
    try {
      const backpack = await testData.api.get(`/api/users/${uid}/backpack`);
      const items = Array.isArray(backpack) ? backpack : backpack.items || [];

      // Clean up any existing items
      for (const item of items) {
        await testData.api.post(`/api/users/${uid}/backpack`, {
          giftId: item.giftId,
          quantity: 0,
          silent: true,
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

    // Should be empty
    await expect(backpackItems).toHaveCount(0);
  });
});
