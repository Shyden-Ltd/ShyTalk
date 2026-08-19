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
 */

const SUBSCRIBE_KEYS = [
  'subscribe_event_new_suggestion',
  'subscribe_event_status_change',
  'subscribe_event_comment_reply',
  'subscribe_event_watched_update',
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

test.describe('Suggestions-board subscribe-dialog i18n', () => {
  test('Hardcoded English strings have been replaced with sgT() calls', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-board.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    // SUBSCRIBE_EVENTS array must use sgT(), not string literals
    const eventsBlock = src.match(/var SUBSCRIBE_EVENTS = \[([\s\S]*?)\];/);
    expect(eventsBlock, 'SUBSCRIBE_EVENTS array not found').not.toBeNull();
    for (const lit of HARDCODED_LABELS.slice(0, 4)) {
      expect(eventsBlock![1], `SUBSCRIBE_EVENTS should not hardcode "${lit}"`).not.toMatch(
        new RegExp(`label:\\s*"${lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      );
    }
    expect(eventsBlock![1]).toMatch(/sgT\("subscribe_event_new_suggestion"\)/);
    expect(eventsBlock![1]).toMatch(/sgT\("subscribe_event_watched_update"\)/);

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
    expect(src, 'Save reset should use sgT("save")').toMatch(/saveBtn\.textContent = sgT\("save"\)/);
    expect(src, 'success toast should use sgT').toMatch(/sgT\("subscribe_toast_saved"\)/);
    expect(src, 'failure toast should use sgT').toMatch(/sgT\("subscribe_toast_save_failed"\)/);
    expect(src, 'unknown_error fallback should use sgT').toMatch(/sgT\("subscribe_unknown_error"\)/);
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
    expect(src, 'Should not hardcode ">Event<" in HTML').not.toMatch(
      />Event</,
    );
  });

  test('All 21 locales define every subscribe key in SG_LABELS', async ({ request }) => {
    const res = await request.get(`${BASE}/js/suggestions-i18n.js`);
    expect(res.ok()).toBe(true);
    const src = await res.text();

    const locales = [
      'en',
      'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
      'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
    ];

    for (const locale of locales) {
      const localeBlock =
        locale === 'en'
          ? src.match(/en:\s*\{([\s\S]*?)\n {4}\},/)
          : src.match(new RegExp(`${locale}:\\s*\\{([^{}]*?)\\}`));
      expect(localeBlock, `Locale ${locale} block not found`).not.toBeNull();
      const block = localeBlock![1];

      for (const key of SUBSCRIBE_KEYS) {
        expect(block, `${locale} should define ${key}`).toMatch(
          new RegExp(`${key}\\s*:`),
        );
      }
    }
  });

  test('Korean locale: sgT() returns Hangul for all subscribe keys', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('shytalk_language', 'ko'); } catch { /* ignore */ }
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
      subscribe_event_new_suggestion: 'New suggestions posted',
      subscribe_event_status_change: 'Suggestion status changes',
      subscribe_event_comment_reply: 'Replies to your comments',
      subscribe_event_watched_update: 'Updates on watched suggestions',
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
