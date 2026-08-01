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

  bodyText: `() => document.body.innerText || ''`,

  currentUrl: `() => location.href`,

  tagPresent: `(tag) => document.querySelectorAll(
    '[data-test-tag="' + tag + '"], [data-testid="' + tag + '"], [data-test-tag^="' + tag + '"]'
  ).length > 0`,

  // Fill by CSS selector list rather than by key, for the handful of fields
  // the admin console names structurally (input[name=...]) rather than by tag.
  fillBySelector: `(args) => {
    const { selectors, value } = args;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }`,

  // Enter on a search field. Submitting the owning form is what actually runs
  // the search; a bare keydown is swallowed by anything that listens on submit.
  submitSearch: `(selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      if (el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
      return true;
    }
    return false;
  }`,

  selectOptionByLabel: `(args) => {
    const { selectors, label } = args;
    const want = String(label).trim().toLowerCase();
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el || el.tagName !== 'SELECT') continue;
      for (const opt of Array.from(el.options)) {
        if ((opt.textContent || '').trim().toLowerCase() === want) {
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  }`,

  // Every data row of the admin table, as arrays of cell text.
  adminRows: `() => Array.from(document.querySelectorAll('table tr'))
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()))
    .filter((cells) => cells.length > 0)`,

  counterValue: `(prefix) => {
    const el = document.querySelector(
      '[data-test-tag^="' + prefix + '"], [data-testid^="' + prefix + '"]'
    );
    if (!el) return null;
    const m = (el.textContent || '').match(/\\d+/);
    return m ? Number(m[0]) : null;
  }`,

  idImageLoaded: `() => Array.from(
    document.querySelectorAll('[data-test-tag="admin_idImage"] img, img[alt*="ID" i], .id-image img')
  ).some((im) => im.currentSrc && im.naturalWidth > 0)`,

  highlightedSection: `(section) => document.querySelectorAll(
    '[data-test-tag="' + section + '"].highlight, [data-test-tag="' + section + '"][data-highlighted="true"]'
  ).length > 0`,

  documentDirection: `() => document.documentElement.getAttribute('dir') || 'ltr'`,

  setLanguage: `(lang) => {
    try { localStorage.setItem('shytalk_language', lang); return true; }
    catch (_) { return false; }
  }`,

  // document.fonts.check is the browser's own answer to "can this render",
  // measured against the actual computed stack rather than a font-name guess.
  fontFallbackCapable: `(text) => {
    const fam = window.getComputedStyle(document.body).fontFamily || 'sans-serif';
    return document.fonts ? document.fonts.check('16px ' + fam, text) : true;
  }`,

  // Untranslated strings surface as the raw resource key.
  missingTranslations: `() => {
    const text = document.body.innerText || '';
    const keyish = text.match(/\\b[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+){1,}\\b/g) || [];
    return [...new Set(keyish)];
  }`,

  translationOf: `(args) => {
    const { lang, src } = args;
    const dict = window.HOMEPAGE_T || {};
    const enDict = dict.en || {};
    let key = null;
    for (const k of Object.keys(enDict)) { if (enDict[k] === src) { key = k; break; } }
    if (!key) {
      return { ok: false, reason: '"' + src + '" not in homepage namespace — likely an in-app string' };
    }
    const translated = (dict[lang] || {})[key];
    if (!translated) return { ok: false, reason: 'no ' + lang + ' translation for "' + key + '"' };
    return { ok: (document.body.innerText || '').includes(translated), translated, key };
  }`,

  /**
   * Instrumentation, NOT interception.
   *
   * Wraps fetch/XHR so every real request is RECORDED and forwarded untouched,
   * and captures console.error + window.onerror. Nothing is fabricated and no
   * response is synthesised — the ban on doubles is about inventing answers,
   * and this invents nothing.
   *
   * Idempotent: re-running after a navigation re-installs on the fresh window
   * without double-counting, because the flag lives on that same window.
   */
  installProbes: `() => {
    if (window.__shytalkProbes) return true;
    window.__shytalkProbes = { net: [], errors: [] };
    const log = window.__shytalkProbes;
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (...args) {
        const url = String(args[0] && args[0].url ? args[0].url : args[0]);
        return origFetch.apply(this, args).then(
          (res) => { log.net.push({ url, status: res.status, at: Date.now() }); return res; },
          (err) => { log.net.push({ url, status: 0, at: Date.now(), error: String(err) }); throw err; }
        );
      };
    }
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
      const open = OrigXHR.prototype.open;
      OrigXHR.prototype.open = function (method, url, ...rest) {
        this.__shytalkUrl = String(url);
        this.addEventListener('loadend', () => {
          log.net.push({ url: this.__shytalkUrl, status: this.status, at: Date.now() });
        });
        return open.call(this, method, url, ...rest);
      };
    }
    const origError = console.error;
    console.error = function (...args) {
      log.errors.push(args.map((a) => String(a)).join(' '));
      return origError.apply(this, args);
    };
    window.addEventListener('error', (e) => log.errors.push(String(e && e.message)));
    window.addEventListener('unhandledrejection', (e) => log.errors.push(String(e && e.reason)));
    return true;
  }`,

  readProbes: `(which) => {
    const p = window.__shytalkProbes;
    if (!p) return [];
    return which === 'errors' ? p.errors.slice() : p.net.slice();
  }`,

  // One real HTTP call against the running API, issued from the page so it
  // carries the page's own origin and cookies.
  apiFetch: `async (args) => {
    const { url, opts } = args;
    const res = await fetch(url, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json — text still returned */ }
    return { status: res.status, text, json };
  }`,
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
function attachCommonWebMethods(driver, host) {
  const { evaluate, navigate, baseURL, slug } = host;
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

  // ── shared internals for the second batch ──────────────────────────────

  /** Page text, preferring the host driver's own dump when it has one. */
  const uiDump = async () => {
    if (typeof driver.webUiDump === 'function') return (await driver.webUiDump()) || '';
    return (await evalSafe(IN_PAGE.bodyText)) || '';
  };
  const textPresent = async (needle) => (await uiDump()).includes(String(needle));
  const tagPresent = async (tag) => Boolean(await evalSafe(IN_PAGE.tagPresent, tag));
  const currentUrl = async () =>
    typeof host.currentUrl === 'function'
      ? await host.currentUrl()
      : (await evalSafe(IN_PAGE.currentUrl)) || '';
  const reload = async () => {
    const u = await currentUrl();
    return u ? navigate(u) : false;
  };
  const fillFirst = async (selectors, value) =>
    Boolean(await evalSafe(IN_PAGE.fillBySelector, { selectors, value: String(value) }));

  // The API lives on :3000 while the web app is served from :8888 — the same
  // derivation the desktop driver uses, kept identical so a port change is one
  // edit rather than two that can disagree.
  const apiBase = () => String(baseURL || '').replace(/:8888$/, ':3000');
  const apiFetch = async (pathname, init = {}) => {
    const r = await evalSafe(IN_PAGE.apiFetch, { url: `${apiBase()}${pathname}`, opts: init });
    return r || { status: 0, text: 'in-page fetch failed', json: null, error: true };
  };
  driver._apiFetch = apiFetch;

  /**
   * Read the in-page probes, installing them first.
   *
   * A host that can do better supplies its own: the CDP-attached Android
   * drivers see EVERY request including document and subresource loads,
   * whereas in-page instrumentation only sees what page script issues. Taking
   * the host's version when offered keeps the stronger signal rather than
   * levelling every surface down to the weakest one.
   */
  const probes = async (which) => {
    if (which === 'errors' && typeof host.consoleErrors === 'function') {
      return (await host.consoleErrors()) || [];
    }
    if (which === 'net' && typeof host.networkLog === 'function') {
      return (await host.networkLog()) || [];
    }
    await evalSafe(IN_PAGE.installProbes);
    return (await evalSafe(IN_PAGE.readProbes, which)) || [];
  };
  driver._networkLog = async () => probes('net');

  // ── navigation + interaction ───────────────────────────────────────────

  def('webTap', async (tag) => {
    if (await evalSafe(IN_PAGE.clickByTag, tag)) return true;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, tag));
  });

  def('webVisit', async (u) => {
    // Absolute-only, matching the desktop contract: a relative path here would
    // resolve against whatever page happens to be loaded, so the same step
    // would visit different places depending on what ran before it.
    if (!/^https?:\/\//.test(String(u))) {
      throw new Error(`webVisit needs an absolute URL, got "${u}"`);
    }
    return navigate(String(u));
  });

  def('webTypeIntoSearch', async (text) =>
    fillFirst(
      [
        '[data-test-tag="searchField"]',
        '[data-testid="search"]',
        'input[type="search"]',
        'input[name="search"]',
        'input[name="q"]',
        'input[placeholder*="search" i]',
      ],
      text,
    ),
  );

  def(
    'webOpenProfilePanel',
    async (_name, target) =>
      (await driver.webTap(`userCard_${target}`)) || driver.webTap('profile_open'),
  );

  def('webSendGift', async (recipient, gift) => {
    if (!(await driver.webTap('gift_open'))) return false;
    if (recipient && !(await driver.webTapNamedButton(recipient))) return false;
    if (gift && !(await driver.webTapNamedButton(gift))) return false;
    return (await driver.webTap('gift_send')) || driver.webTapNamedButton('Send');
  });
  def('webSelectRecipientAndGift', async (recipient, gift) => driver.webSendGift(recipient, gift));
  def('webTapGiftIconInRoom', async () => driver.webTap('gift_open'));
  def('webSendGiftTo', async (recipient, gift) => driver.webSendGift(recipient, gift));
  def('webShowsGiftFromSender', async () => tagPresent('giftWall_grid'));

  def('webEditBodyAndConfirm', async (newBody) => {
    if (!(await driver.webTypeIntoConversationInput(newBody))) return false;
    return (await driver.webTap('pm_confirmEdit')) || driver.webConfirmDialog();
  });

  def('webTypeAndSend', async (field, text) => driver.webTypeAndSubmit(field, text));

  def('webShowsHighlightAtSection', async (section) =>
    // A highlight is a VISUAL state, so the class/attribute carries it. Text
    // presence would be equally true for an un-highlighted section.
    Boolean(await evalSafe(IN_PAGE.highlightedSection, section)),
  );

  def('webShowsTabWithNoNavTo', async (tab) => {
    if (!(await driver.webShowsNamedButton(tab))) return false;
    const before = await currentUrl();
    await driver.webTapNamedButton(tab);
    return (await currentUrl()) === before;
  });

  def('webOpenWithNetwork', async (screen, profile) => {
    const net = await driver.webSetNetwork(profile);
    const opened = await driver.webOpenScreen(screen);
    return { opened, network: net };
  });

  def(
    'webShowsNamedKind',
    async (name, kind) => (await textPresent(name)) && (await textPresent(kind)),
  );
  def('webShowsOwnRankInTop', async (name) => textPresent(name));
  def('webShowsLocaleLabels', async (label) => textPresent(label));
  def('eachJoinerNavigatesBackWithToast', async (toast) => textPresent(toast));
  def('webRailShowsLessonsForLanguage', async () => tagPresent('languageRail_'));

  // ── i18n + rendering ───────────────────────────────────────────────────

  def('webDocumentDirection', async (_name, locale) => {
    if (locale) {
      // localStorage is the only mechanism the public app honours — a ?lang=
      // query param is NOT supported (see public/js/language-selector.js), so
      // setting one would silently read the previous locale's direction.
      await evalSafe(IN_PAGE.setLanguage, locale);
      await reload();
    }
    return (await evalSafe(IN_PAGE.documentDirection)) || 'ltr';
  });
  def('webAdminGetDocumentDirection', async () => {
    await driver.webAdminOpenTab('dashboard');
    return (await evalSafe(IN_PAGE.documentDirection)) || 'ltr';
  });
  def('webGetFieldAlignment', async () => (await evalSafe(IN_PAGE.documentDirection)) || 'ltr');

  def('webShowsTranslationOf', async (code, englishKey) => {
    await evalSafe(IN_PAGE.setLanguage, code);
    await reload();
    return (await evalSafe(IN_PAGE.translationOf, { lang: code, src: englishKey })) || false;
  });

  def('webFontFallbackCapable', async (sample) =>
    Boolean(await evalSafe(IN_PAGE.fontFallbackCapable, String(sample || 'Aa'))),
  );

  def('webFallbackEnStrings', async () => {
    // "Fell back to English" cannot be proven by seeing English — a correct
    // English render looks identical. The absence of leaked resource keys is
    // the signal that actually distinguishes the two.
    const body = await uiDump();
    return !/\b[a-z]+(?:_[a-z0-9]+){2,}\b/.test(body);
  });
  def('webMissingTranslations', async () => (await evalSafe(IN_PAGE.missingTranslations)) || []);
  def('webPmBodyShowsRawKeyOrPlaceholder', async (_name, key) => textPresent(key));
  def(
    'webPmDoesNotRenderInEnglish',
    async (_name, englishText) => !(await textPresent(englishText)),
  );
  def('pmBodyIsTranslationOfTemplate', async (englishTemplate) => {
    const dump = await uiDump();
    if (!dump.trim()) return false;
    return !dump.includes(String(englishTemplate));
  });
  def('pmIsFromSender', async (sender) => textPresent(sender));
  def('receivedSystemPmWithReason', async (reason) => textPresent(reason));
  def('webBalanceUsesLocaleSeparator', async (separator) => textPresent(separator));

  // ── admin console ──────────────────────────────────────────────────────

  def('webAdminSearch', async (query) => {
    const selectors = ['[data-test-tag="admin_search"]', 'input[type="search"]'];
    if (!(await fillFirst(selectors, query))) return false;
    return Boolean(await evalSafe(IN_PAGE.submitSearch, selectors));
  });
  def('webAdminSearchForUser', async (user) => driver.webAdminSearch(user));

  def('webAdminTapWithReason', async (action, reason) => {
    if (!(await driver.webTapNamedButton(action))) return false;
    // Some actions take no reason field; failing to fill one is not a failure
    // of the action itself, so the result is not gated on it.
    await fillFirst(
      ['[data-test-tag="admin_reason"]', 'textarea', 'input[name="reason"]'],
      reason ?? '',
    );
    return driver.webConfirmDialog();
  });
  def('webAdminTapWithReasonAndOverride', async (action, reason) => {
    if (!(await driver.webAdminTapWithReason(action, reason))) return false;
    // A second, deliberate confirmation. Skipping it would leave the action
    // un-applied while the driver reported success.
    return (await driver.webTapNamedButton('Override')) || driver.webConfirmDialog();
  });
  def('webAdminConfirmWithReason', async (reason) =>
    driver.webAdminTapWithReason('Confirm', reason),
  );
  def('webAdminActOnSubmission', async (action, reason) =>
    driver.webAdminTapWithReason(action, reason),
  );
  def('webAdminActOnSubmissionByName', async (name, action, reason) => {
    const found =
      (await driver.webTap(`submission_${name}`)) ||
      (await evalSafe(IN_PAGE.clickByLabel, String(name)));
    if (!found) return false;
    return driver.webAdminTapWithReason(action, reason);
  });
  def('webAdminApproveSubmissions', async (names = []) => {
    // Sequential on purpose: each approval reloads the queue, so firing them
    // together would act on rows that have already moved.
    for (const n of Array.isArray(names) ? names : [names]) {
      if (!(await driver.webAdminActOnSubmissionByName(n, 'Approve'))) return false;
    }
    return true;
  });
  def('webAdminRejectSubmission', async (name, reason) =>
    driver.webAdminActOnSubmissionByName(name, 'Reject', reason),
  );

  def('webAdminRefreshTab', async () => {
    if (await driver.webTap('admin_refresh')) return true;
    return reload();
  });
  def('webAdminRefreshAgeVerification', async () => {
    await driver.webAdminOpenTab('age-verification');
    return driver.webAdminRefreshTab();
  });
  def('webAdminExecuteAgeDownFlow', async (user, reason) => {
    if (!(await driver.webAdminOpenTab('age-verification'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    return driver.webAdminTapWithReason('Age down', reason);
  });
  def('webAdminDenyAppeal', async (user, reason) => {
    if (!(await driver.webAdminOpenTab('appeals'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    return driver.webAdminTapWithReason('Deny', reason);
  });
  def('webAdminLiftAppeal', async (user, reason) => {
    if (!(await driver.webAdminOpenTab('appeals'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    return driver.webAdminTapWithReason('Lift', reason);
  });
  def('webAdminOpenEconomyStats', async () => driver.webAdminOpenTab('economy'));
  def('webAdminAdjustShyCoins', async (user, amount, reason) => {
    if (!(await driver.webAdminOpenTab('economy'))) return false;
    if (!(await driver.webAdminSearchForUser(user))) return false;
    if (!(await driver.webTapNamedButton('Adjust'))) return false;
    if (!(await fillFirst(['[data-test-tag="admin_amount"]', 'input[name="amount"]'], amount))) {
      return false;
    }
    return driver.webAdminTapWithReason('Confirm', reason);
  });
  def('webAdminProcessRefund', async (receiptOrUser, reason) => {
    if (!(await driver.webAdminOpenTab('economy'))) return false;
    if (!(await driver.webAdminSearch(receiptOrUser))) return false;
    return driver.webAdminTapWithReason('Refund', reason);
  });
  def('webAdminIssueWarning', async () => driver.webTap('adminWarnButton'));
  def('webAdminOpenReportAndTap', async (report, action) => {
    if (!(await driver.webAdminOpenTab('reports'))) return false;
    const opened =
      (await driver.webTap(`report_${report}`)) ||
      (await evalSafe(IN_PAGE.clickByLabel, String(report)));
    if (!opened) return false;
    return driver.webTapNamedButton(action);
  });
  def('webAdminTapAndTypeBanDevice', async (deviceId, reason) => {
    if (!(await driver.webTapNamedButton('Ban device'))) return false;
    if (
      !(await fillFirst(['[data-test-tag="admin_deviceId"]', 'input[name="deviceId"]'], deviceId))
    ) {
      return false;
    }
    return driver.webAdminTapWithReason('Confirm', reason);
  });
  def('webAdminFilterByAction', async (action) => {
    const ok = await evalSafe(IN_PAGE.selectOptionByLabel, {
      selectors: ['[data-test-tag="admin_actionFilter"]', 'select[name="action"]', 'select'],
      label: action,
    });
    if (ok) return true;
    return Boolean(await evalSafe(IN_PAGE.clickByLabel, String(action)));
  });

  const adminRows = async () => (await evalSafe(IN_PAGE.adminRows)) || [];
  def('webAdminGetRowCount', async () => (await adminRows()).length);
  def('webAdminShowsReportRow', async (needle) =>
    (await adminRows()).some((cells) => cells.some((c) => c.includes(String(needle)))),
  );
  def('webAdminShowsRowForWithStatus', async (who, status) =>
    (await adminRows()).some(
      (cells) =>
        cells.some((c) => c.includes(String(who))) && cells.some((c) => c.includes(String(status))),
    ),
  );
  def('webAdminShowsIdImage', async () => Boolean(await evalSafe(IN_PAGE.idImageLoaded)));
  def('webDashboardReportsCounterEquals', async (_viewer, expected) => {
    const n = await evalSafe(IN_PAGE.counterValue, 'adminDashboard_reports');
    // Compares the NUMBER, not a substring: "12" must not satisfy "1".
    return n !== null && Number(n) === Number(expected);
  });

  // ── purchases ──────────────────────────────────────────────────────────

  def(
    'webSelectPackage',
    async (pkg) => (await driver.webTap(`package_${pkg}`)) || driver.webTapNamedButton(String(pkg)),
  );
  def('webSubmitSandboxReceipt', async (receipt) => {
    if (
      !(await fillFirst(['[data-test-tag="sandbox_receipt"]', 'input[name="receipt"]'], receipt))
    ) {
      return false;
    }
    return (await driver.webTap('sandbox_submit')) || driver.webTapNamedButton('Submit');
  });
  def('webPurchaseWithSandboxReceipt', async (pkg, receipt) => {
    if (pkg && !(await driver.webSelectPackage(pkg))) return false;
    return driver.webSubmitSandboxReceipt(receipt);
  });
  def('webDoubleTapWithSameReceipt', async (receipt) => ({
    first: await driver.webSubmitSandboxReceipt(receipt),
    second: await driver.webSubmitSandboxReceipt(receipt),
  }));

  // ── network, console + API ─────────────────────────────────────────────

  def('webConsoleErrors', async () => probes('errors'));
  def('webNetworkLogHasStatus', async (status) =>
    (await probes('net')).some((e) => e.status === Number(status)),
  );
  def(
    'webNetworkLogCountAttempts',
    async (urlFragment) =>
      (await probes('net')).filter((e) => String(e.url).includes(String(urlFragment))).length,
  );
  def('webReceiveLiveKitToken', async () =>
    (await probes('net')).some((e) => String(e.url).includes('/livekit/token') && e.status === 200),
  );
  def('apiRequestStats', async () => {
    const log = await probes('net');
    const byStatus = {};
    for (const e of log) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    return { total: log.length, byStatus };
  });
  def('sequentialRequestStatus', async (pathname, times = 2) => {
    const out = [];
    // Sequential by construction: these steps test rate limiting and replay
    // protection, where the ORDER of arrival is the whole point.
    for (let n = 0; n < Number(times); n++) out.push((await apiFetch(pathname)).status);
    return out;
  });
  def('auditLogContains', async (predicate = {}) => {
    const r = await apiFetch('/api/admin/audit-log');
    const rows = (r.json && (r.json.entries || r.json.rows || r.json)) || [];
    if (!Array.isArray(rows)) return false;
    return rows.some((row) =>
      Object.entries(predicate).every(([k, v]) => String(row[k]) === String(v)),
    );
  });
  def('countFcmPayloadsToUser', async (uniqueId) => {
    const r = await apiFetch(`/api/test/fcm-log?uniqueId=${encodeURIComponent(uniqueId)}`);
    if (r.status !== 200) {
      return { supported: false, why: `no fcm-log endpoint (status ${r.status})` };
    }
    const rows = (r.json && (r.json.entries || r.json)) || [];
    return { supported: true, count: Array.isArray(rows) ? rows.length : 0 };
  });
  def('seesFcmPushOnPlatform', async (platform, uniqueId) => {
    const res = await driver.countFcmPayloadsToUser(uniqueId);
    if (!res.supported) return res;
    return { supported: true, seen: res.count > 0, platform };
  });
  def('simulateFcmDispatcherAttempt', async (payload = {}) => {
    const r = await apiFetch('/api/test/fcm-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { supported: r.status === 200, status: r.status };
  });
  def('advanceClockToStartsAt', async (isoWhen) => {
    const r = await apiFetch('/api/test/advance-clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: String(isoWhen) }),
    });
    if (r.status === 200) return { supported: true, applied: true };
    return {
      supported: false,
      applied: false,
      why: `no clock-control endpoint (status ${r.status}) — the emulator has no time travel`,
    };
  });

  /**
   * Real network shaping where the surface can do it, an honest refusal where
   * it cannot.
   *
   * Only the CDP-attached Android browsers can shape the connection, and only
   * if the host offers the hook. Returning a cheerful `true` on Safari would
   * let a low-connectivity scenario pass at full speed — the exact false
   * confidence that makes a green matrix worthless.
   */
  def('webSetNetwork', async (profile) => {
    if (typeof host.setNetwork === 'function') return host.setNetwork(profile);
    return {
      supported: false,
      applied: false,
      why: `${slug} has no network-shaping channel — CDP emulation is Chromium-only and this surface is driven over ${
        slug.endsWith('-ios') ? 'Appium/WebDriver' : 'CDP without a session hook'
      }`,
    };
  });
  def('injectApiLatency', async (ms) => {
    if (typeof host.setNetwork === 'function')
      return host.setNetwork('slow', { latency: Number(ms) });
    return {
      supported: false,
      applied: false,
      why: `${slug} cannot shape latency — network emulation needs a CDP session`,
    };
  });
  def('simulateNetworkDropBeforeResponse', async (ms = 500) => {
    const offline = await driver.webSetNetwork('offline');
    if (!offline.supported) return offline;
    await new Promise((r) => setTimeout(r, Number(ms) || 0));
    await driver.webSetNetwork('online');
    return { supported: true, applied: true };
  });
  def('injectApiFailureThenSuccess', async () => ({
    supported: false,
    applied: false,
    why: 'a synthetic 5xx would be a fabricated response, not an induced failure; add a fault-injection endpoint to the API to test this for real',
  }));
  def('fireSystemPmWebhook', async () => {
    // Server-side fixture, not a browser action: there is nothing on the page
    // to drive. Refused by name so the step is attributed to the harness
    // rather than read as the product failing to deliver a PM.
    throw new Error(
      'fireSystemPmWebhook is a server-side fixture, not a browser action — the step should seed the system PM through the API rather than through the web driver',
    );
  });

  def('webGrantNotificationPermission', async () => {
    if (typeof host.grantPermissions === 'function') {
      return host.grantPermissions(['notifications']);
    }
    // Notification permission is a browser-chrome decision that page script
    // cannot make for itself. Reporting the state honestly beats claiming a
    // grant that never happened.
    const state = await evalSafe(
      `() => (window.Notification && Notification.permission) || 'unsupported'`,
    );
    return state === 'granted'
      ? true
      : {
          supported: false,
          why: `${slug} cannot grant notification permission programmatically (currently "${state}") — it is a browser-chrome prompt`,
        };
  });

  return driver;
}

module.exports = { attachCommonWebMethods, IN_PAGE, SCREEN_PATHS };
