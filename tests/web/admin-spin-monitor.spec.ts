import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/**
 * Helper: navigate to the Spin Monitor tab and wait for it to be visible.
 */
async function goToMonitor(page: Page): Promise<void> {
  await navigateToTab(page, 'Spin Monitor');
  await expect(page.locator('#monitor-panel')).toHaveClass(/visible/);
}

/**
 * Helper: start monitoring a user by uniqueId and wait for stats to appear.
 */
async function startMonitoringUser(page: Page, uniqueId: number): Promise<void> {
  await page.locator('#monitor-uid-input').fill(String(uniqueId));
  await page.locator('#monitor-start-btn').click();
  // UI should appear immediately (admin panel shows status before Firestore connects)
  await expect(page.locator('#monitor-status')).toBeVisible();
  await expect(page.locator('#monitor-stats')).toBeVisible();
  await expect(page.locator('#monitor-dot')).toHaveClass(/live/);
}

/**
 * Helper: stop monitoring and wait for UI to reset.
 */
async function stopMonitoring(page: Page): Promise<void> {
  await page.locator('#monitor-stop-btn').click();
  await expect(page.locator('#monitor-start-btn')).toBeVisible();
}

test.describe('Admin Spin Monitor', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await goToMonitor(page);
  });

  // ── Test 1: Empty state ──
  test('empty state — input and start visible, stop hidden', async ({ page }) => {
    // Input should be visible and empty
    const input = page.locator('#monitor-uid-input');
    await expect(input).toBeVisible();

    // Start button visible
    await expect(page.locator('#monitor-start-btn')).toBeVisible();

    // Stop button hidden
    await expect(page.locator('#monitor-stop-btn')).toBeHidden();

    // Status should not be visible (no user monitored)
    // The monitor-status div has display:none by default
    const statusDisplay = await page.locator('#monitor-status').evaluate(
      (el: HTMLElement) => window.getComputedStyle(el).display,
    );
    expect(statusDisplay).toBe('none');

    // Stats should not be visible
    const statsDisplay = await page.locator('#monitor-stats').evaluate(
      (el: HTMLElement) => window.getComputedStyle(el).display,
    );
    expect(statsDisplay).toBe('none');
  });

  // ── Test 2: Start monitoring ──
  test('start monitoring — enter uniqueId, click Start, verify status and name', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    // Verify status dot is live (green)
    await expect(page.locator('#monitor-dot')).toHaveClass(/live/);

    // Verify user name displays
    const userName = await page.locator('#monitor-user-name').textContent();
    expect(userName).toBeTruthy();
    expect(userName).not.toBe('\u2014'); // not the dash placeholder

    // Verify status text contains the user info
    const statusText = await page.locator('#monitor-status-text').textContent();
    expect(statusText).toContain('Live');

    // Stop button should be visible, start hidden
    await expect(page.locator('#monitor-stop-btn')).toBeVisible();
    await expect(page.locator('#monitor-start-btn')).toBeHidden();

    // Clean up
    await stopMonitoring(page);
  });

  // ── Test 3: Start via Enter key ──
  test('start via Enter key — type uniqueId, press Enter, verify starts', async ({ page, testData }) => {
    const input = page.locator('#monitor-uid-input');
    await input.fill(String(testData.user.uniqueId));
    // Use page.keyboard.press — WebKit does not reliably fire keydown
    // from locator.press() on inputs with inputmode="numeric"
    await input.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#monitor-status')).toBeVisible();
    await expect(page.locator('#monitor-dot')).toHaveClass(/live/);

    // Verify it started correctly
    const statusText = await page.locator('#monitor-status-text').textContent();
    expect(statusText).toContain('Live');

    // Clean up
    await stopMonitoring(page);
  });

  // ── Test 4: Stop monitoring ──
  test('stop monitoring — click Stop, verify status gone', async ({ page, testData }) => {
    // Start first
    await startMonitoringUser(page, testData.user.uniqueId);
    await expect(page.locator('#monitor-dot')).toHaveClass(/live/);

    // Stop
    await stopMonitoring(page);

    // Verify status dot is no longer live
    await expect(page.locator('#monitor-dot')).not.toHaveClass(/live/);

    // Status text should say Disconnected
    await expect(page.locator('#monitor-status-text')).toHaveText('Disconnected');

    // Start button visible, stop hidden
    await expect(page.locator('#monitor-start-btn')).toBeVisible();
    await expect(page.locator('#monitor-stop-btn')).toBeHidden();
  });

  // ── Test 5: Live coin display ──
  test('live coin display — verify #monitor-coins shows current coins', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    // #monitor-coins should show a numeric value (not the placeholder dash)
    const coinsText = await page.locator('#monitor-coins').textContent();
    expect(coinsText).toBeTruthy();
    expect(coinsText).not.toBe('\u2014');

    // The displayed value should be a formatted number (may have commas)
    const coinsNum = Number(coinsText!.replace(/,/g, ''));
    expect(coinsNum).toBeGreaterThan(0);

    // Clean up
    await stopMonitoring(page);
  });

  // ── Test 6: Pity progress bar ──
  test('pity progress bar — verify #monitor-pity shows pity value', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    // #monitor-pity should show a pity value like "0 / 120"
    const pityText = await page.locator('#monitor-pity').textContent();
    expect(pityText).toBeTruthy();
    expect(pityText).not.toBe('\u2014');
    expect(pityText).toContain('/'); // format is "X / Y"

    // Pity bar should have a width style set
    const barWidth = await page.locator('#monitor-pity-bar').evaluate(
      (el: HTMLElement) => el.style.width,
    );
    expect(barWidth).toBeTruthy();

    // Clean up
    await stopMonitoring(page);
  });

  // ── Test 7: Guarantee set ──
  test('guarantee set — select gift, click Set, verify status and API', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    // Wait for guarantee gift dropdown to be populated
    const giftSelect = page.locator('#guarantee-gift-select');
    await expect(giftSelect.locator('option')).not.toHaveCount(1);

    // Select the first non-placeholder gift option
    const options = giftSelect.locator('option');
    const optCount = await options.count();
    expect(optCount).toBeGreaterThan(1);
    const firstGiftValue = await options.nth(1).getAttribute('value');
    expect(firstGiftValue).toBeTruthy();
    await giftSelect.selectOption(firstGiftValue!);

    // Accept all confirm dialogs (set + revoke both trigger confirm())
    page.on('dialog', (dialog) => dialog.accept());

    // Click Set Guarantee
    await page.locator('#guarantee-set-btn').click();

    // Wait for guarantee status to show "Active"
    await expect(page.locator('#guarantee-status')).toContainText('Active');

    // Revoke button should now be visible
    await expect(page.locator('#guarantee-revoke-btn')).toBeVisible();

    // API verify: guarantee should be active
    const apiResult = await testData.api.get(
      `/api/users/${testData.user.uniqueId}/guarantee-next-pull`,
    );
    expect(apiResult.active).toBe(true);

    // Clean up: revoke the guarantee
    await page.locator('#guarantee-revoke-btn').click();
    await expect(page.locator('#guarantee-status')).not.toContainText('Active');

    await stopMonitoring(page);
  });

  // ── Test 8: Guarantee revoke ──
  test('guarantee revoke — set then revoke, verify cleared', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    // Wait for guarantee gift dropdown to be populated
    const giftSelect = page.locator('#guarantee-gift-select');
    await expect(giftSelect.locator('option')).not.toHaveCount(1);

    // Select a gift and set guarantee
    const options = giftSelect.locator('option');
    const firstGiftValue = await options.nth(1).getAttribute('value');
    await giftSelect.selectOption(firstGiftValue!);

    // Accept confirm dialogs
    page.on('dialog', (dialog) => dialog.accept());

    await page.locator('#guarantee-set-btn').click();
    await expect(page.locator('#guarantee-status')).toContainText('Active');

    // Now revoke
    await page.locator('#guarantee-revoke-btn').click();

    // Verify status no longer shows Active
    await expect(page.locator('#guarantee-status')).toContainText('No guarantee set');

    // Revoke button should be hidden
    await expect(page.locator('#guarantee-revoke-btn')).toBeHidden();

    // API verify: guarantee should be inactive
    const apiResult = await testData.api.get(
      `/api/users/${testData.user.uniqueId}/guarantee-next-pull`,
    );
    expect(apiResult.active).toBe(false);

    await stopMonitoring(page);
  });

  // ── Test 9: Session vs all-time stats ──
  test('session and all-time stats — both display numeric values', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    // Wait for the totals wrap to be visible (confirms monitoring started
    // and the display:none wrapper has been shown)
    await expect(page.locator('#monitor-totals-wrap')).toBeVisible();

    // Session stats are initialized to "0" by updateSessionTotals() — verify
    // the element has a non-null, non-empty textContent (WebKit can return
    // null for text inside recently-shown containers)
    await expect(page.locator('#session-spins')).toHaveText(/\d+/);
    const sessionSpins = await page.locator('#session-spins').textContent();
    expect(sessionSpins).toBeTruthy();
    const sessionSpinsNum = Number(sessionSpins!.replace(/,/g, ''));
    expect(sessionSpinsNum).toBeGreaterThanOrEqual(0);

    const sessionSpent = await page.locator('#session-spent').textContent();
    expect(sessionSpent).toBeTruthy();
    const sessionSpentNum = Number(sessionSpent!.replace(/,/g, ''));
    expect(sessionSpentNum).toBeGreaterThanOrEqual(0);

    // All-time stats should show numeric values (or "?" if load failed)
    const alltimeSpins = await page.locator('#alltime-spins').textContent();
    expect(alltimeSpins).toBeTruthy();
    // Could be a number or "?" — both are valid displays
    if (alltimeSpins !== '?') {
      const alltimeSpinsNum = Number(alltimeSpins!.replace(/,/g, ''));
      expect(alltimeSpinsNum).toBeGreaterThanOrEqual(0);
    }

    const alltimeSpent = await page.locator('#alltime-spent').textContent();
    expect(alltimeSpent).toBeTruthy();

    // Clean up
    await stopMonitoring(page);
  });

  // ── Test 10: Spin history collapsible ──
  test('spin history collapsible — click toggle, verify expands/collapses', async ({ page, testData }) => {
    await startMonitoringUser(page, testData.user.uniqueId);

    const toggle = page.locator('#spin-history-toggle');
    const summary = page.locator('#spin-history-summary');
    const feed = page.locator('#spin-feed');

    // Initially closed
    expect(await toggle.evaluate((el: any) => el.open)).toBe(false);

    // Open it via JS click (on mobile, a floating element covers the summary
    // and intercepts Playwright's coordinate-based click)
    await summary.evaluate((el: HTMLElement) => el.click());
    expect(await toggle.evaluate((el: any) => el.open)).toBe(true);
    await expect(feed).toBeVisible();

    // Close it
    await summary.evaluate((el: HTMLElement) => el.click());
    expect(await toggle.evaluate((el: any) => el.open)).toBe(false);

    // Clean up
    await stopMonitoring(page);
  });
});
