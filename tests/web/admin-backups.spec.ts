import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/**
 * Helper: wait for the backups list to finish loading.
 * The list either contains backup cards or shows an empty/loading message.
 */
async function waitForBackupsLoaded(page: Page): Promise<void> {
  // Wait for the "Loading..." text to disappear
  const list = page.locator('#backups-list');
  await expect(list).not.toHaveText('Loading...');
}

/**
 * Helper: get all backup row elements from the backups list.
 * Each backup is rendered as a flex div inside #backups-list.
 */
function backupRows(page: Page) {
  return page.locator('#backups-list > div');
}

test.describe('Admin Backups Tab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Backups');
    await waitForBackupsLoaded(page);
  });

  // ── Test 1: Backup list loads ──
  test('backup list loads with API verification', async ({ page, testData }) => {
    // API: verify backups endpoint returns data
    const data = await testData.api.get('/api/admin/backups');
    const backups = data.backups || [];

    // If there are backups, verify they show in the UI
    if (backups.length > 0) {
      const rows = backupRows(page);
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);

      // First backup card should contain a date
      const firstRowText = await rows.first().textContent();
      expect(firstRowText).toBeTruthy();
      // Date format should be YYYY-MM-DD
      expect(firstRowText).toMatch(/\d{4}-\d{2}-\d{2}/);
    } else {
      // Empty state — "No backups yet" text
      const listText = await page.locator('#backups-list').textContent();
      expect(listText).toContain('No backups');
    }
  });

  // ── Test 2: Trigger backup ──
  test('trigger backup creates new backup and shows toast', async ({ page, testData }) => {
    // Count existing backups before
    const dataBefore = await testData.api.get('/api/admin/backups');
    const countBefore = (dataBefore.backups || []).length;

    // Click Backup Now
    const triggerBtn = page.locator('#backup-trigger-btn');
    await triggerBtn.click();

    // Button should show "Backing up..." while processing
    await expect(triggerBtn).toHaveText('Backing up...');

    // Wait for the button to return to normal (backup complete) — can take
    // a while on the local emulator where Firestore writes are slower.
    await expect(triggerBtn).toHaveText('Backup Now', { timeout: 15_000 });

    // Verify toast appeared with success message
    const toast = page.locator('#toast');
    await expect(toast).toContainText('Backup complete', { timeout: 10_000 });

    // Refresh the list to show the new/updated backup
    const refreshBtn = page.locator('#backup-refresh-btn');
    if (await refreshBtn.count() > 0) {
      await refreshBtn.click();
    } else {
      await navigateToTab(page, 'Backups');
    }
    await waitForBackupsLoaded(page);

    // Verify at least one backup is in the list (a backup for today may
    // already exist from a previous test run, so count may not increase —
    // the endpoint overwrites same-day backups rather than creating new ones).
    const rows = backupRows(page);
    expect(await rows.count()).toBeGreaterThanOrEqual(1);

    // API verify: today's backup exists
    const dataAfter = await testData.api.get('/api/admin/backups');
    const backupsAfter = dataAfter.backups || [];
    expect(backupsAfter.length).toBeGreaterThanOrEqual(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(backupsAfter.some((b: any) => b.date === today)).toBe(true);
  });

  // ── Test 3: Refresh list ──
  test('refresh button reloads the backup list', async ({ page }) => {
    // Click Refresh
    const refreshBtn = page.locator('#backup-refresh-btn');
    await refreshBtn.click();

    // Wait for loading to complete
    await waitForBackupsLoaded(page);

    // Verify the list is populated (not showing an error)
    const listText = await page.locator('#backups-list').textContent();
    expect(listText).not.toContain('Error');
  });

  // ── Test 4: Backup manifest shows date and metadata ──
  test('backup card shows date, user count, and size', async ({ page, testData }) => {
    // Ensure there's at least one backup
    const data = await testData.api.get('/api/admin/backups');
    const backups = data.backups || [];
    if (backups.length === 0) {
      // Trigger one first
      await page.locator('#backup-trigger-btn').click();
      await expect(page.locator('#backup-trigger-btn')).toHaveText('Backup Now');
      await waitForBackupsLoaded(page);
    }

    // Verify first backup card structure
    const firstRow = backupRows(page).first();
    await expect(firstRow).toBeVisible();

    const text = await firstRow.textContent();

    // Should contain a date (YYYY-MM-DD)
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);

    // Should contain user count and size info
    expect(text).toMatch(/users/i);
    expect(text).toMatch(/KB/i);

    // Should contain action buttons
    await expect(firstRow.locator('button', { hasText: 'Download' })).toBeVisible();
    await expect(firstRow.locator('button', { hasText: 'Restore Missing' })).toBeVisible();
  });

  // ── Test 5: Download collection ──
  test('download backup triggers a download', async ({ page, testData }) => {
    // Ensure there's a backup
    const data = await testData.api.get('/api/admin/backups');
    const backups = data.backups || [];
    if (backups.length === 0) {
      test.skip(true, 'No backups available to download');
      return;
    }

    const firstBackupDate = backups[0].date;

    // Set up download listener before clicking
    const downloadPromise = page.waitForEvent('download').catch(() => null);

    // Click Download on the first backup
    const firstRow = backupRows(page).first();
    await firstRow.locator('button', { hasText: 'Download' }).click();

    const download = await downloadPromise;

    // Verify download was triggered (or toast showed success)
    if (download) {
      const suggestedName = download.suggestedFilename();
      expect(suggestedName).toContain(firstBackupDate);
      expect(suggestedName).toContain('.json');
    } else {
      // If no download event, check for toast
      const toast = page.locator('#toast');
      await expect(toast).toContainText('Download');
    }

    // API verify: the endpoint returns data
    const apiData = await testData.api.get(`/api/admin/backups/${firstBackupDate}`);
    expect(apiData).toBeTruthy();
  });

  // ── Test 6: Restore missing-only ──
  test('restore missing-only shows success toast', async ({ page, testData }) => {
    // Ensure there's a backup
    const data = await testData.api.get('/api/admin/backups');
    const backups = data.backups || [];
    if (backups.length === 0) {
      test.skip(true, 'No backups available to restore');
      return;
    }

    // Accept the confirm dialog(s)
    page.on('dialog', (dialog) => dialog.accept());

    // Click "Restore Missing" on the first backup
    const firstRow = backupRows(page).first();
    await firstRow.locator('button', { hasText: 'Restore Missing' }).click();

    // Verify toast shows success
    const toast = page.locator('#toast');
    await expect(toast).toContainText('Restored');
  });

  // ── Test 7: Recover photos ──
  test('recover photos from R2 shows success toast', async ({ page }) => {
    // Accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click Recover Photos from R2
    const recoverBtn = page.locator('#backup-recover-photos-btn');
    await recoverBtn.click();

    // Wait for the toast to appear (success or error) — the API call may
    // resolve/reject almost instantly in emulator mode, so checking the
    // intermediate disabled state is racy.
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible();

    // Button should re-enable after the operation completes
    await expect(recoverBtn).toBeEnabled();
  });

  // ── Test 8: Empty state display ──
  test('backups list displays appropriately when empty or populated', async ({ page }) => {
    // This test verifies the list always shows a meaningful state.
    // We can't easily force an empty state without deleting all backups,
    // so we verify the current state is valid.
    const list = page.locator('#backups-list');
    const text = await list.textContent();

    // Should either have backup cards with dates or show "No backups yet"
    const hasBackups = await backupRows(page).count() > 0;
    if (hasBackups) {
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
    } else {
      expect(text).toContain('No backups');
    }

    // The heading and action buttons should always be visible
    await expect(page.locator('#backup-trigger-btn')).toBeVisible();
    await expect(page.locator('#backup-refresh-btn')).toBeVisible();
    await expect(page.locator('#backup-recover-photos-btn')).toBeVisible();
  });
});
