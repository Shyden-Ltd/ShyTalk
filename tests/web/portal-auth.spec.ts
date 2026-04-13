import { test, expect } from '@playwright/test';

test.describe('Portal — Page Load & Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/ShyTalk.*Portal/i);
  });

  test('loading section exists in DOM', async ({ page }) => {
    // Loading section transitions to login quickly, so just verify it exists
    const loading = page.locator('#loading-section');
    await expect(loading).toHaveCount(1);
    // It should have spinner and sr-only text
    await expect(loading.locator('.spinner')).toHaveCount(1);
  });

  test('login section becomes visible after Firebase init', async ({ page }) => {
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('portal-app container exists', async ({ page }) => {
    await expect(page.locator('#portal-app')).toBeVisible();
  });

  test('has noindex meta tag', async ({ page }) => {
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', 'noindex, nofollow');
  });

  test('has theme-color meta tag', async ({ page }) => {
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute('content', '#0f0d15');
  });

  test('has viewport meta tag', async ({ page }) => {
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });

  test('has noscript fallback', async ({ page }) => {
    const noscript = page.locator('noscript');
    const text = await noscript.textContent();
    expect(text).toContain('JavaScript');
  });
});

test.describe('Portal — Login Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('displays ShyTalk logo', async ({ page }) => {
    const logo = page.locator('#login-section .portal-logo');
    await expect(logo).toBeVisible();
    await expect(logo).toContainText('ShyTalk');
  });

  test('displays sign-in subtitle', async ({ page }) => {
    const subtitle = page.locator('#login-section .portal-subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toContainText('Sign in');
  });

  test('has Google sign-in button with branded logo', async ({ page }) => {
    const btn = page.locator('#google-signin-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Google');
    const img = btn.locator('img');
    await expect(img).toHaveAttribute('src', /google-logo\.svg/);
    await expect(img).toHaveAttribute('aria-hidden', 'true');
  });

  test('has Apple sign-in button with branded logo', async ({ page }) => {
    const btn = page.locator('#apple-signin-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Apple');
    const img = btn.locator('img');
    await expect(img).toHaveAttribute('src', /apple-logo\.svg/);
    await expect(img).toHaveAttribute('aria-hidden', 'true');
  });

  test('has email input with correct attributes', async ({ page }) => {
    const email = page.locator('#login-email');
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(email).toHaveAttribute('required', '');
  });

  test('has password input with correct attributes', async ({ page }) => {
    const password = page.locator('#login-password');
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(password).toHaveAttribute('required', '');
  });

  test('has remember me checkbox', async ({ page }) => {
    const checkbox = page.locator('#login-remember');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toHaveAttribute('type', 'checkbox');
    // Should not be checked by default
    await expect(checkbox).not.toBeChecked();
  });

  test('has sign-in submit button', async ({ page }) => {
    const btn = page.locator('#login-submit-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Sign In');
  });

  test('has "Don\'t have an account?" link to download', async ({ page }) => {
    const link = page.locator('#login-section a[href="#no-account"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Download');
  });

  test('email input has associated label', async ({ page }) => {
    const label = page.locator('label[for="login-email"]');
    await expect(label).toHaveCount(1);
  });

  test('password input has associated label', async ({ page }) => {
    const label = page.locator('label[for="login-password"]');
    await expect(label).toHaveCount(1);
  });

  test('login error is hidden by default', async ({ page }) => {
    const error = page.locator('#login-error');
    await expect(error).toBeHidden();
  });

  test('login error has role="alert"', async ({ page }) => {
    const error = page.locator('#login-error');
    await expect(error).toHaveAttribute('role', 'alert');
  });

  test('divider between OAuth and email login', async ({ page }) => {
    const divider = page.locator('#login-section .divider');
    await expect(divider).toBeVisible();
    await expect(divider).toHaveAttribute('aria-hidden', 'true');
  });

  test('login form has autocomplete attribute', async ({ page }) => {
    const form = page.locator('#login-form');
    await expect(form).toHaveAttribute('autocomplete', 'on');
  });
});

test.describe('Portal — Login Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('submitting empty form triggers browser validation', async ({ page }) => {
    await page.locator('#login-submit-btn').click();
    // Browser should show validation message on required email field
    const emailInput = page.locator('#login-email');
    const hasValidation = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage !== '',
    );
    expect(hasValidation).toBe(true);
  });

  test('submitting with email only triggers password validation', async ({ page }) => {
    await page.locator('#login-email').fill('test@example.com');
    await page.locator('#login-submit-btn').click();
    const passwordInput = page.locator('#login-password');
    const hasValidation = await passwordInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage !== '',
    );
    expect(hasValidation).toBe(true);
  });

  test('invalid email triggers email validation', async ({ page }) => {
    await page.locator('#login-email').fill('not-an-email');
    await page.locator('#login-password').fill('password123');
    await page.locator('#login-submit-btn').click();
    const emailInput = page.locator('#login-email');
    const hasValidation = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid,
    );
    expect(hasValidation).toBe(true);
  });
});

test.describe('Portal — No Account Screen', () => {
  test('navigating to #no-account shows download prompt', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
  });

  test('no-account screen has correct heading', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const heading = page.locator('#no-account-section .portal-heading');
    await expect(heading).toContainText('Download');
  });

  test('Google Play link has correct href', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const playLink = page.locator('#no-account-section a[href*="play.google.com"]');
    await expect(playLink).toBeVisible();
    await expect(playLink).toHaveAttribute('target', '_blank');
    await expect(playLink).toHaveAttribute('rel', /noopener/);
  });

  test('App Store link is disabled', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const appStoreLink = page.locator('#no-account-section .btn--store-disabled');
    await expect(appStoreLink).toBeVisible();
    await expect(appStoreLink).toHaveAttribute('aria-disabled', 'true');
  });

  test('back to sign-in link works', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const backLink = page.locator('#no-account-section a[href="#login"]');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Portal — Recovery Screen', () => {
  test('navigating to #recovery shows recovery form', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
  });

  test('recovery screen has correct heading', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    const heading = page.locator('#recovery-section .portal-heading');
    await expect(heading).toContainText('authenticator');
  });

  test('recovery has email input with correct attributes', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    const emailInput = page.locator('#recovery-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('autocomplete', 'email');
    await expect(emailInput).toHaveAttribute('required', '');
  });

  test('recovery send button visible, verify form hidden initially', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#recovery-send-btn')).toBeVisible();
    await expect(page.locator('#recovery-verify-form')).toBeHidden();
  });

  test('recovery error and message are hidden initially', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#recovery-error')).toBeHidden();
    await expect(page.locator('#recovery-message')).toBeHidden();
  });

  test('recovery error has role="alert"', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#recovery-error')).toHaveAttribute('role', 'alert');
  });

  test('recovery message has role="status"', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#recovery-message')).toHaveAttribute('role', 'status');
  });

  test('back to sign-in link from recovery works', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
    const backLink = page.locator('#recovery-section a[href="#login"]');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Portal — Hidden Sections on Load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('TOTP section is hidden', async ({ page }) => {
    await expect(page.locator('#totp-section')).toBeHidden();
  });

  test('enrollment section is hidden', async ({ page }) => {
    await expect(page.locator('#enroll-section')).toBeHidden();
  });

  test('dashboard section is hidden', async ({ page }) => {
    await expect(page.locator('#dashboard-section')).toBeHidden();
  });

  test('suspended section is hidden', async ({ page }) => {
    await expect(page.locator('#suspended-section')).toBeHidden();
  });

  test('profile section is hidden', async ({ page }) => {
    await expect(page.locator('#profile-section')).toBeHidden();
  });

  test('security section is hidden', async ({ page }) => {
    await expect(page.locator('#security-section')).toBeHidden();
  });

  test('data-privacy section is hidden', async ({ page }) => {
    await expect(page.locator('#data-privacy-section')).toBeHidden();
  });

  test('re-auth modal is hidden', async ({ page }) => {
    await expect(page.locator('#reauth-modal')).toBeHidden();
  });

  test('message modal is hidden', async ({ page }) => {
    await expect(page.locator('#message-modal')).toBeHidden();
  });
});

test.describe('Portal — TOTP Section Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('TOTP section has correct heading', async ({ page }) => {
    const heading = page.locator('#totp-section .portal-heading');
    await expect(heading).toContainText('Two-Factor');
  });

  test('TOTP code input has correct attributes', async ({ page }) => {
    const input = page.locator('#totp-code');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('maxlength', '6');
    await expect(input).toHaveAttribute('pattern', '[0-9]{6}');
    await expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(input).toHaveAttribute('dir', 'ltr');
  });

  test('TOTP code input has associated label', async ({ page }) => {
    const label = page.locator('label[for="totp-code"]');
    await expect(label).toHaveCount(1);
  });

  test('TOTP error has role="alert"', async ({ page }) => {
    await expect(page.locator('#totp-error')).toHaveAttribute('role', 'alert');
  });

  test('lost authenticator link points to recovery', async ({ page }) => {
    const link = page.locator('#totp-section a[href="#recovery"]');
    await expect(link).toHaveCount(1);
  });
});

test.describe('Portal — Enrollment Section Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('enrollment section has QR container', async ({ page }) => {
    const qr = page.locator('#enroll-qr');
    await expect(qr).toHaveAttribute('aria-label', 'QR code for TOTP setup');
  });

  test('enrollment has manual key input (readonly)', async ({ page }) => {
    const keyInput = page.locator('#enroll-manual-key');
    await expect(keyInput).toHaveAttribute('readonly', '');
  });

  test('enrollment has copy button', async ({ page }) => {
    const copyBtn = page.locator('#enroll-copy-btn');
    await expect(copyBtn).toHaveAttribute('aria-label', 'Copy secret key');
  });

  test('enrollment code input has correct attributes', async ({ page }) => {
    const input = page.locator('#enroll-code');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('maxlength', '6');
    await expect(input).toHaveAttribute('pattern', '[0-9]{6}');
  });

  test('enrollment error has role="alert"', async ({ page }) => {
    await expect(page.locator('#enroll-error')).toHaveAttribute('role', 'alert');
  });
});

test.describe('Portal — Suspension Section Structure', () => {
  test('suspended section has warning icon', async ({ page }) => {
    await page.goto('/portal/');
    const icon = page.locator('#suspended-section .suspended-icon svg');
    await expect(icon).toHaveCount(1);
  });

  test('suspended section has appeal button', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#suspended-appeal-btn')).toHaveCount(1);
  });

  test('suspended section has sign-out button', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#suspended-signout-btn')).toHaveCount(1);
  });

  test('suspended section has contact support link', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#suspended-contact-link')).toHaveCount(1);
  });

  test('suspension end date is hidden by default', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#suspended-end-date')).toBeHidden();
  });
});

test.describe('Portal — Dashboard Section Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('dashboard has sign-out button', async ({ page }) => {
    await expect(page.locator('#dashboard-signout-btn')).toHaveCount(1);
  });

  test('dashboard has welcome text', async ({ page }) => {
    await expect(page.locator('#dashboard-welcome')).toHaveCount(1);
  });

  test('community section has roadmap link', async ({ page }) => {
    const roadmapLink = page.locator('#community-grid a[href="/roadmap.html"]');
    await expect(roadmapLink).toHaveCount(1);
  });

  test('account cards grid exists', async ({ page }) => {
    await expect(page.locator('#account-grid')).toHaveCount(1);
  });

  test('panels group is hidden by default', async ({ page }) => {
    await expect(page.locator('#panels-group')).toBeHidden();
  });
});

test.describe('Portal — Re-auth Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('re-auth modal exists and is hidden', async ({ page }) => {
    const modal = page.locator('#reauth-modal');
    await expect(modal).toBeHidden();
  });

  test('re-auth modal has TOTP code input', async ({ page }) => {
    const input = page.locator('#reauth-totp-code');
    await expect(input).toHaveCount(1);
  });

  test('re-auth modal has confirm and cancel buttons', async ({ page }) => {
    await expect(page.locator('#reauth-confirm-btn')).toHaveCount(1);
    await expect(page.locator('#reauth-cancel-btn')).toHaveCount(1);
  });
});

test.describe('Portal — Message Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('message modal exists and is hidden', async ({ page }) => {
    const modal = page.locator('#message-modal');
    await expect(modal).toBeHidden();
  });

  test('message modal has title and body elements', async ({ page }) => {
    await expect(page.locator('#message-modal-title')).toHaveCount(1);
    await expect(page.locator('#message-modal-body')).toHaveCount(1);
  });

  test('message modal has close button', async ({ page }) => {
    await expect(page.locator('#message-modal-close-btn')).toHaveCount(1);
  });
});

test.describe('Portal — Console & Environment Checks', () => {
  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    // Filter out Firebase/network errors that are expected in test environment
    const unexpectedErrors = errors.filter(
      (e) => !e.includes('Firebase') && !e.includes('fetch') && !e.includes('ERR_CONNECTION'),
    );
    expect(unexpectedErrors).toEqual([]);
  });

  test('no requests to production API', async ({ page }) => {
    const prodRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('api.shytalk.shyden.co.uk') && !url.includes('dev-api')) { // localhost isolation check
        prodRequests.push(url);
      }
    });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    expect(prodRequests).toEqual([]);
  });
});
