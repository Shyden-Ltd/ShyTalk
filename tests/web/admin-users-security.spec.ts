import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

/**
 * Helper: navigate back to the user's security subtab after a reload.
 * Every reload loses the current user context, so we must re-login, search, and switch.
 */
async function reloadAndNavigateToSecurity(
  page: import('@playwright/test').Page,
  uniqueId: string,
): Promise<void> {
  await page.reload();
  await adminLogin(page);
  await navigateToTab(page, 'Users');
  await searchUser(page, uniqueId);
  await switchUserSubtab(page, 'security');
}

test.describe('Admin Users - Security Subtab', () => {

  test.beforeEach(async ({ page, testData }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, String(testData.user.uniqueId));
    await switchUserSubtab(page, 'security');
  });

  // ── Test 1: PIN status fields show correct data ──
  test('PIN status fields show correct data', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Wait for PIN status grid to be visible
    const pinStatusGrid = page.locator('#pin-status-grid');
    await expect(pinStatusGrid).toBeVisible({ timeout: 15_000 });

    // Verify #pin-set shows "Yes" or "No"
    const pinSet = page.locator('#pin-set');
    await expect(pinSet).toBeVisible({ timeout: 15_000 });
    const pinSetText = await pinSet.textContent();
    expect(pinSetText).toBeTruthy();
    expect(['Yes', 'No']).toContain(pinSetText!.trim());

    // Verify #pin-attempts shows a number
    const pinAttempts = page.locator('#pin-attempts');
    await expect(pinAttempts).toBeVisible({ timeout: 15_000 });
    const pinAttemptsText = await pinAttempts.textContent();
    expect(pinAttemptsText).toBeTruthy();
    expect(Number(pinAttemptsText!.trim())).not.toBeNaN();

    // Verify #pin-is-locked shows "Yes" or "No"
    const pinIsLocked = page.locator('#pin-is-locked');
    await expect(pinIsLocked).toBeVisible({ timeout: 15_000 });
    const pinIsLockedText = await pinIsLocked.textContent();
    expect(pinIsLockedText).toBeTruthy();
    expect(['Yes', 'No']).toContain(pinIsLockedText!.trim());

    // API: verify displayed values match auth-status endpoint
    const authStatus = await testData.api.get(`/api/user/${uid}/auth-status`);

    // Compare pinSet: API returns boolean, UI shows "Yes"/"No"
    const expectedPinSet = authStatus.pinSet ? 'Yes' : 'No';
    expect(pinSetText!.trim()).toBe(expectedPinSet);

    // Compare pinAttempts: API returns number
    expect(Number(pinAttemptsText!.trim())).toBe(authStatus.pinAttempts ?? 0);

    // Compare isLocked: API returns boolean, UI shows "Yes"/"No"
    const expectedIsLocked = authStatus.isLocked ? 'Yes' : 'No';
    expect(pinIsLockedText!.trim()).toBe(expectedIsLocked);
  });

  // ── Test 2: Biometric keys section renders ──
  test('biometric keys section renders', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Verify heading "Biometric Keys" is visible under security subpanel
    const heading = page.locator('.user-subpanel[data-subtab="security"] h3', { hasText: 'Biometric Keys' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Verify #biometric-keys-list is present
    const biometricKeysList = page.locator('#biometric-keys-list');
    await expect(biometricKeysList).toBeAttached({ timeout: 15_000 });

    // API: get biometric keys from auth-status
    const authStatus = await testData.api.get(`/api/user/${uid}/auth-status`);
    const biometricKeys: any[] = authStatus.biometricKeys || [];

    if (biometricKeys.length > 0) {
      // If there are biometric keys, verify device IDs are displayed
      for (const key of biometricKeys) {
        const deviceId = key.deviceId || key.id;
        if (deviceId) {
          await expect(biometricKeysList).toContainText(deviceId, { timeout: 10_000 });
        }
      }
    } else {
      // No keys — the list should show empty state or "No biometric keys"
      // Just confirm the section exists (already verified above)
      // The section rendered but may show "Loading..." or empty text — that's fine
      // biometricKeysList attachment already verified above
    }
  });

  // ── Test 3: OTP metrics show correct data ──
  test('OTP metrics show correct data', async ({ page, testData }) => {
    // Verify OTP metrics grid is visible
    const otpMetricsGrid = page.locator('#otp-metrics-grid');
    await expect(otpMetricsGrid).toBeVisible({ timeout: 15_000 });

    // Verify #otp-count is visible
    const otpCount = page.locator('#otp-count');
    await expect(otpCount).toBeVisible({ timeout: 15_000 });
    const otpCountText = await otpCount.textContent();
    expect(otpCountText).toBeTruthy();

    // Verify #otp-limit is visible and contains "100"
    const otpLimit = page.locator('#otp-limit');
    await expect(otpLimit).toBeVisible({ timeout: 15_000 });
    await expect(otpLimit).toContainText('100');

    // API: verify OTP metrics (global, not per-user)
    const otpMetrics = await testData.api.get('/metrics/otp');
    expect(otpMetrics.limit).toBe(100);
    expect(typeof otpMetrics.count).toBe('number');

    // Verify displayed count matches API count
    expect(Number(otpCountText!.trim())).toBe(otpMetrics.count);
  });

  // ── Test 4: Reset PIN lockout ──
  test('reset PIN lockout', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    const resetBtn = page.locator('#reset-pin-lockout-btn');
    await expect(resetBtn).toBeAttached({ timeout: 15_000 });

    // Check if the button is visible (user has lockout) or hidden (no lockout)
    const isVisible = await resetBtn.isVisible();

    if (isVisible) {
      // User has lockout — click reset
      await resetBtn.click();

      // Verify success toast appears
      const toast = page.locator('.toast.visible');
      await expect(toast).toBeVisible({ timeout: 15_000 });

      // Reload → verify lockout cleared
      await reloadAndNavigateToSecurity(page, uid);

      // After reset, the button should be hidden (no more lockout)
      await expect(page.locator('#reset-pin-lockout-btn')).toBeHidden({ timeout: 15_000 });

      // Verify PIN is-locked shows "No"
      const pinIsLocked = page.locator('#pin-is-locked');
      await expect(pinIsLocked).toBeVisible({ timeout: 15_000 });
      const lockedText = await pinIsLocked.textContent();
      expect(lockedText!.trim()).toBe('No');
    } else {
      // No lockout — the button being hidden IS the correct behavior
      await expect(resetBtn).toBeHidden();

      // Verify the currently locked field shows "No"
      const pinIsLocked = page.locator('#pin-is-locked');
      await expect(pinIsLocked).toBeVisible({ timeout: 15_000 });
      const lockedText = await pinIsLocked.textContent();
      expect(lockedText!.trim()).toBe('No');
    }
  });

  // ── Test 5: Data loads correctly on tab switch ──
  test('data loads correctly on tab switch', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Wait for data to load on security tab first
    const pinStatusGrid = page.locator('#pin-status-grid');
    await expect(pinStatusGrid).toBeVisible({ timeout: 15_000 });

    // Read initial PIN field values
    const pinSetInitial = await page.locator('#pin-set').textContent();
    const pinAttemptsInitial = await page.locator('#pin-attempts').textContent();
    const pinIsLockedInitial = await page.locator('#pin-is-locked').textContent();

    // Switch to Profile subtab
    await switchUserSubtab(page, 'profile');

    // Wait for profile to be visible
    await expect(page.locator('.user-subpanel[data-subtab="profile"]')).toBeVisible({ timeout: 15_000 });

    // Switch back to Security subtab
    await switchUserSubtab(page, 'security');

    // Wait for security panel to be visible
    await expect(page.locator('.user-subpanel[data-subtab="security"]')).toBeVisible({ timeout: 15_000 });
    await expect(pinStatusGrid).toBeVisible({ timeout: 15_000 });

    // Verify all PIN fields still show correct data (not stale or empty)
    const pinSetAfter = await page.locator('#pin-set').textContent();
    const pinAttemptsAfter = await page.locator('#pin-attempts').textContent();
    const pinIsLockedAfter = await page.locator('#pin-is-locked').textContent();

    expect(pinSetAfter!.trim()).toBeTruthy();
    expect(pinAttemptsAfter!.trim()).toBeTruthy();
    expect(pinIsLockedAfter!.trim()).toBeTruthy();

    // Values should not be placeholder dashes
    expect(pinSetAfter!.trim()).not.toBe('—');
    expect(pinAttemptsAfter!.trim()).not.toBe('—');
    expect(pinIsLockedAfter!.trim()).not.toBe('—');

    // Compare to API data to confirm correctness
    const authStatus = await testData.api.get(`/api/user/${uid}/auth-status`);

    const expectedPinSet = authStatus.pinSet ? 'Yes' : 'No';
    expect(pinSetAfter!.trim()).toBe(expectedPinSet);

    expect(Number(pinAttemptsAfter!.trim())).toBe(authStatus.pinAttempts ?? 0);

    const expectedIsLocked = authStatus.isLocked ? 'Yes' : 'No';
    expect(pinIsLockedAfter!.trim()).toBe(expectedIsLocked);
  });

  // ── Test 6: PIN status matches Firestore state ──
  test('PIN status matches Firestore state', async ({ page, testData }) => {
    const uid = String(testData.user.uniqueId);

    // Wait for PIN status to load
    const pinStatusGrid = page.locator('#pin-status-grid');
    await expect(pinStatusGrid).toBeVisible({ timeout: 15_000 });

    // Read all displayed PIN fields
    const pinSetText = (await page.locator('#pin-set').textContent())!.trim();
    const pinSetAtText = (await page.locator('#pin-set-at').textContent())!.trim();
    const pinAttemptsText = (await page.locator('#pin-attempts').textContent())!.trim();
    const pinLockedUntilText = (await page.locator('#pin-locked-until').textContent())!.trim();
    const pinLockoutCountText = (await page.locator('#pin-lockout-count').textContent())!.trim();
    const pinIsLockedText = (await page.locator('#pin-is-locked').textContent())!.trim();

    // Read raw Firestore user doc via test verify API
    const firestoreDoc = await testData.api.testVerify('users', uid);

    // Test users may not have PIN data — fields show defaults ("No", "0", "—", etc.)

    // pinSet: Firestore `pinHash` exists → "Yes", otherwise "No"
    const hasPinInFirestore = !!firestoreDoc.pinHash;
    const expectedPinSet = hasPinInFirestore ? 'Yes' : 'No';
    expect(pinSetText).toBe(expectedPinSet);

    // pinAttempts: Firestore `pinAttempts` field, default 0
    const expectedAttempts = firestoreDoc.pinAttempts ?? 0;
    expect(Number(pinAttemptsText)).toBe(expectedAttempts);

    // pinLockoutCount: Firestore `pinLockoutCount` field, default 0
    const expectedLockoutCount = firestoreDoc.pinLockoutCount ?? 0;
    expect(Number(pinLockoutCountText)).toBe(expectedLockoutCount);

    // isLocked: Firestore `pinLockedUntil` exists and is in the future → "Yes", otherwise "No"
    const lockedUntil = firestoreDoc.pinLockedUntil;
    const isCurrentlyLocked = lockedUntil
      ? (typeof lockedUntil === 'object' && lockedUntil._seconds
        ? lockedUntil._seconds * 1000 > Date.now()
        : new Date(lockedUntil).getTime() > Date.now())
      : false;
    const expectedIsLocked = isCurrentlyLocked ? 'Yes' : 'No';
    expect(pinIsLockedText).toBe(expectedIsLocked);

    // pinSetAt: If PIN exists, should show a date string; otherwise "—" or "N/A"
    if (hasPinInFirestore && firestoreDoc.pinSetAt) {
      expect(pinSetAtText).not.toBe('—');
      expect(pinSetAtText.length).toBeGreaterThan(0);
    } else {
      // No PIN set — display should show placeholder
      expect(['—', 'N/A', '-', '']).toContain(pinSetAtText);
    }

    // pinLockedUntil: If locked, should show a date string; otherwise "—" or "N/A"
    if (isCurrentlyLocked) {
      expect(pinLockedUntilText).not.toBe('—');
      expect(pinLockedUntilText.length).toBeGreaterThan(0);
    } else {
      expect(['—', 'N/A', '-', '', 'None']).toContain(pinLockedUntilText);
    }
  });
});
