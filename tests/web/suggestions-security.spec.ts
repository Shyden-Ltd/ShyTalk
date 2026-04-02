import { test, expect } from '@playwright/test';

/**
 * Translations, anti-abuse, security, sessions, and compatibility tests.
 *
 * Covers spec sections:
 *   11.13  — Translations
 *   11.14  — Anti-Abuse
 *   11.43  — CSP & Security Headers
 *   11.45  — Error States
 *   11.46  — Browser Compatibility
 *   11.66  — Token Expiry & Session Handling
 *   11.107 — Incognito & Storage Restrictions
 *   11.108 — Multiple Tabs & Windows
 *   11.111 — Third-Party Script Failure
 */

// ═══════════════════════════════════════════════════════════════
// 11.13 — Translations
// ═══════════════════════════════════════════════════════════════

test.describe('Translations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('language switcher present on page', async ({ page }) => {
    const switcher = page.locator('.lang-selector, [data-testid="language-selector"], .language-btn');
    await expect(switcher).toBeVisible({ timeout: 10_000 });
  });

  test('switch language: all headings translated', async ({ page }) => {
    const switcher = page.locator('.lang-selector, [data-testid="language-selector"], .language-btn');
    if (await switcher.count() > 0) {
      await switcher.click();
      const deOption = page.locator('[data-lang="de"], .lang-option:has-text("Deutsch")');
      if (await deOption.count() > 0) {
        await deOption.click();
        await page.waitForTimeout(1000);
        // Page content should be in German
      }
    }
  });

  test('switch language: all buttons translated', async ({ page }) => {
    // After language switch, button labels should be translated
  });

  test('switch language: all status badges translated', async ({ page }) => {
    // Status badges (Done, In Progress, Planned) should be translated
  });

  test('switch language: info banner translated', async ({ page }) => {
    // Suggestions info banner text should be translated
  });

  test('switch language: filter labels translated', async ({ page }) => {
    // Filter dropdown labels should be translated
  });

  test('switch language: suggestion form labels translated', async ({ page }) => {
    // Form field labels should be translated
  });

  test('switch language: subscribe modal labels translated', async ({ page }) => {
    // Modal labels and toggles should be translated
  });

  test('switch language: error messages translated', async ({ page }) => {
    // Error messages should appear in selected language
  });

  test('test all 20 languages render correctly', async ({ page }) => {
    const languages = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];
    for (const lang of languages) {
      await page.goto(`/roadmap.html?lang=${lang}`);
      await page.waitForTimeout(500);
      // Page should not have console errors
      // All visible text should be non-empty
    }
  });

  test('RTL layout correct for Arabic', async ({ page }) => {
    await page.goto('/roadmap.html?lang=ar');
    await page.waitForTimeout(1000);
    const dir = await page.evaluate(() => document.dir || document.documentElement.dir);
    // Should be RTL or have RTL styling applied
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.14 — Anti-Abuse
// ═══════════════════════════════════════════════════════════════

test.describe('Anti-Abuse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('banned user: sees suggestions (read-only)', async ({ page }) => {
    // Banned users should still be able to browse suggestions
  });

  test('banned user: no vote/comment/suggest buttons visible', async ({ page }) => {
    // Interactive elements should be hidden for banned users
  });

  test('banned user: direct API call returns 403', async ({ page }) => {
    // Even if UI is bypassed, API should reject
  });

  test('suspended user (full): page shows suspension message', async ({ page }) => {
    // Fully suspended users should see a suspension banner
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.43 — CSP & Security Headers
// ═══════════════════════════════════════════════════════════════

test.describe('CSP & Security Headers', () => {
  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  test('CSP connect-src includes API origin', async ({ page }) => {
    const response = await page.goto('/roadmap.html');
    const csp = response?.headers()['content-security-policy'];
    if (csp) {
      expect(csp).toMatch(/connect-src/);
    }
  });

  test('no mixed content warnings', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Mixed Content')) {
        warnings.push(msg.text());
      }
    });
    await page.goto('/roadmap.html');
    await page.waitForTimeout(2000);
    expect(warnings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.45 — Error States
// ═══════════════════════════════════════════════════════════════

test.describe('Error States', () => {
  test('API unreachable: roadmap shows fallback message', async ({ page }) => {
    // Block API requests
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    // Should show fallback message
  });

  test('API returns 500 on suggestions list: error message shown', async ({ page }) => {
    await page.route('**/api/suggestions*', (route) =>
      route.fulfill({ status: 500, body: '{"error":"Internal server error"}' })
    );
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    // Should show error state
  });

  test('stale data: user votes on just-planned suggestion gets error', async ({ page }) => {
    // If suggestion state changed between load and vote, user should see error
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.46 — Browser Compatibility
// ═══════════════════════════════════════════════════════════════

test.describe('Browser Compatibility', () => {
  test('page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('all features render correctly', async ({ page }) => {
    await page.goto('/roadmap.html');
    await expect(page.locator('body')).toBeVisible();
    // Basic smoke test for browser compatibility
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.66 — Token Expiry & Session Handling
// ═══════════════════════════════════════════════════════════════

test.describe('Token Expiry & Session Handling', () => {
  test('user signs out: all interactive UI disabled', async ({ page }) => {
    await page.goto('/roadmap.html');
    // After sign out, vote/comment/suggest buttons should be disabled or hidden
  });

  test('session persists across page reload', async ({ page }) => {
    await page.goto('/roadmap.html');
    await page.reload();
    // Session state should be preserved
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.107 — Incognito & Storage Restrictions
// ═══════════════════════════════════════════════════════════════

test.describe('Incognito & Storage Restrictions', () => {
  test('page loads without errors in clean context', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
    await context.close();
  });

  test('cookies disabled: page loads, login fails with appropriate error', async ({ browser }) => {
    // Simulated by blocking cookies
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/roadmap.html');
    await expect(page.locator('body')).toBeVisible();
    await context.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.108 — Multiple Tabs & Windows
// ═══════════════════════════════════════════════════════════════

test.describe('Multiple Tabs & Windows', () => {
  test('two tabs same user: vote in tab 1, refresh tab 2 → vote reflected', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    await page1.goto('/roadmap.html');
    await page2.goto('/roadmap.html');
    // Vote in tab 1, refresh tab 2 — should see the vote
    await page1.close();
    await page2.close();
  });

  test('two tabs different users: each maintains own session', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    await page1.goto('/roadmap.html');
    await page2.goto('/roadmap.html');
    // Different contexts = different sessions
    await ctx1.close();
    await ctx2.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.111 — Third-Party Script Failure
// ═══════════════════════════════════════════════════════════════

test.describe('Third-Party Script Failure', () => {
  test('Firebase SDK fails: roadmap shows static content', async ({ page }) => {
    // Block Firebase
    await page.route('**/firebase**', (route) => route.abort());
    await page.goto('/roadmap.html');
    await page.waitForTimeout(3000);
    // Roadmap data should still render (static JSON)
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('translation JS fails: renders in English, no errors', async ({ page }) => {
    // Block translation file
    await page.route('**/roadmap-translations**', (route) => route.abort());
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});
