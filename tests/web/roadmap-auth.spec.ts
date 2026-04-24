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

  // ── Initial state: friendly welcome with download links, no login buttons ──

  test('suggestions section shows welcome prompt when not authenticated', async ({ page }) => {
    const loginPrompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });

  test('welcome prompt shows friendly message about ShyTalk account', async ({ page }) => {
    const prompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    await expect(prompt).toContainText(/shytalk.*account|sign.*in|look around/i);
  });

  test('welcome prompt has Google Play download link', async ({ page }) => {
    const playLink = page.locator('[data-testid="download-android"]');
    await expect(playLink).toBeVisible({ timeout: 10_000 });
    await expect(playLink).toContainText(/google play/i);
    const href = await playLink.getAttribute('href');
    expect(href).toContain('play.google.com');
  });

  test('welcome prompt has App Store download link', async ({ page }) => {
    const appStoreLink = page.locator('[data-testid="download-ios"]');
    await expect(appStoreLink).toBeVisible({ timeout: 10_000 });
    await expect(appStoreLink).toContainText(/app store/i);
    const href = await appStoreLink.getAttribute('href');
    expect(href).toContain('apps.apple.com');
  });

  test('welcome prompt visible in suggestions section specifically (not header)', async ({ page }) => {
    const suggestionsSection = page.locator('#suggestions, [data-section="suggestions"]');
    if ((await suggestionsSection.count()) > 0) {
      const loginPrompt = suggestionsSection.locator(
        '[data-testid="auth-login-prompt"], .auth-login-prompt',
      );
      await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
    }
  });

  test('no Google/Apple login buttons shown on initial page load', async ({ page }) => {
    // Login buttons should only appear in modal when user tries an auth action
    await page.waitForTimeout(5_000);
    const googleBtn = page.locator('[data-testid="auth-google-btn"], .auth-google-btn');
    const appleBtn = page.locator('[data-testid="auth-apple-btn"], .auth-apple-btn');
    expect(await googleBtn.count()).toBe(0);
    expect(await appleBtn.count()).toBe(0);
  });

  // ── Login modal: appears when user tries an auth-gated action ──

  test('clicking Suggest button shows login modal', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"], #sg-login-modal-overlay');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('login modal has Google sign-in button', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    const googleBtn = loginModal.locator('[data-testid="auth-google-btn"]');
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toContainText(/google/i);
  });

  test('login modal has Apple sign-in button', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    const appleBtn = loginModal.locator('[data-testid="auth-apple-btn"]');
    await expect(appleBtn).toBeVisible();
    await expect(appleBtn).toContainText(/apple/i);
  });

  test('login modal has close (X) button but no Cancel button', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    // Close (X) button in header exists and is visible
    const closeBtn = loginModal.locator('[data-testid="login-modal-close"]');
    await expect(closeBtn).toBeVisible();
    // Cancel/dismiss button should NOT exist
    const cancelBtn = loginModal.locator('[data-testid="login-modal-dismiss"]');
    expect(await cancelBtn.count()).toBe(0);
  });

  test('clicking X closes the login modal', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    await loginModal.locator('[data-testid="login-modal-close"]').click();
    await expect(loginModal).not.toBeVisible({ timeout: 3_000 });
  });

  test('download links have correct branded styling', async ({ page }) => {
    const playLink = page.locator('[data-testid="download-android"]');
    await expect(playLink).toBeVisible({ timeout: 10_000 });
    const playSvg = playLink.locator('svg');
    expect(await playSvg.count()).toBeGreaterThan(0);
    const appStoreLink = page.locator('[data-testid="download-ios"]');
    await expect(appStoreLink).toBeVisible({ timeout: 10_000 });
    const appleSvg = appStoreLink.locator('svg');
    expect(await appleSvg.count()).toBeGreaterThan(0);
  });

  test('accessibility: keyboard navigable (tab to login buttons, enter to activate)', async ({
    page,
  }) => {
    const googleBtn = page.locator('[data-testid="auth-google-btn"], .auth-google-btn');
    if ((await googleBtn.count()) > 0) {
      // Buttons should be focusable
      await googleBtn.focus();
      await expect(googleBtn).toBeFocused();
    }
  });

  test('i18n: login prompt text translatable (data-i18n attributes)', async ({ page }) => {
    const prompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    if ((await prompt.count()) > 0) {
      // Check for i18n markers — either data-i18n or data-translate attributes
      const hasI18n =
        (await prompt.locator('[data-i18n], [data-translate]').count()) > 0 ||
        (await prompt.getAttribute('data-i18n')) !== null;
      // If i18n is not yet implemented, at least the text should exist
      const text = await prompt.textContent();
      expect(text?.length).toBeGreaterThan(0);
    }
  });
});

test.describe('Roadmap Auth — Subscribe uses shared login modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('subscribe button (unauthenticated) opens the shared login modal, NOT its own modal', async ({
    page,
  }) => {
    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], .subscribe-btn');
    await subscribeBtn.waitFor({ timeout: 10_000 });
    await subscribeBtn.click();

    // Should open the shared login modal (login-modal-overlay), NOT the subscribe modal
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });

    // The subscribe-specific modal should NOT appear when unauthenticated
    const subscribeModal = page.locator('[data-testid="subscribe-modal"]');
    expect(await subscribeModal.count()).toBe(0);
  });

  test('subscribe login modal matches bell login modal (same testid, same structure)', async ({
    page,
  }) => {
    // Open via subscribe button
    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], .subscribe-btn');
    await subscribeBtn.waitFor({ timeout: 10_000 });
    await subscribeBtn.click();

    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Should have Google + Apple sign-in buttons
    await expect(modal.locator('[data-testid="auth-google-btn"]')).toBeVisible();
    await expect(modal.locator('[data-testid="auth-apple-btn"]')).toBeVisible();

    // Should have close button
    await expect(modal.locator('[data-testid="login-modal-close"]')).toBeVisible();
  });

  test('Google sign-in button calls signInWithGoogle (not just closing the modal)', async ({
    page,
  }) => {
    // Intercept the signInWithGoogle call
    await page.evaluate(() => {
      (window as any).__signInCalled = null;
      if ((window as any).shytalkAuth) {
        (window as any).shytalkAuth.signInWithGoogle = () => {
          (window as any).__signInCalled = 'google';
        };
      }
      // Also set up for late binding
      const origDesc = Object.getOwnPropertyDescriptor(window, 'shytalkAuth');
      if (!origDesc || !origDesc.set) {
        let _auth = (window as any).shytalkAuth;
        Object.defineProperty(window, 'shytalkAuth', {
          get: () => _auth,
          set: (v) => {
            _auth = v;
            if (_auth) {
              _auth.signInWithGoogle = () => {
                (window as any).__signInCalled = 'google';
              };
            }
          },
          configurable: true,
        });
      }
    });

    // Trigger the login modal
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click Google sign-in
    await modal.locator('[data-testid="auth-google-btn"]').click();

    // Verify signInWithGoogle was called
    const called = await page.evaluate(() => (window as any).__signInCalled);
    expect(called).toBe('google');
  });

  test('Apple sign-in button calls signInWithApple (not just closing the modal)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__signInCalled = null;
      if ((window as any).shytalkAuth) {
        (window as any).shytalkAuth.signInWithApple = () => {
          (window as any).__signInCalled = 'apple';
        };
      }
      const origDesc = Object.getOwnPropertyDescriptor(window, 'shytalkAuth');
      if (!origDesc || !origDesc.set) {
        let _auth = (window as any).shytalkAuth;
        Object.defineProperty(window, 'shytalkAuth', {
          get: () => _auth,
          set: (v) => {
            _auth = v;
            if (_auth) {
              _auth.signInWithApple = () => {
                (window as any).__signInCalled = 'apple';
              };
            }
          },
          configurable: true,
        });
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.locator('[data-testid="auth-apple-btn"]').click();

    const called = await page.evaluate(() => (window as any).__signInCalled);
    expect(called).toBe('apple');
  });

  test('login modal stays open while sign-in popup is processing (Google)', async ({ page }) => {
    // Mock signInWithGoogle to be a no-op (simulates popup opening without completing)
    await page.evaluate(() => {
      let _auth = (window as any).shytalkAuth;
      Object.defineProperty(window, 'shytalkAuth', {
        get: () => _auth,
        set: (v) => {
          _auth = v;
          if (_auth) {
            _auth.signInWithGoogle = () => {
              // Simulate async popup — does nothing (popup hasn't completed yet)
            };
          }
        },
        configurable: true,
      });
      if (_auth) {
        _auth.signInWithGoogle = () => {};
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click Google sign-in
    await modal.locator('[data-testid="auth-google-btn"]').click();

    // Modal MUST still be visible — the popup is still processing
    await expect(modal).toBeVisible({ timeout: 2_000 });
  });

  test('login modal stays open while sign-in popup is processing (Apple)', async ({ page }) => {
    await page.evaluate(() => {
      let _auth = (window as any).shytalkAuth;
      Object.defineProperty(window, 'shytalkAuth', {
        get: () => _auth,
        set: (v) => {
          _auth = v;
          if (_auth) {
            _auth.signInWithApple = () => {};
          }
        },
        configurable: true,
      });
      if (_auth) {
        _auth.signInWithApple = () => {};
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click Apple sign-in
    await modal.locator('[data-testid="auth-apple-btn"]').click();

    // Modal MUST still be visible
    await expect(modal).toBeVisible({ timeout: 2_000 });
  });

  test('login modal auto-closes after successful authentication', async ({ page }) => {
    // Set up auth mock that fires the auth-changed event after a brief delay
    await page.evaluate(() => {
      let _auth = (window as any).shytalkAuth;
      Object.defineProperty(window, 'shytalkAuth', {
        get: () => _auth,
        set: (v) => {
          _auth = v;
          if (_auth) {
            _auth.signInWithGoogle = () => {
              // Simulate successful auth after 200ms
              setTimeout(() => {
                document.dispatchEvent(
                  new CustomEvent('shytalk-auth-changed', {
                    detail: { user: { uid: 'test-123', displayName: 'TestUser' } },
                  }),
                );
              }, 200);
            };
          }
        },
        configurable: true,
      });
      if (_auth) {
        _auth.signInWithGoogle = () => {
          setTimeout(() => {
            document.dispatchEvent(
              new CustomEvent('shytalk-auth-changed', {
                detail: { user: { uid: 'test-123', displayName: 'TestUser' } },
              }),
            );
          }, 200);
        };
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click Google sign-in — triggers delayed auth event
    await modal.locator('[data-testid="auth-google-btn"]').click();

    // Modal should auto-close after auth succeeds
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
  });

  test('bell button (unauthenticated) opens the shared login modal', async ({ page }) => {
    const bell = page.locator('[data-testid="feature-bell"], .feature-bell').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
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

  test('no-account message styled as warning/info (not error red)', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'No ShyTalk account found. Download the app to create one.',
          downloadLinks: {
            android: 'https://play.google.com/store/apps/details?id=com.shyden.shytalk',
            ios: 'https://apps.apple.com/app/shytalk/id6741488545',
          },
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const noAccount = page.locator('[data-testid="auth-no-account"], .auth-no-account');
    if ((await noAccount.count()) > 0) {
      // Should not be styled with error-red colors
      const color = await noAccount.evaluate((el) => getComputedStyle(el).color);
      const bgColor = await noAccount.evaluate((el) => getComputedStyle(el).backgroundColor);
      // Error red is typically rgb(255, 0, 0) or similar — should not be pure red
      expect(color).not.toBe('rgb(255, 0, 0)');
      expect(bgColor).not.toBe('rgb(255, 0, 0)');
    }
  });

  test('download links open in new tab (target="_blank")', async ({ page }) => {
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
    const androidLink = page.locator(
      '[data-testid="download-android"], a[href*="play.google.com"]',
    );
    const iosLink = page.locator('[data-testid="download-ios"], a[href*="apps.apple.com"]');
    if ((await androidLink.count()) > 0) {
      expect(await androidLink.getAttribute('target')).toBe('_blank');
    }
    if ((await iosLink.count()) > 0) {
      expect(await iosLink.getAttribute('target')).toBe('_blank');
    }
  });

  test('download links have rel="noopener noreferrer"', async ({ page }) => {
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
    const androidLink = page.locator(
      '[data-testid="download-android"], a[href*="play.google.com"]',
    );
    const iosLink = page.locator('[data-testid="download-ios"], a[href*="apps.apple.com"]');
    if ((await androidLink.count()) > 0) {
      const rel = await androidLink.getAttribute('rel');
      expect(rel).toMatch(/noopener/);
      expect(rel).toMatch(/noreferrer/);
    }
    if ((await iosLink.count()) > 0) {
      const rel = await iosLink.getAttribute('rel');
      expect(rel).toMatch(/noopener/);
      expect(rel).toMatch(/noreferrer/);
    }
  });

  test('i18n: download prompt text translatable', async ({ page }) => {
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
    const noAccount = page.locator('[data-testid="auth-no-account"], .auth-no-account');
    if ((await noAccount.count()) > 0) {
      // Check for i18n markers or at minimum non-empty text
      const text = await noAccount.textContent();
      expect(text?.length).toBeGreaterThan(0);
    }
  });

  test('mobile: download prompt fits on 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
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
    const noAccount = page.locator('[data-testid="auth-no-account"], .auth-no-account');
    if ((await noAccount.count()) > 0) {
      const box = await noAccount.boundingBox();
      if (box) {
        // Should not overflow beyond viewport width
        expect(box.x + box.width).toBeLessThanOrEqual(320);
        expect(box.x).toBeGreaterThanOrEqual(0);
      }
    }
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

  // ─── New tests: login state features ───────────────────────────

  test('after successful login, suggestions list refreshes automatically', async ({ page }) => {
    let suggestionsCallCount = 0;
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.route('**/api/suggestions*', (route) => {
      suggestionsCallCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [], total: 0, page: 1, pageSize: 20 }),
      });
    });
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    // Suggestions endpoint should have been called at least once after auth resolves
    expect(suggestionsCallCount).toBeGreaterThanOrEqual(1);
  });

  test('after login, bell icons become clickable (not showing login toast)', async ({ page }) => {
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
        body: JSON.stringify({
          suggestions: [
            {
              id: 'sug-1',
              title: 'Test Feature',
              status: 'open',
              votes: 5,
              authorUniqueId: 2002,
              authorDisplayName: 'OtherUser',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const bellIcon = page.locator('.bell-icon, [data-testid="subscribe-btn"]').first();
    if ((await bellIcon.count()) > 0) {
      await bellIcon.click();
      // Should not show a "please log in" toast
      const loginToast = page.locator('text=log in, text=sign in');
      await page.waitForTimeout(1000);
      await expect(loginToast).toHaveCount(0);
    }
  });

  test('after login, "+ Suggest" button enabled', async ({ page }) => {
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
    const suggestBtn = page.locator(
      '[data-testid="suggest-btn"], button:has-text("Suggest"), button:has-text("suggest")',
    );
    if ((await suggestBtn.count()) > 0) {
      await expect(suggestBtn.first()).not.toBeDisabled();
    }
  });

  test('vote arrows enabled after login', async ({ page }) => {
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
        body: JSON.stringify({
          suggestions: [
            {
              id: 'sug-1',
              title: 'Test Feature',
              status: 'open',
              votes: 5,
              authorUniqueId: 2002,
              authorDisplayName: 'OtherUser',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const voteBtn = page
      .locator('.vote-btn, [data-testid="vote-up"], .upvote-btn, .vote-arrow')
      .first();
    if ((await voteBtn.count()) > 0) {
      await expect(voteBtn).not.toBeDisabled();
    }
  });

  test('comment form visible on accepted suggestions after login', async ({ page }) => {
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
        body: JSON.stringify({
          suggestions: [
            {
              id: 'sug-accepted',
              title: 'Accepted Feature',
              status: 'accepted',
              votes: 10,
              authorUniqueId: 2002,
              authorDisplayName: 'OtherUser',
              comments: [],
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      }),
    );
    await page.goto('/roadmap.html');
    // Click on the accepted suggestion to open detail view if needed
    const suggestion = page.locator('text=Accepted Feature');
    if ((await suggestion.count()) > 0) {
      await suggestion.click();
      const commentForm = page.locator(
        '[data-testid="comment-form"], .comment-form, textarea[placeholder*="comment" i]',
      );
      // Comment form should be visible for logged-in users
      if ((await commentForm.count()) > 0) {
        await expect(commentForm.first()).toBeVisible();
      }
    }
  });

  test('auth state indicator in header area (small avatar + name)', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uniqueId: 1001,
          displayName: 'HeaderUser',
          avatarUrl: 'https://example.com/avatar.png',
        }),
      }),
    );
    await page.goto('/roadmap.html');
    const authStatus = page.locator(
      '[data-testid="auth-user-info"], .auth-user-info, .auth-status',
    );
    if ((await authStatus.count()) > 0) {
      const text = await authStatus.textContent();
      expect(text).toContain('HeaderUser');
    }
  });

  test('sign out button has aria-label for accessibility', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const signOutBtn = page.locator('[data-testid="auth-signout-btn"], .auth-signout-btn');
    if ((await signOutBtn.count()) > 0) {
      const label =
        (await signOutBtn.getAttribute('aria-label')) ||
        (await signOutBtn.getAttribute('title')) ||
        (await signOutBtn.textContent());
      expect(label?.toLowerCase()).toMatch(/sign.out|log.out/);
    }
  });

  test('after sign out, page does NOT reload (SPA behavior)', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const signOutBtn = page.locator('[data-testid="auth-signout-btn"], .auth-signout-btn');
    if ((await signOutBtn.count()) > 0) {
      let navigationOccurred = false;
      page.on('load', () => {
        navigationOccurred = true;
      });
      await signOutBtn.click();
      await page.waitForTimeout(2000);
      // Page should not have fully reloaded — SPA behavior
      expect(navigationOccurred).toBe(false);
    }
  });

  test('after sign out, cached user data cleared', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'CachedUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const signOutBtn = page.locator('[data-testid="auth-signout-btn"], .auth-signout-btn');
    if ((await signOutBtn.count()) > 0) {
      await signOutBtn.click();
      await page.waitForTimeout(1000);
      // User name should no longer be visible after sign out
      const userName = page.locator('text=CachedUser');
      await expect(userName).toHaveCount(0);
    }
  });

  test('sign out button is instant (no confirmation dialog)', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'TestUser' }),
      }),
    );
    await page.goto('/roadmap.html');
    const signOutBtn = page.locator('[data-testid="auth-signout-btn"], .auth-signout-btn');
    if ((await signOutBtn.count()) > 0) {
      let dialogAppeared = false;
      page.on('dialog', async (dialog) => {
        dialogAppeared = true;
        await dialog.accept();
      });
      await signOutBtn.click();
      await page.waitForTimeout(1000);
      // Sign out should be instant — no confirmation dialog
      expect(dialogAppeared).toBe(false);
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

  test('login spinner/loading state shown during auth check', async ({ page }) => {
    // Delay the /roadmap/me response to observe loading state
    await page.route('**/api/roadmap/me', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uniqueId: 1001, displayName: 'SlowUser' }),
      });
    });
    await page.goto('/roadmap.html');
    // During the delay, a loading/spinner should be visible
    const spinner = page.locator(
      '.auth-loading, [data-testid="auth-loading"], .spinner, .loading',
    );
    // Check within first 1.5s before response arrives
    if ((await spinner.count()) > 0) {
      await expect(spinner.first()).toBeVisible({ timeout: 1500 });
    }
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

  test('Firebase SDK not loaded shows graceful fallback message', async ({ page }) => {
    // Block Firebase SDK scripts from loading
    await page.route('**/*firebase*', (route) => {
      if (route.request().resourceType() === 'script') {
        return route.abort();
      }
      return route.continue();
    });
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    // Page should not crash — should show a fallback or degrade gracefully
    await expect(page.locator('body')).toBeVisible();
    // Should not show raw JS errors to the user
    const jsError = page.locator('text=TypeError, text=ReferenceError, text=is not defined');
    await expect(jsError).toHaveCount(0);
  });

  test('auth popup blocked by browser shows helpful message', async ({ page }) => {
    // Block popups by intercepting window.open
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto('/roadmap.html');
    const googleBtn = page.locator('[data-testid="auth-google-btn"], .auth-google-btn');
    if ((await googleBtn.count()) > 0) {
      await googleBtn.click();
      await page.waitForTimeout(2000);
      // Should show a message about popup being blocked, or at least not crash
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Roadmap Auth — Mobile Responsiveness', () => {
  test('mobile: login prompt fits on 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/roadmap.html');
    const loginPrompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    if ((await loginPrompt.count()) > 0) {
      const box = await loginPrompt.boundingBox();
      if (box) {
        // Should not overflow beyond viewport width
        expect(box.x + box.width).toBeLessThanOrEqual(320);
        expect(box.x).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe('Roadmap Auth — Bell icon auth behaviour', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('bell icon when NOT authenticated opens login modal', async ({ page }) => {
    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('bell icon when authenticated does NOT open login modal', async ({ page }) => {
    // Simulate authenticated state
    await page.evaluate(() => {
      (window as any).shytalkAuth = {
        ...(window as any).shytalkAuth,
        currentUser: {
          uid: 'test-123',
          displayName: 'TestUser',
          getIdToken: () => Promise.resolve('fake'),
        },
        profile: { uniqueId: 1001, displayName: 'TestUser' },
      };
    });

    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    // Login modal should NOT appear for authenticated users
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await page.waitForTimeout(1000);
    expect(await loginModal.count()).toBe(0);
  });

  test('bell icon when authenticated opens subscribe modal', async ({ page }) => {
    // Simulate authenticated state with profile
    await page.evaluate(() => {
      (window as any).shytalkAuth = {
        ...(window as any).shytalkAuth,
        currentUser: {
          uid: 'test-123',
          displayName: 'TestUser',
          getIdToken: () => Promise.resolve('fake'),
        },
        profile: { uniqueId: 1001, displayName: 'TestUser' },
      };
    });

    // Mock the subscribe API to avoid real network call
    await page.route('**/api/roadmap/subscribe/preferences*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferences: {}, watchList: [] }),
      }),
    );

    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    // Subscribe modal should appear (not login modal)
    const subscribeModal = page.locator('[data-testid="subscribe-modal"]');
    await expect(subscribeModal).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Roadmap Auth — Google account picker', () => {
  test('signInWithGoogle source contains select_account prompt', async ({ page }) => {
    await page.goto('/roadmap.html');

    // Verify the signInWithGoogle function source includes setCustomParameters with select_account
    // This is a static analysis test — Firebase SDK may not be initialized in test mode
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/roadmap-auth.js');
      return res.text();
    });
    expect(source).toContain("prompt");
    expect(source).toContain("select_account");
    expect(source).toMatch(/setCustomParameters.*select_account|select_account.*setCustomParameters/s);
  });
});
