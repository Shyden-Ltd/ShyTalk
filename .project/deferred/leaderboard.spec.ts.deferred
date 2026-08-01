import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * SHY-0265 — the /leaderboard page.
 *
 * j05 has asserted this page since it was written and it did not exist, so the
 * scenario failed on every run and blamed the app. These tests pin the states
 * the page must distinguish, because collapsing any two of them is how a
 * leaderboard lies:
 *
 *   EMPTY   nobody in the cohort has gifted        — a fact about other users
 *   ERROR   the request failed                     — a fact about the request
 *   UNRANKED the caller has gifted nothing         — a fact about the caller
 *
 * Rendering an empty table on a failed request states the first when the truth
 * is the second, and gives the user no reason to retry.
 *
 * The API is stubbed at the network boundary — this is a test of the PAGE, and
 * the endpoint has its own real-emulator suite in
 * express-api/tests/routes/economy-leaderboards.test.js.
 */

/**
 * Keep the injected stubs in place.
 *
 * `addInitScript` runs before anything else, but the page then loads the real
 * Firebase SDK from gstatic and `/portal/config.js`, both of which overwrite the
 * globals the stub installed — so without blocking them the page falls straight
 * through to its signed-out state and every assertion below fails on a page that
 * is behaving correctly. Blocking them is what makes this a test of the PAGE
 * rather than of Firebase.
 */
async function isolatePage(page) {
  // Fulfilled EMPTY rather than aborted. An aborted script still lets the
  // browser continue, but Playwright's abort raced the SRI-checked load here
  // and the real SDK executed anyway — overwriting the stub and leaving the
  // page on its loading state. Serving an empty body is deterministic.
  await page.route(/gstatic\.com\/firebasejs\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  await page.route('**/portal/config.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
}

/** Sign-in is Firebase; the page's own behaviour is what is under test here. */
async function signedIn(page) {
  await isolatePage(page);
  await page.addInitScript(() => {
    // The page only needs `auth.currentUser.getIdToken()` and one
    // onAuthStateChanged callback, so a minimal stand-in exercises the real
    // rendering path without a live Firebase session.
    (window as unknown as Record<string, unknown>).firebase = {
      initializeApp() {},
      auth() {
        return {
          currentUser: { getIdToken: async () => 'test-token' },
          useEmulator() {},
          onAuthStateChanged(cb: (u: unknown) => void) {
            cb({ uid: 'u1' });
          },
        };
      },
    };
    (window as unknown as Record<string, unknown>).SHYTALK_CONFIG = {
      apiBase: '',
      firebase: {},
    };
  });
}

test.describe('/leaderboard', () => {
  test('renders rows in rank order and marks the caller', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/economy/leaderboards', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: [
            { uniqueId: '1', displayName: 'First', rank: 1, amount: 900, cohort: 'adult' },
            { uniqueId: '2', displayName: 'Me', rank: 2, amount: 600, cohort: 'adult' },
          ],
          me: { uniqueId: '2', displayName: 'Me', rank: 2, amount: 600, cohort: 'adult' },
        }),
      }),
    );
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-board')).toBeVisible();
    const names = await page.locator('#lb-rows tr td:nth-child(2)').allTextContents();
    expect(names).toEqual(['First', 'Me']);
    // The caller's own row is findable without reading every name.
    await expect(page.locator('#lb-rows tr.lb-row--me')).toHaveCount(1);
  });

  test('a FAILED request shows an error, never an empty board', async ({ page }) => {
    // The distinction that matters most: an empty table would say "nobody has
    // gifted", which is a claim about other users, and would give this user no
    // reason to try again.
    await signedIn(page);
    await page.route('**/api/economy/leaderboards', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-error')).toBeVisible();
    await expect(page.locator('#lb-board')).toBeHidden();
    await expect(page.locator('#lb-empty')).toBeHidden();
  });

  test('a suspended caller is told why, not shown a generic failure', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/economy/leaderboards', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-error')).toBeVisible();
    await expect(page.locator('#lb-error-detail')).toContainText('cannot view');
  });

  test('an EMPTY cohort is its own state, distinct from an error', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/economy/leaderboards', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: [],
          me: { uniqueId: '2', displayName: 'Me', rank: null, amount: 0, cohort: 'adult' },
        }),
      }),
    );
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-board')).toBeVisible();
    await expect(page.locator('#lb-empty')).toBeVisible();
    await expect(page.locator('#lb-error')).toBeHidden();
  });

  test('an UNRANKED caller sees a dash, not a zero', async ({ page }) => {
    // A rank of 0 sorts to the top of anything that treats it as a number, and
    // reads as "first". "—" says what is true: not on the board.
    await signedIn(page);
    await page.route('**/api/economy/leaderboards', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: [{ uniqueId: '1', displayName: 'First', rank: 1, amount: 900, cohort: 'adult' }],
          me: { uniqueId: '9', displayName: 'Me', rank: null, amount: 0, cohort: 'adult' },
        }),
      }),
    );
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-me')).toBeVisible();
    await expect(page.locator('#lb-me-rank')).toHaveText('—');
  });

  test('a display name is rendered as TEXT, never as markup', async ({ page }) => {
    // The page renders other people's names. `innerHTML` here would be stored
    // XSS with a user-controlled payload.
    await signedIn(page);
    await page.route('**/api/economy/leaderboards', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: [
            {
              uniqueId: '1',
              displayName: '<img src=x onerror=alert(1)>',
              rank: 1,
              amount: 5,
              cohort: 'adult',
            },
          ],
          me: null,
        }),
      }),
    );
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-rows tr td:nth-child(2)')).toHaveText(
      '<img src=x onerror=alert(1)>',
    );
    await expect(page.locator('#lb-rows img')).toHaveCount(0);
  });

  test('a broken Firebase config shows an error, never an endless spinner', async ({ page }) => {
    // `initializeApp` throws on a malformed config and the exception escaped
    // `init()`, leaving the page spinning with no error, no retry, and no way
    // to tell it from a slow network. A page that hangs is worse than one that
    // admits it failed.
    await isolatePage(page);
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).firebase = {
        initializeApp() {
          throw new Error('bad config');
        },
        auth() {
          return {};
        },
      };
      (window as unknown as Record<string, unknown>).SHYTALK_CONFIG = { apiBase: '', firebase: {} };
    });
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-error')).toBeVisible();
    await expect(page.locator('#lb-loading')).toBeHidden();
  });

  test('a signed-out visitor is offered sign-in, not an error', async ({ page }) => {
    await isolatePage(page);
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).firebase = {
        initializeApp() {},
        auth() {
          return {
            currentUser: null,
            useEmulator() {},
            onAuthStateChanged(cb: (u: unknown) => void) {
              cb(null);
            },
          };
        },
      };
      (window as unknown as Record<string, unknown>).SHYTALK_CONFIG = { apiBase: '', firebase: {} };
    });
    await page.goto(`${BASE}/leaderboard/`);
    await expect(page.locator('#lb-signin')).toBeVisible();
  });
});
