import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression: shared-header's Sign In button MUST work on every page
 * that loads shared-header.js, not just on the roadmap.
 *
 * Pre-fix: clicking Sign In on the homepage / legal pages / event
 * pages was a no-op because shared-header.js called
 * `window.shytalkShowLoginModal()` — a function only registered by
 * `suggestions-board.js`, which only loads on `/roadmap.html`.
 * Six static pages (index, privacy, terms, community-guidelines,
 * cyber-bullying, do-not-sell) shipped with a non-functional Sign
 * In button until the fallback was added. Found 2026-05-09 via
 * /manual-qa.
 *
 * Post-fix: pages with the modal hook keep the in-page modal flow;
 * pages without it navigate to /portal/, the canonical web auth UI.
 */

test.describe('Shared header Sign In — modal hook + portal fallback', () => {
  test('homepage Sign In navigates to /portal/ (no modal hook registered)', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => !!document.querySelector('[data-testid="shared-header"]'));

    // Confirm the modal hook is NOT registered on the homepage
    const beforeClick = await page.evaluate(() => ({
      modalHookExists: typeof (window as any).shytalkShowLoginModal === 'function',
    }));
    expect(beforeClick.modalHookExists).toBe(false);

    // Click Sign In and assert navigation to /portal/
    await Promise.all([
      page.waitForURL((url) => url.pathname.startsWith('/portal/'), { timeout: 5_000 }),
      page.locator('[data-testid="header-signin-btn"]').click(),
    ]);
    expect(page.url()).toContain('/portal/');
  });

  test('roadmap Sign In opens the in-page modal (modal hook registered)', async ({ page }) => {
    await page.goto(`${BASE}/roadmap.html?qa=signin-modal`);
    await page.waitForFunction(() => typeof (window as any).shytalkShowLoginModal === 'function');

    // Spy on the modal hook + the navigation, prove modal is invoked
    // and we do NOT navigate to /portal/.
    const startUrl = page.url();
    const result = await page.evaluate(async () => {
      let calledWith: string | null = null;
      const orig = (window as any).shytalkShowLoginModal;
      (window as any).shytalkShowLoginModal = (action: string) => {
        calledWith = action;
        return orig?.(action);
      };
      const btn = document.querySelector('[data-testid="header-signin-btn"]') as HTMLElement | null;
      if (!btn) return { invoked: false, calledWith };
      btn.click();
      // Brief settle so any deferred navigation / state change runs
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { invoked: !!calledWith, calledWith };
    });

    expect(result.invoked).toBe(true);
    expect(result.calledWith).toBeTruthy();
    // Confirm we did NOT navigate (modal flow keeps user on roadmap)
    expect(page.url()).toBe(startUrl);
  });
});
