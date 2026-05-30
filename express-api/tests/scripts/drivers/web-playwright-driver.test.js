/**
 * web-playwright-driver.js — driver-method unit tests
 *
 * First web-driver test file. Bootstraps the Playwright mock so that
 * createWebDriver() returns without a real browser launch, then pins
 * each method's interaction with the mocked Page surface.
 *
 * Pattern (for future web-driver PRs to mirror):
 *   - jest.mock('playwright') with the minimal stub the driver needs
 *     (chromium.launch returning a browser whose newContext returns a
 *     context whose newPage returns a Page).
 *   - Inject per-test Page behaviour via the `prepareMockPages` helper.
 *   - Build the driver via `await createWebDriver()` — uses the mock.
 *
 * Tests run on CI Linux (no Chromium installed) — playwright is mocked
 * end-to-end, no browser process ever spawns.
 */

// jest.mock factory may only reference in-scope built-ins. We can mutate
// the returned object after require, so the factory itself is minimal +
// the per-test state lives on the module instance via jest.fn handles.
//
// `virtual: true` so the mock works even when `playwright` isn't a
// resolvable module in the current Node modules tree. The express-api
// test-backend CI job doesn't install Playwright (it's a heavy browser
// dep used only by the local manual-qa-runner path), so without virtual
// jest's factory resolution throws "Cannot find module 'playwright'"
// before the mock can take effect. Verified locally: with `virtual: true`
// the test runs identically whether playwright is installed or not.
jest.mock(
  'playwright',
  () => {
    return {
      chromium: {
        launch: jest.fn(),
      },
    };
  },
  { virtual: true },
);

const playwright = require('playwright');
const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { createWebDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/web-playwright-driver'),
);

// Helpers ─────────────────────────────────────────────────────────────

function makeMockPage(overrides = {}) {
  return {
    goto: jest.fn(async (_url, _opts) => {
      if (overrides.gotoFails) throw new Error(overrides.gotoFails);
      return null;
    }),
    locator: jest.fn(() => ({
      click: jest.fn(),
      waitFor: jest.fn(),
    })),
    waitForLoadState: jest.fn(),
    close: jest.fn(),
    context: () => ({ close: jest.fn() }),
  };
}

/**
 * Prime the playwright mock so the driver's pageFor(name) returns the
 * supplied per-persona Page (in the order createWebDriver() asks).
 * `pagesByPersona` is a map { Alice: pageA, Tariq: pageT, ... } — keys
 * order matches the order of pageFor() invocations.
 */
function prepareMockPages(pagesByPersona) {
  const orderedPages = Object.values(pagesByPersona);
  let pageIdx = 0;
  playwright.chromium.launch.mockImplementation(async () => ({
    newContext: jest.fn(async () => ({
      newPage: jest.fn(async () => {
        const p = orderedPages[pageIdx] ?? makeMockPage();
        pageIdx += 1;
        return p;
      }),
      close: jest.fn(),
    })),
    close: jest.fn(),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('web-playwright-driver — createWebDriver', () => {
  test('returns a driver object with the expected methods', async () => {
    prepareMockPages({});
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.close).toBe('function');
  });
});

describe('web-playwright-driver — webRefreshRoomsList', () => {
  // j09 step: "Alice on Web refreshes the rooms list" — driver
  // navigates the persona's tab to /rooms. The persona-scoped Page
  // is obtained via pageFor(name) so multi-actor scenarios (paired
  // sessions, multi-persona webs) preserve isolation.

  test("navigates the persona's page to <baseURL>/rooms", async () => {
    const alicePage = makeMockPage();
    prepareMockPages({ Alice: alicePage });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
    expect(alicePage.goto).toHaveBeenCalledTimes(1);
    expect(alicePage.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('trailing slash on baseURL is collapsed (no `//rooms`)', async () => {
    const alicePage = makeMockPage();
    prepareMockPages({ Alice: alicePage });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888/' });
    await driver.webRefreshRoomsList('Alice');
    expect(alicePage.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('uses dev baseURL when provided', async () => {
    const alicePage = makeMockPage();
    prepareMockPages({ Alice: alicePage });
    const driver = await createWebDriver({ baseURL: 'https://dev.shytalk.shyden.co.uk' });
    await driver.webRefreshRoomsList('Alice');
    expect(alicePage.goto).toHaveBeenCalledWith('https://dev.shytalk.shyden.co.uk/rooms');
  });

  test('subsequent calls reuse the same Page (pageFor cache)', async () => {
    const alicePage = makeMockPage();
    prepareMockPages({ Alice: alicePage });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Alice');
    expect(alicePage.goto).toHaveBeenCalledTimes(2);
  });

  test('different personas get separate Pages (isolation)', async () => {
    const alicePage = makeMockPage();
    const tariqPage = makeMockPage();
    prepareMockPages({ Alice: alicePage, Tariq: tariqPage });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Tariq');
    expect(alicePage.goto).toHaveBeenCalledTimes(1);
    expect(tariqPage.goto).toHaveBeenCalledTimes(1);
  });

  test('page.goto throws → returns false (no unhandled rejection)', async () => {
    const failingPage = makeMockPage({ gotoFails: 'NS_ERROR_OFFLINE' });
    prepareMockPages({ Alice: failingPage });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
  });
});
