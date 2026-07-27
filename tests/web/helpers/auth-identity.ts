import type { Page } from '@playwright/test';

/**
 * Publishes a signed-in identity that SURVIVES roadmap-auth.js's own bootstrap.
 *
 * `roadmap-auth.js` assigns `window.shytalkAuth` TWICE: the null-user
 * placeholder at script-eval (`:282`) and a whole NEW object from
 * `updateGlobalAuth()` (`:248`) once the Firebase config lands and
 * `onAuthStateChanged` fires — which it does in BOTH the signed-in and
 * signed-out branches (`:184` / `:189`), so it happens on every page load.
 *
 * A plain `window.shytalkAuth = {...}` injection landing between those two
 * assignments is silently REPLACED by the second one, leaving `currentUser`
 * null. The bell then opens the LOGIN modal and `subscribe-modal` never
 * exists; the shared header re-renders signed-out and restores the Sign In
 * button. Chromium finishes bootstrap before the test body runs, so these
 * passed there; WebKit in CI is slower, loses the race, and they failed there
 * and only there — reporting `element(s) not found`, which reads like a
 * product bug but is really the injection being clobbered.
 *
 * Re-applying the identity on every reassignment — the same late-binding
 * setter pattern the OAuth tests in `roadmap-auth.spec.ts` already use — makes
 * bootstrap ordering stop mattering instead of betting on it. Anchoring on a
 * rendered element first (as `Sign In button hidden when authenticated` did)
 * is NOT sufficient: that proves the header rendered once, not that
 * `updateGlobalAuth()` has already run, so a later one still clobbers.
 *
 * Callers that need the shared header to re-render must still dispatch
 * `shytalk-auth-changed` themselves — `shared-header.js:306` re-renders on the
 * event but reads live state via `getAuth()`, so a late dispatch from the app
 * re-renders correctly once the global is pinned.
 */
export async function publishAuthIdentity(
  page: Page,
  identity: { uid: string; displayName: string; profile: unknown; idToken?: string },
): Promise<void> {
  await page.evaluate((id) => {
    const token = id.idToken ?? 'fake';
    const apply = (target: any) => {
      if (!target) return target;
      target.currentUser = {
        uid: id.uid,
        displayName: id.displayName,
        getIdToken: () => Promise.resolve(token),
      };
      target.profile = id.profile;
      return target;
    };
    let auth = apply((window as any).shytalkAuth);
    const existing = Object.getOwnPropertyDescriptor(window, 'shytalkAuth');
    if (!existing || !existing.set) {
      Object.defineProperty(window, 'shytalkAuth', {
        get: () => auth,
        set: (next) => {
          auth = apply(next);
        },
        configurable: true,
      });
    }
  }, identity);
}
