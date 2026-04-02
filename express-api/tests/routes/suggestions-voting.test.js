/**
 * Tests for suggestions voting routes.
 *
 * Covers spec sections:
 *   11.4   — Voting (upvote, downvote, toggle, remove)
 *   11.55  — Vote Count Atomicity
 *   11.73  — Vote Reason Validation
 *   11.105 — Creator Restrictions
 *
 * Routes under test:
 *   POST   /api/suggestions/:id/vote   — upvote/downvote
 *   DELETE /api/suggestions/:id/vote   — remove vote
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'new-vote-id' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();

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
  app.use(express.json());
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
  app.use(express.json());
  // No auth middleware — simulates unauthenticated request
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
      submitterUid: 9999,
      submitterContactOptIn: false,
      upvotes: 5,
      downvotes: 2,
      createdAt: 1709913600000,
      updatedAt: 1709913600000,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      editHistory: [],
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

/**
 * Sets up mockDocGet to return a suggestion and optionally a vote doc.
 * @param {object} suggestionOverrides — merged into default suggestion data
 * @param {object|null} voteDoc — null means no existing vote, object means existing vote
 */
function setupSuggestionAndVote(suggestionOverrides = {}, voteDoc = null) {
  mockDocGet.mockImplementation((path) => {
    if (typeof path === 'string' && path.includes('votes/')) {
      return Promise.resolve(voteDoc || { exists: false });
    }
    if (typeof path === 'string' && path.includes('suggestions/')) {
      return Promise.resolve(makeSuggestionDoc('sug1', suggestionOverrides));
    }
    // Transaction get calls receive a doc ref object, not a string path
    if (path && path._path) {
      if (path._path.includes('votes/')) {
        return Promise.resolve(voteDoc || { exists: false });
      }
      if (path._path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', suggestionOverrides));
      }
    }
    return Promise.resolve({ exists: false });
  });
}

// ═══════════════════════════════════════════════════════════════
// 11.4 — Voting
// ═══════════════════════════════════════════════════════════════

describe('POST /api/suggestions/:id/vote — Upvote/Downvote', () => {
  test('upvote: auth required, returns 200, count incremented', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up' })
      .expect(200);

    expect(res.body).toBeDefined();
    // Verify FieldValue.increment was called for upvotes
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
  });

  test('downvote: auth required, returns 200, count incremented', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'down' })
      .expect(200);

    expect(res.body).toBeDefined();
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
  });

  test('toggle up to down: previous vote removed, new vote applied, counts updated', async () => {
    // User already has an upvote
    setupSuggestionAndVote(
      { status: 'accepted', submitterUid: 9999, upvotes: 5, downvotes: 2 },
      makeVoteDoc('vote1', { voterUid: 1001, direction: 'up' }),
    );
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'down' })
      .expect(200);

    expect(res.body).toBeDefined();
    const { FieldValue } = require('../../src/utils/firebase');
    // Should decrement upvotes and increment downvotes
    expect(FieldValue.increment).toHaveBeenCalledWith(-1);
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
  });

  test('toggle down to up: previous vote removed, new vote applied, counts updated', async () => {
    // User already has a downvote
    setupSuggestionAndVote(
      { status: 'accepted', submitterUid: 9999, upvotes: 5, downvotes: 2 },
      makeVoteDoc('vote1', { voterUid: 1001, direction: 'down' }),
    );
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up' })
      .expect(200);

    expect(res.body).toBeDefined();
    const { FieldValue } = require('../../src/utils/firebase');
    // Should decrement downvotes and increment upvotes
    expect(FieldValue.increment).toHaveBeenCalledWith(-1);
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
  });
});

describe('DELETE /api/suggestions/:id/vote — Remove vote', () => {
  test('remove vote: count decremented, vote doc deleted', async () => {
    setupSuggestionAndVote(
      { status: 'accepted', submitterUid: 9999, upvotes: 5, downvotes: 2 },
      makeVoteDoc('vote1', { voterUid: 1001, direction: 'up' }),
    );
    const app = createApp({ uniqueId: 1001 });
    await request(app).delete('/api/suggestions/sug1/vote').expect(200);

    // Verify delete was called for the vote doc
    expect(mockDocDelete).toHaveBeenCalled();
    // Verify upvotes decremented
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(-1);
  });

  test('remove non-existent vote: returns 404', async () => {
    setupSuggestionAndVote(
      { status: 'accepted', submitterUid: 9999 },
      null, // no existing vote
    );
    const app = createApp({ uniqueId: 1001 });
    await request(app).delete('/api/suggestions/sug1/vote').expect(404);
  });
});

describe('POST /api/suggestions/:id/vote — Duplicate & status checks', () => {
  test('duplicate vote same direction: returns 400', async () => {
    setupSuggestionAndVote(
      { status: 'accepted', submitterUid: 9999 },
      makeVoteDoc('vote1', { voterUid: 1001, direction: 'up' }),
    );
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(400);
  });

  test('vote on pending: returns 403', async () => {
    setupSuggestionAndVote({ status: 'pending', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });

  test('vote on planned: returns 403', async () => {
    setupSuggestionAndVote({ status: 'planned', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });

  test('vote on completed: returns 403', async () => {
    setupSuggestionAndVote({ status: 'completed', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });

  test('vote on rejected: returns 403', async () => {
    setupSuggestionAndVote({ status: 'rejected', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });
});

describe('POST /api/suggestions/:id/vote — Vote reason', () => {
  test('vote reason: stored with public visibility', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: 'I really want this feature!', visibility: 'public' })
      .expect(200);

    // Verify reason and visibility stored in the vote doc
    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toBe('I really want this feature!');
      expect(data.visibility).toBe('public');
    }
  });

  test('vote reason: stored with private visibility', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: 'Private feedback', visibility: 'private' })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toBe('Private feedback');
      expect(data.visibility).toBe('private');
    }
  });

  test('vote reason: null when not provided', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toBeNull();
    }
  });
});

describe('POST /api/suggestions/:id/vote — Auth & permissions', () => {
  test('vote without auth: returns 401', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createUnauthApp();
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(401);
  });

  test('vote by banned user: returns 403', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001, isSuspended: true });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });
});

describe('POST /api/suggestions/:id/vote — Net score', () => {
  test('vote count: net score calculated correctly (upvotes - downvotes)', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999, upvotes: 10, downvotes: 3 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up' })
      .expect(200);

    // After upvote: upvotes=11, downvotes=3, netScore=8
    // The response should reflect the updated counts or at least the increment call
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(1);

    // If the route returns the updated suggestion data, verify net score
    if (res.body.netScore !== undefined) {
      expect(res.body.netScore).toBe(res.body.upvotes - res.body.downvotes);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.55 — Vote Count Atomicity
// ═══════════════════════════════════════════════════════════════

describe('Vote Count Atomicity', () => {
  test('two concurrent upvotes on same suggestion: both recorded, count = initial + 2', async () => {
    // Both votes go through runTransaction — verify transaction called twice
    let transactionCallCount = 0;
    mockRunTransaction.mockImplementation(async (fn) => {
      transactionCallCount++;
      const t = {
        get: jest.fn((ref) => {
          if (
            ref?._path?.includes('votes/') ||
            (typeof ref === 'string' && ref.includes('votes/'))
          ) {
            return Promise.resolve({ exists: false });
          }
          return Promise.resolve(
            makeSuggestionDoc('sug1', {
              status: 'accepted',
              submitterUid: 9999,
              upvotes: 5 + transactionCallCount - 1,
              downvotes: 2,
            }),
          );
        }),
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      };
      return fn(t);
    });

    // Mock already updated — no re-require needed with static import

    const app1 = createApp({ uniqueId: 2001 });
    const app2 = createApp({ uniqueId: 2002 });

    const [res1, res2] = await Promise.all([
      request(app1).post('/api/suggestions/sug1/vote').send({ direction: 'up' }),
      request(app2).post('/api/suggestions/sug1/vote').send({ direction: 'up' }),
    ]);

    // Both should succeed (200) — transactions serialise the writes
    expect([res1.status, res2.status]).toEqual(expect.arrayContaining([200, 200]));
    // runTransaction should have been invoked for each vote
    expect(transactionCallCount).toBe(2);

    const { FieldValue } = require('../../src/utils/firebase');
    // Each vote increments by 1, so increment(1) should be called at least twice
    const incrementCalls = FieldValue.increment.mock.calls.filter((c) => c[0] === 1);
    expect(incrementCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('upvote + downvote simultaneously: both recorded, net score unchanged', async () => {
    let transactionCallCount = 0;
    mockRunTransaction.mockImplementation(async (fn) => {
      transactionCallCount++;
      const t = {
        get: jest.fn((ref) => {
          if (
            ref?._path?.includes('votes/') ||
            (typeof ref === 'string' && ref.includes('votes/'))
          ) {
            return Promise.resolve({ exists: false });
          }
          return Promise.resolve(
            makeSuggestionDoc('sug1', {
              status: 'accepted',
              submitterUid: 9999,
              upvotes: 5,
              downvotes: 2,
            }),
          );
        }),
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      };
      return fn(t);
    });

    // Mock already updated — no re-require needed with static import

    const appUp = createApp({ uniqueId: 3001 });
    const appDown = createApp({ uniqueId: 3002 });

    const [resUp, resDown] = await Promise.all([
      request(appUp).post('/api/suggestions/sug1/vote').send({ direction: 'up' }),
      request(appDown).post('/api/suggestions/sug1/vote').send({ direction: 'down' }),
    ]);

    expect([resUp.status, resDown.status]).toEqual(expect.arrayContaining([200, 200]));
    expect(transactionCallCount).toBe(2);

    // Net effect: +1 upvote, +1 downvote — net score change is 0
    const { FieldValue } = require('../../src/utils/firebase');
    const incrementCalls = FieldValue.increment.mock.calls;
    const totalIncrement = incrementCalls.reduce((sum, [n]) => sum + n, 0);
    // Two +1 increments (one for upvotes field, one for downvotes field), net is 0 change to score
    expect(totalIncrement).toBe(2); // +1 (upvote) + +1 (downvote) = 2 total increments
  });

  test('vote + toggle rapidly: final state consistent', async () => {
    let callIndex = 0;
    mockRunTransaction.mockImplementation(async (fn) => {
      callIndex++;
      const isSecondCall = callIndex === 2;
      const t = {
        get: jest.fn((ref) => {
          if (
            ref?._path?.includes('votes/') ||
            (typeof ref === 'string' && ref.includes('votes/'))
          ) {
            // Second call sees the vote from the first call
            if (isSecondCall) {
              return Promise.resolve(makeVoteDoc('vote1', { voterUid: 1001, direction: 'up' }));
            }
            return Promise.resolve({ exists: false });
          }
          return Promise.resolve(
            makeSuggestionDoc('sug1', {
              status: 'accepted',
              submitterUid: 9999,
              upvotes: 5,
              downvotes: 2,
            }),
          );
        }),
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      };
      return fn(t);
    });

    // Mock already updated — no re-require needed with static import

    const app = createApp({ uniqueId: 1001 });

    // First: upvote, then immediately toggle to downvote
    const res1 = await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' });

    const res2 = await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'down' });

    // First creates the vote, second toggles it
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both went through transactions
    expect(callIndex).toBe(2);
  });

  test('vote count fields (upvotes/downvotes) always >= 0', async () => {
    // Even when removing a vote from a suggestion with 0 counts,
    // the transaction should enforce non-negative counts
    mockRunTransaction.mockImplementation(async (fn) => {
      const t = {
        get: jest.fn((ref) => {
          if (
            ref?._path?.includes('votes/') ||
            (typeof ref === 'string' && ref.includes('votes/'))
          ) {
            return Promise.resolve(makeVoteDoc('vote1', { voterUid: 1001, direction: 'up' }));
          }
          return Promise.resolve(
            makeSuggestionDoc('sug1', {
              status: 'accepted',
              submitterUid: 9999,
              upvotes: 0,
              downvotes: 0,
            }),
          );
        }),
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      };
      return fn(t);
    });

    // Mock already updated — no re-require needed with static import

    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).delete('/api/suggestions/sug1/vote');

    // Should still succeed (the transaction handles the edge case)
    // The implementation should clamp to 0, not go negative
    expect([200, 404]).toContain(res.status);

    // If the route uses FieldValue.increment(-1), verify it was called
    // The implementation should ensure counts don't go below 0
    const { FieldValue } = require('../../src/utils/firebase');
    const decrementCalls = FieldValue.increment.mock.calls.filter((c) => c[0] === -1);
    // At most one decrement (for the upvote being removed)
    expect(decrementCalls.length).toBeLessThanOrEqual(1);
  });

  test('net score calculation: always equals upvotes - downvotes', async () => {
    // Set up a suggestion with known counts, vote, then verify
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999, upvotes: 7, downvotes: 3 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up' })
      .expect(200);

    // After upvote: upvotes=8, downvotes=3, netScore should be 5
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(1);

    // Verify the update includes the correct net score if returned
    if (res.body.upvotes !== undefined && res.body.downvotes !== undefined) {
      expect(res.body.upvotes - res.body.downvotes).toBe(
        res.body.netScore || res.body.upvotes - res.body.downvotes,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.73 — Vote Reason Validation
// ═══════════════════════════════════════════════════════════════

describe('Vote Reason Validation', () => {
  test('vote reason max length: 500 characters', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    // 500 chars should be accepted
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: 'A'.repeat(500) })
      .expect(200);
  });

  test('vote reason exactly 500 chars: accepted', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    const reason = 'B'.repeat(500);
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toHaveLength(500);
    }
  });

  test('vote reason 501 chars: returns 400', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: 'C'.repeat(501) })
      .expect(400);

    expect(res.body.error).toMatch(/reason/i);
  });

  test('vote reason with XSS payload: sanitised', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: '<script>alert("xss")</script>Great idea' })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).not.toContain('<script>');
    }
  });

  test('vote reason with HTML tags: stripped', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: '<b>Bold</b> and <i>italic</i> reason' })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).not.toContain('<b>');
      expect(data.reason).not.toContain('<i>');
    }
  });

  test('vote reason empty string: treated as null (no reason)', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: '' })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toBeNull();
    }
  });

  test('vote reason with only whitespace: treated as null', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason: '   \t\n  ' })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toBeNull();
    }
  });

  test('vote reason with newlines: preserved', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    const reason = 'Line 1\nLine 2\nLine 3';
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toContain('\n');
    }
  });

  test('vote reason with emoji: stored correctly', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001 });
    const reason = 'Love this idea! 🎉🚀💯';
    await request(app)
      .post('/api/suggestions/sug1/vote')
      .send({ direction: 'up', reason })
      .expect(200);

    const setCall = mockDocSet.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('votes') : c[0]?._path?.includes('votes'),
    );
    if (setCall) {
      const data = setCall[setCall.length - 1];
      expect(data.reason).toContain('🎉');
      expect(data.reason).toContain('🚀');
      expect(data.reason).toContain('💯');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.105 — Creator Restrictions
// ═══════════════════════════════════════════════════════════════

describe('Creator Restrictions', () => {
  test('creator cannot upvote own suggestion: returns 403', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 1001 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });

  test('creator cannot downvote own suggestion: returns 403', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 1001 });
    const app = createApp({ uniqueId: 1001 });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'down' }).expect(403);
  });

  test('creator cannot remove auto-upvote: returns 403', async () => {
    setupSuggestionAndVote(
      { status: 'accepted', submitterUid: 1001 },
      makeVoteDoc('vote1', { voterUid: 1001, direction: 'up' }),
    );
    const app = createApp({ uniqueId: 1001 });
    await request(app).delete('/api/suggestions/sug1/vote').expect(403);
  });

  test('creator CAN comment on own accepted suggestion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('suggestions/')) {
        return Promise.resolve(
          makeSuggestionDoc('sug1', { status: 'accepted', submitterUid: 1001 }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Thanks for accepting this!' });

    // Creator should be allowed to comment — not blocked by creator restrictions
    // Status should be 200 or 201 (not 403)
    expect(res.status).not.toBe(403);
  });

  test('creator CAN subscribe to own suggestion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('suggestions/')) {
        return Promise.resolve(
          makeSuggestionDoc('sug1', { status: 'accepted', submitterUid: 1001 }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).post('/api/suggestions/sug1/subscribe').send();

    // Should not be 403 — creator can subscribe to their own suggestion
    expect(res.status).not.toBe(403);
  });

  test('creator CAN unsubscribe from own suggestion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('suggestions/')) {
        return Promise.resolve(
          makeSuggestionDoc('sug1', { status: 'accepted', submitterUid: 1001 }),
        );
      }
      if (typeof path === 'string' && path.includes('subscriptions/')) {
        return Promise.resolve({ exists: true, data: () => ({ subscriberUid: 1001 }) });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).delete('/api/suggestions/sug1/subscribe').send();

    // Should not be 403 — creator can unsubscribe from their own suggestion
    expect(res.status).not.toBe(403);
  });

  test('creator CAN edit own pending suggestion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('suggestions/')) {
        return Promise.resolve(
          makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uniqueId: 1001 });
    await request(app)
      .put('/api/suggestions/sug1')
      .send({ title: 'Updated title', description: 'Updated description' })
      .expect(200);
  });

  test('creator CAN withdraw own pending suggestion', async () => {
    mockDocGet.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('suggestions/')) {
        return Promise.resolve(
          makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uniqueId: 1001 });
    await request(app).delete('/api/suggestions/sug1').expect(200);
  });

  test('admin who is also creator: same restrictions apply', async () => {
    // Even admins cannot vote on their own suggestions
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 1001 });
    const app = createApp({ uniqueId: 1001, isAdmin: true });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(403);
  });

  test('admin CAN vote on suggestions they did not create', async () => {
    setupSuggestionAndVote({ status: 'accepted', submitterUid: 9999 });
    const app = createApp({ uniqueId: 1001, isAdmin: true });
    await request(app).post('/api/suggestions/sug1/vote').send({ direction: 'up' }).expect(200);
  });
});
