import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  createRoadmapUser,
  createSuggestion,
  signInToRoadmap,
  teardownTestRun,
  type RoadmapTestUser,
} from './helpers/roadmap-auth';

/**
 * Subscribe modal, notifications, and GDPR tests.
 *
 * Covers spec sections:
 *   11.12 — Subscribe Modal
 *   11.26 — Subscribe Modal Edge Cases
 *   11.88 — Notification Timing & Freshness
 *   11.89 — Subscribe Modal GDPR Flow
 *   11.90 — Error Recovery & Retry
 *   11.91 — Print View
 *
 * Twenty-seven of these were `test.fixme` with the single comment "requires
 * logged-in state". That state is reachable — signing in for real against the
 * Auth emulator is all it ever needed — and doing so exposed SHY-0248: the
 * client and the API disagreed about every field name in the subscribe
 * contract, so saving returned 200 and stored nothing.
 */

/** The event keys the server actually knows about (`DEFAULT_PREFS`). */
const SERVER_EVENTS = [
  'roadmapUpdate',
  'suggestionAccepted',
  'suggestionPlanned',
  'suggestionCompleted',
  'suggestionRejected',
  'suggestionMerged',
  'commentOnSuggestion',
] as const;

const CHANNELS = ['email', 'push', 'inApp', 'systemMessage'] as const;

const toggle = (page: Page, event: string, channel: string) =>
  page.locator(`[data-testid="subscribe-toggle-${event}-${channel}"]`);

/** Open the subscribe modal from the header and wait for prefs to land. */
async function openSubscribeModal(page: Page): Promise<void> {
  await page.locator('[data-testid="subscribe-btn"]').click();
  await expect(page.locator('[data-testid="subscribe-modal"]')).toBeVisible();
  // The modal opens with "Loading preferences…" and fills in after the fetch —
  // waiting for a real toggle is what makes the grid settled.
  await expect(toggle(page, 'roadmapUpdate', 'inApp')).toBeVisible({ timeout: 15_000 });
}

async function saveAndExpectSuccess(page: Page): Promise<void> {
  await page.locator('[data-testid="subscribe-modal-save"]').click();
  // Closing is the app's own signal that the save resolved.
  await expect(page.locator('[data-testid="subscribe-modal"]')).toHaveCount(0);
}

test.describe('Subscribe Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  // ── 11.12 — Subscribe Modal ──

  test('unauthenticated: subscribe button opens shared login modal', async ({ page }) => {
    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], .subscribe-btn');
    await subscribeBtn.waitFor({ timeout: 10_000 });
    await subscribeBtn.click();
    // When not logged in, should show the shared login modal (not the subscribe modal)
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('unauthenticated: bell icon opens shared login modal', async ({ page }) => {
    const bell = page.locator('[data-testid="feature-bell"], .feature-bell').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('unauthenticated: login modal has Google and Apple sign-in buttons', async ({ page }) => {
    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], .subscribe-btn');
    await subscribeBtn.waitFor({ timeout: 10_000 });
    await subscribeBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    await expect(loginModal.locator('[data-testid="auth-google-btn"]')).toBeVisible();
    await expect(loginModal.locator('[data-testid="auth-apple-btn"]')).toBeVisible();
  });
});

test.describe('Subscribe Modal — signed in', () => {
  // Each test gets its own identity so one test's saved preferences can never
  // decide another's result.
  let user: RoadmapTestUser;

  test.beforeEach(async ({ page }) => {
    user = await createRoadmapUser({ prefix: 'sub' });
    await signInToRoadmap(page, user);
    await openSubscribeModal(page);
  });

  test.afterEach(async () => {
    if (user) await teardownTestRun(user.testRunId);
  });

  test('all event types listed with 4 channel toggles each', async ({ page }) => {
    for (const event of SERVER_EVENTS) {
      for (const channel of CHANNELS) {
        await expect(toggle(page, event, channel), `${event}/${channel}`).toBeVisible();
      }
    }
    // And nothing beyond the server's vocabulary — a client-invented event key
    // would persist preferences nothing ever reads (SHY-0248).
    await expect(page.locator('[data-testid^="subscribe-toggle-"]')).toHaveCount(
      SERVER_EVENTS.length * CHANNELS.length,
    );
  });

  test('default state: in-app only checked for all events', async ({ page }) => {
    // Matches the server's DEFAULT_PREFS: in-app on everywhere, plus a system
    // message for the outcomes worth interrupting someone about.
    const systemMessageByDefault = new Set([
      'suggestionAccepted',
      'suggestionCompleted',
      'suggestionRejected',
      'suggestionMerged',
    ]);
    for (const event of SERVER_EVENTS) {
      await expect(toggle(page, event, 'inApp'), `${event}/inApp`).toBeChecked();
      await expect(toggle(page, event, 'email'), `${event}/email`).not.toBeChecked();
      await expect(toggle(page, event, 'push'), `${event}/push`).not.toBeChecked();
      const sm = toggle(page, event, 'systemMessage');
      if (systemMessageByDefault.has(event)) {
        await expect(sm, `${event}/systemMessage`).toBeChecked();
      } else {
        await expect(sm, `${event}/systemMessage`).not.toBeChecked();
      }
    }
  });

  test('save preferences: toast confirmation', async ({ page }) => {
    await toggle(page, 'roadmapUpdate', 'push').check();
    await page.locator('[data-testid="subscribe-modal-save"]').click();
    await expect(page.locator('#login-toast')).toContainText(/saved/i);
  });

  test('saved preferences are still there when the modal is reopened', async ({ page }) => {
    // The whole point of SHY-0248: the old client PUT `{preferences}` while the
    // server read `channelPreferences`, so this round-trip silently lost
    // everything behind a 200 and a success toast.
    await toggle(page, 'roadmapUpdate', 'push').check();
    await toggle(page, 'commentOnSuggestion', 'inApp').uncheck();
    await saveAndExpectSuccess(page);

    await openSubscribeModal(page);
    await expect(toggle(page, 'roadmapUpdate', 'push')).toBeChecked();
    await expect(toggle(page, 'commentOnSuggestion', 'inApp')).not.toBeChecked();
  });

  test('cancel: no changes saved', async ({ page }) => {
    await toggle(page, 'roadmapUpdate', 'push').check();
    await page.locator('[data-testid="subscribe-modal-cancel"]').click();
    await expect(page.locator('[data-testid="subscribe-modal"]')).toHaveCount(0);

    await openSubscribeModal(page);
    await expect(toggle(page, 'roadmapUpdate', 'push')).not.toBeChecked();
  });

  test('save button is enabled by default (no checkbox gating)', async ({ page }) => {
    // GDPR consent is implied by enabling email, so nothing gates the button.
    await expect(page.locator('[data-testid="subscribe-modal-save"]')).toBeEnabled();
  });
});

// ── 11.26 — Subscribe Modal Edge Cases ──

test.describe('Subscribe Modal Edge Cases', () => {
  let user: RoadmapTestUser;

  test.beforeEach(async ({ page }) => {
    user = await createRoadmapUser({ prefix: 'subedge' });
    await signInToRoadmap(page, user);
  });

  test.afterEach(async () => {
    if (user) await teardownTestRun(user.testRunId);
  });

  test('open modal, change nothing, save: preferences are unchanged', async ({ page }) => {
    // The original name asserted "no API call made", which the product has
    // never done and should not: skipping the write would make the button lie
    // about having saved. What matters is that a no-op save is a no-op.
    await openSubscribeModal(page);
    await saveAndExpectSuccess(page);

    await openSubscribeModal(page);
    for (const event of SERVER_EVENTS) {
      await expect(toggle(page, event, 'inApp'), `${event}/inApp`).toBeChecked();
      await expect(toggle(page, event, 'email'), `${event}/email`).not.toBeChecked();
    }
  });

  test('open modal, enable all channels for all events, save: all persisted', async ({ page }) => {
    await openSubscribeModal(page);
    for (const event of SERVER_EVENTS) {
      for (const channel of CHANNELS) {
        await toggle(page, event, channel).check();
      }
    }
    await saveAndExpectSuccess(page);

    await openSubscribeModal(page);
    for (const event of SERVER_EVENTS) {
      for (const channel of CHANNELS) {
        await expect(toggle(page, event, channel), `${event}/${channel}`).toBeChecked();
      }
    }
  });

  test('open modal, disable all channels for all events, save: all cleared', async ({ page }) => {
    await openSubscribeModal(page);
    for (const event of SERVER_EVENTS) {
      for (const channel of CHANNELS) {
        await toggle(page, event, channel).uncheck();
      }
    }
    await saveAndExpectSuccess(page);

    await openSubscribeModal(page);
    // "Notify me about nothing" must persist as itself, not silently revert to
    // the defaults — an opt-out that un-opts-out is the worst kind.
    for (const event of SERVER_EVENTS) {
      for (const channel of CHANNELS) {
        await expect(toggle(page, event, channel), `${event}/${channel}`).not.toBeChecked();
      }
    }
  });

  test('watch list shows currently watched suggestions', async ({ page }) => {
    const seeded = await createSuggestion({
      testRunId: user.testRunId,
      title: `Watch me ${user.testRunId}`,
    });
    await page.reload();
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });

    await page.locator(`[data-testid="suggestion-bell-${seeded.id}"]`).click();
    await expect(page.locator('[data-testid="subscribe-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="watch-list"]')).toContainText(seeded.title, {
      timeout: 15_000,
    });
  });

  test('watching the same suggestion twice does not duplicate it', async ({ page }) => {
    const seeded = await createSuggestion({
      testRunId: user.testRunId,
      title: `Watch once ${user.testRunId}`,
    });
    await page.reload();
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });

    for (let i = 0; i < 2; i++) {
      await page.locator(`[data-testid="suggestion-bell-${seeded.id}"]`).click();
      await expect(page.locator('[data-testid="watch-list"]')).toContainText(seeded.title, {
        timeout: 15_000,
      });
      await page.locator('[data-testid="subscribe-modal-close"]').click();
      await expect(page.locator('[data-testid="subscribe-modal"]')).toHaveCount(0);
    }

    await page.locator(`[data-testid="suggestion-bell-${seeded.id}"]`).click();
    await expect(page.locator('[data-testid="watch-item"]')).toHaveCount(1);
  });

  test('a watched suggestion can be removed and stays removed', async ({ page }) => {
    const seeded = await createSuggestion({
      testRunId: user.testRunId,
      title: `Unwatch me ${user.testRunId}`,
    });
    await page.reload();
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });

    await page.locator(`[data-testid="suggestion-bell-${seeded.id}"]`).click();
    await expect(page.locator('[data-testid="watch-list"]')).toContainText(seeded.title, {
      timeout: 15_000,
    });
    await page.locator(`[data-testid="watch-remove-${seeded.id}"]`).click();
    await expect(page.locator('[data-testid="watch-item"]')).toHaveCount(0);

    await page.locator('[data-testid="subscribe-modal-close"]').click();
    await openSubscribeModal(page);
    await expect(page.locator('[data-testid="watch-item"]')).toHaveCount(0);
  });

  test('open from bell icon: that suggestion is added to the watch list', async ({ page }) => {
    const seeded = await createSuggestion({
      testRunId: user.testRunId,
      title: `Bell open ${user.testRunId}`,
    });
    await page.reload();
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });

    await page.locator(`[data-testid="suggestion-bell-${seeded.id}"]`).click();
    await expect(page.locator(`[data-testid="watch-remove-${seeded.id}"]`)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('open from header: no suggestion is added', async ({ page }) => {
    await createSuggestion({ testRunId: user.testRunId, title: `Header open ${user.testRunId}` });
    await page.reload();
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });

    await openSubscribeModal(page);
    await expect(page.locator('[data-testid="watch-item"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="watch-empty"]')).toBeVisible();
  });

  test('close modal with X: no changes saved', async ({ page }) => {
    await openSubscribeModal(page);
    await toggle(page, 'roadmapUpdate', 'email').check();
    await page.locator('[data-testid="subscribe-modal-close"]').click();
    await expect(page.locator('[data-testid="subscribe-modal"]')).toHaveCount(0);

    await openSubscribeModal(page);
    await expect(toggle(page, 'roadmapUpdate', 'email')).not.toBeChecked();
  });

  test('close modal by clicking backdrop: no changes saved', async ({ page }) => {
    await openSubscribeModal(page);
    await toggle(page, 'roadmapUpdate', 'email').check();
    // Click the backdrop, beside the centred dialog. Which point that is cannot
    // be assumed: the sticky header covers the top of the overlay, a sticky
    // section nav covers part of the left edge, and the overlay's box runs 16px
    // past the bottom of the viewport. So ask the page which point actually
    // hits the overlay rather than guessing one and getting a pointer-intercept
    // timeout that reads like a product failure.
    const point = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="subscribe-modal"]');
      if (!overlay) return null;
      const { innerWidth: w, innerHeight: h } = window;
      for (let y = Math.round(h * 0.2); y < h - 4; y += 20) {
        for (const x of [4, Math.round(w * 0.12), w - 4]) {
          if (document.elementFromPoint(x, y) === overlay) return { x, y };
        }
      }
      return null;
    });
    expect(
      point,
      'no reachable backdrop point — is the overlay behind the page chrome?',
    ).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await expect(page.locator('[data-testid="subscribe-modal"]')).toHaveCount(0);

    await openSubscribeModal(page);
    await expect(toggle(page, 'roadmapUpdate', 'email')).not.toBeChecked();
  });
});

// ── 11.88 — Notification Timing & Freshness ──

test.describe('Notification Timing & Freshness', () => {
  // Relative times are rendered by `relativeTime()` (suggestions-board.js:295)
  // in Intl's NARROW style, so the wording is "2m ago" / "1h ago" rather than
  // "2 minutes ago" — the patterns pin the number and the unit letter, which is
  // what would actually change if the arithmetic broke.
  // via Intl.RelativeTimeFormat, so the exact wording is the browser's, not
  // ours — the assertions match the unit, not a hardcoded English phrase.
  //
  // Every age is derived from `Date.now()` at seed time. A fixed timestamp
  // would pass today and rot tomorrow.
  const runId = `test_subtime_${Date.now()}`;

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  // Keyed by age so each test can address ITS card by exact id. Matching on
  // title text instead made the locator depend on which cards happened to be
  // on page one, which is a property of the board, not of the clock.
  const seeded: Record<string, string> = {};

  test.beforeAll(async () => {
    const now = Date.now();
    const ages: Array<[string, number]> = [
      ['justNow', 5_000],
      ['twoMinutes', 2 * MINUTE],
      ['oneHour', 1 * HOUR],
      ['yesterday', 30 * HOUR],
    ];
    for (const [key, ageMs] of ages) {
      const { id } = await createSuggestion({
        testRunId: runId,
        title: `Age ${key} ${runId}`,
        // Newest first, so all four land on page one however the board pages.
        createdAt: now - ageMs,
      });
      seeded[key] = id;
    }
  });

  test.afterAll(async () => {
    await teardownTestRun(runId);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
    await expect(page.locator('[data-testid^="suggestion-card-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    // The board does not read a sort from the URL, so drive the control. Newest
    // first keeps all four seeded cards on page one regardless of what else is
    // on the board.
    await page.locator('[data-testid="sort-newest"]').click();
    await expect(page.locator(`[data-testid="suggestion-card-${seeded.justNow}"]`)).toBeVisible({
      timeout: 15_000,
    });
  });

  /** The rendered relative-time text on the card seeded with this age. */
  const ageOf = (page: Page, key: string) =>
    page.locator(`[data-testid="suggestion-time-${seeded[key]}"]`);

  test('"just now" shown for notifications < 1 minute old', async ({ page }) => {
    await expect(ageOf(page, 'justNow')).toHaveText(/now/i);
  });

  test('"2 minutes ago" correct relative time', async ({ page }) => {
    await expect(ageOf(page, 'twoMinutes')).toHaveText(/\b2\s*m(in)?\b/i);
  });

  test('"1 hour ago" correct', async ({ page }) => {
    await expect(ageOf(page, 'oneHour')).toHaveText(/\b1\s*h(r|our)?\b/i);
  });

  test('"Yesterday" shown for 24-48 hours ago', async ({ page }) => {
    await expect(ageOf(page, 'yesterday')).toHaveText(/yesterday|\b1\s*d(ay)?\b/i);
  });

  test('timestamp uses users local timezone', async ({ page }) => {
    // Relative ages are computed from the browser's own clock, so a viewer in
    // any timezone sees the same "2 min ago" — the failure mode this guards is
    // a UTC-anchored render that reads hours off for anyone outside UTC.
    const el = ageOf(page, 'twoMinutes');
    await expect(el).toBeVisible();
    await expect
      .poll(async () => await el.getAttribute('datetime'), {
        message: 'card must expose its creation time alongside the relative one',
      })
      .not.toBeNull();
    const iso = await el.getAttribute('datetime');
    const skew = Math.abs(Date.now() - new Date(iso!).getTime());
    // Seeded two minutes ago; a timezone-mangled value would be hours out.
    expect(skew).toBeLessThan(30 * MINUTE);
  });
});

// ── 11.89 — Subscribe Modal GDPR Flow ──

test.describe('Subscribe Modal GDPR Flow', () => {
  let user: RoadmapTestUser;

  test.beforeEach(async ({ page }) => {
    user = await createRoadmapUser({ prefix: 'subgdpr' });
    await signInToRoadmap(page, user);
    await openSubscribeModal(page);
  });

  test.afterEach(async () => {
    if (user) await teardownTestRun(user.testRunId);
  });

  test('GDPR notice visible (no checkbox, just informational text)', async ({ page }) => {
    const notice = page.locator('[data-testid="subscribe-gdpr-notice"]');
    await expect(notice).toBeVisible();
    // Informational text, not a consent gate — enabling email IS the consent.
    await expect(notice.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test('GDPR notice mentions unsubscribe via email link', async ({ page }) => {
    await expect(page.locator('[data-testid="subscribe-gdpr-notice"]')).toContainText(
      /unsubscribe/i,
    );
  });

  test('disabling all email toggles effectively unsubscribes from email', async ({ page }) => {
    // Opt in to email everywhere, then withdraw it — the withdrawal is the part
    // that must stick, because that is the one the law cares about.
    for (const event of SERVER_EVENTS) {
      await toggle(page, event, 'email').check();
    }
    await saveAndExpectSuccess(page);

    await openSubscribeModal(page);
    for (const event of SERVER_EVENTS) {
      await expect(toggle(page, event, 'email'), `${event}/email opted in`).toBeChecked();
      await toggle(page, event, 'email').uncheck();
    }
    await saveAndExpectSuccess(page);

    await openSubscribeModal(page);
    for (const event of SERVER_EVENTS) {
      await expect(toggle(page, event, 'email'), `${event}/email opted out`).not.toBeChecked();
    }
  });
});

// ── 11.90 — Error Recovery & Retry ──

test.describe('Error Recovery & Retry', () => {
  let user: RoadmapTestUser;

  test.beforeEach(async () => {
    user = await createRoadmapUser({ prefix: 'suberr' });
  });

  test.afterEach(async () => {
    if (user) await teardownTestRun(user.testRunId);
  });

  test('vote fails (network): error surfaced, vote not counted', async ({ page }) => {
    const seeded = await createSuggestion({
      testRunId: user.testRunId,
      title: `Vote fail ${user.testRunId}`,
      upvotes: 3,
    });
    await signInToRoadmap(page, user);
    await expect(page.locator(`[data-testid="suggestion-card-${seeded.id}"]`)).toBeVisible({
      timeout: 15_000,
    });
    const scoreBefore = await page.locator(`[data-testid="vote-score-${seeded.id}"]`).textContent();

    // A REAL dropped connection, not an intercepted one — same code path a
    // person on a flaky train hits, and no in-process double (EPIC-0003).
    await page.context().setOffline(true);
    await page.locator(`[data-testid="vote-up-${seeded.id}"]`).click();
    // A new vote asks WHY before it is cast (SHY-0247); "Just vote" is the
    // no-reason path, and only then does the request go out to fail.
    await page.locator('[data-testid="reason-skip"]').click();

    await expect(page.locator('#login-toast')).toContainText(/fail/i);
    // The score must not have moved — an optimistic bump left standing after a
    // failure tells the person their vote landed when it did not.
    await expect(page.locator(`[data-testid="vote-score-${seeded.id}"]`)).toHaveText(
      scoreBefore!.trim(),
    );
  });

  test('suggestion submit fails: form retains input, retry shown', async ({ page }) => {
    await signInToRoadmap(page, user);
    await page.locator('[data-testid="suggest-btn"]').click();
    const title = `Retained title ${user.testRunId}`;
    await page.locator('[data-testid="suggest-title-input"]').fill(title);
    await page.locator('[data-testid="suggest-desc-input"]').fill('Retained description.');
    // Submit stays disabled until a title of 3+ chars AND a tag are present
    // (`validateForm`, suggestions-board.js:993) — the button being enabled is
    // therefore the settled signal that the form is complete.
    await page.locator('[data-testid="suggest-tag-select"]').selectOption('social');
    const submit = page.locator('[data-testid="suggest-modal-submit"]');
    await expect(submit).toBeEnabled();
    // Drop the connection only once the form is filled, so the failure lands
    // on the submit and nothing else.
    await page.context().setOffline(true);
    await submit.click();

    await expect(page.locator('#login-toast')).toContainText(/fail/i);
    // Losing what someone typed because the network blipped is the actual harm.
    await expect(page.locator('[data-testid="suggest-title-input"]')).toHaveValue(title);
    await expect(page.locator('[data-testid="suggest-modal-submit"]')).toBeEnabled();
  });

  test('subscribe save fails: error toast, modal stays open', async ({ page }) => {
    await signInToRoadmap(page, user);
    await openSubscribeModal(page);
    // Offline AFTER the preferences have loaded, so only the save fails.
    await toggle(page, 'roadmapUpdate', 'email').check();
    await page.context().setOffline(true);
    await page.locator('[data-testid="subscribe-modal-save"]').click();

    await expect(page.locator('#login-toast')).toContainText(/fail/i);
    // Staying open with the choices intact is what makes retrying possible.
    await expect(page.locator('[data-testid="subscribe-modal"]')).toBeVisible();
    await expect(toggle(page, 'roadmapUpdate', 'email')).toBeChecked();
    await expect(page.locator('[data-testid="subscribe-modal-save"]')).toBeEnabled();
  });

  test('partial page failure: working sections shown, failed sections show error', async ({
    page,
  }) => {
    // Let the page load fully, THEN drop the connection and ask the board to
    // refetch. The roadmap phases stay rendered while the suggestions section
    // fails — real graceful degradation, with a real network fault rather than
    // an intercepted one.
    // The board starts empty on a fresh stack, so give it something to fail
    // to reload — an empty board has no error state to reach.
    await createSuggestion({ testRunId: user.testRunId, title: `Partial ${user.testRunId}` });
    await page.goto('/roadmap.html');
    await expect(page.locator('#roadmap-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="suggestion-card-"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await page.context().setOffline(true);
    await page.locator('[data-testid="sort-newest"]').click();

    await expect(page.locator('[data-testid="suggestions-error"]')).toBeVisible({
      timeout: 15_000,
    });
    // The section that did NOT depend on the API is still there.
    await expect(page.locator('#roadmap-container')).toBeVisible();
  });

  test('retry: a failed load offers a retry that actually re-requests', async ({ page }) => {
    // The original name promised exponential backoff, which the product does
    // not do and does not need — it retries on an explicit click, so nothing
    // is spammed. What matters is that the button works.
    // Count REAL requests rather than intercepting them, so the retry has to
    // actually reach the server for the count to move.
    let attempts = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/suggestions?')) attempts++;
    });

    await createSuggestion({ testRunId: user.testRunId, title: `Retry ${user.testRunId}` });
    await page.goto('/roadmap.html');
    await expect(page.locator('[data-testid^="suggestion-card-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.context().setOffline(true);
    await page.locator('[data-testid="sort-newest"]').click();
    await expect(page.locator('[data-testid="suggestions-error"]')).toBeVisible({
      timeout: 15_000,
    });

    const attemptsBeforeRetry = attempts;
    await page.context().setOffline(false);
    await page.locator('[data-testid="suggestions-retry"]').click();
    await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThan(attemptsBeforeRetry);
    await expect(page.locator('[data-testid="suggestions-error"]')).toHaveCount(0);
  });
});

// ── 11.91 — Print View ──

test.describe('Print View', () => {
  test('print page: roadmap formatted for print (no dark theme)', async ({ page }) => {
    await page.goto('/roadmap.html');
    await page.emulateMedia({ media: 'print' });
    // A dark background costs a wall of toner and reads badly on paper.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const rgb = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
    const luminance = (rgb[0] + rgb[1] + rgb[2]) / 3;
    expect(luminance, `printed background was ${bg}`).toBeGreaterThan(200);
  });

  test('print page: no interactive elements in print', async ({ page }) => {
    await page.goto('/roadmap.html');
    await expect(page.locator('[data-testid="suggest-btn"]')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    // Controls on paper are just noise — nobody can click them.
    await expect(page.locator('[data-testid="suggest-btn"]')).toBeHidden();
    await expect(page.locator('[data-testid="subscribe-btn"]')).toBeHidden();
  });
});
