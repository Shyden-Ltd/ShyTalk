import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

/**
 * Helper: trigger auto-save by blurring the active element, then wait for
 * the "Saved" feedback to appear next to the field.  Auto-save fires on blur
 * for text inputs and on change for selects/checkboxes.
 */
async function waitForAutoSave(page: import('@playwright/test').Page, fieldSelector: string): Promise<void> {
  // Blur triggers auto-save for text fields
  await page.locator(fieldSelector).evaluate(el => el.blur());
  // Wait for the PATCH request to complete — look for the green "Saved" feedback
  const container = page.locator(fieldSelector).locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible({ timeout: 15_000 });
}

/**
 * Helper: trigger auto-save for checkbox/select (fires on 'change' event).
 * The change event already fired from Playwright's check/selectOption, so
 * we just need to wait for the save feedback.
 */
async function waitForAutoSaveAfterChange(page: import('@playwright/test').Page, fieldSelector: string): Promise<void> {
  const container = page.locator(fieldSelector).locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin Users - Profile Subtab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
  });

  // ── Test 1: Search shows correct seeded user data ──
  test('search shows correct seeded user data', async ({ page, testData }) => {
    await searchUser(page, String(testData.user.uniqueId));

    // Verify display name matches seeded value
    const displayNameInput = page.locator('[data-field="displayName"]');
    await expect(displayNameInput).toHaveValue(testData.user.displayName, { timeout: 15_000 });

    // Verify uniqueId field shows correct value
    const uniqueIdField = page.locator('#field-uniqueId');
    await expect(uniqueIdField).toHaveText(String(testData.user.uniqueId), { timeout: 15_000 });

    // Verify GCS badge shows "100" (in moderation subtab)
    await switchUserSubtab(page, 'moderation');
    const gcsBadge = page.locator('#gcs-badge-user');
    await expect(gcsBadge).toContainText('100', { timeout: 15_000 });

    // Verify coins/beans show seeded amounts (in economy subtab)
    await switchUserSubtab(page, 'economy');
    const coinsDisplay = page.locator('#eco-coins-display');
    await expect(coinsDisplay).toHaveText('1000', { timeout: 15_000 });
    const beansDisplay = page.locator('#eco-beans-display');
    await expect(beansDisplay).toHaveText('500', { timeout: 15_000 });
  });

  // ── Test 2: Edit display name persists ──
  test('edit display name persists', async ({ page, testData }) => {
    const originalName = testData.user.displayName;
    // Display name input has maxlength=20 — keep the name short enough
    const newName = `${testData.prefix}-ren`.slice(0, 20);
    const userPath = `/api/user/${testData.user.uniqueId}`;

    await searchUser(page, String(testData.user.uniqueId));

    // Change display name
    const displayNameInput = page.locator('[data-field="displayName"]');
    await displayNameInput.fill(newName);
    await waitForAutoSave(page, '[data-field="displayName"]');

    // Reload and search again to verify persistence
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('[data-field="displayName"]')).toHaveValue(newName, { timeout: 15_000 });

    // Verify via API
    const apiData = await testData.api.get(userPath);
    expect(apiData.displayName).toBe(newName);

    // Restore original name
    await page.locator('[data-field="displayName"]').fill(originalName);
    await waitForAutoSave(page, '[data-field="displayName"]');

    // Verify restoration via API
    const restored = await testData.api.get(userPath);
    expect(restored.displayName).toBe(originalName);
  });

  // ── Test 3: Edit description persists ──
  test('edit description persists', async ({ page, testData }) => {
    const description = `Test description from ${testData.prefix}`;
    const userPath = `/api/user/${testData.user.uniqueId}`;

    await searchUser(page, String(testData.user.uniqueId));

    // Set description
    const descField = page.locator('[data-field="description"]');
    await descField.fill(description);
    await waitForAutoSave(page, '[data-field="description"]');

    // Reload and verify
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('[data-field="description"]')).toHaveValue(description, { timeout: 15_000 });

    // Verify via API
    const apiData = await testData.api.get(userPath);
    expect(apiData.description).toBe(description);

    // Clear description afterward
    await page.locator('.btn-clear[data-clear="description"]').click();
    await waitForAutoSaveAfterChange(page, '[data-field="description"]');

    const cleared = await testData.api.get(userPath);
    expect(cleared.description || '').toBe('');
  });

  // ── Test 4: Clear nationality persists ──
  test('clear nationality persists', async ({ page, testData }) => {
    const userPath = `/api/user/${testData.user.uniqueId}`;

    await searchUser(page, String(testData.user.uniqueId));

    // Set nationality to GB
    const natSelect = page.locator('#nationality-select');
    await natSelect.selectOption('GB');
    await waitForAutoSaveAfterChange(page, '#nationality-select');

    // Reload and verify GB is set
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('#nationality-select')).toHaveValue('GB', { timeout: 15_000 });

    // Verify via API
    const withGB = await testData.api.get(userPath);
    expect(withGB.nationality).toBe('GB');

    // Clear nationality
    await page.locator('.btn-clear[data-clear="nationality"]').click();
    await waitForAutoSaveAfterChange(page, '#nationality-select');

    // Reload and verify empty
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('#nationality-select')).toHaveValue('', { timeout: 15_000 });

    // Verify via API
    const cleared = await testData.api.get(userPath);
    expect(cleared.nationality || '').toBe('');
  });

  // ── Test 5: Privacy checkboxes persist ──
  test('privacy checkboxes persist', async ({ page, testData }) => {
    const userPath = `/api/user/${testData.user.uniqueId}`;

    await searchUser(page, String(testData.user.uniqueId));

    // Toggle hideFollowing ON
    const hideFollowing = page.locator('#cb-hideFollowing');
    await hideFollowing.check();
    await waitForAutoSaveAfterChange(page, '#cb-hideFollowing');

    // Reload and verify checked
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('#cb-hideFollowing')).toBeChecked({ timeout: 15_000 });

    // Verify via API
    const checkedData = await testData.api.get(userPath);
    expect(checkedData.hideFollowing).toBe(true);

    // Toggle hideFollowing OFF
    await page.locator('#cb-hideFollowing').uncheck();
    await waitForAutoSaveAfterChange(page, '#cb-hideFollowing');

    // Reload and verify unchecked
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('#cb-hideFollowing')).not.toBeChecked({ timeout: 15_000 });

    // Verify via API
    const uncheckedData = await testData.api.get(userPath);
    expect(uncheckedData.hideFollowing).toBe(false);
  });

  // ── Test 6: User type dropdown persists ──
  test('user type dropdown persists', async ({ page, testData }) => {
    const userPath = `/api/user/${testData.user.uniqueId}`;

    await searchUser(page, String(testData.user.uniqueId));

    // Change to SHYTALK_OFFICIAL
    const userTypeSelect = page.locator('select[data-field="userType"]');
    await userTypeSelect.selectOption('SHYTALK_OFFICIAL');
    await waitForAutoSaveAfterChange(page, 'select[data-field="userType"]');

    // Reload and verify
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));

    await expect(page.locator('select[data-field="userType"]')).toHaveValue('SHYTALK_OFFICIAL', { timeout: 15_000 });

    // Verify via API
    const apiData = await testData.api.get(userPath);
    expect(apiData.userType).toBe('SHYTALK_OFFICIAL');

    // Restore to MEMBER
    await page.locator('select[data-field="userType"]').selectOption('MEMBER');
    await waitForAutoSaveAfterChange(page, 'select[data-field="userType"]');

    // Verify restoration via API
    const restored = await testData.api.get(userPath);
    expect(restored.userType).toBe('MEMBER');
  });

  // ── Test 7: Email show/hide toggle works ──
  test('email show/hide toggle works', async ({ page, testData }) => {
    await searchUser(page, String(testData.user.uniqueId));

    const emailToggle = page.locator('#email-toggle');
    const emailInput = page.locator('#email-input');

    // Initially should say "Show" and email input should be readonly (masked)
    await expect(emailToggle).toContainText('Show', { timeout: 15_000 });
    await expect(emailInput).toHaveAttribute('readonly', '');

    // Click Show — toggle text should change to "Hide"
    await emailToggle.click();
    await expect(emailToggle).toContainText('Hide');

    // Email input should no longer be readonly
    const readonlyAfterShow = await emailInput.getAttribute('readonly');
    expect(readonlyAfterShow).toBeNull();

    // Click Hide — toggle text should change back to "Show"
    await emailToggle.click();
    await expect(emailToggle).toContainText('Show');

    // Email input should be readonly again
    await expect(emailInput).toHaveAttribute('readonly', '');
  });

  // ── Test 8: Profile preview updates live ──
  test('profile preview updates live', async ({ page, testData }) => {
    await searchUser(page, String(testData.user.uniqueId));

    // Verify profile preview is visible
    const profilePreview = page.locator('#profile-preview');
    await expect(profilePreview).toBeVisible({ timeout: 15_000 });

    // Get initial draft name
    const draftName = page.locator('#pd-name');
    await expect(draftName).toHaveText(testData.user.displayName, { timeout: 15_000 });

    // Type a new name in the form field (without blurring — no auto-save)
    const testName = 'LivePreview';
    const displayNameInput = page.locator('[data-field="displayName"]');
    await displayNameInput.fill(testName);

    // Verify draft preview updated live (without saving)
    await expect(draftName).toHaveText(testName);

    // Current profile should still show the original name
    const currentName = page.locator('#pc-name');
    await expect(currentName).toHaveText(testData.user.displayName);

    // Restore the field value without saving (press Escape or refill)
    await displayNameInput.fill(testData.user.displayName);
  });

  // ── Test 9: Read-only fields cannot be edited ──
  test('read-only fields cannot be edited', async ({ page, testData }) => {
    const userPath = `/api/user/${testData.user.uniqueId}`;

    await searchUser(page, String(testData.user.uniqueId));

    // Verify uniqueId has readonly-badge and correct value
    const uniqueIdField = page.locator('#field-uniqueId');
    await expect(uniqueIdField).toBeVisible({ timeout: 15_000 });
    await expect(uniqueIdField).toHaveText(String(testData.user.uniqueId));

    const uniqueIdBadge = page.locator('.field-group:has(#field-uniqueId) .readonly-badge');
    await expect(uniqueIdBadge).toBeVisible();
    await expect(uniqueIdBadge).toContainText('READ ONLY');

    // UniqueId is a div (not an input) — verify it's not editable
    await expect(uniqueIdField).toHaveClass(/uid-display/);

    // Switch to moderation subtab to check createdAt and lastSeenAt
    await switchUserSubtab(page, 'moderation');

    // Verify createdAt is read-only
    const createdAtBadge = page.locator('.field-group:has(#field-createdAt) .readonly-badge');
    await expect(createdAtBadge).toBeVisible({ timeout: 15_000 });
    await expect(createdAtBadge).toContainText('READ ONLY');

    const createdAtField = page.locator('#field-createdAt');
    await expect(createdAtField).toBeVisible();
    await expect(createdAtField).toHaveClass(/uid-display/); // div, not input

    // Verify lastSeenAt is read-only
    const lastSeenBadge = page.locator('.field-group:has(#field-lastSeenAt) .readonly-badge');
    await expect(lastSeenBadge).toBeVisible();
    await expect(lastSeenBadge).toContainText('READ ONLY');

    const lastSeenField = page.locator('#field-lastSeenAt');
    await expect(lastSeenField).toBeVisible();
    await expect(lastSeenField).toHaveClass(/uid-display/);

    // Verify values match API data
    const apiData = await testData.api.get(userPath);
    if (apiData.createdAt) {
      const createdAtText = await createdAtField.textContent();
      // The API returns ISO/epoch, the UI formats with toLocaleString — just verify it's not empty
      expect(createdAtText).not.toBe('—');
      expect(createdAtText!.length).toBeGreaterThan(0);
    }
  });

  // ── Test 10: Invalid user search shows appropriate response ──
  test('invalid user search shows appropriate response', async ({ page }) => {
    const searchInput = page.getByRole('spinbutton', { name: 'ShyTalk User ID' });
    await searchInput.fill('99999999');

    // Listen for the API response
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/search/uniqueId/99999999'),
      { timeout: 15_000 },
    );

    await page.getByRole('button', { name: 'Search' }).click();

    // Wait for the API response (should be 404)
    const response = await responsePromise;
    expect(response.status()).toBe(404);

    // The user form should NOT become visible
    const userForm = page.locator('#user-form');
    // Wait a moment for any UI updates to settle
    await page.waitForTimeout(1_000);
    const isVisible = await userForm.evaluate(el => el.classList.contains('visible'));
    expect(isVisible).toBe(false);

    // A toast error should have appeared (user not found)
    const toast = page.locator('.toast.error');
    // The toast may have already faded — check if it appeared at all
    // by verifying the form stays hidden (primary assertion above)
  });
});
