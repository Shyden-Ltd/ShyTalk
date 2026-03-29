import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

/**
 * Admin Users - Account Deletion Subtab Tests
 *
 * Tests for admin-initiated account deletion management:
 * - Schedule deletion with reason
 * - Cancel scheduled deletion
 * - Deletion status badge visibility
 * - Cannot schedule deletion for already-scheduled user
 * - Audit log entry creation
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

test.describe('Admin Users - Account Deletion', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, testData }) => {
    // Auto-accept all confirm() and prompt() dialogs
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('E2E test deletion reason');
      } else {
        await dialog.accept();
      }
    });

    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
    await switchUserSubtab(page, 'moderation');
  });

  // ── Test 1: Schedule deletion button is visible ──
  test('schedule deletion button is visible on moderation tab', async ({ page }) => {
    const deleteBtn = page.locator('#schedule-deletion-btn');
    await expect(deleteBtn).toBeVisible({ timeout: 15_000 });
  });

  // ── Test 2: Schedule account deletion ──
  test('schedule account deletion with reason', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Click the "Schedule Deletion" button
    const deleteBtn = page.locator('#schedule-deletion-btn');
    await deleteBtn.click();

    // Verify the deletion status badge appears
    const deletionBadge = page.locator('#deletion-status-badge');
    await expect(deletionBadge).toBeVisible({ timeout: 15_000 });
    await expect(deletionBadge).toContainText(/scheduled|pending|deletion/i);

    // Verify via API that deletion fields are set
    const userData = await testData.api.get(`/api/user/${uid}`);
    expect(userData.deletionScheduledAt).toBeTruthy();
    expect(userData.deletionReason).toBe('admin');
    expect(userData.deletionExecuteAt).toBeTruthy();
  });

  // ── Test 3: Cancel scheduled deletion ──
  test('cancel scheduled deletion', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // The user should have deletion scheduled from the previous test
    // If not, schedule it first
    const userData = await testData.api.get(`/api/user/${uid}`);
    if (!userData.deletionScheduledAt) {
      await testData.api.post(`/api/user/${uid}/delete`, { reason: 'test' });
      await reloadAndNavigateToModeration(page, uid);
    }

    // Click the "Cancel Deletion" button
    const cancelBtn = page.locator('#cancel-deletion-btn');
    await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
    await cancelBtn.click();

    // Verify the deletion badge is no longer visible
    const deletionBadge = page.locator('#deletion-status-badge');
    await expect(deletionBadge).not.toBeVisible({ timeout: 15_000 });

    // Verify via API that deletion fields are cleared
    const updatedData = await testData.api.get(`/api/user/${uid}`);
    expect(updatedData.deletionScheduledAt).toBeFalsy();
    expect(updatedData.deletionReason).toBeFalsy();
    expect(updatedData.deletionExecuteAt).toBeFalsy();
  });

  // ── Test 4: Deletion status shows days remaining ──
  test('deletion status badge shows days remaining', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Schedule deletion via API
    await testData.api.post(`/api/user/${uid}/delete`, { reason: 'test days remaining' });

    // Reload to see the status
    await reloadAndNavigateToModeration(page, uid);

    const deletionBadge = page.locator('#deletion-status-badge');
    await expect(deletionBadge).toBeVisible({ timeout: 15_000 });
    // Should show days remaining
    await expect(deletionBadge).toContainText(/\d+\s*days?/i);

    // Cleanup: cancel the deletion
    await testData.api.post(`/api/user/${uid}/cancel-delete`);
  });

  // ── Test 5: Deletion creates audit log entry ──
  test('scheduling deletion creates audit log entry', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Schedule deletion
    await testData.api.post(`/api/user/${uid}/delete`, { reason: 'audit log test' });

    // Navigate to Logs tab and check for the entry
    await navigateToTab(page, 'Logs');
    const logsList = page.locator('#audit-logs-list, #logs-list, .log-entry');
    // Look for a deletion-related audit entry
    await expect(
      page.getByText(/ACCOUNT_DELETION_SCHEDULED|account.*deletion.*scheduled/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Cleanup
    await testData.api.post(`/api/user/${uid}/cancel-delete`);
  });
});
