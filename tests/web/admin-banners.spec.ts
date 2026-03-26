import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import { Page } from '@playwright/test';

/** Wait for the banners list to finish loading (spinner disappears). */
async function waitForBannersLoaded(page: Page): Promise<void> {
  // Wait for either banner cards or the empty-state message to appear
  await expect(
    page.locator('#banners-list .banner-card, #banners-list p'),
  ).not.toHaveCount(0, { timeout: 15_000 });
}

/** Open the Add Banner dialog. */
async function openAddDialog(page: Page): Promise<void> {
  await page.locator('#banner-add-btn').click();
  await expect(page.locator('#banner-dialog-overlay')).toHaveCSS('display', 'flex');
  await expect(page.locator('#banner-dialog-title')).toHaveText('Add Banner');
}

/** Open the Edit dialog for a specific banner card. */
async function openEditDialog(page: Page, bannerId: string): Promise<void> {
  const card = page.locator(`.banner-card[data-banner-id="${bannerId}"]`);
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#banner-dialog-overlay')).toHaveCSS('display', 'flex');
  await expect(page.locator('#banner-dialog-title')).toHaveText('Edit Banner');
}

/** Click Save in the banner dialog and wait for the list to reload. */
async function saveDialog(page: Page): Promise<void> {
  const saveBtn = page.locator('#banner-dialog-save');
  await saveBtn.click();
  // Wait for dialog to close (save completes)
  await expect(page.locator('#banner-dialog-overlay')).toHaveCSS('display', 'none', { timeout: 15_000 });
  await waitForBannersLoaded(page);
}

/** Click Cancel in the banner dialog. */
async function cancelDialog(page: Page): Promise<void> {
  await page.locator('#banner-dialog-cancel').click();
  await expect(page.locator('#banner-dialog-overlay')).toHaveCSS('display', 'none');
}

/**
 * Create a small 1x1 PNG buffer for file upload tests.
 * Avoids external file dependencies.
 */
function createTestPngBuffer(): Buffer {
  // Minimal valid 1x1 red PNG (68 bytes)
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** Helper: create a banner directly via API (bypassing UI) for tests that need extra banners. */
async function createBannerViaApi(
  testData: TestData,
  overrides: Record<string, any> = {},
): Promise<string> {
  const result = await testData.api.post('/api/admin/banners', {
    title: overrides.title || `api-banner-${Date.now()}`,
    image_url: overrides.image_url || 'https://placehold.co/600x200/png',
    action_type: overrides.action_type || 'NONE',
    action_value: overrides.action_value || null,
    is_active: overrides.is_active ?? true,
    start_date: overrides.start_date ?? null,
    end_date: overrides.end_date ?? null,
  });
  return result.id;
}

/** Helper: delete a banner via API. */
async function deleteBannerViaApi(testData: TestData, bannerId: string): Promise<void> {
  await testData.api.delete(`/api/admin/banners/${bannerId}`);
}

/** Helper: get all banners via admin API. */
async function getAllBannersViaApi(testData: TestData): Promise<any[]> {
  return testData.api.get('/api/admin/banners');
}

/** Helper: get active banners via public API. */
async function getActiveBannersViaApi(testData: TestData): Promise<any[]> {
  return testData.api.get('/api/banners/active');
}

test.describe('Admin Banners', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);
  });

  // ── Test 1: Seeded banner appears in list — API verify ──
  test('seeded banner appears in list with API verification', async ({ page, testData }) => {
    // Verify the seeded banner card is visible in the UI
    const card = page.locator(`.banner-card[data-banner-id="${testData.banner.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Verify the title text within the card
    await expect(card.locator('strong')).toHaveText(testData.banner.title);

    // API verification: banner exists in admin endpoint
    const banners = await getAllBannersViaApi(testData);
    const seeded = banners.find((b: any) => b.id === testData.banner.id);
    expect(seeded).toBeTruthy();
    expect(seeded.title).toBe(testData.banner.title);
    expect(seeded.isActive ?? seeded.is_active).toBe(true);
  });

  // ── Test 2: Create banner via dialog — fill, save, reload → persist, delete ──
  test('create banner via dialog persists after reload', async ({ page, testData }) => {
    const newTitle = `e2e-${testData.prefix}-created`;

    await openAddDialog(page);

    // Fill title
    await page.locator('#banner-title-input').fill(newTitle);

    // Select action type URL
    await page.locator('#banner-action-type').selectOption('URL');
    await expect(page.locator('#banner-action-value-group')).not.toHaveCSS('display', 'none');
    await page.locator('#banner-action-value-input').fill('https://example.com/promo');

    // Set dates
    const futureStart = '2027-01-01T00:00';
    const futureEnd = '2027-12-31T23:59';
    await page.locator('#banner-start-date').fill(futureStart);
    await page.locator('#banner-end-date').fill(futureEnd);

    // Active checkbox (should be checked by default)
    await expect(page.locator('#banner-active-check')).toBeChecked();

    // Upload a test image — required for save
    const fileInput = page.locator('#banner-file-input');
    await fileInput.setInputFiles({
      name: 'test-banner.png',
      mimeType: 'image/png',
      buffer: createTestPngBuffer(),
    });

    // Save
    await saveDialog(page);

    // Find the newly created banner card by title
    const newCard = page.locator('.banner-card', { hasText: newTitle });
    await expect(newCard).toBeVisible({ timeout: 10_000 });

    // Extract the banner ID for cleanup
    const newBannerId = await newCard.getAttribute('data-banner-id');
    expect(newBannerId).toBeTruthy();

    // Reload and verify persistence
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    await expect(page.locator(`.banner-card[data-banner-id="${newBannerId}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(`.banner-card[data-banner-id="${newBannerId}"] strong`),
    ).toHaveText(newTitle);

    // Cleanup: delete the created banner
    await deleteBannerViaApi(testData, newBannerId!);
  });

  // ── Test 3: Edit banner — change title, save, reload → verify, restore ──
  test('edit banner title persists after reload', async ({ page, testData }) => {
    const originalTitle = testData.banner.title;
    const editedTitle = `e2e-${testData.prefix}-edited`;

    await openEditDialog(page, testData.banner.id);

    // Change title
    await page.locator('#banner-title-input').fill(editedTitle);

    await saveDialog(page);

    // Verify updated in list
    const card = page.locator(`.banner-card[data-banner-id="${testData.banner.id}"]`);
    await expect(card.locator('strong')).toHaveText(editedTitle);

    // Reload and verify persistence
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    await expect(
      page.locator(`.banner-card[data-banner-id="${testData.banner.id}"] strong`),
    ).toHaveText(editedTitle, { timeout: 10_000 });

    // Restore original title
    await openEditDialog(page, testData.banner.id);
    await page.locator('#banner-title-input').fill(originalTitle);
    await saveDialog(page);

    await expect(
      page.locator(`.banner-card[data-banner-id="${testData.banner.id}"] strong`),
    ).toHaveText(originalTitle);
  });

  // ── Test 4: Delete banner — confirm → confirm, reload → gone, re-seed ──
  test('delete banner removes it after confirmation', async ({ page, testData }) => {
    // Create a temporary banner to delete (don't delete the seeded one)
    const tempId = await createBannerViaApi(testData, {
      title: `e2e-${testData.prefix}-to-delete`,
      image_url: 'https://placehold.co/600x200/png',
    });

    // Reload to see the new banner
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    const card = page.locator(`.banner-card[data-banner-id="${tempId}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Click delete and accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'Delete' }).click();

    // Wait for the card to disappear
    await expect(card).not.toBeVisible({ timeout: 15_000 });

    // Reload and verify it's gone
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    await expect(page.locator(`.banner-card[data-banner-id="${tempId}"]`)).not.toBeVisible();

    // API verify: banner no longer in list
    const banners = await getAllBannersViaApi(testData);
    expect(banners.find((b: any) => b.id === tempId)).toBeFalsy();
  });

  // ── Test 5: Delete cancel — confirm → cancel, banner still exists ──
  test('delete cancel keeps banner', async ({ page, testData }) => {
    // Dismiss (cancel) the confirm dialog
    page.on('dialog', (dialog) => dialog.dismiss());

    const card = page.locator(`.banner-card[data-banner-id="${testData.banner.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    await card.getByRole('button', { name: 'Delete' }).click();

    // Banner should still be visible
    await expect(card).toBeVisible();

    // Also verify via API
    const banners = await getAllBannersViaApi(testData);
    expect(banners.find((b: any) => b.id === testData.banner.id)).toBeTruthy();
  });

  // ── Test 6: Action type conditional fields ──
  test('action type toggles conditional fields correctly', async ({ page, testData }) => {
    await openAddDialog(page);

    const actionValueGroup = page.locator('#banner-action-value-group');
    const actionValueInput = page.locator('#banner-action-value-input');
    const screenSelect = page.locator('#banner-screen-select');

    // NONE — both hidden
    await page.locator('#banner-action-type').selectOption('NONE');
    await expect(actionValueGroup).toHaveCSS('display', 'none');

    // URL — text input visible, screen select hidden
    await page.locator('#banner-action-type').selectOption('URL');
    await expect(actionValueGroup).not.toHaveCSS('display', 'none');
    await expect(actionValueInput).not.toHaveCSS('display', 'none');
    await expect(screenSelect).toHaveCSS('display', 'none');
    // Verify label
    await expect(page.locator('#banner-action-value-label')).toHaveText('URL');

    // ROOM — text input visible, screen select hidden
    await page.locator('#banner-action-type').selectOption('ROOM');
    await expect(actionValueGroup).not.toHaveCSS('display', 'none');
    await expect(actionValueInput).not.toHaveCSS('display', 'none');
    await expect(screenSelect).toHaveCSS('display', 'none');
    await expect(page.locator('#banner-action-value-label')).toHaveText('Room ID');

    // SCREEN — screen dropdown visible, text input hidden
    await page.locator('#banner-action-type').selectOption('SCREEN');
    await expect(actionValueGroup).not.toHaveCSS('display', 'none');
    await expect(actionValueInput).toHaveCSS('display', 'none');
    await expect(screenSelect).not.toHaveCSS('display', 'none');
    await expect(page.locator('#banner-action-value-label')).toHaveText('Screen');

    // Verify screen dropdown has expected options
    const options = await screenSelect.locator('option').allTextContents();
    expect(options).toContain('Wallet');
    expect(options).toContain('Settings');
    expect(options).toContain('Profile');

    await cancelDialog(page);
  });

  // ── Test 7: Active toggle — deactivate, API excludes, re-activate ──
  test('active toggle excludes banner from active endpoint', async ({ page, testData }) => {
    // Deactivate the seeded banner
    await openEditDialog(page, testData.banner.id);
    await page.locator('#banner-active-check').uncheck();
    await saveDialog(page);

    // Verify badge shows "Inactive"
    const card = page.locator(`.banner-card[data-banner-id="${testData.banner.id}"]`);
    await expect(card.locator('span', { hasText: 'Inactive' })).toBeVisible();

    // API: active endpoint should NOT include this banner
    const activeBanners = await getActiveBannersViaApi(testData);
    expect(activeBanners.find((b: any) => b.id === testData.banner.id)).toBeFalsy();

    // Re-activate
    await openEditDialog(page, testData.banner.id);
    await page.locator('#banner-active-check').check();
    await saveDialog(page);

    // Verify badge no longer says "Inactive"
    await expect(card.locator('span', { hasText: 'Inactive' })).not.toBeVisible();
  });

  // ── Test 8: Date range — set future start, API verify, clear, verify ──
  test('date range persists and clears correctly', async ({ page, testData }) => {
    const futureStart = '2028-06-15T10:00';
    const futureEnd = '2028-12-31T23:59';

    await openEditDialog(page, testData.banner.id);

    // Set dates
    await page.locator('#banner-start-date').fill(futureStart);
    await page.locator('#banner-end-date').fill(futureEnd);
    await saveDialog(page);

    // API: verify dates are set (as epoch timestamps)
    let banners = await getAllBannersViaApi(testData);
    let banner = banners.find((b: any) => b.id === testData.banner.id);
    expect(banner).toBeTruthy();

    const startTs = banner.startDate ?? banner.start_date;
    const endTs = banner.endDate ?? banner.end_date;
    expect(startTs).toBeTruthy();
    expect(endTs).toBeTruthy();
    // Verify they correspond roughly to the dates we set (2028)
    expect(new Date(startTs).getFullYear()).toBe(2028);
    expect(new Date(endTs).getFullYear()).toBe(2028);

    // Verify "Scheduled" badge shows (future start date + active)
    const card = page.locator(`.banner-card[data-banner-id="${testData.banner.id}"]`);
    await expect(card.locator('span', { hasText: 'Scheduled' })).toBeVisible();

    // Clear dates
    await openEditDialog(page, testData.banner.id);
    await page.locator('#banner-start-date').fill('');
    await page.locator('#banner-end-date').fill('');
    await saveDialog(page);

    // API: verify dates are cleared
    banners = await getAllBannersViaApi(testData);
    banner = banners.find((b: any) => b.id === testData.banner.id);
    const clearedStart = banner.startDate ?? banner.start_date;
    const clearedEnd = banner.endDate ?? banner.end_date;
    expect(clearedStart).toBeFalsy();
    expect(clearedEnd).toBeFalsy();
  });

  // ── Test 9: Image preview — select image, verify preview visible ──
  test('image preview appears when file is selected in dialog', async ({ page }) => {
    await openAddDialog(page);

    // Preview should be hidden initially (no image for new banner)
    const preview = page.locator('#banner-preview');
    await expect(preview).toHaveCSS('display', 'none');

    // Select a test image
    const fileInput = page.locator('#banner-file-input');
    await fileInput.setInputFiles({
      name: 'preview-test.png',
      mimeType: 'image/png',
      buffer: createTestPngBuffer(),
    });

    // Preview should now be visible with a blob URL
    await expect(preview).toHaveCSS('display', 'block');
    const src = await preview.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src!.startsWith('blob:')).toBe(true);

    await cancelDialog(page);
  });

  // ── Test 10: Drag-drop reorder — drag banner above another, verify order ──
  test('drag-drop reorder changes banner order', async ({ page, testData }) => {
    // Create a second banner for reordering
    const secondId = await createBannerViaApi(testData, {
      title: `e2e-${testData.prefix}-reorder-2`,
      image_url: 'https://placehold.co/600x200/png',
    });

    // Reload to see both banners
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    // Get the initial order of banner IDs
    const cardsBefore = page.locator('.banner-card');
    const countBefore = await cardsBefore.count();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    const idsBefore: string[] = [];
    for (let i = 0; i < countBefore; i++) {
      idsBefore.push(await cardsBefore.nth(i).getAttribute('data-banner-id') || '');
    }

    // Find the indices of our two banners
    const idx1 = idsBefore.indexOf(testData.banner.id);
    const idx2 = idsBefore.indexOf(secondId);
    expect(idx1).not.toBe(-1);
    expect(idx2).not.toBe(-1);

    // Drag the second banner onto the first to swap their positions
    const srcCard = page.locator(`.banner-card[data-banner-id="${secondId}"]`);
    const dstCard = page.locator(`.banner-card[data-banner-id="${testData.banner.id}"]`);

    await srcCard.dragTo(dstCard);

    // Wait for the reorder API call to complete
    await page.waitForTimeout(1_000);

    // API: verify the order changed
    const bannersAfter = await getAllBannersViaApi(testData);
    const first = bannersAfter.find((b: any) => b.id === testData.banner.id);
    const second = bannersAfter.find((b: any) => b.id === secondId);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    // Reload and verify the order persisted in the UI
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    const cardsAfterReload = page.locator('.banner-card');
    const idsAfterReload: string[] = [];
    const countAfterReload = await cardsAfterReload.count();
    for (let i = 0; i < countAfterReload; i++) {
      idsAfterReload.push(await cardsAfterReload.nth(i).getAttribute('data-banner-id') || '');
    }

    // The order should have changed from the original
    expect(idsAfterReload).not.toEqual(idsBefore);
    // (exact position depends on other banners, but the relative order should differ)
    const relIdx1After = idsAfterReload.indexOf(testData.banner.id);
    const relIdx2After = idsAfterReload.indexOf(secondId);
    expect(relIdx1After).not.toBe(-1);
    expect(relIdx2After).not.toBe(-1);
    // The dragged banner (second) should now be before the target banner (first)
    expect(relIdx2After).toBeLessThan(relIdx1After);

    // Cleanup
    await deleteBannerViaApi(testData, secondId);
  });

  // ── Test 11: Banner image upload — select file, verify CDN URL after save ──
  test('banner image upload produces CDN URL', async ({ page, testData }) => {
    const uploadTitle = `e2e-${testData.prefix}-upload-test`;

    await openAddDialog(page);

    await page.locator('#banner-title-input').fill(uploadTitle);

    // Upload image
    const fileInput = page.locator('#banner-file-input');
    await fileInput.setInputFiles({
      name: 'cdn-test.png',
      mimeType: 'image/png',
      buffer: createTestPngBuffer(),
    });

    // Verify preview appeared
    await expect(page.locator('#banner-preview')).toHaveCSS('display', 'block');

    // Save the banner
    await saveDialog(page);

    // Find the new banner card
    const newCard = page.locator('.banner-card', { hasText: uploadTitle });
    await expect(newCard).toBeVisible({ timeout: 10_000 });
    const newBannerId = await newCard.getAttribute('data-banner-id');
    expect(newBannerId).toBeTruthy();

    // API: verify the imageUrl is a CDN URL
    const banners = await getAllBannersViaApi(testData);
    const uploaded = banners.find((b: any) => b.id === newBannerId);
    expect(uploaded).toBeTruthy();
    const imageUrl = uploaded.imageUrl ?? uploaded.image_url;
    expect(imageUrl).toBeTruthy();
    expect(imageUrl).toContain('images.shytalk.shyden.co.uk');

    // Cleanup
    await deleteBannerViaApi(testData, newBannerId!);
  });

  // ── Test 12: Empty state — delete all, verify message, re-seed ──
  test('empty state shows message when no banners exist', async ({ page, testData }) => {
    // Get all current banners and delete them
    const allBanners = await getAllBannersViaApi(testData);
    const bannerIds = allBanners.map((b: any) => b.id);
    for (const id of bannerIds) {
      await deleteBannerViaApi(testData, id);
    }

    // Reload to see empty state
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Banners');
    await waitForBannersLoaded(page);

    // Verify empty state message
    const emptyMessage = page.locator('#banners-list p');
    await expect(emptyMessage).toBeVisible({ timeout: 10_000 });
    await expect(emptyMessage).toContainText('No banners yet');
    await expect(emptyMessage).toContainText('Add Banner');

    // No banner cards should be visible
    await expect(page.locator('.banner-card')).toHaveCount(0);

    // Re-seed: create the banner back so other tests in subsequent runs aren't broken
    // (The fixture teardown will clean up the test run, but we restore the seeded banner)
    await createBannerViaApi(testData, {
      title: testData.banner.title,
      image_url: 'https://placehold.co/600x200/png',
    });
  });
});
