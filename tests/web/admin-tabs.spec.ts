import { test, expect } from '@playwright/test';
import { adminLogin, navigateToTab } from './helpers/admin-auth';

test.describe('Admin Tabs - Structure Verification', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test.describe('Appeals Tab', () => {
    test('shows filter buttons (Pending, Approved, Rejected)', async ({ page }) => {
      await navigateToTab(page, 'Appeals');

      const appealsPanel = page.locator('#appeals-panel');
      await expect(appealsPanel).toBeVisible();

      const pendingBtn = appealsPanel.locator('button[data-appeal-filter="pending"]');
      await expect(pendingBtn).toBeVisible();
      await expect(pendingBtn).toContainText('Pending');

      const approvedBtn = appealsPanel.locator('button[data-appeal-filter="approved"]');
      await expect(approvedBtn).toBeVisible();
      await expect(approvedBtn).toContainText('Approved');

      const rejectedBtn = appealsPanel.locator('button[data-appeal-filter="rejected"]');
      await expect(rejectedBtn).toBeVisible();
      await expect(rejectedBtn).toContainText('Rejected');
    });

    test('shows appeals list container', async ({ page }) => {
      await navigateToTab(page, 'Appeals');

      const appealsList = page.locator('#appeals-list');
      await expect(appealsList).toBeAttached();
    });
  });

  test.describe('Reports Tab', () => {
    test('shows stats bar', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const statsBar = page.locator('#reports-stats-bar');
      await expect(statsBar).toBeVisible();

      // Verify stat cards exist
      await expect(page.locator('#stat-pending')).toBeAttached();
      await expect(page.locator('#stat-resolved-today')).toBeAttached();
      await expect(page.locator('#stat-avg-response')).toBeAttached();
      await expect(page.locator('#stat-reviewers')).toBeAttached();
    });

    test('shows search input', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const searchInput = page.locator('#report-search-input');
      await expect(searchInput).toBeVisible();

      const searchBtn = page.locator('#report-search-btn');
      await expect(searchBtn).toBeVisible();
    });

    test('shows filter buttons (Pending, Resolved, Archived)', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const filterBar = page.locator('#report-filter-bar');
      await expect(filterBar).toBeVisible();

      const pendingBtn = filterBar.locator('button[data-report-filter="pending"]');
      await expect(pendingBtn).toBeVisible();

      const resolvedBtn = filterBar.locator('button[data-report-filter="resolved"]');
      await expect(resolvedBtn).toBeVisible();

      const archivedBtn = filterBar.locator('button[data-report-filter="archived"]');
      await expect(archivedBtn).toBeVisible();
    });

    test('shows export section', async ({ page }) => {
      await navigateToTab(page, 'Reports');

      const exportFrom = page.locator('#export-from');
      await expect(exportFrom).toBeAttached();

      const exportTo = page.locator('#export-to');
      await expect(exportTo).toBeAttached();

      const exportCsvBtn = page.locator('#export-csv-btn');
      await expect(exportCsvBtn).toBeVisible();
      await expect(exportCsvBtn).toContainText('Export CSV');
    });
  });

  test.describe('Gifts Tab', () => {
    test('shows add gift button', async ({ page }) => {
      await navigateToTab(page, 'Gifts');

      const addGiftBtn = page.locator('#gift-add-btn');
      await expect(addGiftBtn).toBeVisible();
      await expect(addGiftBtn).toContainText('Add Gift');
    });

    test('shows gifts table', async ({ page }) => {
      await navigateToTab(page, 'Gifts');

      const giftsTable = page.locator('.gifts-table');
      await expect(giftsTable).toBeVisible();

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
      await expect(applyBtn).toBeAttached();

      const discardBtn = page.locator('#gift-discard-btn');
      await expect(discardBtn).toBeAttached();
    });
  });

  test.describe('Economy Tab', () => {
    test('shows bean conversion section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      const economyPanel = page.locator('#economy-panel');
      await expect(economyPanel).toBeVisible();

      // Bean conversion rate input
      const beanConversionRate = page.locator('#eco-beanConversionRate');
      await expect(beanConversionRate).toBeAttached();
    });

    test('shows gacha rates section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      // Drop rate exponent slider
      const dropRateExponent = page.locator('#eco-dropRateExponent');
      await expect(dropRateExponent).toBeAttached();

      // Pull costs
      await expect(page.locator('#eco-pullCost-1')).toBeAttached();
      await expect(page.locator('#eco-pullCost-10')).toBeAttached();
      await expect(page.locator('#eco-pullCost-100')).toBeAttached();
    });

    test('shows pity system section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      await expect(page.locator('#eco-pitySoftStart')).toBeAttached();
      await expect(page.locator('#eco-pityHardLimit')).toBeAttached();
      await expect(page.locator('#eco-pitySoftMaxShift')).toBeAttached();
      await expect(page.locator('#eco-pityHighValueThreshold')).toBeAttached();
    });

    test('shows daily rewards section', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      const dailyBase = page.locator('#eco-dailyBase');
      await expect(dailyBase).toBeAttached();

      // Milestone rows container
      const milestoneRows = page.locator('#milestone-rows');
      await expect(milestoneRows).toBeAttached();

      // Add milestone button
      const addMilestoneBtn = page.locator('#ms-add-btn');
      await expect(addMilestoneBtn).toBeVisible();
    });

    test('shows save button', async ({ page }) => {
      await navigateToTab(page, 'Economy');

      const saveBtn = page.locator('#eco-save-btn');
      await expect(saveBtn).toBeVisible();
      await expect(saveBtn).toContainText('Save Economy Config');
    });
  });

  test.describe('Maintenance Tab', () => {

    test('shows all maintenance cards', async ({ page }) => {
      await navigateToTab(page, 'Maintenance');

      const maintenancePanel = page.locator('#maintenance-panel');
      await expect(maintenancePanel).toBeVisible();

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
        await expect(button).toBeAttached();
      }
    });

    test('shows nuclear reset button', async ({ page }) => {
      await navigateToTab(page, 'Maintenance');

      const resetAllBtn = page.locator('#reset-all-btn');
      await expect(resetAllBtn).toBeVisible();
      await expect(resetAllBtn).toContainText('RESET EVERYTHING');
    });
  });

  test.describe('Spin Monitor Tab', () => {
    test('shows user input and start/stop buttons', async ({ page }) => {
      await navigateToTab(page, 'Spin Monitor');

      const monitorPanel = page.locator('#monitor-panel');
      await expect(monitorPanel).toBeVisible();

      const uidInput = page.locator('#monitor-uid-input');
      await expect(uidInput).toBeVisible();

      const startBtn = page.locator('#monitor-start-btn');
      await expect(startBtn).toBeVisible();
      await expect(startBtn).toContainText('Start Monitoring');

      const stopBtn = page.locator('#monitor-stop-btn');
      await expect(stopBtn).toBeAttached();
    });

    test('shows guarantee section', async ({ page }) => {
      await navigateToTab(page, 'Spin Monitor');

      const guaranteeSection = page.locator('#guarantee-section');
      await expect(guaranteeSection).toBeVisible();

      const heading = guaranteeSection.locator('h3');
      await expect(heading).toContainText('Guarantee Next Prize');

      const giftSelect = page.locator('#guarantee-gift-select');
      await expect(giftSelect).toBeAttached();

      const setBtn = page.locator('#guarantee-set-btn');
      await expect(setBtn).toBeVisible();
      await expect(setBtn).toContainText('Set Guarantee');

      const revokeBtn = page.locator('#guarantee-revoke-btn');
      await expect(revokeBtn).toBeAttached();
    });
  });

  test.describe('Banners Tab', () => {

    test('shows add banner button', async ({ page }) => {
      await navigateToTab(page, 'Banners');

      const addBannerBtn = page.locator('#banner-add-btn');
      await expect(addBannerBtn).toBeVisible();
      await expect(addBannerBtn).toContainText('Add Banner');
    });

    test('shows banners list container', async ({ page }) => {
      await navigateToTab(page, 'Banners');

      const bannersList = page.locator('#banners-list');
      await expect(bannersList).toBeAttached();
    });
  });

  test.describe('Fun Facts Tab', () => {

    test('shows add fun fact button', async ({ page }) => {
      await navigateToTab(page, 'Fun Facts');

      const addFunFactBtn = page.locator('#funfact-add-btn');
      await expect(addFunFactBtn).toBeVisible();
      await expect(addFunFactBtn).toContainText('Add Fun Fact');
    });

    test('shows fun facts list container', async ({ page }) => {
      await navigateToTab(page, 'Fun Facts');

      const funfactsList = page.locator('#funfacts-list');
      await expect(funfactsList).toBeAttached();
    });
  });

  test.describe('Backups Tab', () => {
    test('shows backup now, refresh, and recover photos buttons', async ({ page }) => {
      await navigateToTab(page, 'Backups');

      const backupNowBtn = page.locator('#backup-trigger-btn');
      await expect(backupNowBtn).toBeVisible();
      await expect(backupNowBtn).toContainText('Backup Now');

      const refreshBtn = page.locator('#backup-refresh-btn');
      await expect(refreshBtn).toBeVisible();
      await expect(refreshBtn).toContainText('Refresh');

      const recoverBtn = page.locator('#backup-recover-photos-btn');
      await expect(recoverBtn).toBeVisible();
      await expect(recoverBtn).toContainText('Recover Photos from R2');
    });
  });

  test.describe('Logs Tab', () => {

    test('shows alerts section', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const logsPanel = page.locator('#logs-panel');
      await expect(logsPanel).toBeVisible();

      const alertsSection = page.locator('#logs-alerts-section');
      await expect(alertsSection).toBeAttached();

      const alertsTable = page.locator('#alerts-table');
      await expect(alertsTable).toBeAttached();
    });

    test('shows filters bar', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const filtersBar = page.locator('#logs-filters');
      await expect(filtersBar).toBeVisible();

      // Key filter elements
      await expect(page.locator('#log-filter-level')).toBeAttached();
      await expect(page.locator('#log-filter-source')).toBeAttached();
      await expect(page.locator('#log-filter-userId')).toBeAttached();
      await expect(page.locator('#log-filter-keyword')).toBeAttached();

      // Search and clear buttons
      await expect(page.locator('#log-search-btn')).toBeVisible();
      await expect(page.locator('#log-clear-btn')).toBeVisible();
    });

    test('shows log table', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const logsTable = page.locator('.logs-table');
      await expect(logsTable).toBeAttached();

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
      await expect(exportJsonBtn).toBeVisible();
      await expect(exportJsonBtn).toContainText('Export JSON');

      const exportCsvBtn = page.locator('#log-export-csv');
      await expect(exportCsvBtn).toBeVisible();
      await expect(exportCsvBtn).toContainText('Export CSV');
    });

    test('shows settings section', async ({ page }) => {
      await navigateToTab(page, 'Logs');

      const settingsSection = page.locator('#logs-settings-section');
      await expect(settingsSection).toBeAttached();

      // Settings should include retention and hard cap inputs
      await expect(page.locator('#log-cfg-retention')).toBeAttached();
      await expect(page.locator('#log-cfg-hardcap')).toBeAttached();

      // Save settings button
      await expect(page.locator('#log-settings-save-btn')).toBeAttached();
    });
  });

  test.describe('Devices Tab', () => {

    test('shows search input', async ({ page }) => {
      await navigateToTab(page, 'Devices');

      const searchInput = page.locator('#devices-search-input');
      await expect(searchInput).toBeVisible();

      const searchBtn = page.locator('#devices-search-btn');
      await expect(searchBtn).toBeVisible();
    });

    test('shows devices table container', async ({ page }) => {
      await navigateToTab(page, 'Devices');

      const tableContainer = page.locator('#devices-table-container');
      await expect(tableContainer).toBeAttached();

      // Verify table headers
      const devicesTable = page.locator('.devices-table');
      await expect(devicesTable).toBeAttached();

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
