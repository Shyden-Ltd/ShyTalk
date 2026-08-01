/* eslint-disable no-console -- driver diagnostics go to the operator's terminal, matching every other driver in this directory. */
/**
 * Web driver methods shared by EVERY web surface.
 *
 * SHY-0259, second pass. The first pass added ~50 methods to
 * web-playwright-driver.js and stopped there — but the matrix has SEVEN web
 * drivers (desktop Playwright, four mobile-*-android over CDP, two
 * mobile-*-ios over Appium). The other six still failed with
 * `ctx.webDriver.webOpenScreen not configured`, and my coverage guard did not
 * notice because it scanned the UNION of all driver files: a method present in
 * one driver counted as present for all seven. The guard is now per-driver.
 *
 * Everything here is expressed in terms of two primitives the host driver
 * supplies:
 *
 *   evaluate(fnSource, arg) -> runs JS in the page, returns the result
 *   navigate(url)           -> loads a URL
 *
 * Both exist on every web surface: Playwright has page.evaluate, Appium has
 * /execute/sync. Building on them means one real implementation rather than
 * seven, and no surface gets a degraded version that quietly does less.
 *
 * ATTACHES ONLY WHAT IS MISSING. The Playwright driver keeps its own
 * role-based locators, which are more precise than anything achievable through
 * injected JS; this fills the gaps beneath them.
 */

/** JS run inside the page. Kept as source strings so both hosts can ship them. */
const IN_PAGE = {
  // Visible-text click. Walks candidates in DOM order and clicks the first
  // whose trimmed text or aria-label matches — buttons and links before plain
  // text, because clicking a label that merely CONTAINS the word activates the
  // wrong control often enough to matter.
  clickByLabel: `(label) => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = norm(label);
    if (!want) return false;
    const groups = [
      Array.from(document.querySelectorAll('button, [role="button"], a, [role="link"]')),
      Array.from(document.querySelectorAll('[aria-label]')),
      Array.from(document.querySelectorAll('*')),
    ];
    for (const els of groups) {
      for (const el of els) {
        const text = norm(el.getAttribute && el.getAttribute('aria-label')) || norm(el.textContent);
        if (!text) continue;
        const exact = text === want;
        const partial = want.length >= 3 && text.includes(want);
        if (exact || partial) {
          if (typeof el.click === 'function') { el.click(); return true; }
        }
      }
    }
    return false;
  }`,

  clickByTag: `(tag) => {
    const el = document.querySelector(
      '[data-test-tag="' + tag + '"], [data-testid="' + tag + '"], #' + CSS.escape(tag)
    );
    if (el && typeof el.click === 'function') { el.click(); return true; }
    return false;
  }`,

  hasLabel: `(label) => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = norm(label);
    if (!want) return false;
    if (norm(document.body.innerText).includes(want)) return true;
    return Array.from(document.querySelectorAll('[aria-label]')).some(
      (el) => norm(el.getAttribute('aria-label')).includes(want)
    );
  }`,

  fillField: `(args) => {
    const { key, value } = args;
    const el = document.querySelector(
      '[data-test-tag="' + key + '"], [data-testid="' + key + '"], [name="' + key + '"], #' + CSS.escape(key)
    ) || document.querySelector('textarea, input[type="text"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    );
    // Native setter + input event, so frameworks that track value via their own
    // listeners actually see the change. A bare el.value = x is invisible to
    // React and the field silently reverts.
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }`,

  countMatching: `(selector) => document.querySelectorAll(selector).length`,

  hasEditable: `() => document.querySelectorAll(
    '[data-test-tag="pm_messageInput"], [data-testid="pm_messageInput"], textarea, input[type="text"]'
  ).length > 0`,

  seatGrid: `() => Array.from(document.querySelectorAll('[data-test-tag^="seat_"]'))
    .map((el) => ({
      index: Number((el.getAttribute('data-test-tag') || '').replace('seat_', '')),
      occupant: (el.textContent || '').trim() || null,
    }))
    .sort((a, b) => a.index - b.index)`,

  docLang: `() => document.documentElement.getAttribute('lang') || ''`,

  heading: `() => {
    const h = document.querySelector('h1, h2, [role="heading"]');
    return h ? (h.textContent || '').trim() : '';
  }`,

  hasReplacementGlyph: `() => (document.body.innerText || '').includes('\\uFFFD')`,
};

/** Screen name -> path. One copy, so a rename lands once for all seven drivers. */
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

/**
 * @param {object} driver           the driver being built
 * @param {object} host
 * @param {(src: string, arg?: any) => Promise<any>} host.evaluate
 * @param {(url: string) => Promise<boolean>} host.navigate
 * @param {string} host.baseURL
 * @param {string} host.slug        for diagnostics
 */
function attachCommonWebMethods(driver, { evaluate, navigate, baseURL, slug }) {
  // Only fill gaps — never replace a driver's own, more precise implementation.
  const def = (name, fn) => {
    if (typeof driver[name] !== 'function') driver[name] = fn;
  };

  const url = (p) => `${String(baseURL || '').replace(/\/$/, '')}${p}`;
  const evalSafe = async (src, arg) => {
    try {
      return await evaluate(src, arg);
    } catch (e) {
      console.error(`[${slug}] in-page evaluate failed: ${e.message}`);
      return null;
    }
  };

  def('webOpenScreen', async (screen) => {
    if (await evalSafe(IN_PAGE.clickByTag, `nav_${screen}`)) return true;
    if (await evalSafe(IN_PAGE.clickByLabel, screen)) return true;
    const p = SCREEN_PATHS[String(screen).toLowerCase()];
    // Refuse an unknown screen rather than guessing a path: a guess navigates
    // somewhere arbitrary and every later assertion describes the wrong page.
    if (!p) return false;
    return navigate(url(p));
  });

  def('webOpenListView', async (name) => driver.webOpenScreen(name));
  def('webOpenDeepLink', async (u) => navigate(String(u)));

  def('webTapNamedButton', async (label) => {
    if (await evalSafe(IN_PAGE.clickByTag, label)) return true;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, label));
  });
  def('webTapBareVerb', async (verb) => driver.webTapNamedButton(verb));
  def('webTapQuotedTarget', async (t) => driver.webTapNamedButton(t));
  def('webTapUserCard', async (viewer, target) => driver.webTapNamedButton(target || viewer));
  def('webOpenUserProfile', async (name) => driver.webTapNamedButton(name));
  def('webTapRoomCard', async (owner) => driver.webTapNamedButton(owner));
  def('webTapSameRoom', async (owner) => driver.webTapRoomCard(owner));

  def('webShowsNamedButton', async (label) => Boolean(await evalSafe(IN_PAGE.hasLabel, label)));
  def('webShowsPlaceholder', async (t) => Boolean(await evalSafe(IN_PAGE.hasLabel, t)));
  def('webShowsMessageInput', async () => Boolean(await evalSafe(IN_PAGE.hasEditable)));
  def('webShowsBannerFromUser', async (u) => Boolean(await evalSafe(IN_PAGE.hasLabel, u)));
  def('webShowsAdultCohortVisitor', async (n) => Boolean(await evalSafe(IN_PAGE.hasLabel, n)));
  def('webShowsNewFollowerNotification', async (n) => Boolean(await evalSafe(IN_PAGE.hasLabel, n)));
  def('webShowsStatsForUser', async (n) => Boolean(await evalSafe(IN_PAGE.hasLabel, n)));

  def('webTypeAndSubmit', async (field, text) => {
    if (!(await evalSafe(IN_PAGE.fillField, { key: field, value: String(text) }))) return false;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, 'Send'));
  });
  def('webTypeIntoConversationInput', async (text) =>
    Boolean(await evalSafe(IN_PAGE.fillField, { key: 'pm_messageInput', value: String(text) })),
  );

  def('webConfirmDialog', async () => {
    if (await evalSafe(IN_PAGE.clickByTag, 'dialog_confirm')) return true;
    for (const label of ['Confirm', 'OK', 'Yes', 'Continue', 'Accept']) {
      if (await evalSafe(IN_PAGE.clickByLabel, label)) return true;
    }
    return false;
  });
  def('webConfirm', async () => driver.webConfirmDialog());

  def('webOpenConversation', async (withName) => {
    if (await evalSafe(IN_PAGE.clickByTag, `conversation_${withName}`)) return true;
    if (!(await driver.webOpenScreen('pm'))) return false;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, withName));
  });
  def('webIsOnConversationWith', async (name) => Boolean(await evalSafe(IN_PAGE.hasLabel, name)));

  def('webSeatGridState', async () => (await evalSafe(IN_PAGE.seatGrid)) || []);
  def('webHeadingInLocale', async () => (await evalSafe(IN_PAGE.heading)) || '');
  def('webHasReplacementGlyph', async () => Boolean(await evalSafe(IN_PAGE.hasReplacementGlyph)));
  def('webSystemPmRendersInLanguage', async (lang) => {
    const docLang = (await evalSafe(IN_PAGE.docLang)) || '';
    return String(docLang).toLowerCase().startsWith(String(lang).toLowerCase());
  });
  def('webAdminDetectLabelLanguage', async () => (await evalSafe(IN_PAGE.docLang)) || 'en');

  def('webAcceptLegalAndContinue', async () => {
    for (const tag of ['legal_acceptCheckbox', 'legal_accept']) {
      await evalSafe(IN_PAGE.clickByTag, tag);
    }
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, 'Continue'));
  });

  def('webCloseModalViaX', async () => {
    if (await evalSafe(IN_PAGE.clickByTag, 'modal_close')) return true;
    // Scoped to a real dialog. A bare text sweep for "X" matched arbitrary
    // page content and reported a modal closed when none was open.
    const n = await evalSafe(IN_PAGE.countMatching, '[role="dialog"]');
    if (!n) return false;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, 'Close'));
  });

  def('webAttemptAction', async (label) => ({
    attempted: true,
    actuated: await driver.webTapNamedButton(label),
  }));

  def('webSignIn', async (persona) => {
    if (!(await evalSafe(IN_PAGE.clickByTag, 'signin_personaPickerButton'))) {
      if (!(await evalSafe(IN_PAGE.clickByLabel, 'Test personas'))) return false;
    }
    if (!persona) return true;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, persona));
  });

  // Admin navigation. Click first so the tab's own data fetch runs; a URL load
  // skips it and the table is empty for reasons unrelated to the product.
  def('webAdminOpenTab', async (tab) => {
    if (await evalSafe(IN_PAGE.clickByTag, `admin_tab_${tab}`)) return true;
    if (await evalSafe(IN_PAGE.clickByLabel, tab)) return true;
    return navigate(url(`/admin#${tab}`));
  });
  def('webAdminOpenSubtab', async (t) => driver.webAdminOpenTab(t));
  def('webAdminConfirmDialog', async () => driver.webConfirmDialog());

  return driver;
}

module.exports = { attachCommonWebMethods, IN_PAGE, SCREEN_PATHS };
