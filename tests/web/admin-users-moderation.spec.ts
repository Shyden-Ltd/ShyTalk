import { test, expect } from '@playwright/test';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

const TEST_USER_ID = '10000001';

test.describe('Admin Users - Moderation Subtab', () => {

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, TEST_USER_ID);
    await switchUserSubtab(page, 'moderation');
  });

  test('shows device binding section', async ({ page }) => {
    const deviceBindingSection = page.locator('#device-binding-section');
    await expect(deviceBindingSection).toBeVisible({ timeout: 15_000 });

    // Should have a heading
    const heading = deviceBindingSection.locator('h3');
    await expect(heading).toContainText('Bound Device');

    // Should have a reset button
    const resetBtn = page.locator('#reset-device-binding-btn');
    await expect(resetBtn).toBeAttached({ timeout: 15_000 });
    await expect(resetBtn).toContainText('Reset Device Binding');
  });

  test('shows GCS summary with badge', async ({ page }) => {
    const gcsSection = page.locator('#gcs-section');
    await expect(gcsSection).toBeVisible({ timeout: 15_000 });

    // GCS heading
    const heading = gcsSection.locator('h3');
    await expect(heading).toContainText('GCS');

    // GCS badge
    const gcsBadge = page.locator('#gcs-badge-user');
    await expect(gcsBadge).toBeAttached({ timeout: 15_000 });

    // GCS details
    const gcsFloor = page.locator('#gcs-floor');
    await expect(gcsFloor).toBeAttached({ timeout: 15_000 });

    const gcsWarnings = page.locator('#gcs-warnings');
    await expect(gcsWarnings).toBeAttached({ timeout: 15_000 });

    // Reset GCS button
    const resetGcsBtn = page.locator('#reset-gcs-btn');
    await expect(resetGcsBtn).toBeAttached({ timeout: 15_000 });
    await expect(resetGcsBtn).toContainText('Reset GCS');
  });

  test('warning issue form has reason dropdown and severity radio', async ({ page }) => {
    // Reason dropdown
    const reasonSelect = page.locator('#direct-warn-reason');
    await expect(reasonSelect).toBeVisible({ timeout: 15_000 });

    const options = await reasonSelect.locator('option').allTextContents();
    expect(options).toContain('Spam');
    expect(options).toContain('Harassment');
    expect(options).toContain('Inappropriate Content');
    expect(options).toContain('Other');

    // Severity radio buttons (1-5)
    for (let severity = 1; severity <= 5; severity++) {
      const radio = page.locator(`input[name="direct-warn-severity"][value="${severity}"]`);
      await expect(radio).toBeAttached();
    }

    // Default severity should be 3
    const defaultRadio = page.locator('input[name="direct-warn-severity"][value="3"]');
    await expect(defaultRadio).toBeChecked();

    // Issue Warning button
    const warnBtn = page.locator('#direct-warn-btn');
    await expect(warnBtn).toBeVisible();
    await expect(warnBtn).toContainText('Issue Warning');
  });

  test('warning history section exists', async ({ page }) => {
    const warningHistory = page.locator('#warning-history-list');
    await expect(warningHistory).toBeAttached({ timeout: 15_000 });

    // Should contain either warning items or a "No warnings" placeholder
    const text = await warningHistory.textContent();
    expect(text).toBeTruthy();
  });

  test('suspension section has reason, duration presets, and buttons', async ({ page }) => {
    const suspensionSection = page.locator('#suspension-section');
    await expect(suspensionSection).toBeVisible({ timeout: 15_000 });

    // Suspension status indicator
    const suspensionStatus = page.locator('#suspension-status');
    await expect(suspensionStatus).toBeVisible({ timeout: 15_000 });

    // Reason textarea
    const reasonInput = page.locator('#suspend-reason');
    await expect(reasonInput).toBeVisible();

    // Duration presets: 1 Day, 3 Days, 7 Days, 30 Days, Permanent
    const presets = page.locator('.duration-presets button');
    const presetTexts = await presets.allTextContents();
    expect(presetTexts).toContain('1 Day');
    expect(presetTexts).toContain('3 Days');
    expect(presetTexts).toContain('7 Days');
    expect(presetTexts).toContain('30 Days');
    expect(presetTexts).toContain('Permanent');

    // End date input
    const endDateInput = page.locator('#suspend-end-date');
    await expect(endDateInput).toBeAttached();

    // Can appeal checkbox
    const canAppealCheckbox = page.locator('#suspend-can-appeal');
    await expect(canAppealCheckbox).toBeAttached();

    // Suspend button
    const suspendBtn = page.locator('#suspend-btn');
    await expect(suspendBtn).toBeVisible();
    await expect(suspendBtn).toContainText('Suspend User');
  });

  test('ban buttons exist (ban devices, ban IP, unban all)', async ({ page }) => {
    const banAllDevicesBtn = page.locator('#bans-ban-all-devices');
    await expect(banAllDevicesBtn).toBeAttached({ timeout: 15_000 });
    await expect(banAllDevicesBtn).toContainText('Ban All Devices');

    const banLastIpBtn = page.locator('#bans-ban-last-ip');
    await expect(banLastIpBtn).toBeAttached({ timeout: 15_000 });
    await expect(banLastIpBtn).toContainText('Ban Last IP');

    const unbanAllBtn = page.locator('#bans-unban-all');
    await expect(unbanAllBtn).toBeAttached({ timeout: 15_000 });
    await expect(unbanAllBtn).toContainText('Unban All');

    // View Logs button also present
    const viewLogsBtn = page.locator('#bans-view-logs');
    await expect(viewLogsBtn).toBeAttached({ timeout: 15_000 });
    await expect(viewLogsBtn).toContainText('View Logs');
  });

  test('created and last seen timestamps display', async ({ page }) => {
    const accountInfoSection = page.locator('#account-info-section');
    await expect(accountInfoSection).toBeVisible({ timeout: 15_000 });

    // Created At
    const createdAtField = page.locator('#field-createdAt');
    await expect(createdAtField).toBeVisible({ timeout: 15_000 });

    // Last Seen At
    const lastSeenAtField = page.locator('#field-lastSeenAt');
    await expect(lastSeenAtField).toBeVisible({ timeout: 15_000 });

    // Both should have READ ONLY badges
    const readonlyBadges = accountInfoSection.locator('.readonly-badge');
    const badgeCount = await readonlyBadges.count();
    expect(badgeCount).toBe(2);
  });
});
