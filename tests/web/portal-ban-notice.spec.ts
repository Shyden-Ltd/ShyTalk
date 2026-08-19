import { test, expect, Page } from '@playwright/test';
import { createTestUser } from './helpers/roadmap-auth';

/**
 * The portal must TELL a banned person they are banned (SHY-0149).
 *
 * The server's ban gate refuses `GET /api/portal/me` with
 * `403 { code: 'banned', reason, expiresAt }`. Before this story `/portal/me`
 * was ban-exempt, so a banned user saw a normal dashboard; once it was gated,
 * `portal.js`'s "other 403" branch signed them out **silently, with no
 * explanation at all**. Neither is acceptable — this spec pins the third
 * behaviour: the ban screen, with its reason.
 *
 * Everything here is real: a real Auth-emulator user, a real `deviceBans`
 * document seeded through the real API, a real sign-in through the portal's
 * own form. No route interception — a mocked 403 would prove nothing about
 * the gate.
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_API_KEY = process.env.TEST_API_KEY || 'local-test-key';
const BAN_REASON = 'SHY-0149 portal ban notice';
// The ban reason is admin-authored and rendered into the ban screen.
const XSS_REASON = '<img src=x id="portal-xss-probe" onerror="window.__xss=1">';

async function testWrite(collection: string, doc: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/test/write/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-API-Key': TEST_API_KEY },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`test-write ${collection}: ${res.status} ${await res.text()}`);
}

/** A real, banned account, signed in through the portal's own login form. */
async function signInBannedPortalUser(
  page: Page,
  expiresAt: string | null,
  reason: string = BAN_REASON,
) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testRunId = `test_shy0149_portal_${stamp}`;
  const email = `shy0149-portal-${stamp}@shytalk.dev`;
  const password = 'testpass123';
  const { uid } = await createTestUser(email, password, `Portal ${stamp}`);
  const uniqueId = 950000000 + Math.floor(Math.random() * 9_999_999);

  await testWrite('users', {
    id: String(uniqueId),
    uniqueId,
    firebaseUid: uid,
    displayName: `Portal ${stamp}`,
    isSuspended: false,
    _testRun: testRunId,
  });
  await testWrite('deviceBans', {
    id: `portal-ban-${stamp}`,
    deviceId: `portal-ban-${stamp}`,
    reason,
    duration: expiresAt ? '24h' : 'permanent',
    expiresAt,
    linkedUniqueId: String(uniqueId),
    _testRun: testRunId,
  });

  await page.goto('/portal/');
  await page.waitForFunction(() => !!document.querySelector('#login-form'), { timeout: 15_000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');
  return { testRunId };
}

async function teardown(testRunId: string) {
  await fetch(`${API_BASE}/api/test/teardown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-API-Key': TEST_API_KEY },
    body: JSON.stringify({ testRunId }),
  }).catch(() => {
    /* best-effort */
  });
}

test.describe('Portal — a banned user is told they are banned', () => {
  test('a permanent ban shows the ban screen with its reason, not a silent sign-out', async ({
    page,
  }) => {
    const { testRunId } = await signInBannedPortalUser(page, null);

    const banned = page.locator('#banned-section');
    await expect(banned).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#banned-reason')).toHaveText(BAN_REASON);
    // Permanent ban → no end date offered.
    await expect(page.locator('#banned-end-date')).toBeHidden();
    // …and they were NOT dumped back on the login form.
    await expect(page.locator('#login-section')).toBeHidden();

    await teardown(testRunId);
  });

  test('a temporary ban shows when it ends', async ({ page }) => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const { testRunId } = await signInBannedPortalUser(page, expiresAt);

    await expect(page.locator('#banned-section')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#banned-end-date')).toBeVisible();
    await expect(page.locator('#banned-end-value')).not.toBeEmpty();

    await teardown(testRunId);
  });

  test('a banned user keeps the affordances a ban must never remove: appeal, contact, sign out', async ({
    page,
  }) => {
    const { testRunId } = await signInBannedPortalUser(page, null);
    await expect(page.locator('#banned-section')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('#banned-appeal-btn')).toBeVisible();
    await expect(page.locator('#banned-contact-link')).toBeVisible();
    await expect(page.locator('#banned-signout-btn')).toBeVisible();

    await teardown(testRunId);
  });

  test('the appeal button explains how to appeal THE BAN (not the suspension copy)', async ({
    page,
  }) => {
    const { testRunId } = await signInBannedPortalUser(page, null);
    await expect(page.locator('#banned-section')).toBeVisible({ timeout: 20_000 });

    await page.click('#banned-appeal-btn');
    // showMessageModal() unhides #message-modal and fills its title/body.
    await expect(page.locator('#message-modal')).not.toHaveAttribute('hidden', /.*/);
    await expect(page.locator('#message-modal-body')).toContainText(/appeal your ban/i);

    await teardown(testRunId);
  });

  test('the sign-out button really signs the banned user out', async ({ page }) => {
    const { testRunId } = await signInBannedPortalUser(page, null);
    await expect(page.locator('#banned-section')).toBeVisible({ timeout: 20_000 });

    await page.click('#banned-signout-btn');

    // Back to the login form, and no longer authenticated.
    await expect(page.locator('#login-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#banned-section')).toBeHidden();

    await teardown(testRunId);
  });

  test('a hostile ban reason renders as inert text, never as markup', async ({ page }) => {
    const { testRunId } = await signInBannedPortalUser(page, null, XSS_REASON);
    const reason = page.locator('#banned-reason');
    await expect(reason).toBeVisible({ timeout: 20_000 });

    await expect(reason).toHaveText(XSS_REASON); // survives as literal text…
    expect(await page.locator('#portal-xss-probe').count()).toBe(0); // …injects nothing
    expect(await reason.locator('img').count()).toBe(0);

    await teardown(testRunId);
  });

  test('a broken locale tag degrades gracefully instead of crashing the ban screen', async ({
    page,
  }) => {
    // `toLocaleDateString('!!bad!!')` throws RangeError. `renderBan` keeps a
    // try/catch for exactly this, and nothing exercised it (reviewer R8-I4).
    //
    // The reachable path is the DEGRADED one: `getCurrentLang()` validates
    // through `ShyTalkLanguage.get()` when language-selector.js loads, and only
    // falls back to the raw `localStorage` value when it does not. Simulate
    // that script failing to load — an environment failure, not a mock of the
    // code under test — and plant an unusable tag.
    await page.addInitScript(() => {
      window.localStorage.setItem('shytalk_language', '!!bad!!');
      Object.defineProperty(window, 'ShyTalkLanguage', {
        get: () => undefined,
        set: () => {},
        configurable: false,
      });
    });
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const { testRunId } = await signInBannedPortalUser(page, expiresAt);

    await expect(page.locator('#banned-section')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#banned-reason')).toHaveText(BAN_REASON);
    await expect(page.locator('#banned-end-date')).toBeHidden();

    await teardown(testRunId);
  });

  test('a malformed expiry shows no end date rather than the words "Invalid Date"', async ({
    page,
  }) => {
    const { testRunId } = await signInBannedPortalUser(page, 'not-a-real-date');
    await expect(page.locator('#banned-section')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('#banned-end-date')).toBeHidden();
    await expect(page.locator('#banned-section')).not.toContainText('Invalid Date');

    await teardown(testRunId);
  });
});
