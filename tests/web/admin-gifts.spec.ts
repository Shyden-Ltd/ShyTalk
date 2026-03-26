import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/**
 * Helper: wait for the gifts table to finish loading (tbody has at least one row).
 */
async function waitForGiftsTable(page: Page): Promise<void> {
  await expect(page.locator('#gifts-tbody tr')).not.toHaveCount(0, { timeout: 15_000 });
}

/**
 * Helper: get the first existing gift row from the table.
 * Returns the row locator and the gift ID from its data attribute.
 */
function firstGiftRow(page: Page) {
  return page.locator('#gifts-tbody tr[data-gift-id]').first();
}

/**
 * Helper: read the current field values from a gift row.
 */
async function readRowFields(row: ReturnType<Page['locator']>) {
  return {
    name: await row.locator('[data-field="name"]').inputValue(),
    coinValue: await row.locator('[data-field="coinValue"]').inputValue(),
    order: await row.locator('[data-field="order"]').inputValue(),
    animationUrl: await row.locator('[data-field="animationUrl"]').inputValue(),
    soundUrl: await row.locator('[data-field="soundUrl"]').inputValue(),
    iconUrl: await row.locator('[data-field="iconUrl"]').inputValue(),
    showInStore: await row.locator('[data-field="showInStore"]').isChecked(),
    showOnWheel: await row.locator('[data-field="showOnWheel"]').isChecked(),
  };
}

/**
 * Helper: click Apply, verify the confirm dialog opens, then click Confirm.
 * Waits for the gifts table to reload after confirmation.
 */
async function applyAndConfirm(page: Page): Promise<void> {
  await page.locator('#gift-apply-btn').click();
  const overlay = page.locator('#gift-confirm-overlay');
  await expect(overlay).toHaveClass(/visible/);

  const submitBtn = page.locator('#gift-confirm-submit');
  // If submit is disabled (wheel count !== 16), the test caller must handle that
  await submitBtn.click();

  // Wait for the overlay to close (changes applied and table refreshed)
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 30_000 });
}

/**
 * Helper: trigger an input event on a field (needed for the inline change handler).
 */
async function fillAndTrigger(page: Page, locator: ReturnType<Page['locator']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.dispatchEvent('input');
  await locator.dispatchEvent('change');
}

test.describe('Admin Gifts Tab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);
  });

  // ── Test 1: Seeded gift appears in table ──
  test('seeded gift appears in table with correct data', async ({ page, testData }) => {
    // Verify the gifts table has rows
    const rows = page.locator('#gifts-tbody tr[data-gift-id]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Pick the first gift row and verify it has all expected fields
    const row = rows.first();
    const giftId = await row.getAttribute('data-gift-id');
    expect(giftId).toBeTruthy();

    // Verify name, coinValue, and checkboxes are populated
    const fields = await readRowFields(row);
    expect(fields.name.length).toBeGreaterThan(0);
    expect(Number.isFinite(Number(fields.coinValue))).toBe(true);

    // API verify: fetch all gifts and confirm this gift exists
    const apiGifts = await testData.api.get('/api/gifts/all');
    const giftList = Array.isArray(apiGifts) ? apiGifts : (apiGifts.gifts || []);
    const apiGift = giftList.find((g: any) => g.id === giftId);
    expect(apiGift).toBeTruthy();
    expect(apiGift.name).toBe(fields.name);
    expect(apiGift.coinValue).toBe(Number(fields.coinValue));
    expect(!!apiGift.showInStore).toBe(fields.showInStore);
    expect(!!apiGift.showOnWheel).toBe(fields.showOnWheel);
  });

  // ── Test 2: Add new gift ──
  test('add new gift via Add Gift button and Apply', async ({ page, testData }) => {
    const giftName = `e2e-add-${Date.now()}`;
    const giftValue = '42';

    // Click Add Gift
    await page.locator('#gift-add-btn').click();

    // Find the new row (it has class gift-new)
    const newRow = page.locator('#gifts-tbody tr.gift-new').last();
    await expect(newRow).toBeVisible();

    // Fill fields
    await fillAndTrigger(page, newRow.locator('[data-field="name"]'), giftName);
    await fillAndTrigger(page, newRow.locator('[data-field="coinValue"]'), giftValue);

    // Apply button should show badge with count >= 1
    const badge = page.locator('#gift-apply-btn .badge');
    await expect(badge).not.toHaveText('0');

    // Apply and confirm
    await applyAndConfirm(page);

    // Reload and verify
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    // Find the new gift in the table
    const allRows = page.locator('#gifts-tbody tr[data-gift-id]');
    const count = await allRows.count();
    let found = false;
    let foundGiftId = '';
    for (let i = 0; i < count; i++) {
      const nameVal = await allRows.nth(i).locator('[data-field="name"]').inputValue();
      if (nameVal === giftName) {
        found = true;
        foundGiftId = (await allRows.nth(i).getAttribute('data-gift-id')) || '';
        break;
      }
    }
    expect(found).toBe(true);

    // API verify
    const apiGifts = await testData.api.get('/api/gifts/all');
    const giftList = Array.isArray(apiGifts) ? apiGifts : (apiGifts.gifts || []);
    const apiGift = giftList.find((g: any) => g.name === giftName);
    expect(apiGift).toBeTruthy();
    expect(apiGift.coinValue).toBe(42);

    // Cleanup: delete the gift via API
    if (foundGiftId) {
      await testData.api.delete(`/api/gifts/${foundGiftId}`);
    }
  });

  // ── Test 3: Edit gift inline ──
  test('edit gift inline — name and coinValue persist after Apply', async ({ page, testData }) => {
    const row = firstGiftRow(page);
    const giftId = await row.getAttribute('data-gift-id');

    // Save original values
    const original = await readRowFields(row);

    // Edit name and coinValue
    const newName = `e2e-edit-${Date.now()}`;
    const newValue = String(Number(original.coinValue) + 1);
    await fillAndTrigger(page, row.locator('[data-field="name"]'), newName);
    await fillAndTrigger(page, row.locator('[data-field="coinValue"]'), newValue);

    // Row should get gift-modified class
    await expect(row).toHaveClass(/gift-modified/);

    // Apply and confirm
    await applyAndConfirm(page);

    // Reload and verify persistence
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    const reloadedRow = page.locator(`#gifts-tbody tr[data-gift-id="${giftId}"]`);
    await expect(reloadedRow.locator('[data-field="name"]')).toHaveValue(newName, { timeout: 10_000 });
    await expect(reloadedRow.locator('[data-field="coinValue"]')).toHaveValue(newValue);

    // Restore original values
    await fillAndTrigger(page, reloadedRow.locator('[data-field="name"]'), original.name);
    await fillAndTrigger(page, reloadedRow.locator('[data-field="coinValue"]'), original.coinValue);
    await applyAndConfirm(page);
  });

  // ── Test 4: Delete gift ──
  test('delete gift — row marked, Apply removes it, re-seed afterward', async ({ page, testData }) => {
    // First, create a temporary gift to delete
    const tempName = `e2e-delete-${Date.now()}`;
    await page.locator('#gift-add-btn').click();
    const newRow = page.locator('#gifts-tbody tr.gift-new').last();
    await fillAndTrigger(page, newRow.locator('[data-field="name"]'), tempName);
    await fillAndTrigger(page, newRow.locator('[data-field="coinValue"]'), '1');
    await applyAndConfirm(page);

    // Reload to get the persisted gift row with its server-assigned ID
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    // Find the temp gift
    const allRows = page.locator('#gifts-tbody tr[data-gift-id]');
    const count = await allRows.count();
    let targetRow: ReturnType<Page['locator']> | null = null;
    let targetId = '';
    for (let i = 0; i < count; i++) {
      const nameVal = await allRows.nth(i).locator('[data-field="name"]').inputValue();
      if (nameVal === tempName) {
        targetRow = allRows.nth(i);
        targetId = (await allRows.nth(i).getAttribute('data-gift-id')) || '';
        break;
      }
    }
    expect(targetRow).not.toBeNull();

    // Click Delete button on that row
    await targetRow!.locator('.gift-delete-btn').click();

    // Row should have gift-deleted class with strikethrough
    await expect(targetRow!).toHaveClass(/gift-deleted/);

    // Apply and confirm
    await applyAndConfirm(page);

    // Reload and verify the gift is gone
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    const deletedRow = page.locator(`#gifts-tbody tr[data-gift-id="${targetId}"]`);
    await expect(deletedRow).toHaveCount(0);

    // API verify: gift should not exist
    const apiGifts = await testData.api.get('/api/gifts/all');
    const giftList = Array.isArray(apiGifts) ? apiGifts : (apiGifts.gifts || []);
    const found = giftList.find((g: any) => g.id === targetId);
    expect(found).toBeUndefined();
  });

  // ── Test 5: Undo delete ──
  test('undo delete — mark for deletion then undo, gift still exists', async ({ page }) => {
    const row = firstGiftRow(page);
    const giftId = await row.getAttribute('data-gift-id');
    const originalName = await row.locator('[data-field="name"]').inputValue();

    // Mark for deletion
    await row.locator('.gift-delete-btn').click();
    await expect(row).toHaveClass(/gift-deleted/);

    // Click Undo
    await row.locator('.gift-undo-del-btn').click();
    await expect(row).not.toHaveClass(/gift-deleted/);

    // The row should be restored with original data
    await expect(row.locator('[data-field="name"]')).toHaveValue(originalName);

    // Badge count should be 0 (no pending changes), Apply should be hidden
    const applyBtn = page.locator('#gift-apply-btn');
    await expect(applyBtn).toBeHidden();
  });

  // ── Test 6: Discard changes ──
  test('discard changes reverts all modifications', async ({ page }) => {
    const row = firstGiftRow(page);
    const original = await readRowFields(row);

    // Make some changes
    await fillAndTrigger(page, row.locator('[data-field="name"]'), 'SHOULD_BE_DISCARDED');
    await fillAndTrigger(page, row.locator('[data-field="coinValue"]'), '99999');
    await expect(row).toHaveClass(/gift-modified/);

    // Click Discard
    await page.locator('#gift-discard-btn').click();

    // Verify the row is back to original
    await expect(row.locator('[data-field="name"]')).toHaveValue(original.name);
    await expect(row.locator('[data-field="coinValue"]')).toHaveValue(original.coinValue);
    await expect(row).not.toHaveClass(/gift-modified/);

    // Apply and Discard buttons should be hidden
    await expect(page.locator('#gift-apply-btn')).toBeHidden();
    await expect(page.locator('#gift-discard-btn')).toBeHidden();
  });

  // ── Test 7: Confirm dialog shows change summary ──
  test('confirm dialog shows add, modify, and delete categories', async ({ page }) => {
    const row = firstGiftRow(page);
    const originalName = await row.locator('[data-field="name"]').inputValue();

    // Modify the first gift
    await fillAndTrigger(page, row.locator('[data-field="name"]'), `e2e-mod-${Date.now()}`);

    // Add a new gift
    await page.locator('#gift-add-btn').click();
    const newRow = page.locator('#gifts-tbody tr.gift-new').last();
    await fillAndTrigger(page, newRow.locator('[data-field="name"]'), 'e2e-confirm-test');

    // Delete another gift (second row if it exists)
    const secondRow = page.locator('#gifts-tbody tr[data-gift-id]').nth(1);
    if (await secondRow.count() > 0) {
      await secondRow.locator('.gift-delete-btn').click();
    }

    // Click Apply — opens the confirm dialog
    await page.locator('#gift-apply-btn').click();
    const overlay = page.locator('#gift-confirm-overlay');
    await expect(overlay).toHaveClass(/visible/);

    // Verify all three sections appear in the dialog
    const body = page.locator('#gift-confirm-body');
    await expect(body.locator('h4:has-text("New Gifts")')).toBeVisible();
    await expect(body.locator('h4:has-text("Modified Gifts")')).toBeVisible();
    if (await secondRow.count() > 0) {
      await expect(body.locator('h4:has-text("Deleted Gifts")')).toBeVisible();
    }

    // Title should show total change count
    const title = page.locator('#gift-confirm-title');
    await expect(title).toContainText('total');

    // Cancel — nothing should be saved
    await page.locator('#gift-confirm-cancel').click();
    await expect(overlay).not.toHaveClass(/visible/);

    // Discard all changes to restore state
    await page.locator('#gift-discard-btn').click();

    // Verify first row reverted
    await expect(row.locator('[data-field="name"]')).toHaveValue(originalName);
  });

  // ── Test 8: Store/wheel checkboxes persist ──
  test('store and wheel checkboxes persist after Apply', async ({ page, testData }) => {
    const row = firstGiftRow(page);
    const giftId = await row.getAttribute('data-gift-id');
    const originalWheel = await row.locator('[data-field="showOnWheel"]').isChecked();

    // Toggle showOnWheel checkbox (leave showInStore true so the gift stays visible)
    const wheelCheckbox = row.locator('[data-field="showOnWheel"]');
    if (originalWheel) {
      await wheelCheckbox.uncheck();
    } else {
      await wheelCheckbox.check();
    }
    await wheelCheckbox.dispatchEvent('change');

    // Row should be marked as modified
    await expect(row).toHaveClass(/gift-modified/);

    // Apply and confirm
    await applyAndConfirm(page);

    // Reload and verify
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    const reloadedRow = page.locator(`#gifts-tbody tr[data-gift-id="${giftId}"]`);
    const newWheel = await reloadedRow.locator('[data-field="showOnWheel"]').isChecked();
    expect(newWheel).toBe(!originalWheel);

    // API verify
    const apiGifts = await testData.api.get('/api/gifts/all');
    const giftList = Array.isArray(apiGifts) ? apiGifts : (apiGifts.gifts || []);
    const apiGift = giftList.find((g: any) => g.id === giftId);
    expect(apiGift).toBeTruthy();
    expect(apiGift.showOnWheel).toBe(!originalWheel);

    // Restore original state
    const restoredCheckbox = reloadedRow.locator('[data-field="showOnWheel"]');
    if (originalWheel) {
      await restoredCheckbox.check();
    } else {
      await restoredCheckbox.uncheck();
    }
    await restoredCheckbox.dispatchEvent('change');
    await applyAndConfirm(page);
  });

  // ── Test 9: Gift order field persists ──
  test('gift order field persists after Apply', async ({ page, testData }) => {
    const row = firstGiftRow(page);
    const giftId = await row.getAttribute('data-gift-id');
    const originalOrder = await row.locator('[data-field="order"]').inputValue();
    const newOrder = String(Number(originalOrder) + 100);

    // Change order
    await fillAndTrigger(page, row.locator('[data-field="order"]'), newOrder);
    await expect(row).toHaveClass(/gift-modified/);

    // Apply and confirm
    await applyAndConfirm(page);

    // Reload and verify
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    // The row may have moved due to order change — find by gift ID
    const reloadedRow = page.locator(`#gifts-tbody tr[data-gift-id="${giftId}"]`);
    await expect(reloadedRow.locator('[data-field="order"]')).toHaveValue(newOrder, { timeout: 10_000 });

    // Restore original order
    await fillAndTrigger(page, reloadedRow.locator('[data-field="order"]'), originalOrder);
    await applyAndConfirm(page);
  });

  // ── Test 10: Animation/sound/icon URLs persist ──
  test('animation, sound, and icon URLs persist after Apply', async ({ page, testData }) => {
    const row = firstGiftRow(page);
    const giftId = await row.getAttribute('data-gift-id');
    const originalAnim = await row.locator('[data-field="animationUrl"]').inputValue();
    const originalSound = await row.locator('[data-field="soundUrl"]').inputValue();
    const originalIcon = await row.locator('[data-field="iconUrl"]').inputValue();

    const testAnim = 'https://example.com/anim.json';
    const testSound = 'https://example.com/sound.mp3';
    const testIcon = 'https://example.com/icon.png';

    // Set URLs
    await fillAndTrigger(page, row.locator('[data-field="animationUrl"]'), testAnim);
    await fillAndTrigger(page, row.locator('[data-field="soundUrl"]'), testSound);
    await fillAndTrigger(page, row.locator('[data-field="iconUrl"]'), testIcon);
    await expect(row).toHaveClass(/gift-modified/);

    // Apply and confirm
    await applyAndConfirm(page);

    // Reload and verify
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Gifts');
    await waitForGiftsTable(page);

    const reloadedRow = page.locator(`#gifts-tbody tr[data-gift-id="${giftId}"]`);
    await expect(reloadedRow.locator('[data-field="animationUrl"]')).toHaveValue(testAnim, { timeout: 10_000 });
    await expect(reloadedRow.locator('[data-field="soundUrl"]')).toHaveValue(testSound);
    await expect(reloadedRow.locator('[data-field="iconUrl"]')).toHaveValue(testIcon);

    // API verify
    const apiGifts = await testData.api.get('/api/gifts/all');
    const giftList = Array.isArray(apiGifts) ? apiGifts : (apiGifts.gifts || []);
    const apiGift = giftList.find((g: any) => g.id === giftId);
    expect(apiGift).toBeTruthy();
    expect(apiGift.animationUrl).toBe(testAnim);
    expect(apiGift.soundUrl).toBe(testSound);
    expect(apiGift.iconUrl).toBe(testIcon);

    // Restore original URLs
    await fillAndTrigger(page, reloadedRow.locator('[data-field="animationUrl"]'), originalAnim);
    await fillAndTrigger(page, reloadedRow.locator('[data-field="soundUrl"]'), originalSound);
    await fillAndTrigger(page, reloadedRow.locator('[data-field="iconUrl"]'), originalIcon);
    await applyAndConfirm(page);
  });

  // ── Test 11: Weight field persists via API ──
  test('weight field persists via API update and verify', async ({ page, testData }) => {
    // Weight is stored in the gift document but not exposed in the table UI.
    // Verify via direct API PUT and read-back.
    const API_BASE = process.env.API_BASE_URL || 'https://dev-api.shytalk.shyden.co.uk';
    const row = firstGiftRow(page);
    const giftId = await row.getAttribute('data-gift-id');
    const token = await testData.api.waitForToken();
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Read current weight via API
    const apiGifts = await testData.api.get('/api/gifts/all');
    const giftList = Array.isArray(apiGifts) ? apiGifts : (apiGifts.gifts || []);
    const apiGift = giftList.find((g: any) => g.id === giftId);
    expect(apiGift).toBeTruthy();
    const originalWeight = apiGift.weight ?? 1.0;

    // Update weight to 2.5 via PUT
    const putRes = await page.request.put(`${API_BASE}/api/gifts/${giftId}`, {
      headers: authHeaders,
      data: { weight: 2.5 },
    });
    expect(putRes.ok()).toBe(true);

    // Verify via API
    const verifyGifts = await testData.api.get('/api/gifts/all');
    const verifyList = Array.isArray(verifyGifts) ? verifyGifts : (verifyGifts.gifts || []);
    const verifyGift = verifyList.find((g: any) => g.id === giftId);
    expect(verifyGift).toBeTruthy();
    expect(verifyGift.weight).toBe(2.5);

    // Restore original weight
    await page.request.put(`${API_BASE}/api/gifts/${giftId}`, {
      headers: authHeaders,
      data: { weight: originalWeight },
    });
  });

  // ── Test 12: Add Gift button creates new row with defaults ──
  test('Add Gift creates new row with correct defaults', async ({ page }) => {
    // Count existing rows before adding
    const beforeCount = await page.locator('#gifts-tbody tr').count();

    // Click Add Gift
    await page.locator('#gift-add-btn').click();

    // New row should appear
    const afterCount = await page.locator('#gifts-tbody tr').count();
    expect(afterCount).toBe(beforeCount + 1);

    // The new row should have gift-new class
    const newRow = page.locator('#gifts-tbody tr.gift-new').last();
    await expect(newRow).toBeVisible();

    // Verify defaults: showInStore checked, showOnWheel checked, coinValue 0, name empty
    await expect(newRow.locator('[data-field="showInStore"]')).toBeChecked();
    await expect(newRow.locator('[data-field="showOnWheel"]')).toBeChecked();
    await expect(newRow.locator('[data-field="coinValue"]')).toHaveValue('0');
    await expect(newRow.locator('[data-field="name"]')).toHaveValue('');

    // Order should be maxOrder + 1 (non-zero for non-empty catalogs)
    const orderVal = Number(await newRow.locator('[data-field="order"]').inputValue());
    expect(orderVal).toBeGreaterThan(0);

    // New row should have a Remove button (not Del)
    await expect(newRow.locator('.gift-remove-btn')).toBeVisible();
    await expect(newRow.locator('.gift-delete-btn')).toHaveCount(0);

    // Apply and Discard buttons should be visible
    await expect(page.locator('#gift-apply-btn')).toBeVisible();
    await expect(page.locator('#gift-discard-btn')).toBeVisible();

    // Cleanup: click Remove to discard
    await newRow.locator('.gift-remove-btn').click();
    await expect(page.locator('#gifts-tbody tr.gift-new')).toHaveCount(0);
  });

  // ── Test 13: Multiple gifts in table sorted by order ──
  test('multiple gifts in table are sorted by order', async ({ page }) => {
    const rows = page.locator('#gifts-tbody tr[data-gift-id]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Collect order values from all rows
    const orders: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      const orderStr = await rows.nth(i).locator('[data-field="order"]').inputValue();
      orders.push(Number(orderStr));
    }

    // Verify they are in non-decreasing order (as returned by the API orderBy)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
  });

  // ── Test 14: Gifts count indicator updates correctly ──
  test('gifts count indicator updates on add and delete', async ({ page }) => {
    const countEl = page.locator('#gifts-count');
    const initialText = await countEl.textContent();
    const initialCount = parseInt(initialText || '0', 10);
    expect(initialCount).toBeGreaterThan(0);

    // Add a new gift — count should increase
    await page.locator('#gift-add-btn').click();
    const afterAddText = await countEl.textContent();
    const afterAddCount = parseInt(afterAddText || '0', 10);
    expect(afterAddCount).toBe(initialCount + 1);

    // Mark first gift for deletion — count should decrease
    const firstRow = firstGiftRow(page);
    await firstRow.locator('.gift-delete-btn').click();
    const afterDeleteText = await countEl.textContent();
    const afterDeleteCount = parseInt(afterDeleteText || '0', 10);
    expect(afterDeleteCount).toBe(initialCount); // +1 add, -1 delete = net 0

    // Discard — count should return to initial
    await page.locator('#gift-discard-btn').click();
    const afterDiscardText = await countEl.textContent();
    const afterDiscardCount = parseInt(afterDiscardText || '0', 10);
    expect(afterDiscardCount).toBe(initialCount);
  });
});
