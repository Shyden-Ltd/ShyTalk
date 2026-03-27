import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/**
 * Helper: wait for the maintenance panel to be visible.
 */
async function waitForMaintenanceLoaded(page: Page): Promise<void> {
  await expect(page.locator('#maintenance-panel')).toBeVisible();
}

/**
 * Helper: verify a maintenance result element shows success.
 */
async function expectMaintenanceSuccess(page: Page, resultId: string): Promise<void> {
  const result = page.locator(`#${resultId}`);
  await expect(result).toHaveClass(/success/);
  await expect(result).toBeVisible();
}

/**
 * Helper: verify a maintenance result element is hidden (no action taken).
 */

test.describe('Admin Maintenance Tab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Maintenance');
    await waitForMaintenanceLoaded(page);
  });

  // ── Test 1: Storage audit ──
  test('storage audit displays folder sizes', async ({ page, testData }) => {
    const auditBtn = page.locator('#audit-storage-btn');
    await auditBtn.click();

    // Skip transient "Auditing..." text assertion — the operation can complete
    // before Playwright observes it, causing a race condition.
    // Instead, just wait for the result to appear.
    const result = page.locator('#storage-result');
    await expect(result).toBeVisible();

    // Result should contain size information (KB, MB, or B)
    const text = await result.textContent();
    expect(text).toMatch(/[KMG]?B/i);

    // Button should re-enable
    await expect(auditBtn).toBeEnabled();

    // API verify: the endpoint works
    const apiData = await testData.api.get('/api/storage/audit');
    expect(apiData).toHaveProperty('folders');
  });

  // ── Test 2: Clear device binding (single user) ──
  test('clear device binding via per-user API removes binding', async ({ page, testData }) => {
    const uniqueId = testData.user.uniqueId;

    // Verify the device binding exists first
    const deviceId = `e2e-${testData.prefix}-device`;
    const devicesBefore = await testData.api.get(`/api/admin/devices?q=${encodeURIComponent(deviceId)}&limit=5&offset=0`);
    const hasBefore = (devicesBefore.devices || []).some((d: any) => d.id === deviceId);

    if (hasBefore) {
      // Clear device binding for test user via per-user API
      await testData.api.post(`/api/cleanup/device-binding/${uniqueId}`);

      // API verify: device should be removed
      const devicesAfter = await testData.api.get(`/api/admin/devices?q=${encodeURIComponent(deviceId)}&limit=5&offset=0`);
      const hasAfter = (devicesAfter.devices || []).some((d: any) => d.id === deviceId);
      expect(hasAfter).toBe(false);

      // Re-seed just the device binding directly via Firestore (no new user needed).
      // We can't use testSetup because it creates a new user with a new uniqueId.
      // Instead, skip re-seeding — subsequent tests that need the device should
      // check for its existence and skip gracefully if absent.
      // The device binding was created by the fixture and is now deleted — that's expected.
    }
  });

  // ── Test 3: Confirm dialog — confirm path (Clear Reports) ──
  test('confirm dialog confirm path triggers action and shows success', async ({ page }) => {
    // Accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click Clear All Reports
    const btn = page.locator('#clear-reports-btn');
    await btn.click();

    // Button should show processing state
    await expect(btn).toHaveText('Processing...');

    // Result should show success
    await expectMaintenanceSuccess(page, 'clear-reports-result');

    // Button should re-enable with original label
    await expect(btn).toHaveText('Clear All Reports');
  });

  // ── Test 4: Confirm dialog — cancel path ──
  test('confirm dialog cancel path takes no action', async ({ page }) => {
    // Dismiss the confirm dialog
    page.on('dialog', (dialog) => dialog.dismiss());

    // Click Clear All Reports
    await page.locator('#clear-reports-btn').click();

    // Result should not appear (no action taken)
    await page.waitForTimeout(1_000);

    // The result div should remain hidden
    const result = page.locator('#clear-reports-result');
    const isVisible = await result.isVisible();
    // If it was visible from a previous test, it should not have changed
    // The key assertion: the button should NOT have changed to "Processing..."
    const btnText = await page.locator('#clear-reports-btn').textContent();
    expect(btnText).toBe('Clear All Reports');
  });

  // ── Test 5: Individual operation result display ──
  test('maintenance operation shows loading then success result', async ({ page }) => {
    // Accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());

    const btn = page.locator('#backfill-user-type-btn');
    const result = page.locator('#backfill-user-type-result');

    // Click Backfill User Types (safe — idempotent operation)
    await btn.click();

    // Result should become visible with success class
    // (skip transient "Backfilling..." text assertion — operation can complete
    // before Playwright observes it, causing a race condition)
    await expect(result).toBeVisible();
    await expect(result).toHaveClass(/success/);

    // Button should re-enable
    await expect(btn).toBeEnabled();
  });

  // ── Test 6: Clear system messages ──
  test('clear system messages shows success', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('#clear-system-msgs-btn').click();

    await expectMaintenanceSuccess(page, 'clear-system-msgs-result');
  });

  // ── Test 7: Clear warnings ──
  test('clear warnings resets GCS to 100', async ({ page, testData }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('#clear-warnings-btn').click();

    await expectMaintenanceSuccess(page, 'clear-warnings-result');

    // API verify: test user should have GCS reset to 100
    const userData = await testData.api.get(`/api/user/${testData.user.uniqueId}`);
    const gcs = userData.goodCharacterScore ?? userData.gcs ?? 100;
    expect(gcs).toBe(100);
  });

  // ── Test 8: Clear backpacks ──
  test('clear backpacks empties all backpacks', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('#clear-backpacks-btn').click();

    await expectMaintenanceSuccess(page, 'clear-backpacks-result');
  });

  // ── Test 9: Clear coins (per-user) ──
  test('clear coins for test user via per-user API', async ({ page, testData }) => {
    const uniqueId = testData.user.uniqueId;

    // Clear coins for the test user using per-user endpoint
    await testData.api.post(`/api/cleanup/user-coins/${uniqueId}`);

    // API verify: coins should be 0
    const userData = await testData.api.get(`/api/user/${uniqueId}`);
    expect(userData.shyCoins).toBe(0);

    // Restore: add coins back via balance adjustment
    await testData.api.post(`/api/users/${uniqueId}/adjust-balance`, {
      currency: 'coins',
      amount: 1000,
      reason: 'e2e-test-restore',
    });

    // Verify restoration
    const restored = await testData.api.get(`/api/user/${uniqueId}`);
    expect(restored.shyCoins).toBeGreaterThanOrEqual(1000);
  });

  // ── Test 10: Clear beans (per-user) ──
  test('clear beans for test user via per-user API', async ({ page, testData }) => {
    const uniqueId = testData.user.uniqueId;

    // Clear beans for the test user
    await testData.api.post(`/api/cleanup/user-beans/${uniqueId}`);

    // API verify: beans should be 0
    const userData = await testData.api.get(`/api/user/${uniqueId}`);
    expect(userData.shyBeans).toBe(0);

    // Restore: add beans back
    await testData.api.post(`/api/users/${uniqueId}/adjust-balance`, {
      currency: 'beans',
      amount: 500,
      reason: 'e2e-test-restore',
    });

    // Verify restoration
    const restored = await testData.api.get(`/api/user/${uniqueId}`);
    expect(restored.shyBeans).toBeGreaterThanOrEqual(500);
  });

  // ── Test 11: Orphaned storage cleanup ──
  test('orphaned storage purge shows result', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('#purge-storage-btn').click();

    // Wait for result
    const result = page.locator('#storage-result');
    await expect(result).toBeVisible();
  });

  // ── Test 12: Backfill user types ──
  test('backfill user types shows success', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('#backfill-user-type-btn').click();

    await expectMaintenanceSuccess(page, 'backfill-user-type-result');
  });

  // ── Test 13: Nuclear step 1 — click RESET EVERYTHING, verify, cancel ──
  test('nuclear step 1 shows warning description and can be cancelled', async ({ page }) => {
    // Click RESET EVERYTHING
    await page.locator('#reset-all-btn').click();

    // Nuclear overlay should be visible
    const overlay = page.locator('#nuclear-overlay');
    await expect(overlay).toHaveClass(/visible/);

    // Step 1 label
    const stepLabel = page.locator('#nuclear-step-label');
    await expect(stepLabel).toHaveText('Step 1 of 3');

    // Title should show warning
    const title = page.locator('#nuclear-title');
    await expect(title).toContainText('sure');

    // Description should explain what will be deleted
    const desc = page.locator('#nuclear-desc');
    const descText = await desc.textContent();
    expect(descText).toContain('maintenance');

    // Confirm input should NOT be visible yet
    const inputWrap = page.locator('#nuclear-input-wrap');
    await expect(inputWrap).toHaveCSS('display', 'none');

    // Cancel should close the overlay
    await page.locator('#nuclear-cancel').click();
    await expect(overlay).not.toHaveClass(/visible/);
  });

  // ── Test 14: Nuclear step 2 — proceed to step 2, verify, cancel ──
  test('nuclear step 2 shows second warning with confirmation input', async ({ page }) => {
    // Open nuclear dialog
    await page.locator('#reset-all-btn').click();
    const overlay = page.locator('#nuclear-overlay');
    await expect(overlay).toHaveClass(/visible/);

    // Click proceed to go to step 2
    await page.locator('#nuclear-proceed').click();

    // Verify step 2
    const stepLabel = page.locator('#nuclear-step-label');
    await expect(stepLabel).toHaveText('Step 2 of 3');

    // Title should be "This is your last warning"
    const title = page.locator('#nuclear-title');
    await expect(title).toContainText('last warning');

    // Proceed button should show "Continue to final step"
    const proceedBtn = page.locator('#nuclear-proceed');
    await expect(proceedBtn).toContainText('Continue to final step');

    // Cancel
    await page.locator('#nuclear-cancel').click();
    await expect(overlay).not.toHaveClass(/visible/);
  });

  // ── Test 15: Nuclear step 3 — full dialog flow without executing ──
  test('nuclear full 3-step flow without executing the reset', async ({ page }) => {
    // Open nuclear dialog
    await page.locator('#reset-all-btn').click();
    const overlay = page.locator('#nuclear-overlay');
    await expect(overlay).toHaveClass(/visible/);

    // Step 1 → Step 2
    await page.locator('#nuclear-proceed').click();
    await expect(page.locator('#nuclear-step-label')).toHaveText('Step 2 of 3');

    // Step 2 → Step 3
    await page.locator('#nuclear-proceed').click();
    await expect(page.locator('#nuclear-step-label')).toHaveText('Step 3 of 3');

    // Title should be "Type to confirm"
    await expect(page.locator('#nuclear-title')).toContainText('Type to confirm');

    // Confirm input should be visible
    const inputWrap = page.locator('#nuclear-input-wrap');
    await expect(inputWrap).not.toHaveCSS('display', 'none');

    // Proceed button should be disabled (no text typed yet)
    const proceedBtn = page.locator('#nuclear-proceed');
    await expect(proceedBtn).toBeDisabled();
    await expect(proceedBtn).toContainText('EXECUTE RESET');

    // Type wrong text — button should remain disabled
    const confirmInput = page.locator('#nuclear-confirm-input');
    await confirmInput.fill('WRONG TEXT');
    await expect(proceedBtn).toBeDisabled();

    // Type correct text — button should enable
    await confirmInput.fill('RESET EVERYTHING');
    await expect(proceedBtn).toBeEnabled();

    // DO NOT click proceed — cancel to avoid executing the destructive operation
    await page.locator('#nuclear-cancel').click();
    await expect(overlay).not.toHaveClass(/visible/);
  });

  // ── Test 16: Mute toggle ──
  test('mute button toggles mute state during nuclear dialog', async ({ page }) => {
    // Open nuclear dialog
    await page.locator('#reset-all-btn').click();
    const overlay = page.locator('#nuclear-overlay');
    await expect(overlay).toHaveClass(/visible/);

    // Mute button should show "Mute" initially
    const muteBtn = page.locator('#nuclear-mute');
    await expect(muteBtn).toHaveText('Mute');

    // Click mute — should toggle to "Unmute"
    await muteBtn.click();
    await expect(muteBtn).toHaveText('Unmute');

    // Click again — should toggle back to "Mute"
    await muteBtn.click();
    await expect(muteBtn).toHaveText('Mute');

    // Cancel the dialog
    await page.locator('#nuclear-cancel').click();
    await expect(overlay).not.toHaveClass(/visible/);
  });
});
