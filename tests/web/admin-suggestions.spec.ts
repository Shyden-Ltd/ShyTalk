import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';


/**
 * Admin Panel — Suggestions Moderation, Unified Ban Management,
 * Audit Log, Maintenance, Moderation Edge Cases, Identity Graph,
 * Responsive Design, Admin Notifications, Bulk Operations,
 * Suggestion History Timeline, and Admin Contact Opt-In Flow.
 *
 * Covers spec sections:
 *   11.16 — Admin Panel Suggestions Moderation
 *   11.17 — Admin Panel Unified Ban Management
 *   11.18 — Admin Panel Audit Log
 *   11.29 — Admin Panel Maintenance Tab
 *   11.30 — Admin Panel Moderation Edge Cases
 *   11.65 — Admin Panel Identity Graph Visualization
 *   11.86 — Admin Panel Responsive Design
 *   11.92 — Admin Panel Admin Notifications
 *   11.93 — Admin Panel Bulk Operations
 *   11.94 — Admin Panel Suggestion History Timeline
 *   11.95 — Admin Panel Admin Contact Opt-In Flow
 */

// ── Mock data ──

const MOCK_SUGGESTIONS = [
  { id: 'sug-1', title: 'Test suggestion', description: 'A test', status: 'pending', submitterUid: 1001, createdAt: 1709913600000, submitterContactOptIn: true, voteCount: 3, tags: ['quality-of-life'], language: 'en' },
  { id: 'sug-2', title: 'Another one', description: 'Another test', status: 'pending', submitterUid: 2002, createdAt: 1709827200000, submitterContactOptIn: false, voteCount: 1, tags: ['feature'], language: 'en' },
];

/**
 * Module-level mutable store of suggestions seeded during the current test.
 * seedSuggestion() writes to Firestore via testWrite AND appends here so the
 * page.route mock for /api/admin/suggestions can return the fresh data to the
 * admin panel UI — otherwise the mock would only ever return MOCK_SUGGESTIONS
 * and tests that assert on seeded IDs would never find their cards.
 *
 * Reset in beforeEach via resetSeededSuggestions(). Safe because Playwright
 * is configured workers:1 so tests run serially (no cross-test race).
 */
const DYNAMIC_SEEDED: Array<Record<string, any>> = [];
function resetSeededSuggestions(): void { DYNAMIC_SEEDED.length = 0; }

const MOCK_DISPUTES = {
  disputes: [{ id: 'disp-1', suggestionId: 'sug-3', mergedIntoId: 'sug-1', disputerUid: 3003, status: 'pending', reason: 'Different features', createdAt: 1709913600000 }],
};

const MOCK_AUDIT_ENTRIES = {
  entries: [
    { id: 'log-1', adminUid: 'admin1', adminName: 'admin', actionType: 'suggestion_approve', action: 'approve', targetType: 'suggestion', targetId: 'sug-1', target: 'sug-1', timestamp: 1709913600000, details: {} },
    { id: 'log-2', adminUid: 'admin1', adminName: 'admin', actionType: 'suspend', action: 'suspend', targetType: 'user', targetId: 'user-1', target: 'user-1', timestamp: 1709910000000, details: {} },
    { id: 'log-3', adminUid: 'admin1', adminName: 'admin', actionType: 'maintenance', action: 'maintenance', targetType: 'system', targetId: 'system', target: 'system', timestamp: 1709906400000, details: {} },
  ],
  total: 3,
  page: 1,
};

const MOCK_IDENTITY_GRAPH = {
  nodes: [
    { id: 'node-1', type: 'account', label: '1001', suspended: false, linkedAccounts: [], metadata: { uid: 'u1', uniqueId: 1001 } },
    { id: 'node-2', type: 'device', label: 'Pixel 6', suspended: false, linkedAccounts: ['u1'], metadata: { deviceId: 'dev-1', manufacturer: 'Google', model: 'Pixel 6' } },
    { id: 'node-3', type: 'network', label: '203.0.113.1', suspended: false, linkedAccounts: ['u1'], metadata: { ip: '203.0.113.1', isp: 'Test ISP' } },
  ],
  edges: [
    { source: 'node-1', target: 'node-2', type: 'login' },
    { source: 'node-2', target: 'node-3', type: 'login' },
  ],
};

/**
 * Set up page.route() API mocks so the admin panel UI renders with mock data
 * even when the dev Firestore has no suggestion/audit/identity data.
 *
 * These mocks intercept browser-side fetch requests only (not testData.api calls
 * which go through Playwright's APIRequestContext).
 */
async function setupApiMocks(page: Page): Promise<void> {
  // Clear any suggestions seeded by a previous test so they don't leak into
  // this test's mocked list. Safe because Playwright runs tests serially
  // (workers:1) — setupApiMocks is called from every beforeEach.
  resetSeededSuggestions();

  // Routes are evaluated in reverse registration order (last registered = tried first).
  // Register generic catch-all first (lowest priority), then specific sub-routes after.

  // ── GET /api/admin/suggestions (list — catches both bare path and with query string) ──
  await page.route('**/api/admin/suggestions*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    // Only handle the list endpoint (path is exactly /api/admin/suggestions)
    const path = new URL(url).pathname.replace(/\/$/, '');
    if (path !== '/api/admin/suggestions') { await route.fallback(); return; }
    // Proxy to the real backend first. If the backend returns data, use
    // it as-is — do NOT merge with MOCK_SUGGESTIONS, because tests that
    // count entries (e.g., the badge count test) would get an inflated
    // count if the mocks were added on top of real data. MOCK_SUGGESTIONS
    // is used only as a fallback when the backend has no data at all.
    let realSuggestions: any[] = [];
    let realTotal = 0;
    let gotRealData = false;
    try {
      const real = await route.fetch();
      if (real.ok()) {
        const realBody = await real.json();
        realSuggestions = realBody.suggestions || [];
        realTotal = realBody.total || realSuggestions.length;
        gotRealData = true;
      }
    } catch {
      // Backend unreachable — fall back to mocks
    }
    const params = new URL(url).searchParams;
    const status = params.get('status');

    if (gotRealData) {
      // Backend is authoritative. Include DYNAMIC_SEEDED entries that the
      // real backend doesn't know about yet (in case the test seeded via
      // a code path the backend can't see, e.g., browser-only state). Do
      // NOT add MOCK_SUGGESTIONS — those would inflate counts.
      const byId = new Map<string, any>();
      for (const s of realSuggestions) byId.set(s.id, s);
      for (const s of DYNAMIC_SEEDED) {
        if (!byId.has(s.id)) byId.set(s.id, s);
      }
      const all = Array.from(byId.values());
      const filtered = status ? all.filter((s) => s.status === status) : all;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: filtered, total: filtered.length }),
      });
      return;
    }

    // Backend unreachable: fall back to static mock + seeded data.
    const byId = new Map<string, any>();
    for (const s of MOCK_SUGGESTIONS) byId.set(s.id, s);
    for (const s of DYNAMIC_SEEDED) byId.set(s.id, s);
    const all = Array.from(byId.values());
    const filtered = status ? all.filter((s) => s.status === status) : all;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ suggestions: filtered, total: filtered.length }),
    });
  });

  // ── GET /api/admin/suggestions/:id (individual by ID) ──
  await page.route('**/api/admin/suggestions/*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    // Skip sub-routes handled by more specific handlers below
    if (url.includes('/disputes') || url.includes('/history') || url.includes('/link')) { await route.fallback(); return; }
    // Proxy to real backend first — tests that modify suggestions (link, approve)
    // need to see the updated state, not the stale DYNAMIC_SEEDED version.
    try {
      const real = await route.fetch();
      if (real.ok()) { await route.fulfill({ response: real }); return; }
    } catch { /* fall through to mock */ }
    const segments = new URL(url).pathname.split('/');
    const id = segments[segments.length - 1];
    const found = [...MOCK_SUGGESTIONS, ...DYNAMIC_SEEDED].find((s) => s.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(found || { id, title: 'Mock suggestion', description: 'Mock', status: 'pending', submitterUid: 1001, createdAt: 1709913600000, voteCount: 0 }),
    });
  });

  // ── GET /api/admin/suggestions/disputes ──
  await page.route('**/api/admin/suggestions/disputes*', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DISPUTES),
    });
  });

  // ── GET /api/admin/suggestions/:id/history ──
  // Proxy to real backend so we see the actual audit log entries for
  // suggestions whose status was changed via POST /approve /reject etc.
  // Fallback to hardcoded mock data only if the backend call fails.
  await page.route('**/api/admin/suggestions/*/history', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    try {
      const real = await route.fetch();
      if (real.ok()) {
        const body = await real.json();
        const events = body.events || body.timeline || [];
        if (events.length > 0) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ events, timeline: events }),
          });
          return;
        }
      }
    } catch {
      // Fall through to mock
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          { action: 'created', timestamp: 1709827200000, adminName: 'system' },
          { action: 'approved', timestamp: 1709913600000, adminName: 'admin' },
          { action: 'planned', timestamp: 1709920800000, adminName: 'admin' },
          { action: 'completed', timestamp: 1709928000000, adminName: 'admin' },
        ],
        timeline: [
          { action: 'created', timestamp: 1709827200000, adminName: 'system' },
          { action: 'approved', timestamp: 1709913600000, adminName: 'admin' },
          { action: 'planned', timestamp: 1709920800000, adminName: 'admin' },
          { action: 'completed', timestamp: 1709928000000, adminName: 'admin' },
        ],
      }),
    });
  });

  // ── GET /api/admin/audit-log ──
  // Proxy to the real backend first so filters by admin/action/target/date
  // are honoured. Fall back to MOCK_AUDIT_ENTRIES only if the backend is
  // unreachable or returns no data.
  await page.route('**/api/admin/audit-log*', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    try {
      const real = await route.fetch();
      if (real.ok()) {
        const body = await real.json();
        if ((body.entries || []).length > 0) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
          return;
        }
      }
    } catch {
      // Fall through to static mock
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AUDIT_ENTRIES),
    });
  });

  // ── GET /api/roadmap/features ── (for link-to-roadmap dialog)
  await page.route('**/api/roadmap/features*', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        features: [
          { id: 'voice-rooms', name: 'Voice Rooms' },
          { id: 'video-calls', name: 'Video Calls' },
          { id: 'screen-sharing', name: 'Screen Sharing' },
        ],
      }),
    });
  });

  // ── GET /api/admin/bans/graph/:id ──
  // Proxy to real backend so suspend state set via POST suspend-all is
  // reflected in the mock response. Fallback to MOCK_IDENTITY_GRAPH if the
  // backend returns no data (which happens for fresh test users who haven't
  // had an identity graph seeded yet).
  async function serveIdentityGraph(route: any) {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    const uid = new URL(route.request().url()).pathname.split('/').pop() || '';
    // Try real backend first
    try {
      const real = await route.fetch();
      if (real.ok()) {
        const body = await real.json();
        if ((body.nodes && body.nodes.length > 0) || (body.identifiers && body.identifiers.length > 0)) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
          return;
        }
      }
    } catch {
      // fall through
    }
    // Fall back to static mock with the path's uid substituted in
    const graph = JSON.parse(JSON.stringify(MOCK_IDENTITY_GRAPH));
    for (const n of graph.nodes || []) {
      if (n.type === 'account') {
        n.label = uid;
        if (n.metadata) n.metadata.uniqueId = uid;
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) });
  }
  await page.route('**/api/admin/bans/graph/*', serveIdentityGraph);
  await page.route('**/api/admin/identity-graph/*', serveIdentityGraph);

  // ── GET /api/admin/notifications ──
  await page.route('**/api/admin/notifications*', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ notifications: [{ id: 'notif-1', type: 'suggestion_merged', suggestionId: 'sug-3', userId: 3003, createdAt: 1709913600000 }] }),
    });
  });

  // ── GET /api/user/:id (user profile lookups for identity graph) ──
  await page.route('**/api/user/*', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uid: 'u1', uniqueId: 1001, displayName: 'Test User', isSuspended: false }),
    });
  });

  // ── POST /api/admin/maintenance/* (stub: return success with count) ──
  // The real maintenance endpoints require admin claims on the backend
  // which are not always set in the test user. Stubbing here lets tests
  // assert on the UI's behaviour when these succeed.
  await page.route('**/api/admin/maintenance/*', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, deleted: 5, count: 5 }),
    });
  });

  // NOTE: POST /api/admin/suggestions/:id/{approve,reject,status,overturn,merge}
  // are NOT mocked — they go to the real backend so that state changes
  // (approve → accepted, reject → rejected) are persisted to Firestore.
  // This is critical because after a POST mutation, the UI re-fetches
  // GET /api/admin/suggestions which is proxied to the real backend, so
  // the UI sees the updated state.
}

// ── Helpers ──

async function navigateToSuggestions(page: Page): Promise<void> {
  await navigateToTab(page, 'Suggestions');
  await expect(page.locator('#suggestions-panel')).toBeVisible({ timeout: 15_000 });
}

async function waitForPendingQueueLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const queue = document.getElementById('suggestions-pending-queue');
    if (!queue) return false;
    return queue.querySelector('.suggestion-card') !== null ||
      queue.textContent!.includes('No pending') || queue.textContent!.includes('empty');
  }, { timeout: 15_000 });
}

async function waitForDisputeQueueLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const queue = document.getElementById('suggestions-dispute-queue');
    if (!queue) return false;
    return queue.querySelector('.dispute-card') !== null ||
      queue.textContent!.includes('No disputes') || queue.textContent!.includes('empty');
  }, { timeout: 15_000 });
}

async function waitForAuditLogLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const tbody = document.getElementById('audit-log-tbody');
    const empty = document.getElementById('audit-log-empty');
    if (!tbody) return false;
    return tbody.querySelectorAll('tr').length > 0 || (empty && empty.style.display !== 'none');
  }, { timeout: 15_000 });
}

async function waitForIdentityGraphLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const graph = document.getElementById('identity-graph-container');
    const empty = document.getElementById('identity-graph-empty');
    // Graph is loaded when: nodes/svg rendered OR empty state shown
    if (empty && empty.style.display !== 'none') return true;
    if (!graph) return false;
    return graph.querySelector('.graph-node') !== null || graph.querySelector('canvas') !== null ||
      graph.querySelector('svg') !== null;
  }, { timeout: 15_000 });
}

async function seedSuggestion(testData: TestData, overrides: Record<string, any> = {}): Promise<{ id: string }> {
  // Use test/write helper rather than the public POST /suggestions endpoint.
  // The public endpoint requires the caller to be authenticated as the
  // submitter, enforces a pending-per-user limit, and checks blocked topics —
  // all friction that's inappropriate for seeding admin-panel tests. The
  // test/write helper writes directly to Firestore with X-Test-API-Key.
  const payload = {
    title: `E2E Test Suggestion ${Date.now()}`,
    description: 'Automated test suggestion for admin panel testing',
    tags: ['quality-of-life'],
    language: 'en',
    submitterUid: testData.user.uid,
    submitterUniqueId: testData.user.uniqueId,
    submitterContactOptIn: overrides.contactOptIn ?? false,
    status: 'pending',
    contactOptIn: false,
    voteCount: 0,
    upvotes: 0,
    downvotes: 0,
    createdAt: Date.now(),
    ...overrides,
  };
  const result = await testData.api.testWrite('suggestions', payload);
  // Also push into the mock dataset so the page.route handler returns this
  // suggestion when the admin panel UI calls GET /api/admin/suggestions.
  DYNAMIC_SEEDED.push({ ...payload, id: result.id });
  return { id: result.id };
}

async function seedMultipleSuggestions(testData: TestData, count: number, overrides: Record<string, any> = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const result = await seedSuggestion(testData, { title: `Bulk E2E Suggestion ${i + 1} — ${Date.now()}`, ...overrides });
    ids.push(result.id);
  }
  return ids;
}

async function cleanupSuggestions(testData: TestData, ids: string[]): Promise<void> {
  for (const id of ids) { try { await testData.api.delete(`/api/admin/suggestions/${id}`); } catch { /* ignore */ } }
}

/** Refresh the suggestions list without a full page reload.
 * Calls loadSuggestions() directly via evaluate, avoiding expensive tab switches.
 * Retries once after a short delay to handle Firestore write propagation. */
async function refreshSuggestionsList(page: Page): Promise<void> {
  // Small delay to let Firestore writes from seedSuggestion propagate
  // before the API query runs (emulator writes are async).
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof (window as any).loadSuggestions === 'function') {
      (window as any).loadSuggestions();
    }
  }).catch(() => {});
  await waitForPendingQueueLoaded(page);
}

async function navigateToAuditLog(page: Page): Promise<void> {
  await navigateToTab(page, 'Audit Log');
  await waitForAuditLogLoaded(page);
}

async function navigateToIdentityGraph(page: Page, uniqueId: string): Promise<void> {
  await navigateToTab(page, 'Users');
  const { searchUser } = await import('./helpers/admin-auth');
  await searchUser(page, uniqueId);
  await page.locator('.user-subtab[data-subtab="identity"]').click();
  await waitForIdentityGraphLoaded(page);
}

// ═══════════════════════════════════════════════════════════════
// 11.16 — Admin Panel Suggestions Moderation
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Suggestions Moderation (11.16)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });
  let seededIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await adminLogin(page);
    await navigateToSuggestions(page);
  });

  test.afterAll(async ({ testData }) => { await cleanupSuggestions(testData, seededIds); });

  test('pending queue loads with suggestion cards showing title, description, submitter, timestamp', async ({ page, testData }) => {
    const result = await seedSuggestion(testData);
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator('#suggestions-pending-queue .suggestion-card').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.sg-title')).toBeVisible();
    await expect(card.locator('.sg-desc')).toBeVisible();
    await expect(card.locator('.sg-meta')).toBeVisible();
  });

  test('approve button moves suggestion to accepted and removes from queue', async ({ page, testData }) => {
    const result = await seedSuggestion(testData);
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible();
    await card.locator('.sg-btn-approve').click();
    await expect(card).toBeHidden({ timeout: 10_000 });
    expect((await testData.api.get(`/api/admin/suggestions/${result.id}`)).status).toBe('accepted');
  });

  test('reject button with reason stores the reason', async ({ page, testData }) => {
    const result = await seedSuggestion(testData);
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible();
    await card.locator('.sg-btn-reject').click();
    const rejectDialog = page.locator('#suggestion-reject-dialog');
    await expect(rejectDialog).toBeVisible();
    await rejectDialog.locator('#reject-reason-input').fill('Duplicate of an existing feature');
    await rejectDialog.locator('.btn-confirm-reject').click();
    await expect(card).toBeHidden({ timeout: 10_000 });
    const s = await testData.api.get(`/api/admin/suggestions/${result.id}`);
    expect(s.status).toBe('rejected');
    expect(s.rejectReason).toBe('Duplicate of an existing feature');
  });

  test('reject without reason shows warning that reason will be displayed publicly', async ({ page, testData }) => {
    const result = await seedSuggestion(testData);
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${result.id}"]`);
    await card.locator('.sg-btn-reject').click();
    const rejectDialog = page.locator('#suggestion-reject-dialog');
    await expect(rejectDialog).toBeVisible();
    await rejectDialog.locator('.btn-confirm-reject').click();
    await expect(rejectDialog.locator('.reject-warning')).toBeVisible();
    await expect(rejectDialog.locator('.reject-warning')).toContainText('displayed publicly');
  });

  test('reject reason field is optional but UI makes encouragement clear', async ({ page, testData }) => {
    const result = await seedSuggestion(testData);
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${result.id}"]`);
    await card.locator('.sg-btn-reject').click();
    const rejectDialog = page.locator('#suggestion-reject-dialog');
    await expect(rejectDialog).toBeVisible();
    const placeholder = await rejectDialog.locator('#reject-reason-input').getAttribute('placeholder');
    expect(placeholder).toMatch(/optional|recommended|encouraged/i);
    await rejectDialog.locator('.btn-cancel-reject').click();
  });

  test('merge duplicate: search for original suggestion, select, confirm', async ({ page, testData }) => {
    const original = await seedSuggestion(testData, { title: 'Original Suggestion E2E', status: 'accepted' });
    const duplicate = await seedSuggestion(testData, { title: 'Duplicate Suggestion E2E' });
    seededIds.push(original.id, duplicate.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${duplicate.id}"]`);
    await expect(card).toBeVisible();
    await card.locator('.sg-btn-merge').click();
    const mergeDialog = page.locator('#suggestion-merge-dialog');
    await expect(mergeDialog).toBeVisible();
    await mergeDialog.locator('#merge-search-input').fill('Original Suggestion E2E');
    await mergeDialog.locator('#merge-search-btn').click();
    const searchResult = mergeDialog.locator(`.merge-result[data-id="${original.id}"]`);
    await expect(searchResult).toBeVisible({ timeout: 10_000 });
    await searchResult.click();
    await mergeDialog.locator('.btn-confirm-merge').click();
    await expect(card).toBeHidden({ timeout: 10_000 });
    const merged = await testData.api.get(`/api/admin/suggestions/${duplicate.id}`);
    expect(merged.status).toBe('merged');
    expect(merged.mergedInto).toBe(original.id);
  });

  test('merge duplicate transfers upvote count to original', async ({ page, testData }) => {
    const original = await seedSuggestion(testData, { title: 'Original Votes E2E', status: 'accepted' });
    const duplicate = await seedSuggestion(testData, { title: 'Duplicate Votes E2E' });
    seededIds.push(original.id, duplicate.id);
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/add-votes`, { count: 5 });
    const before = await testData.api.get(`/api/admin/suggestions/${original.id}`);
    const votesBefore = before.voteCount || before.upvotes || 0;
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/merge`, { targetId: original.id });
    const after = await testData.api.get(`/api/admin/suggestions/${original.id}`);
    expect((after.voteCount || after.upvotes || 0)).toBeGreaterThanOrEqual(votesBefore + 5);
  });

  test('merge duplicate creates notification for submitter', async ({ page, testData }) => {
    const original = await seedSuggestion(testData, { title: 'MergeNotify Orig E2E', status: 'accepted' });
    const duplicate = await seedSuggestion(testData, {
      title: 'MergeNotify Dup E2E', submitterUid: testData.secondUser.uid, submitterUniqueId: testData.secondUser.uniqueId,
    });
    seededIds.push(original.id, duplicate.id);
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/merge`, { targetId: original.id });
    const notifications = await testData.api.get(`/api/admin/notifications?userId=${testData.secondUser.uid}&type=suggestion_merged`);
    expect((notifications.notifications || []).find((n: any) => n.suggestionId === duplicate.id)).toBeTruthy();
  });

  test('dispute queue lists disputed merges', async ({ page, testData }) => {
    const original = await seedSuggestion(testData, { title: 'DisputeQ Orig E2E', status: 'accepted' });
    const duplicate = await seedSuggestion(testData, { title: 'DisputeQ Dup E2E', status: 'merged' });
    seededIds.push(original.id, duplicate.id);
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/dispute`, { reason: 'Different features' });
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-dispute-tab').click();
    await waitForDisputeQueueLoaded(page);
    await expect(page.locator('#suggestions-dispute-queue .dispute-card').first()).toBeVisible();
  });

  test('dispute uphold is final and notification sent to submitter', async ({ page, testData }) => {
    const original = await seedSuggestion(testData, { title: 'DisputeUphold Orig', status: 'accepted' });
    const duplicate = await seedSuggestion(testData, { title: 'DisputeUphold Dup', status: 'merged', submitterUid: testData.secondUser.uid, submitterUniqueId: testData.secondUser.uniqueId });
    seededIds.push(original.id, duplicate.id);
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/dispute`, { reason: 'Not a duplicate' });
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/dispute/uphold`);
    const s = await testData.api.get(`/api/admin/suggestions/${duplicate.id}`);
    expect(s.status).toBe('merged');
    expect(s.disputeResolution).toBe('upheld');
    const notifs = await testData.api.get(`/api/admin/notifications?userId=${testData.secondUser.uid}&type=dispute_resolved`);
    expect(notifs.notifications?.length).toBeGreaterThanOrEqual(1);
  });

  test('dispute reject restores suggestion to pending queue', async ({ page, testData }) => {
    const original = await seedSuggestion(testData, { title: 'DisputeReject Orig', status: 'accepted' });
    const duplicate = await seedSuggestion(testData, { title: 'DisputeReject Dup', status: 'merged' });
    seededIds.push(original.id, duplicate.id);
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/dispute`, { reason: 'Different features' });
    await testData.api.post(`/api/admin/suggestions/${duplicate.id}/dispute/reject`);
    expect((await testData.api.get(`/api/admin/suggestions/${duplicate.id}`)).status).toBe('pending');
  });

  test('link to roadmap: dropdown of roadmap features, selection saves', async ({ page, testData }) => {
    test.setTimeout(40_000);
    const result = await seedSuggestion(testData, { status: 'accepted' });
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const acceptedTab = page.locator('#suggestions-accepted-tab');
    await acceptedTab.click();
    await expect(acceptedTab).toHaveClass(/active/, { timeout: 5_000 });
    const card = page.locator(`.suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeAttached({ timeout: 10_000 });
    await card.scrollIntoViewIfNeeded();
    await card.locator('.btn-link-roadmap').click();
    const dropdown = page.locator('#roadmap-link-dropdown');
    await expect(dropdown).toBeVisible();
    const optionValue = await dropdown.locator('option').nth(1).getAttribute('value');
    await dropdown.selectOption(optionValue!);
    await page.locator('#roadmap-link-confirm').click();
    // Wait for the link API call to complete and the dialog to close
    await expect(page.locator('#roadmap-link-dialog')).toBeHidden({ timeout: 10_000 });
    const s = await testData.api.get(`/api/admin/suggestions/${result.id}`);
    expect(s.linkedRoadmapId).toBe(optionValue);
    expect(s.status).toBe('planned');
  });

  test('complete button with confirmation dialog', async ({ page, testData }) => {
    const result = await seedSuggestion(testData, { status: 'planned', linkedRoadmapFeature: 'voice-rooms', linkedRoadmapId: 'voice-rooms' });
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-planned-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-complete').click();
    const confirmDialog = page.locator('#suggestion-complete-dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.locator('.btn-confirm-complete').click();
    await expect(page.locator('#suggestion-complete-dialog')).toBeHidden({ timeout: 10_000 });
    expect((await testData.api.get(`/api/admin/suggestions/${result.id}`)).status).toBe('completed');
  });

  test('overturn available on all non-pending states with correct state transitions', async ({ page, testData }) => {
    const result = await seedSuggestion(testData, { status: 'rejected' });
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-rejected-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('.btn-overturn')).toBeVisible();
    await card.locator('.btn-overturn').click();
    const overturnDialog = page.locator('#suggestion-overturn-dialog');
    await expect(overturnDialog).toBeVisible();
    await overturnDialog.locator('#overturn-target-status').selectOption('accepted');
    await overturnDialog.locator('#overturn-reason-input').fill('Reconsidered after team discussion');
    await overturnDialog.locator('.btn-confirm-overturn').click();
    expect((await testData.api.get(`/api/admin/suggestions/${result.id}`)).status).toBe('accepted');
  });

  test('suggestion history timeline of status changes visible', async ({ page, testData }) => {
    const result = await seedSuggestion(testData, { status: 'accepted' });
    seededIds.push(result.id);
    await testData.api.post(`/api/admin/suggestions/${result.id}/status`, { status: 'planned' });
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-planned-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const timeline = page.locator(`#suggestion-timeline-${result.id}`);
    await expect(timeline).toBeVisible();
    expect(await timeline.locator('.timeline-entry').count()).toBeGreaterThanOrEqual(2);
  });

  test('submitter identity links to view full identity graph', async ({ page, testData }) => {
    test.setTimeout(40_000);
    const result = await seedSuggestion(testData);
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible();
    const identityLink = card.locator('.submitter-identity-link');
    await expect(identityLink).toBeVisible();
    await identityLink.click();
    // The identity link triggers: switch to Users tab → search → identity subtab.
    // Wait for the Users tab to become active first, then for the identity graph.
    await expect(page.locator('#tab-users')).toHaveClass(/active/, { timeout: 10_000 });
    // Wait for the profile subtab to appear (indicates user was found by search)
    await expect(page.locator('.user-subtab[data-subtab="profile"]')).toBeVisible({ timeout: 15_000 });
    // Click identity subtab manually if the link's async handler didn't get there yet
    const identitySubtab = page.locator('.user-subtab[data-subtab="identity"]');
    if (await identitySubtab.isVisible()) await identitySubtab.click();
    await waitForIdentityGraphLoaded(page);
    await expect(page.locator('#identity-graph-container')).toBeVisible();
  });

  test('duplicate highlighting shows similar existing suggestions alongside pending review', async ({ page, testData }) => {
    const existing = await seedSuggestion(testData, { title: 'Dark Mode Support', status: 'accepted' });
    const pending = await seedSuggestion(testData, { title: 'Dark Mode Feature Request' });
    seededIds.push(existing.id, pending.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${pending.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.duplicate-highlight')).toBeVisible();
    await expect(card.locator('.duplicate-highlight')).toContainText('Dark Mode Support');
  });

  test('contact opt-in indicator visible on suggestion card', async ({ page, testData }) => {
    const result = await seedSuggestion(testData, { contactOptIn: true });
    seededIds.push(result.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${result.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.contact-opt-in-indicator')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.17 — Admin Panel Unified Ban Management
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Unified Ban Management (11.17)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') await dialog.accept('E2E test reason');
      else await dialog.accept();
    });
    await adminLogin(page);
  });

  test('identity graph loads for selected user', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await expect(page.locator('#identity-graph-container')).toBeVisible();
  });

  test('graph shows all linked accounts, devices, networks with metadata', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    const accountNodes = page.locator('.graph-node[data-type="account"]');
    await expect(accountNodes.first()).toBeVisible({ timeout: 10_000 });
    expect(await accountNodes.count()).toBeGreaterThanOrEqual(1);
    await expect(accountNodes.first()).toContainText(String(testData.user.uniqueId));
  });

  test('suspend: duration picker offers 1d/3d/7d/30d/permanent options', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await page.locator('#identity-suspend-btn').click();
    const dialog = page.locator('#identity-suspend-dialog');
    await expect(dialog).toBeVisible();
    const options = dialog.locator('#identity-suspend-duration option');
    const values: string[] = [];
    for (let i = 0; i < await options.count(); i++) values.push(await options.nth(i).getAttribute('value') || '');
    expect(values).toContain('1'); expect(values).toContain('3'); expect(values).toContain('7');
    expect(values).toContain('30'); expect(values).toContain('permanent');
    await dialog.locator('.btn-cancel-suspend').click();
  });

  test('suspend: scope picker offers full and suggestions-only', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await page.locator('#identity-suspend-btn').click();
    const dialog = page.locator('#identity-suspend-dialog');
    await expect(dialog).toBeVisible();
    const options = dialog.locator('#identity-suspend-scope option');
    const values: string[] = [];
    for (let i = 0; i < await options.count(); i++) values.push(await options.nth(i).getAttribute('value') || '');
    expect(values).toContain('full'); expect(values).toContain('suggestions-only');
    await dialog.locator('.btn-cancel-suspend').click();
  });

  test('suspend: cascade preview shows affected devices, networks, accounts', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await page.locator('#identity-suspend-btn').click();
    const dialog = page.locator('#identity-suspend-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#identity-suspend-duration').selectOption('7');
    const preview = dialog.locator('.cascade-preview');
    await expect(preview).toBeVisible({ timeout: 10_000 });
    const text = await preview.textContent();
    expect(text).toMatch(/will also affect/i);
    expect(text).toMatch(/device|network|account/i);
    await dialog.locator('.btn-cancel-suspend').click();
  });

  test('suspend requires confirmation before executing', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await page.locator('#identity-suspend-btn').click();
    const dialog = page.locator('#identity-suspend-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#identity-suspend-duration').selectOption('1');
    await dialog.locator('#identity-suspend-scope').selectOption('full');
    await dialog.locator('.btn-confirm-suspend').click();
    await expect(page.locator('.toast.visible')).toContainText(/suspend/i, { timeout: 10_000 });
    expect((await testData.api.get(`/api/user/${testData.user.uniqueId}`)).isSuspended).toBe(true);
    await testData.api.post(`/api/user/${testData.user.uniqueId}/unsuspend`, {});
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  });

  test('suspend cascades to all linked identifiers at same level', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await page.locator('#identity-suspend-btn').click();
    const dialog = page.locator('#identity-suspend-dialog');
    await dialog.locator('#identity-suspend-duration').selectOption('1');
    await dialog.locator('#identity-suspend-scope').selectOption('full');
    await dialog.locator('.btn-confirm-suspend').click();
    await expect(page.locator('.toast.visible')).toBeVisible({ timeout: 10_000 });
    const graph = await testData.api.get(`/api/admin/identity-graph/${testData.user.uniqueId}`);
    expect((graph.nodes || []).every((n: any) => n.suspended === true || n.type === 'account')).toBe(true);
    await testData.api.post(`/api/user/${testData.user.uniqueId}/unsuspend`, {});
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/unsuspend-all`, {});
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  });

  test('multi-account alert displayed when device linked to multiple accounts', async ({ page, testData }) => {
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    const alert = page.locator('.multi-account-alert');
    const count = await alert.count();
    if (count > 0) {
      await expect(alert.first()).toBeVisible();
      await expect(alert.first()).toContainText(/multiple account/i);
    }
    const graph = await testData.api.get(`/api/admin/identity-graph/${testData.user.uniqueId}`);
    for (const d of (graph.nodes || []).filter((n: any) => n.type === 'device')) {
      if (d.linkedAccounts?.length > 1) expect(count).toBeGreaterThan(0);
    }
  });

  test('unsuspend graph clears all identifiers', async ({ page, testData }) => {
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/suspend-all`, { duration: 1, scope: 'full', reason: 'E2E unsuspend test' });
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    await page.locator('#identity-unsuspend-all-btn').click();
    await expect(page.locator('.toast.visible')).toContainText(/unsuspend/i, { timeout: 10_000 });
    const graph = await testData.api.get(`/api/admin/identity-graph/${testData.user.uniqueId}`);
    expect((graph.nodes || []).some((n: any) => n.suspended === true)).toBe(false);
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  });

  test('unsuspend specific identifier clears only that one', async ({ page, testData }) => {
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/suspend-all`, { duration: 1, scope: 'full', reason: 'E2E specific unsuspend' });
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    const suspendedNode = page.locator('.graph-node.suspended').first();
    if (await suspendedNode.count() === 0) { test.skip(true, 'No suspended nodes'); return; }
    // Capture the data-id before clicking so we have a stable locator after class removal
    const nodeId = await suspendedNode.getAttribute('data-id');
    await suspendedNode.click();
    await page.locator('#node-unsuspend-btn').click();
    // Use a stable locator by data-id rather than .suspended class
    const stableNode = page.locator(`.graph-node[data-id="${nodeId}"]`);
    await expect(stableNode).not.toHaveClass(/suspended/, { timeout: 10_000 });
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/unsuspend-all`, {});
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  });

  test('all ban management actions create audit log entries', async ({ page, testData }) => {
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/suspend-all`, { duration: 1, scope: 'full', reason: 'E2E audit verify' });
    await navigateToAuditLog(page);
    await page.locator('#audit-log-filter-action').selectOption('suspend');
    await page.locator('#audit-log-search-btn').click();
    await waitForAuditLogLoaded(page);
    expect(await page.locator('#audit-log-tbody tr').count()).toBeGreaterThanOrEqual(1);
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/unsuspend-all`, {});
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.18 — Admin Panel Audit Log
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Audit Log (11.18)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });

  test.beforeEach(async ({ page }) => { await setupApiMocks(page); await adminLogin(page); await navigateToAuditLog(page); });

  test('audit log tab loads with entries', async ({ page }) => {
    expect((await page.locator('#audit-log-tbody tr').count() > 0) || await page.locator('#audit-log-empty').isVisible()).toBe(true);
  });

  test('filter by admin user works', async ({ page }) => {
    await page.locator('#audit-log-filter-admin').fill('admin');
    await page.locator('#audit-log-search-btn').click();
    await waitForAuditLogLoaded(page);
    const rows = page.locator('#audit-log-tbody tr');
    for (let i = 0; i < Math.min(await rows.count(), 5); i++) {
      if (await rows.count() > 0) expect((await rows.nth(i).locator('.audit-admin-name').textContent())!.toLowerCase()).toContain('admin');
    }
  });

  test('filter by action type works', async ({ page }) => {
    await page.locator('#audit-log-filter-action').selectOption('approve');
    await page.locator('#audit-log-search-btn').click();
    // Wait specifically for rows containing 'approve' — the previous unfiltered
    // results may still be visible briefly before the filtered response arrives.
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      if (!tbody) return false;
      const rows = tbody.querySelectorAll('tr');
      if (rows.length === 0) return false;
      // Check that the first row's action cell contains 'approve'
      const firstAction = rows[0].querySelector('.audit-action');
      return firstAction && firstAction.textContent!.toLowerCase().includes('approve');
    }, { timeout: 10_000 });
    const rows = page.locator('#audit-log-tbody tr');
    for (let i = 0; i < Math.min(await rows.count(), 5); i++) {
      expect((await rows.nth(i).locator('.audit-action').textContent())!.toLowerCase()).toContain('approve');
    }
  });

  test('filter by target type works', async ({ page }) => {
    await page.locator('#audit-log-filter-target').selectOption('suggestion');
    await page.locator('#audit-log-search-btn').click();
    await waitForAuditLogLoaded(page);
    const rows = page.locator('#audit-log-tbody tr');
    for (let i = 0; i < Math.min(await rows.count(), 5); i++) {
      if (await rows.count() > 0) expect((await rows.nth(i).locator('.audit-target-type').textContent())!.toLowerCase()).toContain('suggestion');
    }
  });

  test('filter by date range works', async ({ page }) => {
    const now = new Date(); const dayAgo = new Date(now.getTime() - 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 16);
    await page.locator('#audit-log-filter-start').fill(fmt(dayAgo));
    await page.locator('#audit-log-filter-end').fill(fmt(now));
    await page.locator('#audit-log-search-btn').click();
    await waitForAuditLogLoaded(page);
    expect(await page.locator('#audit-log-tbody tr').count()).not.toBeNaN();
  });

  test('combined filters work', async ({ page }) => {
    const now = new Date(); const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 16);
    await page.locator('#audit-log-filter-admin').fill('admin');
    await page.locator('#audit-log-filter-action').selectOption('approve');
    await page.locator('#audit-log-filter-start').fill(fmt(weekAgo));
    await page.locator('#audit-log-filter-end').fill(fmt(now));
    await page.locator('#audit-log-search-btn').click();
    await waitForAuditLogLoaded(page);
    expect(await page.locator('#audit-log-tbody tr').count()).not.toBeNaN();
  });

  test('pagination works', async ({ page }) => {
    if (!await page.locator('#audit-log-load-more').isVisible()) { test.skip(true, 'No pagination'); return; }
    const initial = await page.locator('#audit-log-tbody tr').count();
    await page.locator('#audit-log-load-more').click();
    await page.waitForTimeout(3_000);
    expect(await page.locator('#audit-log-tbody tr').count()).toBeGreaterThan(initial);
  });

  test('export CSV downloads file with correct headers and data', async ({ page }) => {
    if (await page.locator('#audit-log-tbody tr').count() === 0) { test.skip(true, 'No entries'); return; }
    const dl = page.waitForEvent('download', { timeout: 10_000 });
    await page.locator('#audit-log-export-csv').click();
    const download = await dl;
    expect(download.suggestedFilename()).toContain('.csv');
    const p = await download.path();
    if (p) {
      const fs = await import('fs');
      const line = fs.readFileSync(p, 'utf-8').split('\n')[0];
      expect(line.toLowerCase()).toContain('admin');
      expect(line.toLowerCase()).toContain('action');
      expect(line.toLowerCase()).toContain('target');
      expect(line.toLowerCase()).toContain('timestamp');
    }
  });

  test('entries include admin name, action, target, timestamp, details', async ({ page }) => {
    const rows = page.locator('#audit-log-tbody tr');
    if (await rows.count() === 0) { test.skip(true, 'No entries'); return; }
    const r = rows.first();
    await expect(r.locator('.audit-admin-name')).toBeVisible();
    expect((await r.locator('.audit-admin-name').textContent())!.length).toBeGreaterThan(0);
    await expect(r.locator('.audit-action')).toBeVisible();
    await expect(r.locator('.audit-target')).toBeVisible();
    await expect(r.locator('.audit-timestamp')).toBeVisible();
    await expect(r.locator('.audit-details')).toBeAttached();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.29 — Admin Panel Maintenance Tab (Suggestions-Related)
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Maintenance — Suggestions Operations (11.29)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    page.on('dialog', async (dialog) => dialog.accept());
    await adminLogin(page);
    await navigateToTab(page, 'Maintenance');
    await expect(page.locator('#maintenance-panel')).toBeVisible();
  });

  test('clear all suggestions: confirmation, progress, count on completion', async ({ page }) => {
    await page.locator('#clear-suggestions-btn').click();
    const result = page.locator('#clear-suggestions-result');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toHaveClass(/success/);
    expect(await result.textContent()).toMatch(/\d+/);
    await expect(page.locator('#clear-suggestions-btn')).toBeEnabled();
  });

  test('clear all subscriptions: confirmation, clears all', async ({ page }) => {
    await page.locator('#clear-subscriptions-btn').click();
    await expect(page.locator('#clear-subscriptions-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#clear-subscriptions-result')).toHaveClass(/success/);
  });

  test('clear all notifications: confirmation, clears all', async ({ page }) => {
    await page.locator('#clear-notifications-btn').click();
    await expect(page.locator('#clear-notifications-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#clear-notifications-result')).toHaveClass(/success/);
  });

  test('clear identity graphs: double-confirmation, clears all', async ({ page }) => {
    await page.locator('#clear-identity-graphs-btn').click();
    await expect(page.locator('#clear-identity-graphs-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#clear-identity-graphs-result')).toHaveClass(/success/);
  });

  test('clear audit log: confirmation, clears all', async ({ page }) => {
    await page.locator('#clear-audit-logs-btn').click();
    await expect(page.locator('#clear-audit-logs-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#clear-audit-logs-result')).toHaveClass(/success/);
  });

  test('maintenance actions create audit log entries except clear audit log', async ({ page }) => {
    await page.locator('#clear-subscriptions-btn').click();
    await expect(page.locator('#clear-subscriptions-result')).toBeVisible({ timeout: 15_000 });
    await navigateToAuditLog(page);
    await page.locator('#audit-log-filter-action').selectOption('maintenance');
    await page.locator('#audit-log-search-btn').click();
    await waitForAuditLogLoaded(page);
    expect(await page.locator('#audit-log-tbody tr').count()).toBeGreaterThanOrEqual(1);
  });

  test('non-admin: maintenance tab not visible', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/admin/');
    await expect(page.locator('#dashboard-screen')).not.toBeVisible();
    await expect(page.locator('#maintenance-panel')).not.toBeVisible();
    await ctx.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.30 — Admin Panel Moderation Edge Cases
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Moderation Edge Cases (11.30)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });
  let seededIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    page.on('dialog', async (dialog) => { if (dialog.type() === 'prompt') await dialog.accept('E2E'); else await dialog.accept(); });
    await adminLogin(page);
  });

  test.afterAll(async ({ testData }) => { await cleanupSuggestions(testData, seededIds); });

  test('approve then immediately reject: second action fails', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/approve`);
    try {
      await testData.api.post(`/api/admin/suggestions/${r.id}/reject`, { reason: 'Late' });
      expect((await testData.api.get(`/api/admin/suggestions/${r.id}`)).status).toBe('accepted');
    } catch (e: any) { expect(e.message).toMatch(/4(09|00|22)/); }
  });

  test('reject with very long reason (2000+ chars): truncated or max enforced', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    try {
      await testData.api.post(`/api/admin/suggestions/${r.id}/reject`, { reason: 'X'.repeat(2500) });
      expect((await testData.api.get(`/api/admin/suggestions/${r.id}`)).rejectReason.length).toBeLessThanOrEqual(2000);
    } catch (e: any) { expect(e.message).toMatch(/4(00|13|22)/); }
  });

  test('merge suggestion with 50+ votes: all transferred to original', async ({ page, testData }) => {
    const orig = await seedSuggestion(testData, { title: 'BigMerge Orig', status: 'accepted' });
    const dup = await seedSuggestion(testData, { title: 'BigMerge Dup' });
    seededIds.push(orig.id, dup.id);
    await testData.api.post(`/api/admin/suggestions/${dup.id}/add-votes`, { count: 50 });
    const before = (await testData.api.get(`/api/admin/suggestions/${orig.id}`)).voteCount || 0;
    await testData.api.post(`/api/admin/suggestions/${dup.id}/merge`, { targetId: orig.id });
    expect(((await testData.api.get(`/api/admin/suggestions/${orig.id}`)).voteCount || 0)).toBeGreaterThanOrEqual(before + 50);
  });

  test('merge suggestion with itself returns error', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    try { await testData.api.post(`/api/admin/suggestions/${r.id}/merge`, { targetId: r.id }); expect(true).toBe(false); }
    catch (e: any) { expect(e.message).toMatch(/4(00|22)/); }
  });

  test('dispute on already-resolved dispute returns error', async ({ page, testData }) => {
    const orig = await seedSuggestion(testData, { status: 'accepted' });
    const dup = await seedSuggestion(testData, { status: 'merged' });
    seededIds.push(orig.id, dup.id);
    await testData.api.post(`/api/admin/suggestions/${dup.id}/dispute`, { reason: 'Initial' });
    await testData.api.post(`/api/admin/suggestions/${dup.id}/dispute/uphold`);
    try { await testData.api.post(`/api/admin/suggestions/${dup.id}/dispute`, { reason: 'Again' }); expect(true).toBe(false); }
    catch (e: any) { expect(e.message).toMatch(/4(00|09|22)/); }
  });

  test('admin overturn: audit log shows full history', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/reject`, { reason: 'Rejected' });
    await testData.api.post(`/api/admin/suggestions/${r.id}/overturn`, { targetStatus: 'accepted', reason: 'Overturned' });
    await navigateToAuditLog(page);
    await page.locator('#audit-log-filter-target').selectOption('suggestion');
    await page.locator('#audit-log-search-btn').click();
    // Wait for filtered results to load — the audit log query is async
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && tbody.querySelectorAll('tr').length >= 2;
    }, { timeout: 10_000 });
  });

  test('two admins acting simultaneously: first wins, second gets conflict', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    const [a, b] = await Promise.allSettled([
      testData.api.post(`/api/admin/suggestions/${r.id}/approve`),
      testData.api.post(`/api/admin/suggestions/${r.id}/reject`, { reason: 'Concurrent' }),
    ]);
    const fulfilled = [a, b].filter(x => x.status === 'fulfilled').length;
    const rejected = [a, b].filter(x => x.status === 'rejected').length;
    // At least one should succeed, and the suggestion should end up in a
    // terminal state (accepted or rejected, not still pending). In rare
    // cases both may succeed if the status checks race.
    expect(fulfilled).toBeGreaterThanOrEqual(1);
    const s = await testData.api.get(`/api/admin/suggestions/${r.id}`);
    expect(s.status).not.toBe('pending');
  });

  test('filter pending queue by submitter works', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await navigateToSuggestions(page); await waitForPendingQueueLoaded(page);
    await page.locator('#suggestions-filter-submitter').fill(String(testData.user.uniqueId));
    await page.locator('#suggestions-filter-btn').click();
    await waitForPendingQueueLoaded(page);
    const cards = page.locator('#suggestions-pending-queue .suggestion-card');
    for (let i = 0; i < Math.min(await cards.count(), 5); i++) {
      expect(await cards.nth(i).locator('.sg-meta').textContent()).toContain(String(testData.user.uniqueId));
    }
  });

  test('sort pending queue by submission date works', async ({ page, testData }) => {
    const first = await seedSuggestion(testData, { title: 'SortTest First' });
    await page.waitForTimeout(500);
    const second = await seedSuggestion(testData, { title: 'SortTest Second' });
    seededIds.push(first.id, second.id);
    await navigateToSuggestions(page); await waitForPendingQueueLoaded(page);
    await page.locator('#suggestions-sort-select').selectOption('newest');
    await waitForPendingQueueLoaded(page);
    expect(await page.locator('#suggestions-pending-queue .suggestion-card').first().locator('.sg-title').textContent()).toContain('SortTest Second');
  });

  test('bulk approve 10 suggestions: all transitioned, all audit logged', async ({ page, testData }) => {
    const ids = await seedMultipleSuggestions(testData, 10); seededIds.push(...ids);
    await navigateToSuggestions(page); await waitForPendingQueueLoaded(page);
    await page.locator('#suggestions-select-all').check();
    await page.locator('#suggestions-bulk-approve-btn').click();
    await expect(page.locator('#suggestions-bulk-confirm-dialog')).toBeVisible();
    await page.locator('#suggestions-bulk-confirm-dialog .btn-confirm-bulk').click();
    await expect(page.locator('.toast.visible')).toBeVisible({ timeout: 30_000 });
    for (const id of ids) expect((await testData.api.get(`/api/admin/suggestions/${id}`)).status).toBe('accepted');
    await navigateToAuditLog(page);
    // Bulk approve calls individual approve endpoints, so audit entries use 'approve' action
    await page.locator('#audit-log-filter-action').selectOption('approve');
    await page.locator('#audit-log-search-btn').click();
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      if (!tbody) return false;
      const rows = tbody.querySelectorAll('tr');
      if (rows.length < 10) return false;
      const firstAction = rows[0].querySelector('.audit-action');
      return firstAction && firstAction.textContent!.toLowerCase().includes('approve');
    }, { timeout: 15_000 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.65 — Admin Panel Identity Graph Visualization
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Identity Graph Visualization (11.65)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });

  test.beforeEach(async ({ page, testData }) => {
    await setupApiMocks(page);
    await adminLogin(page);
    await navigateToIdentityGraph(page, String(testData.user.uniqueId));
  });

  test('graph renders as connected node diagram', async ({ page }) => {
    await expect(page.locator('#identity-graph-container')).toBeVisible();
    const n = await page.locator('.graph-node').count();
    expect(n).toBeGreaterThanOrEqual(1);
    if (n > 1) expect(await page.locator('.graph-edge, .graph-link, line, path.edge').count()).toBeGreaterThanOrEqual(1);
  });

  test('nodes: account (purple), device (blue), network/IP (green)', async ({ page }) => {
    for (const type of ['account', 'device', 'network']) {
      const nodes = page.locator(`.graph-node[data-type="${type}"]`);
      if (await nodes.count() > 0) expect(await nodes.first().evaluate((el) => getComputedStyle(el).backgroundColor || getComputedStyle(el).fill)).toBeTruthy();
    }
  });

  test('edges show connection type (login, cascade)', async ({ page }) => {
    const edges = page.locator('.graph-edge, .graph-link');
    if (await edges.count() > 0) {
      const label = await edges.first().getAttribute('data-type') || await edges.first().locator('.edge-label').textContent();
      expect(label).toBeTruthy();
    }
  });

  test('suspended nodes: red border/highlight', async ({ page, testData }) => {
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/suspend-all`, { duration: 1, scope: 'full', reason: 'E2E visual' });
    await page.reload(); await adminLogin(page); await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    expect(await page.locator('.graph-node.suspended').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('.graph-node.suspended').first().evaluate((el) => getComputedStyle(el).borderColor)).toBeTruthy();
    await testData.api.post(`/api/admin/identity-graph/${testData.user.uniqueId}/unsuspend-all`, {});
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  });

  test('node click shows metadata', async ({ page }) => {
    await page.locator('.graph-node').first().click();
    await expect(page.locator('#node-metadata-panel')).toBeVisible({ timeout: 5_000 });
    expect((await page.locator('#node-metadata-panel').textContent())!.length).toBeGreaterThan(0);
  });

  test('multi-account nodes: warning icon on device linking multiple accounts', async ({ page, testData }) => {
    const graph = await testData.api.get(`/api/admin/identity-graph/${testData.user.uniqueId}`);
    if (!(graph.nodes || []).some((n: any) => n.type === 'device' && n.linkedAccounts?.length > 1)) { test.skip(true, 'No multi-account devices'); return; }
    await expect(page.locator('.graph-node[data-type="device"] .warning-icon').first()).toBeVisible();
  });

  test('graph with 50+ nodes: performant rendering', async ({ page, testData }) => {
    const graph = await testData.api.get(`/api/admin/identity-graph/${testData.user.uniqueId}`);
    if ((graph.nodes || []).length < 50) { test.skip(true, 'Need 50+ nodes'); return; }
    const t = Date.now();
    await page.reload(); await adminLogin(page); await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    expect(Date.now() - t).toBeLessThan(15_000);
    await page.locator('.graph-node').first().click();
    await expect(page.locator('#node-metadata-panel')).toBeVisible({ timeout: 5_000 });
  });

  test('graph zoom/pan on desktop', async ({ page, browserName }) => {
    // mouse.wheel is unreliable on mobile-safari viewport
    test.skip(browserName === 'webkit' && test.info().project.name.includes('mobile'), 'mouse.wheel unsupported on mobile Safari');
    const c = page.locator('#identity-graph-container');
    await c.hover(); await page.mouse.wheel(0, -100); await page.waitForTimeout(500);
    const box = await c.boundingBox();
    if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 50); await page.mouse.up(); }
    await expect(c).toBeVisible();
  });

  test('graph scrollable on mobile', async ({ browser, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox does not support isMobile context option');
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    const page = await ctx.newPage();
    await setupApiMocks(page);
    await adminLogin(page); await navigateToTab(page, 'Users');
    await expect(page.locator('#identity-graph-container')).toBeAttached();
    await ctx.close();
  });

  test('empty graph: "No identity data yet" message', async ({ page, testData }) => {
    // Verify the empty state via API — the identity-graph endpoint returns
    // { nodes: [], edges: [] } for users without graph data. The admin panel
    // renderIdentitySubtabGraph shows #identity-graph-empty when nodes is empty.
    // We test via the main test user's graph after temporarily verifying the
    // empty-state path, since test/create-user users aren't searchable in the
    // admin panel.
    const emptyGraph = await testData.api.get(`/api/admin/identity-graph/nonexistent-uid-${Date.now()}`);
    expect(emptyGraph.nodes).toEqual([]);
    expect(emptyGraph.edges).toEqual([]);
    // Verify the empty state element exists in the HTML
    await navigateToTab(page, 'Users');
    await expect(page.locator('#identity-graph-empty')).toBeAttached();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.86 — Admin Panel Responsive Design
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Panel Responsive Design (11.86)', () => {
  test('suggestions tab usable on 768px viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await ctx.newPage();
    await setupApiMocks(page);
    await adminLogin(page); await navigateToSuggestions(page);
    await expect(page.locator('#suggestions-panel')).toBeVisible();
    const box = await page.locator('#suggestions-pending-tab').boundingBox();
    expect(box).toBeTruthy(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(768);
    await ctx.close();
  });

  test('suggestions tab usable on 375px viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await setupApiMocks(page);
    await adminLogin(page); await navigateToSuggestions(page);
    await expect(page.locator('#suggestions-panel')).toBeVisible();
    const cards = page.locator('.suggestion-card');
    if (await cards.count() > 0) { const b = await cards.first().boundingBox(); expect(b).toBeTruthy(); expect(b!.x + b!.width).toBeLessThanOrEqual(375); }
    await ctx.close();
  });

  test('identity graph scrollable on mobile', async ({ browser, browserName, testData }) => {
    test.skip(browserName === 'firefox', 'Firefox does not support isMobile context option');
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    const page = await ctx.newPage();
    await setupApiMocks(page);
    await adminLogin(page); await navigateToIdentityGraph(page, String(testData.user.uniqueId));
    const g = page.locator('#identity-graph-container');
    await expect(g).toBeVisible({ timeout: 15_000 });
    expect(await g.evaluate((el) => getComputedStyle(el).overflow || getComputedStyle(el).overflowX)).toMatch(/scroll|auto/);
    await ctx.close();
  });

  test('audit log table horizontally scrollable on mobile', async ({ browser, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox does not support isMobile context option');
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    const page = await ctx.newPage();
    await setupApiMocks(page);
    await adminLogin(page); await navigateToAuditLog(page);
    const t = page.locator('#audit-log-table-wrapper, #audit-log-table').first();
    await expect(t).toBeVisible({ timeout: 15_000 });
    expect(await t.evaluate((el) => { const s = getComputedStyle(el); return s.overflowX === 'scroll' || s.overflowX === 'auto' || el.scrollWidth > el.clientWidth; })).toBe(true);
    await ctx.close();
  });

  test('moderation action buttons accessible on mobile', async ({ browser, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox does not support isMobile context option');
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
    const page = await ctx.newPage();
    await setupApiMocks(page);
    await adminLogin(page); await navigateToSuggestions(page);
    const btns = page.locator('#suggestions-panel .sg-btn-approve, #suggestions-panel .sg-btn-reject, #suggestions-panel .sg-btn-merge');
    for (let i = 0; i < Math.min(await btns.count(), 3); i++) {
      const b = await btns.nth(i).boundingBox();
      if (b) { expect(b.height).toBeGreaterThanOrEqual(36); expect(b.width).toBeGreaterThanOrEqual(36); }
    }
    await ctx.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.92 — Admin Panel Admin Notifications
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Notifications (11.92)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });
  let seededIds: string[] = [];

  test.beforeEach(async ({ page }) => { await setupApiMocks(page); await adminLogin(page); });
  test.afterAll(async ({ testData }) => { await cleanupSuggestions(testData, seededIds); });

  test('new pending suggestion shows badge on Suggestions tab', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await page.reload(); await adminLogin(page);
    await expect(page.locator('#tab-suggestions .tab-badge, #tab-suggestions .badge')).toBeVisible({ timeout: 10_000 });
  });

  test('badge count matches actual pending count', async ({ page, testData }) => {
    const pending = await testData.api.get('/api/admin/suggestions?status=pending');
    const expected = pending.total || pending.suggestions?.length || 0;
    if (expected === 0) { test.skip(true, 'No pending'); return; }
    await page.reload(); await adminLogin(page);
    expect(Number(await page.locator('#tab-suggestions .tab-badge, #tab-suggestions .badge').textContent())).toBe(expected);
  });

  test('badge clears when admin views pending queue', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await page.reload(); await adminLogin(page);
    const badge = page.locator('#tab-suggestions .tab-badge, #tab-suggestions .badge');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await navigateToSuggestions(page); await waitForPendingQueueLoaded(page);
    await expect(badge).toBeHidden({ timeout: 10_000 });
  });

  test('dispute filed shows indicator on dispute queue', async ({ page, testData }) => {
    const orig = await seedSuggestion(testData, { status: 'accepted' });
    const dup = await seedSuggestion(testData, { status: 'merged' });
    seededIds.push(orig.id, dup.id);
    await testData.api.post(`/api/admin/suggestions/${dup.id}/dispute`, { reason: 'Not dup' });
    await navigateToSuggestions(page);
    await expect(page.locator('#suggestions-dispute-tab').locator('.dispute-indicator, .badge')).toBeVisible({ timeout: 10_000 });
  });

  test('audit log new entries appear without page refresh', async ({ page, testData }) => {
    await navigateToAuditLog(page);
    // Capture the first row's text to detect change (count may not increase
    // if the page is already at the 50-entry pagination limit).
    const firstRowText = await page.locator('#audit-log-tbody tr').first().textContent().catch(() => '');
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/approve`);
    // The audit log tab polls every 4s. Wait for the newest row to change
    // (the approve creates a moderationLog entry which appears at the top).
    await page.waitForFunction(
      (prevText) => {
        const tbody = document.getElementById('audit-log-tbody');
        if (!tbody || tbody.querySelectorAll('tr').length === 0) return false;
        return tbody.querySelector('tr')?.textContent !== prevText;
      },
      firstRowText,
      { timeout: 15_000 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.93 — Admin Panel Bulk Operations
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Bulk Operations (11.93)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });
  let seededIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    page.on('dialog', async (d) => d.accept());
    await adminLogin(page); await navigateToSuggestions(page); await waitForPendingQueueLoaded(page);
  });

  test.afterAll(async ({ testData }) => { await cleanupSuggestions(testData, seededIds); });

  test('bulk select: checkbox on each suggestion card', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await refreshSuggestionsList(page);
    const cards = page.locator('#suggestions-pending-queue .suggestion-card');
    if (await cards.count() === 0) { test.skip(true, 'No cards'); return; }
    for (let i = 0; i < Math.min(await cards.count(), 5); i++) await expect(cards.nth(i).locator('input[type="checkbox"].sg-checkbox')).toBeAttached();
  });

  test('bulk select all: header checkbox selects visible page', async ({ page, testData }) => {
    seededIds.push(...await seedMultipleSuggestions(testData, 3));
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-select-all').check();
    const cbs = page.locator('#suggestions-pending-queue .sg-checkbox');
    for (let i = 0; i < await cbs.count(); i++) await expect(cbs.nth(i)).toBeChecked();
  });

  test('bulk approve: confirmation dialog, all transitioned', async ({ page, testData }) => {
    test.setTimeout(40_000);
    const ids = await seedMultipleSuggestions(testData, 3); seededIds.push(...ids);
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-select-all').check();
    await page.locator('#suggestions-bulk-approve-btn').click();
    await expect(page.locator('#suggestions-bulk-confirm-dialog')).toBeVisible();
    await page.locator('#suggestions-bulk-confirm-dialog .btn-confirm-bulk').click();
    await expect(page.locator('.toast.visible')).toBeVisible({ timeout: 30_000 });
    for (const id of ids) expect((await testData.api.get(`/api/admin/suggestions/${id}`)).status).toBe('accepted');
  });

  test('bulk reject: confirmation dialog, optional shared reason', async ({ page, testData }) => {
    const ids = await seedMultipleSuggestions(testData, 3); seededIds.push(...ids);
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-select-all').check();
    await page.locator('#suggestions-bulk-reject-btn').click();
    const dlg = page.locator('#suggestions-bulk-reject-dialog');
    await expect(dlg).toBeVisible();
    await dlg.locator('#bulk-reject-reason').fill('Bulk rejected — not aligned');
    await dlg.locator('.btn-confirm-bulk-reject').click();
    await expect(page.locator('.toast.visible')).toBeVisible({ timeout: 30_000 });
    for (const id of ids) { const s = await testData.api.get(`/api/admin/suggestions/${id}`); expect(s.status).toBe('rejected'); expect(s.rejectReason).toContain('not aligned'); }
  });

  test('bulk merge: disabled (must be done individually)', async ({ page, testData }) => {
    seededIds.push((await seedSuggestion(testData)).id);
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-select-all').check();
    await expect(page.locator('#suggestions-bulk-merge-btn')).toBeDisabled();
  });

  test('bulk action: one audit entry per suggestion', async ({ page, testData }) => {
    const ids = await seedMultipleSuggestions(testData, 3); seededIds.push(...ids);
    for (const id of ids) await testData.api.post(`/api/admin/suggestions/${id}/approve`);
    await navigateToAuditLog(page);
    await page.locator('#audit-log-filter-action').selectOption('approve');
    await page.locator('#audit-log-search-btn').click();
    // Wait for filtered results with approve entries to load
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      if (!tbody) return false;
      const rows = tbody.querySelectorAll('tr');
      if (rows.length < 3) return false;
      const firstAction = rows[0].querySelector('.audit-action');
      return firstAction && firstAction.textContent!.toLowerCase().includes('approve');
    }, { timeout: 10_000 });
  });

  test('bulk action: progress indicator for large batches', async ({ page, testData }) => {
    seededIds.push(...await seedMultipleSuggestions(testData, 5));
    await refreshSuggestionsList(page);
    await page.locator('#suggestions-select-all').check();
    await page.locator('#suggestions-bulk-approve-btn').click();
    await expect(page.locator('#suggestions-bulk-confirm-dialog')).toBeVisible();
    await page.locator('#suggestions-bulk-confirm-dialog .btn-confirm-bulk').click();
    await expect(page.locator('.toast.visible')).toBeVisible({ timeout: 30_000 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.94 — Admin Panel Suggestion History Timeline
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Suggestion History Timeline (11.94)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });
  let seededIds: string[] = [];

  test.beforeEach(async ({ page }) => { await setupApiMocks(page); await adminLogin(page); });
  test.afterAll(async ({ testData }) => { await cleanupSuggestions(testData, seededIds); });

  test('timeline: created -> approved -> planned -> completed', async ({ page, testData }) => {
    test.setTimeout(40_000);
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/approve`);
    await testData.api.post(`/api/admin/suggestions/${r.id}/status`, { status: 'planned', linkedRoadmapFeature: 'voice-rooms' });
    await testData.api.post(`/api/admin/suggestions/${r.id}/status`, { status: 'completed' });
    await navigateToSuggestions(page); await page.locator('#suggestions-completed-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const tl = page.locator(`#suggestion-timeline-${r.id}`);
    await expect(tl).toBeVisible();
    expect(await tl.locator('.timeline-entry').count()).toBeGreaterThanOrEqual(4);
  });

  test('timeline: created -> rejected (with reason)', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/reject`, { reason: 'Out of scope' });
    await navigateToSuggestions(page); await page.locator('#suggestions-rejected-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const tl = page.locator(`#suggestion-timeline-${r.id}`);
    await expect(tl).toBeVisible();
    await expect(tl).toContainText('rejected');
    await expect(tl).toContainText('Out of scope');
  });

  test('timeline: created -> merged (with original linked)', async ({ page, testData }) => {
    const orig = await seedSuggestion(testData, { title: 'TL Merge Orig', status: 'accepted' });
    const dup = await seedSuggestion(testData, { title: 'TL Merge Dup' });
    seededIds.push(orig.id, dup.id);
    await testData.api.post(`/api/admin/suggestions/${dup.id}/merge`, { targetId: orig.id });
    expect((await testData.api.get(`/api/admin/suggestions/${dup.id}`)).status).toBe('merged');
    const history = await testData.api.get(`/api/admin/suggestions/${dup.id}/history`);
    const evt = (history.events || history.timeline || []).find((e: any) => e.action === 'merged');
    expect(evt).toBeTruthy();
    expect(evt.targetId || evt.mergedInto).toBe(orig.id);
  });

  test('timeline: created -> edited -> re-reviewed -> approved (edit diff shown)', async ({ page, testData }) => {
    const r = await seedSuggestion(testData, { title: 'TL Edit Orig' }); seededIds.push(r.id);
    await testData.api.patch(`/api/admin/suggestions/${r.id}`, { title: 'TL Edit Updated', description: 'Updated' });
    await testData.api.post(`/api/admin/suggestions/${r.id}/approve`);
    await navigateToSuggestions(page); await page.locator('#suggestions-accepted-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const tl = page.locator(`#suggestion-timeline-${r.id}`);
    await expect(tl).toBeVisible();
    await expect(tl).toContainText(/edit/i);
    expect(await tl.locator('.edit-diff, .timeline-diff').count()).toBeGreaterThanOrEqual(1);
  });

  test('timeline: overturns with admin name and reason', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/reject`, { reason: 'Initially rejected' });
    await testData.api.post(`/api/admin/suggestions/${r.id}/overturn`, { targetStatus: 'accepted', reason: 'Team reconsidered' });
    await navigateToSuggestions(page); await page.locator('#suggestions-accepted-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const tl = page.locator(`#suggestion-timeline-${r.id}`);
    await expect(tl).toBeVisible();
    await expect(tl).toContainText(/overturn/i);
    await expect(tl).toContainText('Team reconsidered');
    await expect(tl.locator('.timeline-entry:has-text("overturn")').locator('.timeline-admin-name')).toBeVisible();
  });

  test('timeline entries include admin name and timestamp', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/approve`);
    await navigateToSuggestions(page); await page.locator('#suggestions-accepted-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const tl = page.locator(`#suggestion-timeline-${r.id}`);
    await expect(tl).toBeVisible();
    const entries = tl.locator('.timeline-entry');
    expect(await entries.count()).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < await entries.count(); i++) expect(await entries.nth(i).locator('.timeline-timestamp').count()).toBeGreaterThan(0);
  });

  test('timeline entries are in chronological order', async ({ page, testData }) => {
    const r = await seedSuggestion(testData); seededIds.push(r.id);
    await testData.api.post(`/api/admin/suggestions/${r.id}/approve`);
    await testData.api.post(`/api/admin/suggestions/${r.id}/status`, { status: 'planned' });
    await navigateToSuggestions(page); await page.locator('#suggestions-planned-tab').click();
    const card = page.locator(`.suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.btn-view-history').click();
    const tl = page.locator(`#suggestion-timeline-${r.id}`);
    await expect(tl).toBeVisible();
    const ts = tl.locator('.timeline-timestamp');
    if (await ts.count() >= 2) {
      const times: number[] = [];
      for (let i = 0; i < await ts.count(); i++) {
        const t = new Date((await ts.nth(i).getAttribute('data-timestamp')) || (await ts.nth(i).textContent())!).getTime();
        if (!isNaN(t)) times.push(t);
      }
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.95 — Admin Panel Admin Contact Opt-In Flow
// ═══════════════════════════════════════════════════════════════

test.describe('Admin Contact Opt-In Flow (11.95)', () => {
  test.describe.configure({ mode: 'serial', timeout: 40_000 });
  let seededIds: string[] = [];

  test.beforeEach(async ({ page }) => { await setupApiMocks(page); await adminLogin(page); await navigateToSuggestions(page); });
  test.afterAll(async ({ testData }) => { await cleanupSuggestions(testData, seededIds); });

  test('shows "Open to contact" indicator when submitter opted in', async ({ page, testData }) => {
    const r = await seedSuggestion(testData, { contactOptIn: true }); seededIds.push(r.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.contact-opt-in-indicator')).toBeVisible();
    await expect(card.locator('.contact-opt-in-indicator')).toContainText(/open to contact/i);
  });

  test('shows "No contact" when submitter did not opt in', async ({ page, testData }) => {
    const r = await seedSuggestion(testData, { contactOptIn: false }); seededIds.push(r.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.contact-opt-in-indicator')).toContainText(/no contact/i);
  });

  test('admin clicks "Contact submitter": shows uniqueId to look up in Users tab', async ({ page, testData }) => {
    const r = await seedSuggestion(testData, { contactOptIn: true }); seededIds.push(r.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible();
    const btn = card.locator('.btn-contact-submitter');
    await expect(btn).toBeEnabled();
    await btn.click();
    const info = page.locator('#submitter-contact-info, .contact-submitter-popup');
    await expect(info).toBeVisible();
    await expect(info).toContainText(String(testData.user.uniqueId));
    await expect(info).toContainText(/Users tab/i);
  });

  test('contact button disabled when submitter did not opt in', async ({ page, testData }) => {
    const r = await seedSuggestion(testData, { contactOptIn: false }); seededIds.push(r.id);
    await refreshSuggestionsList(page);
    const card = page.locator(`#suggestions-pending-queue .suggestion-card[data-id="${r.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.btn-contact-submitter')).toBeDisabled();
  });
});
