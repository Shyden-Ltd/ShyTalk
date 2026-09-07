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
      // Mock all four BrowserTypes the driver dispatches on. Local-matrix
      // policy requires chromium / firefox / webkit / edge — edge reuses
      // chromium with the `channel: 'msedge'` launch option.
      chromium: {
        launch: jest.fn(),
      },
      firefox: {
        launch: jest.fn(),
      },
      webkit: {
        launch: jest.fn(),
      },
    };
  },
  { virtual: true },
);

const playwright = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { createWebDriver, listMethods } = require(
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
 *
 * Applies the same mock factory to every BrowserType (chromium,
 * firefox, webkit) so cross-browser tests don't have to re-prime.
 * Edge reuses the chromium mock (edge launch goes through
 * pw.chromium.launch with channel: 'msedge').
 */
function prepareMockPages(pagesByPersona) {
  const orderedPages = Object.values(pagesByPersona);
  let pageIdx = 0;
  // `newContext` is hoisted out of the browser factory so tests can assert
  // on the options the driver passes to it. Before SHY-0529 it was created
  // inline, so no handle escaped and the context options were unobservable
  // — which is precisely why a missing `httpCredentials` survived every
  // unit test here and only surfaced as 0 passed / 559 failed on dev.
  const newContext = jest.fn(async () => ({
    newPage: jest.fn(async () => {
      const p = orderedPages[pageIdx] ?? makeMockPage();
      pageIdx += 1;
      return p;
    }),
    close: jest.fn(),
  }));
  const browserMock = jest.fn(async () => ({
    newContext,
    close: jest.fn(),
  }));
  playwright.chromium.launch.mockImplementation(browserMock);
  playwright.firefox.launch.mockImplementation(browserMock);
  playwright.webkit.launch.mockImplementation(browserMock);
  return { newContext, browserMock };
}

/**
 * Stand-in for the Basic-auth wall's password. The mocked browser never
 * authenticates with it, so it is a fixture rather than a credential — which is
 * also why it needs no sonarjs/no-hardcoded-passwords suppression.
 */
const TEST_DEV_WALL_FIXTURE = 'not-a-real-secret-test-fixture';

/**
 * Runs `fn` with DEV_BASIC_AUTH_PASSWORD set, restoring the previous value
 * afterwards even if `fn` throws. Walled targets refuse to construct without
 * it (SHY-0529), so any test using a dev/preview baseURL must go through here.
 */
async function withDevPassword(fn) {
  const original = process.env.DEV_BASIC_AUTH_PASSWORD;
  process.env.DEV_BASIC_AUTH_PASSWORD = TEST_DEV_WALL_FIXTURE;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.DEV_BASIC_AUTH_PASSWORD;
    else process.env.DEV_BASIC_AUTH_PASSWORD = original;
  }
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

  test('default browser is chromium (back-compat with existing dispatches)', async () => {
    prepareMockPages({});
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
    expect(driver._browserName).toBe('chromium');
    expect(playwright.chromium.launch).toHaveBeenCalledTimes(1);
    expect(playwright.firefox.launch).not.toHaveBeenCalled();
    expect(playwright.webkit.launch).not.toHaveBeenCalled();
  });

  test('browser="firefox" launches Playwright Firefox', async () => {
    prepareMockPages({});
    const driver = await createWebDriver({
      baseURL: 'http://localhost:8888',
      browser: 'firefox',
    });
    expect(driver._browserName).toBe('firefox');
    expect(playwright.firefox.launch).toHaveBeenCalledTimes(1);
    expect(playwright.chromium.launch).not.toHaveBeenCalled();
    expect(playwright.webkit.launch).not.toHaveBeenCalled();
  });

  test('browser="webkit" launches Playwright WebKit (Safari engine on Mac)', async () => {
    prepareMockPages({});
    const driver = await createWebDriver({
      baseURL: 'http://localhost:8888',
      browser: 'webkit',
    });
    expect(driver._browserName).toBe('webkit');
    expect(playwright.webkit.launch).toHaveBeenCalledTimes(1);
    expect(playwright.chromium.launch).not.toHaveBeenCalled();
    expect(playwright.firefox.launch).not.toHaveBeenCalled();
  });

  test('browser="edge" launches Chromium with channel="msedge"', async () => {
    prepareMockPages({});
    const driver = await createWebDriver({
      baseURL: 'http://localhost:8888',
      browser: 'edge',
    });
    expect(driver._browserName).toBe('edge');
    // Edge uses the Chromium engine with the msedge channel — Playwright
    // doesn't have a separate edge BrowserType.
    expect(playwright.chromium.launch).toHaveBeenCalledTimes(1);
    const callOpts = playwright.chromium.launch.mock.calls[0][0];
    expect(callOpts.channel).toBe('msedge');
  });

  test('browser="ie" → throws actionable error naming the supported set', async () => {
    prepareMockPages({});
    await expect(
      createWebDriver({ baseURL: 'http://localhost:8888', browser: 'ie' }),
    ).rejects.toThrow(/Unknown browser "ie"/);
    await expect(
      createWebDriver({ baseURL: 'http://localhost:8888', browser: 'ie' }),
    ).rejects.toThrow(/chromium, firefox, webkit, edge/);
  });

  test('browser="mobile-chrome" → throws with hint that mobile browsers ship via separate drivers', async () => {
    prepareMockPages({});
    await expect(
      createWebDriver({ baseURL: 'http://localhost:8888', browser: 'mobile-chrome' }),
    ).rejects.toThrow(/mobile-chrome-cdp-driver/);
  });

  test('SUPPORTED_BROWSERS export matches the launcher registry', () => {
    const { SUPPORTED_BROWSERS } = require(
      path.join(REPO_ROOT, 'express-api/scripts/drivers/web-playwright-driver'),
    );
    expect(SUPPORTED_BROWSERS).toEqual(['chromium', 'firefox', 'webkit', 'edge']);
  });

  test('headless: false propagates to the browser launch', async () => {
    prepareMockPages({});
    await createWebDriver({
      baseURL: 'http://localhost:8888',
      browser: 'firefox',
      headless: false,
    });
    const callOpts = playwright.firefox.launch.mock.calls[0][0];
    expect(callOpts.headless).toBe(false);
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
    // dev sits behind the Basic-auth wall, so the driver now refuses to
    // construct without the password (SHY-0529).
    const driver = await withDevPassword(() =>
      createWebDriver({ baseURL: 'https://dev.shytalk.shyden.co.uk' }),
    );
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

// takeScreenshot — behavioral delegation (gap C3, reviewer I2) ────────
//
// Distinct from the static source-text pin in
// driver-screenshot-delegation.test.js — this test exercises the actual
// runtime wiring by spying on the helper module and asserting the
// driver's inline `require('./driver-screenshot-helper')` call
// delegates with the closure-captured `pages` Map (not a fresh empty
// Map or a stale reference).

describe('web-playwright-driver — takeScreenshot delegation', () => {
  const helperPath = path.join(REPO_ROOT, 'express-api/scripts/drivers/driver-screenshot-helper');
  const helper = require(helperPath);

  test('routes to takeScreenshotForPages with the populated pages Map + slug + outputDir', async () => {
    const spy = jest
      .spyOn(helper, 'takeScreenshotForPages')
      .mockResolvedValue(['/mock/png-1.png', '/mock/png-2.png']);
    try {
      prepareMockPages({ Alice: makeMockPage(), Bob: makeMockPage() });
      const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
      // Populate the pages Map by exercising pageFor() through the
      // driver's public API. Drives the closure's `pages` variable.
      await driver.webRefreshRoomsList('Alice');
      await driver.webRefreshRoomsList('Bob');

      const result = await driver.takeScreenshot('/tmp/report-dir');

      expect(spy).toHaveBeenCalledTimes(1);
      const [pagesArg, outputDirArg, slugArg] = spy.mock.calls[0];
      expect(outputDirArg).toBe('/tmp/report-dir');
      expect(slugArg).toBe('chromium');
      // CRITICAL: pagesArg must be the SAME Map instance that
      // pageFor() populated. A regression that passes a fresh Map
      // would silently produce 0 screenshots — this assertion catches it.
      expect(pagesArg instanceof Map).toBe(true);
      expect(pagesArg.size).toBe(2);
      expect(pagesArg.has('Alice')).toBe(true);
      expect(pagesArg.has('Bob')).toBe(true);
      expect(result).toEqual(['/mock/png-1.png', '/mock/png-2.png']);
    } finally {
      spy.mockRestore();
    }
  });

  test('slug reflects the configured browser (firefox path)', async () => {
    const spy = jest.spyOn(helper, 'takeScreenshotForPages').mockResolvedValue([]);
    try {
      prepareMockPages({ Alice: makeMockPage() });
      const driver = await createWebDriver({
        baseURL: 'http://localhost:8888',
        browser: 'firefox',
      });
      await driver.webRefreshRoomsList('Alice');
      await driver.takeScreenshot('/tmp/out');
      expect(spy.mock.calls[0][2]).toBe('firefox');
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * The local persona credential, DERIVED from 20-reseed.sh rather than written
 * here. Two reasons: a literal would drift the day the seeder changes (the exact
 * failure SHY-0328 is about), and hard-coding one trips
 * sonarjs/no-hardcoded-passwords — correctly, since this really is a credential.
 */
const LOCAL_PERSONA_CREDENTIAL = (() => {
  const reseed = fs.readFileSync(
    path.join(REPO_ROOT, 'express-api/scripts/gauntlet/20-reseed.sh'),
    'utf8',
  );
  const m = reseed.match(/^\s*&&\s*NODE_PATH=\S+\s+PERSONAS_PASSWORD=(\S+)/m);
  if (!m) throw new Error('could not derive the local persona credential from 20-reseed.sh');
  return m[1];
})();

describe('web-playwright-driver — webSignIn (SHY-0328)', () => {
  // The step "<Name> on Web signs in with valid credentials" had NO
  // implementation on any web driver, and `webSignIn` was not even in
  // WEB_METHOD_NAMES — so the runner saw `undefined` and returned
  // "ctx.webDriver.webSignIn not configured". Every journey needing an
  // authenticated browser died at its first gate, visible only as `UID: —` in
  // the preview watermark.

  const SAVED_PW = process.env.PERSONAS_PASSWORD;
  afterEach(() => {
    if (SAVED_PW === undefined) delete process.env.PERSONAS_PASSWORD;
    else process.env.PERSONAS_PASSWORD = SAVED_PW;
  });

  function signInPage(overrides = {}) {
    return makeMockPage({
      ...overrides,
      ...{},
    });
  }

  test('webSignIn is a KNOWN method (it was absent from the list entirely)', () => {
    expect(listMethods()).toContain('webSignIn');
  });

  test('signs the persona in via the page-exposed Firebase helper', async () => {
    process.env.PERSONAS_PASSWORD = LOCAL_PERSONA_CREDENTIAL;
    const page = signInPage();
    page.waitForFunction = jest.fn(async () => true);
    page.evaluate = jest.fn(async () => ({ ok: true }));
    prepareMockPages({ Alice: page });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });

    const ok = await driver.webSignIn('Alice');

    expect(ok).toBe(true);
    // Lands on a page that actually exposes window.shytalkAuth.
    expect(page.goto).toHaveBeenCalledWith('http://localhost:8888/roadmap.html');
    // The persona's REAL email, resolved from the registry — not the label.
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      email: 'adult-power@shytalk.dev',
      secret: LOCAL_PERSONA_CREDENTIAL,
    });
  });

  test('waits for a real currentUser, not merely for sign-in to resolve', async () => {
    // signInWithEmail resolving is not the same as the page having an
    // authenticated user to act on, which is the whole point of the step.
    process.env.PERSONAS_PASSWORD = LOCAL_PERSONA_CREDENTIAL;
    const page = signInPage();
    const waited = [];
    page.waitForFunction = jest.fn(async (fn) => {
      waited.push(String(fn));
      return true;
    });
    page.evaluate = jest.fn(async () => ({ ok: true }));
    prepareMockPages({ Alice: page });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });

    await driver.webSignIn('Alice');

    expect(waited.some((f) => f.includes('signInWithEmail'))).toBe(true);
    expect(waited.some((f) => f.includes('currentUser'))).toBe(true);
  });

  test('returns FALSE when the persona is not in the registry', async () => {
    process.env.PERSONAS_PASSWORD = LOCAL_PERSONA_CREDENTIAL;
    const page = signInPage();
    prepareMockPages({ Nobody: page });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });

    expect(await driver.webSignIn('Nobody')).toBe(false);
    // Refused before touching the browser at all.
    expect(page.goto).not.toHaveBeenCalled();
  });

  test('returns FALSE when PERSONAS_PASSWORD is unset, rather than signing in blank', async () => {
    delete process.env.PERSONAS_PASSWORD;
    const page = signInPage();
    prepareMockPages({ Alice: page });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });

    expect(await driver.webSignIn('Alice')).toBe(false);
    expect(page.goto).not.toHaveBeenCalled();
  });

  test('returns FALSE when Firebase rejects the credentials', async () => {
    process.env.PERSONAS_PASSWORD = LOCAL_PERSONA_CREDENTIAL;
    const page = signInPage();
    page.waitForFunction = jest.fn(async () => true);
    page.evaluate = jest.fn(async () => ({ ok: false, error: 'INVALID_PASSWORD' }));
    prepareMockPages({ Alice: page });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });

    expect(await driver.webSignIn('Alice')).toBe(false);
  });

  test('resolves a persona by its P-id as well as its first name', async () => {
    process.env.PERSONAS_PASSWORD = LOCAL_PERSONA_CREDENTIAL;
    const page = signInPage();
    page.waitForFunction = jest.fn(async () => true);
    page.evaluate = jest.fn(async () => ({ ok: true }));
    prepareMockPages({ 'P-02': page });
    const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });

    expect(await driver.webSignIn('P-02')).toBe(true);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      email: 'adult-power@shytalk.dev',
      secret: LOCAL_PERSONA_CREDENTIAL,
    });
  });
});

// ---------------------------------------------------------------------------
// SHY-0529 — the Basic-auth wall on non-prod web targets
//
// Every ShyTalk web host except the live site and localhost sits behind the
// Cloudflare Pages HTTP Basic wall (functions/_lib/lockdown.js). The driver
// created its contexts without credentials, so on dev every page.goto()
// returned 401 and matrix run 20260906-184009-dev scored 0/559.
//
// Credentials are derived from the baseURL rather than passed in, because the
// wall is a property of the TARGET, not of any one driver: manual-qa-runner.js
// builds five web drivers and every future browser cell would otherwise have to
// remember to pass a credentials argument. These tests pin both halves of the
// fix — the credentials that must be sent, and the loud refusal when they are
// missing or the host is not ours.
// ---------------------------------------------------------------------------
describe('web-playwright-driver — Basic-auth wall (SHY-0529)', () => {
  test('sends credentials to the browser context for a walled target', async () => {
    const alicePage = makeMockPage();
    const { newContext } = prepareMockPages({ Alice: alicePage });
    const driver = await withDevPassword(() =>
      createWebDriver({ baseURL: 'https://dev.shytalk.shyden.co.uk' }),
    );
    await driver.webRefreshRoomsList('Alice');
    expect(newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://dev.shytalk.shyden.co.uk',
        httpCredentials: { username: 'dev', password: TEST_DEV_WALL_FIXTURE },
      }),
    );
  });

  test('sends credentials to a Cloudflare Pages preview deployment', async () => {
    const alicePage = makeMockPage();
    const { newContext } = prepareMockPages({ Alice: alicePage });
    const driver = await withDevPassword(() =>
      createWebDriver({ baseURL: 'https://abc1234.shytalk-site-dev.pages.dev' }),
    );
    await driver.webRefreshRoomsList('Alice');
    expect(newContext.mock.calls[0][0].httpCredentials).toEqual({
      username: 'dev',
      password: TEST_DEV_WALL_FIXTURE,
    });
  });

  test('sends no credentials to localhost', async () => {
    const alicePage = makeMockPage();
    const { newContext } = prepareMockPages({ Alice: alicePage });
    const driver = await withDevPassword(() =>
      createWebDriver({ baseURL: 'http://localhost:8888' }),
    );
    await driver.webRefreshRoomsList('Alice');
    expect(newContext.mock.calls[0][0].httpCredentials).toBeUndefined();
  });

  test('sends no credentials to the live site', async () => {
    // The live site is not walled. Sending the dev password there would put
    // it in a public server's logs.
    const alicePage = makeMockPage();
    const { newContext } = prepareMockPages({ Alice: alicePage });
    const driver = await withDevPassword(() =>
      createWebDriver({ baseURL: 'https://shytalk.shyden.co.uk' }),
    );
    await driver.webRefreshRoomsList('Alice');
    expect(newContext.mock.calls[0][0].httpCredentials).toBeUndefined();
  });

  test('every persona page gets the credentials, not just the first', async () => {
    // pageFor() creates one context per persona. A fix applied to only the
    // first would leave multi-actor scenarios failing.
    const alicePage = makeMockPage();
    const bobPage = makeMockPage();
    const { newContext } = prepareMockPages({ Alice: alicePage, Bob: bobPage });
    const driver = await withDevPassword(() =>
      createWebDriver({ baseURL: 'https://dev.shytalk.shyden.co.uk' }),
    );
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Bob');
    expect(newContext).toHaveBeenCalledTimes(2);
    for (const call of newContext.mock.calls) {
      expect(call[0].httpCredentials).toEqual({ username: 'dev', password: TEST_DEV_WALL_FIXTURE });
    }
  });

  test('refuses to construct when a walled target has no password', async () => {
    // The loud-failure half. Without this the runner walks 559 scenarios
    // that all 401, reporting 559 product failures and no cause.
    const original = process.env.DEV_BASIC_AUTH_PASSWORD;
    delete process.env.DEV_BASIC_AUTH_PASSWORD;
    try {
      await expect(
        createWebDriver({ baseURL: 'https://dev.shytalk.shyden.co.uk' }),
      ).rejects.toThrow(/DEV_BASIC_AUTH_PASSWORD/);
    } finally {
      if (original !== undefined) process.env.DEV_BASIC_AUTH_PASSWORD = original;
    }
  });

  test('refuses to construct for a host that is not ours', async () => {
    await expect(
      withDevPassword(() => createWebDriver({ baseURL: 'https://shytalk.shyden.co.uk.evil.com' })),
    ).rejects.toThrow(/unrecognised|not a recognised/i);
  });

  test('an explicit null suppresses credential derivation', async () => {
    // Escape hatch for a caller that has already decided the target needs
    // none. `undefined` still means "derive"; only an explicit null opts out.
    const alicePage = makeMockPage();
    const { newContext } = prepareMockPages({ Alice: alicePage });
    const driver = await withDevPassword(() =>
      createWebDriver({
        baseURL: 'https://dev.shytalk.shyden.co.uk',
        httpCredentials: null,
      }),
    );
    await driver.webRefreshRoomsList('Alice');
    expect(newContext.mock.calls[0][0].httpCredentials).toBeUndefined();
  });

  test('the password never reaches a thrown error message', async () => {
    let message = '';
    try {
      await withDevPassword(() =>
        createWebDriver({ baseURL: 'https://shytalk.shyden.co.uk.evil.com' }),
      );
    } catch (err) {
      message = err.message;
    }
    expect(message).not.toContain(TEST_DEV_WALL_FIXTURE);
    expect(message).toContain('shytalk.shyden.co.uk.evil.com');
  });
});
