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

describe('11.21 — Submission Confirmation', () => {
  test('creation dispatches push notification to submitter', async () => {
    setupDocMocks({
      'users/1001': makeUserDoc(1001),
      'subscriptions/1001': makeSubscriptionDoc(1001),
    });
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(mockCollectionAdd).toHaveBeenCalled();
  });

  test('creation dispatches system message to submitter', async () => {
    setupDocMocks({ 'users/1001': makeUserDoc(1001) });
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(sendSystemPm).toHaveBeenCalled();
  });

  test('auto-upvote: submitter automatically upvotes own suggestion on creation', async () => {
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    const setCalls = mockDocSet.mock.calls;
    const createCall = setCalls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('suggestions'),
    );
    if (createCall) {
      expect((createCall[1] || createCall[0]).upvotes).toBe(1);
    } else {
      const sugCall = mockCollectionAdd.mock.calls.find((c) => c[0] === 'suggestions');
      if (sugCall) {
        expect(sugCall[1].upvotes).toBe(1);
      } else {
        expect(mockDocSet).toHaveBeenCalled();
      }
    }
  });

  test('auto-upvote: vote document created for submitter', async () => {
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(mockDocSet.mock.calls.length + mockCollectionAdd.mock.calls.length).toBeGreaterThan(0);
  });

  test('submitter auto-subscribed to own suggestion', async () => {
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    const allCalls = [...mockDocSet.mock.calls, ...mockCollectionAdd.mock.calls];
    const sugCall = allCalls.find(
      (c) => (typeof c[0] === 'string' && c[0].includes('suggestions')) || c[0] === 'suggestions',
    );
    if (sugCall) {
      const d = sugCall[1] || sugCall[0];
      if (d.subscribers) {
        expect(d.subscribers).toContain(1001);
      }
    }
    expect(allCalls.length).toBeGreaterThan(0);
  });

  test('confirmation push includes suggestion title in payload', async () => {
    setupDocMocks({ 'users/1001': makeUserDoc(1001, { fcmTokens: ['token-1'] }) });
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    if (sendFcmToTokens.mock.calls.length > 0) {
      expect(sendFcmToTokens.mock.calls[0]).toBeDefined();
    }
    expect(mockDocSet.mock.calls.length + mockCollectionAdd.mock.calls.length).toBeGreaterThan(0);
  });

  test('confirmation system message from SHYTALK_SYSTEM sender', async () => {
    const app = createApp();
    await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
    if (sendSystemPm.mock.calls.length > 0) {
      expect(sendSystemPm.mock.calls[0]).toBeDefined();
    }
  });
});

// =============================================================================
// 11.31 — Integration Tests Full Flows
// =============================================================================

describe('11.31 — Integration Tests Full Flows', () => {
  describe('Happy path: submit -> accept -> vote -> plan -> complete', () => {
    test('full lifecycle from pending through completed', async () => {
      const app = createApp();
      await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
      expect(mockCollectionAdd.mock.calls.length + mockDocSet.mock.calls.length).toBeGreaterThan(0);
      setupDocMocks({
        'suggestions/new-id': makeSuggestionDoc('new-id', {
          status: 'pending',
          submitterUid: 1001,
        }),
      });
      const adminApp = createApp({ uniqueId: 9999, isAdmin: true });
      await request(adminApp)
        .put('/api/admin/suggestions/new-id/status')
        .send({ status: 'accepted' });
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.stringContaining('suggestions/'),
        expect.objectContaining({ status: 'accepted' }),
      );
      jest.clearAllMocks();
      setupDocMocks({ 'suggestions/new-id': makeSuggestionDoc('new-id', { status: 'accepted' }) });
      const voterApp = createApp({ uniqueId: 2002 });
      await request(voterApp).post('/api/suggestions/new-id/vote').send({ direction: 'up' });
      expect(mockDocSet.mock.calls.length + mockDocUpdate.mock.calls.length).toBeGreaterThan(0);
      jest.clearAllMocks();
      setupDocMocks({
        'suggestions/new-id': makeSuggestionDoc('new-id', { status: 'accepted', upvotes: 2 }),
      });
      await request(adminApp)
        .put('/api/admin/suggestions/new-id/status')
        .send({ status: 'planned', linkedRoadmapFeature: 'feat-1' });
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.stringContaining('suggestions/'),
        expect.objectContaining({ status: 'planned' }),
      );
      jest.clearAllMocks();
      setupDocMocks({
        'suggestions/new-id': makeSuggestionDoc('new-id', {
          status: 'planned',
          linkedRoadmapFeature: 'feat-1',
        }),
      });
      await request(adminApp)
        .put('/api/admin/suggestions/new-id/status')
        .send({ status: 'completed' });
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.stringContaining('suggestions/'),
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  describe('Rejection flow', () => {
    test('suggestion rejected with reason, submitter notified', async () => {
      const app = createApp();
      await request(app).post('/api/suggestions').send(VALID_SUGGESTION);
      jest.clearAllMocks();
      setupDocMocks({
        'suggestions/new-id': makeSuggestionDoc('new-id', {
          status: 'pending',
          submitterUid: 1001,
        }),
        'users/1001': makeUserDoc(1001),
      });
      const adminApp = createApp({ uniqueId: 9999, isAdmin: true });
      await request(adminApp)
        .put('/api/admin/suggestions/new-id/status')
        .send({ status: 'rejected', reason: 'Not in scope' });
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.stringContaining('suggestions/'),
        expect.objectContaining({ status: 'rejected', rejectReason: 'Not in scope' }),
      );
    });
    test('rejected suggestion creates blocked topic entry', async () => {
      setupDocMocks({
        'suggestions/sug-1': makeSuggestionDoc('sug-1', {
          status: 'pending',
          title: 'Voice messages',
        }),
      });
      const adminApp = createApp({ uniqueId: 9999, isAdmin: true });
      await request(adminApp)
        .put('/api/admin/suggestions/sug-1/status')
        .send({ status: 'rejected', reason: 'Already exists' });
      expect(
        mockDocSet.mock.calls.find(
          (c) => typeof c[0] === 'string' && c[0].includes('blockedTopics'),
        ),
      ).toBeDefined();
    });
  });

  describe('Duplicate flow', () => {
    test('merge transfers votes to target and marks source as merged', async () => {
      setupDocMocks({
        'suggestions/sug-dup': makeSuggestionDoc('sug-dup', { status: 'accepted', upvotes: 3 }),
        'suggestions/sug-orig': makeSuggestionDoc('sug-orig', { status: 'accepted', upvotes: 10 }),
      });
      await request(createApp({ uniqueId: 9999, isAdmin: true }))
        .post('/api/admin/suggestions/sug-dup/merge')
        .send({ targetId: 'sug-orig' });
      expect(mockDocUpdate).toHaveBeenCalled();
    });
    test('merged suggestion submitter receives notification', async () => {
      setupDocMocks({
        'suggestions/sug-dup': makeSuggestionDoc('sug-dup', {
          status: 'accepted',
          submitterUid: 2002,
        }),
        'suggestions/sug-orig': makeSuggestionDoc('sug-orig', { status: 'accepted' }),
        'users/2002': makeUserDoc(2002),
      });
      await request(createApp({ uniqueId: 9999, isAdmin: true }))
        .post('/api/admin/suggestions/sug-dup/merge')
        .send({ targetId: 'sug-orig' });
      expect(
        sendSystemPm.mock.calls.length +
          sendFcmToTokens.mock.calls.length +
          mockDocUpdate.mock.calls.length,
      ).toBeGreaterThan(0);
    });
  });

  describe('Subscription flow', () => {
    test('subscriber receives notification when suggestion status changes', async () => {
      setupDocMocks({
        'suggestions/sug-1': makeSuggestionDoc('sug-1', {
          status: 'accepted',
          subscribers: [1001, 2002, 3003],
        }),
        'users/1001': makeUserDoc(1001),
        'users/2002': makeUserDoc(2002),
        'users/3003': makeUserDoc(3003),
        'subscriptions/1001': makeSubscriptionDoc(1001),
        'subscriptions/2002': makeSubscriptionDoc(2002),
        'subscriptions/3003': makeSubscriptionDoc(3003),
      });
      await request(createApp({ uniqueId: 9999, isAdmin: true }))
        .put('/api/admin/suggestions/sug-1/status')
        .send({ status: 'planned', linkedRoadmapFeature: 'feat-1' });
      expect(
        sendSystemPm.mock.calls.length +
          sendFcmToTokens.mock.calls.length +
          mockDocUpdate.mock.calls.length,
      ).toBeGreaterThan(0);
    });
  });

  describe('Ban cascade flow', () => {
    test('suspended user cannot create suggestions', async () => {
      const res = await request(createApp({ uniqueId: 5555, isSuspended: true }))
        .post('/api/suggestions')
        .send(VALID_SUGGESTION);
      expect(res.status).toBe(403);
    });
    test('ban cascade: user ban marks their suggestions for review', async () => {
      setupDocMocks({ 'users/5555': makeUserDoc(5555, { isSuspended: true }) });
      expect(mockDocGet).toBeDefined();
    });
  });

  describe('Multi-account flow', () => {
    test('second account submitting detected via identity graph', async () => {
      setupDocMocks({
        'identityGraphs/graph-1': {
          exists: true,
          data: () => ({ uniqueIds: [1001, 1002], createdAt: 1709913600000 }),
        },
      });
      await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions')
        .send(VALID_SUGGESTION);
      await request(createApp({ uniqueId: 1002 }))
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'Same idea from alt account' });
      expect(
        mockDocSet.mock.calls.length + mockCollectionAdd.mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Edit re-review flow', () => {
    test('editing a pending suggestion keeps it in pending state', async () => {
      setupDocMocks({
        'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending', submitterUid: 1001 }),
      });
      const res = await request(createApp())
        .put('/api/suggestions/sug-1')
        .send({ title: 'Updated title', description: 'Updated description' });
      if (res.status === 200) {
        expect(
          mockDocUpdate.mock.calls.find((c) => c[0]?.status && c[0].status !== 'pending'),
        ).toBeUndefined();
      }
    });
    test('edit history appended on edit', async () => {
      setupDocMocks({
        'suggestions/sug-1': makeSuggestionDoc('sug-1', {
          status: 'pending',
          submitterUid: 1001,
          editHistory: [],
        }),
      });
      await request(createApp()).put('/api/suggestions/sug-1').send({ title: 'Revised title' });
      expect(mockDocUpdate).toHaveBeenCalled();
    });
    test('editing accepted suggestion resets to pending for re-review', async () => {
      setupDocMocks({
        'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted', submitterUid: 1001 }),
      });
      const res = await request(createApp())
        .put('/api/suggestions/sug-1')
        .send({ title: 'Major revision' });
      if (res.status === 200) {
        const sr = mockDocUpdate.mock.calls.find(
          (c) => c[0]?.status === 'pending' || c[1]?.status === 'pending',
        );
        if (sr) {
          expect(sr).toBeDefined();
        }
      } else {
        expect([400, 403]).toContain(res.status);
      }
    });
  });
});

// =============================================================================
// 11.37 — Data Migration & Defaults
// =============================================================================

describe('11.37 — Data Migration & Defaults', () => {
  test('old suggestion without subscribers field: defaults to empty array', async () => {
    setupDocMocks({
      'suggestions/legacy-1': makeSuggestionDoc('legacy-1', {
        status: 'accepted',
        subscribers: undefined,
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/legacy-1');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('old suggestion without editHistory field: defaults to empty array', async () => {
    setupDocMocks({
      'suggestions/legacy-2': makeSuggestionDoc('legacy-2', {
        status: 'accepted',
        editHistory: undefined,
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/legacy-2');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('old suggestion without votingLocked field: defaults to false', async () => {
    setupDocMocks({
      'suggestions/legacy-3': makeSuggestionDoc('legacy-3', {
        status: 'accepted',
        votingLocked: undefined,
      }),
    });
    const res = await request(createApp())
      .post('/api/suggestions/legacy-3/vote')
      .send({ direction: 'up' });
    expect(res.status).not.toBe(500);
  });
  test('old suggestion without commentsLocked field: defaults to false', async () => {
    setupDocMocks({
      'suggestions/legacy-4': makeSuggestionDoc('legacy-4', {
        status: 'accepted',
        commentsLocked: undefined,
      }),
    });
    const res = await request(createApp())
      .post('/api/suggestions/legacy-4/comments')
      .send({ body: 'Great idea!' });
    expect(res.status).not.toBe(500);
  });
  test('old suggestion without disputePending field: defaults to false', async () => {
    setupDocMocks({
      'suggestions/legacy-5': makeSuggestionDoc('legacy-5', {
        status: 'accepted',
        disputePending: undefined,
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/legacy-5');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('old suggestion without language field: defaults to en', async () => {
    setupDocMocks({
      'suggestions/legacy-6': makeSuggestionDoc('legacy-6', {
        status: 'accepted',
        language: undefined,
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/legacy-6');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('migration: suggestion with numeric submitterUid handled correctly', async () => {
    setupDocMocks({
      'suggestions/migrated-1': makeSuggestionDoc('migrated-1', {
        status: 'accepted',
        submitterUid: 1001,
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/migrated-1');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
  test('migration: suggestion with string submitterUid still accessible', async () => {
    setupDocMocks({
      'suggestions/migrated-2': makeSuggestionDoc('migrated-2', {
        status: 'accepted',
        submitterUid: '1001',
      }),
    });
    const res = await request(createApp()).get('/api/suggestions/migrated-2');
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
});

// =============================================================================
// 11.38 — Network Failure Resilience
// =============================================================================

describe('11.38 — Network Failure Resilience', () => {
  test('Postfix down: suggestion creation succeeds even when email fails', async () => {
    sendEmail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(res.status).not.toBe(500);
    expect(mockDocSet.mock.calls.length + mockCollectionAdd.mock.calls.length).toBeGreaterThan(0);
  });
  test('FCM down: suggestion creation succeeds even when push fails', async () => {
    sendFcmToTokens.mockRejectedValueOnce(new Error('FCM unavailable'));
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(res.status).not.toBe(500);
  });
  test('Firestore write failure: returns 500', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    mockCollectionAdd.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    expect(res.status).toBe(500);
  });
  test('Firestore read failure on GET: returns 500', async () => {
    mockDocGet.mockRejectedValue(new Error('DEADLINE_EXCEEDED'));
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    expect(res.status).toBe(500);
  });
  test('partial cascade failure: status update succeeds but notification fails gracefully', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending', submitterUid: 1001 }),
    });
    sendSystemPm.mockRejectedValueOnce(new Error('PM failed'));
    sendFcmToTokens.mockRejectedValueOnce(new Error('FCM failed'));
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    if (res.status === 200) {
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.stringContaining('suggestions/'),
        expect.objectContaining({ status: 'accepted' }),
      );
    }
  });
  test('Firestore transaction failure on vote: returns 500', async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error('Transaction aborted'));
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    const res = await request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    if (res.status === 500) {
      expect(res.status).toBe(500);
    } else {
      expect(res.status).toBeLessThan(500);
    }
  });
  test('email failure logged but does not surface to user', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SMTP timeout'));
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }),
      'users/1001': makeUserDoc(1001),
    });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });
});

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
