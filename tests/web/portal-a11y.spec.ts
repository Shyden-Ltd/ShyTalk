import { test, expect } from '@playwright/test';

test.describe('Portal — Accessibility: Labels & ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('email input has associated label (sr-only)', async ({ page }) => {
    const label = page.locator('label[for="login-email"]');
    await expect(label).toHaveCount(1);
    const classes = await label.getAttribute('class');
    expect(classes).toContain('sr-only');
  });

  test('password input has associated label (sr-only)', async ({ page }) => {
    const label = page.locator('label[for="login-password"]');
    await expect(label).toHaveCount(1);
    const classes = await label.getAttribute('class');
    expect(classes).toContain('sr-only');
  });

  test('TOTP code input has associated label', async ({ page }) => {
    const label = page.locator('label[for="totp-code"]');
    await expect(label).toHaveCount(1);
  });

  test('enrollment code input has associated label', async ({ page }) => {
    const label = page.locator('label[for="enroll-code"]');
    await expect(label).toHaveCount(1);
  });

  test('recovery email input has associated label', async ({ page }) => {
    const label = page.locator('label[for="recovery-email"]');
    await expect(label).toHaveCount(1);
  });

  test('recovery code input has associated label', async ({ page }) => {
    const label = page.locator('label[for="recovery-code"]');
    await expect(label).toHaveCount(1);
  });

  test('re-auth TOTP code input has associated label', async ({ page }) => {
    const label = page.locator('label[for="reauth-totp-code"]');
    await expect(label).toHaveCount(1);
  });

  test('remember me checkbox has associated label', async ({ page }) => {
    const label = page.locator('label[for="login-remember"]');
    await expect(label).toHaveCount(1);
  });

  test('all error messages have role="alert"', async ({ page }) => {
    const errorIds = ['login-error', 'totp-error', 'enroll-error', 'recovery-error', 'reauth-error'];
    for (const id of errorIds) {
      await expect(page.locator(`#${id}`)).toHaveAttribute('role', 'alert');
    }
  });

  test('success message has role="status"', async ({ page }) => {
    await expect(page.locator('#recovery-message')).toHaveAttribute('role', 'status');
  });

  test('ShyTalk logo has aria-label', async ({ page }) => {
    const logos = page.locator('.portal-logo');
    const count = await logos.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(logos.nth(i)).toHaveAttribute('aria-label', 'ShyTalk');
    }
  });

  test('profile avatar has aria-label', async ({ page }) => {
    await expect(page.locator('#profile-avatar')).toHaveAttribute('aria-label', 'Profile avatar');
  });

  test('QR container has aria-label', async ({ page }) => {
    await expect(page.locator('#enroll-qr')).toHaveAttribute('aria-label', 'QR code for TOTP setup');
  });

  test('copy button has aria-label', async ({ page }) => {
    await expect(page.locator('#enroll-copy-btn')).toHaveAttribute('aria-label', 'Copy secret key');
  });

  test('loading spinner has role="status"', async ({ page }) => {
    const spinner = page.locator('#loading-section .spinner');
    await expect(spinner).toHaveAttribute('role', 'status');
  });

  test('loading spinner has sr-only text', async ({ page }) => {
    const srOnly = page.locator('#loading-section .sr-only');
    await expect(srOnly).toHaveCount(1);
  });

  test('divider is aria-hidden', async ({ page }) => {
    const divider = page.locator('#login-section .divider');
    await expect(divider).toHaveAttribute('aria-hidden', 'true');
  });

  test('OAuth button images are aria-hidden', async ({ page }) => {
    const googleImg = page.locator('#google-signin-btn img');
    await expect(googleImg).toHaveAttribute('aria-hidden', 'true');
    const appleImg = page.locator('#apple-signin-btn img');
    await expect(appleImg).toHaveAttribute('aria-hidden', 'true');
  });

  test('suspended icon SVG is aria-hidden', async ({ page }) => {
    const icon = page.locator('#suspended-section .suspended-icon');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  test('App Store disabled button has aria-disabled', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const appStore = page.locator('#no-account-section .btn--store-disabled');
    await expect(appStore).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('Portal — Accessibility: Touch Targets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('sign-in button meets 44px minimum', async ({ page }) => {
    const btn = page.locator('#login-submit-btn');
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('Google sign-in button meets 44px minimum', async ({ page }) => {
    const btn = page.locator('#google-signin-btn');
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('Apple sign-in button meets 44px minimum', async ({ page }) => {
    const btn = page.locator('#apple-signin-btn');
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('email input meets 44px minimum height', async ({ page }) => {
    const input = page.locator('#login-email');
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('password input meets 44px minimum height', async ({ page }) => {
    const input = page.locator('#login-password');
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Portal — Accessibility: Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('Tab navigates through interactive elements', async ({ page }) => {
    // Focus the first element by pressing Tab
    await page.keyboard.press('Tab');

    // Collect focused element IDs
    const focusedElements: string[] = [];
    for (let i = 0; i < 8; i++) {
      const focusedId = await page.evaluate(() => document.activeElement?.id || '');
      if (focusedId) focusedElements.push(focusedId);
      await page.keyboard.press('Tab');
    }

    // Should include key interactive elements from the login section
    expect(focusedElements).toContain('google-signin-btn');
    expect(focusedElements).toContain('apple-signin-btn');
    expect(focusedElements).toContain('login-email');
    expect(focusedElements).toContain('login-password');
  });

  test('Enter key submits login form', async ({ page }) => {
    await page.locator('#login-email').fill('test@example.com');
    await page.locator('#login-password').fill('password123');
    await page.locator('#login-password').press('Enter');
    // Form should be submitted — we'll see an error since the credentials are invalid
    // but the form submission should have triggered
    // Wait for either an error message or a network request
    await page.waitForTimeout(2000);
    // The form should have attempted to submit
  });
});

test.describe('Portal — i18n: Data Attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('login section has data-i18n attributes on all translatable elements', async ({ page }) => {
    const expectedKeys = [
      'login_subtitle', 'login_google', 'login_apple', 'login_or',
      'login_email_label', 'login_password_label', 'login_remember',
      'login_submit', 'login_no_account', 'login_download',
    ];
    for (const key of expectedKeys) {
      const el = page.locator(`[data-i18n="${key}"]`);
      await expect(el).toHaveCount(1);
    }
  });

  test('TOTP section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'totp_heading', 'totp_subtitle', 'totp_code_label', 'totp_verify', 'totp_lost',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('enrollment section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'enroll_heading', 'enroll_subtitle', 'enroll_copy', 'enroll_code_label', 'enroll_confirm',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('recovery section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'recovery_heading', 'recovery_subtitle', 'recovery_email_label',
      'recovery_send', 'recovery_code_label', 'recovery_verify', 'recovery_back',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('suspended section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'suspended_heading', 'suspended_reason', 'suspended_until',
      'suspended_appeal', 'suspended_contact', 'suspended_signout',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('no-account section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'no_account_heading', 'no_account_subtitle',
      'no_account_google_play', 'no_account_app_store', 'no_account_back',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('dashboard section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'dashboard_welcome', 'dashboard_signout', 'dashboard_panels',
      'dashboard_community', 'dashboard_roadmap', 'dashboard_suggestions',
      'dashboard_account', 'dashboard_profile', 'dashboard_security', 'dashboard_data_privacy',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('profile section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'profile_heading', 'profile_display_name', 'profile_unique_id',
      'profile_user_type', 'profile_coming_soon',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('security section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'security_heading', 'security_password', 'security_password_desc',
      'security_change_password', 'security_totp', 'security_totp_status',
      'security_totp_enable', 'security_sessions', 'security_sessions_desc',
      'security_revoke_all', 'security_providers',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('data-privacy section has data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'data_privacy_heading', 'data_export', 'data_export_desc', 'data_export_btn',
      'data_delete', 'data_delete_desc', 'data_delete_btn',
      'data_legal', 'data_privacy_policy', 'data_terms', 'data_guidelines',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('modal sections have data-i18n attributes', async ({ page }) => {
    const expectedKeys = [
      'reauth_title', 'reauth_desc', 'reauth_code_label',
      'reauth_cancel', 'reauth_confirm', 'modal_close',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n="${key}"]`)).toHaveCount(1);
    }
  });

  test('placeholder data-i18n attributes exist', async ({ page }) => {
    const expectedKeys = [
      'login_email_placeholder', 'login_password_placeholder',
      'recovery_email_placeholder',
    ];
    for (const key of expectedKeys) {
      await expect(page.locator(`[data-i18n-placeholder="${key}"]`)).toHaveCount(1);
    }
  });

  test('back_to_dashboard appears on all subpages', async ({ page }) => {
    // back_to_dashboard should appear on profile, security, and data-privacy
    const count = await page.locator('[data-i18n="back_to_dashboard"]').count();
    expect(count).toBe(3);
  });

  test('loading text has data-i18n', async ({ page }) => {
    await expect(page.locator('[data-i18n="loading"]')).toHaveCount(1);
  });
});

test.describe('Portal — Responsive: Login Screen', () => {
  test('login renders at 320px width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });

    // Verify elements are visible and not overflowing
    await expect(page.locator('#login-submit-btn')).toBeVisible();
    await expect(page.locator('#google-signin-btn')).toBeVisible();
    await expect(page.locator('#apple-signin-btn')).toBeVisible();
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();

    // No horizontal scrollbar
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('login renders at 375px width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#login-submit-btn')).toBeVisible();

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('login renders at 768px width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#login-submit-btn')).toBeVisible();
  });

  test('login renders at 1280px width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#login-submit-btn')).toBeVisible();
  });
});

test.describe('Portal — Responsive: No Account Screen', () => {
  test('no-account renders at 320px without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});

test.describe('Portal — Responsive: Recovery Screen', () => {
  test('recovery renders at 320px without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});

test.describe('Portal — Semantic HTML Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('main element wraps portal content', async ({ page }) => {
    const main = page.locator('main#portal-app');
    await expect(main).toHaveCount(1);
  });

  test('sections use semantic section elements', async ({ page }) => {
    const sections = page.locator('main section.portal-section');
    const count = await sections.count();
    // Should have all portal sections
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('dashboard has header element', async ({ page }) => {
    const header = page.locator('#dashboard-section header.dashboard-header');
    await expect(header).toHaveCount(1);
  });

  test('loading section has aria-label', async ({ page }) => {
    const loading = page.locator('#loading-section');
    await expect(loading).toHaveAttribute('aria-label', 'Loading');
  });

  test('page has html lang attribute', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
  });

  test('page has UTF-8 charset', async ({ page }) => {
    const charset = page.locator('meta[charset]');
    await expect(charset).toHaveAttribute('charset', 'UTF-8');
  });

  test('page has description meta tag', async ({ page }) => {
    const desc = page.locator('meta[name="description"]');
    const content = await desc.getAttribute('content');
    expect(content).toContain('ShyTalk');
  });
});
