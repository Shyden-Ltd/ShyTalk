/**
 * SHY-0279 — the page must say when its sign-in check has finished.
 *
 * `roadmap-auth.js` owns `window.shytalkAuth`. When Firebase's initial
 * `onAuthStateChanged` fires, `updateGlobalAuth()` REPLACES that object
 * wholesale from the module's own `currentUser`/`shytalkProfile` and
 * re-publishes. Nobody is signed in during these checks, so `currentUser` is
 * `null` — anything a spec assigned beforehand is erased, and the shared
 * header (which rebuilds itself from scratch on every render) detaches
 * `header-user-info` and puts the Sign In button back.
 *
 * Seven web checks were decided by that race. Measured 2026-08-05 on the same
 * page: Chromium resolved at 505 ms and the injection at 524 ms (injection
 * won, check passed); WebKit injected at 415 ms and resolved at 594 ms
 * (page won by 179 ms, check failed). Nothing about it is WebKit-specific —
 * WebKit simply loses a race the specs could not see, because
 * `authStateKnown` was private to the module and no caller could tell
 * "signed out" apart from "we don't know yet".
 *
 * These checks pin the ORDER rather than any duration, so they cannot be
 * satisfied by a machine that happens to be fast.
 */
import { test, expect } from '@playwright/test';
import { waitForAuthStateKnown, injectAuthState } from './helpers/roadmap-auth';

interface PublishRecord {
  authStateKnown: boolean;
  hasUser: boolean;
}

/**
 * Record every publication of `window.shytalkAuth` and every
 * `shytalk-auth-changed` dispatch, from before any page script runs.
 *
 * This observes the real page — it replaces nothing and stubs nothing; the
 * accessor stores and returns exactly what was assigned.
 */
async function recordAuthPublications(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __authPublications: PublishRecord[];
      __authEvents: number;
      shytalkAuth?: { authStateKnown?: boolean; currentUser?: unknown };
    };
    w.__authPublications = [];
    w.__authEvents = 0;
    let held: { authStateKnown?: boolean; currentUser?: unknown } | undefined;
    Object.defineProperty(window, 'shytalkAuth', {
      configurable: true,
      get: () => held,
      set: (next) => {
        held = next;
        w.__authPublications.push({
          authStateKnown: next?.authStateKnown === true,
          hasUser: !!next?.currentUser,
        });
      },
    });
    document.addEventListener('shytalk-auth-changed', () => {
      w.__authEvents += 1;
    });
  });
}

const readPublications = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __authPublications: PublishRecord[] }).__authPublications);

test.describe('SHY-0279 — sign-in resolution is observable', () => {
  test.beforeEach(async ({ page }) => {
    await recordAuthPublications(page);
  });

  test('publishes authStateKnown once the page sign-in check resolves', async ({ page }) => {
    await page.goto('/roadmap.html');
    // Fails against unmodified code: the flag is private to the module, so
    // this never becomes true and the wait times out.
    await waitForAuthStateKnown(page);

    const publications = await readPublications(page);
    expect(publications.some((p) => p.authStateKnown)).toBe(true);
  });

  test('the pre-resolution publish does not claim the state is known', async ({ page }) => {
    await page.goto('/roadmap.html');
    await waitForAuthStateKnown(page);

    // `roadmap-auth.js` publishes a placeholder synchronously at module load,
    // long before Firebase answers. If THAT one claimed the state was known,
    // every waiter would sail straight past the gate and the race would be
    // back — with a green flag on top of it.
    const publications = await readPublications(page);
    expect(publications.length).toBeGreaterThan(1);
    expect(publications[0]).toEqual({ authStateKnown: false, hasUser: false });
  });

  test('resolution lands BEFORE an injected visitor, on every engine', async ({ page }) => {
    await page.goto('/roadmap.html');
    await injectAuthState(page, {
      currentUser: { uid: 'test-123', displayName: 'TestUser' },
      profile: { uniqueId: 1001, displayName: 'TestUser' },
    });

    // The ordering IS the contract. On unmodified code the page's own
    // resolution could land after the injection (it did, on WebKit, by
    // 179 ms) and wipe it out. Asserting the order — rather than a
    // duration — is what makes this independent of machine speed.
    const publications = await readPublications(page);
    const resolutionAt = publications.findIndex((p) => p.authStateKnown);
    const injectionAt = publications.length - 1;
    expect(resolutionAt).toBeGreaterThanOrEqual(0);
    expect(resolutionAt).toBeLessThan(injectionAt);
    expect(publications[injectionAt].hasUser).toBe(true);

    // …and the header agrees: the injected visitor survived.
    await expect(page.locator('[data-testid="header-user-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="header-signin-btn"]')).toHaveCount(0);
  });

  test('a partial injection updates only the keys it names', async ({ page }) => {
    // A spec that changes ONLY the profile — the profile-fetch-resolves step
    // of the race window — must not lose the visitor. If the helper appended
    // `currentUser` unconditionally it would write `undefined` over a real
    // visitor, producing a state the page itself can never reach: the spec
    // would then be testing a fiction rather than the product.
    await page.goto('/roadmap.html');
    await injectAuthState(page, {
      currentUser: { uid: 'partial-1', displayName: 'PartialUser' },
      profile: null,
    });
    await injectAuthState(page, { profile: { uniqueId: 7, displayName: 'PartialUser' } });

    const after = await page.evaluate(() => {
      const auth = (window as unknown as { shytalkAuth?: { currentUser?: { uid?: string }; profile?: unknown } })
        .shytalkAuth;
      return { uid: auth?.currentUser?.uid ?? null, profile: auth?.profile ?? null };
    });
    expect(after).toEqual({ uid: 'partial-1', profile: { uniqueId: 7, displayName: 'PartialUser' } });
  });

  test('the injected visitor can produce an id token', async ({ page }) => {
    // `getIdToken` is a function, so it cannot cross into the page with the
    // rest of the state — the helper rebuilds it there. Page handlers call it
    // (three specs pass an explicit token for exactly that reason), and a
    // broken rebuild would surface as a confusing failure in whichever spec
    // happened to call it rather than here, where the contract lives.
    await page.goto('/roadmap.html');
    await injectAuthState(
      page,
      { currentUser: { uid: 'token-1', displayName: 'TokenUser' }, profile: null },
      { idToken: 'a-specific-token' },
    );

    const token = await page.evaluate(() => {
      const auth = (window as unknown as { shytalkAuth?: { currentUser?: { getIdToken?: () => Promise<string> } } })
        .shytalkAuth;
      return auth?.currentUser?.getIdToken?.() ?? null;
    });
    expect(token).toBe('a-specific-token');
  });

  test('the signed-out path publishes exactly one auth-changed event', async ({ page }) => {
    await page.goto('/roadmap.html');
    await waitForAuthStateKnown(page);

    // Publishing the new flag must not cost an EXTRA dispatch. Every
    // dispatch re-renders the shared header, and `render()` removes and
    // rebuilds it — so a second one would detach `header-user-info` mid-click
    // and re-introduce the very instability this story removes
    // ("element was detached from the DOM, retrying").
    const events = await page.evaluate(() => (window as unknown as { __authEvents: number }).__authEvents);
    expect(events).toBe(1);
  });

  test('a page without the auth module fails loudly instead of hanging', async ({ page }) => {
    // `404.html` carries the shared header but NOT `roadmap-auth.js`, so
    // `window.shytalkAuth` is never defined there. A spec that waits for a
    // signal which can never arrive must say so — a bare "waitForFunction
    // timed out" would send the next reader hunting through the page for a
    // race that isn't there.
    await page.goto('/404.html');
    // Read through the value, not `in window` — the recorder installed in
    // beforeEach defines the property, so an `in` check would pass while the
    // page still has no auth object at all.
    expect(
      await page.evaluate(() => (window as unknown as { shytalkAuth?: unknown }).shytalkAuth === undefined),
    ).toBe(true);

    await expect(waitForAuthStateKnown(page, 1_500)).rejects.toThrow(
      /window\.shytalkAuth is UNDEFINED \(page does not load roadmap-auth\.js\)/,
    );
  });
});
