import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/**
 * Regression: admin sub-feature inits must be idempotent.
 *
 * Pre-fix bug: main.js calls `syncProd.init()`, `nuclearReset.init()`,
 * and `ageVerificationModule.init()` from inside Firebase's
 * `onAuthStateChanged` callback. That callback fires on every sign-in,
 * sign-out → sign-in cycle, and ID-token refresh.
 *
 * Each of those module inits unconditionally invokes `addEventListener`
 * on a fixed set of admin-panel DOM elements (sync overlay buttons,
 * nuclear-reset overlay buttons, age-verification decision buttons).
 * After N sign-in cycles, every destructive admin button has N stacked
 * click handlers — clicking once fires N approves, N nuclear-proceeds,
 * N sync-prod runs. Discovered during /manual-qa cycle 2 on 2026-05-09
 * after fixing the analogous logger.js stack-overflow bug (PR #562).
 *
 * Test pins the contract: signing out and back in must NOT add a
 * second click handler to any of the wired-up maintenance / age-verif
 * elements.
 */

const SPIED_IDS = [
  // sync-prod overlay
  'migrate-prod-btn', 'sync-cancel', 'sync-overlay',
  'sync-confirm-input', 'sync-mute', 'sync-proceed',
  // nuclear-reset overlay
  'reset-all-btn', 'nuclear-cancel', 'nuclear-overlay',
  'nuclear-confirm-input', 'nuclear-mute', 'nuclear-proceed',
  // age-verification decision buttons
  'age-verif-approve-btn', 'age-verif-reject-btn-yes',
  'age-verif-reject-btn-no', 'age-verif-modify-btn', 'age-verif-jump-next',
];

async function loginWith(page: any, email: string, password: string) {
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test.describe('Admin init idempotency (regression)', () => {
  test('sign-out + sign-in cycle does not stack click listeners on destructive buttons', async ({ page, browserName }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    // The bug is in JavaScript event-listener accumulation — engine-independent.
    // Firefox + chromium-family give us 3 engines of coverage. WebKit's
    // Firebase-Auth + IndexedDB cleanup-on-signOut path is consistently
    // slow in CI (the 2nd sign-in's getIdTokenResult takes >30s after
    // signOut clears local persistence), so we skip there. The test does
    // not validate any webkit-specific behaviour.
    test.skip(browserName === 'webkit', 'Skipped on WebKit — slow Firebase Auth IDB reseat after signOut, not a webkit-specific bug');

    // Install an addEventListener spy BEFORE the page's scripts run.
    // Keyed by (elementId, eventType). Only counts adds for the IDs
    // touched by sync-prod / nuclear-reset / age-verification inits.
    await page.addInitScript((spiedIds: string[]) => {
      const wantedSet = new Set(spiedIds);
      (window as any).__addListenerCounts = {} as Record<string, number>;
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, opts) {
        const id = (this as Element).id;
        if (id && wantedSet.has(id)) {
          const key = `${id}:${type}`;
          const counts = (window as any).__addListenerCounts as Record<string, number>;
          counts[key] = (counts[key] || 0) + 1;
        }
        return orig.call(this, type, listener, opts);
      };
    }, SPIED_IDS);

    await page.goto('/admin/');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });

    // First sign-in → first init cycle for the three modules.
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });

    // Wait until module inits have finished — `migrate-prod-btn` is wired
    // by sync-prod.init(), so once it has a click listener we know all
    // three sync inits have run.
    await page.waitForFunction(() => {
      const counts = (window as any).__addListenerCounts as Record<string, number> | undefined;
      return !!counts && (counts['migrate-prod-btn:click'] || 0) > 0;
    }, null, { timeout: 30_000 });

    const baseline = await page.evaluate(() => ({
      ...((window as any).__addListenerCounts as Record<string, number>),
    }));

    // Sign out via the admin sign-out button. The auth listener fires
    // with user=null — no init code runs in that branch, but listeners
    // on the dashboard-side DOM elements are still attached.
    await page.locator('#signout-btn').click();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });

    // Second sign-in → second auth-state-change. Pre-fix this would
    // have re-run the module inits and doubled every counted listener.
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });

    // Give the post-login init flow a moment to settle. We can't poll
    // for "init done" cleanly because the contract is "no new listeners"
    // — we have to wait long enough that any new ones would have landed.
    await page.waitForTimeout(2_000);

    const afterReinit = await page.evaluate(() => ({
      ...((window as any).__addListenerCounts as Record<string, number>),
    }));

    // Assert each spied (id, type) listener count is unchanged after
    // the sign-out + sign-in cycle. Listing per-key gives a much more
    // useful failure message than a single deep-equal.
    for (const key of Object.keys(baseline)) {
      expect(
        afterReinit[key],
        `Listener count for ${key} should not increase after sign-out+sign-in (pre-fix bug stacked them)`,
      ).toBe(baseline[key]);
    }
    // And no NEW spied keys should have appeared (e.g. a button that
    // had no listener before now has one — also a sign of double-init).
    for (const key of Object.keys(afterReinit)) {
      expect(baseline[key]).toBeDefined();
    }
  });
});
