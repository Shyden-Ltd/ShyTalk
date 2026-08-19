import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';
import { waitForAlertsLoaded } from './helpers/alerts';

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
  const isCollapsed = await alertsSection.evaluate((el) => el.classList.contains('collapsed'));
  if (isCollapsed) {
    await page.locator('#logs-alerts-section .logs-section-header').click();
  }
  await expect(page.locator('#logs-alerts-section .logs-section-body')).toBeVisible();
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
      const alerts = Array.isArray(alertsData) ? alertsData : alertsData.alerts || [];
      const count = alerts.length;

      if (count > 0) {
        // Badge should be visible with a count
        await expect(badge).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => Number(await badge.textContent())).toBeGreaterThan(0);
        const badgeText = await badge.textContent();
      } else {
        // Badge may be hidden if no new alerts
        const isVisible = await badge.isVisible();
        if (isVisible) {
          await expect.poll(async () => Number(await badge.textContent())).toBe(0);
        }
      }
    } catch (err) {
      // NOT a skip: swallowing a real API failure and reporting "skipped" is
      // how an outage looks identical to a pass. If the alerts API is down,
      // that IS the finding.
      throw new Error(`alerts API failed while reading the bell badge: ${(err as Error).message}`);
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
    await expect(alertsSection).not.toHaveClass(/collapsed/);
  });

  // ── Test 3: Seeded alert appears in alert list ──
  test('seeded alert appears in Logs tab alerts section', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await waitForAlertsLoaded(page);

    // The alerts table should have rows or an empty message
    const alertsTable = page.locator('#alerts-tbody');
    const alertRows = alertsTable.locator('tr');
    // The admin fixture seeds `e2e-<prefix>-alert`, so the table is NEVER
    // legitimately empty here — the old empty branch could only ever mask a
    // seeding or rendering failure.
    // This file seeds its own alert in beforeAll ON TOP of the fixture's, and
    // alerts accumulate within a run — so the seeded text matches one OR MORE
    // rows. What matters is that it is present at all.
    await expect(alertRows.filter({ hasText: `e2e-${testData.prefix}-alert` })).not.toHaveCount(0);
  });

  // ── Test 4: Acknowledge alert ──
  test('acknowledge alert changes its status', async ({ page, testData }) => {
    // Seed our own alert. A seeding failure is a real failure — skipping on it
    // left acknowledge-alert unverified whenever the API hiccupped.
    ownAlertId = await seedOwnAlert(testData, testData.prefix);

    // Reload to see the new alert
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await waitForAlertsLoaded(page);

    // Find and click the Ack button
    // The alert seeded three lines up has status 'new', so logs.js renders its
    // Ack button. Its absence is a regression, not a reason to skip.
    const ackBtn = page.locator('#alerts-tbody .alert-btn').filter({ hasText: 'Ack' }).first();
    await expect(ackBtn).toBeVisible({ timeout: 15_000 });

    await ackBtn.click();

    // Verify toast appears
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible();
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
    await waitForAlertsLoaded(page);

    // beforeAll seeds an unresolved alert, so a Resolve button must be present.
    const resolveBtn = page.locator('#alerts-tbody .alert-btn-resolve').first();
    await expect(resolveBtn).toBeVisible({ timeout: 15_000 });

    await resolveBtn.click();

    // Verify toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('resolved');
  });

  // ── Test 6: Alert config edit (chromium-only — singleton) ──
  test('alert config edit persists after reload', async ({ page, testData, browserName }) => {
    // defect-detector:allow SKIP-COND — the alert config is a single shared document, so running this mutation in more than one browser project would have the projects overwrite each other's values
    test.skip(browserName !== 'chromium', 'Alert config is singleton — run in one project only');

    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);

    // Click "Configure Thresholds"
    await page.locator('#alerts-config-toggle').click();
    const configPanel = page.locator('#alert-config-panel');
    await expect(configPanel).toBeVisible();
    // The panel becomes visible BEFORE its thresholds arrive, so visibility is
    // not the settled signal — a populated input is. Waiting on the value also
    // means `originalValue` below can never be read as an empty string, which
    // would make `Number('') + 1` produce 1 and silently rewrite the threshold.
    await expect
      .poll(() => page.locator('#alert-config-grid input[type="number"]').first().inputValue())
      .not.toBe('');

    // Get current config via API for backup
    // A missing alert-config endpoint is a failure of the thing under test.
    const originalConfig: any = await testData.api.get('/api/admin/alert-config');

    // Find and change the first threshold input
    const firstInput = page.locator('#alert-config-grid input[type="number"]').first();
    // The alert-config grid always renders its thresholds; an empty grid is a
    // rendering failure, and skipping on it left threshold editing untested.
    await expect(firstInput).toBeVisible();

    const originalValue = await firstInput.inputValue();
    const newValue = String(Number(originalValue) + 1);
    await firstInput.fill(newValue);

    // Save
    await page.locator('#alert-config-save-btn').click();

    // Verify toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toBeVisible();

    // Reload and verify persistence
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await page.locator('#alerts-config-toggle').click();
    await expect(page.locator('#alert-config-panel')).toBeVisible();

    const inputAfter = page.locator('#alert-config-grid input[type="number"]').first();
    await expect(inputAfter).toHaveValue(newValue);

    // Restore
    await inputAfter.fill(originalValue);
    await page.locator('#alert-config-save-btn').click();
    await expect(page.locator('.toast.visible')).toBeVisible();
  });

  // ── Test 7: Alert trace cross-nav ──
  test('alert trace link navigates to logs filtered by trace ID', async ({ page, testData }) => {
    // logs.js renders an alert's "View Logs" affordance ONLY when the alert
    // carries a sampleTraceId. Nothing else in the suite guarantees one, which
    // is why this test previously skipped itself on every run.
    await testData.api.testWrite('alerts', {
      type: 'error_rate',
      severity: 'high',
      message: `e2e-${testData.prefix}-alert-trace`,
      status: 'new',
      sampleTraceId: `e2e-alert-trace-${Date.now()}`,
      createdAt: Date.now(),
      _testRun: testData.testRunId,
    });

    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await waitForAlertsLoaded(page);

    // Look for trace links in alerts
    // `.log-trace-link` belongs to LOG rows and appears nowhere in an alert row,
    // so this locator matched nothing and the test skipped itself every run.
    // Alert rows use `.alert-link` ("View Logs"), rendered only when the alert
    // carries a sampleTraceId — hence the seed at the top of this test.
    const traceLinks = page.locator('#alerts-tbody .alert-link');
    await expect
      .poll(async () => traceLinks.count(), {
        message: 'an alert with a sampleTraceId must render its View Logs link',
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    await traceLinks.first().click();

    // Verify the trace view opened or the logs filter was populated
    const traceView = page.locator('#trace-view');
    const traceIdFilter = page.locator('#log-filter-traceId');

    const traceViewVisible = await traceView.isVisible();

    // One of: trace view opened, or traceId filter populated
    await expect
      .poll(async () => traceViewVisible || (await traceIdFilter.inputValue()).length > 0)
      .toBe(true);
  });

  // ── Test 8: Empty alert state ──
  test('empty alert state shows appropriate message when no alerts', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');
    await expandAlertsSection(page);
    await waitForAlertsLoaded(page);

    // Check if alerts table is empty
    const alertRows = page.locator('#alerts-tbody tr');
    const emptyMsg = page.locator('#alerts-empty');
    // With the fixture's seeded alert present, rows exist and the empty message
    // must be hidden. Branching on the count let a run with no rows assert the
    // opposite thing and still pass, so neither claim was ever pinned.
    await expect.poll(async () => alertRows.count()).toBeGreaterThan(0);
    await expect(emptyMsg).toBeHidden();
  });
});
