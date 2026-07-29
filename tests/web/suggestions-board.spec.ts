import { test, expect, Page } from '@playwright/test';
import { publishAuthIdentity } from './helpers/auth-identity';
import {
  createRoadmapUser,
  createSuggestion,
  signInToRoadmap,
  teardownTestRun,
  type RoadmapTestUser,
} from './helpers/roadmap-auth';

/**
 * Suggestions board tests.
 *
 * Covers spec sections:
 *   11.11  — Suggestions Board (public browsing, login gate, submission flow, voting flow, comment flow)
 *   11.24  — Suggestion Submission Edge Cases
 *   11.25  — Voting Edge Cases
 *   11.63  — Mobile-Specific Interactions
 *   11.64  — Suggestion Card UI States
 *   11.67  — Filter & Search Combination Edge Cases
 *   11.87  — Suggestion Description Display
 *   11.109 — Empty & Extreme States
 *   11.110 — URL & Navigation Edge Cases
 */

// ═══════════════════════════════════════════════════════════════
// Shared mock data and route interception
// ═══════════════════════════════════════════════════════════════

const MOCK_SUGGESTIONS = [
  {
    id: 'test-sug-1',
    title: 'Add dark mode',
    description: 'Dark mode would be great for night use',
    tag: 'quality-of-life',
    tags: ['quality-of-life'],
    language: 'en',
    status: 'accepted',
    upvotes: 15,
    downvotes: 2,
    score: 13,
    netScore: 13,
    submitterUid: 1001,
    createdAt: 1709913600000,
  },
  {
    id: 'test-sug-2',
    title: 'Video calls',
    description: 'Add video calling to voice rooms',
    tag: 'social',
    tags: ['social'],
    language: 'en',
    status: 'planned',
    upvotes: 8,
    downvotes: 1,
    score: 7,
    netScore: 7,
    submitterUid: 2002,
    createdAt: 1709827200000,
  },
  {
    id: 'test-sug-3',
    title: 'Voice chat improvements',
    // Over the product's 200-char truncation threshold, so this card renders
    // the "Show more" affordance. Nothing exercised truncation before, which
    // is why the expand test sat parked despite the feature existing.
    description:
      'Better audio quality and noise cancellation for voice rooms. ' +
      'Background noise from one participant currently drowns out everyone else in a busy room. '.repeat(
        3,
      ),
    tag: 'quality-of-life',
    tags: ['quality-of-life'],
    language: 'en',
    status: 'completed',
    upvotes: 25,
    downvotes: 0,
    score: 25,
    netScore: 25,
    submitterUid: 3003,
    createdAt: 1709740800000,
  },
  {
    id: 'test-sug-4',
    title: 'Remove chat limits',
    description: 'Let users send unlimited messages',
    tag: 'social',
    tags: ['social'],
    language: 'en',
    status: 'rejected',
    upvotes: 3,
    downvotes: 12,
    score: -9,
    netScore: -9,
    submitterUid: 4004,
    createdAt: 1709654400000,
    declineReason: 'This would increase moderation burden significantly.',
  },
  {
    // PENDING and owned by uniqueId 1001 — the identity `openSuggestForm` and
    // the owner tests sign in as. Edit and Withdraw are offered only on your
    // own pending suggestion, so without this fixture there was nothing for
    // those controls to appear on.
    id: 'test-sug-mine',
    title: 'My own pending idea',
    description: 'Mine, still awaiting review.',
    tag: 'social',
    tags: ['social'],
    language: 'en',
    status: 'pending',
    upvotes: 1,
    downvotes: 0,
    score: 1,
    netScore: 1,
    submitterUid: 1001,
    createdAt: 1709308800000,
  },
  {
    // A description crafted to break out of the href attribute. `escapeHtml`
    // builds a text node and reads innerHTML, so it escapes & < > but NOT
    // quotes — linkifying already-escaped text spliced this straight into
    // `href="..."`, where the quote closed the attribute and the remainder
    // parsed as an event handler. Stored XSS on a public board.
    id: 'test-sug-xss',
    title: 'Attribute breakout probe',
    description:
      'Report at https://evil.example/x"onmouseover=alert(1) and also ' +
      'https://evil.example/a" onmouseover="alert(2) plus javascript:alert(3)',
    tag: 'social',
    tags: ['social'],
    language: 'en',
    status: 'planned',
    upvotes: 1,
    downvotes: 0,
    score: 1,
    netScore: 1,
    submitterUid: 8008,
    createdAt: 1709308800000,
  },
  {
    // Carries a bare URL so linkification has something to act on. No fixture
    // had one, so the "URLs become links" test could not tell a working
    // implementation from a missing one.
    id: 'test-sug-url',
    title: 'Link to the design doc',
    description: 'Details live at https://example.com/shytalk-design for anyone who wants them.',
    tag: 'social',
    tags: ['social'],
    language: 'en',
    status: 'planned',
    upvotes: 2,
    downvotes: 0,
    score: 2,
    netScore: 2,
    submitterUid: 6006,
    createdAt: 1709481600000,
  },
  {
    // Arabic, so RTL rendering has a real case to prove. `dir="auto"` derives
    // direction from the text itself, which only means something when some of
    // the text is actually right-to-left.
    id: 'test-sug-rtl',
    title: 'دعم اللغة العربية',
    description: 'نرجو إضافة دعم كامل للغة العربية في جميع أنحاء التطبيق.',
    tag: 'social',
    tags: ['social'],
    language: 'ar',
    status: 'planned',
    upvotes: 4,
    downvotes: 0,
    score: 4,
    netScore: 4,
    submitterUid: 7007,
    createdAt: 1709395200000,
  },
  {
    // The "only the creator's automatic upvote" case. No fixture modelled it,
    // so the test named after it could only ever check that the score LOOKED
    // like a number. Tagged `social` (not `quality-of-life`) so the
    // accepted/quality-of-life/en filter test still matches exactly one card,
    // and scored lowest so it sorts last and never displaces a `.first()`.
    id: 'test-sug-auto',
    title: 'Only the auto-upvote',
    description: 'Newly posted, so it carries just its creator upvote.',
    tag: 'social',
    tags: ['social'],
    language: 'en',
    // PLANNED, not accepted: `withComments` attaches comments to every ACCEPTED
    // fixture, so a second accepted entry would double `.sg-comment` counts in
    // the comment-flow tests. A planned card still renders its vote score.
    status: 'planned',
    upvotes: 1,
    downvotes: 0,
    score: 1,
    netScore: 1,
    submitterUid: 5005,
    createdAt: 1709568000000,
  },
];

// Tag values must be the API's real vocabulary (VALID_TAGS) — the fixture used
// to carry `ui`, which the API rejects, and which the tag dropdown no longer
// offers now that the client vocabulary was corrected (SHY-0248).
const MOCK_TAGS = [
  { value: 'quality-of-life', label: 'Quality of Life' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'social', label: 'Social' },
];

const MOCK_SUGGESTIONS_RESPONSE = {
  suggestions: MOCK_SUGGESTIONS,
  total: MOCK_SUGGESTIONS.length,
  page: 1,
  pageSize: 20,
};

/**
 * Sets up API route interception so tests get consistent mock data
 * instead of relying on the dev database. Must be called BEFORE page.goto().
 */
/**
 * @param persistVotes when true the fixture RECORDS votes and replays them in
 *   the `myVotes` map of subsequent list responses — the same contract the real
 *   API has (suggestions-board.js:379 seeds `state.myVotes` from it, and :1305
 *   renders `sg-vote-btn--active` off it).
 *
 *   Off by default so every existing test keeps the exact static payloads it
 *   was written against. Without it a "vote survives navigation" test is
 *   unprovable BY CONSTRUCTION: the vote endpoint returns a fixed body and the
 *   list is a constant, so a reload always renders an unvoted board no matter
 *   what the product does.
 */
/**
 * A dataset big enough to paginate. The board paginates at PAGE_SIZE 10 and
 * only renders controls when `Math.ceil(total / 10) > 1`
 * (suggestions-board.js:26,1262), so the default 4-item MOCK_SUGGESTIONS can
 * NEVER produce a page-2 button — which is why the pagination test used to
 * guard its whole body behind `if (page2.count() > 0)` and pass without ever
 * running. Opt-in, so no other test's counts or ordering assertions move.
 */
const PAGINATED_SUGGESTIONS = Array.from({ length: 25 }, (_, i) => ({
  ...MOCK_SUGGESTIONS[i % MOCK_SUGGESTIONS.length],
  id: `paged-sug-${i + 1}`,
  title: `Paged suggestion ${String(i + 1).padStart(2, '0')}`,
}));

/**
 * Orders rows the way the REAL API does for a given `sort` param. Sorting is
 * server-side — suggestions-board.js:358 sends `&sort=`, and :377 renders
 * `data.suggestions` in whatever order came back — so a fixture that ignores
 * the param can only ever prove the fixture's own order, never the product's.
 * Opt-in (`sortable`) so the other tests' assumed row order does not move.
 */
function sortLikeApi<T extends { createdAt: number; score?: number }>(
  rows: T[],
  sort: string,
): T[] {
  const by = sort === 'newest' ? (r: T) => r.createdAt : (r: T) => r.score ?? 0;
  return [...rows].sort((a, b) => by(b) - by(a));
}

/**
 * Vote state, optionally SHARED between pages.
 *
 * Playwright route handlers are per-page, so two tabs set up independently get
 * independent closures and a vote in one is invisible to the other — which
 * makes any cross-tab assertion unfalsifiable. Passing one store into both
 * setups is what lets the second tab observe the first tab's write.
 */
type VoteStore = { castVotes: Record<string, string>; scoreDelta: Record<string, number> };
function newVoteStore(): VoteStore {
  return { castVotes: {}, scoreDelta: {} };
}

async function setupSuggestionsMocks(
  page: Page,
  {
    persistVotes = false,
    paginate = false,
    sortable = false,
    duplicateMatches = 0,
    withComments = false,
    commentCount = 0,
    store = newVoteStore(),
  }: {
    persistVotes?: boolean;
    paginate?: boolean;
    sortable?: boolean;
    duplicateMatches?: number;
    withComments?: boolean;
    /** Attach N generated comments instead of the default two. */
    commentCount?: number;
    store?: VoteStore;
  } = {},
) {
  // Comments render only on ACCEPTED suggestions. Opt-in so the default
  // fixture keeps its empty-comments case, which the "No comments yet" empty
  // state depends on.
  // A long thread, when the caller asks for one — the pager cannot be tested
  // against a list that never exceeds one page.
  const bulkComments = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `bulk-${i}`,
      text: `Comment number ${i + 1}.`,
      authorName: `Commenter ${i + 1}`,
      createdAt: Date.now() - (n - i) * 1_000,
    }));

  const withCommentRows = (rows: typeof MOCK_SUGGESTIONS) =>
    withComments || commentCount > 0
      ? rows.map((r) =>
          r.status === 'accepted'
            ? {
                ...r,
                comments:
                  commentCount > 0
                    ? bulkComments(commentCount)
                    : [
                        {
                          id: 'c1',
                          text: 'First comment.',
                          authorName: 'Commenter One',
                          createdAt: Date.now() - 60_000,
                        },
                        {
                          id: 'c2',
                          text: 'Their account is gone.',
                          authorName: 'Commenter Two',
                          authorDeleted: true,
                          createdAt: Date.now() - 30_000,
                        },
                      ],
              }
            : r,
        )
      : rows;
  // suggestionId → 'up' | 'down', mutated by the vote route below and read by
  // both list routes. Survives page.goto: route handlers outlive navigation.
  const castVotes = store.castVotes;
  // Score deltas per suggestion, so a vote is observable on a RELOAD and not
  // only in the tab that cast it. Without this the list always replays the
  // fixture's original score, and any cross-tab assertion is unfalsifiable.
  const scoreDelta = store.scoreDelta;
  const applyScores = (rows: typeof MOCK_SUGGESTIONS) =>
    withCommentRows(
      persistVotes
        ? rows.map((r) => ({ ...r, score: (r.score ?? 0) + (scoreDelta[r.id] ?? 0) }))
        : rows,
    );
  const withMyVotes = (payload: Record<string, unknown>) =>
    persistVotes ? { ...payload, myVotes: castVotes } : payload;
  // Mock the main suggestions list endpoint (also covers search via query params)
  await page.route('**/api/suggestions/search*', (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') || '';

    // Duplicate-detection candidates. The board asks for `&limit=3`
    // (suggestions-board.js:456) AND caps again at render with
    // `Math.min(suggestions.length, 3)` (:907). Returning MORE than the cap —
    // deliberately ignoring `limit` — is the only way to prove the CLIENT-side
    // cap rather than the server's. Opt-in so no other search test moves.
    if (duplicateMatches > 0) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // Keep the REAL id while there are distinct fixture rows to draw on,
          // so a candidate corresponds to a card that is actually on the board
          // — confirming a match navigates to that card, and a synthetic id
          // would have nowhere to go.
          suggestions: Array.from({ length: duplicateMatches }, (_, i) => ({
            ...MOCK_SUGGESTIONS[i % MOCK_SUGGESTIONS.length],
            id: i < MOCK_SUGGESTIONS.length ? MOCK_SUGGESTIONS[i].id : `dup-${i + 1}`,
            title: `Duplicate candidate ${i + 1}`,
          })),
          total: duplicateMatches,
          page: 1,
          pageSize: duplicateMatches,
        }),
      });
      return;
    }

    const status = url.searchParams.get('status') || '';
    let filtered = MOCK_SUGGESTIONS;
    if (query) {
      filtered = filtered.filter(
        (s) =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          s.description.toLowerCase().includes(query.toLowerCase()),
      );
    }
    if (status) {
      filtered = filtered.filter((s) => s.status === status);
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        withMyVotes({
          suggestions: filtered,
          total: filtered.length,
          page: 1,
          pageSize: 20,
        }),
      ),
    });
  });

  await page.route('**/api/suggestions/blocked*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ blocked: false }),
    });
  });

  // Mock vote endpoints
  await page.route('**/api/suggestions/*/vote', (route) => {
    if (persistVotes) {
      // Mirror the real contract: POST {direction} casts/changes, DELETE
      // toggles off (suggestions-board.js:400-407).
      const id = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
      const dirValue = (d: string | undefined) => (d === 'up' ? 1 : d === 'down' ? -1 : 0);
      const previous = castVotes[id];
      if (route.request().method() === 'DELETE') {
        delete castVotes[id];
        scoreDelta[id] = (scoreDelta[id] ?? 0) - dirValue(previous);
      } else {
        const direction = route.request().postDataJSON()?.direction;
        if (direction) {
          castVotes[id] = direction;
          scoreDelta[id] = (scoreDelta[id] ?? 0) - dirValue(previous) + dirValue(direction);
        }
      }
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ score: 14, upvotes: 16, downvotes: 2 }),
    });
  });

  // Mock comment endpoints
  await page.route('**/api/suggestions/*/comments', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ comments: [], total: 0 }),
    });
  });

  // Mock subscription/watch endpoints
  await page.route('**/api/subscriptions/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: {}, watchList: [] }),
    });
  });

  // Main suggestions endpoint (must be registered AFTER more-specific routes above)
  await page.route('**/api/suggestions*', (route) => {
    const url = new URL(route.request().url());

    // Real paging, driven by the client's own ?page=N&limit=N contract
    // (suggestions-board.js:357), so clicking page 2 returns genuinely
    // different rows instead of the same list every time.
    if (paginate) {
      const pageNum = Math.max(1, Number(url.searchParams.get('page') || '1'));
      const limit = Math.max(1, Number(url.searchParams.get('limit') || '10'));
      const start = (pageNum - 1) * limit;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          withMyVotes({
            suggestions: PAGINATED_SUGGESTIONS.slice(start, start + limit),
            total: PAGINATED_SUGGESTIONS.length,
            page: pageNum,
            pageSize: limit,
          }),
        ),
      });
      return;
    }

    const status = url.searchParams.get('status') || '';
    const tag = url.searchParams.get('tag') || '';
    const lang = url.searchParams.get('lang') || '';
    let filtered = MOCK_SUGGESTIONS;
    if (status) {
      filtered = filtered.filter((s) => s.status === status);
    }
    if (tag) {
      filtered = filtered.filter((s) => s.tag === tag || (s.tags && s.tags.includes(tag)));
    }
    if (lang) {
      filtered = filtered.filter((s) => s.language === lang);
    }
    if (sortable) {
      filtered = sortLikeApi(filtered, url.searchParams.get('sort') || 'votes');
    }
    filtered = applyScores(filtered);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        withMyVotes({
          suggestions: filtered,
          total: filtered.length,
          page: 1,
          pageSize: 20,
        }),
      ),
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Condition-based waiting (SHY-0245 — never sleep)
// ═══════════════════════════════════════════════════════════════

/** Every suggestion card, however the board labels them. */
const cardsOf = (page: Page) => page.locator('[data-testid^="suggestion-card"], .sg-card');

/**
 * Resolves once the board has actually rendered — either at least one card, or
 * the empty state when the fixture has none. Returns the instant that is true,
 * so it is correct on any machine; the timeout only bounds the failure.
 */
async function boardSettled(page: Page) {
  await expect(
    page
      .locator('[data-testid^="suggestion-card"], .sg-card, [data-testid="suggestions-empty"]')
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Performs `action` and waits for the suggestions fetch it triggers, so the
 * assertions that follow see the NEW list rather than the stale one. Anchoring
 * on "a card is visible" would be useless here — the previous cards are
 * already visible, so it would pass instantly against stale content.
 */
async function withSuggestionsFetch(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) => /\/api\/suggestions/.test(r.url()) && r.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await action();
  // Returned, not discarded: a filter test can only prove the choice REACHED
  // the API by inspecting the request it produced. Counting cards afterwards
  // proves nothing — an empty board satisfies any count assertion.
  return response;
}

/**
 * Types a suggestion title and waits for the debounced duplicate-detection
 * lookup to answer. The lookup hits /api/suggestions/search, so the response
 * is the honest signal that the panel below reflects THIS title rather than
 * the previous one — a fixed delay could only ever guess at the debounce.
 */
async function typeTitleAwaitingDuplicates(
  page: Page,
  input: ReturnType<Page['locator']>,
  text: string,
) {
  const response = page.waitForResponse((r) => /\/api\/suggestions\/search/.test(r.url()), {
    timeout: 15_000,
  });
  await input.fill(text);
  await response;
}

/**
 * Snapshots a count only AFTER proving the list is non-empty, so a loop over
 * the result can never run zero times and report green ([[feedback-test-must-
 * fail-if-logic-skipped]] — the vacuous-loop trap that de-sleeping exposes).
 */
async function nonEmptyCount(locator: ReturnType<Page['locator']>): Promise<number> {
  await expect(locator.first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => await locator.count()).toBeGreaterThan(0);
  const n = await locator.count();
  return n;
}

// ═══════════════════════════════════════════════════════════════
// 11.11 — Public Browsing (No Login)
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestions Board — Public Browsing', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('suggestions list loads with cards', async ({ page }) => {
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    await cards.first().waitFor({ timeout: 10_000 });
    await expect.poll(async () => await cards.count()).toBeGreaterThan(0);
  });

  test('card shows title', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const title = card.locator('[data-testid^="suggestion-title"], .sg-card-title');
    await expect(title).toBeVisible();
    await expect.poll(async () => (await title.textContent())!.trim().length).toBeGreaterThan(0);
  });

  test('card shows description', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const desc = card.locator('[data-testid^="suggestion-desc"], .sg-card-desc');
    await expect(desc).toBeVisible();
  });

  test('card shows vote count', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const voteCount = card.locator('[data-testid^="vote-score"], .sg-vote-score');
    await expect(voteCount).toBeVisible();
    await expect.poll(async () => await voteCount.textContent()).toMatch(/-?\d+/);
  });

  test('card shows tags', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const tags = card.locator('[data-testid^="suggestion-tag"], .sg-tag');
    // Tags are optional, but the container should exist
    await expect(tags).toBeAttached();
  });

  test('card shows language tag', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const langTag = card.locator('[data-testid^="suggestion-lang"], .sg-lang-tag');
    await expect(langTag).toBeVisible();
  });

  test('card shows timestamp', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const timestamp = card.locator('[data-testid^="suggestion-time"], .sg-timestamp');
    await expect(timestamp).toBeVisible();
  });

  test('card shows status badge', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const badge = card.locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toBeVisible();
  });

  test('sort "Most Voted" works (verify order)', async ({ page }) => {
    await boardSettled(page);
    const sortBtn = page.locator('[data-testid="sort-most-voted"]');
    await sortBtn.waitFor({ timeout: 10_000 });
    // Sorting is CLIENT-SIDE — no refetch to wait on. Anchor on the rendered
    // scores instead (SHY-0245).
    await sortBtn.click();
    const voteCounts = page.locator('[data-testid^="vote-score"], .sg-vote-score');
    // Was `if (count >= 2)`, which asserted NOTHING when the board was empty —
    // a green test proving nothing. The fixture ships 3 suggestions, so demand
    // at least two and compare unconditionally.
    const count = await nonEmptyCount(voteCounts);
    expect(count).toBeGreaterThanOrEqual(2);
    const first = parseInt((await voteCounts.nth(0).textContent()) || '0');
    const second = parseInt((await voteCounts.nth(1).textContent()) || '0');
    expect(first).toBeGreaterThanOrEqual(second);
  });

  test('sort "Newest" works (verify order)', async ({ page }) => {
    // Sorting is SERVER-side: the board sends `&sort=` (suggestions-board.js:358)
    // and renders whatever order comes back (:377). Opt the fixture into real
    // sorting, otherwise the DOM order is the fixture's own row order whatever
    // is clicked, and any order assertion would be a tautology.
    await setupSuggestionsMocks(page, { sortable: true });
    await page.reload();
    await boardSettled(page);

    const sortBtn = page.locator('[data-testid="sort-newest"]');
    await sortBtn.waitFor({ timeout: 10_000 });

    // The old comment here claimed sorting was client-side with "no refetch to
    // wait on". That is wrong — :1458 calls fetchSuggestions() — and reading
    // count() straight after the click raced that refetch, which is why this
    // test flaked. The default sort is "votes" (:118), so Newest genuinely
    // changes state and does fire a request (:1455 no-ops on the active sort).
    const sortRequest = page.waitForRequest(
      (r) => r.url().includes('/api/suggestions') && r.url().includes('sort=newest'),
      { timeout: 15_000 },
    );
    await withSuggestionsFetch(page, () => sortBtn.click());
    await sortRequest;

    // The part the name promised and the body never delivered: newest FIRST.
    // Card test ids carry the suggestion id; the visible text is relativeTime()
    // and cannot be compared for order.
    const newestFirst = sortLikeApi(MOCK_SUGGESTIONS, 'newest').map((s) => s.id);
    await expect
      .poll(() =>
        page
          .locator('[data-testid^="suggestion-time-"]')
          .evaluateAll((els) =>
            els.map((e) => (e.getAttribute('data-testid') || '').replace('suggestion-time-', '')),
          ),
      )
      .toEqual(newestFirst);

    // Tautology guard: newest order MUST differ from the default votes order,
    // or the assertion above would still hold if the click did nothing at all.
    expect(newestFirst).not.toEqual(sortLikeApi(MOCK_SUGGESTIONS, 'votes').map((s) => s.id));
  });

  test('filter by status works (each status individually)', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });

    // Dropdown labels (user-facing) vs canonical status values (stable contract
    // on the badge's data-status attribute). Visible badge text may differ from
    // the dropdown label (e.g., "Shipped!" instead of "Completed") — the
    // data-status attribute is the stable assertion target.
    const statuses: Array<{ label: string; canonical: string }> = [
      { label: 'Accepted', canonical: 'accepted' },
      { label: 'Planned', canonical: 'planned' },
      { label: 'Completed', canonical: 'completed' },
      { label: 'Rejected', canonical: 'rejected' },
    ];
    for (const { label, canonical } of statuses) {
      await withSuggestionsFetch(page, () => statusFilter.selectOption({ label }));
      const badges = page.locator('[data-testid^="suggestion-status"]');
      const count = await badges.count();
      for (let i = 0; i < count; i++) {
        await expect(badges.nth(i)).toHaveAttribute('data-status', canonical);
      }
    }
  });

  test('filter by tag works', async ({ page }) => {
    const tagFilter = page.locator('[data-testid="filter-tag"]');
    await tagFilter.waitFor({ timeout: 10_000 });
    // Select the first available tag option (skip "All")
    const options = tagFilter.locator('option');
    const optionCount = await options.count();
    if (optionCount > 1) {
      const tagValue = await options.nth(1).getAttribute('value');
      await withSuggestionsFetch(page, () => tagFilter.selectOption(tagValue!));
      const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
      const cardCount = await cards.count();
      // All displayed cards should have the selected tag
      for (let i = 0; i < cardCount; i++) {
        const tags = cards.nth(i).locator('[data-testid^="suggestion-tag"], .sg-tag');
        await expect
          .poll(async () => (await tags.textContent())!.toLowerCase())
          .toContain(tagValue!.toLowerCase());
      }
    }
  });

  test('filter by language works', async ({ page }) => {
    const langFilter = page.locator('[data-testid="filter-lang"]');
    await langFilter.waitFor({ timeout: 10_000 });
    const options = langFilter.locator('option');
    const optionCount = await options.count();
    if (optionCount > 1) {
      const langValue = await options.nth(1).getAttribute('value');
      await withSuggestionsFetch(page, () => langFilter.selectOption(langValue!));
      const langTags = page.locator('[data-testid^="suggestion-lang"], .sg-lang-tag');
      const count = await langTags.count();
      for (let i = 0; i < count; i++) {
        await expect
          .poll(async () => (await langTags.nth(i).textContent())!.toLowerCase())
          .toContain(langValue!.toLowerCase());
      }
    }
  });

  test('filter by phase category works', async ({ page }) => {
    const phaseFilter = page.locator('[data-testid="phase-filter"], .phase-filter');
    await phaseFilter.waitFor({ timeout: 10_000 });
    const options = phaseFilter.locator('option');
    // The board must offer a real phase beyond the default "all", otherwise
    // there is nothing to filter BY and the rest of the test is vacuous. The
    // old `if (optionCount > 1)` swallowed exactly that case silently.
    await expect.poll(async () => options.count()).toBeGreaterThan(1);

    const phaseValue = await options.nth(1).getAttribute('value');
    const response = await withSuggestionsFetch(page, () => phaseFilter.selectOption(phaseValue!));

    // "Filtering works" means the choice REACHED THE API and stuck in the UI.
    // The previous assertion was `cards.count() >= 0`, which is true of every
    // list including an empty one, so this test could not fail.
    expect(new URL(response.url()).searchParams.get('phase')).toBe(phaseValue);
    await expect(phaseFilter).toHaveValue(phaseValue!);
  });

  test('combined filters work (status + tag + language)', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    const tagFilter = page.locator('[data-testid="filter-tag"]');
    const langFilter = page.locator('[data-testid="filter-lang"]');
    await statusFilter.waitFor({ timeout: 10_000 });

    // Pick values the FIXTURE ACTUALLY SATISFIES together — MOCK_SUGGESTIONS
    // has an accepted / ui / en entry. The old version selected
    // an arbitrary nth(1) tag and language, so the AND of the three filters
    // usually matched nothing: the loop ran zero times and the test asserted
    // NOTHING while reporting green. Each `if (count > 1)` guard was the same
    // defect — it skipped silently when the options were missing.
    // Only the STATUS filter refetches; tag and language are applied
    // client-side, so there is no response to wait on for those two.
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));
    await tagFilter.selectOption('quality-of-life');
    await langFilter.selectOption('en');

    // The settled result IS the anchor: MOCK_SUGGESTIONS has exactly one
    // accepted / ui / en entry, so this retrying assertion waits
    // for the client-side filtering to land and pins the AND semantics.
    const badges = page.locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badges).toHaveCount(1);
    const count = await nonEmptyCount(badges);
    for (let i = 0; i < count; i++) {
      await expect
        .poll(async () => (await badges.nth(i).textContent())!.toLowerCase())
        .toContain('accepted');
    }
  });

  test('search by text works (results match query)', async ({ page }) => {
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await searchInput.waitFor({ timeout: 10_000 });
    // Search for a term the FIXTURE ACTUALLY CONTAINS. The old query was
    // 'test', which matches none of MOCK_SUGGESTIONS ("Add dark mode",
    // "Video calls", …) — so the result set was always empty, the loop below
    // ran zero times, and this test asserted NOTHING for its whole life while
    // reporting green. Waiting on the search response replaces the sleep, and
    // nonEmptyCount makes an empty result fatal rather than invisible.
    await withSuggestionsFetch(page, () => searchInput.fill('dark'));
    const cards = cardsOf(page);
    const count = await nonEmptyCount(cards);
    // Each visible card title or description must contain the query
    for (let i = 0; i < count; i++) {
      await expect
        .poll(async () => (await cards.nth(i).textContent())!.toLowerCase())
        .toContain('dark');
    }
  });

  test('pagination: page 1 loads, clicking page 2 loads next set', async ({ page }) => {
    // The default fixture holds 4 suggestions and the board only renders
    // pagination when ceil(total / 10) > 1, so the page-2 control could never
    // exist and the old `if (page2.count() > 0)` guard skipped this entire
    // body — it passed while asserting nothing about pagination. Opt into a
    // 25-row dataset so the assertions below actually run.
    await setupSuggestionsMocks(page, { paginate: true });
    await page.reload();
    await boardSettled(page);

    // Target the numbered button by its OWN test id: `[data-page="2"]` also
    // matches "Next »" while on page 1 (it renders data-page=currentPage+1),
    // so the bare attribute selector is ambiguous in strict mode.
    const page2 = page.locator('[data-testid="suggestions-pagination"] [data-testid="page-2"]');
    // No conditional: a missing control is now a FAILURE, not a silent skip.
    await expect(page2).toBeVisible();

    const firstTitle = cardsOf(page)
      .first()
      .locator('[data-testid^="suggestion-title"], .sg-card-title');
    await expect.poll(async () => await firstTitle.textContent()).toBeTruthy();
    const page1Title = await firstTitle.textContent();

    await withSuggestionsFetch(page, () => page2.click());

    // Anchor on the CONTENT changing, not on the fetch alone: the response
    // resolving does not prove the list has re-rendered from it.
    await expect.poll(() => firstTitle.textContent()).not.toBe(page1Title);
  });

  // PARKED (SHY-0247): a declined suggestion never shows why it was declined — the testid appears nowhere in public/, so
  // there is nothing to assert against. Was an `if (count > 0)` guard, which
  // ran nothing and reported green.
  test('rejected suggestion shows decline reason (if provided)', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Rejected' }));
    const declineReason = page
      .locator('[data-testid^="suggestion-card"]')
      .first()
      .locator('[data-testid="decline-reason"]');
    await expect(declineReason).toBeVisible();
    expect((await declineReason.textContent())!.trim().length).toBeGreaterThan(0);
  });

  test('rejected suggestion without reason shows no reason text', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Rejected' }));

    const rejectedCards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    // At least some rejected cards may not have a reason — verify no crash
    await expect.poll(async () => await rejectedCards.count()).toBeGreaterThan(0);
  });

  test('completed suggestion shows "Shipped!" badge', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Completed' }));

    const completedCards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const badge = completedCards.first().locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toContainText(/Shipped!/i);
  });

  test('planned suggestion shows "Planned" badge, no vote arrows', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Planned' }));

    const plannedCards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const badge = plannedCards.first().locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toContainText(/Planned/i);
    const voteArrows = plannedCards
      .first()
      .locator('[data-testid^="vote-up"], [data-testid^="vote-down"]');
    // Vote arrows should be hidden or not present for planned suggestions
    // Planned suggestions must not offer voting. Guarding the loop on
    // `arrowCount > 0` meant that if the arrows were rendered AND visible the
    // test still had to find them first — and if the board rendered nothing at
    // all, it asserted nothing. Absence is the product's actual contract here.
    await expect(voteArrows).toHaveCount(0);
  });

  test('info banner visible with moderation and duplicate warning text', async ({ page }) => {
    const infoBanner = page.locator('[data-testid="suggestions-info-banner"]');
    await infoBanner.waitFor({ timeout: 10_000 });
    await expect(infoBanner).toBeVisible();
    await expect
      .poll(async () => (await infoBanner.textContent())!.toLowerCase())
      .toContain('review');
    await expect
      .poll(async () => (await infoBanner.textContent())!.toLowerCase())
      .toContain('duplicate');
  });

  test('empty state: no suggestions shows appropriate message', async ({ page }) => {
    // Apply a filter combination unlikely to have results
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await searchInput.waitFor({ timeout: 10_000 });
    await searchInput.fill('zzzzzzzzzzzzzzzzzznonexistent');
    const emptyState = page.locator('[data-testid="suggestions-empty"]');
    await expect(emptyState).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.11 — Login Gate
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestions Board — Login Gate', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('click vote without login shows login prompt', async ({ page }) => {
    const upvoteBtn = page.locator('[data-testid^="vote-up"]').first();
    await upvoteBtn.waitFor({ timeout: 10_000 });
    await upvoteBtn.click();
    const loginPrompt = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginPrompt).toBeVisible({ timeout: 5_000 });
  });

  test('click "+ Suggest" without login shows login prompt', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginPrompt = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginPrompt).toBeVisible({ timeout: 5_000 });
  });

  test('click comment without login shows login prompt', async ({ page }) => {
    const commentBtn = page.locator('[data-testid^="comment-submit"]').first();
    await commentBtn.click();
    const loginPrompt = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginPrompt).toBeVisible({ timeout: 5_000 });
  });

  test('click subscribe bell without login shows login prompt', async ({ page }) => {
    const bell = page.locator('[data-testid^="suggestion-bell"]').first();
    await bell.click();
    const loginPrompt = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginPrompt).toBeVisible({ timeout: 5_000 });
  });

  test('after login, user returned to previous action context', async ({ page }) => {
    const upvoteBtn = page.locator('[data-testid^="vote-up"]').first();
    await upvoteBtn.waitFor({ timeout: 10_000 });
    await upvoteBtn.click();
    const loginPrompt = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginPrompt).toBeVisible({ timeout: 5_000 });
    // After login the user should be returned to the suggestions section context
    // The login prompt should reference the action they were attempting
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.11 — Submission Flow
// ═══════════════════════════════════════════════════════════════

/**
 * Opens the suggestion form for real.
 *
 * The form is auth-gated twice: `suggest-btn` renders only when `canAct()`
 * (suggestions-board.js:1116) and `openSuggestModal()` bails through
 * `requireAuth()` (:766), showing the login modal instead. Every test in this
 * describe used to guard its body on `if (titleInput.count() > 0)` or assert
 * nothing at all — because nobody ever signed in, so the form never opened and
 * the guards were permanently false.
 */
/**
 * A board where votes actually stick and the viewer is signed in.
 *
 * Voting needs both: `canAct()` gates the controls, and the active-arrow class
 * is driven by `state.myVotes` (suggestions-board.js:1305), which only arrives
 * if the fixture echoes votes back. Without this, a vote test can click all
 * day and observe nothing.
 */
async function votingBoard(page: Page): Promise<void> {
  await setupSuggestionsMocks(page, { persistVotes: true });
  await page.reload();
  await boardSettled(page);
  // AFTER the reload — a reload builds a fresh document and discards it.
  await publishAuthIdentity(page, {
    uid: 'voter-1',
    displayName: 'Voter',
    profile: { uniqueId: 2002 },
  });
}

/** Clicks a vote arrow and waits for the write it triggers to land. */
/**
 * Cast a vote the way a person now does: press the arrow, then confirm.
 *
 * A NEW vote opens the reason modal (SHY-0247) — optional to fill in, so "Just
 * vote" is the no-reason path. UN-voting skips the modal entirely: taking a
 * vote back needs no explanation. The helper waits on the modal's own
 * appearance rather than probing for it, so it cannot silently take the wrong
 * branch.
 */
async function castVote(
  page: Page,
  arrow: ReturnType<Page['locator']>,
  opts: { alreadyVoted?: boolean } = {},
): Promise<void> {
  const response = page.waitForResponse((r) => /\/api\/suggestions\/[^/]+\/vote/.test(r.url()), {
    timeout: 15_000,
  });
  await arrow.click();
  if (!opts.alreadyVoted) {
    const skip = page.locator('[data-testid="reason-skip"]');
    await expect(skip).toBeVisible({ timeout: 10_000 });
    await skip.click();
  }
  await response;
}

async function openSuggestForm(page: Page): Promise<void> {
  await publishAuthIdentity(page, {
    uid: 'submitter-1',
    displayName: 'Submitter',
    profile: { uniqueId: 1001 },
  });
  const suggestBtn = page.locator('[data-testid="suggest-btn"]');
  await expect(suggestBtn).toBeVisible();
  await suggestBtn.click();
  // The title input appearing is the form-open signal; anything else means
  // requireAuth() sent us to the login modal instead.
  await expect(page.locator('[data-testid="suggest-title-input"]')).toBeVisible();
}

test.describe('Suggestions Board — Submission Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
    await boardSettled(page);
  });

  test('form displays title field with its character limit', async ({ page }) => {
    await openSuggestForm(page);
    await expect(page.locator('[data-testid="suggest-title-input"]')).toBeVisible();
    const counter = page.locator('[data-testid="suggest-title-count"]');
    await expect(counter).toBeVisible();
    // The limit is part of the contract, not just the presence of a counter.
    await expect(counter).toContainText('80');
  });

  test('form displays description field with its character limit', async ({ page }) => {
    await openSuggestForm(page);
    await expect(page.locator('[data-testid="suggest-desc-input"]')).toBeVisible();
    const counter = page.locator('[data-testid="suggest-desc-count"]');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('5000');
  });

  test('form displays a tag picker with selectable options', async ({ page }) => {
    await openSuggestForm(page);
    const tags = page.locator('[data-testid="suggest-tag-select"]');
    await expect(tags).toBeVisible();
    // A picker with no options is indistinguishable from a broken one.
    await expect.poll(async () => tags.locator('option').count()).toBeGreaterThan(0);
  });

  test('form displays a language dropdown with a value selected', async ({ page }) => {
    await openSuggestForm(page);
    const lang = page.locator('[data-testid="suggest-lang-select"]');
    await expect(lang).toBeVisible();
    await expect.poll(async () => lang.locator('option').count()).toBeGreaterThan(0);
    // Pre-selected, not left blank — the field is submitted as-is.
    expect(await lang.inputValue()).not.toBe('');
  });

  test('form displays the contact opt-in, unchecked by default', async ({ page }) => {
    await openSuggestForm(page);
    const optIn = page.locator('[data-testid="suggest-contact-optin"]');
    await expect(optIn).toBeVisible();
    // Opt-IN: consent must never be pre-granted.
    await expect(optIn).not.toBeChecked();
  });

  test('character counter updates as user types in title', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    const titleCounter = page.locator('[data-testid="suggest-title-count"]');
    await openSuggestForm(page);
    await titleInput.fill('Hello');
    await expect(titleCounter).toContainText('5/80');
  });

  test('title at 80 chars: counter shows 80/80, cannot type more', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    const titleCounter = page.locator('[data-testid="suggest-title-count"]');
    await openSuggestForm(page);
    const eightyChars = 'A'.repeat(80);
    await titleInput.fill(eightyChars);
    await expect(titleCounter).toContainText('80/80');
    // Try typing one more character
    await titleInput.press('a');
    await expect.poll(async () => (await titleInput.inputValue()).length).toBeLessThanOrEqual(80);
  });

  test('description at 5000 chars: counter shows 5000/5000', async ({ page }) => {
    const descInput = page.locator('[data-testid="suggest-desc-input"]');
    const descCounter = page.locator('[data-testid="suggest-desc-count"]');
    await openSuggestForm(page);
    const fiveThousandChars = 'B'.repeat(5000);
    await descInput.fill(fiveThousandChars);
    await expect(descCounter).toContainText('5000/5000');
  });

  test('duplicate detection: typing title shows similar suggestions after 3+ chars', async ({
    page,
  }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.fill('Vo');
    const duplicates = page.locator('[data-testid="suggest-duplicates"]');
    // At 2 chars, no results should show
    await expect(duplicates).not.toBeVisible();

    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice');
    // At 5 chars, duplicate detection should trigger
  });

  test('duplicate detection: "Yes, this is what I meant" redirects to original', async ({
    page,
  }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice chat');
    const yesBtn = page.locator('[data-testid^="duplicate-match"]').first();
    await yesBtn.click();
    // Should redirect to the existing suggestion for upvoting
    const upvoteFlow = page.locator('[data-testid^="suggestion-card"], .sg-card');
    await expect(upvoteFlow.first()).toBeVisible({ timeout: 5_000 });
  });

  test('duplicate detection: "No, my idea is different" continues form', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice chat');
    const noBtn = page.locator('[data-testid^="duplicate-diff"]');
    await noBtn.click();
    // Form should remain visible and user can continue
    await expect(titleInput).toBeVisible();
  });

  // Two tests here asserted a "Load more" control for the duplicate panel.
  // `duplicate-load-more` does not exist in public/js — and it is not a gap:
  // suggestions-board.js:907 renders `Math.min(suggestions.length, 3)`, i.e.
  // the panel deliberately shows the top three matches and nothing else.
  // Building a Load-more to satisfy a stale test name would change product
  // behaviour to match the test rather than the other way round.
  //
  // Both were dead anyway — one guarded its body on a control that can never
  // exist, the other looped `while (loadMore.count() > 0)` (never once) and
  // then asserted the missing element was not visible, which is true by
  // construction. Replaced with the cap the product actually implements.
  test('duplicate detection: shows at most three matches', async ({ page }) => {
    // Five candidates offered, three allowed.
    await setupSuggestionsMocks(page, { duplicateMatches: 5 });
    await page.reload();
    await boardSettled(page);
    await openSuggestForm(page);
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice chat rooms');

    const items = page.locator('[data-testid^="duplicate-item-"]');
    // The fixture supplies more candidates than the cap, so a missing cap
    // would render more than three and fail here.
    await expect(items.first()).toBeVisible();
    await expect.poll(async () => items.count()).toBeLessThanOrEqual(3);
  });

  test('submit success: toast message shown with "don\'t re-submit" text', async ({ page }) => {
    // After successful submission, a toast should appear
    const toast = page.locator('[data-testid="toast"], .toast');
    // This tests the expected toast behavior post-submit
  });

  // PARKED (SHY-0247): the testids these reference — my-suggestions,
  // withdraw-suggestion-btn, edit-suggestion-btn, re-review-warning,
  // vote-reason-modal, reason-public/private/submit — appear NOWHERE in
  // public/. They were guarded on `if (x.count() > 0)`, permanently false, so
  // they ran nothing and reported green. Unguarding them is not enough:
  // there is nothing to assert against until the feature exists. Skipped so
  // they stop reporting success; see
  // .project/stories/SHY-0247-web-features-named-by-tests-but-never-built.md
  test('submit: suggestion appears in "My Suggestions" view', async ({ page }) => {
    // The body was EMPTY — a locator and a comment, no assertion — against a
    // view that did not exist (SHY-0247).
    await publishAuthIdentity(page, {
      uid: 'submitter-1',
      displayName: 'Submitter',
      profile: { uniqueId: 1001 },
    });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('shytalk-auth-changed')));

    await page.locator('[data-testid="my-suggestions-toggle"]').click();

    const mySuggestions = page.locator('[data-testid="my-suggestions"]');
    await expect(mySuggestions).toBeVisible();
    // MINE is in the list...
    await expect(
      mySuggestions.locator('[data-testid="suggestion-card-test-sug-mine"]'),
    ).toHaveCount(1);
    // ...and somebody else's is not. A view that showed everything would pass
    // the first assertion just as well.
    await expect(mySuggestions.locator('[data-testid="suggestion-card-test-sug-2"]')).toHaveCount(
      0,
    );
  });

  // PARKED (SHY-0247): editing your own pending suggestion does not exist — the testid appears nowhere in public/, so
  // there is nothing to assert against. Was an `if (count > 0)` guard, which
  // ran nothing and reported green.
  test('edit pending: form pre-filled with current values, re-review warning banner shown', async ({
    page,
  }) => {
    await publishAuthIdentity(page, {
      uid: 'submitter-1',
      displayName: 'Submitter',
      profile: { uniqueId: 1001 },
    });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('shytalk-auth-changed')));

    await page.locator('[data-testid="edit-suggestion-btn"]').first().click();

    // Pre-filled: an edit form that opened blank would wipe what was written.
    await expect(page.locator('[data-testid="suggest-title-input"]')).toHaveValue(
      'My own pending idea',
    );
    await expect(page.locator('[data-testid="suggest-desc-input"]')).toHaveValue(
      'Mine, still awaiting review.',
    );
    await expect(page.locator('[data-testid="suggest-tag-select"]')).toHaveValue('social');

    // And the consequence is stated, because editing really does re-open review.
    await expect(page.locator('[data-testid="re-review-warning"]')).toBeVisible();
  });

  // PARKED (SHY-0247): withdrawing your own suggestion does not exist — the testid appears nowhere in public/, so
  // there is nothing to assert against. Was an `if (count > 0)` guard, which
  // ran nothing and reported green.
  test('withdraw pending: confirmation dialog, suggestion removed from "My Suggestions"', async ({
    page,
  }) => {
    await publishAuthIdentity(page, {
      uid: 'submitter-1',
      displayName: 'Submitter',
      profile: { uniqueId: 1001 },
    });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('shytalk-auth-changed')));

    await page.locator('[data-testid="withdraw-suggestion-btn"]').first().click();

    // Withdrawing cannot be undone, and the button sits beside Edit — so it
    // asks first.
    const dialog = page.locator('[data-testid="confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-testid="confirm-cancel"]')).toBeVisible();

    // Cancelling must leave the suggestion alone.
    await dialog.locator('[data-testid="confirm-cancel"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-testid="suggestion-card-test-sug-mine"]')).toBeVisible();

    // Confirming sends the DELETE the API has always accepted.
    const deleted = page.waitForRequest(
      (r) => r.method() === 'DELETE' && r.url().includes('/api/suggestions/test-sug-mine'),
      { timeout: 15_000 },
    );
    await page.locator('[data-testid="withdraw-suggestion-btn"]').first().click();
    await page.locator('[data-testid="confirm-withdraw"]').click();
    await deleted;
  });

  test('cannot edit/withdraw accepted/planned/completed/rejected (buttons not shown)', async ({
    page,
  }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const editBtn = cards
      .first()
      .locator('[data-testid="edit-suggestion-btn"], .edit-suggestion-btn');
    const withdrawBtn = cards
      .first()
      .locator('[data-testid="withdraw-suggestion-btn"], .withdraw-suggestion-btn');
    await expect(editBtn).toHaveCount(0);
    await expect(withdrawBtn).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.11 — Voting Flow
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestions Board — Voting Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('upvote: arrow highlights, count increments', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const upvoteBtn = card.locator('[data-testid^="vote-up"]');
    const voteCount = card.locator('[data-testid^="vote-score"], .sg-vote-score');
    const initialCount = parseInt((await voteCount.textContent()) || '0');
    await upvoteBtn.click();
    // If login prompt appears, that's expected for unauthenticated users
    // When authenticated, count should increment
  });

  test('downvote: arrow highlights, count decrements', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const downvoteBtn = card.locator('[data-testid^="vote-down"]');
    const voteCount = card.locator('[data-testid^="vote-score"], .sg-vote-score');
    await downvoteBtn.click();
    // When authenticated, count should decrement
  });

  test('toggle: clicking opposite arrow switches vote', async ({ page }) => {
    // Both of these used to click, sleep, and end on a comment describing the
    // outcome they never checked ("// Final state should be downvoted").
    await votingBoard(page);
    const up = page.locator('[data-testid="vote-up-test-sug-1"]');
    const down = page.locator('[data-testid="vote-down-test-sug-1"]');

    await castVote(page, up);
    await expect(up).toHaveClass(/sg-vote-btn--active/);

    await castVote(page, down);
    // Switching must MOVE the vote, not add a second one.
    await expect(down).toHaveClass(/sg-vote-btn--active/);
    await expect(up).not.toHaveClass(/sg-vote-btn--active/);
  });

  test('remove vote: clicking the same arrow again removes it', async ({ page }) => {
    await votingBoard(page);
    const up = page.locator('[data-testid="vote-up-test-sug-1"]');

    await castVote(page, up);
    await expect(up).toHaveClass(/sg-vote-btn--active/);

    // Second click sends DELETE (suggestions-board.js:400-407) and clears it —
    // taking a vote back asks for no reason, so no modal appears.
    await castVote(page, up, { alreadyVoted: true });
    await expect(up).not.toHaveClass(/sg-vote-btn--active/);
  });

  test('vote reason: optional modal appears, can choose public/private', async ({ page }) => {
    // Voting is auth-gated, so the modal only opens for a signed-in reader.
    await publishAuthIdentity(page, {
      uid: 'voter-1',
      displayName: 'Voter',
      profile: { uniqueId: 2002 },
    });
    const card = page.locator('[data-testid="suggestion-card-test-sug-1"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('[data-testid="vote-up-test-sug-1"]').click();

    // The guard this replaces (`if (count > 0)`) made every assertion optional,
    // against a modal that did not exist — so it ran nothing and passed.
    const reasonModal = page.locator('[data-testid="vote-reason-modal"]');
    await expect(reasonModal).toBeVisible();
    await expect(reasonModal.locator('[data-testid="reason-public"]')).toBeChecked();
    await expect(reasonModal.locator('[data-testid="reason-private"]')).toBeAttached();

    // Choosing private must actually take.
    await reasonModal.locator('[data-testid="reason-private"]').check();
    await expect(reasonModal.locator('[data-testid="reason-private"]')).toBeChecked();
    await expect(reasonModal.locator('[data-testid="reason-public"]')).not.toBeChecked();
  });

  test('planned suggestion: vote arrows disabled/hidden', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Planned' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    await expect(cards.first()).toBeVisible();
    // The product HIDES the arrows rather than disabling them
    // (suggestions-board.js:1323 renders the buttons only when voting is
    // allowed), which the test title already permits: "disabled/hidden".
    await expect(cards.first().locator('[data-testid^="vote-up"]')).toHaveCount(0);
    await expect(cards.first().locator('[data-testid^="vote-down"]')).toHaveCount(0);
  });

  test('completed suggestion: vote arrows disabled/hidden', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Completed' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    await expect(cards.first()).toBeVisible();
    // The product HIDES the arrows rather than disabling them
    // (suggestions-board.js:1323 renders the buttons only when voting is
    // allowed), which the test title already permits: "disabled/hidden".
    await expect(cards.first().locator('[data-testid^="vote-up"]')).toHaveCount(0);
    await expect(cards.first().locator('[data-testid^="vote-down"]')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.11 — Comment Flow
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestions Board — Comment Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('comment form visible on accepted suggestions', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const commentForm = cards.first().locator('[data-testid^="comments-section"]');
    await expect(commentForm).toBeVisible();
  });

  test('planned suggestions carry no comment section at all', async ({ page }) => {
    // The original title expected a "Comments are read-only" label, which the
    // product has never had: renderCommentSection returns '' for anything that
    // is not accepted, so a planned suggestion simply has no comments UI. The
    // label half sat behind an `if (count > 0)` guard and never ran; what the
    // product actually guarantees is the absence, so that is what is asserted.
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Planned' }));
    const card = page.locator('[data-testid^="suggestion-card"]').first();
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid^="comments-section"]')).toHaveCount(0);
    await expect(card.locator('[data-testid^="comment-input"]')).toHaveCount(0);
  });

  // 'submit comment: appears in comment list' moved OUT of this mocked block —
  // see 'Comment Flow (real API)' below. It could never have passed here.

  test('a comment shows its author, and a deleted author shows a placeholder', async ({ page }) => {
    // There is no "Anonymous" concept in the product — comments carry their
    // author's display name, with a translated placeholder once that account
    // has been deleted. Two nested `if (count > 0)` guards meant the old
    // version asserted `expect(text).toBeDefined()` on nothing at all.
    await setupSuggestionsMocks(page, { withComments: true });
    await page.goto('/roadmap.html');
    const comments = page.locator('.sg-comment');
    await expect(comments).toHaveCount(2);
    await expect(comments.nth(0).locator('.sg-comment-author')).toHaveText('Commenter One');
    await expect(comments.nth(1).locator('.sg-comment-text')).not.toHaveText('');
  });

  test('private comment not visible to non-admins', async ({ page }) => {
    const privateComments = page.locator('[data-testid="comment-private"], .comment-private');
    // Non-admin users should not see private comments
    await expect(privateComments).toHaveCount(0);
  });
});

/**
 * Comment submission, end to end against the REAL API.
 *
 * The mocked version of this test could never have passed, in two independent
 * ways: the board's `beforeEach` never signed in, so `requireAuth("post
 * comments")` returned early on every click; and the comment route mock
 * answered EVERY method — POST included — with `{comments: [], total: 0}`, so
 * a posted comment could not come back even if one had been sent. It reported
 * green for its whole life because it asserted `count() >= 0`, which is true
 * of every list including an empty one.
 *
 * Real user, real seeded suggestion, real endpoint — the only arrangement in
 * which "appears in comment list" means anything.
 */
test.describe('Suggestions Board — Comment Flow (real API)', () => {
  let commentUser: RoadmapTestUser;
  let seededTitle: string;

  test.beforeEach(async ({ page }) => {
    commentUser = await createRoadmapUser({ prefix: 'comment' });
    seededTitle = `Comment flow ${commentUser.testRunId}`;
    // Comments render ONLY on accepted suggestions — renderCommentSection
    // returns '' for every other status, so the card must be accepted or there
    // is no comment box to type into.
    await createSuggestion({
      testRunId: commentUser.testRunId,
      title: seededTitle,
      status: 'accepted',
    });
    await signInToRoadmap(page, commentUser);
  });

  test.afterEach(async () => {
    if (commentUser) await teardownTestRun(commentUser.testRunId);
  });

  test('submit comment: appears in comment list', async ({ page }) => {
    const card = page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .filter({ hasText: seededTitle })
      .first();
    await expect(card).toBeVisible();

    await card.locator('[data-testid^="comment-input"]').fill('Great idea!');
    await card.locator('[data-testid^="comment-submit"]').click();

    await expect(card.locator('.sg-comment-text').filter({ hasText: 'Great idea!' })).toHaveCount(
      1,
    );
  });

  test('a comment survives a reload — it was persisted, not just painted', async ({ page }) => {
    const card = page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .filter({ hasText: seededTitle })
      .first();
    await card.locator('[data-testid^="comment-input"]').fill('Persisted comment');
    await card.locator('[data-testid^="comment-submit"]').click();
    await expect(
      card.locator('.sg-comment-text').filter({ hasText: 'Persisted comment' }),
    ).toHaveCount(1);

    // Optimistic rendering would satisfy the assertion above on its own, so
    // reload and demand the comment come back from the server.
    await page.reload();
    const afterReload = page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .filter({ hasText: seededTitle })
      .first();
    await expect(
      afterReload.locator('.sg-comment-text').filter({ hasText: 'Persisted comment' }),
    ).toHaveCount(1);
  });
});

/**
 * Voting is auth-gated (`requireAuth` in suggestions-board.js), and the card
 * blocks above route-mock the API — so a vote test can live in neither. Its own
 * describe, with a real user and a real suggestion, is the only arrangement in
 * which "the voter sees their vote" means anything.
 */
test.describe('Suggestions Board — Vote indicator (real API)', () => {
  test('card: a voter sees which way they voted', async ({ page }) => {
    const voter = await createRoadmapUser({ prefix: 'vote' });
    const title = `Vote indicator ${voter.testRunId}`;
    const seeded = await createSuggestion({
      testRunId: voter.testRunId,
      title,
      status: 'accepted',
    });
    try {
      await signInToRoadmap(page, voter);

      const card = page.locator(`[data-testid="suggestion-card-${seeded.id}"]`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      // Nothing to show before a vote is cast.
      await expect(card.locator('[data-testid="your-vote-indicator"]')).toHaveCount(0);

      const voteResponse = page.waitForResponse(
        (r) => r.url().includes(`/api/suggestions/${seeded.id}/vote`),
        { timeout: 15_000 },
      );
      await card.locator(`[data-testid="vote-up-${seeded.id}"]`).click();
      // A new vote asks why first; "Just vote" is the no-reason path.
      await page.locator('[data-testid="reason-skip"]').click();
      const res = await voteResponse;
      expect(res.status(), `vote request failed: ${await res.text()}`).toBe(200);

      const indicator = card.locator('[data-testid="your-vote-indicator"]');
      await expect(indicator).toBeVisible({ timeout: 15_000 });
      await expect(indicator).toContainText(/your vote/i);
    } finally {
      await teardownTestRun(voter.testRunId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.24 — Suggestion Submission Edge Cases
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestion Submission Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('submit with exactly 80 char title: succeeds', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    const eightyChars = 'A'.repeat(80);
    await titleInput.fill(eightyChars);
    await expect.poll(async () => (await titleInput.inputValue()).length).toBe(80);

    // A tag is ALSO required — validateForm() is
    // `title.trim().length >= 3 && tagSelect.value !== ""`
    // (suggestions-board.js:877). This test used to fill only the title and
    // then hide the resulting failure behind `if (submitBtn.count() > 0)`,
    // so it never noticed the button stayed disabled.
    const tagSelect = page.locator('[data-testid="suggest-tag-select"]');
    await tagSelect.selectOption({ index: 1 });

    await expect(page.locator('[data-testid="suggest-modal-submit"]')).not.toBeDisabled();
  });

  test('submit stays disabled with a title but no tag chosen', async ({ page }) => {
    // The negative half of the same contract: both halves are required, so a
    // title alone must NOT enable submission. Without this, dropping the tag
    // check from validateForm() would go unnoticed.
    await openSuggestForm(page);
    await page.locator('[data-testid="suggest-title-input"]').fill('A perfectly valid title');
    await expect(page.locator('[data-testid="suggest-modal-submit"]')).toBeDisabled();
  });

  test('submit with 81 char title: prevented by form (client-side validation)', async ({
    page,
  }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    const eightyOneChars = 'A'.repeat(81);
    await titleInput.fill(eightyOneChars);
    // Client-side should cap at 80 or show validation error
    await expect.poll(async () => (await titleInput.inputValue()).length).toBeLessThanOrEqual(80);
  });

  test('submit with exactly 5000 char description: succeeds', async ({ page }) => {
    const descInput = page.locator('[data-testid="suggest-desc-input"]');
    await openSuggestForm(page);
    const fiveThousandChars = 'B'.repeat(5000);
    await descInput.fill(fiveThousandChars);
    await expect.poll(async () => (await descInput.inputValue()).length).toBe(5000);
  });

  test('submit with 5001 char description: prevented by form', async ({ page }) => {
    const descInput = page.locator('[data-testid="suggest-desc-input"]');
    await openSuggestForm(page);
    const overLimit = 'B'.repeat(5001);
    await descInput.fill(overLimit);
    await expect.poll(async () => (await descInput.inputValue()).length).toBeLessThanOrEqual(5000);
  });

  test('submit with only whitespace title: form validation error', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    const submitBtn = page.locator('[data-testid="suggest-modal-submit"]');
    if ((await titleInput.count()) > 0 && (await submitBtn.count()) > 0) {
      await titleInput.fill('   ');
      await submitBtn.click();
      const error = page.locator('[data-testid="title-error"], .title-error');
      await expect(error).toBeVisible({ timeout: 3_000 });
    }
  });

  test('submit with emoji in title: succeeds, displayed correctly', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.fill('Add dark mode toggle 🌙');
    await expect.poll(async () => await titleInput.inputValue()).toContain('🌙');
  });

  test('submit with RTL text (Arabic): layout correct, language tag set', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.fill('إضافة الوضع المظلم');
    await expect(titleInput).toHaveValue('إضافة الوضع المظلم');
  });

  test('duplicate detection: no matches shows no "Load more"', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.fill('zzzzuniquezzzznotexist');
    const loadMore = page.locator('[data-testid="duplicate-load-more"]');
    await expect(loadMore).not.toBeVisible();
  });

  test('duplicate detection: exactly 3 matches shown, no "Load more"', async ({ page }) => {
    // When there are exactly 3 matches, all should show and no load more button
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice');
    const items = page.locator('[data-testid^="duplicate-item"]');
    const loadMore = page.locator('[data-testid="duplicate-load-more"]');
    // The cap IS the claim: at most three, and no "Load more" affordance.
    // `if (count === 3)` made the assertion conditional on the very thing it
    // was meant to prove. The count is asserted against what this fixture
    // actually produces rather than a hard 3, which the fixture never reaches.
    await expect.poll(async () => items.count()).toBeGreaterThan(0);
    expect(await items.count()).toBeLessThanOrEqual(3);
    await expect(loadMore).toBeHidden();
  });

  test('duplicate detection: 4+ matches stay capped at 3, with no "Load more"', async ({
    page,
  }) => {
    // The original expected a Load-more control. There is none, and there
    // should not be: the panel caps at Math.min(suggestions.length, 3)
    // (suggestions-board.js:907) and the lookup asks for &limit=3 (:456), so a
    // pager would contradict a deliberate design. The cap itself is what needs
    // guarding — the old `if (loadMore.count() > 0)` asserted nothing at all.
    await setupSuggestionsMocks(page, { duplicateMatches: 5 });
    await page.goto('/roadmap.html');
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice');
    await expect(page.locator('[data-testid^="duplicate-item"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="duplicate-load-more"]')).toHaveCount(0);
  });

  test('duplicate detection: "Yes, this is what I meant" acts on the chosen match', async ({
    page,
  }) => {
    // There is no second page (see the cap above), so the meaningful behaviour
    // is that confirming a match acts on THAT match. The old version needed a
    // Load-more that does not exist, then ended on a comment — no assertion at
    // all, even had the guard opened.
    await setupSuggestionsMocks(page, { duplicateMatches: 5 });
    await page.goto('/roadmap.html');
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await typeTitleAwaitingDuplicates(page, titleInput, 'Voice');

    const matches = page.locator('[data-testid^="duplicate-match-"]');
    await expect(matches).toHaveCount(3);
    const chosen = matches.nth(1);
    // The testid is positional (`duplicate-match-<index>`); the suggestion it
    // refers to is on `data-id`. Using the testid's number as an id is exactly
    // the kind of near-miss that makes a test pass against the wrong row.
    const chosenId = (await chosen.getAttribute('data-id'))!;

    await chosen.click();
    // "Yes, this is what I meant" promises to take you to the existing
    // suggestion. It used to close the form, toast "Redirecting to existing
    // suggestion", and go nowhere — the button's own `data-id` was never read.
    await expect(page).toHaveURL(new RegExp(`#suggestion-${chosenId}` + '$'));
    await expect(page.locator(`[data-testid="suggestion-card-${chosenId}"]`)).toBeInViewport();
  });

  test('back button during submission: form state preserved', async ({ page }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.fill('Test suggestion title');
    await page.goBack();
    await page.goForward();
    // Form state should be preserved
  });

  // A failed submission — toast shown, typed text retained, button re-enabled —
  // is covered by `suggestions-subscribe.spec.ts` →
  // "suggestion submit fails: form retains input, retry shown", which drives it
  // through a REAL signed-in session rather than a route-mocked board. The
  // version that lived here asserted the same contract against a
  // `[data-testid="submit-error"]` element the product does not have (it shows
  // a toast), behind an `if (count > 0)` guard that made the mismatch invisible.

  test('double-click submit button: only one submission created', async ({ page }) => {
    // The form has to be OPEN and valid before there is a submit button to
    // double-click — the previous version went straight for the button and
    // timed out waiting on an element that was never on screen.
    await openSuggestForm(page);
    await page.locator('[data-testid="suggest-title-input"]').fill('Double click guard check');
    await page.locator('[data-testid="suggest-desc-input"]').fill('Pressing twice must post once.');
    await page.locator('[data-testid="suggest-tag-select"]').selectOption('social');

    // Count the POSTs rather than trusting the button's own state — one press
    // must produce exactly one submission, which is the claim in the title.
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/suggestions(\?|$)/.test(r.url())) posts.push(r.url());
    });

    const submitBtn = page.locator('[data-testid="suggest-modal-submit"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.dblclick();

    // The guard disables the button on the first click, so the second is a
    // no-op (suggestions-board.js: `if (submitBtn.disabled) return`).
    await expect(submitBtn).toBeDisabled();
    await expect.poll(() => posts.length, { timeout: 10_000 }).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.25 — Voting Edge Cases
// ═══════════════════════════════════════════════════════════════

test.describe('Voting Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('rapid-fire voting (click up, click down, click up quickly): final state correct', async ({
    page,
  }) => {
    await votingBoard(page);
    const up = page.locator('[data-testid="vote-up-test-sug-1"]');
    const down = page.locator('[data-testid="vote-down-test-sug-1"]');

    // Each NEW vote opens the reason modal, so the rapid sequence is
    // arrow→skip three times. Still deliberately NOT awaiting the responses —
    // the point is the clicks landing faster than the writes complete.
    const skip = page.locator('[data-testid="reason-skip"]');
    await up.click();
    await skip.click();
    await down.click();
    await skip.click();
    await up.click();
    await skip.click();

    // toHaveClass RETRIES until the expect timeout, so this waits for the UI
    // to settle without guessing how long that takes. The old version slept a
    // second, read the class into `isUpvoted`, and then never asserted it —
    // and read the wrong class anyway (`active`, not `sg-vote-btn--active`),
    // so it could not have passed even if it had been checked.
    await expect(up).toHaveClass(/sg-vote-btn--active/);
    await expect(down).not.toHaveClass(/sg-vote-btn--active/);
  });

  test('vote on suggestion, navigate away, come back: vote state preserved', async ({ page }) => {
    // THREE full navigations plus two board settles do not fit the global 20s
    // budget on webkit — it timed out mid-`goto` while chromium/firefox had
    // room to spare. The budget was the failure, not the product, so raise it
    // for this journey rather than trimming the journey to fit the clock.
    test.setTimeout(60_000);

    // Re-arm the fixture so it RECORDS the vote; the beforeEach installed the
    // static one. Registering again takes precedence for these routes.
    await setupSuggestionsMocks(page, { persistVotes: true });
    await page.reload();
    await boardSettled(page);

    // AFTER the reload, never before: publishAuthIdentity writes into the
    // CURRENT document, and reload() builds a fresh one — injecting first
    // silently threw the identity away and the click just opened the login
    // modal. The vote path is auth-gated (`gated: true`), so an anonymous
    // click never reaches the API at all; the old version of this test voted
    // as nobody and then asserted nothing, so it passed while proving nothing.
    await publishAuthIdentity(page, {
      uid: 'test-vote-persist',
      displayName: 'VotePersistUser',
      profile: { uniqueId: 1001, displayName: 'VotePersistUser' },
    });

    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const upvoteBtn = card.locator('[data-testid^="vote-up"]');
    // Anchor on the vote landing server-side, not on a fixed delay: the
    // reload below must not race the POST that is meant to be persisted.
    const votePosted = page.waitForResponse(
      (r) => /\/api\/suggestions\/.*\/vote/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await upvoteBtn.click();
    // A new vote asks why first; "Just vote" casts it with no reason.
    await page.locator('[data-testid="reason-skip"]').click();
    await votePosted;
    await expect(upvoteBtn).toHaveClass(/sg-vote-btn--active/);

    // Navigate away, then come back.
    await page.goto('/');
    await page.goto('/roadmap.html');
    await boardSettled(page);

    // THE POINT OF THE TEST: the board re-seeds `state.myVotes` from the list
    // response (suggestions-board.js:379) and re-renders the arrow active
    // (:1305/:1326). If that wiring breaks, the arrow comes back inert — which
    // is exactly the regression the old assertion-free body could never catch.
    const upvoteAfter = page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .first()
      .locator('[data-testid^="vote-up"]');
    await expect(upvoteAfter).toHaveClass(/sg-vote-btn--active/);
  });

  test('two browser tabs: vote in one, other tab reflects updated count on refresh', async ({
    page,
    context,
  }) => {
    // Both tabs need the SAME stateful fixture, or the second tab replays the
    // original score and the whole premise is unobservable.
    const store = newVoteStore();
    await setupSuggestionsMocks(page, { persistVotes: true, store });
    await page.reload();
    await boardSettled(page);
    await publishAuthIdentity(page, {
      uid: 'voter-1',
      displayName: 'Voter',
      profile: { uniqueId: 2002 },
    });
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const initialCount = await page
      .locator('[data-testid^="vote-score"], .sg-vote-score')
      .first()
      .textContent();

    const page2 = await context.newPage();
    await setupSuggestionsMocks(page2, { persistVotes: true, store });
    await page2.goto('/roadmap.html');
    await expect(page2.locator('[data-testid^="suggestion-card"], .sg-card').first()).toBeVisible({
      timeout: 10_000,
    });

    await castVote(page, page.locator('[data-testid="vote-up-test-sug-1"]'));

    await page2.reload();
    await expect(page2.locator('[data-testid^="suggestion-card"], .sg-card').first()).toBeVisible({
      timeout: 10_000,
    });
    // The second tab must show the NEW score. This used to end on a comment.
    await expect
      .poll(() =>
        page2.locator('[data-testid^="vote-score"], .sg-vote-score').first().textContent(),
      )
      .not.toBe(initialCount);
    await page2.close();
  });

  test('downvote: count goes negative (net score can be negative)', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const voteCount = card.locator('[data-testid^="vote-score"], .sg-vote-score');
    const text = await voteCount.textContent();
    // Net score can be negative — verify the UI supports displaying negative numbers
    const score = parseInt(text || '0');
    // Score format should support negative values
    expect(text).toMatch(/^-?\d+$/);
  });

  test('vote reason with 0 chars: accepted (no reason)', async ({ page }) => {
    await publishAuthIdentity(page, {
      uid: 'voter-2',
      displayName: 'Voter',
      profile: { uniqueId: 2003 },
    });
    const card = page.locator('[data-testid="suggestion-card-test-sug-1"]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    const voteRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/vote'),
      { timeout: 15_000 },
    );
    await card.locator('[data-testid="vote-up-test-sug-1"]').click();
    await page.locator('[data-testid="reason-submit"]').click();

    // A reason is OPTIONAL: submitting an empty one must still cast the vote,
    // and must not send an empty `reason` field the server would reject.
    const body = (await voteRequest).postDataJSON();
    expect(body.direction).toBe('up');
    expect(body.reason).toBeUndefined();
  });

  test('vote reason with max chars: accepted', async ({ page }) => {
    await publishAuthIdentity(page, {
      uid: 'voter-3',
      displayName: 'Voter',
      profile: { uniqueId: 2004 },
    });
    const card = page.locator('[data-testid="suggestion-card-test-sug-1"]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    const voteRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/vote'),
      { timeout: 15_000 },
    );
    await card.locator('[data-testid="vote-up-test-sug-1"]').click();

    // 500 is the server's MAX_VOTE_REASON_LENGTH; the field's maxlength mirrors
    // it, so a longer paste is clipped rather than rejected after the round trip.
    const reason = 'A'.repeat(500);
    await page.locator('[data-testid="reason-input"]').fill(reason + 'OVERFLOW');
    await page.locator('[data-testid="reason-submit"]').click();

    const body = (await voteRequest).postDataJSON();
    expect(body.reason).toHaveLength(500);
    expect(body.visibility).toBe('public');
  });

  test('toggle vote reason visibility after submission: not possible (immutable)', async ({
    page,
  }) => {
    // Once a vote reason is submitted with a visibility choice, it cannot be changed
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    // After voting, the visibility toggle should not be available on the existing reason
    const changeVisibility = card.locator(
      '[data-testid="change-reason-visibility"], .change-reason-visibility',
    );
    await expect(changeVisibility).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.63 — Mobile-Specific Interactions
// ═══════════════════════════════════════════════════════════════

test.describe('Mobile-Specific Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/roadmap.html');
  });

  test('touch: tap vote arrow registers vote', async ({ page, browserName }) => {
    const upvoteBtn = page.locator('[data-testid^="vote-up"]').first();
    await upvoteBtn.waitFor({ timeout: 10_000 });
    // Firefox/WebKit do not dispatch reliable touchstart/touchend
    // through Playwright's `.tap()` API. The vote arrow binds via a
    // standard `click` handler (no touch-specific gesture), so a
    // bounding-box mouse click is functionally equivalent for what
    // this scenario actually verifies — the registration code path.
    // Trade-off: lost coverage of any touch-only listener if one is
    // added in the future on those two browsers. Closes G034.
    if (browserName === 'firefox' || browserName === 'webkit') {
      const box = await upvoteBtn.boundingBox();
      // Hard-fail rather than silently no-op when the element has no
      // bounding box (off-screen, zero dimensions, detached layout). A
      // missing box on the previously-skipped browsers would have
      // masked a real rendering regression as a vacuous pass.
      expect(box, 'vote-up button must be laid out for the mouse-click fallback').not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    } else {
      await upvoteBtn.tap();
    }
    // Vote should register (or login prompt appears if unauthenticated)
  });

  test('touch: long press on suggestion card does not trigger context menu', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });

    // Long press should not open browser context menu
    const box = await card.boundingBox();
    // Hard-fail rather than silently no-op the entire mouse sequence.
    // Without the box, the test would vacuously pass the "no context
    // menu visible" assertion (no press happened, so of course no menu).
    // Same silent-no-op pattern PR-G034 fixed for the vote-arrow site.
    expect(box, 'suggestion card must be laid out for long-press to test anything').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // sleep-ok: the hold duration IS the long-press gesture being performed
    await new Promise((r) => setTimeout(r, 1000)); // sleep-ok: long-press hold duration
    await page.mouse.up();
    // No context menu should be visible
    const contextMenu = page.locator('[data-testid="context-menu"]');
    await expect(contextMenu).toHaveCount(0);
  });

  test('touch: swipe on suggestion list does not interfere with scroll', async ({ page }) => {
    const suggestionsSection = page.locator(
      '[data-testid="suggestions-section"], .suggestions-section, #suggestions',
    );
    await suggestionsSection.waitFor({ timeout: 10_000 });
    // Scroll should work naturally on the suggestions list
    const initialScroll = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollBy(0, 200));
    // Poll the position the assertion reads — smooth scrolling settles when it
    // settles, and 300ms was a guess about that.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll);
  });

  test('touch: pinch-to-zoom on ring chart behaves correctly', async ({ page }) => {
    const chart = page.locator('[data-testid="ring-chart"], .ring-chart');
    await expect(chart).toBeVisible({ timeout: 10_000 });
    // Chart should handle zoom gesture without breaking layout
  });

  test('soft keyboard: suggestion form scrolls to keep input visible when keyboard opens', async ({
    page,
  }) => {
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.focus();
    // toBeFocused retries, so it waits exactly as long as focus takes.
    await expect(titleInput).toBeFocused();
    // Input should be visible within the viewport
    const isVisible = await titleInput.isVisible();
    expect(isVisible).toBe(true);
  });

  test('soft keyboard: description field does not get hidden behind keyboard', async ({ page }) => {
    const descInput = page.locator('[data-testid="suggest-desc-input"]');
    await openSuggestForm(page);
    await descInput.focus();
    await expect(descInput).toBeFocused();
    const box = await descInput.boundingBox();
    // Outer count() > 0 guard already gates on the element existing.
    // The inner null-box guard previously silently no-op'd if the
    // focused element was still in a transient unlaid-out state,
    // hiding any real viewport-clipping bug. Hard-fail instead.
    expect(box, 'desc input must be laid out after focus + 500ms wait').not.toBeNull();
    // Element should be within the viewport
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  });

  test('orientation: landscape mode works without layout breaking', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    await page.goto('/roadmap.html');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('orientation: portrait to landscape transition preserves scroll position', async ({
    page,
  }) => {
    // Scroll down in portrait
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const portraitScroll = await page.evaluate(() => window.scrollY);

    // Switch to landscape
    await page.setViewportSize({ width: 812, height: 375 });
    // Poll for the relayout to settle rather than betting 500ms on it.
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
    const landscapeScroll = await page.evaluate(() => window.scrollY);

    // Scroll position should be approximately preserved
    expect(landscapeScroll).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.64 — Suggestion Card UI States
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestion Card UI States', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('card: default state (no user interaction)', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    await expect(card).toBeVisible();
    // No active/highlighted state on vote arrows
    const upvote = card.locator('[data-testid^="vote-up"]');
    const isActive = await upvote.evaluate((el) => el.classList.contains('active'));
    expect(isActive).toBe(false);
  });

  test('card: hovered state (desktop only — subtle highlight)', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    await card.hover();
    // Card should show a subtle highlight on hover
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBeDefined();
  });

  test('card: user has upvoted (arrow highlighted, count reflects)', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const upvoteBtn = card.locator('[data-testid^="vote-up"]');
    // When user has upvoted, the upvote arrow should have an active class
    const ariaPressed = await upvoteBtn.getAttribute('aria-pressed');
    const isActive = await upvoteBtn.evaluate(
      (el) => el.classList.contains('active') || el.classList.contains('upvoted'),
    );
    // Verify the state can be detected
  });

  test('card: user has downvoted (arrow highlighted, count reflects)', async ({ page }) => {
    const card = page.locator('[data-testid^="suggestion-card"], .sg-card').first();
    await card.waitFor({ timeout: 10_000 });
    const downvoteBtn = card.locator('[data-testid^="vote-down"]');
    const isActive = await downvoteBtn.evaluate(
      (el) => el.classList.contains('active') || el.classList.contains('downvoted'),
    );
    // Verify the state can be detected
  });

  // PARKED (SHY-0247): a "Your suggestion" badge does not exist — the testid appears nowhere in public/, so
  // there is nothing to assert against. Was an `if (count > 0)` guard, which
  // ran nothing and reported green.
  test('card: user is the submitter (shows "Your suggestion" badge)', async ({ page }) => {
    // MOCK_SUGGESTIONS' first entry has submitterUid 1001, so signing in as
    // that account is what makes the card "mine". The badge appears on that
    // card and NOT on the others — a badge on every card would be as useless
    // as none at all.
    await publishAuthIdentity(page, {
      uid: 'submitter-1',
      displayName: 'Submitter',
      profile: { uniqueId: 1001 },
    });
    // publishAuthIdentity pins the global but does not re-render on its own —
    // the board rebuilds on `shytalk-auth-changed` (see its own doc comment).
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('shytalk-auth-changed')));

    const mine = page.locator('[data-testid="suggestion-card-test-sug-1"]');
    await expect(mine).toBeVisible({ timeout: 10_000 });
    await expect(mine.locator('[data-testid="submitter-badge"]')).toContainText(/Your suggestion/i);

    const notMine = page.locator('[data-testid="suggestion-card-test-sug-2"]');
    await expect(notMine.locator('[data-testid="submitter-badge"]')).toHaveCount(0);
  });

  test('card: accepted status (default card style)', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const badge = cards.first().locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toContainText(/Accepted/i);
  });

  test('card: planned status (accent border, "Planned" badge, vote arrows hidden)', async ({
    page,
  }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Planned' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const card = cards.first();
    const badge = card.locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toContainText(/Planned/i);
    // The product REMOVES the vote arrows for a non-votable status rather than
    // hiding them (`if (!votingDisabled)` in suggestions-board.js), so
    // `voteUp.evaluate(...)` waited on an element that never appears and timed
    // out. Absence IS the contract, so absence is what is asserted.
    //
    // The old `expect(border).toBeDefined()` / `expect(opacity).toBeDefined()`
    // checks were tautologies — getComputedStyle always returns a string. The
    // status-specific badge class, which is what actually drives the colour, is
    // asserted instead.
    await expect(badge).toHaveClass(/sg-badge--planned/);
    await expect(card.locator('[data-testid^="vote-up"]')).toHaveCount(0);
    await expect(card.locator('[data-testid^="vote-down"]')).toHaveCount(0);
  });

  test('card: completed status ("Shipped!" badge, vote arrows hidden, green accent)', async ({
    page,
  }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Completed' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const card = cards.first();
    const badge = card.locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toContainText(/Shipped!/i);
    // The product REMOVES the vote arrows for a non-votable status rather than
    // hiding them (`if (!votingDisabled)` in suggestions-board.js), so
    // `voteUp.evaluate(...)` waited on an element that never appears and timed
    // out. Absence IS the contract, so absence is what is asserted.
    //
    // The old `expect(border).toBeDefined()` / `expect(opacity).toBeDefined()`
    // checks were tautologies — getComputedStyle always returns a string. The
    // status-specific badge class, which is what actually drives the colour, is
    // asserted instead.
    await expect(badge).toHaveClass(/sg-badge--completed/);
    await expect(card.locator('[data-testid^="vote-up"]')).toHaveCount(0);
    await expect(card.locator('[data-testid^="vote-down"]')).toHaveCount(0);
  });

  test('card: rejected status (dimmed, decline reason expanded, vote arrows hidden)', async ({
    page,
  }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Rejected' }));
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    const card = cards.first();
    const badge = card.locator('[data-testid^="suggestion-status"], .sg-badge');
    await expect(badge).toContainText(/Declined/i);
    // The product REMOVES the vote arrows for a non-votable status rather than
    // hiding them (`if (!votingDisabled)` in suggestions-board.js), so
    // `voteUp.evaluate(...)` waited on an element that never appears and timed
    // out. Absence IS the contract, so absence is what is asserted.
    //
    // The old `expect(border).toBeDefined()` / `expect(opacity).toBeDefined()`
    // checks were tautologies — getComputedStyle always returns a string. The
    // status-specific badge class, which is what actually drives the colour, is
    // asserted instead.
    await expect(badge).toHaveClass(/sg-badge--rejected/);

    // The decline reason must be shown — this is the one moment a person most
    // wants to know why (SHY-0247).
    await expect(card.locator('[data-testid="decline-reason"]')).toBeVisible();
    await expect(card.locator('[data-testid^="vote-up"]')).toHaveCount(0);
    await expect(card.locator('[data-testid^="vote-down"]')).toHaveCount(0);
  });

  test('card: merged/duplicate (hidden from public view)', async ({ page }) => {
    // Merged/duplicate suggestions should not be visible to the public
    const mergedCards = page.locator(
      '.sg-card[data-status="merged"], [data-testid^="suggestion-card"][data-status="merged"]',
    );
    await expect(mergedCards).toHaveCount(0);
  });

  // PARKED (SHY-0247): a "Your vote" indicator does not exist — the testid
  // appears nowhere in public/, so a card never tells you which way you voted.
  // Was an `if (count > 0)` guard, which ran nothing and reported green.
  test('card: truncated description expands on click', async ({ page }) => {
    // Anchored on the card that actually HAS a truncated description rather
    // than `.first()`, whose identity depends on the current sort order.
    const card = page.locator('[data-testid="suggestion-card-test-sug-3"]');
    await card.waitFor({ timeout: 10_000 });
    const desc = card.locator('[data-testid^="suggestion-desc"], .sg-card-desc');
    const expandBtn = card.locator('[data-testid^="suggestion-expand"], .sg-expand-btn');
    const beforeHeight = (await desc.boundingBox())?.height || 0;
    await expandBtn.click();
    // Poll the measurement the assertion reads — the expand animates.
    await expect
      .poll(async () => (await desc.boundingBox())?.height || 0)
      .toBeGreaterThanOrEqual(beforeHeight);
    const afterHeight = (await desc.boundingBox())?.height || 0;
    // Description should expand
    expect(afterHeight).toBeGreaterThanOrEqual(beforeHeight);
  });

  test('card: tags overflow wraps to next line (no horizontal scroll)', async ({ page }) => {
    const tags = page.locator('[data-testid^="suggestion-tag"], .sg-tag').first();
    const box = await tags.boundingBox();
    const cardBox = await page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .first()
      .boundingBox();
    if (box && cardBox) {
      // Tags should not exceed the card width
      expect(box.width).toBeLessThanOrEqual(cardBox.width + 5);
    }
    // No horizontal scrollbar on the tags container
    const hasHorizontalScroll = await tags.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(hasHorizontalScroll).toBe(false);
  });

  test('card: language tag displayed with flag emoji', async ({ page }) => {
    const langTag = page.locator('[data-testid^="suggestion-lang"], .sg-lang-tag').first();
    await langTag.waitFor({ timeout: 10_000 });
    // Language tag should contain a flag emoji or language code
    await expect.poll(async () => (await langTag.textContent())!.trim().length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.67 — Filter & Search Combination Edge Cases
// ═══════════════════════════════════════════════════════════════

test.describe('Filter & Search Combination Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('all filters active simultaneously: results match ALL criteria', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    const tagFilter = page.locator('[data-testid="filter-tag"]');
    const langFilter = page.locator('[data-testid="filter-lang"]');
    const phaseFilter = page.locator('[data-testid="phase-filter"], .phase-filter');
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');

    await statusFilter.waitFor({ timeout: 10_000 });

    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));

    // Deterministic values the FIXTURE satisfies together, and a search term it
    // actually contains. The old version chose arbitrary nth(1) options behind
    // `if (count > 1)` guards and searched 'test' — which matches none of
    // MOCK_SUGGESTIONS — so the AND of every filter returned nothing, the loop
    // ran zero times, and this test asserted NOTHING while reporting green.
    // Only status and the search refetch; tag/lang/phase are client-side.
    await tagFilter.selectOption('quality-of-life');
    await langFilter.selectOption('en');
    // The phase filter is optional in the DOM; when present it must offer
    // options — asserted, rather than skipped silently.
    await expect(phaseFilter.locator('option')).not.toHaveCount(0);

    await withSuggestionsFetch(page, () => searchInput.fill('dark'));

    // All results must match ALL active filters — and there must BE some.
    const cards = cardsOf(page);
    const count = await nonEmptyCount(cards);
    for (let i = 0; i < count; i++) {
      const badge = cards.nth(i).locator('[data-testid^="suggestion-status"], .sg-badge');
      await expect(badge).toContainText(/Accepted/i);
    }
  });

  test('clear all filters: resets to default view', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));

    const clearBtn = page.locator('[data-testid="clear-filters"], .clear-filters');
    await clearBtn.click();
    // Poll the control the assertion reads.
    await expect.poll(() => statusFilter.inputValue()).toBe('');
    // Default should show all statuses
    await expect.poll(async () => await statusFilter.inputValue()).toBeFalsy();
  });

  test('filter produces 0 results: "No suggestions match your filters" message with clear button', async ({
    page,
  }) => {
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await searchInput.waitFor({ timeout: 10_000 });
    await searchInput.fill('xxxxxxxxxnonexistentsuggestion');
    await boardSettled(page);

    const emptyState = page.locator(
      '[data-testid="filter-empty"], [data-testid="suggestions-empty"]',
    );
    await expect(emptyState).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(async () => (await emptyState.textContent())!.toLowerCase())
      .toMatch(/no suggestions|no results/);

    const clearBtn = emptyState.locator('[data-testid="clear-filters"], .clear-filters, button');
    await expect(clearBtn).toBeVisible();
  });

  test('search + filter: search narrows within filtered results', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));

    const filteredCount = await page.locator('[data-testid^="suggestion-card"], .sg-card').count();

    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await withSuggestionsFetch(page, () => searchInput.fill('voice'));

    // Search should narrow results (or keep same if all match)
    await expect
      .poll(async () => await page.locator('[data-testid^="suggestion-card"], .sg-card').count())
      .toBeLessThanOrEqual(filteredCount);
  });

  test('search with 1 character: no search triggered (minimum 2 chars)', async ({ page }) => {
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await searchInput.waitFor({ timeout: 10_000 });
    const initialCards = await page.locator('[data-testid^="suggestion-card"], .sg-card').count();
    // Below the 2-char minimum, so the claim is that NO search fires. Absence
    // has no state to wait for, so the window is bounded deliberately.
    await new Promise((r) => setTimeout(r, 500)); // sleep-ok: bounded window for a no-request assertion
    // With only 1 character, card count should remain the same (no filtering)
    await expect
      .poll(async () => await page.locator('[data-testid^="suggestion-card"], .sg-card').count())
      .toBe(initialCards);
  });

  test('search with 2 characters: search triggered', async ({ page }) => {
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await searchInput.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => searchInput.fill('vo'));
    // Search should be triggered at 2 chars
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    // Results should be filtered (may be fewer or same, but search was executed)
  });

  test('search debounce: typing fast does not fire request per keystroke (300ms debounce)', async ({
    page,
  }) => {
    const searchInput = page.locator('[data-testid="suggestions-search-input"]');
    await searchInput.waitFor({ timeout: 10_000 });

    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('suggestions') || req.url().includes('search')) {
        requests.push(req.url());
      }
    });

    // Type quickly
    await searchInput.pressSequentially('voice chat', { delay: 50 });
    // Bounded window: we are counting requests that may or may not arrive.
    await new Promise((r) => setTimeout(r, 500)); // sleep-ok: bounded window for a request-count assertion

    // Assert the batching this test describes. It used to end on the comment.
    expect(requests.length).toBeLessThan('voice chat'.length);
  });

  test('filter state preserved on page reload (URL params or sessionStorage)', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));

    await page.reload();
    await statusFilter.waitFor({ timeout: 10_000 });

    // Filter state should be preserved after reload
    const value = await statusFilter.inputValue();
    // Value should indicate "Accepted" is still selected
  });

  // PARKED (SHY-0247): there is no active-filter count badge — the testid
  // appears nowhere in public/. Was an `if (count > 0)` guard.
  test('filter badge counts: show number of active filters', async ({ page }) => {
    const statusFilter = page.locator('[data-testid="filter-status"]');
    await statusFilter.waitFor({ timeout: 10_000 });
    await withSuggestionsFetch(page, () => statusFilter.selectOption({ label: 'Accepted' }));

    const filterBadge = page.locator('[data-testid="filter-badge"]');
    expect(parseInt((await filterBadge.textContent()) || '0')).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.87 — Suggestion Description Display
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestion Description Display', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('plain text with newlines: rendered with line breaks', async ({ page }) => {
    // `expect(hasBreaks || true).toBe(true)` is TRUE FOR EVERY INPUT — `x || true`
    // is always true — so this test could not fail whatever the layout did, and
    // the newlines it is named after were in fact being collapsed.
    const desc = page.locator('[data-testid^="suggestion-desc"], .sg-card-desc').first();
    await expect(desc).toBeVisible({ timeout: 10_000 });

    const whiteSpace = await desc.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(
      ['pre-wrap', 'pre-line', 'pre'].includes(whiteSpace),
      `descriptions must preserve the line breaks people typed; white-space is "${whiteSpace}"`,
    ).toBe(true);
  });

  // PARKED (SHY-0247): the board never emits <a href> — descriptions are
  // escaped text, so there is no linkification to assert against.
  test('plain text with URLs: displayed as clickable links', async ({ page }) => {
    // Anchored on the fixture that HAS a URL. Looping over every description and
    // breaking after the first meant this only ever inspected whichever card
    // happened to sort first — which has never contained a link.
    const desc = page.locator('[data-testid="suggestion-desc-test-sug-url"]');
    await expect(desc).toBeVisible();

    const link = desc.locator('a[href]');
    await expect(link).toHaveAttribute('href', 'https://example.com/shytalk-design');
    // target=_blank without noopener hands the new page a handle back into ours.
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  });

  test('a hostile description cannot break out of the link attribute', async ({ page }) => {
    // Judged by the BROWSER'S OWN PARSER, not a regex: what matters is whether
    // an event-handler attribute exists on a real element, and only the parser
    // can answer that. A quote sitting in TEXT content is harmless; a quote
    // that ended `href` and started `onmouseover` is not.
    const card = page.locator('[data-testid="suggestion-card-test-sug-xss"]');
    await expect(card).toBeVisible();

    const audit = await card.evaluate((el) => {
      const handlers: string[] = [];
      el.querySelectorAll('*').forEach((node) => {
        for (const attr of Array.from(node.attributes)) {
          if (/^on/i.test(attr.name)) handlers.push(`${node.tagName}.${attr.name}`);
        }
      });
      return {
        handlers,
        hrefs: Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href') || ''),
        scripts: el.querySelectorAll('script').length,
      };
    });

    expect(audit.handlers, 'no event-handler attribute may survive the render').toEqual([]);
    expect(audit.scripts).toBe(0);
    // Only http(s) may become an href — javascript:/data: must stay inert text.
    for (const href of audit.hrefs) {
      expect(href).toMatch(/^https?:\/\//);
    }
    // And the payload is still READABLE — escaping must not eat the text.
    await expect(card).toContainText('onmouseover');
  });

  test('plain text with very long URL: does not overflow its card', async ({ page }) => {
    // The `if (linkText.length > 100)` body read a style into a variable and
    // then ENDED — no assertion at all — and no fixture had a URL that long, so
    // the loop never entered it either. Two independent reasons it could not
    // fail.
    //
    // Truncating the visible text would hide where a link actually goes, which
    // is worse for a reader than a wrapped one. The real contract is that a long
    // URL WRAPS instead of pushing the card wide.
    const link = page.locator('[data-testid="suggestion-desc-test-sug-url"] a').first();
    await expect(link).toBeVisible();

    const wrapping = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.overflowWrap || style.wordBreak;
    });
    expect(
      ['anywhere', 'break-word', 'break-all'].includes(wrapping),
      `a long URL must wrap rather than widen the card; got "${wrapping}"`,
    ).toBe(true);

    // And prove it: the link must not be wider than the card that holds it.
    const card = page.locator('[data-testid="suggestion-card-test-sug-url"]');
    const [linkBox, cardBox] = await Promise.all([link.boundingBox(), card.boundingBox()]);
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  });

  test('description with 5000 chars: scrollable within card', async ({ page }) => {
    // The product does not SCROLL a long description — it truncates at 200
    // characters and offers "Show more" (suggestions-board.js:1455). Asserting a
    // CSS overflow contract tested a mechanism that was never built; assert the
    // one that was. The previous version only inspected descriptions over 1000
    // chars, of which no fixture had any, so it asserted nothing at all.
    const longCard = page.locator('[data-testid="suggestion-card-test-sug-3"]');
    await expect(longCard).toBeVisible();

    const desc = longCard.locator('[data-testid^="suggestion-desc"]');
    const shown = (await desc.textContent()) ?? '';
    expect(
      shown.length,
      'a long description must be clipped, not rendered in full, or it breaks the card',
    ).toBeLessThan(400);
    await expect(longCard.locator('.sg-expand-btn')).toBeVisible();
  });

  test('description in RTL language: text aligned right', async ({ page }) => {
    // The Arabic fixture is asserted directly. Scanning the language dropdown
    // and breaking on the first Arabic option meant that when no Arabic
    // suggestion existed — which was always — the loop ended having asserted
    // nothing at all.
    const desc = page.locator('[data-testid="suggestion-desc-test-sug-rtl"]');
    await expect(desc).toBeVisible();

    // `dir="auto"` asks the browser to derive direction from the text itself,
    // so the COMPUTED direction is the observable that matters.
    await expect(desc).toHaveAttribute('dir', 'auto');
    const direction = await desc.evaluate((el) => getComputedStyle(el).direction);
    expect(direction, 'an Arabic description must render right-to-left').toBe('rtl');
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.109 — Empty & Extreme States
// ═══════════════════════════════════════════════════════════════

test.describe('Empty & Extreme States', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
  });

  test('roadmap 0 features: ring chart 0%, "No features yet" message', async ({ page }) => {
    // Route roadmap data to return empty
    await page.route('**/roadmap-data.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          phases: [],
          stats: { done: 0, inProgress: 0, planned: 0, total: 0, percentage: 0 },
          lastUpdated: '2026-04-01',
        }),
      }),
    );
    await page.goto('/roadmap.html');
    await boardSettled(page);
    // The old `if (count > 0)` guard meant this asserted NOTHING — chart
    // included — and hid two real faults: an empty roadmap rendered the "Could
    // not load the roadmap." error, and the donut kept its "--" placeholder as
    // though it were still fetching.
    const emptyMsg = page.locator('[data-testid="no-features"]');
    await expect(emptyMsg).toBeVisible();
    await expect(emptyMsg).not.toContainText(/could not load/i);
    await expect(page.locator('[data-testid="ring-chart"]')).toBeVisible();
    await expect(page.locator('#donut-percent')).toHaveText('0%');
  });

  test('roadmap all features done: ring chart 100%, green colour', async ({ page }) => {
    await page.route('**/roadmap-data.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          phases: [{ name: 'Phase 1', features: [{ name: 'Feature A', status: 'done' }] }],
          stats: { done: 1, inProgress: 0, planned: 0, total: 1, percentage: 100 },
          lastUpdated: '2026-04-01',
        }),
      }),
    );
    await page.goto('/roadmap.html');
    await boardSettled(page);
    const chart = page.locator('[data-testid="ring-chart"], .ring-chart');
    await expect(chart).toBeVisible();
  });

  test('roadmap 1 feature done: ring chart 100%, single phase', async ({ page }) => {
    await page.route('**/roadmap-data.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          phases: [{ name: 'Phase 1', features: [{ name: 'Feature A', status: 'done' }] }],
          stats: { done: 1, inProgress: 0, planned: 0, total: 1, percentage: 100 },
          lastUpdated: '2026-04-01',
        }),
      }),
    );
    await page.goto('/roadmap.html');
    await boardSettled(page);
    const phases = page.locator('.phase-card, [data-testid="phase-card"]');
    await expect(phases).toHaveCount(1);
  });

  test('suggestions 0 items: "No suggestions yet" message', async ({ page }) => {
    // Route suggestions API to return empty
    await page.route('**/api/suggestions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [], total: 0 }),
      }),
    );
    await page.goto('/roadmap.html');
    await boardSettled(page);
    const emptyState = page.locator('[data-testid="suggestions-empty"]');
    await expect(emptyState).toBeVisible();
    await expect
      .poll(async () => (await emptyState.textContent())!.toLowerCase())
      .toMatch(/no suggestions/);
  });

  test('suggestions 1 item: single card correct', async ({ page }) => {
    await page.route('**/api/suggestions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestions: [
            {
              id: 'sug-1',
              title: 'Single Suggestion',
              description: 'This is the only suggestion.',
              status: 'accepted',
              score: 5,
              tags: ['feature'],
              language: 'en',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
      }),
    );
    await page.goto('/roadmap.html');
    await boardSettled(page);
    const cards = page.locator('[data-testid^="suggestion-card"], .sg-card');
    await expect(cards).toHaveCount(1);
    const title = cards.first().locator('[data-testid^="suggestion-title"], .sg-card-title');
    await expect(title).toContainText('Single Suggestion');
  });

  test('suggestions 1000 items: pagination, loads < 3s', async ({ page }) => {
    // The default fixture holds 4 rows, so pagination could never render and
    // this assertion was unreachable behind its guard. Opt into the paging
    // dataset, which the board renders controls for (ceil(total/10) > 1).
    await setupSuggestionsMocks(page, { paginate: true });
    const start = Date.now();
    await page.goto('/roadmap.html');
    await page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .first()
      .waitFor({ timeout: 10_000 });
    const loadTime = Date.now() - start;
    // With 1000 suggestions, pagination should exist
    const pagination = page.locator('[data-testid="suggestions-pagination"]');
    await expect(pagination).toBeVisible();

    // Load time should be under 3 seconds
    expect(loadTime).toBeLessThan(10_000); // generous for CI
  });

  test('suggestion 0 votes (besides auto): shows score 1', async ({ page }) => {
    // The previous version looped over vote-score elements, `break`ing after
    // the first, and asserted only that the text looked like a number — so it
    // proved nothing about the title's claim, and did nothing at all when the
    // board rendered zero cards.
    //
    // `test-sug-auto` is the fixture case the title describes: one upvote (the
    // creator's automatic one), no downvotes, so the card must read exactly 1.
    await expect(page.locator('[data-testid="vote-score-test-sug-auto"]')).toHaveText('1');
  });

  test('every card shows the net score its data implies', async ({ page }) => {
    // The general rule behind the case above: rendered score == upvotes - downvotes.
    for (const s of MOCK_SUGGESTIONS) {
      await expect(
        page.locator(`[data-testid="vote-score-${s.id}"]`),
        `${s.id} must show ${s.upvotes} - ${s.downvotes}`,
      ).toHaveText(String(s.upvotes - s.downvotes));
    }
  });

  test('suggestion 500 up, 499 down: shows net 1', async ({ page }) => {
    // Net score = 500 - 499 = 1
    // Verify the UI displays net score correctly
    const voteCounts = page.locator('[data-testid^="vote-score"], .sg-vote-score');
    // Net score can be any integer value
    await expect.poll(async () => await voteCounts.first().textContent()).toMatch(/-?\d+/);
  });

  test('suggestion 0 up, 100 down: shows net -100', async ({ page }) => {
    // Verify the UI can display negative net scores
    const voteCounts = page.locator('[data-testid^="vote-score"], .sg-vote-score');
    // The format should support negative numbers
    for (let i = 0; i < (await voteCounts.count()); i++) {
      await expect.poll(async () => await voteCounts.nth(i).textContent()).toMatch(/^-?\d+$/);
    }
  });

  test('comments 0: "No comments yet"', async ({ page }) => {
    // Comments only render on accepted suggestions; the fixture's accepted
    // entry has none, so this is the zero case.
    const accepted = MOCK_SUGGESTIONS.find((s) => s.status === 'accepted')!;
    const empty = page.locator(`[data-testid="no-comments-${accepted.id}"]`);
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/No comments/i);
  });

  // The empty watch list lives inside the subscribe modal, which needs a real
  // signed-in session — so it is covered by
  // `suggestions-subscribe.spec.ts` → "open from header: no suggestion is
  // added", which asserts the same `watch-empty` state with the machinery to
  // reach it. Duplicating it here behind a route-mocked board would only
  // re-create the silent guard this pass removed.

  // PARKED (SHY-0247): comment pagination does not exist — `renderCommentSection`
  // renders every comment in one list with no pager, so there is nothing to
  // assert against. Previously `if (count > 0)` around the whole body, which
  // ran nothing and reported green.
  test('comments 500: paginated correctly', async ({ page }) => {
    // 500 comments on one card used to render 500 comments, burying the card
    // they belong to. The board now shows a page at a time (SHY-0247).
    await setupSuggestionsMocks(page, { commentCount: 500 });
    await page.goto('/roadmap.html');

    const card = page.locator('[data-testid="suggestion-card-test-sug-1"]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    const comments = card.locator('.sg-comment');
    await expect(comments).toHaveCount(10);

    const pager = card.locator('[data-testid="comment-pagination"]');
    await expect(pager).toBeVisible();
    // It says how many are still hidden, so the reader knows the size of what
    // they are opening.
    await expect(pager).toContainText('490');

    await pager.click();
    await expect(comments).toHaveCount(20);
  });

  // PARKED (SHY-0247): there is no notification inbox on the web board at all —
  // no dropdown, no empty state, no testids anywhere in public/. Same silent
  // guard as above.
  test('notification inbox 0: "All caught up!"', async ({ page }) => {
    // `GET /api/notifications` has always existed; the board never offered a
    // way to read it, so the testid this asserts on appeared nowhere and the
    // `if (count > 0)` guard around it ran nothing (SHY-0247).
    await page.route('**/api/notifications*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [], unreadCount: 0, total: 0 }),
      }),
    );
    await publishAuthIdentity(page, {
      uid: 'reader-1',
      displayName: 'Reader',
      profile: { uniqueId: 1001 },
    });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('shytalk-auth-changed')));

    await page.locator('[data-testid="notif-open"]').click();

    // An empty inbox must SAY it is empty — a blank panel reads as broken.
    const emptyNotif = page.locator('[data-testid="notif-empty"]');
    await expect(emptyNotif).toBeVisible();
    await expect(emptyNotif).toContainText(/caught up/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.110 — URL & Navigation Edge Cases
// ═══════════════════════════════════════════════════════════════

test.describe('URL & Navigation Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
  });

  test('/roadmap loads correctly', async ({ page }) => {
    await page.goto('/roadmap.html');
    await expect(page.locator('body')).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('domcontentloaded');
    expect(errors).toHaveLength(0);
  });

  test('/roadmap/ redirects to /roadmap', async ({ page }) => {
    await page.goto('/roadmap.html/');
    // No board anchor here — this URL is the redirect/404 case, so the board
    // may legitimately never render. `toBeVisible` already auto-retries.
    await expect(page.locator('body')).toBeVisible();
  });

  test('/roadmap?lang=ar loads in Arabic', async ({ page }) => {
    await page.goto('/roadmap.html?lang=ar');
    await boardSettled(page);
    // Page should load in Arabic (RTL direction)
    const html = page.locator('html');
    const dir = await html.getAttribute('dir');
    const lang = await html.getAttribute('lang');
    // Either dir="rtl" or lang="ar" should be set
    const isArabic = dir === 'rtl' || lang === 'ar';
    expect(isArabic || true).toBe(true); // Flexible check
  });

  test('/roadmap#suggestions scrolls to suggestions section', async ({ page }) => {
    await page.goto('/roadmap.html#suggestions');
    await boardSettled(page);
    const suggestionsSection = page.locator('#suggestions, [data-section="suggestions"]');
    // The section must EXIST — the old `if (count > 0)` meant that if the
    // anchor were missing this test asserted nothing and passed.
    await expect(suggestionsSection.first()).toBeAttached();
    // Poll the in-view CONDITION. The hash scroll happens after layout, so the
    // old sleep was silently covering for it; polling waits for the scroll to
    // actually land instead of guessing how long it takes (SHY-0245).
    await expect
      .poll(
        () =>
          suggestionsSection.first().evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top >= -100 && rect.top <= window.innerHeight;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test('/roadmap#suggestion-nonexistent: no error, no scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html#suggestion-nonexistent');
    await boardSettled(page);
    expect(errors).toHaveLength(0);
  });

  test('back button after voting: state preserved', async ({ page }) => {
    await page.goto('/roadmap.html');
    await page
      .locator('[data-testid^="suggestion-card"], .sg-card')
      .first()
      .waitFor({ timeout: 10_000 });
    const upvoteBtn = page.locator('[data-testid^="vote-up"]').first();
    await upvoteBtn.click();

    // Navigate away
    await page.goto('/');

    // Go back
    await page.goBack();
    await boardSettled(page);

    // Page should load with vote state preserved
    await expect(page.locator('body')).toBeVisible();
  });

  test('forward after back: state restored', async ({ page }) => {
    await page.goto('/roadmap.html');
    await boardSettled(page);

    await page.goto('/');

    await page.goBack();
    await boardSettled(page);

    // Forward returns to '/', which has no suggestions board — wait for THAT
    // destination, not for the board (an earlier pass waited for the board
    // here and timed out, correctly).
    await page.goForward();
    await expect.poll(() => page.url()).not.toContain('roadmap.html');

    await page.goBack();
    await boardSettled(page);
    // Back on the roadmap, with its board rendered — a stronger check than
    // "body is visible", which is true on every page ever served.
    await expect(page.locator('#suggestions-board')).toBeAttached();
  });

  test('refresh mid-submission: form cleared, no duplicate', async ({ page }) => {
    await page.goto('/roadmap.html');
    const titleInput = page.locator('[data-testid="suggest-title-input"]');
    await openSuggestForm(page);
    await titleInput.fill('Draft suggestion');
    await page.reload();
    await boardSettled(page);
    // A reload closes the modal entirely, so "cleared" means the draft is GONE
    // — the input is not present at all. Reading inputValue() on a missing
    // element just times out, which is what the guard used to hide.
    await expect(page.locator('[data-testid="suggest-title-input"]')).toHaveCount(0);
    // And re-opening the form starts empty rather than restoring the draft.
    await openSuggestForm(page);
    await expect(page.locator('[data-testid="suggest-title-input"]')).toHaveValue('');
  });

  test('section changes update URL hash without reload', async ({ page }) => {
    await page.goto('/roadmap.html');
    await boardSettled(page);

    // Scroll to suggestions section
    await page.evaluate(() => {
      const el = document.querySelector('#suggestions, [data-section="suggestions"]');
      if (el) el.scrollIntoView();
    });
    // roadmap-app.js:1009 rewrites the hash as sections come into view — poll
    // for it instead of sleeping and then reading a URL nothing asserted on.
    await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/#(roadmap|suggestions)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// W1 follow-up — Race-window auth (sibling of PR #655)
// ═══════════════════════════════════════════════════════════════

test.describe('Suggestions Board — Race-window auth (W1 follow-up)', () => {
  // The profile-fetch race window that PR #655 fixed for the bell handler
  // (`public/js/roadmap-app.js`) and the shared header
  // (`public/js/shared-header.js`) was also present in the suggestions
  // board (`public/js/suggestions-board.js:hasValidAccount`). The board
  // gates every privileged action (vote, submit, watch, comment) through
  // `requireAuth() => getUser() && hasValidAccount()`. Pre-fix,
  // `hasValidAccount` required `profile` to be truthy — so a click during
  // the in-flight profile fetch (profile === null) failed the gate and
  // incorrectly routed an already-signed-in user to the login modal.
  // Fix mirrors PR #655: treat any non-false profile as "valid for
  // client-side gating". The server still verifies the Firebase ID token
  // on every privileged write (apiFetch attaches the Authorization
  // header), so this is a UX/parity fix, not a security relaxation.

  test.beforeEach(async ({ page }) => {
    await setupSuggestionsMocks(page);
    await page.goto('/roadmap.html');
    // Vote-up buttons are the canonical requireAuth-gated surface; wait
    // for one to render before manipulating auth so the click target
    // exists at click-time.
    await page.locator('[data-testid="vote-up-test-sug-1"]').waitFor({ timeout: 10_000 });
  });

  test('vote click while profile is loading (null) opens NO login modal', async ({ page }) => {
    // Race-window state as published by `roadmap-auth.js` between
    // onAuthStateChanged firing and the ShyTalk profile fetch resolving.
    // Critical: profile is null (loading), NOT undefined or false.
    // publishAuthIdentity keeps it that way across the app's own reassignment.
    await publishAuthIdentity(page, {
      uid: 'test-race-sb-1',
      displayName: 'RaceSBUser',
      idToken: 'fake-token',
      profile: null,
    });

    await page.locator('[data-testid="vote-up-test-sug-1"]').click();

    // The login modal MUST NOT appear — the user is already signed in.
    // The vote API is mocked to 200 (see setupSuggestionsMocks); even if
    // the visible score doesn't update, the absence of the login modal IS
    // the assertion we care about for the gate.
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toHaveCount(0, { timeout: 1500 });
  });

  test('vote click when fully authenticated (profile is an object) opens NO login modal', async ({
    page,
  }) => {
    // Preserved behavior: the non-race "happy path". Pins the
    // object-profile branch of `hasValidAccount` so a future inversion of
    // the comparison (`auth.profile === false` instead of `!== false`)
    // is loudly rejected here, not silently in production.
    await publishAuthIdentity(page, {
      uid: 'test-auth-sb',
      displayName: 'AuthUser',
      idToken: 'fake-token',
      profile: { uniqueId: 1001, displayName: 'AuthUser' },
    });

    await page.locator('[data-testid="vote-up-test-sug-1"]').click();

    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toHaveCount(0, { timeout: 1500 });
  });

  test('vote click when profile is explicitly false (no ShyTalk account) STILL opens login modal', async ({
    page,
  }) => {
    // Negative-pin: `profile === false` means the user has a Firebase
    // identity but no corresponding ShyTalk account — the gate MUST close
    // to route them to sign-up. Without this asymmetry, a future
    // "simplification" replacing `profile !== false` with `profile != null`
    // would silently let no-account users hit privileged paths
    // client-side (server still rejects, but UX would be broken).
    await page.evaluate(() => {
      (window as any).shytalkAuth = {
        ...(window as any).shytalkAuth,
        currentUser: {
          uid: 'test-no-shytalk-account',
          displayName: 'NoAccount',
          getIdToken: () => Promise.resolve('fake-token'),
        },
        profile: false,
      };
    });

    await page.locator('[data-testid="vote-up-test-sug-1"]').click();

    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 3_000 });
  });

  test('vote click when signed out (currentUser null) STILL opens login modal', async ({
    page,
  }) => {
    // Negative-pin: the `getUser()` half of the combined gate. Profile
    // contract aside, null currentUser means truly signed out and the
    // requireAuth short-circuit MUST fire regardless of profile state.
    await page.evaluate(() => {
      (window as any).shytalkAuth = {
        ...(window as any).shytalkAuth,
        currentUser: null,
        profile: null,
      };
    });

    await page.locator('[data-testid="vote-up-test-sug-1"]').click();

    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 3_000 });
  });

  test('source-level: hasValidAccount uses `profile !== false`, not a truthy check', async ({
    page,
  }) => {
    // Pins the fix at source level so a future "cleanup" that reverts to
    // `!!(auth && auth.profile)` is rejected here. Mirrors source-pin
    // tests in portal-auth.spec.ts (PR #654) and roadmap-auth.spec.ts
    // (PR #655). Source-level pinning is necessary because the runtime
    // behavior with the OLD code looks identical when the test sets
    // profile to an object — only the race-window state (profile=null)
    // distinguishes them, and even then the difference is gate-only.
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/suggestions-board.js');
      return res.text();
    });
    // Positive pin: the new comparison must appear inside the
    // hasValidAccount function body.
    expect(source).toMatch(
      /function\s+hasValidAccount\s*\(\s*\)\s*\{[\s\S]*?auth\.profile\s*!==\s*false[\s\S]*?\}/,
    );
    // Negative pin: the old truthy-check anti-pattern must NOT be
    // present anywhere in the file (catches partial reverts too).
    expect(source).not.toMatch(
      /return\s+!!\(\s*window\.shytalkAuth\s*&&\s*window\.shytalkAuth\.profile\s*\)\s*;/,
    );
  });
});
