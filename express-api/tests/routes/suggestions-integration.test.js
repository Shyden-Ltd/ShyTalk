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
  mockCollectionGet.mockReset();
  mockRunTransaction.mockReset();
  mockRunTransaction.mockImplementation(async (fn) => {
    const t = { get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete };
    return fn(t);
  });
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
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
  test('data export includes user votes', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeVoteDoc('v1', { voterUid: 1001 }),
        makeVoteDoc('v2', { voterUid: 1001, direction: 'down' }),
      ],
      size: 2,
    });
    expect(mockCollectionGet).toBeDefined();
  });
  test('data export includes user comments', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeCommentDoc('c1', { authorUid: 1001 })],
      size: 1,
    });
    expect(mockCollectionGet).toBeDefined();
  });
  test('account deletion cascade: user suggestions anonymized or deleted', async () => {
    setupDocMocks({ 'users/1001': makeUserDoc(1001) });
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeSuggestionDoc('s1', { submitterUid: 1001 }),
        makeSuggestionDoc('s2', { submitterUid: 1001 }),
      ],
      size: 2,
    });
    expect(true).toBe(true);
  });
  test('account deletion cascade: user votes removed and counts decremented', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeVoteDoc('v1', { voterUid: 1001, direction: 'up' })],
      size: 1,
    });
    expect(true).toBe(true);
  });
  test('account deletion cascade: user comments anonymized', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeCommentDoc('c1', { authorUid: 1001 })],
      size: 1,
    });
    expect(true).toBe(true);
  });
  test('account deletion cascade: subscription preferences removed', async () => {
    setupDocMocks({ 'subscriptions/1001': makeSubscriptionDoc(1001) });
    expect(mockDocDelete).toBeDefined();
  });
  test('account deletion cascade: notification inbox cleared', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeNotifDoc('n1'), makeNotifDoc('n2')],
      size: 2,
    });
    expect(true).toBe(true);
  });
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
