import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';

test.describe('Admin Tabs - Structure Verification', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test.describe('Appeals Tab', () => {
    test('shows filter buttons (Pending, Approved, Rejected)', async ({ page }) => {
      await navigateToTab(page, 'Appeals');

      const appealsPanel = page.locator('#appeals-panel');
      await expect(appealsPanel).toBeVisible({ timeout: 15_000 });

      const pendingBtn = appealsPanel.locator('button[data-appeal-filter="pending"]');
      await expect(pendingBtn).toBeVisible({ timeout: 15_000 });
      await expect(pendingBtn).toContainText('Pending');

      const approvedBtn = appealsPanel.locator('button[data-appeal-filter="approved"]');
      await expect(approvedBtn).toBeVisible({ timeout: 15_000 });
      await expect(approvedBtn).toContainText('Approved');

      const rejectedBtn = appealsPanel.locator('button[data-appeal-filter="rejected"]');
      await expect(rejectedBtn).toBeVisible({ timeout: 15_000 });
      await expect(rejectedBtn).toContainText('Rejected');
    });

    test('shows appeals list container', async ({ page }) => {
      await navigateToTab(page, 'Appeals');

      const appealsList = page.locator('#appeals-list');
      await expect(appealsList).toBeAttached({ timeout: 15_000 });
    });
  });

  test.describe('Reports Tab', () => {
    test('shows stats bar', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const statsBar = page.locator('#reports-stats-bar');
      await expect(statsBar).toBeVisible({ timeout: 15_000 });

      // Verify stat cards exist
      await expect(page.locator('#stat-pending')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#stat-resolved-today')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#stat-avg-response')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#stat-reviewers')).toBeAttached({ timeout: 15_000 });
    });

    test('shows search input', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const searchInput = page.locator('#report-search-input');
      await expect(searchInput).toBeVisible({ timeout: 15_000 });

      const searchBtn = page.locator('#report-search-btn');
      await expect(searchBtn).toBeVisible({ timeout: 15_000 });
    });

    test('shows filter buttons (Pending, Resolved, Archived)', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const filterBar = page.locator('#report-filter-bar');
      await expect(filterBar).toBeVisible({ timeout: 15_000 });

      const pendingBtn = filterBar.locator('button[data-report-filter="pending"]');
      await expect(pendingBtn).toBeVisible({ timeout: 15_000 });

      const resolvedBtn = filterBar.locator('button[data-report-filter="resolved"]');
      await expect(resolvedBtn).toBeVisible({ timeout: 15_000 });

      const archivedBtn = filterBar.locator('button[data-report-filter="archived"]');
      await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
    });

    test('shows export section', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const exportFrom = page.locator('#export-from');
      await expect(exportFrom).toBeAttached({ timeout: 15_000 });

      const exportTo = page.locator('#export-to');
      await expect(exportTo).toBeAttached({ timeout: 15_000 });

      const exportCsvBtn = page.locator('#export-csv-btn');
      await expect(exportCsvBtn).toBeVisible({ timeout: 15_000 });
      await expect(exportCsvBtn).toContainText('Export CSV');
    });
  });

  test.describe('Gifts Tab', () => {
    test('shows add gift button', async ({ page }) => {
      await navigateToTab(page, 'Gifts');

      const addGiftBtn = page.locator('#gift-add-btn');
      await expect(addGiftBtn).toBeVisible({ timeout: 15_000 });
      await expect(addGiftBtn).toContainText('Add Gift');
    });

    test('shows gifts table', async ({ page }) => {
      await navigateToTab(page, 'Gifts');

      const giftsTable = page.locator('.gifts-table');
      await expect(giftsTable).toBeVisible({ timeout: 15_000 });

      // Verify table headers
      const headers = giftsTable.locator('thead th');
      const headerTexts = await headers.allTextContents();
      expect(headerTexts).toContain('Order');
      expect(headerTexts).toContain('Name');
      expect(headerTexts).toContain('Coin Value');
      expect(headerTexts).toContain('Actions');
    });

    test('shows apply and discard buttons', async ({ page }) => {
      await navigateToTab(page, 'Gifts');

      const applyBtn = page.locator('#gift-apply-btn');
      await expect(applyBtn).toBeAttached({ timeout: 15_000 });

      const discardBtn = page.locator('#gift-discard-btn');
      await expect(discardBtn).toBeAttached({ timeout: 15_000 });
    });
  });

  test.describe('Economy Tab', () => {
    test('shows bean conversion section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      const economyPanel = page.locator('#economy-panel');
      await expect(economyPanel).toBeVisible({ timeout: 15_000 });

      // Bean conversion rate input
      const beanConversionRate = page.locator('#eco-beanConversionRate');
      await expect(beanConversionRate).toBeAttached({ timeout: 15_000 });
    });

    test('shows gacha rates section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      // Drop rate exponent slider
      const dropRateExponent = page.locator('#eco-dropRateExponent');
      await expect(dropRateExponent).toBeAttached({ timeout: 15_000 });

      // Pull costs
      await expect(page.locator('#eco-pullCost-1')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#eco-pullCost-10')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#eco-pullCost-100')).toBeAttached({ timeout: 15_000 });
    });

    test('shows pity system section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      await expect(page.locator('#eco-pitySoftStart')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#eco-pityHardLimit')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#eco-pitySoftMaxShift')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#eco-pityHighValueThreshold')).toBeAttached({ timeout: 15_000 });
    });

    test('shows daily rewards section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      const dailyBase = page.locator('#eco-dailyBase');
      await expect(dailyBase).toBeAttached({ timeout: 15_000 });

      // Milestone rows container
      const milestoneRows = page.locator('#milestone-rows');
      await expect(milestoneRows).toBeAttached({ timeout: 15_000 });

      // Add milestone button
      const addMilestoneBtn = page.locator('#ms-add-btn');
      await expect(addMilestoneBtn).toBeVisible({ timeout: 15_000 });
    });

    test('shows save button', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      const saveBtn = page.locator('#eco-save-btn');
      await expect(saveBtn).toBeVisible({ timeout: 15_000 });
      await expect(saveBtn).toContainText('Save Economy Config');
    });
  });

  test.describe('Maintenance Tab', () => {
    test('shows all maintenance cards', async ({ page }) => {
      await navigateToTab(page, 'Maintenance');

      const maintenancePanel = page.locator('#maintenance-panel');
      await expect(maintenancePanel).toBeVisible({ timeout: 15_000 });

      // Verify key maintenance cards exist by their button IDs
      const maintenanceButtons = [
        { id: '#clear-system-msgs-btn', text: 'Clear All System Messages' },
        { id: '#clear-reports-btn', text: 'Clear All Reports' },
        { id: '#clear-warnings-btn', text: 'Clear All Warnings' },
        { id: '#clear-appeals-btn', text: 'Delete All Appeals' },
        { id: '#audit-storage-btn', text: 'Audit Storage' },
        { id: '#purge-storage-btn', text: 'Purge Orphaned Files' },
        { id: '#clear-backpacks-btn', text: 'Empty All Backpacks' },
        { id: '#clear-giftwalls-btn', text: 'Empty All Gift Walls' },
        { id: '#clear-coins-btn', text: 'Empty All Coins' },
        { id: '#clear-beans-btn', text: 'Empty All Beans' },
        { id: '#clear-spin-history-btn', text: 'Clear All Spin History' },
        { id: '#clear-all-transactions-btn', text: 'Clear All Transactions' },
        { id: '#clear-supershy-btn', text: 'Remove All Super Shy' },
        { id: '#clean-destroyed-btn', text: 'Clean Destroyed Users' },
        { id: '#clear-device-bindings-btn', text: 'Clear All Device Bindings' },
        { id: '#backfill-user-type-btn', text: 'Backfill User Types' },
        { id: '#clear-pms-btn', text: 'Delete All Private Messages' },
        { id: '#clear-groups-btn', text: 'Delete All Group Chats' },
        { id: '#clear-rooms-btn', text: 'Delete All Closed Rooms' },
        { id: '#clear-broadcasts-btn', text: 'Delete All Broadcasts' },
        { id: '#clear-audit-logs-btn', text: 'Delete All Audit Logs' },
        { id: '#clear-stalkers-btn', text: 'Clear All Stalkers' },
      ];

      for (const btn of maintenanceButtons) {
        const button = page.locator(btn.id);
        await expect(button).toBeAttached({ timeout: 15_000 });
      }
    });

    test('shows nuclear reset button', async ({ page }) => {
      await navigateToTab(page, 'Maintenance');

      const resetAllBtn = page.locator('#reset-all-btn');
      await expect(resetAllBtn).toBeVisible({ timeout: 15_000 });
      await expect(resetAllBtn).toContainText('RESET EVERYTHING');
    });
  });

  test.describe('Spin Monitor Tab', () => {
    test('shows user input and start/stop buttons', async ({ page }) => {
      await navigateToTab(page, 'Spin Monitor');

      const monitorPanel = page.locator('#monitor-panel');
      await expect(monitorPanel).toBeVisible({ timeout: 15_000 });

      const uidInput = page.locator('#monitor-uid-input');
      await expect(uidInput).toBeVisible({ timeout: 15_000 });

      const startBtn = page.locator('#monitor-start-btn');
      await expect(startBtn).toBeVisible({ timeout: 15_000 });
      await expect(startBtn).toContainText('Start Monitoring');

      const stopBtn = page.locator('#monitor-stop-btn');
      await expect(stopBtn).toBeAttached({ timeout: 15_000 });
    });

    test('shows guarantee section', async ({ page }) => {
      await navigateToTab(page, 'Spin Monitor');

      const guaranteeSection = page.locator('#guarantee-section');
      await expect(guaranteeSection).toBeVisible({ timeout: 15_000 });

      const heading = guaranteeSection.locator('h3');
      await expect(heading).toContainText('Guarantee Next Prize');

      const giftSelect = page.locator('#guarantee-gift-select');
      await expect(giftSelect).toBeAttached({ timeout: 15_000 });

      const setBtn = page.locator('#guarantee-set-btn');
      await expect(setBtn).toBeVisible({ timeout: 15_000 });
      await expect(setBtn).toContainText('Set Guarantee');

      const revokeBtn = page.locator('#guarantee-revoke-btn');
      await expect(revokeBtn).toBeAttached({ timeout: 15_000 });
    });
  });

  test.describe('Banners Tab', () => {
    test('shows add banner button', async ({ page }) => {
      await navigateToTab(page, 'Banners');

      const addBannerBtn = page.locator('#banner-add-btn');
      await expect(addBannerBtn).toBeVisible({ timeout: 15_000 });
      await expect(addBannerBtn).toContainText('Add Banner');
    });

    test('shows banners list container', async ({ page }) => {
      await navigateToTab(page, 'Banners');

      const bannersList = page.locator('#banners-list');
      await expect(bannersList).toBeAttached({ timeout: 15_000 });
    });
  });

  test.describe('Fun Facts Tab', () => {
    test('shows add fun fact button', async ({ page }) => {
      await navigateToTab(page, 'Fun Facts');

      const addFunFactBtn = page.locator('#funfact-add-btn');
      await expect(addFunFactBtn).toBeVisible({ timeout: 15_000 });
      await expect(addFunFactBtn).toContainText('Add Fun Fact');
    });

    test('shows fun facts list container', async ({ page }) => {
      await navigateToTab(page, 'Fun Facts');

      const funfactsList = page.locator('#funfacts-list');
      await expect(funfactsList).toBeAttached({ timeout: 15_000 });
    });
  });

  test.describe('Backups Tab', () => {
    test('shows backup now, refresh, and recover photos buttons', async ({ page }) => {
      await navigateToTab(page, 'Backups');

      const backupNowBtn = page.locator('#backup-trigger-btn');
      await expect(backupNowBtn).toBeVisible({ timeout: 15_000 });
      await expect(backupNowBtn).toContainText('Backup Now');

      const refreshBtn = page.locator('#backup-refresh-btn');
      await expect(refreshBtn).toBeVisible({ timeout: 15_000 });
      await expect(refreshBtn).toContainText('Refresh');

      const recoverBtn = page.locator('#backup-recover-photos-btn');
      await expect(recoverBtn).toBeVisible({ timeout: 15_000 });
      await expect(recoverBtn).toContainText('Recover Photos from R2');
    });
  });

  test.describe('Logs Tab', () => {
    test('shows alerts section', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const logsPanel = page.locator('#logs-panel');
      await expect(logsPanel).toBeVisible({ timeout: 15_000 });

      const alertsSection = page.locator('#logs-alerts-section');
      await expect(alertsSection).toBeAttached({ timeout: 15_000 });

      const alertsTable = page.locator('#alerts-table');
      await expect(alertsTable).toBeAttached({ timeout: 15_000 });
    });

    test('shows filters bar', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const filtersBar = page.locator('#logs-filters');
      await expect(filtersBar).toBeVisible({ timeout: 15_000 });

      // Key filter elements
      await expect(page.locator('#log-filter-level')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#log-filter-source')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#log-filter-userId')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#log-filter-keyword')).toBeAttached({ timeout: 15_000 });

      // Search and clear buttons
      await expect(page.locator('#log-search-btn')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#log-clear-btn')).toBeVisible({ timeout: 15_000 });
    });

    test('shows log table', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const logsTable = page.locator('.logs-table');
      await expect(logsTable).toBeAttached({ timeout: 15_000 });

      // Verify table headers
      const headers = logsTable.locator('thead th');
      const headerTexts = await headers.allTextContents();
      expect(headerTexts).toContain('Timestamp');
      expect(headerTexts).toContain('Level');
      expect(headerTexts).toContain('Source');
      expect(headerTexts).toContain('Message');
    });

    test('shows export buttons', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const exportJsonBtn = page.locator('#log-export-json');
      await expect(exportJsonBtn).toBeVisible({ timeout: 15_000 });
      await expect(exportJsonBtn).toContainText('Export JSON');

      const exportCsvBtn = page.locator('#log-export-csv');
      await expect(exportCsvBtn).toBeVisible({ timeout: 15_000 });
      await expect(exportCsvBtn).toContainText('Export CSV');
    });

    test('shows settings section', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const settingsSection = page.locator('#logs-settings-section');
      await expect(settingsSection).toBeAttached({ timeout: 15_000 });

      // Settings should include retention and hard cap inputs
      await expect(page.locator('#log-cfg-retention')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#log-cfg-hardcap')).toBeAttached({ timeout: 15_000 });

      // Save settings button
      await expect(page.locator('#log-settings-save-btn')).toBeAttached({ timeout: 15_000 });
    });
  });

  test.describe('Devices Tab', () => {
    test('shows search input', async ({ page }) => {
      await navigateToTab(page, 'Devices');

      const searchInput = page.locator('#devices-search-input');
      await expect(searchInput).toBeVisible({ timeout: 15_000 });

      const searchBtn = page.locator('#devices-search-btn');
      await expect(searchBtn).toBeVisible({ timeout: 15_000 });
    });

    test('shows devices table container', async ({ page }) => {
      await navigateToTab(page, 'Devices');

      const tableContainer = page.locator('#devices-table-container');
      await expect(tableContainer).toBeAttached({ timeout: 15_000 });

      // Verify table headers
      const devicesTable = page.locator('.devices-table');
      await expect(devicesTable).toBeAttached({ timeout: 15_000 });

      const headers = devicesTable.locator('thead th');
      const headerTexts = await headers.allTextContents();
      expect(headerTexts).toContain('Device ID');
      expect(headerTexts).toContain('User');
      expect(headerTexts).toContain('Model');
      expect(headerTexts).toContain('Status');
      expect(headerTexts).toContain('Actions');
    });
  });
});
