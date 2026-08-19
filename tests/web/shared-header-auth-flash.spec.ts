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
import { injectAuthState, waitForAuthStateKnown } from './helpers/roadmap-auth';

// State is set ONLY through the sanctioned gate. SHY-0279 forbids a spec from
// assigning `window.shytalkAuth` directly, because a direct write cannot wait
// for the page's own sign-in check and is decided by a race it cannot see —
// measured on this very page, Chromium won at 505 ms and WebKit lost at 594 ms.
const settled = waitForAuthStateKnown;

test.describe('Shared header — no signed-out flash before auth is known', () => {
  test('while the sign-in state is UNKNOWN, Sign In is not shown', async ({ page }) => {
    await page.goto('/roadmap.html');
    await settled(page); // start from a real, settled page

    await injectAuthState(page, { currentUser: null, profile: null, authStateKnown: false });

    // The control must be withheld, not merely hidden later.
    await expect(page.locator('[data-testid="header-signin-btn"]')).toHaveCount(0);
    // …and the slot must still be occupied, so the header does not jump.
    await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(1);
  });

  test('once the state is KNOWN and signed out, Sign In appears', async ({ page }) => {
    // No injection: a settled signed-out visitor is exactly what the page
    // reaches on its own, so this asserts the real end state. Driving it by
    // injecting `authStateKnown:false` and then `true` cannot work — the gate
    // waits for `true` before every write, so the second call would deadlock
    // against the first. That constraint is the gate doing its job.
    await page.goto('/roadmap.html');
    await settled(page);

    await expect(page.locator('[data-testid="header-signin-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="header-auth-pending"]')).toHaveCount(0);
  });

  test('once the state is KNOWN and signed in, the user info appears', async ({ page }) => {
    await page.goto('/roadmap.html');
    await settled(page);

    await injectAuthState(page, {
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
