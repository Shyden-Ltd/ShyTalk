import { Page, expect } from '@playwright/test';

const AUTH_EMULATOR = 'http://localhost:9099';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_API_KEY = process.env.TEST_API_KEY || 'local-test-key';

/**
 * The regular user `local/seed.js` seeds on every stack start. It has a real
 * `users/100000002` doc carrying `firebaseUid`, which is exactly what
 * `authMiddleware.resolveUniqueId()` queries on, so `/api/roadmap/me` returns
 * a real 200 profile for it. Use this for tests that only need "somebody is
 * signed in"; use `createRoadmapUser` when the test needs a specific profile
 * shape (an avatar, a distinctive display name) or its own isolated identity.
 */
export const SEEDED_ROADMAP_USER = {
  email: 'user@test.com',
  password: 'localdev123',
  displayName: 'Test User',
  uniqueId: 100000002,
};

export interface RoadmapTestUser {
  uid: string;
  uniqueId: number;
  email: string;
  password: string;
  displayName: string;
  avatarUrl?: string;
  testRunId: string;
}

/** Seed a doc through the REAL API's test-write route (no direct Firestore). */
export async function testWrite(collection: string, doc: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/test/write/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-API-Key': TEST_API_KEY },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    throw new Error(`test-write ${collection} failed: ${res.status} ${await res.text()}`);
  }
}

/** Best-effort sweep of everything tagged with a `_testRun` id. */
export async function teardownTestRun(testRunId: string): Promise<void> {
  await fetch(`${API_BASE}/api/test/teardown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-API-Key': TEST_API_KEY },
    body: JSON.stringify({ testRunId }),
  }).catch(() => {
    /* teardown is best-effort; a leaked test user cannot fail a later test */
  });
}

/**
 * Create a test user in the Firebase Auth emulator. Returns the UID.
 *
 * This uses the Auth emulator REST API directly — no SDK needed. It creates
 * ONLY the Firebase identity; pair it with a `users/{uniqueId}` doc (see
 * `createRoadmapUser`) if the API must be able to resolve a ShyTalk profile.
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
 * Create a REAL, fully-resolvable roadmap user: a Firebase Auth identity plus
 * the `users/{uniqueId}` doc that links back to it via `firebaseUid`.
 *
 * That link is the whole point — `authMiddleware.resolveUniqueId()` queries
 * `users.where('firebaseUid','==',uid)`, so without the doc every request from
 * this identity resolves to a null uniqueId and `/api/roadmap/me` answers 404
 * ("no ShyTalk account"), which renders the download prompt instead of the
 * signed-in UI. Same shape SHY-0149 established for the anti-abuse specs.
 *
 * Everything is tagged with `_testRun` so `teardownTestRun` can sweep it.
 */
export async function createRoadmapUser(opts: {
  prefix: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<RoadmapTestUser> {
  // `test_`-prefixed: /api/test/teardown only accepts run ids in that namespace.
  const stamp = `${opts.prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testRunId = `test_roadmap_${stamp}`;
  const email = `roadmap-${stamp}@shytalk.dev`;
  const password = 'testpass123';
  const displayName = opts.displayName ?? `Roadmap ${stamp}`;

  const { uid } = await createTestUser(email, password, displayName);
  const uniqueId = 930000000 + Math.floor(Math.random() * 9_999_999);

  await testWrite('users', {
    id: String(uniqueId),
    uniqueId,
    firebaseUid: uid,
    displayName,
    ...(opts.avatarUrl ? { avatarUrl: opts.avatarUrl } : {}),
    isSuspended: false,
    _testRun: testRunId,
  });

  return { uid, uniqueId, email, password, displayName, avatarUrl: opts.avatarUrl, testRunId };
}

/**
 * Seed a REAL public suggestion so the board has something to render.
 *
 * The local stack starts with zero suggestions, so every board-dependent
 * assertion (a card, a vote arrow, a comment box) has nothing to attach to —
 * which is exactly why those tests were wrapped in `if (count > 0)` guards and
 * silently ran nothing. The doc shape mirrors what `POST /api/suggestions`
 * writes (`routes/suggestions.js:475`); only `accepted`/`planned`/`completed`/
 * `rejected` are publicly listed, so `pending` will NOT appear on the board.
 *
 * Tagged `_testRun` so `teardownTestRun` removes it — without that the board
 * accumulates rows across runs and skews later count/sort assertions.
 */
export async function createSuggestion(opts: {
  testRunId: string;
  title: string;
  description?: string;
  status?: 'accepted' | 'planned' | 'completed' | 'rejected' | 'pending';
  submitterUid?: number;
  upvotes?: number;
  rejectReason?: string | null;
}): Promise<{ id: string; title: string }> {
  const id = `test-sug-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const now = Date.now();
  await testWrite('suggestions', {
    id,
    title: opts.title,
    description: opts.description ?? `${opts.title} — seeded by a web spec.`,
    tags: [],
    language: 'en',
    status: opts.status ?? 'accepted',
    rejectReason: opts.rejectReason ?? null,
    linkedRoadmapFeature: null,
    mergedIntoSuggestionId: null,
    disputePending: false,
    submitterUid: opts.submitterUid ?? SEEDED_ROADMAP_USER.uniqueId,
    submitterContactOptIn: false,
    upvotes: opts.upvotes ?? 1,
    downvotes: 0,
    createdAt: now,
    updatedAt: now,
    reviewedAt: now,
    reviewedBy: null,
    completedAt: null,
    editHistory: [],
    _testRun: opts.testRunId,
  });
  return { id, title: opts.title };
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

/**
 * Put the roadmap page into its REAL "signed in, but no ShyTalk account"
 * state: a Firebase identity with no `users/{uniqueId}` doc behind it, so
 * `/api/roadmap/me` genuinely answers 404.
 *
 * Deliberately NOT paired with `createRoadmapUser` — the whole point is the
 * missing profile.
 */
export async function signInWithoutShyTalkAccount(page: Page): Promise<{ email: string }> {
  const stamp = `noacct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `roadmap-${stamp}@shytalk.dev`;
  const password = 'testpass123';
  await createTestUser(email, password, `No Account ${stamp}`);
  await page.goto('/roadmap.html');
  await roadmapLogin(page, email, password);
  await expect(page.locator('[data-testid="auth-no-account"]')).toBeVisible({ timeout: 15_000 });
  return { email };
}

/**
 * Put the roadmap page into its REAL signed-in state and wait until the auth
 * container has actually rendered it.
 *
 * `roadmapLogin` returns as soon as `window.shytalkAuth.currentUser` is set,
 * but `roadmap-auth.js` publishes that synchronously and only THEN fetches
 * `/api/roadmap/me` (`:185`) — so the profile, and every element that depends
 * on it, lands strictly later. Waiting on the rendered `auth-user-info` is the
 * settled signal; returning earlier would make every caller race the fetch.
 */
export async function signInToRoadmap(
  page: Page,
  user: { email: string; password: string } = SEEDED_ROADMAP_USER,
  path: string = '/roadmap.html',
): Promise<void> {
  await page.goto(path);
  await roadmapLogin(page, user.email, user.password);
  await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });
}
