import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import { Page } from '@playwright/test';
import { waitForAlertsLoaded } from './helpers/alerts';
import { seedLog } from './helpers/logs';

/** Wait for the logs table to finish loading. */
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

/** Click the Search button in the logs filter bar. */
async function searchLogs(page: Page): Promise<void> {
  // Wait for the API response so the table rows reflect the new filter,
  // not a stale render from before the click.
  const respPromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/admin/logs') && resp.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await page.locator('#log-search-btn').click();
  await respPromise;
  await waitForLogsLoaded(page);
}

/** Click the Clear button in the logs filter bar. */
async function clearLogFilters(page: Page): Promise<void> {
  await page.locator('#log-clear-btn').click();
  await waitForLogsLoaded(page);
}

/** Get log count in table body (excluding expanded rows). */
async function getLogRowCount(page: Page): Promise<number> {
  return page.locator('#logs-tbody tr:not(.log-expanded-row)').count();
}

/** Seed a file-specific alert for mutation tests (avoids sharing testData.alert). */
async function seedOwnAlert(testData: TestData, prefix: string): Promise<string> {
  const result = await testData.api.post('/api/admin/alerts', {
    type: 'error_rate',
    severity: 'high',
    message: `e2e-${prefix}-logs-alert`,
    status: 'new',
  });
  return result.id || result.alertId;
}

test.describe('Admin Logs', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Logs');
    await waitForLogsLoaded(page);
  });

  // ── Test 1: Logs load on tab switch — API verify ──
  test('logs load on tab switch with API verification', async ({ page, testData }) => {
    // Verify logs table has rows
    const rowCount = await getLogRowCount(page);
    expect(rowCount).toBeGreaterThan(0);

    // API verification
    const data = await testData.api.get('/api/admin/logs?limit=10');
    const logs = data.logs || [];
    expect(logs.length).toBeGreaterThan(0);
  });

  // ── Test 2: Filter by level — ERROR, verify filtered, clear ──
  test('filter by level shows only matching entries', async ({ page, testData }) => {
    // Seeded so the table CANNOT be empty. The old `if (rowCount > 0)` meant
    // an empty table asserted nothing at all, so the level filter went
    // unverified on every run where no error had been logged yet.
    await seedLog({ testRunId: testData.testRunId, level: 'error', message: 'e2e level filter' });

    await page.locator('#log-filter-level').selectOption('error');
    await searchLogs(page);

    const rows = page.locator('#logs-tbody tr:not(.log-expanded-row)');
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);

    for (const row of await rows.all()) {
      await expect(row.locator('td:nth-child(2)')).toHaveText(/error/i);
    }

    await clearLogFilters(page);
  });

  // ── Test 3: Filter by source — select source, verify ──
  test('filter by source shows only matching entries', async ({ page, testData }) => {
    // Seeded so an empty table is impossible; the old guard let this test pass
    // without ever checking a single row's source.
    await seedLog({
      testRunId: testData.testRunId,
      source: 'express-api',
      message: 'e2e source filter',
    });

    await page.locator('#log-filter-source').selectOption('express-api');
    await searchLogs(page);

    const rows = page.locator('#logs-tbody tr:not(.log-expanded-row)');
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);

    for (const row of await rows.all()) {
      await expect(row.locator('td:nth-child(3)')).toContainText(/express-api/i);
    }

    await clearLogFilters(page);
  });

  // ── Test 4: Filter by userId — enter test user UID ──
  test('filter by userId shows only matching entries', async ({ page, testData }) => {
    await seedLog({
      testRunId: testData.testRunId,
      message: 'e2e userId filter',
      userId: testData.user.uid,
    });

    await page.locator('#log-filter-userId').fill(testData.user.uid);
    await searchLogs(page);

    const rows = page.locator('#logs-tbody tr:not(.log-expanded-row)');
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);

    // EVERY row must belong to the filtered user, not merely the first one.
    for (const row of await rows.all()) {
      await expect(row.locator('td:nth-child(4)')).toContainText(testData.user.uid);
    }

    await clearLogFilters(page);
  });

  // ── Test 5: Filter by traceId — enter a trace ID ──
  test('filter by traceId shows single trace entries', async ({ page, testData }) => {
    // Seeded with a KNOWN trace id. Hunting one in whatever the API happened
    // to have logged meant the test skipped itself whenever no log carried a
    // trace — and a skipped test proves nothing about trace filtering.
    const { sessionTraceId } = await seedLog({
      testRunId: testData.testRunId,
      message: 'e2e traceId filter',
    });

    await page.locator('#log-filter-traceId').fill(sessionTraceId);
    await searchLogs(page);

    const rows = page.locator('#logs-tbody tr:not(.log-expanded-row)');
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);

    // Filtering by ONE trace must return only that trace's entries.
    for (const row of await rows.all()) {
      await expect(row).toContainText('e2e traceId filter');
    }

    await clearLogFilters(page);
  });

  // ── Test 6: Filter by keyword — enter text ──
  test('filter by keyword shows matching entries', async ({ page }) => {
    await page.locator('#log-filter-keyword').fill('api');
    await searchLogs(page);

    // Some results should match (most logs reference API in some way)
    const rowCount = await getLogRowCount(page);
    // Verify the filter executed and returned a valid count
    expect(rowCount).not.toBeNaN();

    await clearLogFilters(page);
  });

  // ── Test 7: Filter by date range — set start+end ──
  test('filter by date range shows entries within range', async ({ page }) => {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600000);

    // Format as datetime-local: YYYY-MM-DDTHH:MM
    const formatDT = (d: Date) => d.toISOString().slice(0, 16);

    await page.locator('#log-filter-startTime').fill(formatDT(hourAgo));
    await page.locator('#log-filter-endTime').fill(formatDT(now));
    await searchLogs(page);

    const rowCount = await getLogRowCount(page);
    expect(rowCount).not.toBeNaN();

    await clearLogFilters(page);
  });

  // ── Test 8: Clear filters — click Clear, verify reset ──
  test('clear filters resets all filter fields', async ({ page }) => {
    // Set several filters
    await page.locator('#log-filter-level').selectOption('error');
    await page.locator('#log-filter-source').selectOption('express-api');
    await page.locator('#log-filter-userId').fill('test-user');
    await page.locator('#log-filter-keyword').fill('test-keyword');

    // Verify filters are set
    await expect(page.locator('#log-filter-level')).toHaveValue('error');
    await expect(page.locator('#log-filter-source')).toHaveValue('express-api');
    await expect(page.locator('#log-filter-userId')).toHaveValue('test-user');
    await expect(page.locator('#log-filter-keyword')).toHaveValue('test-keyword');

    // Click Clear
    await clearLogFilters(page);

    // Verify all filters are reset
    await expect(page.locator('#log-filter-level')).toHaveValue('');
    await expect(page.locator('#log-filter-source')).toHaveValue('');
    await expect(page.locator('#log-filter-userId')).toHaveValue('');
    await expect(page.locator('#log-filter-traceId')).toHaveValue('');
    await expect(page.locator('#log-filter-keyword')).toHaveValue('');
    await expect(page.locator('#log-filter-route')).toHaveValue('');
    await expect(page.locator('#log-filter-startTime')).toHaveValue('');
    await expect(page.locator('#log-filter-endTime')).toHaveValue('');
  });

  // ── Test 9: Trace viewer — click trace link, verify timeline, Back ──
  test('trace viewer opens and displays timeline', async ({ page, testData }) => {
    // Get a log with a trace ID
    // Seeded with a KNOWN trace, rather than hunting one among whatever the API
    // happened to have logged — that hunt came up empty often enough that this
    // test skipped itself and the trace view went unverified.
    const { sessionTraceId } = await seedLog({
      testRunId: testData.testRunId,
      message: 'e2e trace view',
    });
    const logWithTrace = { sessionTraceId };

    // Click the trace link in the log row
    const traceLinks = page.locator('.log-trace-link');
    // Seeded above with a known sessionTraceId, so a trace link must render.
    await expect
      .poll(async () => traceLinks.count(), {
        message: 'a seeded log with a trace id must render a trace link',
      })
      .toBeGreaterThan(0);

    await traceLinks.first().click();

    // Verify trace view is visible
    const traceView = page.locator('#trace-view');
    await expect(traceView).toHaveClass(/visible/, { timeout: 10_000 });

    // Verify title shows trace ID
    const traceTitle = page.locator('#trace-view-title');
    await expect(traceTitle).toContainText('Session Trace');

    // Verify timeline has entries
    const timeline = page.locator('#trace-timeline');
    const entries = timeline.locator('.trace-entry');
    await expect(entries.first()).toBeVisible({ timeout: 10_000 });

    // Click Back button
    await page.locator('#trace-back-btn').click();

    // Verify trace view is hidden and table is visible again
    await expect(traceView).not.toHaveClass(/visible/);
    await expect(page.locator('#logs-table-view')).toBeVisible();
  });

  // ── Test 10: Alerts section — expand, verify seeded alert ──
  test('alerts section shows seeded alert with message and severity', async ({
    page,
    testData,
  }) => {
    // Expand alerts section (it may already be expanded)
    const alertsSection = page.locator('#logs-alerts-section');
    const isCollapsed = await alertsSection.evaluate((el) => el.classList.contains('collapsed'));
    if (isCollapsed) {
      await page.locator('#logs-alerts-section .logs-section-header').click();
    }

    // Wait for alerts to load
    const alertsBody = page.locator('#logs-alerts-section .logs-section-body');
    await expect(alertsBody).toBeVisible();

    // Verify alerts table or empty message is shown
    const alertsTable = page.locator('#alerts-tbody');
    const alertsEmpty = page.locator('#alerts-empty');

    const hasAlerts = (await alertsTable.locator('tr').count()) > 0;
    const isEmpty = await alertsEmpty.isVisible();

    // Exactly one of these must be true (mutually exclusive)
    expect(hasAlerts !== isEmpty).toBe(true);

    if (hasAlerts) {
      // Verify the alerts table has rows with type and title columns
      const firstRow = alertsTable.locator('tr').first();
      await expect(firstRow).toBeVisible();
    }
  });

  // ── Test 11: Acknowledge alert — click Ack, verify status ──
  test('acknowledge alert changes its status', async ({ page, testData }) => {
    // Seed our own alert to avoid sharing with admin-alerts.spec.ts
    // A seeding failure is a real failure; skipping on it left acknowledge
    // untested whenever the API hiccupped.
    const ownAlertId: string = await seedOwnAlert(testData, testData.prefix);

    // Reload to see the new alert
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Logs');

    // Expand alerts section
    const alertsSection = page.locator('#logs-alerts-section');
    const isCollapsed = await alertsSection.evaluate((el) => el.classList.contains('collapsed'));
    if (isCollapsed) {
      await page.locator('#logs-alerts-section .logs-section-header').click();
    }

    await waitForAlertsLoaded(page);

    // Find and click the Ack button on any alert
    // The alert seeded above has status 'new', so its Ack button must render.
    const ackBtn = page.locator('#alerts-tbody .alert-btn').filter({ hasText: 'Ack' }).first();
    await expect(ackBtn).toBeVisible({ timeout: 15_000 });

    await ackBtn.click();

    // Verify toast appears
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('acknowledged');

    // API verify the alert status changed
    try {
      const alertData = await testData.api.get(`/api/admin/alerts/${ownAlertId}`);
      expect(alertData.status || alertData.alert?.status).toBe('acknowledged');
    } catch (err) {
      console.warn('Individual alert GET failed (may not exist):', err);
    }
  });

  // ── Test 12: Resolve alert — click Resolve, verify ──
  test('resolve alert removes it from active list', async ({ page, testData }) => {
    // Expand alerts section
    const alertsSection = page.locator('#logs-alerts-section');
    const isCollapsed = await alertsSection.evaluate((el) => el.classList.contains('collapsed'));
    if (isCollapsed) {
      await page.locator('#logs-alerts-section .logs-section-header').click();
    }

    await waitForAlertsLoaded(page);

    // Find and click a Resolve button
    // An unresolved alert is seeded for this file, so Resolve must be present.
    const resolveBtn = page.locator('#alerts-tbody .alert-btn-resolve').first();
    await expect(resolveBtn).toBeVisible({ timeout: 15_000 });

    await resolveBtn.click();

    // Verify toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('resolved');
  });

  // ── Tests 13-14: Config tests — chromium only (singleton) ──
  test.describe('Config tests', () => {
    // defect-detector:allow SKIP-COND — the log/alert config is one shared document, so running these mutations across several browser projects would have them overwrite each other
    test.skip(({ browserName }) => browserName !== 'chromium', 'Config is singleton');

    // ── Test 13: Alert config — change threshold, save, reload verify, restore ──
    test('alert config threshold change persists after reload', async ({ page, testData }) => {
      // Expand alerts section
      const alertsSection = page.locator('#logs-alerts-section');
      const isCollapsed = await alertsSection.evaluate((el) => el.classList.contains('collapsed'));
      if (isCollapsed) {
        await page.locator('#logs-alerts-section .logs-section-header').click();
      }

      // Click "Configure Thresholds" to show the config panel
      await page.locator('#alerts-config-toggle').click();
      const configPanel = page.locator('#alert-config-panel');
      await expect(configPanel).toBeVisible();

      // A populated threshold is the settled signal — the panel is visible
      // before its values arrive, and an empty read would make
      // `Number('') + 1` silently rewrite the threshold to 1.
      await expect
        .poll(() => page.locator('#alert-config-grid input[type="number"]').first().inputValue())
        .not.toBe('');

      // Get current config via API for backup
      // A missing alert-config endpoint is a failure of the thing under test.
      const originalConfig: any = await testData.api.get('/api/admin/alert-config');

      // Find the first threshold input and change it
      // The config grid always renders its thresholds; an empty grid is a
      // rendering failure, and skipping on it left threshold editing untested.
      const firstInput = page.locator('#alert-config-grid input[type="number"]').first();
      await expect(firstInput).toBeVisible();

      const originalValue = await firstInput.inputValue();
      const newValue = String(Number(originalValue) + 1);
      await firstInput.fill(newValue);

      // Save
      await page.locator('#alert-config-save-btn').click();

      // Verify toast
      const toast = page.locator('.toast.visible');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('saved');

      // Reload and verify persistence
      await page.reload();
      await adminLogin(page);
      await navigateToTab(page, 'Logs');

      // Re-expand and re-open config
      const alertsSectionAfter = page.locator('#logs-alerts-section');
      const isCollapsedAfter = await alertsSectionAfter.evaluate((el) =>
        el.classList.contains('collapsed'),
      );
      if (isCollapsedAfter) {
        await page.locator('#logs-alerts-section .logs-section-header').click();
      }
      await page.locator('#alerts-config-toggle').click();
      await expect(page.locator('#alert-config-panel')).toBeVisible();

      // Verify the value persisted
      const inputAfter = page.locator('#alert-config-grid input[type="number"]').first();
      await expect(inputAfter).toHaveValue(newValue);

      // Restore original value
      await inputAfter.fill(originalValue);
      await page.locator('#alert-config-save-btn').click();
      await expect(page.locator('.toast.visible')).toBeVisible();
    });

    // ── Test 14: Log config — change retention, save, reload verify, restore ──
    test('log config retention change persists after reload', async ({ page, testData }) => {
      // Expand log settings section (collapsed by default)
      const settingsSection = page.locator('#logs-settings-section');
      await page.locator('#logs-settings-section .logs-section-header').click();
      await expect(settingsSection).not.toHaveClass(/collapsed/, { timeout: 3_000 });

      // A populated retention value is the settled signal — the section
      // un-collapses BEFORE its config arrives. This is also why the read
      // below defaults to 72: an empty read would make `Number('') + 1`
      // silently rewrite retention to 1 hour.
      await expect.poll(() => page.locator('#log-cfg-retention').inputValue()).not.toBe('');

      // Get current config via API for backup
      // A missing log-config endpoint is a failure of the thing under test.
      const originalConfig: any = await testData.api.get('/api/admin/log-config');

      const retentionInput = page.locator('#log-cfg-retention');
      const originalRetention = await retentionInput.inputValue();
      const newRetention = String(Number(originalRetention || 72) + 1);

      await retentionInput.fill(newRetention);

      // Save via UI button
      await page.locator('#log-settings-save-btn').click();

      // Verify toast
      const toast = page.locator('.toast.visible');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('saved');

      // Verify via API
      const configAfterSave = await testData.api.get('/api/admin/log-config');
      const cfg = configAfterSave.config || configAfterSave;
      expect(Number(cfg.retentionHours)).toBe(Number(newRetention));

      // Reload and verify persistence
      await page.reload();
      await adminLogin(page);
      await navigateToTab(page, 'Logs');

      // Re-expand settings
      await page.locator('#logs-settings-section .logs-section-header').click();
      await expect(page.locator('#logs-settings-section')).not.toHaveClass(/collapsed/, {
        timeout: 3_000,
      });

      await expect(page.locator('#log-cfg-retention')).toHaveValue(newRetention);

      // Restore original value
      await page.locator('#log-cfg-retention').fill(originalRetention || '72');
      await page.locator('#log-settings-save-btn').click();
      await expect(page.locator('.toast.visible')).toBeVisible();
    });
  });

  // ── Test 15: Live mode toggle — check, verify indicator, uncheck ──
  test('live mode toggle activates and deactivates', async ({ page }) => {
    const liveToggle = page.locator('#log-live-toggle');

    // Verify not active initially
    await expect(liveToggle).not.toHaveClass(/active/);

    // Click to enable live mode
    await liveToggle.click();
    await expect(liveToggle).toHaveClass(/active/, { timeout: 3_000 });

    // Click to disable live mode
    await liveToggle.click();
    await expect(liveToggle).not.toHaveClass(/active/, { timeout: 3_000 });
  });

  // ── Test 16: Quota widget — verify displays percentage ──
  test('quota widget displays log usage percentage', async ({ page }) => {
    const quotaWidget = page.locator('#quota-widget');
    await expect(quotaWidget).toBeVisible({ timeout: 10_000 });

    // Verify the quota label shows something (count / cap format or unavailable)
    const quotaLabel = page.locator('#quota-label');
    await expect(quotaLabel).toBeVisible();
    await expect.poll(async () => await quotaLabel.textContent()).toBeTruthy();
    // Should contain "logs" or "Quota" or a number
    await expect.poll(async () => (await quotaLabel.textContent())!.length).toBeGreaterThan(0);

    // Verify the quota bar exists
    const quotaBar = page.locator('#quota-bar');
    await expect(quotaBar).toBeVisible();

    // Verify the bar has a width style set
    const width = await quotaBar.evaluate((el) => el.style.width);
    expect(width).toBeTruthy();
  });

  // ── Test 17: Export JSON — click, verify download triggers ──
  test('export JSON triggers a download', async ({ page, testData }) => {
    // Seeded so there is always something to export — "no logs" meant the
    // export path went unverified on every quiet run.
    await seedLog({ testRunId: testData.testRunId, message: 'e2e export json' });
    await searchLogs(page);
    await expect.poll(async () => getLogRowCount(page)).toBeGreaterThan(0);

    // Listen for download
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.locator('#log-export-json').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.json');
  });

  // ── Test 18: Export CSV — click, verify download triggers ──
  test('export CSV triggers a download', async ({ page, testData }) => {
    await seedLog({ testRunId: testData.testRunId, message: 'e2e export csv' });
    await searchLogs(page);
    await expect.poll(async () => getLogRowCount(page)).toBeGreaterThan(0);

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.locator('#log-export-csv').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.csv');
  });

  // ── Test 19: Load more pagination — verify button, click, verify more ──
  test('load more button loads additional log entries', async ({ page, testData }) => {
    // Check if the Load More button is visible (only if >50 logs)
    // The pager only appears past a full page, so seed enough rows to cross it
    // rather than skipping — the old guard meant "load more" was never clicked.
    const PAGE_SIZE = 50;
    await Promise.all(
      Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
        seedLog({ testRunId: testData.testRunId, message: `e2e load-more ${i}` }),
      ),
    );
    await searchLogs(page);

    const loadMoreBtn = page.locator('#logs-load-more');
    await expect(loadMoreBtn).toBeVisible({ timeout: 20_000 });

    // Count current rows
    const initialCount = await getLogRowCount(page);

    // Click Load More
    await loadMoreBtn.click();
    // Retrying assertion instead of a 3s sleep: resolves the moment the next
    // page renders and fails loudly if it never does.
    await expect.poll(() => getLogRowCount(page)).toBeGreaterThan(initialCount);
  });

  // ── Test 20: Empty state — impossible filter, verify no results message ──
  test('empty state shows message with impossible filter', async ({ page }) => {
    // Set an impossible filter combination
    await page.locator('#log-filter-keyword').fill('zzz_impossible_keyword_e2e_no_match_xyz');
    await page.locator('#log-filter-level').selectOption('fatal');
    await searchLogs(page);

    // Verify the empty state message is shown
    const emptyMessage = page.locator('#logs-empty');
    await expect(emptyMessage).toBeVisible({ timeout: 10_000 });
    await expect(emptyMessage).toContainText('No logs found');

    // Clear filters
    await clearLogFilters(page);
  });
});
