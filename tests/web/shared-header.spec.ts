import { test, expect } from '@playwright/test';

/**
 * Shared header component tests.
 *
 * The shared header appears on ALL web pages with:
 * - Logo (left) linking to home
 * - User auth state (right): avatar + name when signed in, "Sign In" when not
 * - Language selector globe button
 * - Consistent look across roadmap, landing, legal, portal, admin pages
 */

const PAGES = [
  { name: 'roadmap', path: '/roadmap.html' },
  { name: 'landing', path: '/' },
  { name: 'privacy', path: '/privacy.html' },
  { name: 'terms', path: '/terms.html' },
  { name: 'community-guidelines', path: '/community-guidelines.html' },
];

test.describe('Shared Header — Presence on all pages', () => {
  for (const page of PAGES) {
    test(`${page.name} page has the shared header`, async ({ page: p }) => {
      await p.goto(page.path);
      const header = p.locator('[data-testid="shared-header"]');
      await expect(header).toBeVisible({ timeout: 10_000 });
    });

    test(`${page.name} page header has logo linking to home`, async ({ page: p }) => {
      await p.goto(page.path);
      const logo = p.locator('[data-testid="header-logo"]');
      await expect(logo).toBeVisible({ timeout: 10_000 });
      const href = await logo.getAttribute('href');
      expect(href).toBe('/');
    });
  }
});

test.describe('Shared Header — Unauthenticated state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('shows Sign In button when not authenticated', async ({ page }) => {
    const signInBtn = page.locator('[data-testid="header-signin-btn"]');
    await expect(signInBtn).toBeVisible({ timeout: 10_000 });
  });

  test('Sign In button opens login modal', async ({ page }) => {
    const signInBtn = page.locator('[data-testid="header-signin-btn"]');
    await signInBtn.waitFor({ timeout: 10_000 });
    await signInBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('no user avatar or name shown when not authenticated', async ({ page }) => {
    await page.waitForTimeout(3_000);
    const userInfo = page.locator('[data-testid="header-user-info"]');
    expect(await userInfo.count()).toBe(0);
  });
});

test.describe('Shared Header — Authenticated state', () => {
  test('shows user display name when authenticated', async ({ page }) => {
    await page.goto('/roadmap.html');
    // Simulate authenticated state
    await page.evaluate(() => {
      (window as any).shytalkAuth = {
        ...(window as any).shytalkAuth,
        currentUser: {
          uid: 'test-123',
          displayName: 'TestUser',
          getIdToken: () => Promise.resolve('fake'),
        },
        profile: { uniqueId: 1001, displayName: 'TestUser', profilePhotoUrl: null },
      };
      document.dispatchEvent(
        new CustomEvent('shytalk-auth-changed', {
          detail: {
            user: { uid: 'test-123', displayName: 'TestUser' },
            profile: { uniqueId: 1001, displayName: 'TestUser' },
          },
        }),
      );
    });

    const userInfo = page.locator('[data-testid="header-user-info"]');
    await expect(userInfo).toBeVisible({ timeout: 5_000 });
    await expect(userInfo).toContainText('TestUser');
  });

  test('shows sign out option when authenticated', async ({ page }) => {
    await page.goto('/roadmap.html');
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
      document.dispatchEvent(
        new CustomEvent('shytalk-auth-changed', {
          detail: { user: { uid: 'test-123' }, profile: { uniqueId: 1001, displayName: 'TestUser' } },
        }),
      );
    });

    // Click user info area to open dropdown
    const userInfo = page.locator('[data-testid="header-user-info"]');
    await userInfo.waitFor({ timeout: 5_000 });
    await userInfo.click();

    const signOutBtn = page.locator('[data-testid="header-signout-btn"]');
    await expect(signOutBtn).toBeVisible({ timeout: 3_000 });
  });

  test('Sign In button hidden when authenticated', async ({ page }) => {
    await page.goto('/roadmap.html');
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
      document.dispatchEvent(
        new CustomEvent('shytalk-auth-changed', {
          detail: { user: { uid: 'test-123' }, profile: { uniqueId: 1001, displayName: 'TestUser' } },
        }),
      );
    });

    await page.waitForTimeout(1000);
    const signInBtn = page.locator('[data-testid="header-signin-btn"]');
    expect(await signInBtn.count()).toBe(0);
  });
});

test.describe('Shared Header — Responsive', () => {
  test('header fits on 320px mobile screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/roadmap.html');
    const header = page.locator('[data-testid="shared-header"]');
    await expect(header).toBeVisible({ timeout: 10_000 });
    const box = await header.boundingBox();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(320);
    }
  });

  test('logo and sign-in button visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/roadmap.html');
    await expect(page.locator('[data-testid="header-logo"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="header-signin-btn"]')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Shared Header — Accessibility', () => {
  test('header has role="banner"', async ({ page }) => {
    await page.goto('/roadmap.html');
    const header = page.locator('[data-testid="shared-header"]');
    await expect(header).toBeVisible({ timeout: 10_000 });
    const role = await header.getAttribute('role');
    expect(role).toBe('banner');
  });

  test('logo has descriptive text', async ({ page }) => {
    await page.goto('/roadmap.html');
    const logo = page.locator('[data-testid="header-logo"]');
    await expect(logo).toBeVisible({ timeout: 10_000 });
    const text = await logo.textContent();
    expect(text?.toLowerCase()).toContain('shytalk');
  });
});
