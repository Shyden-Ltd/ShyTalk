import { test, expect } from '@playwright/test';

test.describe('Portal — Dashboard Section Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('dashboard has Community section with title', async ({ page }) => {
    const communityTitle = page.locator('.card-group-title[data-i18n="dashboard_community"]');
    await expect(communityTitle).toHaveCount(1);
    await expect(communityTitle).toContainText('Community');
  });

  test('dashboard has Account section with title', async ({ page }) => {
    const accountTitle = page.locator('.card-group-title[data-i18n="dashboard_account"]');
    await expect(accountTitle).toHaveCount(1);
    await expect(accountTitle).toContainText('Account');
  });

  test('community grid has Roadmap card', async ({ page }) => {
    const roadmapCard = page.locator('#community-grid a[href="/roadmap.html"]');
    await expect(roadmapCard).toHaveCount(1);
    const label = roadmapCard.locator('.dashboard-card-label');
    await expect(label).toContainText('Roadmap');
  });

  test('community grid has Suggestions card', async ({ page }) => {
    const suggestionsCard = page.locator('#community-grid a[href="/roadmap.html#suggestions"]');
    await expect(suggestionsCard).toHaveCount(1);
    const label = suggestionsCard.locator('.dashboard-card-label');
    await expect(label).toContainText('Suggestions');
  });

  test('account grid has Profile card', async ({ page }) => {
    const profileCard = page.locator('#account-grid a[href="#profile"]');
    await expect(profileCard).toHaveCount(1);
    const label = profileCard.locator('.dashboard-card-label');
    await expect(label).toContainText('Profile');
  });

  test('account grid has Security card', async ({ page }) => {
    const securityCard = page.locator('#account-grid a[href="#security"]');
    await expect(securityCard).toHaveCount(1);
    const label = securityCard.locator('.dashboard-card-label');
    await expect(label).toContainText('Security');
  });

  test('account grid has Data & Privacy card', async ({ page }) => {
    const dataCard = page.locator('#account-grid a[href="#data-privacy"]');
    await expect(dataCard).toHaveCount(1);
    const label = dataCard.locator('.dashboard-card-label');
    await expect(label).toContainText('Privacy');
  });

  test('all card icons are aria-hidden', async ({ page }) => {
    const icons = page.locator('.dashboard-card-icon');
    const count = await icons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(icons.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

test.describe('Portal — Profile Section Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('profile section has back link to dashboard', async ({ page }) => {
    const backLink = page.locator('#profile-section a[href="#dashboard"]');
    await expect(backLink).toHaveCount(1);
    await expect(backLink).toContainText('Dashboard');
  });

  test('profile section has heading', async ({ page }) => {
    const heading = page.locator('#profile-section .portal-heading');
    await expect(heading).toContainText('Profile');
  });

  test('profile has avatar element', async ({ page }) => {
    await expect(page.locator('#profile-avatar')).toHaveCount(1);
    await expect(page.locator('#profile-avatar')).toHaveAttribute('aria-label', 'Profile avatar');
  });

  test('profile has display name field', async ({ page }) => {
    await expect(page.locator('#profile-display-name')).toHaveCount(1);
  });

  test('profile has unique ID field', async ({ page }) => {
    await expect(page.locator('#profile-unique-id')).toHaveCount(1);
  });

  test('profile has user type field', async ({ page }) => {
    await expect(page.locator('#profile-user-type')).toHaveCount(1);
  });

  test('profile has coming soon notice', async ({ page }) => {
    const notice = page.locator('#profile-section .portal-notice');
    await expect(notice).toContainText('coming soon');
  });

  test('profile fields show placeholder dashes initially', async ({ page }) => {
    await expect(page.locator('#profile-display-name')).toContainText('--');
    await expect(page.locator('#profile-unique-id')).toContainText('--');
    await expect(page.locator('#profile-user-type')).toContainText('--');
  });
});

test.describe('Portal — Security Section Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('security section has back link to dashboard', async ({ page }) => {
    const backLink = page.locator('#security-section a[href="#dashboard"]');
    await expect(backLink).toHaveCount(1);
    await expect(backLink).toContainText('Dashboard');
  });

  test('security section has heading', async ({ page }) => {
    const heading = page.locator('#security-section .portal-heading');
    await expect(heading).toContainText('Security');
  });

  test('has password card (hidden by default)', async ({ page }) => {
    const passwordCard = page.locator('#security-password-card');
    await expect(passwordCard).toBeHidden();
  });

  test('has TOTP management card', async ({ page }) => {
    const totpTitle = page.locator('#security-section .security-card-title[data-i18n="security_totp"]');
    await expect(totpTitle).toHaveCount(1);
    await expect(totpTitle).toContainText('Two-Factor');
  });

  test('TOTP status text shows loading initially', async ({ page }) => {
    const status = page.locator('#security-totp-status');
    await expect(status).toContainText('Loading');
  });

  test('TOTP button is hidden by default', async ({ page }) => {
    await expect(page.locator('#security-totp-btn')).toBeHidden();
  });

  test('has sessions card with revoke button', async ({ page }) => {
    const sessionsTitle = page.locator('#security-section .security-card-title[data-i18n="security_sessions"]');
    await expect(sessionsTitle).toHaveCount(1);
    await expect(sessionsTitle).toContainText('Sessions');
    await expect(page.locator('#security-revoke-btn')).toHaveCount(1);
  });

  test('revoke button has danger styling', async ({ page }) => {
    const revokeBtn = page.locator('#security-revoke-btn');
    const classes = await revokeBtn.getAttribute('class');
    expect(classes).toContain('btn--danger');
  });

  test('has linked providers card', async ({ page }) => {
    const providersTitle = page.locator('#security-section .security-card-title[data-i18n="security_providers"]');
    await expect(providersTitle).toHaveCount(1);
    await expect(providersTitle).toContainText('Sign-In');
  });

  test('providers list exists', async ({ page }) => {
    await expect(page.locator('#security-providers-list')).toHaveCount(1);
  });

  test('change password button exists', async ({ page }) => {
    await expect(page.locator('#security-change-password-btn')).toHaveCount(1);
  });
});

test.describe('Portal — Data & Privacy Section Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('data-privacy section has back link to dashboard', async ({ page }) => {
    const backLink = page.locator('#data-privacy-section a[href="#dashboard"]');
    await expect(backLink).toHaveCount(1);
    await expect(backLink).toContainText('Dashboard');
  });

  test('data-privacy section has heading', async ({ page }) => {
    const heading = page.locator('#data-privacy-section .portal-heading');
    await expect(heading).toContainText('Privacy');
  });

  test('has export data card with button', async ({ page }) => {
    const exportTitle = page.locator('#data-privacy-section .security-card-title[data-i18n="data_export"]');
    await expect(exportTitle).toHaveCount(1);
    await expect(exportTitle).toContainText('Export');
    await expect(page.locator('#data-export-btn')).toHaveCount(1);
  });

  test('has delete account card with danger button', async ({ page }) => {
    const deleteTitle = page.locator('#data-privacy-section .security-card-title[data-i18n="data_delete"]');
    await expect(deleteTitle).toHaveCount(1);
    await expect(deleteTitle).toContainText('Delete');
    const deleteBtn = page.locator('#data-delete-btn');
    const classes = await deleteBtn.getAttribute('class');
    expect(classes).toContain('btn--danger');
  });

  test('has legal section with all three links', async ({ page }) => {
    const legalTitle = page.locator('#data-privacy-section .security-card-title[data-i18n="data_legal"]');
    await expect(legalTitle).toHaveCount(1);
    await expect(legalTitle).toContainText('Legal');

    await expect(page.locator('#data-privacy-section a[href="/privacy.html"]')).toHaveCount(1);
    await expect(page.locator('#data-privacy-section a[href="/terms.html"]')).toHaveCount(1);
    await expect(page.locator('#data-privacy-section a[href="/community-guidelines.html"]')).toHaveCount(1);
  });

  test('privacy policy link text', async ({ page }) => {
    const link = page.locator('#data-privacy-section a[href="/privacy.html"]');
    await expect(link).toContainText('Privacy');
  });

  test('terms link text', async ({ page }) => {
    const link = page.locator('#data-privacy-section a[href="/terms.html"]');
    await expect(link).toContainText('Terms');
  });

  test('guidelines link text', async ({ page }) => {
    const link = page.locator('#data-privacy-section a[href="/community-guidelines.html"]');
    await expect(link).toContainText('Guidelines');
  });
});

test.describe('Portal — Hash Routing (Unauthenticated)', () => {
  test('empty hash shows login', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('#login shows login', async ({ page }) => {
    await page.goto('/portal/#login');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('#no-account shows download prompt', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
  });

  test('#recovery shows recovery form', async ({ page }) => {
    await page.goto('/portal/#recovery');
    await expect(page.locator('#recovery-section')).toBeVisible({ timeout: 15_000 });
  });

  test('#dashboard does NOT show dashboard when unauthenticated', async ({ page }) => {
    await page.goto('/portal/#dashboard');
    // Should redirect to login since user is not authenticated
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#dashboard-section')).toBeHidden();
  });

  test('#profile does NOT show profile when unauthenticated', async ({ page }) => {
    await page.goto('/portal/#profile');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#profile-section')).toBeHidden();
  });

  test('#security does NOT show security when unauthenticated', async ({ page }) => {
    await page.goto('/portal/#security');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#security-section')).toBeHidden();
  });

  test('#data-privacy does NOT show data-privacy when unauthenticated', async ({ page }) => {
    await page.goto('/portal/#data-privacy');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#data-privacy-section')).toBeHidden();
  });

  test('invalid hash shows login (XSS prevention)', async ({ page }) => {
    await page.goto('/portal/#<script>alert(1)</script>');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    // Must not inject script content
    const html = await page.content();
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  test('hash with javascript: protocol shows login', async ({ page }) => {
    await page.goto('/portal/#javascript:alert(1)');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('navigating between pseudo-routes works', async ({ page }) => {
    await page.goto('/portal/#login');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });

    // Go to no-account
    await page.locator('#login-section a[href="#no-account"]').click();
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 10_000 });

    // Go back to login
    await page.locator('#no-account-section a[href="#login"]').click();
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Portal — Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('re-auth modal has role="dialog"', async ({ page }) => {
    const modal = page.locator('#reauth-modal .modal');
    await expect(modal).toHaveAttribute('role', 'dialog');
  });

  test('re-auth modal has aria-modal="true"', async ({ page }) => {
    const modal = page.locator('#reauth-modal .modal');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('re-auth modal has aria-labelledby pointing to title', async ({ page }) => {
    const modal = page.locator('#reauth-modal .modal');
    await expect(modal).toHaveAttribute('aria-labelledby', 'reauth-title');
  });

  test('message modal has role="dialog"', async ({ page }) => {
    const modal = page.locator('#message-modal .modal');
    await expect(modal).toHaveAttribute('role', 'dialog');
  });

  test('message modal has aria-modal="true"', async ({ page }) => {
    const modal = page.locator('#message-modal .modal');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('message modal has aria-labelledby pointing to title', async ({ page }) => {
    const modal = page.locator('#message-modal .modal');
    await expect(modal).toHaveAttribute('aria-labelledby', 'message-modal-title');
  });

  test('re-auth form has TOTP code input with correct attributes', async ({ page }) => {
    const input = page.locator('#reauth-totp-code');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('maxlength', '6');
    await expect(input).toHaveAttribute('pattern', '[0-9]{6}');
    await expect(input).toHaveAttribute('dir', 'ltr');
  });

  test('re-auth error has role="alert"', async ({ page }) => {
    await expect(page.locator('#reauth-error')).toHaveAttribute('role', 'alert');
  });

  test('re-auth error is hidden by default', async ({ page }) => {
    await expect(page.locator('#reauth-error')).toBeHidden();
  });
});

test.describe('Portal — Subpage Back Links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/');
  });

  test('profile section back link has left arrow icon', async ({ page }) => {
    const backLink = page.locator('#profile-section .back-link');
    const svg = backLink.locator('svg');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  test('security section back link has left arrow icon', async ({ page }) => {
    const backLink = page.locator('#security-section .back-link');
    const svg = backLink.locator('svg');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  test('data-privacy section back link has left arrow icon', async ({ page }) => {
    const backLink = page.locator('#data-privacy-section .back-link');
    const svg = backLink.locator('svg');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
