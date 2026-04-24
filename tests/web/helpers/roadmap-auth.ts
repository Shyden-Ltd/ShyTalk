import { Page, expect } from '@playwright/test';

const AUTH_EMULATOR = 'http://localhost:9099';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

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
