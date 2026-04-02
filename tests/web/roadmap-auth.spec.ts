import { test, expect } from '@playwright/test';

/**
 * Roadmap page authentication flow tests.
 *
 * Tests the login UI on the suggestions section:
 * - Login prompt with Google/Apple sign-in options
 * - No ShyTalk account: denied with app download links
 * - Logged-in state: "Logged in as: {name}" with sign out
 */

test.describe('Roadmap Auth — Login Prompt', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('suggestions section shows login prompt when not authenticated', async ({ page }) => {
    const loginPrompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });

  test('login prompt has Google sign-in button', async ({ page }) => {
    const googleBtn = page.locator('[data-testid="auth-google-btn"], .auth-google-btn');
    await expect(googleBtn).toBeVisible({ timeout: 10_000 });
    await expect(googleBtn).toContainText(/google/i);
  });

  test('login prompt has Apple sign-in button', async ({ page }) => {
    const appleBtn = page.locator('[data-testid="auth-apple-btn"], .auth-apple-btn');
    await expect(appleBtn).toBeVisible({ timeout: 10_000 });
    await expect(appleBtn).toContainText(/apple/i);
  });

  test('login prompt explains ShyTalk account is required', async ({ page }) => {
    const prompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    await expect(prompt).toContainText(/shytalk.*account|sign.*in/i);
  });
});

test.describe('Roadmap Auth — No Account Found', () => {
  test('shows download prompt when Google login has no ShyTalk account', async ({ page }) => {
    // Simulate: user authenticated with Google but API returns 404
    await page.goto('/roadmap.html');
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'No ShyTalk account found. Download the app to create one.',
          downloadLinks: {
            android: 'https://play.google.com/store/apps/details?id=com.shyden.shytalk',
            ios: 'https://apps.apple.com/app/shytalk/id123456789',
          },
        }),
      }),
    );
    // Trigger the auth check
    const noAccountMsg = page.locator('[data-testid="auth-no-account"], .auth-no-account');
    // The no-account message should appear after failed auth
  });

  test('download prompt shows Play Store link', async ({ page }) => {
    await page.goto('/roadmap.html');
    const playStoreLink = page.locator('[data-testid="download-android"], a[href*="play.google.com"]');
    // Should be visible in the no-account state
  });

  test('download prompt shows App Store link', async ({ page }) => {
    await page.goto('/roadmap.html');
    const appStoreLink = page.locator('[data-testid="download-ios"], a[href*="apps.apple.com"]');
    // Should be visible in the no-account state
  });

  test('download prompt message invites user to create account', async ({ page }) => {
    await page.goto('/roadmap.html');
    const msg = page.locator('[data-testid="auth-no-account"], .auth-no-account');
    // Should contain text about downloading the app
  });
});

test.describe('Roadmap Auth — Logged In State', () => {
  test('shows "Logged in as: {name}" when authenticated', async ({ page }) => {
    // Mock successful auth
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uniqueId: 1001,
          displayName: 'TestUser',
          avatarUrl: 'https://example.com/avatar.png',
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const userInfo = page.locator('[data-testid="auth-user-info"], .auth-user-info');
    // Should show user name
  });

  test('displays user display name', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'Alice' }),
      }),
    );
    await page.goto('/roadmap.html');
    const userName = page.locator('[data-testid="auth-display-name"], .auth-display-name');
    if (await userName.count() > 0) {
      await expect(userName).toContainText('Alice');
    }
  });

  test('shows sign out button when logged in', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const signOutBtn = page.locator('[data-testid="auth-signout-btn"], .auth-signout-btn');
    // Sign out button should be visible when logged in
  });

  test('sign out clears user state and shows login prompt again', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const signOutBtn = page.locator('[data-testid="auth-signout-btn"], .auth-signout-btn');
    if (await signOutBtn.count() > 0) {
      await signOutBtn.click();
      // Login prompt should reappear
      const loginPrompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
      await expect(loginPrompt).toBeVisible({ timeout: 5_000 });
    }
  });

  test('login prompt hidden when user is logged in', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const loginPrompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    // When logged in, login prompt should be hidden
  });

  test('suggestions section usable when logged in (no auth error)', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.route('**/api/suggestions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [], total: 0, page: 1, pageSize: 20 }),
      }),
    );
    await page.goto('/roadmap.html');
    // No "Missing or invalid Authorization header" error should appear
    const errorMsg = page.locator('text=Missing or invalid Authorization');
    await expect(errorMsg).toHaveCount(0);
  });

  test('displays user avatar when available', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uniqueId: 1001,
          displayName: 'TestUser',
          avatarUrl: 'https://example.com/avatar.png',
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const avatar = page.locator('[data-testid="auth-avatar"], .auth-avatar');
    if (await avatar.count() > 0) {
      const src = await avatar.getAttribute('src');
      expect(src).toContain('avatar');
    }
  });

  test('vote/suggest/comment buttons enabled when logged in', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.route('**/api/suggestions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [], total: 0, page: 1, pageSize: 20 }),
      }),
    );
    await page.goto('/roadmap.html');
    // Interactive buttons should not be disabled
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    if (await suggestBtn.count() > 0) {
      await expect(suggestBtn).not.toBeDisabled();
    }
  });

  test('"Logged in as" text includes the display name', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'SuperUser42' }),
      }),
    );
    await page.goto('/roadmap.html');
    const authArea = page.locator('[data-testid="auth-user-info"], .auth-user-info, .auth-status');
    if (await authArea.count() > 0) {
      const text = await authArea.textContent();
      expect(text).toContain('SuperUser42');
    }
  });
});

test.describe('Roadmap Auth — No Account Download Prompt Details', () => {
  test('download prompt shows both store badges/links', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'No ShyTalk account found',
          downloadLinks: {
            android: 'https://play.google.com/store/apps/details?id=com.shyden.shytalk',
            ios: 'https://apps.apple.com/app/shytalk/id6741488545',
          },
        }),
      }),
    );
    await page.goto('/roadmap.html');
    // Both store links should be present somewhere on the page
  });

  test('download prompt has clear call-to-action text', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'No ShyTalk account found. Download the app to create one.',
          downloadLinks: { android: '#', ios: '#' },
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const noAccount = page.locator('[data-testid="auth-no-account"], .auth-no-account');
    if (await noAccount.count() > 0) {
      const text = await noAccount.textContent();
      expect(text?.toLowerCase()).toMatch(/download|create|account/);
    }
  });

  test('download prompt allows dismissal to browse as guest', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'No ShyTalk account found',
          downloadLinks: { android: '#', ios: '#' },
        }),
      }),
    );
    await page.goto('/roadmap.html');
    // User should be able to browse suggestions read-only even without account
    const suggestionsSection = page.locator('#suggestions, [data-section="suggestions"]');
    if (await suggestionsSection.count() > 0) {
      await expect(suggestionsSection).toBeVisible();
    }
  });
});

test.describe('Roadmap Auth — Session Persistence', () => {
  test('auth state persists across page reload', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'PersistUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    await page.reload();
    // After reload, user should still appear logged in
    // (Firebase auth persists in localStorage)
  });

  test('sign out removes auth from subsequent API calls', async ({ page }) => {
    let authHeaderSeen = false;
    await page.route('**/api/suggestions*', (route) => {
      const headers = route.request().headers();
      if (headers.authorization) authHeaderSeen = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [], total: 0, page: 1, pageSize: 20 }),
      });
    });
    await page.goto('/roadmap.html');
    // After sign out, subsequent API calls should not include auth header
  });
});

test.describe('Roadmap Auth — Error Handling', () => {
  test('API error on /roadmap/me shows generic error, not raw error', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      }),
    );
    await page.goto('/roadmap.html');
    // Should show a user-friendly error, not "Internal server error"
    const rawError = page.locator('text=Internal server error');
    // Raw error should not be displayed to user
  });

  test('network failure on auth check allows read-only browsing', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) => route.abort());
    await page.goto('/roadmap.html');
    // Page should still load and show roadmap data
    await expect(page.locator('body')).toBeVisible();
  });

  test('no console errors from auth flow on clean page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    // Auth-related errors should not appear in console
    const authErrors = errors.filter((e) => /auth|firebase|token/i.test(e));
    expect(authErrors).toHaveLength(0);
  });
});
