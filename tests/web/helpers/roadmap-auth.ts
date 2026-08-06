import { Page, expect } from '@playwright/test';

const AUTH_EMULATOR = 'http://localhost:9099';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

/** Shape of the parts of `window.shytalkAuth` the web specs read or set. */
export interface ShytalkAuthState {
  currentUser?: {
    uid: string;
    displayName?: string | null;
    photoURL?: string | null;
    getIdToken?: () => Promise<string>;
  } | null;
  /** An object is a fetched profile; `null` is "still loading"; `false` is "no ShyTalk account". */
  profile?: Record<string, unknown> | null | false;
  authStateKnown?: boolean;
}

/**
 * Resolve once the page has finished its OWN Firebase sign-in check.
 *
 * Until that happens, `roadmap-auth.js` still owns `window.shytalkAuth` and
 * will REPLACE it wholesale the moment `onAuthStateChanged` fires — erasing
 * anything a spec assigned and re-rendering the shared header from scratch.
 * A spec that injects before this point is decided by a race it cannot see:
 * measured 2026-08-05 on the same page, Chromium resolved at 505 ms and won,
 * WebKit resolved at 594 ms against an injection at 415 ms and lost (SHY-0279).
 *
 * `authStateKnown` is the page's own "the check has finished" flag, published
 * on every path that reaches a verdict — including the config-never-loaded
 * fallback — so this wait cannot strand a spec.
 */
export async function waitForAuthStateKnown(page: Page, timeout = 15_000): Promise<void> {
  try {
    await page.waitForFunction(
      () => (window as unknown as { shytalkAuth?: ShytalkAuthState }).shytalkAuth?.authStateKnown === true,
      undefined,
      { timeout },
    );
  } catch (cause) {
    // A bare "waitForFunction timed out" sends the reader hunting. The usual
    // reason is a page that never loads `roadmap-auth.js` at all — `404.html`
    // and `index.html` carry the shared header WITHOUT the auth module, so
    // `window.shytalkAuth` is permanently undefined there and no amount of
    // waiting will help.
    const present = await page.evaluate(() => {
      const auth = (window as unknown as { shytalkAuth?: ShytalkAuthState }).shytalkAuth;
      return { defined: auth !== undefined, authStateKnown: auth?.authStateKnown ?? null };
    });
    throw new Error(
      `waitForAuthStateKnown timed out after ${timeout}ms on ${page.url()} — ` +
        `window.shytalkAuth ${present.defined ? `exists with authStateKnown=${present.authStateKnown}` : 'is UNDEFINED (page does not load roadmap-auth.js)'}. ` +
        `Only pages that load roadmap-auth.js can report sign-in state (SHY-0279).`,
      { cause },
    );
  }
}

/**
 * Present the page with a signed-in visitor, AFTER the page's own sign-in
 * check has settled so nothing can overwrite it.
 *
 * This is the only sanctioned way for a spec to assign `window.shytalkAuth`;
 * `auth-injection-discipline.spec.ts` fails any spec that assigns it directly,
 * because such a spec is racing the page (SHY-0279).
 */
export async function injectAuthState(
  page: Page,
  state: ShytalkAuthState,
  options: { dispatch?: boolean; idToken?: string } = {},
): Promise<void> {
  await waitForAuthStateKnown(page);
  const dispatch = options.dispatch !== false;
  const idToken = options.idToken ?? 'fake';
  await page.evaluate(
    ({ next, shouldDispatch, token }) => {
      const w = window as unknown as { shytalkAuth?: ShytalkAuthState };
      const merged: ShytalkAuthState = { ...w.shytalkAuth, ...next };
      // `getIdToken` has to be rebuilt in the page: a function cannot survive
      // the structured clone that carries `next` across from the test process.
      // Handlers on the roadmap page call it, so a visitor without one is not
      // the state the page would ever really see.
      //
      // Rebuilt on `merged`, never appended as a trailing property: writing
      // `{ ...next, currentUser }` would set the key even when the caller
      // never mentioned it, silently wiping an existing visitor with
      // `undefined` — a state the page can never produce for itself.
      if (merged.currentUser) {
        merged.currentUser = { ...merged.currentUser, getIdToken: () => Promise.resolve(token) };
      }
      w.shytalkAuth = merged;
      const currentUser = merged.currentUser ?? null;
      if (shouldDispatch) {
        document.dispatchEvent(
          new CustomEvent('shytalk-auth-changed', {
            detail: { user: currentUser ?? null, profile: next.profile ?? null },
          }),
        );
      }
    },
    { next: state, shouldDispatch: dispatch, token: idToken },
  );
}

/**
 * Create a test user in the Firebase Auth emulator and ensure they have a
 * ShyTalk profile in Firestore. Returns the UID of the created user.
 *
 * This uses the Auth emulator REST API directly — no SDK needed.
 */
export async function createTestUser(
  email: string = 'roadmap-test@shytalk.dev',
  password: string = 'testpass123',
  displayName: string = 'RoadmapTester',
): Promise<{ uid: string; email: string; password: string; displayName: string }> {
  // Create user in Auth emulator via REST
  const signUpRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    },
  );

  if (!signUpRes.ok) {
    // User may already exist — try sign-in instead
    const signInRes = await fetch(
      `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    if (!signInRes.ok) {
      throw new Error(`Failed to create or sign in test user: ${await signInRes.text()}`);
    }
    const signInData = await signInRes.json();
    return { uid: signInData.localId, email, password, displayName };
  }

  const signUpData = await signUpRes.json();
  return { uid: signUpData.localId, email, password, displayName };
}

/**
 * Ensure the test user has a ShyTalk profile in Firestore (via Express API).
 * This makes /api/roadmap/me return a valid profile instead of 404.
 */
export async function ensureShyTalkProfile(
  uid: string,
  displayName: string = 'RoadmapTester',
): Promise<void> {
  const testApiKey = process.env.TEST_API_KEY || 'local-test-key';

  // Check if user already exists
  const checkRes = await fetch(`${API_BASE}/api/test/ensure-roadmap-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-API-Key': testApiKey,
    },
    body: JSON.stringify({ uid, displayName }),
  });

  // Endpoint may not exist yet — that's ok for initial testing
  if (!checkRes.ok && checkRes.status !== 404) {
    console.warn(`ensure-roadmap-user returned ${checkRes.status}`);
  }
}

/**
 * Sign into the roadmap page using Firebase Auth email/password.
 * Requires the local environment (Auth emulator) to be running.
 */
export async function roadmapLogin(
  page: Page,
  email: string = 'roadmap-test@shytalk.dev',
  password: string = 'testpass123',
): Promise<void> {
  // Wait for Firebase to initialize and shytalkAuth to be available
  await page.waitForFunction(
    () => (window as any).shytalkAuth && (window as any).shytalkAuth.signInWithEmail,
    { timeout: 15_000 },
  );

  // Sign in programmatically via the exposed signInWithEmail function
  const result = await page.evaluate(
    async ({ email, password }) => {
      try {
        await (window as any).shytalkAuth.signInWithEmail(email, password);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    },
    { email, password },
  );

  if (!result.success) {
    throw new Error(`Roadmap login failed: ${result.error}`);
  }

  // Wait for auth state to propagate and UI to update
  await page.waitForFunction(
    () => (window as any).shytalkAuth && (window as any).shytalkAuth.currentUser,
    { timeout: 10_000 },
  );
}

/**
 * Navigate to roadmap page and sign in. Combines goto + login.
 */
export async function gotoRoadmapLoggedIn(
  page: Page,
  email: string = 'roadmap-test@shytalk.dev',
  password: string = 'testpass123',
): Promise<void> {
  await page.goto('/roadmap.html');
  await roadmapLogin(page, email, password);
}
