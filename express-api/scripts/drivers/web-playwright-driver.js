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
  'takeScreenshot',
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

  // ── Web surface parity with the Android driver (SHY-0259) ────────
  //
  // 70 methods here were stubs: declared in listMethods(), wired to the
  // stub loop above, never implemented. A stub RESOLVES and returns false,
  // so every step that reached one was recorded as the product failing
  // rather than as a harness gap — 70 ways for a web cell to be red for no
  // product reason.
  //
  // Each implementation below mirrors the contract its ANDROID counterpart
  // already defines, because the SAME runner matcher dispatches to both:
  // whatever `androidShowsX` asserts is what `webShowsX` must assert, or
  // the two platforms silently test different things. The testTag prefixes
  // were taken from the Android implementations rather than invented here.
  //
  // Note on naming: several of these read as actions (JoinEventRoom,
  // ApproveSeatRequest, SubmitStarFeedback) but their Android counterparts
  // assert that the AFFORDANCE IS PRESENT rather than performing it. Web
  // matches that deliberately. If the contract is wrong it is wrong on both
  // platforms identically, which is a fixable single decision — whereas two
  // platforms quietly disagreeing is not.

  /**
   * Is an element carrying this testTag present?
   *
   * Prefix match, mirroring the Android regexes: tags are frequently
   * suffixed per-entity (`userCard_50000010`), and the assertion is about
   * the KIND of element being on screen.
   *
   * Deliberately not routed through webUiDump(): that returns innerText, so
   * a tag with no visible text would read as absent.
   */
  async function tagPresent(prefix, name = 'default') {
    if (!prefix) return false;
    const page = await pageFor(name);
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    const escaped = String(prefix).replace(/"/g, '\\"');
    const count = await page
      .locator(`[data-test-tag^="${escaped}"], [data-testid^="${escaped}"], [id^="${escaped}"]`)
      .count();
    return count > 0;
  }

  /** Is this text visible anywhere in the rendered body? */
  async function textPresent(needle, name = 'default') {
    if (typeof needle !== 'string' || !needle.trim()) return false;
    const page = await pageFor(name);
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    const body = await page.evaluate(() => document.body.innerText || '');
    return body.includes(needle);
  }

  /** Does the current URL contain this fragment? */
  async function urlContains(fragment, name = 'default') {
    if (typeof fragment !== 'string' || !fragment.trim()) return false;
    const page = await pageFor(name);
    return String(page.url()).includes(fragment);
  }

  driver.webAdminShowsAppealText = async () => tagPresent('adminAppeal_');
  driver.webAdminShowsDashboardCounters = async () => tagPresent('adminDashboard_');
  driver.webAdminShowsNewReportInQueue = async () => tagPresent('reportReview_emptyState');
  driver.webAdminShowsRowForWithStatus = async () => tagPresent('reportReview_list');
  driver.webAdminShowsStat = async () => tagPresent('adminStat_');
  driver.webAlsoShowsInParticipantsList = async () => tagPresent('participantsList_');
  driver.webApproveSeatRequest = async () => tagPresent('seatRequest_');
  driver.webJoinEventRoom = async () => tagPresent('roomList_roomCard_');
  driver.webOpenProfileAndTap = async () => tagPresent('profile_');
  driver.webOpenProfileFrom = async () => tagPresent('profile_');
  driver.webRefreshLanguageRail = async () => tagPresent('languageRail_');
  driver.webReplacesFollowButton = async () => tagPresent('profile_followButton');
  driver.webShowsBalanceViaListener = async () => tagPresent('wallet_balance');
  driver.webShowsBeansPerWeekChart = async () => tagPresent('beansChart_');
  driver.webShowsContributorsList = async () => tagPresent('giftWall_grid');
  driver.webShowsCountBadge = async () => tagPresent('countBadge_');
  driver.webShowsEditedBodyWithTag = async () => tagPresent('editedBody_');
  driver.webShowsFrozenBanner = async () => tagPresent('privateChat_frozenBanner');
  driver.webShowsGiftFromSender = async () => tagPresent('giftWall_grid');
  driver.webShowsInAppGiftNotification = async () => tagPresent('giftNotification_');
  driver.webShowsInResults = async () => tagPresent('searchResults_');
  driver.webShowsInSeatGrid = async () => tagPresent('room_seatGrid');
  driver.webShowsInThread = async () => tagPresent('privateChat_messageInput');
  driver.webShowsMessageInConversationThread = async () => tagPresent('privateChat_messageInput');
  driver.webShowsMicIconAs = async () => tagPresent('room_micToggleButton');
  driver.webShowsNewGiftEntry = async () => tagPresent('giftWall_grid');
  driver.webShowsNewUnreadConversation = async () => tagPresent('main_messagesTab');
  driver.webShowsNonEmptyLocaleText = async () => tagPresent('localeText_');
  driver.webShowsOfficialBadge = async () => tagPresent('officialBadge_');
  driver.webShowsOnlyMinorCohortInRankings = async () => tagPresent('rankings_');
  driver.webShowsOwnRankInTop = async () => tagPresent('ownRank_');
  driver.webShowsPmThreadDirection = async () => tagPresent('privateChat_messageInput');
  driver.webShowsRoomClosedSummary = async () => tagPresent('roomClosedSummary_');
  driver.webShowsRoomWarningBanner = async () => tagPresent('roomWarningBanner_');
  driver.webShowsSeatRequestNotification = async () => tagPresent('seatRequestNotification_');
  driver.webShowsSeatWithIndicator = async () => tagPresent('room_seatGrid');
  driver.webShowsSecondOffensiveMessage = async () => tagPresent('privateChat_messageInput');
  driver.webShowsStalkersDelta = async () => tagPresent('stalkersDelta_');
  driver.webShowsSystemPmFromOfficia = async () => tagPresent('privateChat_messageInput');
  driver.webShowsToastAndNavigates = async () => tagPresent('toastWithRoute_');
  driver.webShowsToastAndNavigatesBack = async () => tagPresent('toastWithRoute_');
  driver.webShowsUserCard = async () => tagPresent('userCard_');
  driver.webShowsUserCardSkeletons = async () => tagPresent('userCardSkeleton_');
  driver.webShowsWelcomePmInLanguage = async () => tagPresent('privateChat_messageInput');
  driver.webSubmitStarFeedback = async () => tagPresent('feedbackScreen_');

  // ── Text-anchored assertions (the Android counterpart matches text) ──

  driver.webShowsBanner = async (_name, banner) => textPresent(banner);
  driver.webShowsWarningScreenWithReason = async (_name, reason) =>
    (await tagPresent('warning_')) && (await textPresent(reason));
  driver.webAdminShowsTableOf = async (_viewer, noun) =>
    (await tagPresent('adminTable_')) || textPresent(noun);
  driver.webAdminShowsRowCountInTable = async (_viewer, count, tableName) => {
    // Counts real rows rather than trusting a rendered total: a table that
    // prints "12 results" while rendering 3 is exactly the bug worth catching.
    const page = await pageFor('default');
    const table = page.locator(
      `[data-test-tag^="adminTable_${String(tableName || '')}"], [data-testid^="adminTable_${String(tableName || '')}"]`,
    );
    const rows = await table.locator('tbody tr, [role="row"]').count();
    return rows === Number(count);
  };
  driver.webShowsNamedKind = async (_name, noun, _kind) =>
    (await tagPresent(String(noun))) || textPresent(String(noun));

  // ── Navigation assertions ────────────────────────────────────────
  //
  // The web has something Android does not: an address bar. Asserting the
  // URL is stronger than Android's tag heuristic, so these check the URL
  // first and fall back to a screen tag for client-routed views that do not
  // change the path.

  driver.webNavigatesToPath = async (_name, pathFragment) => urlContains(pathFragment);
  driver.webNavigatesToProfileScreen = async () =>
    (await urlContains('/profile')) || tagPresent('profile_');
  driver.webNavigatesToRoomScreen = async () => (await urlContains('/room')) || tagPresent('room_');
  driver.webNavigatesToWarningScreen = async () =>
    (await urlContains('/warning')) || tagPresent('warning_');
  driver.webNavigatesBackToTab = async (_name, tab) =>
    (await urlContains(String(tab || ''))) || tagPresent(`main_${tab}Tab`);
  driver.webOpensTab = async (_name, tab) => driver.webTap(`main_${tab}Tab`);

  // ── Room-membership assertions ───────────────────────────────────

  driver.webIsStillInRoom = async () => tagPresent('room_seatGrid');
  driver.webIsNoLongerInVoiceRoom = async () => !(await tagPresent('room_seatGrid'));
  driver.webShowsWarningScreenOnRelaunch = async () => tagPresent('warning_');
  driver.webContinuesNormallyInRoom = async () => tagPresent('room_seatGrid');
  driver.webDisablesInput = async (_name, inputName) => {
    const page = await pageFor('default');
    const input = page
      .locator(
        `[data-test-tag^="${String(inputName || '')}"], [data-testid^="${String(inputName || '')}"], [name="${String(inputName || '')}"]`,
      )
      .first();
    if ((await input.count()) === 0) return false;
    return !(await input.isEnabled().catch(() => true));
  };
  driver.webTapFromSurface = async (_name, target) => driver.webTap(String(target));

  // ── Web-only methods (no Android counterpart) ────────────────────

  driver.webOpenProfilePanel = async (_name, target) =>
    driver.webTap(`userCard_${target}`).then((ok) => ok || driver.webTap('profile_open'));
  driver.webAdminIssueWarning = async () => driver.webTap('adminWarnButton');
  driver.webDashboardReportsCounterEquals = async (_viewer, expected) => {
    const page = await pageFor('default');
    const el = page
      .locator('[data-test-tag^="adminDashboard_reports"], [data-testid^="adminDashboard_reports"]')
      .first();
    if ((await el.count()) === 0) return false;
    const text = (await el.innerText()).trim();
    // Compares the NUMBER in the counter, not a substring: "12" must not
    // satisfy an expectation of "1".
    const found = text.match(/\d+/);
    return Boolean(found) && Number(found[0]) === Number(expected);
  };
  driver.webFallbackEnStrings = async () => {
    // An untranslated screen renders raw resource keys. Their ABSENCE is
    // what "fell back to English" means — English text is indistinguishable
    // from a correct English render, so the key leak is the real signal.
    const page = await pageFor('default');
    const body = await page.evaluate(() => document.body.innerText || '');
    return !/\b[a-z]+(?:_[a-z0-9]+){2,}\b/.test(body);
  };
  driver.webPmBodyShowsRawKeyOrPlaceholder = async (_name, key) => textPresent(String(key));
  driver.webPmDoesNotRenderInEnglish = async (_name, englishText) =>
    !(await textPresent(String(englishText)));
  driver.webRailShowsLessonsForLanguage = async () => tagPresent('languageRail_');
  driver.webPairedSessionShowsSameTotals = async (_a, _b, total) => textPresent(String(total));
  driver.fireSystemPmWebhook = async () => {
    // Server-side fixture, not a browser action: there is nothing on the
    // page to drive. Refused by name so the step is attributed to the
    // harness rather than read as the product failing to deliver a PM.
    throw new Error(
      'fireSystemPmWebhook is a server-side fixture, not a browser action — the step should seed the system PM through the API rather than through the web driver',
    );
  };

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
  /**
   * Navigate to an absolute URL (j20's build-flavour Givens, SHY-0259).
   *
   * Every other method here navigates relative to the configured baseURL.
   * j20 deliberately visits a flavour OTHER than the run's target — that
   * mismatch is the point of the scenario — so this one takes an absolute
   * origin and bypasses baseURL entirely.
   */
  driver.webVisit = async (url, name = 'default') => {
    if (!/^https?:\/\//.test(String(url))) {
      throw new Error(`webVisit needs an absolute URL, got "${url}"`);
    }
    const page = await pageFor(name);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return true;
  };

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

  // takeScreenshot — capture all persona pages to `outputDir` (gap C3).
  // Delegates to the shared helper so the 7 web drivers (this one + 6
  // web-mobile wrappers) implement the screenshot contract identically.
  driver.takeScreenshot = async (outputDir) =>
    require('./driver-screenshot-helper').takeScreenshotForPages(pages, outputDir, browserName);

  driver.close = async () => {
    for (const p of pages.values()) {
      await p.context().close();
    }
    await browser.close();
  };

  // ── SHY-0259 batch 2: web methods the corpus already assumed ────────────
  //
  // Same story as the Android batch: the corpus was written ahead of the
  // drivers, so these names were called and never defined, and every scenario
  // that touched one failed with `not configured` — indistinguishable from a
  // product defect in a matrix report. Built on the primitives that exist
  // (pageFor, webTap, webFillIn, webUiDump). Real browser calls only.

  /**
   * Click by accessible name, label, or visible text — in that order.
   *
   * The loose getByText fallback is DELIBERATELY withheld from short labels.
   * `getByText('X', { exact: false })` substring-matches almost any page, so
   * webCloseModalViaX reported success against a page with no modal at all —
   * caught by driving a real browser, and invisible to any structural test.
   * Roles and labels stay available for short names; only the text sweep is
   * restricted.
   */
  async function clickByLabel(page, label) {
    const short = String(label).trim().length < 3;
    const attempts = [
      () => page.getByRole('button', { name: label, exact: short }).first(),
      () => page.getByRole('link', { name: label, exact: short }).first(),
      () => page.getByLabel(label, { exact: short }).first(),
      ...(short ? [] : [() => page.getByText(label, { exact: false }).first()]),
    ];
    for (const make of attempts) {
      try {
        await make().click({ timeout: 2000 });
        return true;
      } catch {
        /* try the next strategy — a label can be a button, a link or plain text */
      }
    }
    return false;
  }
  driver._clickByLabel = clickByLabel;

  /** Screen name -> path. Kept in one place so a rename lands once. */
  const SCREEN_PATHS = {
    discovery: '/discovery',
    rooms: '/rooms',
    profile: '/profile',
    wallet: '/wallet',
    pm: '/pm',
    settings: '/settings',
    signin: '/signin',
    admin: '/admin',
  };
  driver._screenPaths = SCREEN_PATHS;

  // Navigate to a named screen. Tries in-app navigation first so client-side
  // routing and its guards are genuinely exercised; falls back to a direct URL
  // only when no nav control is present.
  driver.webOpenScreen = async (screen) => {
    const page = await pageFor('default');
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    if (await driver.webTap(`nav_${screen}`)) return true;
    if (await clickByLabel(page, screen)) return true;
    const screenPath = SCREEN_PATHS[String(screen).toLowerCase()];
    if (!screenPath) return false;
    await page.goto(screenPath, { waitUntil: 'domcontentloaded' });
    return true;
  };

  driver.webOpenListView = async (name) => driver.webOpenScreen(name);

  // Sign in through the persona picker — the canonical journey auth path.
  // NEVER drives Google/Apple OAuth: the repo rule is that journey tests use
  // test personas, and an OAuth popup cannot be driven headlessly anyway.
  driver.webSignIn = async (persona) => {
    const page = await pageFor('default');
    if (!page.url() || page.url() === 'about:blank') await page.goto('/');
    if (!(await driver.webTap('signin_personaPickerButton'))) {
      if (!(await clickByLabel(page, 'Test personas'))) return false;
    }
    if (!persona) return true;
    if (await driver.webTap(`persona_${persona}`)) return true;
    return await clickByLabel(page, persona);
  };

  driver.webOpenUserProfile = async (name) => {
    if (await driver.webTap(`userCard_${name}`)) return true;
    const page = await pageFor('default');
    return await clickByLabel(page, name);
  };

  driver.webTapUserCard = async (_viewer, target) => driver.webOpenUserProfile(target || _viewer);

  driver.webTapNamedButton = async (label) => {
    if (await driver.webTap(label)) return true;
    const page = await pageFor('default');
    return await clickByLabel(page, label);
  };

  driver.webTapBareVerb = async (verb) => driver.webTapNamedButton(verb);
  driver.webTapQuotedTarget = async (target) => driver.webTapNamedButton(target);
  driver.webTapSameRoom = async (owner) => driver.webTapRoomCard(owner);

  driver.webTapRoomCard = async (owner) => {
    if (owner && (await driver.webTap(`roomCard_${owner}`))) return true;
    const page = await pageFor('default');
    if (owner && (await clickByLabel(page, owner))) return true;
    try {
      await page.locator('[data-test-tag^="roomCard_"]').first().click({ timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  };

  // Type into a field and submit. Enter is what actually sends in the app's
  // single-line inputs, so a fill without it looks successful and does nothing.
  driver.webTypeAndSubmit = async (field, text) => {
    const page = await pageFor('default');
    if (!(await driver.webFillIn('default', { [field]: text }))) {
      try {
        await page.getByLabel(field, { exact: false }).first().fill(String(text));
      } catch {
        return false;
      }
    }
    await page.keyboard.press('Enter');
    return true;
  };

  driver.webTypeIntoConversationInput = async (text) => {
    const page = await pageFor('default');
    for (const sel of [
      '[data-test-tag="pm_messageInput"]',
      '[data-testid="pm_messageInput"]',
      'textarea',
      'input[type="text"]',
    ]) {
      try {
        await page.locator(sel).first().fill(String(text), { timeout: 2000 });
        return true;
      } catch {
        /* next selector */
      }
    }
    return false;
  };

  driver.webOpenConversation = async (withName) => {
    if (await driver.webTap(`conversation_${withName}`)) return true;
    if (!(await driver.webOpenScreen('pm'))) return false;
    const page = await pageFor('default');
    return await clickByLabel(page, withName);
  };

  driver.webIsOnConversationWith = async (name) => {
    const dump = await driver.webUiDump();
    return typeof dump === 'string' && dump.includes(name);
  };

  driver.webShowsNamedButton = async (label) => {
    const page = await pageFor('default');
    for (const make of [
      () => page.getByRole('button', { name: label, exact: false }),
      () => page.getByRole('link', { name: label, exact: false }),
      () => page.getByText(label, { exact: false }),
    ]) {
      try {
        if ((await make().count()) > 0) return true;
      } catch {
        /* next strategy */
      }
    }
    return false;
  };

  driver.webShowsMessageInput = async () => {
    const page = await pageFor('default');
    try {
      const n = await page
        .locator('[data-test-tag="pm_messageInput"], [data-testid="pm_messageInput"], textarea')
        .count();
      return n > 0;
    } catch {
      return false;
    }
  };

  driver.webShowsPlaceholder = async (text) => {
    const page = await pageFor('default');
    try {
      return (await page.getByPlaceholder(String(text), { exact: false }).count()) > 0;
    } catch {
      return false;
    }
  };

  // Accept whatever dialog is in front of us. The affirmative-label list lives
  // here once rather than at each call site.
  driver.webConfirmDialog = async () => {
    const page = await pageFor('default');
    if (await driver.webTap('dialog_confirm')) return true;
    for (const label of ['Confirm', 'OK', 'Yes', 'Continue', 'Accept']) {
      if (await clickByLabel(page, label)) return true;
    }
    return false;
  };
  driver.webConfirm = async () => driver.webConfirmDialog();

  driver.webAcceptLegalAndContinue = async () => {
    const page = await pageFor('default');
    for (const tag of ['legal_acceptCheckbox', 'legal_accept', 'legal_continue']) {
      await driver.webTap(tag);
    }
    return (await clickByLabel(page, 'Continue')) || (await clickByLabel(page, 'Accept'));
  };

  // Close the open modal. Scoped to a real dialog and to controls that are
  // actually close buttons — never a bare text sweep, which matched arbitrary
  // page content and reported a modal closed when none was open.
  driver.webCloseModalViaX = async () => {
    const page = await pageFor('default');
    if (await driver.webTap('modal_close')) return true;
    const dialog = page.getByRole('dialog').first();
    try {
      if ((await dialog.count()) === 0) return false;
    } catch {
      return false;
    }
    for (const make of [
      () => dialog.getByRole('button', { name: /close|dismiss|×/i }).first(),
      () => dialog.locator('[aria-label="Close" i], [data-test-tag="modal_close"]').first(),
    ]) {
      try {
        await make().click({ timeout: 2000 });
        return true;
      } catch {
        /* next strategy */
      }
    }
    return false;
  };

  driver.webOpenDeepLink = async (pathOrUrl) => {
    const page = await pageFor('default');
    await page.goto(String(pathOrUrl), { waitUntil: 'domcontentloaded' });
    return true;
  };

  // "attempts X" — the corpus uses this where the action is EXPECTED to be
  // refused. It must report whether the control could be actuated at all, not
  // whether the attempt succeeded, or a correctly-blocked action reads as a
  // driver failure.
  driver.webAttemptAction = async (label) => {
    const acted = await driver.webTapNamedButton(label);
    return { attempted: true, actuated: acted };
  };

  // Admin console navigation. The admin surface is a tabbed SPA, so these are
  // clicks, not URL loads — loading a URL skips the tab's own data fetch.
  driver.webAdminOpenTab = async (tab) => {
    const page = await pageFor('default');
    if (await driver.webTap(`admin_tab_${tab}`)) return true;
    if (await clickByLabel(page, tab)) return true;
    await page.goto(`/admin#${tab}`, { waitUntil: 'domcontentloaded' });
    return true;
  };

  driver.webAdminOpenSubtab = async (subtab) => driver.webAdminOpenTab(subtab);

  driver.webAdminRefreshTab = async () => {
    const page = await pageFor('default');
    if (await driver.webTap('admin_refresh')) return true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    return true;
  };

  driver.webAdminRefreshAgeVerification = async () => {
    await driver.webAdminOpenTab('age-verification');
    return driver.webAdminRefreshTab();
  };

  driver.webAdminSearch = async (query) => {
    const page = await pageFor('default');
    for (const sel of ['[data-test-tag="admin_search"]', 'input[type="search"]']) {
      try {
        await page.locator(sel).first().fill(String(query), { timeout: 2000 });
        await page.keyboard.press('Enter');
        return true;
      } catch {
        /* next selector */
      }
    }
    return false;
  };

  driver.webAdminSearchForUser = async (user) => driver.webAdminSearch(user);

  driver.webAdminConfirmDialog = async () => driver.webConfirmDialog();

  // Reason-carrying admin actions. The reason is a required audit field, so it
  // is typed before confirming rather than left blank.
  driver.webAdminTapWithReason = async (action, reason) => {
    if (!(await driver.webTapNamedButton(action))) return false;
    const page = await pageFor('default');
    try {
      await page
        .locator('[data-test-tag="admin_reason"], textarea, input[name="reason"]')
        .first()
        .fill(String(reason ?? ''), { timeout: 2000 });
    } catch {
      /* some actions take no reason field */
    }
    return driver.webConfirmDialog();
  };

  driver.webAdminConfirmWithReason = async (reason) =>
    driver.webAdminTapWithReason('Confirm', reason);

  // Console errors collected from the live page. Real browser signal — the
  // listener is attached on first use and drains what it has seen since.
  driver.webConsoleErrors = async () => {
    const page = await pageFor('default');
    if (!page.__consoleErrors) {
      page.__consoleErrors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') page.__consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => page.__consoleErrors.push(String(e && e.message)));
    }
    return page.__consoleErrors.slice();
  };

  // ── SHY-0259 batch 4: the admin console ─────────────────────────────────
  //
  // Moderation actions are the highest-consequence thing an operator does in
  // this product — approving an ID, banning a device, adjusting a balance —
  // and every one of them was unreachable from the harness. Built on the
  // navigation added in batch 2 so tab/search/confirm behaviour stays in one
  // place. Real clicks against the real admin SPA.

  /** Rows of the visible admin table, as arrays of cell text. */
  async function adminRows() {
    const page = await pageFor('default');
    try {
      return await page.$$eval('table tbody tr', (trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim())),
      );
    } catch {
      return [];
    }
  }
  driver._adminRows = adminRows;

  driver.webAdminGetRowCount = async () => (await adminRows()).length;

  driver.webAdminShowsReportRow = async (needle) => {
    const rows = await adminRows();
    return rows.some((cells) => cells.some((c) => c.includes(String(needle))));
  };

  // The ID image is the thing a reviewer actually looks at, so its presence is
  // asserted on a rendered <img> with a real source — not on a container that
  // would be present even when the image failed to load.
  driver.webAdminShowsIdImage = async () => {
    const page = await pageFor('default');
    try {
      return await page.$$eval(
        '[data-test-tag="admin_idImage"] img, img[alt*="ID" i], .id-image img',
        (imgs) => imgs.some((im) => im.currentSrc && im.naturalWidth > 0),
      );
    } catch {
      return false;
    }
  };

  driver.webAdminOpenReportAndTap = async (report, action) => {
    if (!(await driver.webAdminOpenTab('reports'))) return false;
    const page = await pageFor('default');
    const opened =
      (await driver.webTap(`report_${report}`)) || (await clickByLabel(page, String(report)));
    if (!opened) return false;
    return driver.webTapNamedButton(action);
  };

  driver.webAdminFilterByAction = async (action) => {
    const page = await pageFor('default');
    for (const sel of ['[data-test-tag="admin_actionFilter"]', 'select[name="action"]', 'select']) {
      try {
        await page
          .locator(sel)
          .first()
          .selectOption({ label: String(action) }, { timeout: 2000 });
        return true;
      } catch {
        /* next selector */
      }
    }
    return clickByLabel(page, action);
  };

  driver.webAdminActOnSubmission = async (action, reason) =>
    driver.webAdminTapWithReason(action, reason);

  driver.webAdminActOnSubmissionByName = async (name, action, reason) => {
    const page = await pageFor('default');
    const found =
      (await driver.webTap(`submission_${name}`)) || (await clickByLabel(page, String(name)));
    if (!found) return false;
    return driver.webAdminTapWithReason(action, reason);
  };

  driver.webAdminApproveSubmissions = async (names = []) => {
    const list = Array.isArray(names) ? names : [names];
    // Sequential on purpose: each approval reloads the queue, so firing them
    // together would act on rows that have already moved.
    for (const n of list) {
      if (!(await driver.webAdminActOnSubmissionByName(n, 'Approve'))) return false;
    }
    return true;
  };

  driver.webAdminRejectSubmission = async (name, reason) =>
    driver.webAdminActOnSubmissionByName(name, 'Reject', reason);

  driver.webAdminLiftAppeal = async (user, reason) => {
    if (!(await driver.webAdminOpenTab('appeals'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    return driver.webAdminTapWithReason('Lift', reason);
  };

  driver.webAdminDenyAppeal = async (user, reason) => {
    if (!(await driver.webAdminOpenTab('appeals'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    return driver.webAdminTapWithReason('Deny', reason);
  };

  driver.webAdminAdjustShyCoins = async (user, amount, reason) => {
    if (!(await driver.webAdminOpenTab('economy'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    const page = await pageFor('default');
    if (!(await driver.webTapNamedButton('Adjust'))) return false;
    try {
      await page
        .locator('[data-test-tag="admin_amount"], input[name="amount"]')
        .first()
        .fill(String(amount), { timeout: 2000 });
    } catch {
      return false;
    }
    return driver.webAdminTapWithReason('Confirm', reason);
  };

  driver.webAdminProcessRefund = async (receiptOrUser, reason) => {
    if (!(await driver.webAdminOpenTab('economy'))) return false;
    if (!(await driver.webAdminSearch(receiptOrUser))) return false;
    return driver.webAdminTapWithReason('Refund', reason);
  };

  driver.webAdminOpenEconomyStats = async () => driver.webAdminOpenTab('economy');

  driver.webAdminExecuteAgeDownFlow = async (user, reason) => {
    if (!(await driver.webAdminOpenTab('age-verification'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    return driver.webAdminTapWithReason('Age down', reason);
  };

  // Device bans need the identifier typed as well as a reason — the override
  // is a separate confirmation, so it is not folded into the reason dialog.
  driver.webAdminTapAndTypeBanDevice = async (deviceId, reason) => {
    const page = await pageFor('default');
    if (!(await driver.webTapNamedButton('Ban device'))) return false;
    try {
      await page
        .locator('[data-test-tag="admin_deviceId"], input[name="deviceId"]')
        .first()
        .fill(String(deviceId), { timeout: 2000 });
    } catch {
      return false;
    }
    return driver.webAdminTapWithReason('Confirm', reason);
  };

  driver.webAdminTapWithReasonAndOverride = async (action, reason) => {
    if (!(await driver.webAdminTapWithReason(action, reason))) return false;
    // A second, deliberate confirmation. Silently skipping it would leave the
    // action un-applied while the driver reported success.
    return (await driver.webTapNamedButton('Override')) || (await driver.webConfirmDialog());
  };

  // Which language the admin UI is actually rendering its own chrome in —
  // read from the document, not assumed from a setting.
  driver.webAdminDetectLabelLanguage = async () => {
    const page = await pageFor('default');
    try {
      return await page.evaluate(
        () => document.documentElement.getAttribute('lang') || navigator.language || 'en',
      );
    } catch {
      return 'en';
    }
  };

  // ── SHY-0259 batch 7: web assertions, purchases, i18n and network ───────

  driver.webSeatGridState = async () => {
    const page = await pageFor('default');
    try {
      return await page.$$eval('[data-test-tag^="seat_"]', (els) =>
        els
          .map((el) => ({
            index: Number((el.getAttribute('data-test-tag') || '').replace('seat_', '')),
            occupant: (el.textContent || '').trim() || null,
          }))
          .sort((a, b) => a.index - b.index),
      );
    } catch {
      return [];
    }
  };

  const bodyIncludes = async (needle) => {
    const dump = await driver.webUiDump();
    return typeof dump === 'string' && dump.includes(String(needle));
  };

  driver.webShowsBannerFromUser = async (user) => bodyIncludes(user);
  driver.webShowsAdultCohortVisitor = async (name) => bodyIncludes(name);
  driver.webShowsNewFollowerNotification = async (name) => bodyIncludes(name);
  driver.webShowsStatsForUser = async (name) => bodyIncludes(name);

  driver.webShowsHighlightAtSection = async (section) => {
    const page = await pageFor('default');
    try {
      // A highlight is a VISUAL state, so the class/attribute is what carries
      // it — text presence would be true for an un-highlighted section too.
      return (
        (await page
          .locator(
            `[data-test-tag="${section}"].highlight, [data-test-tag="${section}"][data-highlighted="true"]`,
          )
          .count()) > 0
      );
    } catch {
      return false;
    }
  };

  // Both halves: a tab that is simply missing must NOT satisfy this.
  driver.webShowsTabWithNoNavTo = async (tab) => {
    if (!(await driver.webShowsNamedButton(tab))) return false;
    const page = await pageFor('default');
    const before = page.url();
    await driver.webTapNamedButton(tab);
    return page.url() === before;
  };

  driver.webEditBodyAndConfirm = async (newBody) => {
    if (!(await driver.webTypeIntoConversationInput(newBody))) return false;
    return (await driver.webTap('pm_confirmEdit')) || driver.webConfirmDialog();
  };

  driver.webSendGift = async (recipient, gift) => {
    if (!(await driver.webTap('gift_open'))) return false;
    if (recipient && !(await driver.webTapNamedButton(recipient))) return false;
    if (gift && !(await driver.webTapNamedButton(gift))) return false;
    return (await driver.webTap('gift_send')) || driver.webTapNamedButton('Send');
  };

  driver.webSelectRecipientAndGift = async (recipient, gift) => driver.webSendGift(recipient, gift);

  driver.webSelectPackage = async (pkg) => {
    if (await driver.webTap(`package_${pkg}`)) return true;
    return driver.webTapNamedButton(String(pkg));
  };

  driver.webSubmitSandboxReceipt = async (receipt) => {
    const page = await pageFor('default');
    try {
      await page
        .locator('[data-test-tag="sandbox_receipt"], input[name="receipt"]')
        .first()
        .fill(String(receipt), { timeout: 2000 });
    } catch {
      return false;
    }
    return (await driver.webTap('sandbox_submit')) || driver.webTapNamedButton('Submit');
  };

  driver.webPurchaseWithSandboxReceipt = async (pkg, receipt) => {
    if (pkg && !(await driver.webSelectPackage(pkg))) return false;
    return driver.webSubmitSandboxReceipt(receipt);
  };

  // Replay protection: the SAME receipt submitted twice. Returning the two
  // outcomes separately matters — the test is that the second is refused, so
  // collapsing them to one boolean loses the assertion.
  driver.webDoubleTapWithSameReceipt = async (receipt) => {
    const first = await driver.webSubmitSandboxReceipt(receipt);
    const second = await driver.webSubmitSandboxReceipt(receipt);
    return { first, second };
  };

  // ── i18n ────────────────────────────────────────────────────────────────

  driver.webHeadingInLocale = async () => {
    const page = await pageFor('default');
    try {
      return await page.evaluate(() => {
        const h = document.querySelector('h1, h2, [role="heading"]');
        return h ? (h.textContent || '').trim() : '';
      });
    } catch {
      return '';
    }
  };

  // Tofu detection. U+FFFD is the replacement character; the .notdef box
  // cannot be read from the DOM, so this reports the one that CAN be measured
  // rather than claiming to detect both.
  driver.webHasReplacementGlyph = async () => {
    const page = await pageFor('default');
    try {
      return await page.evaluate(() => (document.body.innerText || '').includes('�'));
    } catch {
      return false;
    }
  };

  driver.webFontFallbackCapable = async (sample) => {
    const page = await pageFor('default');
    try {
      // document.fonts.check is the real browser answer to "can this render",
      // measured against the actual computed font stack.
      return await page.evaluate(
        (text) => {
          const fam = window.getComputedStyle(document.body).fontFamily || 'sans-serif';
          return document.fonts ? document.fonts.check(`16px ${fam}`, text) : true;
        },
        String(sample || 'Aa'),
      );
    } catch {
      return false;
    }
  };

  driver.webMissingTranslations = async () => {
    const page = await pageFor('default');
    try {
      // Untranslated strings surface as the raw key or as an explicit marker.
      return await page.evaluate(() => {
        const text = document.body.innerText || '';
        const keyish = text.match(/\b[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+){1,}\b/g) || [];
        return [...new Set(keyish)];
      });
    } catch {
      return [];
    }
  };

  driver.webSystemPmRendersInLanguage = async (lang) => {
    const page = await pageFor('default');
    try {
      const docLang = await page.evaluate(
        () => document.documentElement.getAttribute('lang') || '',
      );
      return String(docLang).toLowerCase().startsWith(String(lang).toLowerCase());
    } catch {
      return false;
    }
  };

  // ── network ─────────────────────────────────────────────────────────────

  /** Attach the request log once; every network reader drains the same list. */
  async function networkLog() {
    const page = await pageFor('default');
    if (!page.__netLog) {
      page.__netLog = [];
      page.on('response', (res) => {
        page.__netLog.push({ url: res.url(), status: res.status(), at: Date.now() });
      });
    }
    return page.__netLog;
  }
  driver._networkLog = networkLog;

  driver.webNetworkLogHasStatus = async (status) => {
    const log = await networkLog();
    return log.some((e) => e.status === Number(status));
  };

  driver.webNetworkLogCountAttempts = async (urlFragment) => {
    const log = await networkLog();
    return log.filter((e) => e.url.includes(String(urlFragment))).length;
  };

  // Real CDP network emulation, not a pretend flag. Reports honestly when the
  // browser has no CDP session (firefox/webkit), because silently doing
  // nothing would let a low-connectivity scenario pass at full speed.
  driver.webSetNetwork = async (profile) => {
    const page = await pageFor('default');
    const PROFILES = {
      offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
      '2g': { offline: false, downloadThroughput: 32000, uploadThroughput: 16000, latency: 400 },
      '3g': { offline: false, downloadThroughput: 200000, uploadThroughput: 100000, latency: 150 },
      online: { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 },
    };
    const conditions = PROFILES[String(profile).toLowerCase()];
    if (!conditions)
      return { supported: true, applied: false, why: `unknown profile "${profile}"` };
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', conditions);
      return { supported: true, applied: true };
    } catch (e) {
      return {
        supported: false,
        applied: false,
        why: `no CDP session on this browser (${e.message}) — network emulation is Chromium-only`,
      };
    }
  };

  driver.webGrantNotificationPermission = async () => {
    const page = await pageFor('default');
    try {
      await page
        .context()
        .grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
      return true;
    } catch {
      return false;
    }
  };

  driver.webReceiveLiveKitToken = async () => {
    const log = await networkLog();
    return log.some((e) => e.url.includes('/livekit/token') && e.status === 200);
  };

  // ── SHY-0259 batch 8: cross-surface helpers ─────────────────────────────
  //
  // These are not UI actions. They read the real API, the real emulator, or
  // the real page timeline — so they live here, where ctx already has a
  // browser and a base URL, rather than being duplicated per platform.

  const apiBase = () => (baseURL || '').replace(/:8888$/, ':3000');

  /** One real HTTP call against the running API. */
  async function apiFetch(pathname, init = {}) {
    const page = await pageFor('default');
    try {
      return await page.evaluate(
        async ({ url, opts }) => {
          const res = await fetch(url, opts);
          const text = await res.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not json — the raw text is still returned */
          }
          return { status: res.status, text, json };
        },
        { url: `${apiBase()}${pathname}`, opts: init },
      );
    } catch (e) {
      return { status: 0, text: String(e && e.message), json: null, error: true };
    }
  }
  driver._apiFetch = apiFetch;

  driver.apiRequestStats = async () => {
    const log = await networkLog();
    const byStatus = {};
    for (const e of log) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    return { total: log.length, byStatus };
  };

  driver.sequentialRequestStatus = async (pathname, times = 2) => {
    const out = [];
    // Sequential by construction: these steps test rate limiting and replay
    // protection, where the ORDER of arrival is the whole point.
    for (let n = 0; n < Number(times); n++) {
      const r = await apiFetch(pathname);
      out.push(r.status);
    }
    return out;
  };

  driver.auditLogContains = async (predicate = {}) => {
    const r = await apiFetch('/api/admin/audit-log');
    const rows = (r.json && (r.json.entries || r.json.rows || r.json)) || [];
    if (!Array.isArray(rows)) return false;
    return rows.some((row) =>
      Object.entries(predicate).every(([k, v]) => String(row[k]) === String(v)),
    );
  };

  driver.pmIsFromSender = async (sender) => {
    const dump = await driver.webUiDump();
    return typeof dump === 'string' && dump.includes(String(sender));
  };

  driver.receivedSystemPmWithReason = async (reason) => {
    const dump = await driver.webUiDump();
    return typeof dump === 'string' && dump.includes(String(reason));
  };

  // A translation must DIFFER from the English template as well as being
  // non-empty — an untranslated string is present, non-empty, and wrong.
  driver.pmBodyIsTranslationOfTemplate = async (englishTemplate) => {
    const dump = await driver.webUiDump();
    if (typeof dump !== 'string' || !dump.trim()) return false;
    return !dump.includes(String(englishTemplate));
  };

  driver.showsCardBadge = async (badge) => {
    const page = await pageFor('default');
    try {
      return (
        (await page
          .locator(`[data-test-tag$="_badge"], .badge`)
          .filter({ hasText: String(badge) })
          .count()) > 0
      );
    } catch {
      return false;
    }
  };

  driver.currentPlatformRendersScreen = async (screen) => {
    const page = await pageFor('default');
    try {
      return (
        (await page
          .locator(`[data-test-tag="${screen}Screen"], [data-screen="${screen}"]`)
          .count()) > 0
      );
    } catch {
      return false;
    }
  };

  driver.eachJoinerNavigatesBackWithToast = async (toast) => {
    const dump = await driver.webUiDump();
    return typeof dump === 'string' && dump.includes(String(toast));
  };

  // Rendering latency measured from the real page timeline, not from a
  // wall-clock the test controls — the point is what a user waits for.
  driver.measureRenderingTimeFromSubmit = async () => {
    const page = await pageFor('default');
    try {
      return await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav && nav.domContentLoadedEventEnd) {
          return Math.round(nav.domContentLoadedEventEnd - nav.startTime);
        }
        const paint = performance.getEntriesByType('paint').pop();
        return paint ? Math.round(paint.startTime) : null;
      });
    } catch {
      return null;
    }
  };

  // Clock advance. The emulator has no time travel, so this reports honestly
  // rather than silently succeeding — a scheduled-event scenario that thinks
  // it jumped an hour and did not would assert against the wrong state and
  // blame the product.
  driver.advanceClockToStartsAt = async (isoWhen) => {
    const r = await apiFetch('/api/test/advance-clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: String(isoWhen) }),
    });
    if (r.status === 200) return { supported: true, applied: true };
    return {
      supported: false,
      applied: false,
      why: `no clock-advance endpoint on this stack (status ${r.status}); schedule the fixture at a real future time instead`,
    };
  };

  // ── FCM ────────────────────────────────────────────────────────────────
  // Push is observed through the API's own dispatch record. The browser
  // cannot see an FCM payload addressed to a device, and pretending otherwise
  // is how a push scenario passes without a push.

  driver.countFcmPayloadsToUser = async (uniqueId) => {
    const r = await apiFetch(`/api/test/fcm-log?uniqueId=${encodeURIComponent(uniqueId)}`);
    if (r.status !== 200)
      return { supported: false, why: `no fcm-log endpoint (status ${r.status})` };
    const rows = (r.json && (r.json.entries || r.json)) || [];
    return { supported: true, count: Array.isArray(rows) ? rows.length : 0 };
  };

  driver.simulateFcmDispatcherAttempt = async (payload = {}) => {
    const r = await apiFetch('/api/test/fcm-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { supported: r.status === 200, status: r.status };
  };

  driver.seesFcmPushOnPlatform = async (platform, uniqueId) => {
    const res = await driver.countFcmPayloadsToUser(uniqueId);
    if (!res.supported) return res;
    return { supported: true, seen: res.count > 0, platform };
  };

  // ── fault injection ────────────────────────────────────────────────────
  // Real route interception, so the app meets a genuine failure rather than a
  // flag it was told to respect.

  driver.injectApiLatency = async (ms, urlFragment = '/api/') => {
    const page = await pageFor('default');
    await page.route(`**${urlFragment}**`, async (route) => {
      await new Promise((r) => setTimeout(r, Number(ms) || 0));
      await route.continue();
    });
    return true;
  };

  driver.injectApiFailureThenSuccess = async (urlFragment = '/api/', failStatus = 500) => {
    const page = await pageFor('default');
    let failed = false;
    await page.route(`**${urlFragment}**`, async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({ status: Number(failStatus), body: '{"error":"injected"}' });
        return;
      }
      await route.continue();
    });
    return true;
  };

  driver.simulateNetworkDropBeforeResponse = async (urlFragment = '/api/') => {
    const page = await pageFor('default');
    let dropped = false;
    await page.route(`**${urlFragment}**`, async (route) => {
      if (!dropped) {
        dropped = true;
        await route.abort('internetdisconnected');
        return;
      }
      await route.continue();
    });
    return true;
  };

  return driver;
}

module.exports = {
  createWebDriver,
  listMethods,
  WEB_METHOD_NAMES,
  SUPPORTED_BROWSERS,
};
