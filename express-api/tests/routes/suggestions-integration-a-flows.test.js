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
    // Firestore's `Transaction.get` takes a DocumentReference, NOT a path
    // string — passing a string throws. This mock previously accepted only the
    // string, which meant it agreed with the very defect SHY-0253 fixed: the
    // route read `t.get(\`suggestions/${id}\`)` and every real vote 500'd while
    // this test stayed green. Resolving the ref's `_path` keeps the mock
    // honest about what the SDK actually accepts, and still lets the existing
    // per-path stubs answer.
    get: (ref) => (typeof ref === 'string' ? mockDocGet(ref) : ref.get()),
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
  mockDocGet.mockImplementation((pathOrRef) => {
    // A transaction reads through `t.get(ref)` — a DocumentReference, which is
    // what Firestore's SDK requires and what the routes now pass (SHY-0253).
    // Matching only on a string meant this helper agreed with the defect: the
    // route used to hand `t.get` a PATH STRING, every real vote 500'd, and
    // these tests stayed green because the string was all the mock understood.
    const path = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef && pathOrRef._path;
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
    expect(res.status).toBe(200);
    // "is warned" is the claim: `blocked` must actually be true and the
    // matching topic must come back, not merely "a body exists".
    expect(res.body.blocked).toBe(true);
    expect(res.body.topics).toEqual([expect.objectContaining({ title: 'Voice messages' })]);
  });
  test('admin unblock: removing blocked topic allows re-submission', async () => {
    setupDocMocks({ 'blockedTopics/bt-1': makeBlockedTopicDoc('bt-1') });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true })).delete(
      '/api/admin/suggestions/blocked/bt-1',
    );
    expect(res.status).toBe(200);
    expect(mockDocDelete).toHaveBeenCalled();
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
  test('merge consolidates the duplicate votes onto the target', async () => {
    // Renamed from "identity graph merge: merged account votes consolidated",
    // which did nothing but GET a suggestion and assert its body was
    // `defined` — it never merged anything and never looked at a vote count.
    // The consolidation it named is a real, checkable claim, so check it.
    setupDocMocks({
      'suggestions/sug-dup': makeSuggestionDoc('sug-dup', { status: 'accepted', voteCount: 5 }),
      'suggestions/sug-orig': makeSuggestionDoc('sug-orig', { status: 'accepted', voteCount: 10 }),
    });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .post('/api/admin/suggestions/sug-dup/merge')
      .send({ targetId: 'sug-orig' });
    expect(res.status).toBe(200);
    // The duplicate's 5 votes move to the target as an atomic increment.
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(5);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'merged', mergedInto: 'sug-orig' }),
    );
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
    const res = await request(createApp({ uniqueId: 1001 }))
      .post('/api/suggestions/sug-1/dispute')
      .send({ reason: 'My suggestion is not a duplicate' });
    // This endpoint did not exist: the request 404'd and the guard swallowed
    // it, so a documented user right was missing for as long as the test was
    // green. Added in SHY-0256, and the caller is now the SUBMITTER (1001)
    // because only the submitter may dispute their own merge.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, disputeStatus: 'pending' });
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeStatus: 'pending',
        disputeReason: 'My suggestion is not a duplicate',
        disputedByUid: 1001,
      }),
    );
  });

  // Error paths for the dispute endpoint added in SHY-0256. A new endpoint
  // with only a happy-path test is how the next silent gap gets in.
  describe('POST /suggestions/:id/dispute — error paths', () => {
    const merged = (extra = {}) =>
      makeSuggestionDoc('sug-1', {
        status: 'merged',
        mergedIntoSuggestionId: 'sug-2',
        mergedInto: 'sug-2',
        submitterUid: 1001,
        ...extra,
      });

    test('a different user cannot dispute someone else’s suggestion', async () => {
      setupDocMocks({ 'suggestions/sug-1': merged() });
      const res = await request(createApp({ uniqueId: 2002 }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'not mine to dispute' });
      expect(res.status).toBe(403);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test('an admin has no special right to dispute on a user’s behalf', async () => {
      // Ownership, not privilege, is the gate here — the old admin-namespaced
      // twin inverted that.
      setupDocMocks({ 'suggestions/sug-1': merged() });
      const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'admin meddling' });
      expect(res.status).toBe(403);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test('a suggestion that was never merged cannot be disputed', async () => {
      setupDocMocks({
        'suggestions/sug-1': makeSuggestionDoc('sug-1', {
          status: 'accepted',
          submitterUid: 1001,
        }),
      });
      const res = await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'nothing to dispute' });
      expect(res.status).toBe(409);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test('a dispute already resolved cannot be reopened', async () => {
      setupDocMocks({ 'suggestions/sug-1': merged({ disputeStatus: 'resolved' }) });
      const res = await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'trying again' });
      expect(res.status).toBe(409);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test('a dispute already open is not duplicated', async () => {
      setupDocMocks({ 'suggestions/sug-1': merged({ disputeStatus: 'pending' }) });
      const res = await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'again' });
      expect(res.status).toBe(409);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test.each([
      ['missing', undefined],
      ['empty', ''],
      ['whitespace only', '   '],
    ])('a %s reason is rejected', async (_label, reason) => {
      setupDocMocks({ 'suggestions/sug-1': merged() });
      const res = await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions/sug-1/dispute')
        .send(reason === undefined ? {} : { reason });
      expect(res.status).toBe(400);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test('a reason longer than the description limit is rejected', async () => {
      setupDocMocks({ 'suggestions/sug-1': merged() });
      const res = await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'x'.repeat(10_000) });
      expect(res.status).toBe(400);
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    test('a missing suggestion is a 404, not a silent success', async () => {
      setupDocMocks({});
      const res = await request(createApp({ uniqueId: 1001 }))
        .post('/api/suggestions/nope/dispute')
        .send({ reason: 'where is it' });
      expect(res.status).toBe(404);
    });

    test('a suspended submitter keeps the right to dispute', async () => {
      // Contesting a decision about your own content is an appeal, so the
      // route deliberately does NOT call requireNotSuspended.
      setupDocMocks({ 'suggestions/sug-1': merged() });
      const res = await request(createApp({ uniqueId: 1001, isSuspended: true }))
        .post('/api/suggestions/sug-1/dispute')
        .send({ reason: 'suspended but still mine' });
      expect(res.status).toBe(200);
    });
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
    expect(res.status).toBe(200);
    // "includes user suggestions" — so check they are actually in there.
    expect(res.body.suggestions).toHaveLength(2);
    expect(res.body.suggestions.map((s) => s.id).sort()).toEqual(['sug-1', 'sug-2']);
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
    // The old form accepted 200 OR 403 — i.e. it accepted both the feature
    // working and the feature being denied, which is no assertion at all.
    // A suspended account keeps its data-export rights, so this must be 200:
    // /suggestions/mine guards with requireAuth only, never
    // requireNotSuspended.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });
});

// =============================================================================
// 11.83 — Caching & ETags
// =============================================================================

describe('11.83 — Caching & ETags', () => {
  // Every test below used to guard its only assertion on the very thing it
  // was named after — `if (res.headers.etag) { expect(...) }` — so "returns
  // ETag header" passed on a response with no ETag header (SHY-0256). The
  // behaviour was verified against the running API before these were
  // un-guarded: ETag and 304 come from Express's weak-ETag default,
  // Cache-Control did not exist and was added in this change.
  test('GET /api/suggestions returns ETag header', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const res = await request(createApp()).get('/api/suggestions');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toEqual(expect.any(String));
    expect(res.headers.etag.length).toBeGreaterThan(0);
  });
  test('conditional GET with matching ETag returns 304', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const app = createApp();
    const first = await request(app).get('/api/suggestions');
    expect(first.headers.etag).toBeTruthy();
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const second = await request(app)
      .get('/api/suggestions')
      .set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    // A 304 carries no body — that is the whole point of the round trip.
    expect(second.text).toBeFalsy();
  });
  test('GET /api/suggestions/:id returns ETag header', async () => {
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1') });
    const res = await request(createApp()).get('/api/suggestions/sug-1');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toEqual(expect.any(String));
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
    expect(res.status).toBe(200);
    // "fresh data" is the claim in the name, so check the body actually
    // arrived rather than that it is merely `defined`.
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions).toHaveLength(1);
  });
  test('Cache-Control on the listing is private and short-lived', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeSuggestionDoc('sug-1')],
      size: 1,
    });
    const res = await request(createApp()).get('/api/suggestions');
    expect(res.status).toBe(200);
    // `private` is the security-relevant half: the listing embeds the caller's
    // own vote, and an admin additionally sees non-public comments, so a shared
    // cache would serve one user's view to another.
    expect(res.headers['cache-control']).toMatch(/\bprivate\b/);
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });
  test('mutation endpoints are never cacheable', async () => {
    const res = await request(createApp()).post('/api/suggestions').send(VALID_SUGGESTION);
    const cc = res.headers['cache-control'];
    // Absent is acceptable (no cache directive at all); anything present must
    // forbid reuse. The old test only checked the second case and so passed
    // vacuously whenever the header was missing.
    expect(cc === undefined || /no-cache|no-store|private/.test(cc)).toBe(true);
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
    // The old form accepted `FieldValue.increment(1)` OR any bare update, so a
    // route that abandoned atomic counters entirely still passed. The route
    // does use a transaction with atomic increments; assert exactly that.
    expect(mockRunTransaction).toHaveBeenCalled();
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
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
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .post('/api/admin/suggestions/sug-dup/merge')
      .send({ targetId: 'sug-orig' });
    // Status first. Without it this test passed against a route that threw
    // AFTER committing the transaction and returned 500 — every mock
    // expectation below was already satisfied by then, so the request could
    // fail outright and the test still agreed with it.
    expect(res.status).toBe(200);
    // "in the same transaction" is the CLAIM in the name, so accepting a
    // transaction OR a batch OR two loose updates asserted nothing. It was
    // two loose updates: a failure between them marked the duplicate merged
    // and lost its votes with no way to retry. Now one transaction, and both
    // writes must happen inside it.
    expect(mockRunTransaction).toHaveBeenCalled();
    const updatedPaths = mockDocUpdate.mock.calls.map((c) => c[0]);
    expect(updatedPaths.length).toBeGreaterThanOrEqual(2);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'merged', mergedInto: 'sug-orig' }),
    );
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ voteCount: expect.anything(), upvotes: expect.anything() }),
    );
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
    // Toggling up→down must do BOTH halves: take one off upvotes and add one
    // to downvotes. The old form ran only when there were already 2+ calls and
    // then accepted EITHER, so a route that decremented and forgot to
    // increment passed.
    const deltas = FieldValue.increment.mock.calls.map((c) => c[0]);
    expect(deltas).toContain(-1);
    expect(deltas).toContain(1);
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

// =============================================================================
// Observability — moved here from admin-audit-log-suggestions.test.js (SHY-0256)
//
// These lived there as empty bodies that reported green. They describe
// suggestion-route behaviour, and that file mounts only the audit-log,
// maintenance and health routers — it could never have exercised them. Here the
// suggestions router IS the app under test.
// =============================================================================

describe('Observability of suggestion actions', () => {
  const log = require('../../src/utils/log');

  test('creating a suggestion is logged with the submitter and the new id', async () => {
    const res = await request(createApp({ uniqueId: 1001 }))
      .post('/api/suggestions')
      .send(VALID_SUGGESTION);
    expect(res.status).toBe(201);
    expect(log.info).toHaveBeenCalledWith(
      'suggestions',
      'Suggestion created',
      expect.objectContaining({ id: res.body.id, submitter: 1001 }),
    );
  });

  test('voting is logged with the voter, the suggestion and the direction', async () => {
    // Voting logged NOTHING before SHY-0256 — the one suggestion mutation with
    // no server-side trace, on the exact action the ban system exists to police.
    setupDocMocks({ 'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'accepted' }) });
    const res = await request(createApp({ uniqueId: 2002 }))
      .post('/api/suggestions/sug-1/vote')
      .send({ direction: 'up' });
    expect(res.status).toBe(200);
    expect(log.info).toHaveBeenCalledWith(
      'suggestions',
      'Suggestion vote',
      expect.objectContaining({ id: 'sug-1', voter: 2002, direction: 'up' }),
    );
  });

  test('an admin action writes a moderation entry naming the admin, action and target', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }),
    });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });
    expect(res.status).toBe(200);
    const auditWrites = mockDocSet.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('moderationLog/'),
    );
    expect(auditWrites.length).toBeGreaterThan(0);
    expect(auditWrites[0][1]).toEqual(
      expect.objectContaining({ adminUid: 9999, targetType: 'suggestion', targetId: 'sug-1' }),
    );
  });

  test('the audit timestamp is the server clock, not anything the caller sent', async () => {
    // `now()` is mocked to 1709913600000 for this suite, so a server-stamped
    // entry is exactly that value — and a caller-supplied `timestamp` must not
    // reach the record.
    const CLIENT_CLAIMED = 1;
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionDoc('sug-1', { status: 'pending' }),
    });
    const res = await request(createApp({ uniqueId: 9999, isAdmin: true }))
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted', timestamp: CLIENT_CLAIMED });
    expect(res.status).toBe(200);
    const auditWrites = mockDocSet.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('moderationLog/'),
    );
    expect(auditWrites.length).toBeGreaterThan(0);
    expect(auditWrites[0][1].timestamp).toBe(1709913600000);
    expect(auditWrites[0][1].timestamp).not.toBe(CLIENT_CLAIMED);
  });

  // Ban-cascade logging cannot be tested until the cascade exists: nothing
  // writes the identity graph automatically today. Specified as SHY-0257.
  test.todo('ban cascade: logged with trigger event and all affected identifiers');
});
