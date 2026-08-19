import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/**
 * Helper: trigger auto-save by blurring the active element, then wait for
 * the "Saved" feedback to appear next to the field.
 */
async function waitForAutoSave(page: Page, fieldSelector: string): Promise<void> {
  await page.locator(fieldSelector).evaluate((el) => el.blur());
  const container = page.locator(fieldSelector).locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible();
}

/**
 * Helper: trigger auto-save for checkbox/select (fires on 'change' event).
 */
async function waitForAutoSaveAfterChange(page: Page, fieldSelector: string): Promise<void> {
  const container = page.locator(fieldSelector).locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible();
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

  // Test 16 ("pre-suspension profile displays when user is suspended")
  // suspends the worker-scoped user mid-test and only unsuspends at
  // the END. If any assertion before line 453 fails, the user is left
  // suspended for downstream test files — same leak class as
  // admin-appeals and admin-cross-tab. Defensive afterAll keeps the
  // leak contained even when test 16 dies mid-flight. Per
  // [[feedback-test-isolation-no-leaks]].
  test.afterAll(async ({ testData }) => {
    try {
      await testData.api.post(`/api/user/${testData.user.uniqueId}/unsuspend`, {});
    } catch (err) {
      console.warn(`[admin-users-extra.afterAll] unsuspend failed: ${(err as Error).message}`);
    }
  });

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
    await expect
      .poll(async () => await page.locator('[data-field="dateOfBirth"]').inputValue())
      .toContain('2000-06-15');

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
    await expect(page.locator('[data-field="profilePhotoUrl"]')).toHaveValue(testUrl);

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
    await expect(page.locator('[data-field="coverPhotoUrl"]')).toHaveValue(testUrl);

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
    await expect(page.locator('#cb-hideAge')).toBeChecked();

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
    await expect(page.locator('#cb-hideOnlineStatus')).toBeChecked();

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
    await expect(counter).toBeVisible();

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
    await expect(counter).toBeVisible();

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
  test('clear buttons work for nationality, description, and date of birth', async ({
    page,
    testData,
  }) => {
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
    await expect(resultDiv).not.toBeEmpty();
    await expect(resultDiv).not.toBeEmpty();
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

    // Verify current temp ID display updates (wait for API response to update the text)
    const currentDisplay = page.locator('#temp-id-current');
    await expect(currentDisplay).toContainText('55555555');

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    expect(apiData.tempUniqueId).toBe(55555555);

    // Clean up: clear the temp ID within this test
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#temp-id-clear').click();
    await expect(page.locator('#temp-id-current')).toContainText('No temporary ID set');
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
    await expect(page.locator('#temp-id-current')).toContainText('55555555');

    // Click Clear (accept the confirm dialog)
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#temp-id-clear').click();

    // Verify display shows none/empty
    const currentDisplay = page.locator('#temp-id-current');
    // Poll the text the assertion reads — it updates when the write lands, and
    // 2s was a bet on that rather than an observation of it.
    await expect.poll(() => currentDisplay.textContent()).not.toContain('55555555');

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
    // Not `locator('button')` — once the list has an entry, its × remove button
    // is a button inside this widget too, and the loose locator becomes
    // ambiguous. It only ever resolved because the list started empty.
    const addBtn = blockedWidget.getByRole('button', { name: 'Add' });
    await addInput.fill(secondUid);
    await addBtn.click();

    // Verify the user appears in the list
    await expect(blockedWidget).toContainText(secondUid);

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    const blocked = apiData.blockedUserIds || [];
    expect(blocked).toContain(Number(secondUid));

    // Remove THAT user's row, not "whichever row is first". The previous
    // version looked for `[data-remove="<uid>"]`, which has never existed in
    // the admin panel — so the primary branch never matched and the fallback
    // always ran. Targeting the row by the id it displays means a renamed
    // control fails here instead of quietly falling through.
    const blockedRow = blockedWidget
      .locator('.list-item')
      .filter({ has: page.getByText(secondUid, { exact: true }) });
    await expect(blockedRow).toHaveCount(1);
    await blockedRow.locator('.list-item-remove').click();

    // Poll the API until it reflects the removal, rather than sleeping and
    // reading once — a slow write used to read as "still blocked".
    await expect
      .poll(async () => ((await testData.api.get(`/api/user/${uid}`)).blockedUserIds || []).length)
      .toBe(0);
    const apiAfter = await testData.api.get(`/api/user/${uid}`);
    const blockedAfter = apiAfter.blockedUserIds || [];
    expect(blockedAfter).not.toContain(Number(secondUid));
  });

  // ── Test 12b: Blocked users list — removing one of several ──
  test('removing one blocked user leaves the others alone', async ({ page, testData }) => {
    // Every list test above works with exactly ONE entry, which is the one
    // case where "remove the right row" cannot be distinguished from "remove
    // any row". Each remove button closes over the index it was built with,
    // so a one-item list can never show an off-by-one.
    const uid = String(testData.user.uniqueId);
    const ids = ['77700001', '77700002', '77700003'];

    const blockedWidget = page.locator('#list-blockedUserIds');
    const addInput = blockedWidget.locator('input[aria-label="Add blocked user ID"]');
    // Not `locator('button')` — once the list has an entry, its × remove button
    // is a button inside this widget too, and the loose locator becomes
    // ambiguous. It only ever resolved because the list started empty.
    const addBtn = blockedWidget.getByRole('button', { name: 'Add' });
    for (const id of ids) {
      await addInput.fill(id);
      await addBtn.click();
      await expect(blockedWidget.getByText(id, { exact: true })).toBeVisible();
    }

    // Remove the MIDDLE one — the position where a stale index shows up.
    const middle = blockedWidget
      .locator('.list-item')
      .filter({ has: page.getByText(ids[1], { exact: true }) });
    await middle.locator('.list-item-remove').click();

    await expect
      .poll(async () =>
        ((await testData.api.get(`/api/user/${uid}`)).blockedUserIds || []).map(String).sort(),
      )
      .toEqual([ids[0], ids[2]]);

    // And the UI agrees with the API — a list that removed the right record
    // but rendered the wrong row is still broken from where the admin sits.
    await expect(blockedWidget.getByText(ids[0], { exact: true })).toBeVisible();
    await expect(blockedWidget.getByText(ids[2], { exact: true })).toBeVisible();
    await expect(blockedWidget.getByText(ids[1], { exact: true })).toHaveCount(0);
  });

  // ── Test 13: Following list — add + remove ──
  test('following list add and remove works', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);
    const secondUid = String(testData.secondUser.uniqueId);

    // Add second user to following list
    const followingWidget = page.locator('#list-followingIds');
    const addInput = followingWidget.locator('input[aria-label="Add following user ID"]');
    const addBtn = followingWidget.getByRole('button', { name: 'Add' });
    await addInput.fill(secondUid);
    await addBtn.click();

    // Verify the user appears in the list
    await expect(followingWidget).toContainText(secondUid);

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    const following = apiData.followingIds || [];
    expect(following).toContain(Number(secondUid));

    // Remove that specific row — see the blocked-list test for why the old
    // `[data-remove]` locator was dead.
    const followingRow = followingWidget
      .locator('.list-item')
      .filter({ has: page.getByText(secondUid, { exact: true }) });
    await expect(followingRow).toHaveCount(1);
    await followingRow.locator('.list-item-remove').click();

    await expect
      .poll(async () => ((await testData.api.get(`/api/user/${uid}`)).followingIds || []).length)
      .toBe(0);
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
    const addBtn = followerWidget.getByRole('button', { name: 'Add' });
    await addInput.fill(secondUid);
    await addBtn.click();

    // Verify the user appears
    await expect(followerWidget).toContainText(secondUid);

    // Verify via API
    const apiData = await testData.api.get(`/api/user/${uid}`);
    const followers = apiData.followerIds || [];
    expect(followers).toContain(Number(secondUid));

    // Remove that specific row — see the blocked-list test for why the old
    // `[data-remove]` locator was dead.
    const followerRow = followerWidget
      .locator('.list-item')
      .filter({ has: page.getByText(secondUid, { exact: true }) });
    await expect(followerRow).toHaveCount(1);
    await followerRow.locator('.list-item-remove').click();

    await expect
      .poll(async () => ((await testData.api.get(`/api/user/${uid}`)).followerIds || []).length)
      .toBe(0);
    const apiAfter = await testData.api.get(`/api/user/${uid}`);
    const followersAfter = apiAfter.followerIds || [];
    expect(followersAfter).not.toContain(Number(secondUid));
  });

  // ── Test 15: Stalkers list display ──
  test('stalkers list renders as read-only', async ({ page }) => {
    const stalkersList = page.locator('#stalkers-list');
    await expect(stalkersList).toBeVisible();

    // Stalkers list should be read-only (no add input)
    const addInputs = stalkersList.locator('input');
    // Stalkers list is display-only — may have zero or some entries, but no edit controls
    await expect(addInputs).toHaveCount(0);
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
    await expect(preSuspensionInfo).toBeVisible();

    // Verify pre-suspension name is shown
    const preSuspensionName = page.locator('#pre-suspension-name');
    await expect(preSuspensionName).toBeVisible();
    await expect(preSuspensionName).not.toBeEmpty();

    // Unsuspend and reset GCS
    await testData.api.post(`/api/user/${uid}/unsuspend`, {});
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });
});
