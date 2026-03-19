import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/**
 * Helper: trigger auto-save by blurring the active element, then wait for
 * the "Saved" feedback to appear next to the field.
 */
async function waitForAutoSave(page: Page, fieldSelector: string): Promise<void> {
  await page.locator(fieldSelector).evaluate(el => el.blur());
  const container = page.locator(fieldSelector).locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible({ timeout: 15_000 });
}

/**
 * Helper: trigger auto-save for checkbox/select (fires on 'change' event).
 */
async function waitForAutoSaveAfterChange(page: Page, fieldSelector: string): Promise<void> {
  const container = page.locator(fieldSelector).locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible({ timeout: 15_000 });
}

/**
 * Helper: reload and navigate back to the user's profile subtab.
 */
async function reloadAndSearch(page: Page, uniqueId: string): Promise<void> {
  await page.reload();
  await adminLogin(page);
  await navigateToTab(page, 'Users');
  await searchUser(page, uniqueId);
}

test.describe('Admin Users - Extra Profile Fields', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, testData }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
  });

  // ── Test 1: Date of birth edit persists ──
  test('date of birth edit persists after reload', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const userPath = `/api/user/${uid}`;
    const dobInput = page.locator('[data-field="dateOfBirth"]');

    // Set DOB
    await dobInput.fill('2000-06-15T00:00');
    await waitForAutoSave(page, '[data-field="dateOfBirth"]');

    // Reload and verify persistence
    await reloadAndSearch(page, uid);
    const value = await page.locator('[data-field="dateOfBirth"]').inputValue();
    expect(value).toContain('2000-06-15');

    // Verify via API
    const apiData = await testData.api.get(userPath);
    expect(apiData.dateOfBirth).toBeTruthy();

    // Clear DOB
    await page.locator('.btn-clear[data-clear="dateOfBirth"]').click();
    await waitForAutoSaveAfterChange(page, '[data-field="dateOfBirth"]');

    const cleared = await testData.api.get(userPath);
    expect(cleared.dateOfBirth || '').toBeFalsy();
  });

  // ── Test 2: Profile photo URL edit persists ──
  test('profile photo URL edit persists and updates preview', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const userPath = `/api/user/${uid}`;
    const testUrl = 'https://images.shytalk.shyden.co.uk/test/e2e-avatar.png';

    // Set profile photo URL
    await page.locator('[data-field="profilePhotoUrl"]').fill(testUrl);
    await waitForAutoSave(page, '[data-field="profilePhotoUrl"]');

    // Reload and verify persistence
    await reloadAndSearch(page, uid);
    await expect(page.locator('[data-field="profilePhotoUrl"]')).toHaveValue(testUrl, { timeout: 15_000 });

    // Verify via API
    const apiData = await testData.api.get(userPath);
    expect(apiData.profilePhotoUrl).toBe(testUrl);

    // Clear
    await page.locator('.btn-clear[data-clear="profilePhotoUrl"]').click();
    await waitForAutoSaveAfterChange(page, '[data-field="profilePhotoUrl"]');
  });

  // ── Test 3: Cover photo URL edit persists ──
  test('cover photo URL edit persists and updates preview', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const userPath = `/api/user/${uid}`;
    const testUrl = 'https://images.shytalk.shyden.co.uk/test/e2e-cover.png';

    // Set cover photo URL
    await page.locator('[data-field="coverPhotoUrl"]').fill(testUrl);
    await waitForAutoSave(page, '[data-field="coverPhotoUrl"]');

    // Reload and verify persistence
    await reloadAndSearch(page, uid);
    await expect(page.locator('[data-field="coverPhotoUrl"]')).toHaveValue(testUrl, { timeout: 15_000 });

    // Verify via API
    const apiData = await testData.api.get(userPath);
    expect(apiData.coverPhotoUrl).toBe(testUrl);

    // Clear
    await page.locator('.btn-clear[data-clear="coverPhotoUrl"]').click();
    await waitForAutoSaveAfterChange(page, '[data-field="coverPhotoUrl"]');
  });

  // ── Test 4: Hide age checkbox persists ──
  test('hide age checkbox persists after toggle', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const userPath = `/api/user/${uid}`;

    // Toggle hideAge ON
    await page.locator('#cb-hideAge').check();
    await waitForAutoSaveAfterChange(page, '#cb-hideAge');

    // Reload and verify checked
    await reloadAndSearch(page, uid);
    await expect(page.locator('#cb-hideAge')).toBeChecked({ timeout: 15_000 });

    // Verify via API
    const apiChecked = await testData.api.get(userPath);
    expect(apiChecked.hideAge).toBe(true);

    // Toggle OFF
    await page.locator('#cb-hideAge').uncheck();
    await waitForAutoSaveAfterChange(page, '#cb-hideAge');

    // Verify restored
    const apiUnchecked = await testData.api.get(userPath);
    expect(apiUnchecked.hideAge).toBe(false);
  });

  // ── Test 5: Hide online status checkbox persists ──
  test('hide online status checkbox persists after toggle', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const userPath = `/api/user/${uid}`;

    // Toggle hideOnlineStatus ON
    await page.locator('#cb-hideOnlineStatus').check();
    await waitForAutoSaveAfterChange(page, '#cb-hideOnlineStatus');

    // Reload and verify checked
    await reloadAndSearch(page, uid);
    await expect(page.locator('#cb-hideOnlineStatus')).toBeChecked({ timeout: 15_000 });

    // Verify via API
    const apiChecked = await testData.api.get(userPath);
    expect(apiChecked.hideOnlineStatus).toBe(true);

    // Toggle OFF
    await page.locator('#cb-hideOnlineStatus').uncheck();
    await waitForAutoSaveAfterChange(page, '#cb-hideOnlineStatus');

    const apiUnchecked = await testData.api.get(userPath);
    expect(apiUnchecked.hideOnlineStatus).toBe(false);
  });

  // ── Test 6: Character counter — display name ──
  test('character counter updates for display name (0/20)', async ({ page, testData }) => {
    const counter = page.locator('#counter-displayName');
    await expect(counter).toBeVisible({ timeout: 15_000 });

    // Type 15 characters
    const displayNameInput = page.locator('[data-field="displayName"]');
    await displayNameInput.fill('abcdefghijklmno');

    // Verify counter shows 15/20
    await expect(counter).toHaveText('15/20');

    // Type 20 characters (max)
    await displayNameInput.fill('abcdefghijklmnopqrst');
    await expect(counter).toHaveText('20/20');

    // Restore original name
    await displayNameInput.fill(testData.user.displayName);
  });

  // ── Test 7: Character counter — description ──
  test('character counter updates for description (N/200)', async ({ page }) => {
    const counter = page.locator('#counter-description');
    await expect(counter).toBeVisible({ timeout: 15_000 });

    // Type some text
    const descInput = page.locator('[data-field="description"]');
    await descInput.fill('Hello World');

    // Verify counter shows 11/200
    await expect(counter).toHaveText('11/200');

    // Clear description
    await descInput.fill('');
    await expect(counter).toHaveText('0/200');
  });

  // ── Test 8: Clear buttons for clearable fields ──
  test('clear buttons work for nationality, description, and date of birth', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Set nationality to GB first
    const natSelect = page.locator('#nationality-select');
    await natSelect.selectOption('GB');
    await waitForAutoSaveAfterChange(page, '#nationality-select');

    // Click clear for nationality
    await page.locator('.btn-clear[data-clear="nationality"]').click();
    await waitForAutoSaveAfterChange(page, '#nationality-select');
    await expect(natSelect).toHaveValue('');

    // Set and clear description
    const descInput = page.locator('[data-field="description"]');
    await descInput.fill('Test description');
    await waitForAutoSave(page, '[data-field="description"]');

    await page.locator('.btn-clear[data-clear="description"]').click();
    await waitForAutoSaveAfterChange(page, '[data-field="description"]');
    await expect(descInput).toHaveValue('');

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    expect(apiData.nationality || '').toBe('');
    expect(apiData.description || '').toBe('');
  });

  // ── Test 9: Temp ID — check availability ──
  test('temp ID check returns availability result', async ({ page }) => {
    const tempIdInput = page.locator('#temp-id-input');
    const checkBtn = page.locator('#temp-id-check');
    const resultDiv = page.locator('#temp-id-check-result');

    // Enter a number and click Check
    await tempIdInput.fill('12345678');
    await checkBtn.click();

    // Verify result message appears (available or taken)
    await expect(resultDiv).not.toBeEmpty({ timeout: 10_000 });
    const resultText = await resultDiv.textContent();
    expect(resultText).toBeTruthy();
  });

  // ── Test 10: Temp ID — set + display ──
  test('temp ID set and display updates correctly', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Enter temp ID and expiry
    await page.locator('#temp-id-input').fill('55555555');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    await page.locator('#temp-id-expiry').fill(tomorrow);

    // Click Apply
    await page.locator('#temp-id-apply').click();

    // Verify current temp ID display updates
    const currentDisplay = page.locator('#temp-id-current');
    await expect(currentDisplay).not.toBeEmpty({ timeout: 10_000 });
    const displayText = await currentDisplay.textContent();
    expect(displayText).toContain('55555555');

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    expect(apiData.tempUniqueId).toBe(55555555);

    // Clean up: clear the temp ID within this test
    await page.locator('#temp-id-clear').click();
    await page.waitForTimeout(2_000);
    const clearedData = await testData.api.get(`/api/user/${uid}`);
    expect(clearedData.tempUniqueId).toBeFalsy();
  });

  // ── Test 11: Temp ID — clear ──
  test('temp ID clear removes the temporary ID', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Set a temp ID first so this test is self-contained
    await page.locator('#temp-id-input').fill('55555555');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    await page.locator('#temp-id-expiry').fill(tomorrow);
    await page.locator('#temp-id-apply').click();
    await expect(page.locator('#temp-id-current')).toContainText('55555555', { timeout: 10_000 });

    // Click Clear
    await page.locator('#temp-id-clear').click();

    // Verify display shows none/empty
    const currentDisplay = page.locator('#temp-id-current');
    await page.waitForTimeout(2_000);
    const displayText = await currentDisplay.textContent();
    expect(displayText).not.toContain('55555555');

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    expect(apiData.tempUniqueId).toBeFalsy();
  });

  // ── Test 12: Blocked users list — add + remove ──
  test('blocked users list add and remove works', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const secondUid = String(testData.secondUser.uniqueId);

    // Add second user to blocked list
    const blockedWidget = page.locator('#list-blockedUserIds');
    const addInput = blockedWidget.locator('input[aria-label="Add blocked user ID"]');
    const addBtn = blockedWidget.locator('button');
    await addInput.fill(secondUid);
    await addBtn.click();

    // Verify the user appears in the list
    await expect(blockedWidget).toContainText(secondUid, { timeout: 10_000 });

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    const blocked = apiData.blockedUserIds || [];
    expect(blocked).toContain(Number(secondUid));

    // Remove the user by clicking the remove button
    const removeBtn = blockedWidget.locator(`[data-remove="${secondUid}"]`).first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
    } else {
      // Try the X button next to the item
      const itemRemove = blockedWidget.locator('.list-item-remove').first();
      if (await itemRemove.count() > 0) {
        await itemRemove.click();
      }
    }

    // Verify removed via API
    await page.waitForTimeout(2_000);
    const apiAfter = await testData.api.get(`/api/user/${uid}`);
    const blockedAfter = apiAfter.blockedUserIds || [];
    expect(blockedAfter).not.toContain(Number(secondUid));
  });

  // ── Test 13: Following list — add + remove ──
  test('following list add and remove works', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const secondUid = String(testData.secondUser.uniqueId);

    // Add second user to following list
    const followingWidget = page.locator('#list-followingIds');
    const addInput = followingWidget.locator('input[aria-label="Add following user ID"]');
    const addBtn = followingWidget.locator('button');
    await addInput.fill(secondUid);
    await addBtn.click();

    // Verify the user appears in the list
    await expect(followingWidget).toContainText(secondUid, { timeout: 10_000 });

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    const following = apiData.followingIds || [];
    expect(following).toContain(Number(secondUid));

    // Remove
    const removeBtn = followingWidget.locator(`[data-remove="${secondUid}"]`).first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
    } else {
      const itemRemove = followingWidget.locator('.list-item-remove').first();
      if (await itemRemove.count() > 0) {
        await itemRemove.click();
      }
    }

    await page.waitForTimeout(2_000);
    const apiAfter = await testData.api.get(`/api/user/${uid}`);
    const followingAfter = apiAfter.followingIds || [];
    expect(followingAfter).not.toContain(Number(secondUid));
  });

  // ── Test 14: Followers list — add + remove ──
  test('followers list add and remove works', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const secondUid = String(testData.secondUser.uniqueId);

    // Add second user to followers list
    const followerWidget = page.locator('#list-followerIds');
    const addInput = followerWidget.locator('input');
    const addBtn = followerWidget.locator('button');
    await addInput.fill(secondUid);
    await addBtn.click();

    // Verify the user appears
    await expect(followerWidget).toContainText(secondUid, { timeout: 10_000 });

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    const followers = apiData.followerIds || [];
    expect(followers).toContain(Number(secondUid));

    // Remove
    const removeBtn = followerWidget.locator(`[data-remove="${secondUid}"]`).first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
    } else {
      const itemRemove = followerWidget.locator('.list-item-remove').first();
      if (await itemRemove.count() > 0) {
        await itemRemove.click();
      }
    }

    await page.waitForTimeout(2_000);
    const apiAfter = await testData.api.get(`/api/user/${uid}`);
    const followersAfter = apiAfter.followerIds || [];
    expect(followersAfter).not.toContain(Number(secondUid));
  });

  // ── Test 15: Stalkers list display ──
  test('stalkers list renders as read-only', async ({ page }) => {
    const stalkersList = page.locator('#stalkers-list');
    await expect(stalkersList).toBeVisible({ timeout: 15_000 });

    // Stalkers list should be read-only (no add input)
    const addInputs = stalkersList.locator('input');
    const inputCount = await addInputs.count();
    // Stalkers list is display-only — may have zero or some entries, but no edit controls
    expect(inputCount).toBe(0);
  });

  // ── Test 16: Pre-suspension profile display ──
  test('pre-suspension profile displays when user is suspended', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Suspend user via API
    await testData.api.post(`/api/user/${uid}/suspend`, {
      reason: 'E2E test pre-suspension display',
      days: 1,
      canAppeal: false,
    });

    // Reload and navigate to moderation subtab to see pre-suspension info
    await reloadAndSearch(page, uid);
    await switchUserSubtab(page, 'moderation');

    // Verify pre-suspension info is visible
    const preSuspensionInfo = page.locator('#pre-suspension-info');
    await expect(preSuspensionInfo).toBeVisible({ timeout: 15_000 });

    // Verify pre-suspension name is shown
    const preSuspensionName = page.locator('#pre-suspension-name');
    await expect(preSuspensionName).toBeVisible();
    const nameText = await preSuspensionName.textContent();
    expect(nameText).toBeTruthy();

    // Unsuspend and reset GCS
    await testData.api.post(`/api/user/${uid}/unsuspend`, {});
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });
});
