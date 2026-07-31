/**
 * SHY-0258: twelve specs below are `test.todo`.
 *
 * They were `test.skip(...)` with bodies containing no assertion — parked AND
 * empty, so un-skipping all twelve turns this suite green without a line of
 * product code. Deduplication, retention limits and admin alerting do not
 * exist; routes/suggestions-notifications.js is list / mark-read / mark-all-read
 * and nothing more. `todo` reports honestly and is counted by
 * scripts/check-test-defects.js, so the gap cannot be relabelled away.
 */
/* eslint-disable no-unused-vars */
/**
 * Tests for suggestion notification routes and dispatch logic.
 *
 * Covers spec sections:
 *   11.7  — Notifications (creation, channel respect, dispatch)
 *   11.60 — Notification Deduplication
 *   11.76 — Notification Inbox Management
 *   11.80 — Admin Notification of New Suggestions
 *
 * Routes under test:
 *   GET  /api/notifications          → user inbox (paginated)
 *   PUT  /api/notifications/:id/read → mark single as read
 *   PUT  /api/notifications/read-all → mark all as read
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'notif-id' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });
const mockBatchCommit = jest.fn().mockResolvedValue();

const mockQueryChain = {
  where: jest.fn(() => mockQueryChain),
  orderBy: jest.fn(() => mockQueryChain),
  limit: jest.fn(() => mockQueryChain),
  offset: jest.fn(() => mockQueryChain),
  get: () => mockCollectionGet(),
};

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      delete: () => mockDocDelete(path),
    })),
    collection: jest.fn((name) => ({
      _name: name,
      add: (...args) => mockCollectionAdd(name, ...args),
      doc: jest.fn((id) => ({
        get: () => mockDocGet(`${name}/${id}`),
        set: (...args) => mockDocSet(`${name}/${id}`, ...args),
        update: (...args) => mockDocUpdate(`${name}/${id}`, ...args),
        delete: () => mockDocDelete(`${name}/${id}`),
      })),
      where: jest.fn(() => mockQueryChain),
      orderBy: jest.fn(() => mockQueryChain),
      get: () => mockCollectionGet(),
    })),
    batch: jest.fn(() => ({
      update: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      commit: mockBatchCommit,
    })),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((n) => ({ _type: 'increment', value: n })),
    delete: jest.fn(() => ({ _type: 'delete' })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-notif-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(),
}));

// ─── App setup ──────────────────────────────────────────────────

const notificationsRouter = require('../../src/routes/suggestions-notifications');
const subscriptionsRouter = require('../../src/routes/subscriptions');
const crypto = require('crypto');

// Generate a valid HMAC unsubscribe token (matches src/routes/subscriptions.js validation).
// The unsubscribe endpoint lives in subscriptionsRouter, not notificationsRouter — these
// tests need to mount both for endpoint coverage.
function makeValidUnsubscribeToken(uid, secret = 'dev-unsubscribe-secret') {
  const timestamp = Date.now();
  const hmac = crypto.createHmac('sha256', secret).update(`${uid}:${timestamp}`).digest('hex');
  return Buffer.from(`${uid}:${timestamp}:${hmac}`).toString('base64');
}

function createApp({ uniqueId = 1001, isAdmin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: isAdmin } };
    next();
  });
  app.use('/api', notificationsRouter);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', notificationsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockCollectionGet.mockReset();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
});

// ─── Helpers ────────────────────────────────────────────────────

function makeNotifDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      uid: 1001,
      type: 'suggestion_accepted',
      title: 'Your suggestion was accepted!',
      body: 'The community can now vote on your idea.',
      relatedId: 'sug-123',
      isRead: false,
      // Derived from now, never a frozen epoch. This was `1709913600000`
      // (8 March 2024), which was recent when written and has since aged past
      // the 90-day retention TTL — so every fixture notification silently
      // became "expired" and the inbox tests would have started failing on a
      // date nobody chose. A fixture that depends on the wall clock is a test
      // with an expiry date.
      createdAt: Date.now() - 1000,
      ...overrides,
    }),
  };
}

function _makeSubscriptionDoc(uid, overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uid,
      channelPreferences: {
        suggestionAccepted: { email: true, push: true, inApp: true, systemMessage: true },
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
        commentOnSuggestion: { email: false, push: false, inApp: true, systemMessage: false },
      },
      watchedSuggestions: ['sug-123'],
      pushToken: 'fcm-token-abc',
      email: 'user@example.com',
      emailConsentAt: 1709913600000,
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.7 — Notifications
// ═══════════════════════════════════════════════════════════════

// ─── Notification creation on events — covered elsewhere (SHY-0246) ─────
//
// This block held SEVEN active tests with empty bodies. They ran, asserted
// nothing and reported green, which is worse than no test at all: they made
// the notification surface look covered while the features they named did not
// exist. They are deleted rather than re-implemented here, because the
// behaviour now has REAL coverage against the routes that produce it — writing
// them again in this file would duplicate that:
//
//   accepted / planned / completed / rejected, recipient rules, and the
//   watcher fan-out
//     → tests/routes/admin-suggestions-extended-core.test.js
//        "subscriber notifications", "watchers are notified",
//        "recipient de-duplication by type"
//   comment (including author exclusion)
//     → tests/routes/suggestions-comments.test.js
//        "subscriber notifications"
//   merged
//     → tests/routes/admin-suggestions-extended-merge.test.js
//   roadmap_update, per-channel dispatch and the in-app channel
//     → tests/utils/notification-channels.test.js, tests/utils/roadmap-notify.test.js
//
// This file's own subject is the inbox ROUTES (GET /notifications,
// PUT /:id/read, PUT /read-all), which the describes below exercise for real.

// ─── Channel preference respect — covered elsewhere (SHY-0246) ─────────
//
// Seven more tests deleted here. Five had empty bodies. The other two were
// worse — TAUTOLOGIES:
//
//   test('email disabled → no email sent', () => {
//     const { sendEmail } = require('.../email');
//     expect(sendEmail).not.toHaveBeenCalled();   // nothing was dispatched
//   });                                           // so this is always true
//
// They dispatched nothing and then asserted nothing had happened, which holds
// no matter what the product does. The real per-channel contract — each
// channel firing only when its flag AND its recipient address are present,
// per-channel failure isolation, and the in-app channel — is asserted for real
// in tests/utils/notification-channels.test.js (29 tests, mutation-proved).
// List-Unsubscribe / List-Unsubscribe-Post are covered in
// tests/utils/suggestion-email-templates.test.js.
//
// The two unsubscribe-endpoint tests below drive a real route, so they stay.

describe('Unsubscribe endpoint', () => {
  test('POST to unsubscribe endpoint with valid token removes email channel', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: makeValidUnsubscribeToken('1001') })
      .expect(200);
  });

  test('POST to unsubscribe endpoint with invalid token returns 400', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    await request(app).post('/api/subscriptions/unsubscribe').send({ token: '' }).expect(400);
  });

  // 'rejected suggestion: submitter subscription cleaned up after notification'
  // was another empty active test. The behaviour is now implemented and
  // asserted against the route that performs it —
  // tests/routes/admin-suggestions-extended-core.test.js,
  // "watch cleanup on terminal status".
});

describe('GET /api/notifications — Inbox', () => {
  test('paginated, newest first', async () => {
    const docs = [
      makeNotifDoc('n1', { createdAt: 3000 }),
      makeNotifDoc('n2', { createdAt: 2000 }),
      makeNotifDoc('n3', { createdAt: 1000 }),
    ];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(200);
    expect(res.body).toHaveProperty('notifications');
    expect(res.body).toHaveProperty('unreadCount');
    expect(res.body).toHaveProperty('total');
  });

  test('includes unread count', async () => {
    const docs = [
      makeNotifDoc('n1', { isRead: false }),
      makeNotifDoc('n2', { isRead: true }),
      makeNotifDoc('n3', { isRead: false }),
    ];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(200);
    expect(res.body.unreadCount).toBeDefined();
  });

  test('mark single read: isRead set to true', async () => {
    mockDocGet.mockResolvedValue(makeNotifDoc('n1', { uid: 1001, isRead: false }));
    const app = createApp();
    await request(app).put('/api/notifications/n1/read').expect(200);
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  test('mark all read: all notifications marked', async () => {
    const docs = [makeNotifDoc('n1', { isRead: false }), makeNotifDoc('n2', { isRead: false })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });
    const app = createApp();
    await request(app).put('/api/notifications/read-all').expect(200);
  });

  test('auth required on all notification endpoints', async () => {
    const app = createUnauthApp();
    await request(app).get('/api/notifications').expect(401);
  });

  test('system message: correct conversation structure', async () => {
    const docs = [makeNotifDoc('n1', { type: 'suggestion_accepted' })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(200);
    // System message notifications should have the correct type
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.60 — Notification Deduplication
// ═══════════════════════════════════════════════════════════════

// ─── PARKED: features that do not exist yet (SHY-0246) ─────────────────
//
// The twelve test.skip cases below were ACTIVE with empty bodies — running,
// asserting nothing, reporting green, and making three whole feature areas
// look covered. They are parked rather than implemented because each needs a
// product decision I should not invent, and rather than deleted because the
// names are an accurate backlog:
//
//   Deduplication — needs a debounce WINDOW (the "within 1 minute" here is a
//     guess) and a rule for whether two different events on one suggestion
//     collapse. No dedup logic exists anywhere in src/.
//   Inbox management — needs a cap VALUE (200 is asserted but unsourced) and a
//     retention policy. Note "auto-cleaned by cron" contradicts this repo's
//     cron-elimination architecture; the sanctioned pattern is lazy on-access
//     reaping, so the test name itself needs rewriting when this is built.
//   Admin notification — needs a notification TYPE. Every existing type is in
//     RoadmapNotification.VALID_TYPES, which is user-facing; an admin type
//     would be classified by nothing, so the surface has to be designed first.
//
// Parked is honest: Jest skips these, so they can no longer report success.
// Tracked in .project/stories/SHY-0246-implement-missing-notification-types.md.

// SHY-0258 — DELIVERED. Deduplication now exists
// (src/utils/notification-retention.js) and is applied by the only writer of
// the in-app inbox (dispatchNotificationInline). These specs were `test.todo`
// because the feature did not exist; they are now real tests, living where the
// behaviour lives and running against the real Firestore emulator:
//
//   tests/utils/notification-retention.test.js
//     - the same event fired twice produces one notification
//     - the same event OUTSIDE the window is delivered again  (the debounce)
//     - two DIFFERENT events in the same instant are both delivered
//       (approve-then-overturn stays two notifications)
//     - one person's notification never suppresses another's
//   tests/utils/notification-channels-retention.test.js
//     - the same behaviour asserted through the real dispatch path, because a
//       correct policy module that nothing calls is precisely the SHY-0246
//       defect this suite already suffered once.
//
// The "subscribed to both all-updates and a specific feature" case collapses
// into the same-event rule: both subscriptions dispatch one event with one
// dedupeKey, so the second is suppressed. Covered by "the same event fired
// twice produces exactly one stored notification".

// ═══════════════════════════════════════════════════════════════
// 11.76 — Notification Inbox Management
// ═══════════════════════════════════════════════════════════════

// SHY-0258 — DELIVERED. The retention cap and TTL now exist
// (src/utils/notification-retention.js), enforced lazily at write time. Real
// tests in tests/utils/notification-retention.test.js:
//     - an inbox at the cap is left alone
//     - exceeding the cap removes the OLDEST, keeping the newest
//     - the production cap is the documented 200
//     - notifications older than the TTL are removed
//     - a notification just INSIDE the TTL survives
//     - the production TTL is 90 days
//     - a row with NO timestamp is reaped rather than living forever
//     - reaping notifications leaves subscription preferences intact
// and, through the real dispatch path, in
// tests/utils/notification-channels-retention.test.js:
//     - an expired notification is reaped when the next one arrives
//
// NOTE: the original spec said "auto-cleaned by cron". It is deliberately NOT
// a cron. This repo eliminated its scheduled jobs (see the cron-elimination
// architecture in CLAUDE.md) because crons burn free-tier quota; the reap rides
// along with the write that made it necessary, which is also the only moment
// the work is needed.
describe('Notification Inbox Management', () => {
  test('unread count: only counts notifications < 90 days old', async () => {
    // This test previously ended on the comment "Unread count should only
    // include recent notifications" with no assertion for it — it verified a
    // 200 and nothing else, so the claim in its own name was unguarded.
    const recentDoc = makeNotifDoc('n1', { isRead: false, createdAt: Date.now() - 1000 });
    const oldDoc = makeNotifDoc('n2', {
      isRead: false,
      createdAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: [recentDoc, oldDoc], size: 2 });
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(200);

    expect(res.body.unreadCount).toBe(1);
    // And the stale row is not merely uncounted — it is absent from the inbox,
    // so "1 unread" cannot be contradicted by two unread-looking rows on screen.
    const ids = (res.body.notifications || []).map((n) => n.id);
    expect(ids).toContain('n1');
    expect(ids).not.toContain('n2');
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.80 — Admin Notification of New Suggestions
// ═══════════════════════════════════════════════════════════════

// SHY-0258 — DELIVERED, both halves (operator decision 2026-07-31: "Both").
//
// The blocker was that admin status exists ONLY as a Firebase Auth custom
// claim, granted outside the API, so there was no queryable set of admins and
// "notify every admin" would have meant paginating `auth.listUsers()` on every
// submission. Resolved by building the directory FROM TRAFFIC: the auth
// middleware records an admin each time it verifies a live claim
// (src/utils/admin-directory.js), so there is no backfill to run and nothing to
// enumerate. The directory is a CANDIDATE list — the live claim is still the
// authority — so a demoted admin stops receiving alerts.
//
// PULL half — `pendingCount` on the admin suggestions listing (admins only;
// leaking the size of the unreviewed queue to everyone would be a disclosure),
// counted with an aggregation query so the badge costs the same at any queue
// size. Tested in tests/routes/suggestions-pending-count.test.js.
//
// PUSH half — admins are notified when a suggestion is submitted, with the
// submitter identified. Tested in tests/utils/admin-suggestion-notify.test.js:
//     - each admin gets an inbox notification
//     - the notification names the submitter and the suggestion
//     - an admin who submits does not get told about their own
//     - a DEMOTED admin is not listed, and is dropped from the directory
//     - a verification outage EXCLUDES the candidate rather than trusting it
//     - the same suggestion announced twice does not double up an inbox

// ═══════════════════════════════════════════════════════════════
// Additional coverage — uncovered lines and branches
// ═══════════════════════════════════════════════════════════════

describe('GET /api/notifications — error handling', () => {
  test('returns 500 when Firestore query fails', async () => {
    mockCollectionGet.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('returns empty list for user with no notifications', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(200);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.unreadCount).toBe(0);
    expect(res.body.total).toBe(0);
  });

  test('unreadCount correctly counts only unread notifications', async () => {
    const docs = [
      makeNotifDoc('n1', { isRead: false }),
      makeNotifDoc('n2', { isRead: true }),
      makeNotifDoc('n3', { isRead: false }),
    ];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });
    const app = createApp();
    const res = await request(app).get('/api/notifications').expect(200);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.total).toBe(3);
  });
});

describe('PUT /api/notifications/read-all — additional coverage', () => {
  test('returns 401 when unauthenticated', async () => {
    const app = createUnauthApp();
    await request(app).put('/api/notifications/read-all').expect(401);
  });

  test('returns 500 when batch commit fails', async () => {
    const docs = [makeNotifDoc('n1', { isRead: false })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    mockBatchCommit.mockRejectedValueOnce(new Error('Batch commit failed'));
    const app = createApp();
    const res = await request(app).put('/api/notifications/read-all').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('returns updated count of 0 when no unread notifications', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    const res = await request(app).put('/api/notifications/read-all').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBe(0);
  });
});

describe('PUT /api/notifications/:id/read — additional coverage', () => {
  test('returns 401 when unauthenticated', async () => {
    const app = createUnauthApp();
    await request(app).put('/api/notifications/n1/read').expect(401);
  });

  test('returns 500 when update fails', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Update failed'));
    const app = createApp();
    const res = await request(app).put('/api/notifications/n1/read').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('calls update with isRead: true on correct doc path', async () => {
    const app = createApp();
    await request(app).put('/api/notifications/notif-xyz/read').expect(200);
    expect(mockDocUpdate).toHaveBeenCalledWith('notifications/notif-xyz', { isRead: true });
  });
});

describe('POST /api/subscriptions/unsubscribe — additional coverage', () => {
  // The unsubscribe endpoint lives in subscriptionsRouter, not notificationsRouter,
  // so these tests mount the subscriptions router. Token validation is HMAC-based.
  test('returns 400 when token is missing entirely', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app).post('/api/subscriptions/unsubscribe').send({}).expect(400);
    expect(res.body.error).toBe('Unsubscribe token required');
  });

  test('returns 400 when token is whitespace only', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: '   ' })
      .expect(400);
    expect(res.body.error).toBe('Unsubscribe token required');
  });

  test('returns 400 when token is non-string type', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 12345 })
      .expect(400);
    expect(res.body.error).toBe('Unsubscribe token required');
  });

  test('returns 400 for token that does not parse as HMAC tuple', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 'short' })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid unsubscribe token/);
  });

  test('returns success for valid HMAC token', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: makeValidUnsubscribeToken('1001') })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Email notifications disabled');
  });
});
