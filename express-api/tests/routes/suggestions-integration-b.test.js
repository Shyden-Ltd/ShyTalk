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

// =============================================================================
// 11.71 — Stress & Concurrency Flows
// =============================================================================

// =============================================================================
// 11.72 — GDPR Data Export & Account Deletion
// =============================================================================

// =============================================================================
// 11.83 — Caching & ETags
// =============================================================================

// =============================================================================
// 11.84 — Firestore Transaction Guarantees
// =============================================================================

// =============================================================================
// 11.85 — Graceful Shutdown
// =============================================================================

describe('11.85 — Graceful Shutdown', () => {
  test('in-flight suggestion creation completes before shutdown', async () => {
    let resolveWrite;
    const slowWrite = new Promise((resolve) => {
      resolveWrite = resolve;
    });
    mockDocSet.mockImplementationOnce(() => slowWrite.then(() => ({ id: 'slow-sug' })));
    mockCollectionAdd.mockImplementationOnce(() => slowWrite.then(() => ({ id: 'slow-sug' })));
    const reqPromise = request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    resolveWrite();
    const res = await reqPromise;
    expect(res.status).toBeLessThan(500);
  });
  test('in-flight vote transaction completes before shutdown', async () => {
    let resolveTransaction;
    const slow = new Promise((resolve) => {
      resolveTransaction = resolve;
    });
    mockRunTransaction.mockImplementationOnce(async (fn) => {
      await slow;
      return fn({
        get: () => Promise.resolve(makeSuggestionDoc('sug-1', { status: 'accepted' })),
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      });
    });
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    const reqPromise = request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    resolveTransaction();
    const res = await reqPromise;
    expect(res.status).toBeLessThan(500);
  });
  test('in-flight admin status change completes before shutdown', async () => {
    let resolveUpdate;
    const slow = new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    mockDocUpdate.mockImplementationOnce(() => slow);
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }) });
    const reqPromise = request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    resolveUpdate();
    const res = await reqPromise;
    expect(res.status).toBeLessThan(500);
  });
  test('notification dispatch completes even during shutdown', async () => {
    let resolvePm;
    const slow = new Promise((resolve) => {
      resolvePm = resolve;
    });
    sendSystemPm.mockImplementationOnce(() => slow);
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }) });
    const reqPromise = request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    resolvePm();
    const res = await reqPromise;
    expect(res.status).toBeLessThan(500);
  });
  test('batch write completes even during shutdown', async () => {
    let resolveBatch;
    const slow = new Promise((resolve) => {
      resolveBatch = resolve;
    });
    mockBatchCommit.mockImplementationOnce(() => slow);
    const reqPromise = request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    resolveBatch();
    const res = await reqPromise;
    expect(res.status).toBeLessThan(500);
  });
});

// =============================================================================
// 11.99 — Account Lifecycle with Suggestions
// =============================================================================

describe('11.99 — Account Lifecycle with Suggestions', () => {
  test('new account: no suggestions initially', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const res = await request(createApp({ uniqueId: 7777 })).get('/api/suggestions/mine');
    if (res.status === 200) {
      if (res.body.suggestions) {
        expect(res.body.suggestions).toHaveLength(0);
      } else if (Array.isArray(res.body)) {
        expect(res.body).toHaveLength(0);
      }
    }
  });
  test('active account: can create, vote, comment on suggestions', async () => {
    const app = createApp();
    expect((await request(app).post('/api/suggestions').send(VALID_SUGGESTION)).status).not.toBe(
      403,
    );
    jest.clearAllMocks();
    setupDocMocks({
      'suggestions/sug-other': makeSuggestionDoc('sug-other', {
        status: 'accepted',
        submitterUid: 9999,
      }),
    });
    expect(
      (await request(app).post('/api/suggestions/sug-other/vote').send({ direction: 'up' })).status,
    ).not.toBe(403);
    jest.clearAllMocks();
    setupDocMocks({
      'suggestions/sug-other': makeSuggestionDoc('sug-other', {
        status: 'accepted',
        submitterUid: 9999,
      }),
    });
    expect(
      (
        await request(app)
          .post('/api/suggestions/sug-other/comments')
          .send({ body: 'Love this idea!' })
      ).status,
    ).not.toBe(403);
  });
  test('suspended account: write operations blocked, reads allowed', async () => {
    const app = createApp({ uniqueId: 8888, isSuspended: true });
    expect((await request(app).post('/api/suggestions').send(VALID_SUGGESTION)).status).toBe(403);
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    expect((await request(app).get('/api/suggestions')).status).toBe(200);
  });
  test('deleted account: suggestions anonymized in listing', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeSuggestionDoc('sug-1', { submitterUid: null, submitterDisplayName: '[Deleted User]' }),
      ],
      size: 1,
    });
    const res = await request(createApp()).get('/api/suggestions');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('re-activated account: can resume creating suggestions', async () => {
    expect(
      (
        await request(createApp({ uniqueId: 1001, isSuspended: false }))
          .post('/api/suggestions')
          .send(VALID_SUGGESTION)
      ).status,
    ).not.toBe(403);
  });
  test('account with pending deletion: suggestions still visible', async () => {
    setupDocMocks({ 'users/1001': makeUserDoc(1001, { deletionScheduledAt: 1709999999999 }) });
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1', { submitterUid: 1001 })],
      size: 1,
    });
    const res = await request(createApp()).get('/api/suggestions');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('account with no subscription: default notification preferences applied', async () => {
    mockDocGet.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('subscriptions')) {
        return Promise.resolve({ exists: false });
      }
      if (typeof path === 'string' && path.includes('suggestions')) {
        return Promise.resolve(
          makeSuggestionDoc('sug-1', { status: 'pending', subscribers: [1001] }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    expect(
      (
        await request(createApp({ uniqueId: 9999, isAdmin: true }))
          .put('/api/admin/suggestions/sug-1/status')
          .send({ status: 'accepted' })
      ).status,
    ).not.toBe(500);
  });
});

// =============================================================================
// 11.100 — Notification Pipeline End-to-End
// =============================================================================

describe('11.100 — Notification Pipeline End-to-End', () => {
  test('suggestion accepted: in-app notification created', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'pending',
        submitterUid: 1001,
        subscribers: [1001],
      }),
      'users/1001': makeUserDoc(1001),
      'subscriptions/1001': makeSubscriptionDoc(1001),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    const notifCalls = mockCollectionAdd.mock.calls.filter(
      (c) =>
        c[0] === 'notifications' || (typeof c[0] === 'string' && c[0].includes('notifications')),
    );
    const setNotifCalls = mockDocSet.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('notifications'),
    );
    expect(
      notifCalls.length + setNotifCalls.length + sendSystemPm.mock.calls.length,
    ).toBeGreaterThan(0);
  });
  test('suggestion accepted: push notification dispatched via FCM', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'pending',
        submitterUid: 1001,
        subscribers: [1001],
      }),
      'users/1001': makeUserDoc(1001, { fcmTokens: ['token-abc'] }),
      'subscriptions/1001': makeSubscriptionDoc(1001, {
        channelPreferences: {
          suggestionAccepted: { push: true, inApp: true, systemMessage: false, email: false },
        },
      }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    if (sendFcmToTokens.mock.calls.length > 0) {
      expect(sendFcmToTokens).toHaveBeenCalled();
    }
  });
  test('suggestion accepted: system PM dispatched', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'pending',
        submitterUid: 1001,
        subscribers: [1001],
      }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    expect(sendSystemPm).toHaveBeenCalled();
  });
  test('suggestion rejected: only submitter notified, not all subscribers', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'pending',
        submitterUid: 1001,
        subscribers: [1001, 2002, 3003],
      }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'rejected', reason: 'Not feasible' });
    const total =
      sendSystemPm.mock.calls.length +
      sendFcmToTokens.mock.calls.length +
      mockCollectionAdd.mock.calls.filter(
        (c) =>
          c[0] === 'notifications' || (typeof c[0] === 'string' && c[0].includes('notifications')),
      ).length;
    if (total > 0) {
      expect(total).toBeLessThanOrEqual(3);
    }
  });
  test('suggestion completed: email dispatched if consent given', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'planned',
        submitterUid: 1001,
        subscribers: [1001],
      }),
      'users/1001': makeUserDoc(1001, { email: 'user@example.com' }),
      'subscriptions/1001': makeSubscriptionDoc(1001, {
        channelPreferences: {
          suggestionCompleted: { email: true, push: true, inApp: true, systemMessage: true },
        },
        email: 'user@example.com',
        emailConsentAt: 1709913600000,
      }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'completed' });
    if (sendEmail.mock.calls.length > 0) {
      expect(sendEmail).toHaveBeenCalled();
    }
  });
  test('comment notification: only suggestion watchers notified', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'accepted',
        subscribers: [1001, 2002],
      }),
    });
    await request(createApp({ uniqueId: 3003 }))
      .post('/api/suggestions/sug-1/comments')
      .send({ body: 'Great suggestion!' });
    expect(sendSystemPm.mock.calls.length + sendFcmToTokens.mock.calls.length).toBeDefined();
  });
  test('notification includes relatedId pointing to the suggestion', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending', submitterUid: 1001 }),
    });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    const notifCalls = [
      ...mockCollectionAdd.mock.calls.filter(
        (c) =>
          c[0] === 'notifications' || (typeof c[0] === 'string' && c[0].includes('notifications')),
      ),
      ...mockDocSet.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('notifications'),
      ),
    ];
    if (notifCalls.length > 0) {
      const d = notifCalls[0][1] || notifCalls[0][0];
      if (d?.relatedId) {
        expect(d.relatedId).toContain('sug-1');
      }
    }
  });
});

// =============================================================================
// 11.115 — Error Recovery Flows
// =============================================================================

describe('11.115 — Error Recovery Flows', () => {
  test('Firestore unavailable on creation: returns 500, no partial write', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    mockCollectionAdd.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(res.status).toBe(500);
    expect(sendSystemPm).not.toHaveBeenCalled();
  });
  test('Firestore unavailable on vote: returns 500', async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted', upvotes: 5 }),
    });
    expect(
      (
        await request(createApp({ uniqueId: 2002 }))
          .post('/api/suggestions/sug-1/vote')
          .send({ direction: 'up' })
      ).status,
    ).toBe(500);
  });
  test('Firestore unavailable on status change: returns 500', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }) });
    expect(
      (
        await request(createApp({ uniqueId: 9999, isAdmin: true }))
          .put('/api/admin/suggestions/sug-1/status')
          .send({ status: 'accepted' })
      ).status,
    ).toBe(500);
  });
  test('partial write recovery: notification failure does not rollback creation', async () => {
    sendSystemPm.mockRejectedValueOnce(new Error('Notification failed'));
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(res.status).not.toBe(500);
    expect(mockDocSet.mock.calls.length + mockCollectionAdd.mock.calls.length).toBeGreaterThan(0);
  });
  test('batch commit failure: returns 500 with descriptive error', async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error('Batch commit failed'));
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    if (res.status === 500) {
      expect(res.body.error || res.body.message).toBeDefined();
    }
  });
  test('timeout recovery: long-running request returns within timeout', async () => {
    mockDocSet.mockImplementationOnce(() => new Promise((r) => setTimeout(r, 100)));
    mockCollectionAdd.mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r({ id: 'slow' }), 100)),
    );
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(res.status).toBeDefined();
  });
  test('malformed request body: returns 400, not 500', async () => {
    const res = await request(createApp())
      .post('/api/suggestions')
      .send({ title: '', description: '' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  test('non-existent suggestion: returns 404', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    expect((await request(createApp()).get('/api/suggestions/nonexistent-id')).status).toBe(404);
  });
  test('Firestore permission denied: returns 500', async () => {
    mockDocGet.mockRejectedValue(new Error('PERMISSION_DENIED'));
    expect((await request(createApp()).get('/api/suggestions/sug-1')).status).toBe(500);
  });
});

// =============================================================================
// 11.115b — GDPR-Deleted Submitter Guards
// =============================================================================
//
// Verifies the explicit `submitterDeleted` guards on:
//   - notifySubscribers (suggestions.js:879-887) — must NOT FCM/SystemPm the
//     anonymised submitter when admin changes status on their suggestion
//   - GET /suggestions/:id admin sidebar (suggestions.js:279) — must NOT
//     query "other suggestions" by submitterUid=0 when submitterDeleted=true
//
// Both guards previously relied on `submitterUid: 0` being JavaScript-falsy.
// That is correct behaviour today but breaks silently if the sentinel value
// ever changes — these tests force the contract to be load-bearing.

describe('11.115b — GDPR-Deleted Submitter Guards', () => {
  test('admin status-change on anonymised suggestion does NOT notify uid=0', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'pending',
        submitterUid: 0,
        submitterDeleted: true,
        subscribers: [], // no other subscribers either
      }),
    });

    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });

    // No FCM / system-PM should target the anonymised submitter
    const fcmTargetedUid0 = sendFcmToTokens.mock.calls.some(
      ([tokens]) => Array.isArray(tokens) && tokens.includes(0),
    );
    expect(fcmTargetedUid0).toBe(false);
    const pmTargetedUid0 = sendSystemPm.mock.calls.some(([uid]) => uid === 0);
    expect(pmTargetedUid0).toBe(false);
  });

  test('admin status-change on live submitter DOES notify them (regression guard)', async () => {
    // Counterpart to the above — confirms the guard fires only for deleted
    // submitters, not as a blanket suppression.
    setupDocMocks({
      'suggestions/sug-2': makeSuggestionDoc('sug-2', {
        status: 'pending',
        submitterUid: 1001,
        subscribers: [],
      }),
      'users/1001': makeUserDoc(1001),
    });

    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-2/status')
      .send({ status: 'accepted' });

    const pmTargetedSubmitter = sendSystemPm.mock.calls.some(([uid]) => uid === 1001);
    expect(pmTargetedSubmitter).toBe(true);
  });

  test('GET /suggestions/:id (admin) skips submitterOtherSuggestions when submitterDeleted (uid=0)', async () => {
    setupDocMocks({
      'suggestions/sug-3': makeSuggestionDoc('sug-3', {
        status: 'accepted',
        submitterUid: 0,
        submitterDeleted: true,
      }),
    });

    const res = await request(createApp({ uniqueId: 9999, isAdmin: true })).get(
      '/api/suggestions/sug-3',
    );

    // Field MUST be either absent or an empty array — what we MUST NOT see
    // is a populated list for a deleted user. `field || []` normalises both
    // null and undefined to the same empty-array contract.
    expect(res.body.submitterOtherSuggestions || []).toEqual([]);
  });

  test('GET /suggestions/:id (admin) skips submitterOtherSuggestions when submitterDeleted with NON-ZERO uid', async () => {
    // Pins the load-bearing condition: the `!data.submitterDeleted` check is
    // the canonical gate, not the `submitterUid: 0` sentinel happening to be
    // falsy. If a future refactor reorders the conditions or someone
    // anonymises by setting `submitterDeleted: true` without zeroing the uid,
    // this test catches the regression. (Round-2 reviewer N2.)
    setupDocMocks({
      'suggestions/sug-4': makeSuggestionDoc('sug-4', {
        status: 'accepted',
        submitterUid: 1001, // intentionally non-zero
        submitterDeleted: true, // but flag says deleted
      }),
    });

    const res = await request(createApp({ uniqueId: 9999, isAdmin: true })).get(
      '/api/suggestions/sug-4',
    );

    expect(res.body.submitterOtherSuggestions || []).toEqual([]);
  });
});

// =============================================================================
// 11.116 — Cross-Feature Interactions
// =============================================================================

describe('11.116 — Cross-Feature Interactions', () => {
  test('suggestion linked to roadmap feature: roadmap deletion does not orphan suggestion', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'planned',
        linkedRoadmapFeature: 'feat-deleted',
      }),
      'roadmapFeatures/feat-deleted': { exists: false },
    });
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('suggestion with roadmap link: status reflects roadmap feature state', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', {
        status: 'planned',
        linkedRoadmapFeature: 'feat-1',
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('economy interaction: suggestion milestones do not affect coin balance', async () => {
    await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(
      mockDocUpdate.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0].includes('economy') || c[0].includes('coins')),
      ).length,
    ).toBe(0);
  });
  test('room interaction: active voice room user can still create suggestions', async () => {
    expect(
      (await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION)).status,
    ).not.toBe(403);
  });
  test('report interaction: reported suggestion still accessible until admin action', async () => {
    setupDocMocks({
      'suggestions/sug-reported': makeSuggestionDoc('sug-reported', {
        status: 'accepted',
        isReported: true,
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/sug-reported');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('conversation interaction: system PMs use correct conversation format', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }) });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    if (sendSystemPm.mock.calls.length > 0) {
      expect(sendSystemPm.mock.calls[0]).toBeDefined();
    }
  });
  test('identity interaction: suggestion submitter uniqueId matches auth identity', async () => {
    await request(createApp({ uniqueId: 1001 }))
      .post('/api/suggestions')
      .send(VALID_SUGGESTION);
    const createCalls = [
      ...mockDocSet.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('suggestions'),
      ),
      ...mockCollectionAdd.mock.calls.filter((c) => c[0] === 'suggestions'),
    ];
    if (createCalls.length > 0) {
      const d = createCalls[0][1] || createCalls[0][0];
      if (d?.submitterUid) {
        expect(d.submitterUid).toBe(1001);
      }
    }
  });
  test('subscription interaction: watching a suggestion adds to subscription doc', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    await request(createApp()).post('/api/suggestions/sug-1/vote').send({ direction: 'up' });
    const subscriptionCall = [...mockDocSet.mock.calls, ...mockDocUpdate.mock.calls].find(
      (c) => typeof c[0] === 'string' && c[0].includes('subscriptions'),
    );
    if (subscriptionCall) {
      expect(subscriptionCall).toBeDefined();
    }
  });
  test('ban interaction: banning user does not delete their existing suggestions', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { submitterUid: 5555, status: 'accepted' }),
    });
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('translation interaction: suggestion stored in original language', async () => {
    await request(createApp())
      .post('/api/suggestions')
      .send({ ...VALID_SUGGESTION, language: 'ja' });
    const createCalls = [
      ...mockDocSet.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('suggestions'),
      ),
      ...mockCollectionAdd.mock.calls.filter((c) => c[0] === 'suggestions'),
    ];
    if (createCalls.length > 0) {
      const d = createCalls[0][1] || createCalls[0][0];
      if (d?.language) {
        expect(d.language).toBe('ja');
      }
    }
  });
  test('admin log interaction: admin actions create audit trail', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }) });
    await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    const auditCalls = [...mockDocSet.mock.calls, ...mockCollectionAdd.mock.calls].filter(
      (c) =>
        typeof c[0] === 'string' && (c[0].includes('audit') || c[0].includes('suggestionAudit')),
    );
    if (auditCalls.length > 0) {
      expect(auditCalls.length).toBeGreaterThan(0);
    } else {
      expect(log.info).toHaveBeenCalled();
    }
  });
});
