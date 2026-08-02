/**
 * The shared web surface, driven against a REAL browser.
 *
 * SHY-0259. `attachCommonWebMethods` is the single implementation behind six
 * of the seven web drivers in the matrix — 68 methods that, before this
 * batch, existed only on the desktop Playwright driver. Getting them wrong
 * here is wrong on Mobile Chrome, Samsung Internet, Mobile Edge, Mobile
 * Firefox, Mobile Safari and the three WebKit-backed iOS browsers at once.
 *
 * WHY A REAL BROWSER AND A REAL SERVER.
 *
 * Every method here is ultimately a string of JavaScript executed in a page.
 * A hand-rolled `document` would be a model of the DOM written by the same
 * person who wrote the code under test, so both could share a wrong
 * assumption and agree with each other — which is precisely how
 * `centreOfCardWithLabel` shipped assuming uiautomator emitted attributes in
 * an order it does not. Real Chromium settles the question.
 *
 * The HTML fixtures are test DATA, not test doubles: nothing here stands in
 * for a collaborator, and no response is fabricated.
 */
const http = require('http');
const path = require('path');

const { attachCommonWebMethods, IN_PAGE } = require(
  path.resolve(__dirname, '../../../scripts/drivers/web-common-methods'),
);

let pw;
let browser;
let server;
let baseURL;
/** Per-test HTML, served at every path so navigation always lands somewhere real. */
let pageHtml = '<html lang="en"><body></body></html>';
/** Requests the real server actually received — evidence, not interception. */
let received = [];

beforeAll(async () => {
  pw = require('playwright');
  browser = await pw.chromium.launch({ headless: true });
  server = http.createServer((req, res) => {
    received.push(req.url);
    if (req.url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries: [{ action: 'ban', actor: 'greta' }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHtml);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Port 8888 is what the driver rewrites to :3000 for API calls; the test
  // server answers both roles on one port, so apiBase() is pinned separately.
  baseURL = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

/**
 * Build a driver over a real page, wired through exactly the two primitives
 * the mobile drivers supply. Nothing richer — if a method works here it works
 * on Appium's /execute/sync too.
 *
 * On `new Function(...)`: the mixin's snippets are SOURCE STRINGS because the
 * two hosts need different things — Playwright's page.evaluate takes a
 * function, Appium's /execute/sync takes a string — and one contract has to
 * bridge them. The only values ever compiled are the module-private IN_PAGE
 * constants in this repository; nothing user-supplied, network-sourced or
 * scenario-derived reaches here, and nothing should be allowed to. Widening
 * the input to anything a corpus author controls would turn this into
 * arbitrary code execution against the QA host.
 */
async function makeDriver({ html, host = {} } = {}) {
  if (html) pageHtml = html;
  received = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  const driver = { _page: page, close: async () => context.close() };
  attachCommonWebMethods(driver, {
    slug: 'test-surface',
    baseURL,
    navigate: async (u) => {
      await page.goto(String(u), { waitUntil: 'domcontentloaded' });
      return true;
    },
    evaluate: async (src, arg) => page.evaluate(new Function('return (' + src + ')')(), arg),
    ...host,
  });
  return driver;
}

describe('clicking by visible label', () => {
  it('prefers a real control over any element that merely contains the word', async () => {
    // The bug this guards: a loose text sweep matched a paragraph mentioning
    // "Follow" and reported the button clicked. Buttons and links are tried
    // before plain text for exactly that reason.
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <p>Tap Follow to keep up with them</p>
        <button id="real" onclick="document.title='clicked'">Follow</button>
      </body></html>`,
    });
    expect(await d.webTapNamedButton('Follow')).toBe(true);
    expect(await d._page.title()).toBe('clicked');
    await d.close();
  });

  it('withholds the partial-text sweep from labels under three characters', async () => {
    // "X" as a substring matches almost any page. A short label must match
    // exactly or not at all — this is what made webCloseModalViaX report a
    // modal closed when none was open.
    const d = await makeDriver({
      html: `<html lang="en"><body><div>Extra explanatory text</div></body></html>`,
    });
    expect(await d.webTapNamedButton('X')).toBe(false);
    await d.close();
  });

  it('matches a control by aria-label when it has no text', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <button aria-label="Close dialog" onclick="document.title='aria'"></button>
      </body></html>`,
    });
    expect(await d.webTapNamedButton('Close dialog')).toBe(true);
    expect(await d._page.title()).toBe('aria');
    await d.close();
  });

  it('reports false rather than throwing when nothing matches', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body><p>nothing</p></body></html>' });
    expect(await d.webTapNamedButton('Absent')).toBe(false);
    await d.close();
  });
});

describe('webTap', () => {
  it('finds a control by test tag', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <button data-test-tag="gift_send" onclick="document.title='tagged'">Send</button>
      </body></html>`,
    });
    expect(await d.webTap('gift_send')).toBe(true);
    expect(await d._page.title()).toBe('tagged');
    await d.close();
  });

  it('falls back to the label when no tag matches', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <button onclick="document.title='by-label'">Continue</button>
      </body></html>`,
    });
    expect(await d.webTap('Continue')).toBe(true);
    expect(await d._page.title()).toBe('by-label');
    await d.close();
  });
});

describe('webVisit', () => {
  it('refuses a relative URL by name', async () => {
    // A relative path resolves against whatever page ran before, so the same
    // step would visit different places depending on test order.
    const d = await makeDriver();
    await expect(d.webVisit('/rooms')).rejects.toThrow(/absolute URL/);
    await d.close();
  });

  it('navigates to an absolute URL', async () => {
    const d = await makeDriver();
    expect(await d.webVisit(`${baseURL}/rooms`)).toBe(true);
    expect(d._page.url()).toContain('/rooms');
    await d.close();
  });
});

describe('filling fields', () => {
  it('uses the native setter so framework listeners see the change', async () => {
    // A bare `el.value = x` is invisible to React's value tracker and the
    // field silently reverts. The page records what its own input listener
    // observed, which is the property that matters.
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <input data-test-tag="admin_search" name="search" />
        <script>
          window.__seen = [];
          document.querySelector('input').addEventListener('input', (e) => {
            window.__seen.push(e.target.value);
          });
        </script>
      </body></html>`,
    });
    expect(await d.webTypeIntoSearch('greta')).toBe(true);
    expect(await d._page.evaluate(() => window.__seen)).toEqual(['greta']);
    await d.close();
  });

  it('submits the owning form when searching', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <form onsubmit="document.title='submitted'; return false;">
          <input data-test-tag="admin_search" name="search" />
        </form>
      </body></html>`,
    });
    expect(await d.webAdminSearch('greta')).toBe(true);
    expect(await d._page.title()).toBe('submitted');
    await d.close();
  });
});

describe('admin table reading', () => {
  const TABLE = `<html lang="en"><body><table>
    <tr><th>User</th><th>Status</th></tr>
    <tr><td>greta</td><td>banned</td></tr>
    <tr><td>marcus</td><td>active</td></tr>
  </table></body></html>`;

  it('counts data rows and ignores the header', async () => {
    const d = await makeDriver({ html: TABLE });
    expect(await d.webAdminGetRowCount()).toBe(2);
    await d.close();
  });

  it('requires BOTH the user and the status to be in the SAME row', async () => {
    // The bug this rules out: checking the whole table for each value
    // separately reports "greta is active" as true, because both strings
    // appear somewhere.
    const d = await makeDriver({ html: TABLE });
    expect(await d.webAdminShowsRowForWithStatus('greta', 'banned')).toBe(true);
    expect(await d.webAdminShowsRowForWithStatus('greta', 'active')).toBe(false);
    await d.close();
  });

  it('finds a report row by any cell', async () => {
    const d = await makeDriver({ html: TABLE });
    expect(await d.webAdminShowsReportRow('marcus')).toBe(true);
    expect(await d.webAdminShowsReportRow('nobody')).toBe(false);
    await d.close();
  });
});

describe('dashboard counters compare numbers, not substrings', () => {
  it('does not accept 12 as satisfying an expectation of 1', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <span data-test-tag="adminDashboard_reports">12 reports</span>
      </body></html>`,
    });
    expect(await d.webDashboardReportsCounterEquals('greta', 12)).toBe(true);
    expect(await d.webDashboardReportsCounterEquals('greta', 1)).toBe(false);
    await d.close();
  });

  it('is false when the counter is absent rather than throwing', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    expect(await d.webDashboardReportsCounterEquals('greta', 0)).toBe(false);
    await d.close();
  });
});

describe('a tab that must not navigate', () => {
  it('is true when the URL is unchanged after tapping', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body><button>Rooms</button></body></html>`,
    });
    expect(await d.webShowsTabWithNoNavTo('Rooms')).toBe(true);
    await d.close();
  });

  it('is false when the tab does navigate', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <button onclick="location.href='/elsewhere'">Rooms</button>
      </body></html>`,
    });
    expect(await d.webShowsTabWithNoNavTo('Rooms')).toBe(false);
    await d.close();
  });
});

describe('select filters', () => {
  it('selects by visible label and fires change', async () => {
    const d = await makeDriver({
      html: `<html lang="en"><body>
        <select name="action" onchange="document.title=this.value">
          <option value="">All</option>
          <option value="ban">Ban user</option>
        </select>
      </body></html>`,
    });
    expect(await d.webAdminFilterByAction('Ban user')).toBe(true);
    expect(await d._page.title()).toBe('ban');
    await d.close();
  });
});

describe('document direction and locale', () => {
  it('reads the real dir attribute', async () => {
    const d = await makeDriver({
      html: '<html lang="ar" dir="rtl"><body><p>مرحبا</p></body></html>',
    });
    expect(await d.webDocumentDirection('greta')).toBe('rtl');
    await d.close();
  });

  it('defaults to ltr when no direction is declared', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    expect(await d.webDocumentDirection('greta')).toBe('ltr');
    await d.close();
  });

  it('sets the locale through localStorage, the only key the app honours', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    await d.webDocumentDirection('greta', 'th');
    expect(await d._page.evaluate(() => localStorage.getItem('shytalk_language'))).toBe('th');
    await d.close();
  });
});

describe('untranslated-string detection', () => {
  it('treats a leaked resource key as NOT having fallen back to English', async () => {
    // English text is indistinguishable from a correct English render, so the
    // key leak is the only signal that actually separates the two.
    const d = await makeDriver({
      html: '<html lang="en"><body><p>wallet_balance_label</p></body></html>',
    });
    expect(await d.webFallbackEnStrings()).toBe(false);
    await d.close();
  });

  it('is true for a page of real prose', async () => {
    const d = await makeDriver({
      html: '<html lang="en"><body><p>Your balance is 42 coins</p></body></html>',
    });
    expect(await d.webFallbackEnStrings()).toBe(true);
    await d.close();
  });

  it('lists the keys it found, de-duplicated', async () => {
    const d = await makeDriver({
      html: '<html lang="en"><body><p>wallet_balance wallet_balance room_title</p></body></html>',
    });
    const keys = await d.webMissingTranslations();
    expect(keys).toContain('wallet_balance');
    expect(keys).toContain('room_title');
    expect(keys.filter((k) => k === 'wallet_balance')).toHaveLength(1);
    await d.close();
  });
});

describe('probes record real traffic without fabricating any', () => {
  it('captures a real request the page made, with its real status', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    // Install first, then make a genuine call through the page's own fetch.
    await d.webConsoleErrors();
    await d._page.evaluate(async (url) => fetch(url).then((r) => r.text()), `${baseURL}/api/ping`);
    const log = await d._networkLog();
    expect(log.some((e) => String(e.url).includes('/api/ping') && e.status === 200)).toBe(true);
    // The server really received it — the probe observed, it did not invent.
    expect(received).toContain('/api/ping');
    await d.close();
  });

  it('counts attempts against a URL fragment', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    await d.webConsoleErrors();
    await d._page.evaluate(async (url) => {
      await fetch(url);
      await fetch(url);
    }, `${baseURL}/api/retry`);
    expect(await d.webNetworkLogCountAttempts('/api/retry')).toBe(2);
    await d.close();
  });

  it('captures console errors raised by the page', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    await d.webConsoleErrors();
    // The arrow below is serialised and run INSIDE Chromium, so the console it
    // reaches is the page's, not Node's. Raising a genuine page error is the
    // only way to prove the probe catches one; asserting on a value we handed
    // it would test nothing.
    // eslint-disable-next-line no-console -- runs in the browser, not in Node
    await d._page.evaluate(() => console.error('boom in the page'));
    expect(await d.webConsoleErrors()).toContain('boom in the page');
    await d.close();
  });

  it('prefers the host log when the surface offers a stronger one', async () => {
    // A CDP-attached driver sees document and subresource loads too, which
    // in-page instrumentation cannot. Levelling every surface down to the
    // weakest signal would throw that away.
    const d = await makeDriver({
      html: '<html lang="en"><body></body></html>',
      host: { networkLog: async () => [{ url: '/from-host', status: 204 }] },
    });
    expect(await d.webNetworkLogHasStatus(204)).toBe(true);
    await d.close();
  });
});

describe('honest refusals', () => {
  it('refuses network shaping it cannot perform, and says why', async () => {
    // Returning a cheerful true would let a low-connectivity scenario pass at
    // full speed — the exact false confidence that makes a green matrix
    // worthless.
    const d = await makeDriver();
    const res = await d.webSetNetwork('2g');
    expect(res.supported).toBe(false);
    expect(res.why).toMatch(/network-shaping/);
    await d.close();
  });

  it('uses the host channel when one exists', async () => {
    const d = await makeDriver({
      host: { setNetwork: async (p) => ({ supported: true, applied: true, profile: p }) },
    });
    await expect(d.webSetNetwork('2g')).resolves.toMatchObject({ supported: true, profile: '2g' });
    await d.close();
  });

  it('refuses to fabricate a 5xx', async () => {
    // A synthetic error response is an invented answer, not an induced
    // failure — the distinction the no-doubles rule turns on.
    const d = await makeDriver();
    const res = await d.injectApiFailureThenSuccess();
    expect(res.supported).toBe(false);
    expect(res.why).toMatch(/fabricated response/);
    await d.close();
  });

  it('refuses a server-side fixture by name rather than reporting a product failure', async () => {
    const d = await makeDriver();
    await expect(d.fireSystemPmWebhook()).rejects.toThrow(/server-side fixture/);
    await d.close();
  });

  it('reports notification permission honestly when it cannot grant it', async () => {
    const d = await makeDriver();
    const res = await d.webGrantNotificationPermission();
    // Either genuinely granted, or an explicit refusal — never a bare `false`,
    // which reads as the PRODUCT refusing rather than the harness being unable.
    //
    // Asserted unconditionally. Behind `if (res !== true)` this checked nothing
    // whenever the permission WAS granted, so the interesting branch could rot
    // untested and the test would stay green.
    const shape =
      res === true ? { granted: true } : { granted: false, supported: res.supported, why: res.why };
    expect(shape.granted || shape.supported === false).toBe(true);
    expect(shape.granted ? 'browser-chrome prompt' : shape.why).toMatch(/browser-chrome prompt/);
    await d.close();
  });
});

describe('the API channel talks to the real API', () => {
  it('returns the real status and parsed body', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    const r = await d._apiFetch('/api/admin/audit-log');
    expect(r.status).toBe(200);
    expect(r.json.entries[0].action).toBe('ban');
    await d.close();
  });

  it('matches an audit row on every field of the predicate', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    expect(await d.auditLogContains({ action: 'ban', actor: 'greta' })).toBe(true);
    // One field right and one wrong must not match — an `some`-per-field
    // implementation would wrongly accept this.
    expect(await d.auditLogContains({ action: 'ban', actor: 'marcus' })).toBe(false);
    await d.close();
  });

  it('issues sequential requests in order, not concurrently', async () => {
    const d = await makeDriver({ html: '<html lang="en"><body></body></html>' });
    const statuses = await d.sequentialRequestStatus('/api/rate-limited', 3);
    expect(statuses).toEqual([200, 200, 200]);
    expect(received.filter((u) => u === '/api/rate-limited')).toHaveLength(3);
    await d.close();
  });
});

describe('the mixin never replaces a driver’s own implementation', () => {
  it('leaves a more precise existing method alone', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseURL}/`);
    const driver = { webTap: async () => 'mine' };
    attachCommonWebMethods(driver, {
      slug: 'test',
      baseURL,
      navigate: async () => true,
      evaluate: async (src, arg) => page.evaluate(new Function('return (' + src + ')')(), arg),
    });
    expect(await driver.webTap('anything')).toBe('mine');
    await context.close();
  });
});

describe('every in-page snippet is syntactically valid JavaScript', () => {
  // A snippet is a STRING until it reaches a browser, so a typo in one is
  // invisible until that method runs on a device. Compiling them all here
  // turns a device-time discovery into a millisecond one.
  it.each(Object.keys(IN_PAGE))('%s compiles', (name) => {
    expect(() => new Function('return (' + IN_PAGE[name] + ')')()).not.toThrow();
  });

  it('covers every snippet the module exports', () => {
    expect(Object.keys(IN_PAGE).length).toBeGreaterThan(20);
  });
});
