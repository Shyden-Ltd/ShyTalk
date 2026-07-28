import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression test for hardcoded English strings in the suggestions
 * subscribe dialog (suggestions-board.js).
 *
 * Pre-fix the dialog rendered 11 hardcoded English user-facing strings
 * regardless of language preference:
 *   - 4 SUBSCRIBE_EVENTS labels (event-row labels)
 *   - 4 CHANNEL_LABELS values (channel column headers)
 *   - "Event" header (top-left cell)
 *   - "Saving..." button state, "Save" button reset
 *   - "Subscription preferences saved" toast
 *   - "Failed to save: " toast prefix + "Unknown error" fallback
 *
 * Fix: replace each with sgT(key); add 12 keys × 21 locales (252 entries)
 * to SG_LABELS in suggestions-i18n.js. Pattern mirrors prior dropdown
 * i18n PRs (#598 STATUS_OPTIONS, #603 TAG_OPTIONS, #604 PHASE_OPTIONS).
 *
 * NOT in scope: vote-failed / submit-failed / post-comment-failed toast
 * prefixes elsewhere in the file. Those have their own
 * "Failed to ..." patterns that warrant a separate i18n PR.
 *
 * SHY-0248 update: the four event keys this used to pin —
 * subscribe_event_new_suggestion / _status_change / _comment_reply /
 * _watched_update — belonged to a client-invented vocabulary that shared no
 * key with the server's model, so preferences saved under them were read by
 * nothing. The client now renders whatever events the API returns, and the
 * labels live in SUBSCRIBE_EVENT_LABELS. The channel/button/toast keys below
 * are unchanged.
 */

/** Keys that have shipped in all 21 web locales since the original i18n PR. */
const SUBSCRIBE_KEYS = [
  'subscribe_channel_email',
  'subscribe_channel_push',
  'subscribe_channel_inapp',
  'subscribe_channel_system',
  'subscribe_event_header',
  'subscribe_btn_saving',
  'subscribe_toast_saved',
  'subscribe_toast_save_failed',
  'subscribe_unknown_error',
];

const HARDCODED_LABELS = [
  'New suggestions posted',
  'Suggestion status changes',
  'Replies to your comments',
  'Updates on watched suggestions',
  'In-App',
  'System Message',
];

/** The notification events the API actually knows about (DEFAULT_PREFS). */
const SERVER_EVENT_KEYS = [
  'roadmapUpdate',
  'suggestionAccepted',
  'suggestionPlanned',
  'suggestionCompleted',
  'suggestionRejected',
  'suggestionMerged',
  'commentOnSuggestion',
];

test.describe('Suggestions-board subscribe-dialog i18n', () => {
  test('Hardcoded English strings have been replaced with sgT() calls', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // Event rows are labelled from SUBSCRIBE_EVENT_LABELS, keyed by the
    // SERVER's event names. Every entry must map to a translation key, never a
    // literal — and the map must cover the whole server vocabulary, or an
    // unlabelled event renders as a humanised camelCase key.
    const labelsBlock = src.match(/var SUBSCRIBE_EVENT_LABELS = \{([\s\S]*?)\};/);
    expect(labelsBlock, 'SUBSCRIBE_EVENT_LABELS object not found').not.toBeNull();
    for (const key of SERVER_EVENT_KEYS) {
      expect(labelsBlock![1], `SUBSCRIBE_EVENT_LABELS should label ${key}`).toMatch(
        new RegExp(`${key}:\\s*"subscribe_event_[a-z_]+"`),
      );
    }
    for (const lit of HARDCODED_LABELS.slice(0, 4)) {
      expect(labelsBlock![1], `SUBSCRIBE_EVENT_LABELS should not hardcode "${lit}"`).not.toContain(
        lit,
      );
    }

    // CHANNEL_LABELS object must use sgT() for all 4 entries
    const channelsBlock = src.match(/var CHANNEL_LABELS = \{([\s\S]*?)\};/);
    expect(channelsBlock, 'CHANNEL_LABELS object not found').not.toBeNull();
    expect(channelsBlock![1]).toMatch(/email:\s*sgT\("subscribe_channel_email"\)/);
    expect(channelsBlock![1]).toMatch(/push:\s*sgT\("subscribe_channel_push"\)/);
    expect(channelsBlock![1]).toMatch(/inApp:\s*sgT\("subscribe_channel_inapp"\)/);
    expect(channelsBlock![1]).toMatch(/systemMessage:\s*sgT\("subscribe_channel_system"\)/);
    expect(channelsBlock![1]).not.toMatch(/email:\s*"Email"/);
    expect(channelsBlock![1]).not.toMatch(/systemMessage:\s*"System Message"/);

    // Runtime sites: button states + toasts + Event header
    expect(src, 'Saving... should use sgT').toMatch(/sgT\("subscribe_btn_saving"\)/);
    expect(src, 'Save reset should use sgT("save")').toMatch(
      /saveBtn\.textContent = sgT\("save"\)/,
    );
    expect(src, 'success toast should use sgT').toMatch(/sgT\("subscribe_toast_saved"\)/);
    expect(src, 'failure toast should use sgT').toMatch(/sgT\("subscribe_toast_save_failed"\)/);
    expect(src, 'unknown_error fallback should use sgT').toMatch(
      /sgT\("subscribe_unknown_error"\)/,
    );
    expect(src, 'Event header should use sgT').toMatch(/sgT\("subscribe_event_header"\)/);

    // Hardcoded fail-cases: must NOT appear as bare quoted strings
    // anywhere except within sgT() arguments. The eval inside sgT() is
    // a string literal, so we need a precise check: the literal must
    // not appear in a *runtime* context (textContent assignment,
    // showToast call, escapeHtml call, etc.).
    expect(src, 'Should not hardcode "Saving..." in textContent').not.toMatch(
      /textContent\s*=\s*"Saving\.\.\."/,
    );
    expect(src, 'Should not hardcode "Save" reset in textContent').not.toMatch(
      /saveBtn\.textContent\s*=\s*"Save"/,
    );
    expect(src, 'Should not hardcode "Subscription preferences saved" in showToast').not.toMatch(
      /showToast\("Subscription preferences saved"\)/,
    );
    expect(src, 'Should not hardcode "Failed to save: " in showToast').not.toMatch(
      /showToast\("Failed to save: "/,
    );
    expect(src, 'Should not hardcode ">Event<" in HTML').not.toMatch(/>Event</);
  });

  test('All 21 locales define every subscribe key in SG_LABELS', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const locales = [
      'en',
      'ar',
      'de',
      'es',
      'fr',
      'hi',
      'id',
      'it',
      'ja',
      'km',
      'ko',
      'nl',
      'pl',
      'pt',
      'ru',
      'sv',
      'th',
      'tr',
      'uk',
      'vi',
      'zh',
    ];

    for (const locale of locales) {
      const localeBlock =
        locale === 'en'
          ? src.match(/en:\s*\{([\s\S]*?)\n {4}\},/)
          : src.match(new RegExp(`${locale}:\\s*\\{([^{}]*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of SUBSCRIBE_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(new RegExp(`${key}\\s*:`));
      }
    }
  });

  test('Korean locale: sgT() returns Hangul for all subscribe keys', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('shytalk_language', 'ko');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);
    await page.waitForFunction(
      () => typeof (window as Window & { sgT?: (k: string) => string }).sgT === 'function',
      undefined,
      { timeout: 10_000 },
    );
    const t = await page.evaluate((keys) => {
      const w = window as Window & { sgT?: (k: string) => string };
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = w.sgT ? w.sgT(k) : null;
      return out;
    }, SUBSCRIBE_KEYS);

    // Allow a few keys to legitimately contain Latin characters in
    // Korean translations (e.g. "Push" stays as 푸시 — pure Hangul,
    // but acronyms like "In-App" might also be transliterated). The
    // robust check is: each translated value should NOT match the
    // English original AND should contain at least one Hangul char.
    const englishValues: Record<string, string> = {
      subscribe_channel_email: 'Email',
      subscribe_channel_push: 'Push',
      subscribe_channel_inapp: 'In-App',
      subscribe_channel_system: 'System Message',
      subscribe_event_header: 'Event',
      subscribe_btn_saving: 'Saving...',
      subscribe_toast_saved: 'Subscription preferences saved',
      subscribe_toast_save_failed: 'Failed to save',
      subscribe_unknown_error: 'Unknown error',
    };
    for (const key of SUBSCRIBE_KEYS) {
      const value = t[key];
      expect(value, `sgT(${key}) should not be null`).not.toBeNull();
      expect(value, `sgT(${key}) should not be English`).not.toBe(englishValues[key]);
      expect(value, `sgT(${key}) in ko should contain Hangul`).toMatch(/[가-힯]/);
    }
  });
});
