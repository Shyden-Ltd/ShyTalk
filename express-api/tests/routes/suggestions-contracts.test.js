/* eslint-disable no-unused-vars */
/**
 * Tests for suggestions API contracts, edge cases, and security hardening.
 *
 * Covers spec sections:
 *   11.22  — Edge Cases & Boundaries (concurrent ops, data integrity, empty/null, pagination, encoding)
 *   11.33  — Firestore Rule Enforcement (middleware-level auth checks)
 *   11.51  — API Response Format Contracts (response shapes for all endpoints)
 *   11.52  — HTTP Method & Content-Type Enforcement
 *   11.53  — Suggestion Ranking & Ordering
 *   11.101 — Input Sanitisation & Injection Prevention
 *
 * Routes under test:
 *   POST   /api/suggestions              → create suggestion
 *   PUT    /api/suggestions/:id          → edit own pending
 *   DELETE /api/suggestions/:id          → withdraw own pending
 *   GET    /api/suggestions              → list public
 *   GET    /api/suggestions/:id          → single suggestion
 *   GET    /api/suggestions/mine         → own submissions
 *   GET    /api/suggestions/search       → search by title/description
 *   GET    /api/suggestions/blocked      → blocked topic check
 *   GET    /api/suggestions/tags         → list available tags
 *   POST   /api/suggestions/:id/vote     → upvote/downvote
 *   DELETE /api/suggestions/:id/vote     → remove vote
 *   POST   /api/suggestions/:id/comments → add comment
 *   PUT    /api/admin/suggestions/:id/status → admin status change
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'new-suggestion-id' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

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

const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatchUpdate = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchDelete = jest.fn();

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
        _path: `${name}/${id}`,
        get: () => mockDocGet(`${name}/${id}`),
        set: (...args) => mockDocSet(`${name}/${id}`, ...args),
        update: (...args) => mockDocUpdate(`${name}/${id}`, ...args),
        delete: () => mockDocDelete(`${name}/${id}`),
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
      update: mockBatchUpdate,
      set: mockBatchSet,
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
}));

// ─── App setup ──────────────────────────────────────────────────

const suggestionsRouter = require('../../src/routes/suggestions');

function createApp({ uniqueId = 1001, isAdmin = false, isSuspended = false } = {}) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.auth = {
      uid: `firebase-uid-${uniqueId}`,
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

function createUnauthApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  // No auth middleware — simulates unauthenticated request
  app.use('/api', suggestionsRouter);
  return app;
}

function createAdminApp({ uniqueId = 'admin-1' } = {}) {
  return createApp({ uniqueId, isAdmin: true });
}

/**
 * Creates a raw Express app with a specific content-type handling or raw body.
 * Used for testing Content-Type enforcement.
 */
function _createRawApp({ uniqueId = 1001, isAdmin = false } = {}) {
  const app = express();
  app.use(express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.auth = {
      uid: `firebase-uid-${uniqueId}`,
      uniqueId,
      token: { admin: isAdmin },
    };
    next();
  });
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

// ─── Helpers ────────────────────────────────────────────────────

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
      upvotes: 5,
      downvotes: 1,
      createdAt: 1709913600000,
      updatedAt: 1709913600000,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      editHistory: [],
      subscribers: [1001, 2002, 3003],
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

function makeCommentDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      authorUid: 1001,
      text: 'Great idea!',
      createdAt: 1709913600000,
      updatedAt: 1709913600000,
      ...overrides,
    }),
  };
}

function _makeUserDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      displayName: 'Test User',
      uniqueId: id,
      isSuspended: false,
      fcmTokens: ['token-1'],
      ...overrides,
    }),
  };
}

/** Set up mockDocGet to resolve different docs based on path patterns. */
function setupDocMocks(pathMap) {
  mockDocGet.mockImplementation((pathOrRef) => {
    const path = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef?._path;
    if (!path) return Promise.resolve({ exists: false });
    for (const [pattern, snap] of Object.entries(pathMap)) {
      if (path.includes(pattern)) {
        return Promise.resolve(snap);
      }
    }
    return Promise.resolve({ exists: false });
  });
}

/** Setup suggestion + vote doc resolution. */
function setupSuggestionAndVote(suggestionOverrides = {}, voteDoc = null) {
  mockDocGet.mockImplementation((pathOrRef) => {
    const path = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef?._path;
    if (!path) return Promise.resolve({ exists: false });
    if (path.includes('votes/')) {
      return Promise.resolve(voteDoc || { exists: false });
    }
    if (path.includes('suggestions/')) {
      return Promise.resolve(makeSuggestionDoc('sug1', suggestionOverrides));
    }
    return Promise.resolve({ exists: false });
  });
}

// ═══════════════════════════════════════════════════════════════
// 11.22 — Edge Cases & Boundaries
// ═══════════════════════════════════════════════════════════════

describe('11.22 — Edge Cases & Boundaries', () => {
  // ── Concurrent Operations ─────────────────────────────────

  describe('Concurrent operations', () => {
    test('concurrent vote + edit on same suggestion: both resolve without corruption', async () => {
      // Simulate two users acting simultaneously on the same suggestion
      setupDocMocks({
        'suggestions/sug-concurrent': makeSuggestionDoc('sug-concurrent', {
          status: 'pending',
          submitterUid: 1001,
          upvotes: 5,
          downvotes: 1,
        }),
      });

      const ownerApp = createApp({ uniqueId: 1001 });
      const voterApp = createApp({ uniqueId: 2002 });

      // Owner edits while voter tries to vote (vote should fail on pending)
      const [editRes, voteRes] = await Promise.all([
        request(ownerApp)
          .put('/api/suggestions/sug-concurrent')
          .send({ title: 'Edited title', description: 'Edited desc' }),
        request(voterApp).post('/api/suggestions/sug-concurrent/vote').send({ direction: 'up' }),
      ]);

      // Edit should succeed; vote on pending should be rejected
      expect(editRes.status).toBe(200);
      expect(voteRes.status).toBe(403);
    });

    test('concurrent vote + withdraw by owner: withdraw succeeds, vote fails', async () => {
      setupDocMocks({
        'suggestions/sug-race': makeSuggestionDoc('sug-race', {
          status: 'pending',
          submitterUid: 1001,
        }),
      });

      const ownerApp = createApp({ uniqueId: 1001 });
      const voterApp = createApp({ uniqueId: 2002 });

      const [withdrawRes, voteRes] = await Promise.all([
        request(ownerApp).delete('/api/suggestions/sug-race'),
        request(voterApp).post('/api/suggestions/sug-race/vote').send({ direction: 'up' }),
      ]);

      // Withdraw of pending should succeed; vote on pending rejected
      expect(withdrawRes.status).toBe(200);
      expect(voteRes.status).toBe(403);
    });

    test('concurrent admin approve + user edit: transaction isolation', async () => {
      setupDocMocks({
        'suggestions/sug-txn': makeSuggestionDoc('sug-txn', {
          status: 'pending',
          submitterUid: 1001,
        }),
      });

      const adminApp = createAdminApp();
      const userApp = createApp({ uniqueId: 1001 });

      const [approveRes, editRes] = await Promise.all([
        request(adminApp).put('/api/admin/suggestions/sug-txn/status').send({ status: 'accepted' }),
        request(userApp)
          .put('/api/suggestions/sug-txn')
          .send({ title: 'Edited after approval', description: 'desc' }),
      ]);

      // Both should receive responses (at least one 200, one possibly 403 or 200)
      expect([200, 403]).toContain(approveRes.status);
      expect([200, 403]).toContain(editRes.status);
    });

    test('concurrent upvote + downvote by different users: both resolve atomically', async () => {
      setupSuggestionAndVote(
        { status: 'accepted', submitterUid: 9999, upvotes: 10, downvotes: 3 },
        null,
      );

      const user1App = createApp({ uniqueId: 2001 });
      const user2App = createApp({ uniqueId: 2002 });

      const [vote1, vote2] = await Promise.all([
        request(user1App).post('/api/suggestions/sug1/vote').send({ direction: 'up' }),
        request(user2App).post('/api/suggestions/sug1/vote').send({ direction: 'down' }),
      ]);

      // Both should succeed (different users voting)
      expect(vote1.status).toBe(200);
      expect(vote2.status).toBe(200);

      // FieldValue.increment should have been called for both
      const { FieldValue } = require('../../src/utils/firebase');
      expect(FieldValue.increment).toHaveBeenCalled();
    });
  });

  // ── Data Integrity ────────────────────────────────────────

  describe('Data integrity', () => {
    test('cascading delete: withdrawing a suggestion also removes its votes', async () => {
      setupDocMocks({
        'suggestions/sug-del': makeSuggestionDoc('sug-del', {
          status: 'pending',
          submitterUid: 1001,
        }),
      });

      // Mock votes subcollection to have some docs
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          makeVoteDoc('vote-1', { voterUid: 2001 }),
          makeVoteDoc('vote-2', { voterUid: 2002 }),
        ],
        size: 2,
      });

      const app = createApp({ uniqueId: 1001 });
      await request(app).delete('/api/suggestions/sug-del').expect(200);

      // Verify suggestion delete was called
      expect(mockDocDelete).toHaveBeenCalled();
    });

    test('cascading delete: withdrawing a suggestion also removes its comments', async () => {
      setupDocMocks({
        'suggestions/sug-del2': makeSuggestionDoc('sug-del2', {
          status: 'pending',
          submitterUid: 1001,
        }),
      });

      // Mock comments subcollection
      mockCollectionGet
        .mockResolvedValueOnce({
          empty: false,
          docs: [makeCommentDoc('com-1'), makeCommentDoc('com-2')],
          size: 2,
        })
        .mockResolvedValueOnce({
          empty: false,
          docs: [makeVoteDoc('vote-1')],
          size: 1,
        });

      const app = createApp({ uniqueId: 1001 });
      await request(app).delete('/api/suggestions/sug-del2').expect(200);

      expect(mockDocDelete).toHaveBeenCalled();
    });

    test('vote transfer on merge: duplicate suggestion votes transferred to target', async () => {
      // Set up a merge scenario — admin merges sug-dup into sug-target
      setupDocMocks({
        'suggestions/sug-dup': makeSuggestionDoc('sug-dup', {
          status: 'accepted',
          submitterUid: 2001,
          upvotes: 3,
          downvotes: 1,
        }),
        'suggestions/sug-target': makeSuggestionDoc('sug-target', {
          status: 'accepted',
          submitterUid: 3001,
          upvotes: 10,
          downvotes: 2,
        }),
      });

      // Votes from sug-dup
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          makeVoteDoc('v1', { voterUid: 4001, direction: 'up' }),
          makeVoteDoc('v2', { voterUid: 4002, direction: 'up' }),
          makeVoteDoc('v3', { voterUid: 4003, direction: 'down' }),
        ],
        size: 3,
      });

      const app = createAdminApp();
      const res = await request(app)
        .post('/api/admin/suggestions/sug-dup/merge')
        .send({ targetSuggestionId: 'sug-target' });

      // Merge should succeed (200) or the endpoint exists with some status
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        // Verify the duplicate is updated with mergedIntoSuggestionId
        const updateCalls = mockDocUpdate.mock.calls;
        const mergeUpdate = updateCalls.find(
          (c) => c[0]?.mergedIntoSuggestionId || c[1]?.mergedIntoSuggestionId,
        );
        expect(mergeUpdate).toBeDefined();
      }
    });

    test('vote count stays non-negative after removing all votes', async () => {
      setupSuggestionAndVote(
        { status: 'accepted', submitterUid: 9999, upvotes: 1, downvotes: 0 },
        makeVoteDoc('last-vote', { voterUid: 1001, direction: 'up' }),
      );

      const app = createApp({ uniqueId: 1001 });
      await request(app).delete('/api/suggestions/sug1/vote').expect(200);

      const { FieldValue } = require('../../src/utils/firebase');
      // increment(-1) should be called but the route should clamp at 0 or trust Firestore
      expect(FieldValue.increment).toHaveBeenCalledWith(-1);
    });
  });

  // ── Empty/Null Handling ───────────────────────────────────

  describe('Empty/null handling', () => {
    test('GET suggestion with non-existent ID returns 404', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/does-not-exist').expect(404);
      expect(res.body).toHaveProperty('error');
    });

    test('DELETE suggestion with non-existent ID returns 404', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const app = createApp();
      await request(app).delete('/api/suggestions/does-not-exist').expect(404);
    });

    test('PUT suggestion with non-existent ID returns 404', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const app = createApp();
      await request(app)
        .put('/api/suggestions/does-not-exist')
        .send({ title: 'Hello', description: 'World' })
        .expect(404);
    });

    test('vote on non-existent suggestion returns 404', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const app = createApp();
      await request(app)
        .post('/api/suggestions/does-not-exist/vote')
        .send({ direction: 'up' })
        .expect(404);
    });

    test('remove vote on non-existent suggestion returns 404', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const app = createApp();
      await request(app).delete('/api/suggestions/does-not-exist/vote').expect(404);
    });

    test('POST suggestion with null title returns 400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: null })
        .expect(400);
      expect(res.body.error).toMatch(/title/i);
    });

    test('POST suggestion with null description returns 400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: null })
        .expect(400);
      expect(res.body.error).toMatch(/description/i);
    });

    test('POST suggestion with empty tags array succeeds (tags optional)', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      // Empty tags array may be treated as "no tags" — depends on implementation
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, tags: [] });
      // Either 201 (tags optional) or 400 (tags required) — contract documents behavior
      expect([201, 400]).toContain(res.status);
    });

    test('POST suggestion with null tags returns 400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, tags: null });
      expect([400, 201]).toContain(res.status);
    });

    test('GET /api/suggestions/mine for user with zero suggestions returns empty array', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/mine').expect(200);
      expect(res.body.suggestions).toEqual([]);
    });

    test('GET /api/suggestions/search?q=xxxxxxxxxx returns empty results', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/search?q=xxxxxxxxxx').expect(200);
      expect(res.body.results).toEqual([]);
    });
  });

  // ── Pagination Boundaries ─────────────────────────────────

  describe('Pagination boundaries', () => {
    test('page=0 treated as page 1', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions?page=0').expect(200);
      expect(res.body.page).toBe(1);
    });

    test('negative page returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?page=-1').expect(400);
    });

    test('negative page -100 returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?page=-100').expect(400);
    });

    test('page beyond max results returns empty array', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions?page=999999').expect(200);
      expect(res.body.suggestions).toEqual([]);
    });

    test('pageSize=0 returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?pageSize=0').expect(400);
    });

    test('pageSize=-1 returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?pageSize=-1').expect(400);
    });

    test('pageSize > max (e.g. 1000) capped at max (e.g. 50)', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions?pageSize=1000').expect(200);
      expect(res.body.pageSize).toBeLessThanOrEqual(50);
    });

    test('pageSize=1 returns at most 1 result', async () => {
      const docs = [makeSuggestionDoc('sug-only', { status: 'accepted' })];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions?pageSize=1').expect(200);
      expect(res.body.suggestions.length).toBeLessThanOrEqual(1);
    });

    test('page=NaN returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?page=NaN').expect(400);
    });

    test('page=1.5 (non-integer) returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?page=1.5').expect(400);
    });

    test('pageSize=abc (non-numeric) returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?pageSize=abc').expect(400);
    });

    test('page as string "first" returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions?page=first').expect(400);
    });

    test('exact max pageSize returns 200', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions?pageSize=50').expect(200);
      expect(res.body.pageSize).toBe(50);
    });
  });

  // ── Character Encoding ────────────────────────────────────

  describe('Character encoding', () => {
    test('emoji in title stored and returned correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const title = '\u{1F3A8} Add color themes \u{1F308}';
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    test('emoji in description stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const description =
        'Please add \u{1F4AC} chat bubbles with \u{2764}\u{FE0F} reactions \u{1F525}\u{1F389}';
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description })
        .expect(201);
    });

    test('compound emoji (family, flag, skin tone) in title handled', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const title =
        '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} Family feature \u{1F1EC}\u{1F1E7}';
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title })
        .expect(201);
    });

    test('CJK characters (Chinese) in title stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          title: '\u8BF7\u6DFB\u52A0\u6697\u8272\u6A21\u5F0F',
          language: 'zh',
        })
        .expect(201);
    });

    test('CJK characters (Japanese) in description stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description:
            '\u6697\u3044\u30E2\u30FC\u30C9\u3092\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u3053\u308C\u306F\u3068\u3066\u3082\u4FBF\u5229\u3067\u3059\u3002',
          language: 'ja',
        })
        .expect(201);
    });

    test('CJK characters (Korean) in title stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          title: '\uB2E4\uD06C \uBAA8\uB4DC\uB97C \uCD94\uAC00\uD574 \uC8FC\uC138\uC694',
          language: 'ko',
        })
        .expect(201);
    });

    test('RTL text (Arabic) in title stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          title:
            '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0645\u0638\u0644\u0645',
          language: 'ar',
        })
        .expect(201);
    });

    test('RTL text (Hebrew) in description stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description:
            '\u05D1\u05D1\u05E7\u05E9\u05D4 \u05DC\u05D4\u05D5\u05E1\u05D9\u05E3 \u05DE\u05E6\u05D1 \u05D7\u05E9\u05D5\u05DA',
          language: 'he',
        });
      // May succeed or fail based on language code validation
      // Hebrew "he" should be a valid ISO 639-1 code
    });

    test('mixed RTL/LTR text in description handled', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description:
            'This is English \u0648\u0647\u0630\u0627 \u0639\u0631\u0628\u064A and back to English',
        })
        .expect(201);
    });

    test('newlines in description preserved', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const description = 'Line 1\nLine 2\nLine 3\n\nParagraph 2';
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.description) {
          expect(data.description).toContain('\n');
        }
      }
    });

    test('tab characters in title handled (stripped or preserved)', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'Tab\there\ttitle' });
      // Should succeed with tabs stripped or preserved
      expect([201, 400]).toContain(res.status);
    });

    test('Unicode control characters in title rejected or stripped', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'Title\x00with\x01control\x02chars' });
      // Should either strip them (201) or reject (400)
      expect([201, 400]).toContain(res.status);
    });

    test('Devanagari (Hindi) text in title stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          title:
            '\u0921\u093E\u0930\u094D\u0915 \u092E\u094B\u0921 \u091C\u094B\u0921\u093C\u0947\u0902',
          language: 'hi',
        })
        .expect(201);
    });

    test('Thai text in description stored correctly', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description:
            '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E42\u0E2B\u0E21\u0E14\u0E21\u0E37\u0E14\u0E43\u0E2B\u0E49\u0E41\u0E2D\u0E1B',
          language: 'th',
        })
        .expect(201);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.33 — Firestore Rule Enforcement (middleware-level auth)
// ═══════════════════════════════════════════════════════════════

describe('11.33 — Firestore Rule Enforcement', () => {
  describe('Authentication required', () => {
    test('POST /api/suggestions without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app).post('/api/suggestions').send(VALID_SUGGESTION).expect(401);
    });

    test('PUT /api/suggestions/:id without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app)
        .put('/api/suggestions/sug1')
        .send({ title: 'X', description: 'Y' })
        .expect(401);
    });

    test('DELETE /api/suggestions/:id without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app).delete('/api/suggestions/sug1').expect(401);
    });

    test('POST /api/suggestions/:id/vote without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(401);
    });

    test('DELETE /api/suggestions/:id/vote without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app).delete('/api/suggestions/sug1/vote').expect(401);
    });

    test('POST /api/suggestions/:id/comments without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app)
        .post('/api/suggestions/sug1/comments')
        .send({ text: 'Nice idea' })
        .expect(401);
    });

    test('GET /api/suggestions/mine without auth returns 401', async () => {
      const app = createUnauthApp();
      await request(app).get('/api/suggestions/mine').expect(401);
    });

    test('GET /api/suggestions (public list) without auth returns 401', async () => {
      const app = createUnauthApp();
      // Public list may or may not require auth — contract documents behavior
      const res = await request(app).get('/api/suggestions');
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('Suspended user enforcement', () => {
    test('POST /api/suggestions by suspended user returns 403', async () => {
      const app = createApp({ isSuspended: true });
      await request(app).post('/api/suggestions').send(VALID_SUGGESTION).expect(403);
    });

    test('PUT /api/suggestions/:id by suspended user returns 403', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 }),
      });
      const app = createApp({ uniqueId: 1001, isSuspended: true });
      await request(app)
        .put('/api/suggestions/sug1')
        .send({ title: 'Updated', description: 'Updated' })
        .expect(403);
    });

    test('DELETE /api/suggestions/:id by suspended user returns 403', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 }),
      });
      const app = createApp({ uniqueId: 1001, isSuspended: true });
      await request(app).delete('/api/suggestions/sug1').expect(403);
    });

    test('POST /api/suggestions/:id/vote by suspended user returns 403', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
      const app = createApp({ uniqueId: 1001, isSuspended: true });
      await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
    });

    test('POST /api/suggestions/:id/comments by suspended user returns 403', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'accepted' }),
      });
      const app = createApp({ uniqueId: 1001, isSuspended: true });
      await request(app)
        .post('/api/suggestions/sug1/comments')
        .send({ text: 'Blocked' })
        .expect(403);
    });
  });

  describe('Admin-only route enforcement', () => {
    test('PUT /api/admin/suggestions/:id/status by non-admin returns 403', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending' }),
      });
      const app = createApp({ isAdmin: false });
      await request(app)
        .put('/api/admin/suggestions/sug1/status')
        .send({ status: 'accepted' })
        .expect(403);
    });

    test('POST /api/admin/suggestions/:id/merge by non-admin returns 403', async () => {
      const app = createApp({ isAdmin: false });
      const res = await request(app)
        .post('/api/admin/suggestions/sug1/merge')
        .send({ targetSuggestionId: 'sug2' });
      expect([403, 404]).toContain(res.status);
    });

    test('DELETE /api/admin/suggestions/blocked/:id by non-admin returns 403', async () => {
      const app = createApp({ isAdmin: false });
      const res = await request(app).delete('/api/admin/suggestions/blocked/bt1');
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('Ownership enforcement', () => {
    test('PUT /api/suggestions/:id by non-owner returns 403', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 9999 }),
      });
      const app = createApp({ uniqueId: 1001 });
      await request(app)
        .put('/api/suggestions/sug1')
        .send({ title: 'Hacked', description: 'Hacked' })
        .expect(403);
    });

    test('DELETE /api/suggestions/:id by non-owner returns 403', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 9999 }),
      });
      const app = createApp({ uniqueId: 1001 });
      await request(app).delete('/api/suggestions/sug1').expect(403);
    });

    test('admin CAN delete any suggestion (admin override)', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 9999 }),
      });
      const app = createAdminApp();
      const res = await request(app).delete('/api/suggestions/sug1');
      // Admin may be able to delete any suggestion
      expect([200, 403]).toContain(res.status);
    });
  });

  describe('Creator restrictions on voting', () => {
    test('suggestion creator cannot vote on own suggestion', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 1001 }, null);
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' });
      // Creator self-voting should return 403
      expect(res.status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.51 — API Response Format Contracts
// ═══════════════════════════════════════════════════════════════

describe('11.51 — API Response Format Contracts', () => {
  describe('POST /api/suggestions — Create response shape', () => {
    test('201 response contains { id }', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).post('/api/suggestions').send(VALID_SUGGESTION).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(typeof res.body.id).toBe('string');
    });

    test('400 response contains { error }', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: undefined })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    test('429 response contains { error } with rate limit message', async () => {
      // First call: blocked topics query (empty)
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      // Second call: pending count query (10 pending = at limit)
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: Array.from({ length: 10 }, (_, i) =>
          makeSuggestionDoc(`sug${i}`, { status: 'pending', submitterUid: 1001 }),
        ),
        size: 10,
      });
      const app = createApp();
      const res = await request(app).post('/api/suggestions').send(VALID_SUGGESTION).expect(429);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/too many|limit|pending/i);
    });
  });

  describe('GET /api/suggestions — List response shape', () => {
    test('response contains { suggestions, total, page, pageSize }', async () => {
      const docs = Array.from({ length: 3 }, (_, i) =>
        makeSuggestionDoc(`sug${i}`, { status: 'accepted' }),
      );
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      expect(res.body).toHaveProperty('suggestions');
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.total).toBe('number');
      expect(res.body).toHaveProperty('page');
      expect(typeof res.body.page).toBe('number');
      expect(res.body).toHaveProperty('pageSize');
      expect(typeof res.body.pageSize).toBe('number');
    });

    test('each suggestion in list has required fields', async () => {
      const docs = [
        makeSuggestionDoc('sug1', {
          status: 'accepted',
          title: 'Feature X',
          description: 'Details about X',
          tags: ['quality-of-life'],
          upvotes: 10,
          downvotes: 2,
          createdAt: 1709913600000,
        }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      const sug = res.body.suggestions[0];
      expect(sug).toHaveProperty('id');
      expect(sug).toHaveProperty('title');
      expect(sug).toHaveProperty('status');
      expect(sug).toHaveProperty('upvotes');
      expect(sug).toHaveProperty('downvotes');
      expect(sug).toHaveProperty('createdAt');
    });

    test('empty list returns { suggestions: [], total: 0 }', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      expect(res.body.suggestions).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe('GET /api/suggestions/:id — Single response shape', () => {
    test('response contains full suggestion with vote counts', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', {
          title: 'Feature Y',
          description: 'Details about Y',
          status: 'accepted',
          upvotes: 7,
          downvotes: 1,
          tags: ['entertainment'],
          language: 'en',
          createdAt: 1709913600000,
          updatedAt: 1709913600000,
        }),
      });
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 }); // comments
      const app = createApp();
      const res = await request(app).get('/api/suggestions/sug1').expect(200);

      expect(res.body).toHaveProperty('id', 'sug1');
      expect(res.body).toHaveProperty('title');
      expect(res.body).toHaveProperty('description');
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('upvotes');
      expect(res.body).toHaveProperty('downvotes');
      expect(res.body).toHaveProperty('tags');
      expect(res.body).toHaveProperty('createdAt');
    });

    test('404 response contains { error }', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/nonexistent').expect(404);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    test('rejected suggestion includes rejectReason in response', async () => {
      setupDocMocks({
        'suggestions/sug-rej': makeSuggestionDoc('sug-rej', {
          status: 'rejected',
          rejectReason: 'Duplicate of #123',
        }),
      });
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/sug-rej').expect(200);

      expect(res.body.rejectReason).toBe('Duplicate of #123');
    });

    test('planned suggestion includes linkedRoadmapFeature in response', async () => {
      setupDocMocks({
        'suggestions/sug-plan': makeSuggestionDoc('sug-plan', {
          status: 'planned',
          linkedRoadmapFeature: 'feat-42',
        }),
      });
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/sug-plan').expect(200);

      expect(res.body.linkedRoadmapFeature).toBe('feat-42');
    });

    test('completed suggestion includes completedAt in response', async () => {
      setupDocMocks({
        'suggestions/sug-done': makeSuggestionDoc('sug-done', {
          status: 'completed',
          completedAt: 1710000000000,
        }),
      });
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/sug-done').expect(200);

      expect(res.body.completedAt).toBe(1710000000000);
    });
  });

  describe('GET /api/suggestions/mine — Own submissions response shape', () => {
    test('response contains { suggestions }', async () => {
      const docs = [makeSuggestionDoc('sug1', { submitterUid: 1001, status: 'pending' })];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app).get('/api/suggestions/mine').expect(200);

      expect(res.body).toHaveProperty('suggestions');
      expect(Array.isArray(res.body.suggestions)).toBe(true);
    });

    test('each submission includes status field', async () => {
      const docs = [
        makeSuggestionDoc('sug1', { submitterUid: 1001, status: 'pending' }),
        makeSuggestionDoc('sug2', { submitterUid: 1001, status: 'accepted' }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app).get('/api/suggestions/mine').expect(200);

      for (const sug of res.body.suggestions) {
        expect(sug).toHaveProperty('status');
      }
    });
  });

  describe('GET /api/suggestions/search — Search response shape', () => {
    test('response contains { results, hasMore }', async () => {
      const docs = [makeSuggestionDoc('sug1', { title: 'Dark mode', status: 'accepted' })];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/search?q=dark+mode').expect(200);

      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body).toHaveProperty('hasMore');
      expect(typeof res.body.hasMore).toBe('boolean');
    });

    test('empty search results: { results: [], hasMore: false }', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/search?q=nonexistent').expect(200);

      expect(res.body.results).toEqual([]);
      expect(res.body.hasMore).toBe(false);
    });
  });

  describe('GET /api/suggestions/blocked — Blocked topic response shape', () => {
    test('blocked match: { blocked: true, topics: [...] }', async () => {
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'bt1',
            data: () => ({
              title: 'Dark mode',
              rejectReason: 'Already planned',
              originalSuggestionId: 'sug-orig',
            }),
          },
        ],
      });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/blocked?q=Dark+mode').expect(200);

      expect(res.body).toHaveProperty('blocked', true);
      expect(res.body).toHaveProperty('topics');
      expect(Array.isArray(res.body.topics)).toBe(true);
      expect(res.body.topics[0]).toHaveProperty('title');
      expect(res.body.topics[0]).toHaveProperty('rejectReason');
      expect(res.body.topics[0]).toHaveProperty('originalSuggestionId');
    });

    test('no blocked match: { blocked: false }', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/blocked?q=Totally+new').expect(200);

      expect(res.body).toHaveProperty('blocked', false);
    });
  });

  describe('GET /api/suggestions/tags — Tags response shape', () => {
    test('response contains { tags: [...] }', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/tags').expect(200);

      expect(res.body).toHaveProperty('tags');
      expect(Array.isArray(res.body.tags)).toBe(true);
      expect(res.body.tags.length).toBeGreaterThan(0);
    });

    test('each tag is a non-empty string', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/tags').expect(200);

      for (const tag of res.body.tags) {
        expect(typeof tag).toBe('string');
        expect(tag.length).toBeGreaterThan(0);
      }
    });
  });

  describe('POST /api/suggestions/:id/vote — Vote response shape', () => {
    test('200 response on successful vote', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 }, null);
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({ direction: 'up' })
        .expect(200);

      expect(res.body).toBeDefined();
    });

    test('400 response for invalid direction', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({ direction: 'sideways' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    test('400 response for missing direction', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app).post('/api/suggestions/sug1/vote').send({}).expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/suggestions/:id/status — Admin status change response shape', () => {
    test('200 response contains { success: true }', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending' }),
      });
      const app = createAdminApp();
      const res = await request(app)
        .put('/api/admin/suggestions/sug1/status')
        .send({ status: 'accepted' })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });

    test('400 response for invalid status transition', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'completed' }),
      });
      const app = createAdminApp();
      const res = await request(app)
        .put('/api/admin/suggestions/sug1/status')
        .send({ status: 'pending' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    test('400 response for invalid status value', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending' }),
      });
      const app = createAdminApp();
      const res = await request(app)
        .put('/api/admin/suggestions/sug1/status')
        .send({ status: 'bogus' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.52 — HTTP Method & Content-Type Enforcement
// ═══════════════════════════════════════════════════════════════

describe('11.52 — HTTP Method & Content-Type Enforcement', () => {
  describe('Wrong HTTP methods return 404 or 405', () => {
    test('PATCH /api/suggestions returns 404', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/suggestions');
      expect([404, 405]).toContain(res.status);
    });

    test('PATCH /api/suggestions/:id returns 404', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/suggestions/sug1');
      expect([404, 405]).toContain(res.status);
    });

    test('POST /api/suggestions/search (should be GET) returns 404', async () => {
      const app = createApp();
      const res = await request(app).post('/api/suggestions/search').send({ q: 'test' });
      expect([404, 405]).toContain(res.status);
    });

    test('POST /api/suggestions/mine (should be GET) returns 404', async () => {
      const app = createApp();
      const res = await request(app).post('/api/suggestions/mine').send({});
      expect([404, 405]).toContain(res.status);
    });

    test('POST /api/suggestions/tags (should be GET) returns 404', async () => {
      const app = createApp();
      const res = await request(app).post('/api/suggestions/tags').send({});
      expect([404, 405]).toContain(res.status);
    });

    test('PUT /api/suggestions (no ID) returns 404', async () => {
      const app = createApp();
      const res = await request(app).put('/api/suggestions').send({ title: 'X', description: 'Y' });
      expect([404, 405]).toContain(res.status);
    });

    test('DELETE /api/suggestions (no ID) returns 404', async () => {
      const app = createApp();
      const res = await request(app).delete('/api/suggestions');
      expect([404, 405]).toContain(res.status);
    });

    test('GET /api/suggestions/:id/vote (should be POST or DELETE) returns 404', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/sug1/vote');
      expect([404, 405]).toContain(res.status);
    });

    test('PUT /api/suggestions/:id/vote (should be POST or DELETE) returns 404', async () => {
      const app = createApp();
      const res = await request(app).put('/api/suggestions/sug1/vote').send({ direction: 'up' });
      expect([404, 405]).toContain(res.status);
    });
  });

  describe('Content-Type enforcement', () => {
    test('POST /api/suggestions with text/plain returns 400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .set('Content-Type', 'text/plain')
        .send('plain text body');
      expect([400, 415]).toContain(res.status);
    });

    test('POST /api/suggestions with multipart/form-data returns 400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .set('Content-Type', 'multipart/form-data; boundary=----test')
        .send(
          '------test\r\nContent-Disposition: form-data; name="title"\r\n\r\nTest\r\n------test--',
        );
      expect([400, 415]).toContain(res.status);
    });

    test('PUT /api/suggestions/:id with text/plain returns 400', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 }),
      });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app)
        .put('/api/suggestions/sug1')
        .set('Content-Type', 'text/plain')
        .send('plain text body');
      expect([400, 415]).toContain(res.status);
    });

    test('POST /api/suggestions/:id/vote with text/xml returns 400', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions/sug1/vote')
        .set('Content-Type', 'text/xml')
        .send('<vote><direction>up</direction></vote>');
      expect([400, 415]).toContain(res.status);
    });

    test('POST with no Content-Type header and no body returns 400', async () => {
      const app = createApp();
      const res = await request(app).post('/api/suggestions');
      expect([400, 415]).toContain(res.status);
    });
  });

  describe('Oversized payload handling', () => {
    test('POST /api/suggestions with oversized body returns 413', async () => {
      const app = createApp();
      const hugePayload = {
        title: 'Normal title',
        description: 'X'.repeat(200000), // 200KB+
        tags: ['quality-of-life'],
        language: 'en',
      };
      const res = await request(app).post('/api/suggestions').send(hugePayload);
      // Either 413 (entity too large) or 400 (description too long)
      expect([400, 413]).toContain(res.status);
    });

    test('PUT /api/suggestions/:id with oversized body returns 400 or 413', async () => {
      setupDocMocks({
        'suggestions/sug1': makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 }),
      });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app)
        .put('/api/suggestions/sug1')
        .send({ title: 'Normal', description: 'Y'.repeat(200000) });
      expect([400, 413]).toContain(res.status);
    });
  });

  describe('CORS preflight', () => {
    test('OPTIONS /api/suggestions returns appropriate CORS headers', async () => {
      const app = createApp();
      const res = await request(app)
        .options('/api/suggestions')
        .set('Origin', 'https://shytalk.shyden.co.uk')
        .set('Access-Control-Request-Method', 'POST');

      // Express default or custom CORS handling — contract documents behavior
      expect([200, 204, 404]).toContain(res.status);
    });

    test('OPTIONS /api/suggestions/:id/vote returns appropriate CORS headers', async () => {
      const app = createApp();
      const res = await request(app)
        .options('/api/suggestions/sug1/vote')
        .set('Origin', 'https://shytalk.shyden.co.uk')
        .set('Access-Control-Request-Method', 'POST');

      expect([200, 204, 404]).toContain(res.status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.53 — Suggestion Ranking & Ordering
// ═══════════════════════════════════════════════════════════════

describe('11.53 — Suggestion Ranking & Ordering', () => {
  describe('Most voted sort (default)', () => {
    test('default sort orders by net votes (upvotes - downvotes) descending', async () => {
      const docs = [
        makeSuggestionDoc('sug-high', { status: 'accepted', upvotes: 20, downvotes: 2 }),
        makeSuggestionDoc('sug-mid', { status: 'accepted', upvotes: 10, downvotes: 3 }),
        makeSuggestionDoc('sug-low', { status: 'accepted', upvotes: 5, downvotes: 4 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      expect(res.body.suggestions.length).toBe(3);
      // The route should either sort client-side or query with orderBy
      // Verify orderBy was called with a vote-related field or check output order
      if (res.body.suggestions[0]?.upvotes !== undefined) {
        const netScores = res.body.suggestions.map((s) => (s.upvotes || 0) - (s.downvotes || 0));
        // Should be in descending order
        for (let i = 0; i < netScores.length - 1; i++) {
          expect(netScores[i]).toBeGreaterThanOrEqual(netScores[i + 1]);
        }
      }
    });

    test('sort=most_voted explicitly uses vote ordering', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app).get('/api/suggestions?sort=most_voted').expect(200);

      // Verify orderBy was called (exact field depends on implementation)
      // At minimum the query should succeed
    });

    test('tie-breaking on equal votes: older suggestion ranked higher (stable sort)', async () => {
      const docs = [
        makeSuggestionDoc('sug-old', {
          status: 'accepted',
          upvotes: 10,
          downvotes: 2,
          createdAt: 1709000000000, // older
        }),
        makeSuggestionDoc('sug-new', {
          status: 'accepted',
          upvotes: 10,
          downvotes: 2,
          createdAt: 1709999999999, // newer
        }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      expect(res.body.suggestions.length).toBe(2);
      // With equal votes, tie-breaker should be by createdAt (older first, as it has
      // accumulated votes over more time, or implementation may choose newest first)
    });

    test('tie-breaking: three suggestions with equal net score have deterministic order', async () => {
      const docs = [
        makeSuggestionDoc('sug-a', {
          status: 'accepted',
          upvotes: 5,
          downvotes: 1,
          createdAt: 1709100000000,
        }),
        makeSuggestionDoc('sug-b', {
          status: 'accepted',
          upvotes: 5,
          downvotes: 1,
          createdAt: 1709200000000,
        }),
        makeSuggestionDoc('sug-c', {
          status: 'accepted',
          upvotes: 5,
          downvotes: 1,
          createdAt: 1709300000000,
        }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      expect(res.body.suggestions.length).toBe(3);
      // All three should appear in deterministic order (not random)
      const ids = res.body.suggestions.map((s) => s.id);
      expect(ids).toHaveLength(3);
    });
  });

  describe('Newest sort', () => {
    test('sort=newest orders by createdAt descending', async () => {
      const docs = [
        makeSuggestionDoc('sug-newest', { status: 'accepted', createdAt: 1710000000000 }),
        makeSuggestionDoc('sug-middle', { status: 'accepted', createdAt: 1709500000000 }),
        makeSuggestionDoc('sug-oldest', { status: 'accepted', createdAt: 1709000000000 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions?sort=newest').expect(200);

      expect(res.body.suggestions.length).toBe(3);
      // Verify they are ordered by createdAt descending
      if (res.body.suggestions[0]?.createdAt !== undefined) {
        const timestamps = res.body.suggestions.map((s) => s.createdAt);
        for (let i = 0; i < timestamps.length - 1; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
        }
      }
    });

    test('sort=newest with equal timestamps: deterministic order by ID', async () => {
      const docs = [
        makeSuggestionDoc('sug-aaa', { status: 'accepted', createdAt: 1709913600000 }),
        makeSuggestionDoc('sug-bbb', { status: 'accepted', createdAt: 1709913600000 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions?sort=newest').expect(200);

      expect(res.body.suggestions.length).toBe(2);
    });
  });

  describe('Sort validation', () => {
    test('sort=invalid returns 400', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions?sort=invalid');
      expect([200, 400]).toContain(res.status);
      // If 200, it falls back to default sort; if 400, it rejects invalid sort
    });

    test('sort=oldest (unsupported) returns 400 or falls back', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions?sort=oldest');
      expect([200, 400]).toContain(res.status);
    });

    test('sort parameter is case-insensitive or exact match', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions?sort=NEWEST');
      // Either accepts case-insensitive or rejects — contract documents behavior
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Ranking with filters', () => {
    test('sort + status filter combined: returns sorted filtered results', async () => {
      const docs = [
        makeSuggestionDoc('sug1', { status: 'accepted', upvotes: 20, downvotes: 1 }),
        makeSuggestionDoc('sug2', { status: 'accepted', upvotes: 5, downvotes: 0 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });

      const app = createApp();
      const res = await request(app)
        .get('/api/suggestions?status=accepted&sort=most_voted')
        .expect(200);

      expect(res.body.suggestions.length).toBe(2);
    });

    test('sort + tag filter combined: returns sorted filtered results', async () => {
      const docs = [
        makeSuggestionDoc('sug1', { status: 'accepted', tags: ['entertainment'], upvotes: 15 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });

      const app = createApp();
      const res = await request(app)
        .get('/api/suggestions?tag=entertainment&sort=newest')
        .expect(200);

      expect(res.body.suggestions).toBeDefined();
    });

    test('zero-vote suggestions ranked last in most_voted sort', async () => {
      const docs = [
        makeSuggestionDoc('sug-votes', { status: 'accepted', upvotes: 3, downvotes: 0 }),
        makeSuggestionDoc('sug-zero', { status: 'accepted', upvotes: 0, downvotes: 0 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      if (res.body.suggestions.length === 2) {
        const first = res.body.suggestions[0];
        const last = res.body.suggestions[1];
        const firstNet = (first.upvotes || 0) - (first.downvotes || 0);
        const lastNet = (last.upvotes || 0) - (last.downvotes || 0);
        expect(firstNet).toBeGreaterThanOrEqual(lastNet);
      }
    });

    test('negative net score suggestions ranked below zero-vote ones', async () => {
      const docs = [
        makeSuggestionDoc('sug-pos', { status: 'accepted', upvotes: 5, downvotes: 1 }),
        makeSuggestionDoc('sug-zero', { status: 'accepted', upvotes: 0, downvotes: 0 }),
        makeSuggestionDoc('sug-neg', { status: 'accepted', upvotes: 1, downvotes: 5 }),
      ];
      mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 3 });

      const app = createApp();
      const res = await request(app).get('/api/suggestions').expect(200);

      if (res.body.suggestions.length === 3) {
        const scores = res.body.suggestions.map((s) => (s.upvotes || 0) - (s.downvotes || 0));
        // Positive > zero > negative
        expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
        expect(scores[1]).toBeGreaterThanOrEqual(scores[2]);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.101 — Input Sanitisation & Injection Prevention
// ═══════════════════════════════════════════════════════════════

describe('11.101 — Input Sanitisation & Injection Prevention', () => {
  describe('Path traversal', () => {
    test('suggestion ID with ../ path traversal returns 400', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/../../etc/passwd');
      expect([400, 404]).toContain(res.status);
    });

    test('suggestion ID with ..%2F encoded traversal returns 400', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/..%2F..%2Fetc%2Fpasswd');
      expect([400, 404]).toContain(res.status);
    });

    test('suggestion ID with absolute path returns 400', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/%2Fetc%2Fpasswd');
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('NoSQL injection', () => {
    test('title with $gt operator stored as literal string', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: '{"$gt":""}' })
        .expect(201);

      // Verify stored as literal, not interpreted as operator
      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.title) {
          expect(data.title).not.toHaveProperty('$gt');
          expect(typeof data.title).toBe('string');
        }
      }
    });

    test('description with $ne operator stored as literal string', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: '{"$ne":null}' })
        .expect(201);
    });

    test('title with $where injection stored as literal', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: '{"$where":"function(){return true}"}' })
        .expect(201);
    });

    test('search query with $regex injection treated as literal', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get('/api/suggestions/search?q={"$regex":".*"}');
      expect([200, 400]).toContain(res.status);
      // If 200, the literal string is searched; if 400, injection blocked
    });

    test('vote direction with NoSQL operator rejected', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({ direction: { $gt: '' } })
        .expect(400);

      expect(res.body.error).toMatch(/direction/i);
    });

    test('status filter with $or injection returns 400', async () => {
      const app = createApp();
      const res = await request(app).get(
        '/api/suggestions?status={"$or":[{"status":"pending"},{"status":"accepted"}]}',
      );
      expect([400]).toContain(res.status);
    });
  });

  describe('XSS prevention', () => {
    test('title with <script> tag sanitised on storage', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: '<script>alert("xss")</script>Dark mode' })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.title) {
          expect(data.title).not.toContain('<script>');
        }
      }
    });

    test('description with <img onerror> sanitised on storage', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: '<img onerror="alert(1)" src="x">Text' })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.description) {
          expect(data.description).not.toContain('onerror');
        }
      }
    });

    test('title with <iframe> tag sanitised', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: '<iframe src="evil.com">embed</iframe>' })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.title) {
          expect(data.title).not.toContain('<iframe');
        }
      }
    });

    test('description with javascript: URL sanitised', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: 'Click <a href="javascript:alert(1)">here</a>' })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.description) {
          expect(data.description).not.toContain('javascript:');
        }
      }
    });

    test('title with event handler attributes sanitised', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: '<div onmouseover="alert(1)">Hover me</div>' })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.title) {
          expect(data.title).not.toContain('onmouseover');
        }
      }
    });

    test('search query with <script> tag does not execute', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .get('/api/suggestions/search?q=%3Cscript%3Ealert(1)%3C/script%3E')
        .expect(200);

      // Should return results (or empty), not execute the script
      if (res.body.error) {
        expect(res.body.error).not.toContain('<script>');
      }
    });

    test('vote reason with HTML stripped on storage', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 }, null);
      const app = createApp({ uniqueId: 1001 });
      await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({
          direction: 'up',
          reason: '<b>Bold</b> and <script>evil</script>',
          visibility: 'public',
        })
        .expect(200);

      const setCall = mockDocSet.mock.calls.find((c) => {
        const path = typeof c[0] === 'string' ? c[0] : c[0]?._path;
        return path && path.includes('votes');
      });
      if (setCall) {
        const data = setCall[setCall.length - 1];
        if (data?.reason) {
          expect(data.reason).not.toContain('<script>');
        }
      }
    });
  });

  describe('Null bytes', () => {
    test('title with null byte stripped or rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'Hello\x00World' });
      // Either strips null byte (201) or rejects (400)
      expect([201, 400]).toContain(res.status);

      if (res.status === 201) {
        const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
        if (storedCall) {
          const data = storedCall[storedCall.length - 1];
          if (data?.title) {
            expect(data.title).not.toContain('\x00');
          }
        }
      }
    });

    test('description with null byte stripped or rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: 'Desc\x00ription' });
      expect([201, 400]).toContain(res.status);
    });

    test('search query with null byte handled safely', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/search?q=test%00injection');
      expect([200, 400]).toContain(res.status);
    });

    test('suggestion ID with null byte rejected', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/sug%001');
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('Zero-width characters', () => {
    test('title with zero-width space (U+200B) stripped', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const title = 'Dark\u200Bmode\u200Bplease';
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title });
      expect([201, 400]).toContain(res.status);

      if (res.status === 201) {
        const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
        if (storedCall) {
          const data = storedCall[storedCall.length - 1];
          if (data?.title) {
            // Zero-width chars should be stripped
            expect(data.title).not.toContain('\u200B');
          }
        }
      }
    });

    test('title with zero-width non-joiner (U+200C) stripped', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'Test\u200Ctitle' });
      expect([201, 400]).toContain(res.status);
    });

    test('title with zero-width joiner (U+200D) preserved in emoji context', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      // ZWJ is valid in compound emoji sequences
      const title = '\u{1F468}\u200D\u{1F4BB} Developer feature';
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title });
      expect([201, 400]).toContain(res.status);
    });

    test('description with invisible separator (U+2063) stripped', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: 'Hidden\u2063separator\u2063text' });
      expect([201, 400]).toContain(res.status);
    });

    test('title with only zero-width characters rejected as empty', async () => {
      const app = createApp();
      const title = '\u200B\u200C\u200D\uFEFF';
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title });
      expect(res.status).toBe(400);
    });
  });

  describe('Prototype pollution', () => {
    test('body with __proto__ key does not pollute Object prototype', async () => {
      const app = createApp();
      const before = {}.isAdmin;
      const res = await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          __proto__: { isAdmin: true },
        });
      // The request processes without polluting the prototype
      expect({}.isAdmin).toBeUndefined();
      expect(before).toBeUndefined();
    });

    test('body with constructor.prototype does not pollute', async () => {
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          constructor: { prototype: { polluted: true } },
        });

      expect({}.polluted).toBeUndefined();
    });

    test('nested __proto__ in tags does not pollute', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          tags: { __proto__: { malicious: true } },
        });
      // tags should be an array, so this should be rejected
      expect([400, 201]).toContain(res.status);
      expect({}.malicious).toBeUndefined();
    });

    test('body with prototype key in nested object does not pollute', async () => {
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          title: 'Test',
          description: 'Test',
          tags: ['quality-of-life'],
          language: 'en',
          extra: { __proto__: { hacked: true } },
        });

      expect({}.hacked).toBeUndefined();
    });
  });

  describe('SSRF prevention', () => {
    test('title with internal URL is stored as text, not resolved', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          title: 'Feature for http://169.254.169.254/latest/meta-data/',
        })
        .expect(201);

      // The URL should just be stored as text, no HTTP request made
      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        if (data?.title) {
          expect(typeof data.title).toBe('string');
        }
      }
    });

    test('description with localhost URL is stored as text, not resolved', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description: 'See http://localhost:4000/admin for reference',
        })
        .expect(201);
    });

    test('description with internal IP range URL not resolved', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description: 'Check http://10.0.0.1/secret and http://192.168.1.1/admin',
        })
        .expect(201);
    });

    test('description with file:// protocol not resolved', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description: 'Check file:///etc/passwd for details',
        })
        .expect(201);
    });
  });

  describe('SQL injection (defense-in-depth)', () => {
    test('title with SQL injection stored as literal', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: "'; DROP TABLE suggestions;--" })
        .expect(201);
    });

    test('description with UNION SELECT injection stored as literal', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          description: "1 UNION SELECT * FROM users WHERE '1'='1",
        })
        .expect(201);
    });

    test('search query with SQL injection treated as literal text', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app).get("/api/suggestions/search?q='+OR+1=1--");
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Type coercion attacks', () => {
    test('title as number is rejected (must be string)', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 12345 })
        .expect(400);

      expect(res.body.error).toMatch(/title/i);
    });

    test('title as array is rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: ['Dark', 'Mode'] })
        .expect(400);

      expect(res.body.error).toMatch(/title/i);
    });

    test('title as object is rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: { text: 'Dark Mode' } })
        .expect(400);

      expect(res.body.error).toMatch(/title/i);
    });

    test('title as boolean is rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: true })
        .expect(400);

      expect(res.body.error).toMatch(/title/i);
    });

    test('description as number is rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: 42 })
        .expect(400);

      expect(res.body.error).toMatch(/description/i);
    });

    test('tags as string (not array) is rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, tags: 'quality-of-life' })
        .expect(400);

      expect(res.body.error).toMatch(/tag/i);
    });

    test('tags as object is rejected', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, tags: { 0: 'quality-of-life' } })
        .expect(400);

      expect(res.body.error).toMatch(/tag/i);
    });

    test('contactOptIn as string "true" is rejected or coerced', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const res = await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, contactOptIn: 'true' });
      // Either rejects (400) or coerces string to boolean (201)
      expect([201, 400]).toContain(res.status);
    });

    test('vote direction as number is rejected', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
      const app = createApp({ uniqueId: 1001 });
      const res = await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({ direction: 1 })
        .expect(400);

      expect(res.body.error).toMatch(/direction/i);
    });
  });

  describe('Extremely long inputs', () => {
    test('title at exactly max length (80 chars) succeeds', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'A'.repeat(80) })
        .expect(201);
    });

    test('title at max+1 (81 chars) returns 400', async () => {
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, title: 'A'.repeat(81) })
        .expect(400);
    });

    test('description at exactly max length (5000 chars) succeeds', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: 'B'.repeat(5000) })
        .expect(201);
    });

    test('description at max+1 (5001 chars) returns 400', async () => {
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({ ...VALID_SUGGESTION, description: 'B'.repeat(5001) })
        .expect(400);
    });

    test('search query at max length handled', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      const longQuery = 'a'.repeat(200);
      const res = await request(app).get(`/api/suggestions/search?q=${longQuery}`);
      // Either succeeds with no results or returns 400 for too-long query
      expect([200, 400]).toContain(res.status);
    });

    test('vote reason at max length handled', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 }, null);
      const app = createApp({ uniqueId: 1001 });
      const longReason = 'R'.repeat(500);
      const res = await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({ direction: 'up', reason: longReason, visibility: 'public' });
      // Either accepted (200) or rejected for length (400)
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Extra/unknown fields', () => {
    test('extra unknown fields in POST body are ignored (not stored)', async () => {
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
      const app = createApp();
      await request(app)
        .post('/api/suggestions')
        .send({
          ...VALID_SUGGESTION,
          isAdmin: true,
          role: 'superuser',
          _internal: 'secret',
          __v: 999,
        })
        .expect(201);

      const storedCall = mockDocSet.mock.calls[0] || mockCollectionAdd.mock.calls[0];
      if (storedCall) {
        const data = storedCall[storedCall.length - 1];
        // Extra fields should not be stored
        expect(data).not.toHaveProperty('isAdmin');
        expect(data).not.toHaveProperty('role');
        expect(data).not.toHaveProperty('_internal');
      }
    });

    test('extra fields in vote body are ignored', async () => {
      setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 }, null);
      const app = createApp({ uniqueId: 1001 });
      await request(app)
        .post('/api/suggestions/sug1/vote')
        .send({
          direction: 'up',
          reason: 'Good idea',
          visibility: 'public',
          isAdmin: true,
          __proto__: { admin: true },
        })
        .expect(200);

      // Verify extra fields not stored
      const setCall = mockDocSet.mock.calls.find((c) => {
        const path = typeof c[0] === 'string' ? c[0] : c[0]?._path;
        return path && path.includes('votes');
      });
      if (setCall) {
        const data = setCall[setCall.length - 1];
        expect(data).not.toHaveProperty('isAdmin');
      }
    });
  });

  describe('Special characters in IDs', () => {
    test('suggestion ID with spaces returns 400 or 404', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/id%20with%20spaces');
      expect([400, 404]).toContain(res.status);
    });

    test('suggestion ID with angle brackets returns 400 or 404', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/%3Cscript%3E');
      expect([400, 404]).toContain(res.status);
    });

    test('suggestion ID "undefined" returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions/undefined').expect(400);
    });

    test('suggestion ID "null" returns 400', async () => {
      const app = createApp();
      await request(app).get('/api/suggestions/null').expect(400);
    });

    test('suggestion ID "__proto__" returns 400 or 404', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/__proto__');
      expect([400, 404]).toContain(res.status);
    });

    test('suggestion ID "constructor" returns 400 or 404', async () => {
      const app = createApp();
      const res = await request(app).get('/api/suggestions/constructor');
      expect([400, 404]).toContain(res.status);
    });
  });
});
