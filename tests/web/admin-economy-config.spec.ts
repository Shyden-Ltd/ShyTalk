import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL || 'https://dev-api.shytalk.shyden.co.uk';

/**
 * Helper: save the economy config by clicking the Save button and waiting for success.
 */
async function saveEconomyConfig(page: Page): Promise<void> {
  const btn = page.locator('#eco-save-btn');
  await btn.click();
  // Wait for "Economy config saved" toast or the save-info to show "Saved:"
  await expect(page.locator('#eco-save-info')).toContainText('Saved', { timeout: 15_000 });
}

/**
 * Helper: reload the page and navigate back to the Economy tab.
 */
async function reloadAndNavigateToEconomy(page: Page): Promise<void> {
  await page.reload();
  await adminLogin(page);
  await navigateToTab(page, 'Economy');
  // Wait for a known field to be populated (beanConversionRate is always present)
  await expect(page.locator('#eco-beanConversionRate')).not.toHaveValue('', { timeout: 15_000 });
}

/**
 * Helper: restore economy config from testData.economyConfig via PUT API.
 */
async function restoreEconomyConfig(page: Page, testData: TestData): Promise<void> {
  const token = await testData.api.waitForToken();
  const res = await page.request.put(`${API_BASE}/api/config/economy`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: testData.economyConfig,
  });
  expect(res.ok()).toBe(true);
}

/**
 * Helper: fill an input field and dispatch input+change events so the JS picks it up.
 */
async function fillField(page: Page, selector: string, value: string): Promise<void> {
  const el = page.locator(selector);
  await el.fill(value);
  await el.dispatchEvent('input');
  await el.dispatchEvent('change');
}

/**
 * Helper: set a range slider value and verify the live display updates.
 */
async function setSlider(page: Page, sliderId: string, displayId: string, value: string): Promise<void> {
  const slider = page.locator(sliderId);
  await slider.fill(value);
  await slider.dispatchEvent('input');
  await slider.dispatchEvent('change');
  await expect(page.locator(displayId)).toHaveText(value);
}

test.describe('Admin Economy Config', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Economy config is a singleton');

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Economy');
    // Wait for config to load
    await expect(page.locator('#eco-beanConversionRate')).not.toHaveValue('', { timeout: 15_000 });
  });

  // ── Test 1: Config loads correctly ──
  test('config loads correctly — values match API', async ({ page, testData }) => {
    const apiConfig = await testData.api.get('/api/config/economy');

    // Bean conversion rate
    const beanRate = await page.locator('#eco-beanConversionRate').inputValue();
    if (apiConfig.beanConversionRate !== undefined) {
      expect(Number(beanRate)).toBe(apiConfig.beanConversionRate);
    }

    // Pull costs
    const pullCosts = apiConfig.pullCosts || {};
    for (const k of ['1', '10', '100']) {
      if (pullCosts[k] !== undefined) {
        const val = await page.locator(`#eco-pullCost-${k}`).inputValue();
        expect(Number(val)).toBe(pullCosts[k]);
      }
    }

    // Pity params
    if (apiConfig.pitySoftStart !== undefined) {
      const ps = await page.locator('#eco-pitySoftStart').inputValue();
      expect(Number(ps)).toBe(apiConfig.pitySoftStart);
    }
    if (apiConfig.pityHardLimit !== undefined) {
      const ph = await page.locator('#eco-pityHardLimit').inputValue();
      expect(Number(ph)).toBe(apiConfig.pityHardLimit);
    }
  });

  // ── Test 2: Bean conversion rate ──
  test('bean conversion rate — change, save, reload verify', async ({ page, testData }) => {
    const original = await page.locator('#eco-beanConversionRate').inputValue();
    const newVal = '0.77';

    await fillField(page, '#eco-beanConversionRate', newVal);
    await saveEconomyConfig(page);

    // Reload and verify
    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-beanConversionRate')).toHaveValue(newVal);

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.beanConversionRate).toBe(0.77);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 3: Bean redeem bonus threshold ──
  test('bean redeem bonus threshold — change, save, reload', async ({ page, testData }) => {
    const newVal = '3500';

    await fillField(page, '#eco-beanRedeemBonusThreshold', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-beanRedeemBonusThreshold')).toHaveValue(newVal);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 4: Bean redeem bonus multiplier ──
  test('bean redeem bonus multiplier — change, save, reload', async ({ page, testData }) => {
    const newVal = '1.25';

    await fillField(page, '#eco-beanRedeemBonusMultiplier', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-beanRedeemBonusMultiplier')).toHaveValue(newVal);

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.beanRedeemBonusMultiplier).toBe(1.25);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 5: Drop rate exponent slider ──
  test('drop rate exponent slider — drag, verify live display, save, reload', async ({ page, testData }) => {
    await setSlider(page, '#eco-dropRateExponent', '#eco-dropRateExponent-val', '2.3');
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-dropRateExponent')).toHaveValue('2.3');
    await expect(page.locator('#eco-dropRateExponent-val')).toHaveText('2.3');

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 6: Pull costs (1/10/100) ──
  test('pull costs — change all three, save, reload verify', async ({ page, testData }) => {
    await fillField(page, '#eco-pullCost-1', '15');
    await fillField(page, '#eco-pullCost-10', '140');
    await fillField(page, '#eco-pullCost-100', '1300');
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-pullCost-1')).toHaveValue('15');
    await expect(page.locator('#eco-pullCost-10')).toHaveValue('140');
    await expect(page.locator('#eco-pullCost-100')).toHaveValue('1300');

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.pullCosts?.['1']).toBe(15);
    expect(apiConfig.pullCosts?.['10']).toBe(140);
    expect(apiConfig.pullCosts?.['100']).toBe(1300);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 7: Wheel inner ring threshold (P1 whitelist required) ──
  test('wheel inner ring threshold — change, save, reload verify', async ({ page, testData }) => {
    const newVal = '20000';

    await fillField(page, '#eco-wheelInnerThreshold', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-wheelInnerThreshold')).toHaveValue(newVal);

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.wheelInnerThreshold).toBe(20000);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 8: Pity soft start ──
  test('pity soft start — change, save, reload', async ({ page, testData }) => {
    const newVal = '90';

    await fillField(page, '#eco-pitySoftStart', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-pitySoftStart')).toHaveValue(newVal);

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.pitySoftStart).toBe(90);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 9: Pity hard limit ──
  test('pity hard limit — change, save, reload', async ({ page, testData }) => {
    const newVal = '150';

    await fillField(page, '#eco-pityHardLimit', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-pityHardLimit')).toHaveValue(newVal);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 10: Pity soft max shift slider ──
  test('pity soft max shift slider — set, verify live display, save, reload', async ({ page, testData }) => {
    await setSlider(page, '#eco-pitySoftMaxShift', '#eco-pitySoftMaxShift-val', '0.25');
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-pitySoftMaxShift')).toHaveValue('0.25');
    await expect(page.locator('#eco-pitySoftMaxShift-val')).toHaveText('0.25');

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 11: Pity high value threshold ──
  test('pity high value threshold — change, save, reload', async ({ page, testData }) => {
    const newVal = '8000';

    await fillField(page, '#eco-pityHighValueThreshold', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-pityHighValueThreshold')).toHaveValue(newVal);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 12: Daily base reward ──
  test('daily base reward — change, save, reload', async ({ page, testData }) => {
    const newVal = '75';

    await fillField(page, '#eco-dailyBase', newVal);
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-dailyBase')).toHaveValue(newVal);

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.dailyBase).toBe(75);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 13: Milestone add/remove ──
  test('milestone add and remove — persist through save/reload', async ({ page, testData }) => {
    // Count existing milestones
    const initialRows = page.locator('#milestone-rows .milestone-row');
    const initialCount = await initialRows.count();

    // Click Add Milestone
    await page.locator('#ms-add-btn').click();
    await expect(initialRows).toHaveCount(initialCount + 1, { timeout: 5_000 });

    // Fill the new milestone row (last one)
    const newRow = page.locator('#milestone-rows .milestone-row').last();
    const dayInput = newRow.locator('.ms-day');
    await dayInput.fill('99');
    await dayInput.dispatchEvent('change');

    // Type should default to "coins" — fill amount
    const amountInput = newRow.locator('.ms-amount');
    await amountInput.fill('500');
    await amountInput.dispatchEvent('change');

    // Save
    await saveEconomyConfig(page);

    // Reload and verify the milestone exists
    await reloadAndNavigateToEconomy(page);
    const afterReloadRows = page.locator('#milestone-rows .milestone-row');
    await expect(afterReloadRows).toHaveCount(initialCount + 1, { timeout: 10_000 });

    // Verify the day-99 milestone
    const lastRow = page.locator('#milestone-rows .milestone-row').last();
    await expect(lastRow.locator('.ms-day')).toHaveValue('99');

    // Now remove it
    await lastRow.locator('.ms-remove-btn').click();
    await expect(page.locator('#milestone-rows .milestone-row')).toHaveCount(initialCount);

    // Save and verify removal
    await saveEconomyConfig(page);
    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#milestone-rows .milestone-row')).toHaveCount(initialCount, { timeout: 10_000 });

    // Restore full config to be safe
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 14: Milestone type toggle ──
  test('milestone type toggle — gift type shows gift select', async ({ page, testData }) => {
    // Add a new milestone
    await page.locator('#ms-add-btn').click();
    const newRow = page.locator('#milestone-rows .milestone-row').last();

    // Set day
    const dayInput = newRow.locator('.ms-day');
    await dayInput.fill('88');
    await dayInput.dispatchEvent('change');

    // Change type to "gift"
    const typeSelect = newRow.locator('.ms-type');
    await typeSelect.selectOption('gift');

    // Verify gift select dropdown appears (re-renders the row)
    const updatedRow = page.locator('#milestone-rows .milestone-row').last();
    await expect(updatedRow.locator('.ms-gift-select')).toBeVisible({ timeout: 5_000 });

    // Select a gift from the dropdown (first non-empty option)
    const giftSelect = updatedRow.locator('.ms-gift-select');
    const options = giftSelect.locator('option');
    const optCount = await options.count();
    if (optCount > 1) {
      // Select the second option (first is the placeholder)
      const secondVal = await options.nth(1).getAttribute('value');
      if (secondVal) {
        await giftSelect.selectOption(secondVal);
      }
    }

    // Save
    await saveEconomyConfig(page);

    // Reload and verify gift type persists
    await reloadAndNavigateToEconomy(page);
    const reloadedLastRow = page.locator('#milestone-rows .milestone-row').last();
    await expect(reloadedLastRow.locator('.ms-type')).toHaveValue('gift', { timeout: 10_000 });
    await expect(reloadedLastRow.locator('.ms-gift-select')).toBeVisible();

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 15: Broadcast thresholds ──
  test('broadcast thresholds — change send + win, save, reload', async ({ page, testData }) => {
    await fillField(page, '#eco-broadcastSendThreshold', '7500');
    await fillField(page, '#eco-broadcastWinThreshold', '9000');
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-broadcastSendThreshold')).toHaveValue('7500');
    await expect(page.locator('#eco-broadcastWinThreshold')).toHaveValue('9000');

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.broadcastSendThreshold).toBe(7500);
    expect(apiConfig.broadcastWinThreshold).toBe(9000);

    // Restore
    await restoreEconomyConfig(page, testData);
  });

  // ── Test 16: Room durations (P1 whitelist required) ──
  test('room durations — change max + superShy, save, reload', async ({ page, testData }) => {
    await fillField(page, '#eco-maxRoomDurationMinutes', '480');
    await fillField(page, '#eco-superShyRoomDurationMinutes', '960');
    await saveEconomyConfig(page);

    await reloadAndNavigateToEconomy(page);
    await expect(page.locator('#eco-maxRoomDurationMinutes')).toHaveValue('480');
    await expect(page.locator('#eco-superShyRoomDurationMinutes')).toHaveValue('960');

    // API verify
    const apiConfig = await testData.api.get('/api/config/economy');
    expect(apiConfig.maxRoomDurationMinutes).toBe(480);
    expect(apiConfig.superShyRoomDurationMinutes).toBe(960);

    // Restore
    await restoreEconomyConfig(page, testData);
  });
});
