import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

async function loginWith(page: any, email: string, password: string) {
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test.describe('Admin Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });
  });

  test('successful login shows dashboard', async ({ page }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });
  });

  test('wrong password shows error', async ({ page }) => {
    await loginWith(page, 'admin@example.com', 'wrongpassword123');
    await expect(page.locator('#login-error')).not.toBeEmpty({ timeout: 10_000 });
  });

  test('empty email shows validation or error', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Password' }).fill('somepassword');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const emailInput = page.locator('#login-email');
    const loginError = page.locator('#login-error');
    const hasValidation = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage !== ''
    );
    const hasAppError = await loginError.textContent().then((t: string) => (t ?? '').length > 0).catch(() => false);
    expect(hasValidation || hasAppError).toBe(true);
  });

  test('empty password shows validation or error', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Email' }).fill('admin@example.com');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const passwordInput = page.locator('#login-password');
    const loginError = page.locator('#login-error');
    const hasValidation = await passwordInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage !== ''
    );
    const hasAppError = await loginError.textContent().then((t: string) => (t ?? '').length > 0).catch(() => false);
    expect(hasValidation || hasAppError).toBe(true);
  });

  test('sign out returns to login screen', async ({ page }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });

    await page.locator('#signout-btn').click();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#dashboard-screen')).not.toBeVisible();

    // Round-trip: reload confirms session is truly cleared
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#dashboard-screen')).not.toBeVisible();
  });

  test('session persists across page reload', async ({ page }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 15_000 });
  });

  test('all 13 tab buttons visible after login', async ({ page }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });

    const expectedTabs = [
      'Users', 'Appeals', 'Reports', 'Gifts',
      'Economy', 'Maintenance', 'Spin Monitor', 'Banners',
      'Fun Facts', 'Backups', 'Logs', 'Devices',
      'Age Segregation',
    ];
    for (const tabName of expectedTabs) {
      await expect(page.locator('.tab-bar .tab-btn', { hasText: tabName })).toBeVisible();
    }
  });

  test('alert bell visible after login', async ({ page }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#alert-bell')).toBeVisible();
  });
});
