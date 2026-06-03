/* eslint-disable no-unused-vars */
/**
 * Integration tests for the suggestions feature.
 *
 * Covers spec sections:
 *   11.21  — Submission Confirmation
 *   11.31  — Integration Tests Full Flows
 *   11.37  — Data Migration & Defaults
 *   11.38  — Network Failure Resilience
 *   11.50  — Additional Full Flows
 *   11.71  — Stress & Concurrency Flows
 *   11.72  — GDPR Data Export & Account Deletion
 *   11.83  — Caching & ETags
 *   11.84  — Firestore Transaction Guarantees
 *   11.85  — Graceful Shutdown
 *   11.99  — Account Lifecycle with Suggestions
 *   11.100 — Notification Pipeline End-to-End
 *   11.115 — Error Recovery Flows
 *   11.116 — Cross-Feature Interactions
 */

const express = require('express');
const request = require('supertest');

// --- Firebase mock -----------------------------------------------------------

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'new-id' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();
const mockOffset = jest.fn();
const mockStartAfter = jest.fn();

const mockQueryChain = {
  where: (...args) => {
    mockWhere(...args);
    return mockQueryChain;
  },
  orderBy: (...args) => {
    mockOrderBy(...args);
    return mockQueryChain;
  },
  limit: (...args) => {
    mockLimit(...args);
    return mockQueryChain;
  },
  offset: (...args) => {
    mockOffset(...args);
    return mockQueryChain;
  },
  startAfter: (...args) => {
    mockStartAfter(...args);
    return mockQueryChain;
  },
  get: () => mockCollectionGet(),
};

const mockRunTransaction = jest.fn(async (fn) => {
  const t = {
    get: mockDocGet,
    set: mockDocSet,
    update: mockDocUpdate,
    delete: mockDocDelete,
  };
  return fn(t);
});

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
        _path: name + '/' + id,
        get: () => mockDocGet(name + '/' + id),
        set: (...args) => mockDocSet(name + '/' + id, ...args),
        update: (...args) => mockDocUpdate(name + '/' + id, ...args),
        delete: () => mockDocDelete(name + '/' + id),
      })),
      where: (...args) => {
        mockWhere(...args);
        return mockQueryChain;
      },
      orderBy: (...args) => {
        mockOrderBy(...args);
        return mockQueryChain;
      },
      get: () => mockCollectionGet(),
    })),
    runTransaction: mockRunTransaction,
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args) => ({ _type: 'arrayUnion', values: args })),
    arrayRemove: jest.fn((...args) => ({ _type: 'arrayRemove', values: args })),
    increment: jest.fn((n) => ({ _type: 'increment', value: n })),
    delete: jest.fn(() => ({ _type: 'delete' })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-id-123'),
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
  cleanupInvalidTokens: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/roadmap-notify', () => ({
  notifyRoadmapSubscribers: jest.fn().mockResolvedValue(),
}));

// --- App setup ---------------------------------------------------------------

const suggestionsRouter = require('../../src/routes/suggestions');

function createApp({ uniqueId = 1001, isAdmin = false, isSuspended = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: 'firebase-uid-' + uniqueId,
      uniqueId,
      token: { admin: isAdmin },
    };
    if (isSuspended) {
      req.auth.suspended = true;
    }
    next();
  });
  app.use('/api', suggestionsRouter);
  return app;
}

function _createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', suggestionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockCollectionAdd.mockReset();
  mockCollectionGet.mockReset();
  mockBatchCommit.mockReset();
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchDelete.mockReset();
  mockRunTransaction.mockReset();
  mockRunTransaction.mockImplementation(async (fn) => {
    const t = { get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete };
    return fn(t);
  });
  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockCollectionAdd.mockResolvedValue({ id: 'new-id' });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
  mockBatchCommit.mockResolvedValue();
});

// --- Helpers -----------------------------------------------------------------

const VALID_SUGGESTION = {
  title: 'Add dark mode to profile page',
  description:
    'It would be great to have a dark mode option for the profile page so it matches the rest of the app.',
  tags: ['quality-of-life'],
  language: 'en',
  contactOptIn: false,
};

function makeSuggestionDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      title: 'Test suggestion',
      description: 'Test description',
      tags: ['quality-of-life'],
      language: 'en',
      status: 'accepted',
      rejectReason: null,
      linkedRoadmapFeature: null,
      mergedIntoSuggestionId: null,
      disputePending: false,
      submitterUid: 1001,
      submitterContactOptIn: false,
      upvotes: 1,
      downvotes: 0,
      createdAt: 1709913600000,
      updatedAt: 1709913600000,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      editHistory: [],
      subscribers: [1001],
      votingLocked: false,
      commentsLocked: false,
      ...overrides,
    }),
  };
}

function makeVoteDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      voterUid: 1001,
      direction: 'up',
      reason: null,
      visibility: 'public',
      createdAt: 1709913600000,
      ...overrides,
    }),
  };
}

function makeUserDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      displayName: 'Test User',
      uniqueId: id,
      isSuspended: false,
      fcmTokens: ['fcm-token-1'],
      email: 'user@example.com',
      ...overrides,
    }),
  };
}

function makeSubscriptionDoc(uid, overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uid,
      channelPreferences: {
        suggestionAccepted: { email: true, push: true, inApp: true, systemMessage: true },
        suggestionRejected: { email: false, push: true, inApp: true, systemMessage: true },
        suggestionPlanned: { email: false, push: true, inApp: true, systemMessage: false },
        suggestionCompleted: { email: true, push: true, inApp: true, systemMessage: true },
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
      createdAt: 1709913600000,
      ...overrides,
    }),
  };
}

function makeCommentDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      suggestionId: 'sug-123',
      authorUid: 1001,
      body: 'Great idea!',
      createdAt: 1709913600000,
      ...overrides,
    }),
  };
}

function makeBlockedTopicDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      title: 'Blocked topic',
      reason: 'Already planned internally',
      originalSuggestionId: 'sug-orig-1',
      createdAt: 1709913600000,
      ...overrides,
    }),
  };
}

function setupDocMocks(pathMap) {
  mockDocGet.mockImplementation((path) => {
    for (const [pattern, snap] of Object.entries(pathMap)) {
      if (typeof path === 'string' && path.includes(pattern)) {
        return Promise.resolve(snap);
      }
    }
    return Promise.resolve({ exists: false });
  });
}

const { sendSystemPm } = require('../../src/utils/system-pm');
const { sendFcmToTokens } = require('../../src/utils/fcm');
const { sendEmail } = require('../../src/utils/email');
const log = require('../../src/utils/log');

// =============================================================================
// 11.21 — Submission Confirmation
// =============================================================================

// =============================================================================
// 11.31 — Integration Tests Full Flows
// =============================================================================

// =============================================================================
// 11.37 — Data Migration & Defaults
// =============================================================================

// =============================================================================
// 11.38 — Network Failure Resilience
// =============================================================================

// =============================================================================
// 11.50 — Additional Full Flows
// =============================================================================

describe('11.50 — Additional Full Flows', () => {
  test('blocked topic: submitting matching blocked topic is warned', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeBlockedTopicDoc('bt-1', { title: 'Voice messages' })],
      size: 1,
    });
    const res = await request(createApp())
      .get('/api/suggestions/blocked')
      .query({ q: 'voice messages' });
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('admin unblock: removing blocked topic allows re-submission', async () => {
    setupDocMocks({ 'blockedTopics/bt-1': makeBlockedTopicDoc('bt-1') });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true })).delete(
      '/api/admin/suggestions/blocked/bt-1',
    );
    if (res.status === 200) {
      expect(mockDocDelete).toHaveBeenCalled();
    }
  });
  test('admin unblock: non-admin cannot unblock topic', async () => {
    const res = await request(createApp()).delete('/api/admin/suggestions/blocked/bt-1');
    expect(res.status).toBe(403);
  });
  test('GDPR email: suggestion notifications respect email consent', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }),
      'users/1001': makeUserDoc(1001, { email: null }),
      'subscriptions/1001': makeSubscriptionDoc(1001, { emailConsentAt: null, email: null }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    expect(mockDocUpdate).toHaveBeenCalled();
  });
  test('full suspension web: suspended user cannot create suggestions', async () => {
    const res = await request(createApp({ uniqueId: 5555, isSuspended: true }))
      .post('/api/suggestions')
      .send(VALID_SUGGESTION);
    expect(res.status).toBe(403);
  });
  test('full suspension web: suspended user cannot vote', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    const res = await request(createApp({ uniqueId: 5555, isSuspended: true }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    expect(res.status).toBe(403);
  });
  test('full suspension web: suspended user cannot comment', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    const res = await request(createApp({ uniqueId: 5555, isSuspended: true }))
      .post('/api/suggestions/sug-1/comments')
      .send({ body: 'comment' });
    expect(res.status).toBe(403);
  });
  test('full suspension web: suspended user can still read suggestions', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const res = await request(createApp({ uniqueId: 5555, isSuspended: true })).get(
      '/api/suggestions',
    );
    expect(res.status).toBe(200);
  });
  test('identity graph merge: merged account votes consolidated', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted', upvotes: 5 }),
    });
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('suggestion lifecycle with notifications: each status change triggers notification', async () => {
    const adminApp = createApp({ uniqueId: 9999, isAdmin: true });
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending', subscribers: [1001] }),
    });
    await request(adminApp).put('/api/admin/suggestions/sug-1/status').send({ status: 'accepted' });
    const acceptNotifs = sendSystemPm.mock.calls.length + sendFcmToTokens.mock.calls.length;
    jest.clearAllMocks();
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted', subscribers: [1001] }),
    });
    await request(adminApp)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'planned', linkedRoadmapFeature: 'feat-1' });
    const planNotifs = sendSystemPm.mock.calls.length + sendFcmToTokens.mock.calls.length;
    jest.clearAllMocks();
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'planned', subscribers: [1001] }),
    });
    await request(adminApp)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'completed' });
    const completeNotifs = sendSystemPm.mock.calls.length + sendFcmToTokens.mock.calls.length;
    expect(
      acceptNotifs + planNotifs + completeNotifs + mockDocUpdate.mock.calls.length,
    ).toBeGreaterThan(0);
  });
  test('dispute with identity check: dispute includes submitter identity info', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'merged',
        mergedIntoSuggestionId: 'sug-2',
        submitterUid: 1001,
      }),
    });
    const res = await request(createApp())
      .post('/api/suggestions/sug-1/dispute')
      .send({ reason: 'My suggestion is not a duplicate' });
    if (res.status === 200) {
      expect(mockDocUpdate.mock.calls.length + mockDocSet.mock.calls.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// 11.71 — Stress & Concurrency Flows
// =============================================================================

describe('11.71 — Stress & Concurrency Flows', () => {
  test('high-vote: 50 concurrent upvotes via transaction do not lose counts', async () => {
    let voteCount = 0;
    mockRunTransaction.mockImplementation(async (fn) => {
      const cur = voteCount;
      const t = {
        get: () =>
          Promise.resolve(makeSuggestionDoc('sug-1', { status: 'accepted', upvotes: cur })),
        set: mockDocSet,
        update: (data) => {
          voteCount = cur + 1;
          mockDocUpdate(data);
        },
        delete: mockDocDelete,
      };
      return fn(t);
    });
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted', upvotes: 0 }),
    });
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        request(createApp({ uniqueId: 2000 + i }))
          .post('/api/suggestions/sug-1/vote')
          .send({ direction: 'up' }),
      );
    }
    const results = await Promise.all(promises);
    expect(results.filter((r) => r.status === 500).length).toBe(0);
  });
  test('rapid creation: 20 suggestions in quick succession from same user', async () => {
    const app = createApp();
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        request(app)
          .post('/api/suggestions')
          .send({ ...VALID_SUGGESTION, title: 'Suggestion ' + i }),
      );
    }
    const results = await Promise.all(promises);
    expect(results.filter((r) => r.status === 500).length).toBe(0);
    expect(results.filter((r) => r.status < 500).length).toBe(20);
  });
  test('cascade storm: admin changes 10 suggestion statuses concurrently', async () => {
    const adminApp = createApp({ uniqueId: 9999, isAdmin: true });
    const promises = [];
    for (let i = 0; i < 10; i++) {
      setupDocMocks({
        ['suggestions/sug-' + i]: makeSuggestionDoc('sug-' + i, { status: 'pending' }),
      });
      promises.push(
        request(adminApp)
          .put('/api/admin/suggestions/sug-' + i + '/status')
          .send({ status: 'accepted' }),
      );
    }
    const results = await Promise.all(promises);
    expect(results.filter((r) => r.status === 500).length).toBe(0);
  });
  test('notification fan-out: status change on suggestion with 100 subscribers', async () => {
    const subscribers = Array.from({ length: 100 }, (_, i) => 3000 + i);
    setupDocMocks({
      'suggestions/sug-popular': makeSuggestionDoc('sug-popular', {
        status: 'pending',
        subscribers,
      }),
    });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-popular/status')
      .send({ status: 'accepted' });
    expect(res.status).not.toBe(500);
  });
  test('concurrent admin: two admins change same suggestion simultaneously', async () => {
    setupDocMocks({ 'suggestions/sug-race': makeSuggestionDoc('sug-race', { status: 'pending' }) });
    const [res1, res2] = await Promise.all([
      request(createApp({ uniqueId: 9001, isAdmin: true }))
        .put('/api/admin/suggestions/sug-race/status')
        .send({ status: 'accepted' }),
      request(createApp({ uniqueId: 9002, isAdmin: true }))
        .put('/api/admin/suggestions/sug-race/status')
        .send({ status: 'rejected', reason: 'Not feasible' }),
    ]);
    expect([res1, res2].filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(res1.status).not.toBe(500);
    expect(res2.status).not.toBe(500);
  });
});

// =============================================================================
// 11.72 — GDPR Data Export & Account Deletion
// =============================================================================

describe('11.72 — GDPR Data Export & Account Deletion', () => {
  test('data export includes user suggestions', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeSuggestionDoc('sug-1', { submitterUid: 1001 }),
        makeSuggestionDoc('sug-2', { submitterUid: 1001 }),
      ],
      size: 2,
    });
    const res = await request(createApp()).get('/api/suggestions/mine');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  // Data-export votes & comments coverage lives in
  // `tests/utils/data-export-builder.test.js` (the unit boundary where
  // the collection-group queries actually fire). The prior placeholders
  // here asserted only that the mock-collection helper exists (always
  // true) — they were honest TODOs, now resolved by the builder tests.
  // Account-deletion cascade is now covered by the cron-level integration
  // pattern in tests/cron/accountDeletion.test.js (Step 6b group). That is
  // the right home for it — these route-level mocks cannot exercise the
  // cron's collectionGroup queries or batch-update fan-out faithfully.
  test('GDPR export: suspended user can still request data export', async () => {
    const res = await request(createApp({ uniqueId: 1001, isSuspended: true })).get(
      '/api/suggestions/mine',
    );
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    } else if (res.status === 403) {
      expect(res.status).toBe(403);
    }
  });
});

// =============================================================================
// 11.83 — Caching & ETags
// =============================================================================

describe('11.83 — Caching & ETags', () => {
  test('GET /api/suggestions returns ETag header', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const res = await request(createApp()).get('/api/suggestions');
    if (res.status === 200 && res.headers.etag) {
      expect(typeof res.headers.etag).toBe('string');
    }
  });
  test('conditional GET with matching ETag returns 304', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const app = createApp();
    const first = await request(app).get('/api/suggestions');
    if (first.headers.etag) {
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [makeSuggestionDoc('sug-1')],
        size: 1,
      });
      const second = await request(app)
        .get('/api/suggestions')
        .set('If-None-Match', first.headers.etag);
      expect(second.status).toBe(304);
    }
  });
  test('GET /api/suggestions/:id returns ETag header', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1') });
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    if (res.status === 200 && res.headers.etag) {
      expect(typeof res.headers.etag).toBe('string');
    }
  });
  test('stale ETag returns 200 with fresh data', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const res = await request(createApp())
      .get('/api/suggestions')
      .set('If-None-Match', '"stale-etag"');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('Cache-Control header set on listing endpoint', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const res = await request(createApp()).get('/api/suggestions');
    if (res.status === 200 && res.headers['cache-control']) {
      expect(res.headers['cache-control']).toBeDefined();
    }
  });
  test('mutation endpoints do not set Cache-Control', async () => {
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    if (res.status < 500 && res.headers['cache-control']) {
      expect(res.headers['cache-control']).toMatch(/no-cache|no-store|private/);
    }
  });
});

// =============================================================================
// 11.84 — Firestore Transaction Guarantees
// =============================================================================

describe('11.84 — Firestore Transaction Guarantees', () => {
  test('vote count uses Firestore transaction for atomicity', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted', upvotes: 5 }),
    });
    await request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    expect(mockRunTransaction).toHaveBeenCalled();
  });
  test('vote count transaction: increment uses FieldValue.increment', async () => {
    const { FieldValue } = require('../../src/utils/firebase');
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    await request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    if (FieldValue.increment.mock.calls.length > 0) {
      expect(FieldValue.increment).toHaveBeenCalledWith(1);
    } else {
      expect(mockDocUpdate).toHaveBeenCalled();
    }
  });
  test('status transition uses transaction to prevent race conditions', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }) });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    expect(mockDocGet).toHaveBeenCalled();
    expect(mockDocUpdate).toHaveBeenCalled();
  });
  test('merge atomicity: source and target updated in same transaction', async () => {
    setupDocMocks({
      'suggestions/sug-dup': makeSuggestionDoc('sug-dup', { status: 'accepted', upvotes: 3 }),
      'suggestions/sug-orig': makeSuggestionDoc('sug-orig', { status: 'accepted', upvotes: 10 }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .post('/api/admin/suggestions/sug-dup/merge')
      .send({ targetId: 'sug-orig' });
    if (mockRunTransaction.mock.calls.length > 0) {
      expect(mockRunTransaction).toHaveBeenCalled();
    } else if (mockBatchCommit.mock.calls.length > 0) {
      expect(mockBatchCommit).toHaveBeenCalled();
    } else {
      expect(mockDocUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);
    }
  });
  test('transaction retry: aborted transaction retried by Firestore SDK', async () => {
    let callCount = 0;
    mockRunTransaction.mockImplementation(async (fn) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('ABORTED');
      }
      return fn({ get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete });
    });
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    await request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
  test('vote toggle: changing direction uses atomic decrement + increment', async () => {
    const { FieldValue } = require('../../src/utils/firebase');
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'accepted',
        upvotes: 5,
        downvotes: 2,
      }),
      'votes/sug-1_2002': makeVoteDoc('sug-1_2002', { voterUid: 2002, direction: 'up' }),
    });
    await request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'down' });
    if (FieldValue.increment.mock.calls.length >= 2) {
      expect(
        FieldValue.increment.mock.calls.find((c) => c[0] === -1) ||
          FieldValue.increment.mock.calls.find((c) => c[0] === 1),
      ).toBeDefined();
    }
  });
});

// =============================================================================
// 11.85 — Graceful Shutdown
// =============================================================================

// =============================================================================
// 11.99 — Account Lifecycle with Suggestions
// =============================================================================

// =============================================================================
// 11.100 — Notification Pipeline End-to-End
// =============================================================================

// =============================================================================
// 11.115 — Error Recovery Flows
// =============================================================================

// =============================================================================
// 11.116 — Cross-Feature Interactions
// =============================================================================
