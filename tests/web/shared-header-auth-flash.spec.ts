/**
 * SHY-0148 — the shared header must not show "Sign In" to a visitor whose
 * sign-in state is not yet known.
 *
 * `roadmap-auth.js` publishes `window.shytalkAuth.authStateKnown` precisely so
 * a consumer can tell "signed out" from "we don't know yet" (SHY-0279). Its own
 * comment names the consequence: "which is why the shared header renders Sign
 * In during the unknown window". The header did not read the flag.
 *
 * These drive the header through its REAL published contract — the same global
 * and the same `shytalk-auth-changed` event the real producer uses — rather
 * than a fixed delay. Asserting on the natural page-load race would be flaky:
 * whether the unknown window outlives first paint depends on how fast Firebase
 * resolves, so a load-timing test passes on a fast machine and proves nothing.
 */
import { test, expect } from '@playwright/test';

/** Publish an auth state the way roadmap-auth.js does, then let the header react. */
async function publishAuthState(
  page: import('@playwright/test').Page,
  state: { currentUser: unknown; profile: unknown; authStateKnown: boolean },
) {
  await page.evaluate((s) => {
    const w = window as unknown as Record<string, unknown>;
    const prev = (w.shytalkAuth as Record<string, unknown>) || {};
    w.shytalkAuth = { ...prev, ...s };
    document.dispatchEvent(new Event('shytalk-auth-changed'));
  }, state);
}

const settled = (page: import('@playwright/test').Page) =>
  page.waitForFunction(
    () => !!(window as any).shytalkAuth && (window as any).shytalkAuth.authStateKnown === true,
    undefined,
    { timeout: 15_000 },
  );

test.describe('Shared header — no signed-out flash before auth is known', () => {
  test('while the sign-in state is UNKNOWN, Sign In is not shown', async ({ page }) => {
    await page.goto('/roadmap.html');
    await settled(page); // start from a real, settled page

    await publishAuthState(page, { currentUser: null, profile: null, authStateKnown: false });

    // The control must be withheld, not merely hidden later.
    await expect(page.locator('[data-testid="header-signin-btn"]')).toHaveCount(0);
    // …and the slot must still be occupied, so the header does not jump.
    await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(1);
  });

  test('once the state is KNOWN and signed out, Sign In appears', async ({ page }) => {
    await page.goto('/roadmap.html');
    await settled(page);

    await publishAuthState(page, { currentUser: null, profile: null, authStateKnown: false });
    await expect(page.locator('[data-testid="header-signin-btn"]')).toHaveCount(0);

    await publishAuthState(page, { currentUser: null, profile: null, authStateKnown: true });
    await expect(page.locator('[data-testid="header-signin-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(0);
  });

  test('once the state is KNOWN and signed in, the user info appears', async ({ page }) => {
    await page.goto('/roadmap.html');
    await settled(page);

    await publishAuthState(page, {
      currentUser: { uid: 'u1', displayName: 'Ada', photoURL: null },
      profile: { displayName: 'Ada' },
      authStateKnown: true,
    });
    await expect(page.locator('[data-testid="header-user-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="header-signin-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(0);
  });

  // The regression this fix could most plausibly cause. Seven of the eight
  // pages carrying the shared header load NO auth module at all, so
  // `window.shytalkAuth` is never published there. If the header waited for a
  // flag that will never arrive, those pages would sit pending forever — a far
  // worse defect than the flash being fixed.
  for (const path of ['/index.html', '/terms.html', '/privacy.html', '/404.html']) {
    test(`${path} has no auth module, so Sign In renders immediately`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('[data-testid="shared-header"]')).toBeVisible();
      await expect(page.locator('[data-testid="header-signin-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(0);
      // Prove the premise rather than assume it.
      expect(await page.evaluate(() => (window as any).shytalkAuth)).toBeFalsy();
    });
  }

  test('a real page load ends in a truthful, settled header', async ({ page }) => {
    // The end state must be correct however the load raced — this is the
    // regression guard that does NOT depend on timing.
    await page.goto('/roadmap.html');
    await settled(page);
    await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="shared-header"]')).toBeVisible();
  });
});
