import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

/**
 * Helper: navigate back to the user's moderation subtab after a reload.
 * Every reload loses the current user context, so we must re-login, search, and switch.
 */
async function reloadAndNavigateToModeration(
  page: import('@playwright/test').Page,
  uniqueId: string,
): Promise<void> {
  await page.reload();
  await adminLogin(page);
  await navigateToTab(page, 'Users');
  await searchUser(page, uniqueId);
  await switchUserSubtab(page, 'moderation');
}

test.describe('Admin Users - Moderation Subtab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, testData }) => {
    // Auto-accept all confirm() and prompt() dialogs
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('E2E test reason');
      } else {
        await dialog.accept();
      }
    });

    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
    await switchUserSubtab(page, 'moderation');
  });

  // ── Test 1: Issue warning and verify in history ──
  test('issue warning and verify in history', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Select reason "Spam"
    await page.locator('#direct-warn-reason').selectOption('Spam');

    // Select severity 3 (should already be default, but click explicitly)
    await page.locator('input[name="direct-warn-severity"][value="3"]').click();

    // Click "Issue Warning"
    await page.locator('#direct-warn-btn').click();

    // Wait for the warning to appear in history
    const warningList = page.locator('#warning-history-list');
    const firstWarning = warningList.locator('.warning-item').first();
    await expect(firstWarning).toBeVisible({ timeout: 15_000 });

    // Verify warning shows correct reason
    await expect(firstWarning).toContainText('Spam');

    // Verify warning shows correct severity
    await expect(firstWarning).toContainText('Severity 3');

    // Reload → search → switch to moderation → verify still there
    await reloadAndNavigateToModeration(page, uid);

    const warningAfterReload = page.locator('#warning-history-list .warning-item').first();
    await expect(warningAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(warningAfterReload).toContainText('Spam');

    // API: verify warning exists
    const warningsData = await testData.api.get(`/api/user/${uid}/warnings`);
    const warnings = warningsData.warnings || [];
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const latestWarning = warnings[0];
    expect(latestWarning.reason).toBe('Spam');
    expect(latestWarning.severity).toBe(3);

    // Verify GCS deducted: 100 - 15 = 85
    const userData = await testData.api.get(`/api/user/${uid}`);
    expect(userData.gcsScore).toBe(85);

    // Clean up: revoke the warning via API, then reset GCS
    await testData.api.post(`/api/user/${uid}/warnings/${latestWarning.id}/revoke`);
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });

  // ── Test 2: Revoke warning and verify GCS restored ──
  test('revoke warning and verify GCS restored', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Issue a warning: severity 2, deduction 10
    await page.locator('#direct-warn-reason').selectOption('Harassment');
    await page.locator('input[name="direct-warn-severity"][value="2"]').click();
    await page.locator('#direct-warn-btn').click();

    // Wait for warning to appear in history
    const warningList = page.locator('#warning-history-list');
    const firstWarning = warningList.locator('.warning-item').first();
    await expect(firstWarning).toBeVisible({ timeout: 15_000 });

    // Click the Revoke button on that warning
    const revokeBtn = firstWarning.locator('.btn-revoke-warning');
    await expect(revokeBtn).toBeVisible();
    await revokeBtn.click();

    // Verify "Revoked" status in history (the revoke button is replaced with "Revoked" text)
    await expect(firstWarning).toContainText('Revoked', { timeout: 15_000 });

    // Verify the warning item has the .revoked class
    await expect(firstWarning).toHaveClass(/revoked/);

    // Reload → verify persists
    await reloadAndNavigateToModeration(page, uid);

    const warningAfterReload = page.locator('#warning-history-list .warning-item').first();
    await expect(warningAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(warningAfterReload).toContainText('Revoked');

    // API: verify GCS restored to 100
    const userData = await testData.api.get(`/api/user/${uid}`);
    expect(userData.gcsScore).toBe(100);

    // Clean up: reset GCS to be safe
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });

  // ── Test 3: Suspend user → verify state → unsuspend ──
  test('suspend user then unsuspend', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Fill reason
    await page.locator('#suspend-reason').fill('E2E test suspension');

    // Select "7 Days" duration preset
    await page.locator('.duration-presets button[data-days="7"]').click();

    // Check "Can Appeal"
    await page.locator('#suspend-can-appeal').check();

    // Click "Suspend User"
    await page.locator('#suspend-btn').click();

    // Verify suspended banner appears
    const suspendedBanner = page.locator('#suspended-banner');
    await expect(suspendedBanner).toBeVisible({ timeout: 15_000 });

    // Verify suspension status shows suspended
    const suspensionStatus = page.locator('#suspension-status');
    await expect(suspensionStatus).toHaveClass(/suspended/, { timeout: 15_000 });
    await expect(suspensionStatus).not.toHaveClass(/not-suspended/);

    // Reload → search → verify still suspended
    await reloadAndNavigateToModeration(page, uid);

    await expect(page.locator('#suspended-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#suspension-status')).toHaveClass(/suspended/);

    // API: verify isSuspended === true (admin route)
    const adminData = await testData.api.get(`/api/user/${uid}`);
    expect(adminData.isSuspended).toBe(true);

    // App-facing API: verify suspended
    const appData = await testData.api.get(`/api/users/${uid}`);
    expect(appData.isSuspended).toBe(true);

    // Unsuspend
    await page.locator('#unsuspend-btn').click();

    // Wait for unsuspend to take effect
    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#suspension-status')).toHaveClass(/not-suspended/, { timeout: 15_000 });

    // Reload → verify cleared
    await reloadAndNavigateToModeration(page, uid);

    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#suspension-status')).toHaveClass(/not-suspended/);

    // API: verify isSuspended === false
    const afterUnsuspend = await testData.api.get(`/api/user/${uid}`);
    expect(afterUnsuspend.isSuspended).toBe(false);

    // CRITICAL: Suspend zeroes GCS, unsuspend does NOT restore it. Reset GCS.
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });

  // ── Test 4: GCS reset to 100 ──
  test('GCS reset to 100', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Precondition: issue a warning to reduce GCS from 100
    await page.locator('#direct-warn-reason').selectOption('Other');
    await page.locator('input[name="direct-warn-severity"][value="3"]').click();
    await page.locator('#direct-warn-btn').click();

    // Wait for warning to appear
    const warningItem = page.locator('#warning-history-list .warning-item').first();
    await expect(warningItem).toBeVisible({ timeout: 15_000 });

    // Verify GCS is below 100
    const gcsBadge = page.locator('#gcs-badge-user');
    await expect(gcsBadge).toContainText('85', { timeout: 15_000 });

    // Click "Reset GCS"
    await page.locator('#reset-gcs-btn').click();

    // Verify GCS badge shows 100
    await expect(gcsBadge).toContainText('100', { timeout: 15_000 });

    // Reload → verify persists
    await reloadAndNavigateToModeration(page, uid);

    await expect(page.locator('#gcs-badge-user')).toContainText('100', { timeout: 15_000 });

    // API: verify gcsScore === 100 and warningCount === 0
    const userData = await testData.api.get(`/api/user/${uid}`);
    expect(userData.gcsScore).toBe(100);
    expect(userData.warningCount).toBe(0);
  });

  // ── Test 5: Device binding section shows seeded data ──
  test('device binding section shows seeded data', async ({ page, testData }) => {
    const deviceBindingSection = page.locator('#device-binding-section');
    await expect(deviceBindingSection).toBeVisible({ timeout: 15_000 });

    // Verify it shows the seeded device info
    const deviceCards = page.locator('#device-binding-cards');
    await expect(deviceCards).toContainText('Pixel 6', { timeout: 15_000 });

    // Verify the seeded device ID appears (manufacturer + model)
    await expect(deviceCards).toContainText('Google', { timeout: 15_000 });
  });

  // ── Test 7: Ban all devices for user ──
  // (Placed before test 6 because test 6 deletes the device binding)
  test('ban all devices for user', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Click "Ban All Devices" — confirm dialog and prompt will be auto-accepted
    await page.locator('#bans-ban-all-devices').click();

    // Verify success toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toContainText('Banned', { timeout: 15_000 });

    // API: verify bans exist for this user
    const bansData = await testData.api.get(`/api/admin/bans/user/${uid}`);
    const deviceBans = bansData.deviceBans || bansData.bans || [];
    expect(deviceBans.length).toBeGreaterThanOrEqual(1);

    // Click "Unban All" → verify bans cleared
    await page.locator('#bans-unban-all').click();

    // Wait for unban toast
    await expect(page.locator('.toast.visible')).toContainText('Removed', { timeout: 15_000 });

    // API: verify bans cleared
    const afterUnban = await testData.api.get(`/api/admin/bans/user/${uid}`);
    const remainingDeviceBans = afterUnban.deviceBans || afterUnban.bans || [];
    expect(remainingDeviceBans.length).toBe(0);
  });

  // ── Test 8: Ban last IP for user ──
  test('ban last IP for user', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Click "Ban Last IP" — confirm dialog and prompt will be auto-accepted
    await page.locator('#bans-ban-last-ip').click();

    // Verify success toast
    const toast = page.locator('.toast.visible');
    await expect(toast).toContainText('banned', { timeout: 15_000 });

    // API: verify network ban exists
    const bansData = await testData.api.get(`/api/admin/bans/user/${uid}`);
    const networkBans = bansData.networkBans || [];
    expect(networkBans.length).toBeGreaterThanOrEqual(1);

    // Click "Unban All" → verify bans cleared
    await page.locator('#bans-unban-all').click();
    await expect(page.locator('.toast.visible')).toContainText('Removed', { timeout: 15_000 });

    // API: verify cleared
    const afterUnban = await testData.api.get(`/api/admin/bans/user/${uid}`);
    const remainingNetBans = afterUnban.networkBans || [];
    expect(remainingNetBans.length).toBe(0);
  });

  // ── Test 6: Reset device binding ──
  // (Placed after ban tests since it deletes the seeded device binding)
  test('reset device binding', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Verify binding is visible before reset
    const deviceCards = page.locator('#device-binding-cards');
    await expect(deviceCards).toContainText('Pixel 6', { timeout: 15_000 });

    // Click "Reset Device Binding" — confirm dialog will be auto-accepted
    await page.locator('#reset-device-binding-btn').click();

    // Verify binding removed from UI — empty state should show
    const deviceEmpty = page.locator('#device-binding-empty');
    await expect(deviceEmpty).toBeVisible({ timeout: 15_000 });

    // Reload → verify still removed
    await reloadAndNavigateToModeration(page, uid);

    // After reload, device binding section should show empty or the empty element
    // The section shows "No device bound" when empty
    await expect(page.locator('#device-binding-empty')).toBeVisible({ timeout: 15_000 });

    // API: verify device binding removed
    const devicesData = await testData.api.get(`/api/admin/devices/user/${uid}`);
    const devices = devicesData.devices || [];
    expect(devices.length).toBe(0);
  });

  // ── Test 9: Warning history pagination ──
  test('warning history shows multiple warnings', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Issue 3 warnings rapidly (severity 1 each)
    for (let i = 0; i < 3; i++) {
      await page.locator('#direct-warn-reason').selectOption('Spam');
      await page.locator('input[name="direct-warn-severity"][value="1"]').click();
      await page.locator('#direct-warn-btn').click();

      // Wait for the warning button to re-enable (indicates the previous warning was processed)
      await expect(page.locator('#direct-warn-btn')).toBeEnabled({ timeout: 15_000 });
      await expect(page.locator('#direct-warn-btn')).toContainText('Issue Warning', { timeout: 15_000 });
    }

    // Verify at least 3 warnings appear in history (previous tests may have left revoked warnings)
    const warningItems = page.locator('#warning-history-list .warning-item');
    const count = await warningItems.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Clean up: revoke all 3 via API
    const warningsData = await testData.api.get(`/api/user/${uid}/warnings`);
    const warnings = warningsData.warnings || [];
    for (const w of warnings) {
      if (!w.revoked) {
        await testData.api.post(`/api/user/${uid}/warnings/${w.id}/revoke`);
      }
    }

    // Reset GCS
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });

  // ── Test 10: Account info shows timestamps ──
  test('account info shows timestamps', async ({ page, testData }) => {
    // Verify #field-createdAt displays a date
    const createdAt = page.locator('#field-createdAt');
    await expect(createdAt).toBeVisible({ timeout: 15_000 });
    const createdAtText = await createdAt.textContent();
    expect(createdAtText).toBeTruthy();
    expect(createdAtText!.length).toBeGreaterThan(0);
    // Should not be a placeholder dash
    expect(createdAtText).not.toBe('—');

    // Verify #field-lastSeenAt displays a date
    const lastSeenAt = page.locator('#field-lastSeenAt');
    await expect(lastSeenAt).toBeVisible({ timeout: 15_000 });
    const lastSeenAtText = await lastSeenAt.textContent();
    expect(lastSeenAtText).toBeTruthy();
    expect(lastSeenAtText!.length).toBeGreaterThan(0);
    expect(lastSeenAtText).not.toBe('—');

    // Verify #account-info-section has 2 .readonly-badge elements
    const accountInfoSection = page.locator('#account-info-section');
    const readonlyBadges = accountInfoSection.locator('.readonly-badge');
    await expect(readonlyBadges).toHaveCount(2);
  });
});
