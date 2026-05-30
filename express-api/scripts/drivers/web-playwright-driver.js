/* global document, window, NodeFilter */
/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */
/**
 * Web driver backed by the `playwright` package.
 *
 * Exposes the ctx.webDriver methods that manual-qa-runner.js matchers
 * call. Each method does the real Chromium work — navigate, click,
 * read text, snapshot accessibility tree, dispatch Firebase auth
 * via the page's runtime — so that scenarios from .feature files
 * exercise the real ShyTalk web surface (not jest spy stubs).
 *
 * Wiring: runner main() instantiates `await createWebDriver({ baseURL })`
 * and attaches the returned object to ctx.webDriver. Close at end of run.
 *
 * Method-naming contract (must match what matchers call):
 *   - Each method is `async (...args) => boolean | true-ish`
 *   - Method names mirror the matcher's `methodName` dispatch
 *     (e.g., `webShowsRoomClosedSummary`, `webShowsCountBadge`)
 *   - First arg is typically the actor's persona name (string)
 *
 * Initial implementation: STUB FOR EVERY METHOD that returns false +
 * logs "not implemented yet" so the runner produces a finding instead
 * of crashing on undefined. As scenarios are exercised, methods get
 * real implementations one at a time.
 */
const path = require('path');

let _playwright;
function loadPlaywright() {
  if (_playwright) return _playwright;
  // Try bare specifier first so jest's mock-resolution applies in unit
  // tests (jest.mock('playwright', ...) only intercepts the bare form,
  // not absolute-path requires). Falls back to the repo-root path for
  // production / dev runs from express-api where the bare specifier
  // can't resolve (playwright lives in the repo-root node_modules, not
  // express-api/node_modules).
  try {
    _playwright = require('playwright');
    return _playwright;
  } catch (bareErr) {
    if (bareErr.code !== 'MODULE_NOT_FOUND') throw bareErr;
  }
  const repoRoot = path.resolve(__dirname, '../../..');
  const playwrightPath = path.join(repoRoot, 'node_modules', 'playwright');
  _playwright = require(playwrightPath);
  return _playwright;
}

/**
 * Method-name list the runner expects (extracted by scanning matchers
 * for `ctx.webDriver?.<methodName>` references). Each is stubbed below.
 * The list is the source of truth for "what scenarios will be able to
 * exercise"; additions/removals here must mirror runner matcher edits.
 */
const WEB_METHOD_NAMES = [
  // Wake 86-106 vocabulary — extracted by grep over runner. Currently
  // all return false (not implemented). As scenarios surface needs,
  // each method gets a real Playwright body.
  'webAdminShowsAppealText',
  'webAdminShowsDashboardCounters',
  'webAdminShowsNewReportInQueue',
  'webAdminShowsRowCountInTable',
  'webAdminShowsRowForWithStatus',
  'webAdminShowsStat',
  'webAdminShowsTableOf',
  'webAlsoShowsInParticipantsList',
  'webApproveSeatRequest',
  'webDashboardReportsCounterEquals',
  'webDisablesInput',
  'webIsNoLongerInVoiceRoom',
  'webIsStillInRoom',
  'webJoinEventRoom',
  'webNavigatesBackToTab',
  'webNavigatesToPath',
  'webNavigatesToProfileScreen',
  'webNavigatesToRoomScreen',
  'webNavigatesToWarningScreen',
  'webOpenProfileAndTap',
  'webOpenProfileFrom',
  'webOpensTab',
  'webPairedSessionShowsSameTotals',
  'webPmDoesNotRenderInEnglish',
  'webPmBodyShowsRawKeyOrPlaceholder',
  'webRailShowsLessonsForLanguage',
  'webRefreshLanguageRail',
  'webReplacesFollowButton',
  'webShowsBalanceViaListener',
  'webShowsBanner',
  'webShowsBeansPerWeekChart',
  'webShowsCardBadge',
  'webShowsContributorsList',
  'webShowsCountBadge',
  'webShowsEditedBodyWithTag',
  'webShowsFrozenBanner',
  'webShowsGiftFromSender',
  'webShowsInAppGiftNotification',
  'webShowsInResults',
  'webShowsInSeatGrid',
  'webShowsInThread',
  'webShowsMessageInConversationThread',
  'webShowsMicIconAs',
  'webShowsNamedKind',
  'webShowsNewGiftEntry',
  'webShowsNewUnreadConversation',
  'webShowsNonEmptyLocaleText',
  'webShowsOfficialBadge',
  'webShowsOnlyMinorCohortInRankings',
  'webShowsOwnRankInTop',
  'webShowsPmThreadDirection',
  'webShowsRoomClosedSummary',
  'webShowsRoomWarningBanner',
  'webShowsSecondOffensiveMessage',
  'webShowsSeatRequestNotification',
  'webShowsSeatWithIndicator',
  'webShowsStalkersDelta',
  'webShowsSystemPmFromOfficia',
  'webShowsToastAndNavigates',
  'webShowsToastAndNavigatesBack',
  'webShowsUserCard',
  'webShowsUserCardSkeletons',
  'webShowsWarningScreenOnRelaunch',
  'webShowsWarningScreenWithReason',
  'webShowsWelcomePmInLanguage',
  'webSubmitStarFeedback',
  'webTapFromSurface',
  'webPairedSessionShowsSameTotals',
  // Cycle-10 surfaced these as missing-but-needed:
  'fireSystemPmWebhook',
  'neitherUserIsFollowingTheOther',
  'webOpenProfilePanel',
  'webAdminIssueWarning',
  'hasPurchasedSuccessfully',
  'webDocumentDirection',
  'webShowsTranslationOf',
  'webScanAllRenderedStrings',
  'webFallbackEnStrings',
  // j09 — Alice on Web refreshes the rooms list. Navigates to /rooms
  // on the persona's tab; the matcher's `within 3000ms` polling
  // wraps the list population.
  'webRefreshRoomsList',
  // Append-only — add new method names as new matchers land.
];

/**
 * Returns an array of unique method names. Some names repeat above for
 * ergonomic reading; Set normalises.
 */
function listMethods() {
  return [...new Set(WEB_METHOD_NAMES)].sort();
}

/**
 * Create a web driver instance.
 *
 *   const driver = await createWebDriver({ baseURL: 'http://localhost:8888' });
 *   ctx.webDriver = driver;
 *   // ... run scenarios ...
 *   await driver.close();
 *
 * The driver owns one Chromium browser context; per-persona pages are
 * created lazily inside `pageFor(name)` so multi-actor scenarios
 * (j16 event host with paired session) get isolated cookies/storage.
 */
// Per-browser launcher registry. Each entry returns the launched
// Playwright Browser. Local-matrix test policy requires support for
// Chromium / WebKit (Safari engine) / Firefox / Edge. Edge uses the
// Chromium engine with the `msedge` channel — Playwright doesn't have a
// separate edge BrowserType.
const BROWSER_LAUNCHERS = {
  chromium: (pw, opts) => pw.chromium.launch(opts),
  firefox: (pw, opts) => pw.firefox.launch(opts),
  webkit: (pw, opts) => pw.webkit.launch(opts),
  edge: (pw, opts) => pw.chromium.launch({ ...opts, channel: 'msedge' }),
};

const SUPPORTED_BROWSERS = Object.keys(BROWSER_LAUNCHERS);

async function createWebDriver({
  baseURL = 'http://localhost:8888',
  headless = true,
  browser: browserName = 'chromium',
} = {}) {
  if (!BROWSER_LAUNCHERS[browserName]) {
    throw new Error(
      `Unknown browser "${browserName}" — supported: ${SUPPORTED_BROWSERS.join(', ')}. Mobile-browser variants (Mobile Chrome / Mobile Safari / Samsung Internet / Mobile Firefox / Mobile Edge / Chrome iOS / Firefox iOS / Edge iOS) ship via separate drivers (mobile-chrome-cdp-driver.js, appium-ios-webview-driver.js, etc.) — not this one.`,
    );
  }
  const pw = loadPlaywright();
  const browser = await BROWSER_LAUNCHERS[browserName](pw, { headless });
  const pages = new Map(); // persona name → Page

  async function pageFor(name) {
    if (pages.has(name)) return pages.get(name);
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    pages.set(name, page);
    return page;
  }

  const driver = { _browser: browser, _browserName: browserName, _pages: pages, pageFor };

  // Wire every known method as a stub returning false + logging.
  for (const methodName of listMethods()) {
    driver[methodName] = async (...args) => {
      // Driver-stub silent-fail signal — runner will surface this as a
      // Major finding rather than crashing.
      console.error(
        `[web-driver] stub:${methodName}(${args.map((a) => JSON.stringify(a)).join(', ')}) — not implemented yet`,
      );
      return false;
    };
  }

  // ── Real implementations (override stubs above) ─────────────────────
  // Each method docs the matcher signature it satisfies.

  // <Name>'s Web UI document direction is "ltr"|"rtl"|"auto"
  // Reads the dir attribute on <html>. Optional 2nd arg is the locale to
  // apply via localStorage before reading — the public web app's
  // language-selector.js reads localStorage on load and sets
  // document.documentElement.dir based on RTL_LANGS membership.
  driver.webDocumentDirection = async (name, locale) => {
    const page = await pageFor(name || 'default');
    if (locale) {
      // Apply via localStorage (the only mechanism the public app honours;
      // ?lang= query param is NOT supported per public/js/language-selector.js).
      if (!page.url() || page.url() === 'about:blank') await page.goto('/');
      await page.evaluate((lang) => {
        try {
          localStorage.setItem('shytalk_language', lang);
        } catch (_) {
          /* sandboxed */
        }
      }, locale);
      await page.reload({ waitUntil: 'networkidle' });
    } else if (!page.url() || page.url() === 'about:blank') {
      await page.goto('/');
    }
    return page.evaluate(() => document.documentElement.getAttribute('dir') || 'ltr');
  };

  // Returns the visible text content of the current page. Used by
  // assertion matchers like `<P>'s Web UI shows "<text>"` to verify
  // a string is rendered somewhere on the active page. innerText
  // (not textContent) so hidden elements + script blocks don't
  // contaminate the result — Playwright doesn't normalise on its own.
  driver.webUiDump = async () => {
    const page = await pageFor('default');
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    return page.evaluate(() => document.body.innerText || '');
  };

  // Web "types into the search field". Locator tries the common
  // search-input shapes the public app uses, in this priority order:
  //   1. [data-test-tag="searchField"] / [data-testid="search"]
  //   2. input[type="search"]
  //   3. input[name="search"] / input[name="q"]
  //   4. input[placeholder*="search" i] (loose textual fallback)
  // Whichever matches first wins; an empty match throws via Playwright's
  // locator timeout and we return false so the matcher reports a clean
  // "did not complete" finding rather than a stack trace.
  driver.webTypeIntoSearch = async (text) => {
    const page = await pageFor('default');
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    const locator = page
      .locator(
        [
          '[data-test-tag="searchField"]',
          '[data-testid="search"]',
          'input[type="search"]',
          'input[name="search"]',
          'input[name="q"]',
          'input[placeholder*="search" i]',
        ].join(', '),
      )
      .first();
    try {
      await locator.fill(String(text), { timeout: 3000 });
      return true;
    } catch (e) {
      console.error(`[web-driver] webTypeIntoSearch(${text}) failed: ${e.message}`);
      return false;
    }
  };

  // Web Admin variant — navigates to /admin.html and reads <html dir>.
  // The admin panel is English-only by ShyTalk policy (per j12 scenario
  // comments) so this should always return 'ltr' regardless of browser
  // locale. The shared pageFor('default') context picks up any locale
  // already applied via webDocumentDirection from earlier in the same
  // scenario, so per-scenario test setup chains work.
  driver.webAdminGetDocumentDirection = async () => {
    const page = await pageFor('default');
    await page.goto('/admin.html');
    return page.evaluate(() => document.documentElement.getAttribute('dir') || 'ltr');
  };

  // <Name>'s Web UI shows the <Language> translation of "<EnglishKey>"
  // Driver receives (BCP-47 code, English key/phrase). Verifies the
  // visible page text contains the localised translation. Uses the
  // homepage-translations.js dictionary loaded by the public web app.
  // Web tap-by-tag — looks for an element with data-test-tag or
  // [data-testid] attribute matching `tag`, OR an element whose text
  // content equals tag. Falls back to clickable role match.
  driver.webTap = async (tag) => {
    const page = await pageFor('default');
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    const locator = page
      .locator(`[data-test-tag="${tag}"], [data-testid="${tag}"], [id="${tag}"]`)
      .first();
    try {
      await locator.click({ timeout: 3000 });
      return true;
    } catch (_e) {
      // Fallback: click by role+name (button with matching aria-label).
      try {
        await page.getByRole('button', { name: tag }).first().click({ timeout: 2000 });
        return true;
      } catch (_e2) {
        return false;
      }
    }
  };

  // Web fill-in by tag — for each {key:value} in fields, locate an input
  // with [data-test-tag=key] / [data-testid=key] / [name=key] / [id=key]
  // and .fill() the value. Returns true if all fields filled.
  driver.webFillIn = async (name, fields) => {
    const page = await pageFor(name || 'default');
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    for (const [key, value] of Object.entries(fields)) {
      const locator = page
        .locator(`[data-test-tag="${key}"], [data-testid="${key}"], input[name="${key}"], #${key}`)
        .first();
      try {
        await locator.fill(String(value), { timeout: 3000 });
      } catch (e) {
        console.error(`[web-driver] webFillIn(${key}=${value}) failed: ${e.message}`);
        return false;
      }
    }
    return true;
  };

  driver.webShowsTranslationOf = async (code, englishKey) => {
    const page = await pageFor('default');
    await page.evaluate((lang) => {
      try {
        localStorage.setItem('shytalk_language', lang);
      } catch (_) {
        /* sandboxed */
      }
    }, code);
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    else await page.reload({ waitUntil: 'networkidle' });
    // KNOWN LIMITATION: HOMEPAGE_T only covers homepage strings
    // (tagline/coming_soon/app_store/roadmap_cta). In-app strings like
    // "Discover"/"Wallet"/"ShyCoins" live in compose strings.xml and
    // only render post-sign-in on the app's screens, which the public
    // web at :8888 doesn't serve. Returns false with a clear reason
    // for those — operator surfaces it as a driver-coverage finding.
    const result = await page.evaluate(
      ({ lang, src }) => {
        const dict = window.HOMEPAGE_T || {};
        const enDict = dict.en || {};
        let key = null;
        for (const k of Object.keys(enDict)) {
          if (enDict[k] === src) {
            key = k;
            break;
          }
        }
        if (!key) {
          return {
            ok: false,
            reason: `"${src}" not in homepage namespace — likely in-app (post-sign-in driver flow not wired)`,
          };
        }
        const translated = (dict[lang] || {})[key];
        if (!translated) {
          return { ok: false, reason: `no ${lang} translation for "${key}"` };
        }
        const bodyText = document.body.innerText || '';
        return { ok: bodyText.includes(translated), translated, key };
      },
      { lang: code, key: englishKey },
    );
    return Boolean(result?.ok);
  };

  // the test runner scans all rendered strings on <Name>'s Web UI across N screens
  // Walks N screens (homepage + N-1 follow-on routes), collecting visible
  // strings into a flat array. The next matcher consumes the result via
  // ctx.scannedStrings.
  driver.webScanAllRenderedStrings = async (name, screensCount) => {
    const page = await pageFor(name || 'default');
    const routes = [
      '/',
      '/roadmap.html',
      '/privacy.html',
      '/terms.html',
      '/community-guidelines.html',
    ];
    const collected = [];
    for (let i = 0; i < Math.min(screensCount, routes.length); i++) {
      await page.goto(routes[i], { waitUntil: 'networkidle' });
      const texts = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const out = [];
        let node = walker.nextNode();
        while (node) {
          const t = (node.textContent || '').trim();
          if (t) out.push(t);
          node = walker.nextNode();
        }
        return out;
      });
      collected.push(...texts);
    }
    return collected;
  };

  // webRefreshRoomsList — refresh the rooms list on the persona's tab.
  // Runner step "<Name> on Web refreshes the rooms list" (j09: Alice
  // joins Theo's public room scenario). The persona-scoped Page is
  // obtained via pageFor(name); navigates to /rooms (the canonical
  // rooms-list route) if not already there, else does a soft reload.
  // The soft reload is preferred over location.reload() because it
  // preserves the Firebase Auth state — a hard reload triggers Firebase
  // to re-initialise and may invalidate cached auth tokens.
  driver.webRefreshRoomsList = async (name) => {
    try {
      const page = await pageFor(name);
      // Soft refresh: navigate to /rooms regardless of current location.
      // Playwright's Page.goto() defaults to waitUntil:'load' which is
      // enough for the rooms list to render; the matcher's
      // `within 3000ms` polling wrapper handles any async list population.
      await page.goto(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(`[web-driver] webRefreshRoomsList(${name}) failed: ${e.message}`);
      return false;
    }
  };

  driver.close = async () => {
    for (const p of pages.values()) {
      await p.context().close();
    }
    await browser.close();
  };

  return driver;
}

module.exports = {
  createWebDriver,
  listMethods,
  WEB_METHOD_NAMES,
  SUPPORTED_BROWSERS,
};
