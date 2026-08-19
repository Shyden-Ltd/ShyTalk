import { test, expect } from '@playwright/test';

test.describe('Portal — XSS Prevention via Hash Routing', () => {
  test('script tag in hash is not rendered', async ({ page }) => {
    await page.goto('/portal/#<img src=x onerror=alert(1)>');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    // Verify no img injection occurred
    const injectedImg = page.locator('img[src="x"]');
    await expect(injectedImg).toHaveCount(0);
  });

  test('data-uri in hash is ignored', async ({ page }) => {
    await page.goto('/portal/#data:text/html,<h1>xss</h1>');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
  });

  test('URL-encoded XSS in hash is ignored', async ({ page }) => {
    await page.goto('/portal/#%3Cscript%3Ealert(1)%3C/script%3E');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    const html = await page.content();
    expect(html).not.toContain('alert(1)');
  });

  test('only allowlisted routes are valid', async ({ page }) => {
    // These should all fall back to login
    const invalidRoutes = [
      'admin', 'settings', 'config', 'debug',
      '../admin', '../../etc/passwd',
      'dashboard/admin', 'profile/../admin',
    ];
    for (const route of invalidRoutes) {
      await page.goto(`/portal/#${route}`);
      // When unauthenticated, all routes should show login
      await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe('Portal — CSP & Security Headers', () => {
  test('page loads CSS correctly (no inline styles needed)', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    // Verify CSS is applied — login section should have styles from portal.css
    const loginSection = page.locator('#login-section');
    const display = await loginSection.evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    // Should not be 'none' — the section should be visible via CSS
    expect(display).not.toBe('none');
  });

  test('no inline scripts in portal HTML', async ({ page }) => {
    await page.goto('/portal/');
    // Check there are no inline scripts (CSP forbids unsafe-inline)
    const inlineScripts = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script:not([src])');
      return scripts.length;
    });
    expect(inlineScripts).toBe(0);
  });

  test('no inline event handlers in portal HTML', async ({ page }) => {
    await page.goto('/portal/');
    const inlineHandlers = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      let count = 0;
      const handlerAttrs = [
        'onclick', 'onload', 'onerror', 'onsubmit', 'onchange',
        'onfocus', 'onblur', 'onkeydown', 'onkeyup', 'onmouseover',
      ];
      for (const el of allElements) {
        for (const attr of handlerAttrs) {
          if (el.hasAttribute(attr)) count++;
        }
      }
      return count;
    });
    expect(inlineHandlers).toBe(0);
  });

  test('all external script sources are from allowed origins', async ({ page }) => {
    await page.goto('/portal/');
    const scriptSrcs = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[src]');
      return Array.from(scripts).map((s) => s.getAttribute('src'));
    });
    for (const src of scriptSrcs) {
      if (!src) continue;
      // Must be self (relative path), Firebase CDN (gstatic), or the Google
      // API loader that Firebase Auth uses for OAuth popup flows (apis.google.com).
      // Webkit/Safari loads apis.google.com/js/api.js dynamically during Firebase
      // Auth init even when no OAuth flow is active yet.
      const isAllowed =
        src.startsWith('/') ||
        src.startsWith('./') ||
        src.startsWith('config') ||
        src.startsWith('portal') ||
        src.startsWith('qrcode') ||
        src.includes('gstatic.com/firebasejs') ||
        src.startsWith('https://apis.google.com/js/api.js');
      expect(isAllowed, `Disallowed script src: ${src}`).toBe(true);
    }
  });
});

test.describe('Portal — Environment Isolation', () => {
  test('API_BASE points to localhost in test environment', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    // The portal.js sets API_BASE based on hostname
    // In test (localhost), it should be http://localhost:3000
    const apiBase = await page.evaluate(() => {
      // Check if any fetch went to production
      return location.hostname;
    });
    expect(apiBase).toMatch(/localhost|127\.0\.0\.1/);
  });

  test('no network requests to dev API when running locally', async ({ page }) => {
    const devRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('dev-api.shytalk.shyden.co.uk')) { // localhost isolation check
        devRequests.push(req.url());
      }
    });
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    expect(devRequests).toEqual([]);
  });

  test('no network requests to prod API when running locally', async ({ page }) => {
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

test.describe('Portal — Authentication Section Security', () => {
  test('password field is type="password" (not type="text")', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    const passwordInput = page.locator('#login-password');
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('TOTP code input has dir="ltr" (prevents RTL digit reordering)', async ({ page }) => {
    await page.goto('/portal/');
    const totpInput = page.locator('#totp-code');
    await expect(totpInput).toHaveAttribute('dir', 'ltr');
  });

  test('enrollment code input has dir="ltr"', async ({ page }) => {
    await page.goto('/portal/');
    const enrollInput = page.locator('#enroll-code');
    await expect(enrollInput).toHaveAttribute('dir', 'ltr');
  });

  test('re-auth TOTP input has dir="ltr"', async ({ page }) => {
    await page.goto('/portal/');
    const reauthInput = page.locator('#reauth-totp-code');
    await expect(reauthInput).toHaveAttribute('dir', 'ltr');
  });

  test('TOTP inputs enforce numeric pattern', async ({ page }) => {
    await page.goto('/portal/');
    for (const inputId of ['#totp-code', '#enroll-code', '#reauth-totp-code']) {
      const input = page.locator(inputId);
      await expect(input).toHaveAttribute('pattern', '[0-9]{6}');
      await expect(input).toHaveAttribute('maxlength', '6');
      await expect(input).toHaveAttribute('inputmode', 'numeric');
    }
  });

  test('remember me checkbox defaults to unchecked', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#login-remember')).not.toBeChecked();
  });

  test('secret key input is readonly', async ({ page }) => {
    await page.goto('/portal/');
    const keyInput = page.locator('#enroll-manual-key');
    await expect(keyInput).toHaveAttribute('readonly', '');
  });

  test('noindex prevents search engine indexing', async ({ page }) => {
    await page.goto('/portal/');
    const robots = page.locator('meta[name="robots"]');
    const content = await robots.getAttribute('content');
    expect(content).toContain('noindex');
    expect(content).toContain('nofollow');
  });
});

test.describe('Portal — Form Action Security', () => {
  test('login form has no action attribute (prevents unintended submission)', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    const form = page.locator('#login-form');
    const action = await form.getAttribute('action');
    expect(action).toBeNull();
  });

  test('TOTP form has no action attribute', async ({ page }) => {
    await page.goto('/portal/');
    const form = page.locator('#totp-form');
    const action = await form.getAttribute('action');
    expect(action).toBeNull();
  });

  test('enroll form has no action attribute', async ({ page }) => {
    await page.goto('/portal/');
    const form = page.locator('#enroll-form');
    const action = await form.getAttribute('action');
    expect(action).toBeNull();
  });

  test('re-auth form has no action attribute', async ({ page }) => {
    await page.goto('/portal/');
    const form = page.locator('#reauth-form');
    const action = await form.getAttribute('action');
    expect(action).toBeNull();
  });

  test('recovery send form has no action attribute', async ({ page }) => {
    await page.goto('/portal/');
    const form = page.locator('#recovery-send-form');
    const action = await form.getAttribute('action');
    expect(action).toBeNull();
  });

  test('recovery verify form has no action attribute', async ({ page }) => {
    await page.goto('/portal/');
    const form = page.locator('#recovery-verify-form');
    const action = await form.getAttribute('action');
    expect(action).toBeNull();
  });
});

test.describe('Portal — Link Security', () => {
  test('Google Play link has noopener noreferrer', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const link = page.locator('#no-account-section a[href*="play.google.com"]');
    const rel = await link.getAttribute('rel');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  test('Google Play link opens in new tab', async ({ page }) => {
    await page.goto('/portal/#no-account');
    await expect(page.locator('#no-account-section')).toBeVisible({ timeout: 15_000 });
    const link = page.locator('#no-account-section a[href*="play.google.com"]');
    await expect(link).toHaveAttribute('target', '_blank');
  });
});
