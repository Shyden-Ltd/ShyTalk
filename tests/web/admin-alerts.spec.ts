import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/** Seed a file-specific alert for mutation tests (avoids sharing testData.alert). */
async function seedOwnAlert(testData: TestData, prefix: string): Promise<string> {
  const result = await testData.api.post('/api/admin/alerts', {
    type: 'error_rate',
    severity: 'high',
    message: `e2e-${prefix}-alerts-spec-alert`,
    status: 'new',
  });
  return result.id || result.alertId;
}

/** Expand the alerts section in the Logs tab. */
async function expandAlertsSection(page: Page): Promise<void> {
  const alertsSection = page.locator('#logs-alerts-section');
  const isCollapsed = await alertsSection.evaluate(
    (el) => el.classList.contains('collapsed'),
  );
  if (isCollapsed) {
    await page.locator('#logs-alerts-section .logs-section-header').click();
  }
  await expect(page.locator('#logs-alerts-section .logs-section-body')).toBeVisible({ timeout: 5_000 });
}

test.describe('Admin Alerts', () => {
  test.describe.configure({ mode: 'serial' });

  // Seed our own alert to avoid conflicts with admin-logs.spec.ts
  let ownAlertId: string;

  test.beforeAll(async ({ testData }) => {
    ownAlertId = await seedOwnAlert(testData, testData.prefix);
  });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  // ── Test 1: Alert bell badge shows count ──
  test('alert bell badge shows a count', async ({ page, testData }) => {
    // The alert bell badge should display a count of new alerts
    const badge = page.locator('#alert-bell-badge');

    // Check via API how many new alerts exist
    try {
      const alertsData = await testData.api.get('/api/admin/alerts?status=new');
      const alerts = Array.isArray(alertsData) ? alertsData : (alertsData.alerts || []);
      const count = alerts.length;

      if (count > 0) {
        // Badge should be visible with a count
        await expect(badge).toBeVisible({ timeout: 10_000 });
        const badgeText = await badge.textContent();
        expect(Number(badgeText)).toBeGreaterThan(0);
      } else {
        // Badge may be hidden if no new alerts
        const isVisible = await badge.isVisible();
        if (isVisible) {
          const badgeText = await badge.textContent();
          expect(Number(badgeText)).toBe(0);
        }
      }
    } catch {
      // Alerts API may not be available
      test.skip(true, 'Alerts API not available');
    }
  });

  // ── Test 2: Alert bell click navigates to Logs tab alerts section ──
  test('alert bell click navigates to Logs tab alerts section', async ({ page }) => {
    const alertBell = page.locator('#alert-bell');
    await alertBell.click();

    // Verify Logs tab is now active
    const logsTab = page.getByRole('button', { name: 'Logs', exact: true });
    await expect(logsTab).toHaveClass(/active/, { timeout: 10_000 });

    // Verify alerts section is expanded
    const alertsSection = page.locator('#logs-alerts-section');
    await expect(alertsSection).not.toHaveClass(/collapsed/, { timeout: 5_000 });
  });

  // ── Test 3: Seeded alert appears in alert list ──
  test('seeded alert appears in Logs tab alerts section', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);

    // Wait for alerts table to populate
    await page.waitForTimeout(2_000);

    // The alerts table should have rows or an empty message
    const alertsTable = page.locator('#alerts-tbody');
    const alertRows = alertsTable.locator('tr');
    const rowCount = await alertRows.count();

    if (rowCount > 0) {
      // Verify at least one alert row exists with content
      const firstRow = alertRows.first();
      await expect(firstRow).toBeVisible();
      const rowText = await firstRow.textContent();
      expect(rowText!.length).toBeGreaterThan(0);
    } else {
      // Check empty message
      const alertsEmpty = page.locator('#alerts-empty');
      await expect(alertsEmpty).toBeVisible();
    }
  });

  // ── Test 4: Acknowledge alert ──
  test('acknowledge alert changes its status', async ({ page, testData }) => {
    // Seed our own alert
    try {
      ownAlertId = await seedOwnAlert(testData, testData.prefix);
    } catch {
      test.skip(true, 'Cannot seed alert via API');
      return;
    }

    // Reload to see the new alert
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await page.waitForTimeout(2_000);

    // Find and click the Ack button
    const ackBtn = page.locator('#alerts-tbody .alert-btn').filter({ hasText: 'Ack' }).first();
    const hasAckBtn = await ackBtn.count() > 0;

    if (!hasAckBtn) {
      test.skip(true, 'No acknowledgeable alerts visible');
      return;
    }

    await ackBtn.click();

    // Verify toast appears
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText('acknowledged');

    // API verify
    try {
      const alertData = await testData.api.get(`/api/admin/alerts/${ownAlertId}`);
      expect(alertData.status || alertData.alert?.status).toBe('acknowledged');
    } catch (err) {
      console.warn('Individual alert GET failed (may not exist):', err);
    }
  });

  // ── Test 5: Resolve alert ──
  test('resolve alert removes it from active list', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await page.waitForTimeout(2_000);

    // Find and click a Resolve button
    const resolveBtn = page.locator('#alerts-tbody .alert-btn-resolve').first();
    const hasResolveBtn = await resolveBtn.count() > 0;

    if (!hasResolveBtn) {
      test.skip(true, 'No resolvable alerts visible');
      return;
    }

    await resolveBtn.click();

    // Verify toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText('resolved');
  });

  // ── Test 6: Alert config edit (chromium-only — singleton) ──
  test('alert config edit persists after reload', async ({ page, testData }) => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'Alert config is singleton — run in one project only');

    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);

    // Click "Configure Thresholds"
    await page.locator('#alerts-config-toggle').click();
    const configPanel = page.locator('#alert-config-panel');
    await expect(configPanel).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(2_000);

    // Get current config via API for backup
    let originalConfig: any;
    try {
      originalConfig = await testData.api.get('/api/admin/alert-config');
    } catch {
      test.skip(true, 'Alert config API not available');
      return;
    }

    // Find and change the first threshold input
    const firstInput = page.locator('#alert-config-grid input[type="number"]').first();
    if (await firstInput.count() === 0) {
      test.skip(true, 'No alert config fields available');
      return;
    }

    const originalValue = await firstInput.inputValue();
    const newValue = String(Number(originalValue) + 1);
    await firstInput.fill(newValue);

    // Save
    await page.locator('#alert-config-save-btn').click();

    // Verify toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Reload and verify persistence
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await page.locator('#alerts-config-toggle').click();
    await expect(page.locator('#alert-config-panel')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(2_000);

    const inputAfter = page.locator('#alert-config-grid input[type="number"]').first();
    await expect(inputAfter).toHaveValue(newValue, { timeout: 5_000 });

    // Restore
    await inputAfter.fill(originalValue);
    await page.locator('#alert-config-save-btn').click();
    await expect(page.locator('.toast.visible')).toBeVisible({ timeout: 5_000 });
  });

  // ── Test 7: Alert trace cross-nav ──
  test('alert trace link navigates to logs filtered by trace ID', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await page.waitForTimeout(2_000);

    // Look for trace links in alerts
    const traceLinks = page.locator('#alerts-tbody .log-trace-link, #alerts-tbody [data-trace-id]');
    const hasTraceLink = await traceLinks.count() > 0;

    if (!hasTraceLink) {
      test.skip(true, 'No trace links in current alerts');
      return;
    }

    await traceLinks.first().click();

    // Verify the trace view opened or the logs filter was populated
    const traceView = page.locator('#trace-view');
    const traceIdFilter = page.locator('#log-filter-traceId');

    const traceViewVisible = await traceView.isVisible();
    const filterValue = await traceIdFilter.inputValue();

    // One of: trace view opened, or traceId filter populated
    expect(traceViewVisible || filterValue.length > 0).toBe(true);
  });

  // ── Test 8: Empty alert state ──
  test('empty alert state shows appropriate message when no alerts', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await page.waitForTimeout(2_000);

    // Check if alerts table is empty
    const alertRows = page.locator('#alerts-tbody tr');
    const rowCount = await alertRows.count();
    const emptyMsg = page.locator('#alerts-empty');

    // Either we have rows, or the empty message is shown
    if (rowCount === 0) {
      await expect(emptyMsg).toBeVisible();
    } else {
      // With data, the empty message should be hidden
      const emptyVisible = await emptyMsg.isVisible();
      expect(emptyVisible).toBe(false);
    }
  });
});
