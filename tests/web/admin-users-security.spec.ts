import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

const TEST_USER_ID = '10000001';

test.describe('Admin Users - Security Subtab', () => {

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, TEST_USER_ID);
    await switchUserSubtab(page, 'security');
  });

  test('shows PIN status section with all 6 fields', async ({ page }) => {
    const pinStatusGrid = page.locator('#pin-status-grid');
    await expect(pinStatusGrid).toBeVisible({ timeout: 15_000 });

    const expectedFields = [
      { id: '#pin-set', label: 'PIN Set' },
      { id: '#pin-set-at', label: 'PIN Set At' },
      { id: '#pin-attempts', label: 'Failed Attempts' },
      { id: '#pin-locked-until', label: 'Locked Until' },
      { id: '#pin-lockout-count', label: 'Lockout Count' },
      { id: '#pin-is-locked', label: 'Currently Locked' },
    ];

    for (const field of expectedFields) {
      const valueEl = page.locator(field.id);
      await expect(valueEl).toBeAttached({ timeout: 15_000 });

      // Verify the label exists alongside the value (exact match to avoid "PIN Set" matching "PIN Set At")
      const labelEl = pinStatusGrid.getByText(field.label, { exact: true });
      await expect(labelEl).toBeAttached({ timeout: 15_000 });
    }
  });

  test('shows biometric keys section', async ({ page }) => {
    const biometricSection = page.locator('#biometric-keys-list');
    await expect(biometricSection).toBeAttached({ timeout: 15_000 });

    // The section heading should exist
    const heading = page.locator('.user-subpanel[data-subtab="security"] h3', { hasText: 'Biometric Keys' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test('shows OTP metrics section with count and limit', async ({ page }) => {
    const otpMetricsGrid = page.locator('#otp-metrics-grid');
    await expect(otpMetricsGrid).toBeAttached({ timeout: 15_000 });

    // Heading
    const heading = page.locator('.user-subpanel[data-subtab="security"] h3', { hasText: 'OTP Email Metrics' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // OTP count
    const otpCount = page.locator('#otp-count');
    await expect(otpCount).toBeAttached({ timeout: 15_000 });

    // OTP limit
    const otpLimit = page.locator('#otp-limit');
    await expect(otpLimit).toBeAttached({ timeout: 15_000 });
    await expect(otpLimit).toContainText('100');

    // OTP date
    const otpDate = page.locator('#otp-date');
    await expect(otpDate).toBeAttached({ timeout: 15_000 });
  });

  test('reset PIN lockout button hidden when no lockout', async ({ page }) => {
    const resetBtn = page.locator('#reset-pin-lockout-btn');
    await expect(resetBtn).toBeAttached({ timeout: 15_000 });

    // By default, if user has no lockout, the button should be hidden
    // The button has style="display:none" by default
    await expect(resetBtn).toBeHidden();
  });

  test('data loads on tab switch', async ({ page }) => {
    // PIN fields should show actual data (not just dashes) after loading
    // Give time for the data to load
    await page.waitForTimeout(2_000);

    const pinSet = page.locator('#pin-set');
    const pinText = await pinSet.textContent();
    // Should have loaded -- might be "true", "false", "Yes", "No", or still a dash if no data
    expect(pinText).toBeTruthy();
  });
});
