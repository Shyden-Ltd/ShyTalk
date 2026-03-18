import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

/**
 * Helper: navigate back to the economy subtab after a page reload.
 */
async function reloadAndNavigateToEconomy(
  page: import('@playwright/test').Page,
  uniqueId: string,
): Promise<void> {
  await page.reload();
  await adminLogin(page);
  await navigateToTab(page, 'Users');
  await searchUser(page, uniqueId);
  await switchUserSubtab(page, 'economy');
}

/**
 * Helper: trigger auto-save for the pity counter by blurring, then wait for
 * the "Saved" feedback.  The eco-pity input fires autoSaveEconomyField on blur.
 */
async function waitForPityAutoSave(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#eco-pity').evaluate(el => el.blur());
  const container = page.locator('#eco-pity').locator('..');
  await expect(container.locator('.field-feedback.saved')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin Users - Economy Subtab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, testData }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
    await switchUserSubtab(page, 'economy');
  });

  // ── Test 1: Coins balance displays correctly ──
  test('coins balance displays correctly', async ({ page, testData }) => {
    const coinsDisplay = page.locator('#eco-coins-display');
    await expect(coinsDisplay).toHaveText('1000', { timeout: 15_000 });

    // Verify via API
    const economy = await testData.api.get(`/api/users/${testData.user.uniqueId}/economy`);
    expect(economy.shyCoins).toBe(1000);
  });

  // ── Test 2: Add coins persists ──
  test('add coins persists', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Select "Add" (default) and enter 500
    await page.locator('#eco-coins-op').selectOption('add');
    await page.locator('#eco-coins-amount').fill('500');
    await page.locator('#eco-coins-apply').click();

    // Wait for display to update
    const coinsDisplay = page.locator('#eco-coins-display');
    await expect(coinsDisplay).toHaveText('1500', { timeout: 15_000 });

    // Reload and verify persistence
    await reloadAndNavigateToEconomy(page, uid);
    await expect(page.locator('#eco-coins-display')).toHaveText('1500', { timeout: 15_000 });

    // Verify via API
    const economy = await testData.api.get(`/api/users/${uid}/economy`);
    expect(economy.shyCoins).toBe(1500);

    // Restore: deduct 500 via API
    await testData.api.post(`/api/users/${uid}/adjust-balance`, {
      currency: 'COINS', amount: -500,
    });
  });

  // ── Test 3: Deduct coins persists ──
  test('deduct coins persists', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Select "Deduct" and enter 200
    await page.locator('#eco-coins-op').selectOption('deduct');
    await page.locator('#eco-coins-amount').fill('200');
    await page.locator('#eco-coins-apply').click();

    // Wait for display to update
    const coinsDisplay = page.locator('#eco-coins-display');
    await expect(coinsDisplay).toHaveText('800', { timeout: 15_000 });

    // Reload and verify persistence
    await reloadAndNavigateToEconomy(page, uid);
    await expect(page.locator('#eco-coins-display')).toHaveText('800', { timeout: 15_000 });

    // Verify via API
    const economy = await testData.api.get(`/api/users/${uid}/economy`);
    expect(economy.shyCoins).toBe(800);

    // Restore: add 200 via API
    await testData.api.post(`/api/users/${uid}/adjust-balance`, {
      currency: 'COINS', amount: 200,
    });
  });

  // ── Test 4: Beans balance displays correctly and add/deduct works ──
  test('beans balance displays correctly and add/deduct works', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Verify seeded beans amount
    const beansDisplay = page.locator('#eco-beans-display');
    await expect(beansDisplay).toHaveText('500', { timeout: 15_000 });

    // Add 300 beans
    await page.locator('#eco-beans-op').selectOption('add');
    await page.locator('#eco-beans-amount').fill('300');
    await page.locator('#eco-beans-apply').click();

    // Verify display shows 800
    await expect(beansDisplay).toHaveText('800', { timeout: 15_000 });

    // Reload and verify persistence
    await reloadAndNavigateToEconomy(page, uid);
    await expect(page.locator('#eco-beans-display')).toHaveText('800', { timeout: 15_000 });

    // Verify via API
    const economy = await testData.api.get(`/api/users/${uid}/economy`);
    expect(economy.shyBeans).toBe(800);

    // Restore: deduct 300 via API
    await testData.api.post(`/api/users/${uid}/adjust-balance`, {
      currency: 'BEANS', amount: -300,
    });
  });

  // ── Test 5: Add gift to backpack ──
  test('add gift to backpack', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Wait for gift select to populate (options loaded from gift catalog)
    const giftSelect = page.locator('#backpack-gift-select');
    await expect(giftSelect).toBeVisible({ timeout: 15_000 });

    // Pick the first non-empty option
    await page.waitForFunction(() => {
      const select = document.getElementById('backpack-gift-select') as HTMLSelectElement;
      return select && select.options.length > 1;
    }, { timeout: 15_000 });

    const firstGiftId = await giftSelect.evaluate((el: HTMLSelectElement) => {
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].value) return el.options[i].value;
      }
      return '';
    });
    expect(firstGiftId).not.toBe('');

    // Select the gift, set qty to 3, click Add
    await giftSelect.selectOption(firstGiftId);
    await page.locator('#backpack-qty').fill('3');
    await page.locator('#backpack-add-btn').click();

    // Verify gift appears in backpack grid
    const backpackGrid = page.locator('#backpack-grid');
    const giftCard = backpackGrid.locator(`.backpack-item[data-gift-id="${firstGiftId}"]`);
    await expect(giftCard).toBeVisible({ timeout: 15_000 });
    await expect(giftCard.locator('.backpack-qty-badge')).toHaveText('3');

    // Reload and verify persistence
    await reloadAndNavigateToEconomy(page, uid);
    const giftCardAfter = page.locator(`#backpack-grid .backpack-item[data-gift-id="${firstGiftId}"]`);
    await expect(giftCardAfter).toBeVisible({ timeout: 15_000 });

    // Clean up: remove the gift via API
    await testData.api.post(`/api/users/${uid}/backpack`, {
      giftId: firstGiftId, quantity: 0, silent: true,
    });
  });

  // ── Test 6: Remove gift from backpack ──
  test('remove gift from backpack', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // First, add a gift via API so we have something to remove
    const giftSelect = page.locator('#backpack-gift-select');
    await page.waitForFunction(() => {
      const select = document.getElementById('backpack-gift-select') as HTMLSelectElement;
      return select && select.options.length > 1;
    }, { timeout: 15_000 });

    const firstGiftId = await giftSelect.evaluate((el: HTMLSelectElement) => {
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].value) return el.options[i].value;
      }
      return '';
    });

    // Add the gift via API
    await testData.api.post(`/api/users/${uid}/backpack`, {
      giftId: firstGiftId, quantity: 2, silent: true,
    });

    // Reload to see the gift in the backpack
    await reloadAndNavigateToEconomy(page, uid);

    // Verify the gift is present
    const backpackGrid = page.locator('#backpack-grid');
    const giftCard = backpackGrid.locator(`.backpack-item[data-gift-id="${firstGiftId}"]`);
    await expect(giftCard).toBeVisible({ timeout: 15_000 });

    // Click the remove button (X) on the gift card
    const removeBtn = giftCard.locator('.backpack-remove-btn');
    await removeBtn.click();

    // Wait for the item to disappear from the grid
    await expect(giftCard).not.toBeVisible({ timeout: 15_000 });

    // Reload and verify the gift is gone
    await reloadAndNavigateToEconomy(page, uid);
    const giftCardAfter = page.locator(`#backpack-grid .backpack-item[data-gift-id="${firstGiftId}"]`);
    await expect(giftCardAfter).not.toBeVisible({ timeout: 5_000 });

    // Verify via API: backpack should not contain this gift
    const backpack = await testData.api.get(`/api/users/${uid}/backpack`);
    const items = Array.isArray(backpack) ? backpack : (backpack.items || []);
    const found = items.find((item: any) => item.giftId === firstGiftId);
    expect(found).toBeUndefined();
  });

  // ── Test 7: Transaction history shows admin adjustments ──
  test('transaction history shows admin adjustments', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Add 100 coins to create a transaction
    await page.locator('#eco-coins-op').selectOption('add');
    await page.locator('#eco-coins-amount').fill('100');
    await page.locator('#eco-coins-apply').click();

    // Wait for the coins display to update (confirms the action succeeded)
    await expect(page.locator('#eco-coins-display')).toHaveText('1100', { timeout: 15_000 });

    // Click Load to load transaction history
    await page.locator('#tx-load-btn').click();

    // Verify the transaction list contains an ADMIN_ADJUSTMENT entry
    const txList = page.locator('#tx-list');
    await expect(txList.locator('text=ADMIN_ADJUSTMENT')).toBeVisible({ timeout: 15_000 });

    // Verify via API
    const txData = await testData.api.get(`/api/users/${uid}/transactions?type=ADMIN_ADJUSTMENT`);
    const transactions = Array.isArray(txData) ? txData : (txData.transactions || []);
    expect(transactions.length).toBeGreaterThan(0);
    const latest = transactions[0];
    expect(latest.type).toBe('ADMIN_ADJUSTMENT');

    // Restore: deduct 100 via API
    await testData.api.post(`/api/users/${uid}/adjust-balance`, {
      currency: 'COINS', amount: -100,
    });
  });

  // ── Test 8: Transaction type filter works ──
  test('transaction type filter works', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Ensure we have at least one ADMIN_ADJUSTMENT transaction by adding 50 coins
    await page.locator('#eco-coins-op').selectOption('add');
    await page.locator('#eco-coins-amount').fill('50');
    await page.locator('#eco-coins-apply').click();
    await expect(page.locator('#eco-coins-display')).not.toHaveText('1000', { timeout: 15_000 });

    // Select "Admin Adjustment" from the type filter
    await page.locator('#tx-type-filter').selectOption('ADMIN_ADJUSTMENT');
    await page.locator('#tx-load-btn').click();

    // Verify only ADMIN_ADJUSTMENT entries are shown
    const txList = page.locator('#tx-list');
    await expect(txList.locator('text=ADMIN_ADJUSTMENT')).toBeVisible({ timeout: 15_000 });

    // Verify all entries in the list are ADMIN_ADJUSTMENT
    const entries = txList.locator('div[style*="border-bottom"] span[style*="accent"]');
    const count = await entries.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(entries.nth(i)).toHaveText('ADMIN_ADJUSTMENT');
    }

    // Select "All Types" and reload
    await page.locator('#tx-type-filter').selectOption('');
    await page.locator('#tx-load-btn').click();

    // Wait for results to load
    await expect(txList.locator('div[style*="border-bottom"]')).toBeVisible({ timeout: 15_000 });

    // Restore: deduct 50 via API
    await testData.api.post(`/api/users/${uid}/adjust-balance`, {
      currency: 'COINS', amount: -50,
    });
  });

  // ── Test 9: Pity counter editable and persists ──
  // Note: The admin panel has a pity counter input (#eco-pity) but no luck
  // score input. Pity counter auto-saves on blur via PATCH /api/user/{uid}.
  test('pity counter editable and persists', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Verify initial pity counter is 0
    const pityInput = page.locator('#eco-pity');
    await expect(pityInput).toHaveValue('0', { timeout: 15_000 });

    // Change pity counter to 10
    await pityInput.fill('10');
    await waitForPityAutoSave(page);

    // Reload and verify persistence
    await reloadAndNavigateToEconomy(page, uid);
    await expect(page.locator('#eco-pity')).toHaveValue('10', { timeout: 15_000 });

    // Verify via API
    const luck = await testData.api.get(`/api/users/${uid}/luck`);
    expect(luck.pityCounter).toBe(10);

    // Restore: set pity counter back to 0 via API
    await testData.api.post(`/api/users/${uid}/luck`, { pityCounter: 0 });
  });

  // ── Test 10: Coins cannot go below zero ──
  test('coins cannot go below zero', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Verify starting balance is 1000
    await expect(page.locator('#eco-coins-display')).toHaveText('1000', { timeout: 15_000 });

    // Deduct 9999 (more than current balance)
    await page.locator('#eco-coins-op').selectOption('deduct');
    await page.locator('#eco-coins-amount').fill('9999');
    await page.locator('#eco-coins-apply').click();

    // Verify display shows 0 (clamped, not negative)
    const coinsDisplay = page.locator('#eco-coins-display');
    await expect(coinsDisplay).toHaveText('0', { timeout: 15_000 });

    // Verify via API
    const economy = await testData.api.get(`/api/users/${uid}/economy`);
    expect(economy.shyCoins).toBe(0);

    // Restore: add 1000 to get back to seeded amount
    await testData.api.post(`/api/users/${uid}/adjust-balance`, {
      currency: 'COINS', amount: 1000,
    });
  });
});
