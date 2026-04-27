/* eslint-disable no-unused-vars */
/**
 * Tests for suggestion duplicate detection, merge, dispute, admin search,
 * and blocked-topic similarity matching.
 *
 * Covers spec sections:
 *   11.3  — Duplicate Detection & Merge
 *   11.59 — Admin Search & Duplicate Highlighting
 *   11.79 — Blocked Topic Similarity Matching
 *
 * Routes under test:
 *   GET    /api/suggestions/search?q=  — duplicate detection during submission
 *   POST   /api/admin/suggestions/:id/merge — merge as duplicate
 *   POST   /api/suggestions/:id/dispute     — dispute a merge
 *   GET    /api/admin/suggestions/disputes   — list pending disputes
 *   PUT    /api/admin/suggestions/disputes/:id — resolve dispute
 *   GET    /api/suggestions/blocked?q=       — blocked topic check
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'new-id' });
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

jest.mock('../../src/utils/roadmap-notify', () => ({
  notifyRoadmapSubscribers: jest.fn().mockResolvedValue(),
}));

// ─── App setup ──────────────────────────────────────────────────

let suggestionsRouter;

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

beforeEach(() => {
  jest.clearAllMocks();
  // AUTO-MOCKRESET-BLOCK: drain mockResolvedValueOnce queues that clearAllMocks does NOT clear.
  // Without this, queued values bleed across tests, causing cross-file flake at scale.
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockCollectionAdd.mockReset();
  mockCollectionGet.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockOffset.mockReset();
  mockStartAfter.mockReset();
  mockRunTransaction.mockReset();
  // Re-apply simple defaults (mockReset wipes them)
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockCollectionAdd.mockResolvedValue({ id: 'new-id' });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
  jest.resetModules();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

  // Re-require router after mocks are set up
  suggestionsRouter = require('../../src/routes/suggestions');
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
      ...overrides,
    }),
  };
}

function makeDisputeDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      suggestionId: 'sug-dup',
      originalSuggestionId: 'sug-original',
      submitterUid: 1001,
      reason: 'These are not duplicates',
      status: 'pending',
      createdAt: 1709913600000,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.3 — Duplicate Detection & Merge
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.59 — Admin Search & Duplicate Highlighting
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.79 — Blocked Topic Similarity Matching
// ═══════════════════════════════════════════════════════════════

describe('GET /api/suggestions/blocked?q= — Blocked topic check', () => {
  test('exact title match blocked', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add cryptocurrency payments',
            rejectReason: 'Against our values',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Add+cryptocurrency+payments')
      .expect(200);

    expect(res.body.blocked).toBe(true);
  });

  test('case-insensitive match blocked', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add Cryptocurrency Payments',
            rejectReason: 'Against our values',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=add+cryptocurrency+payments')
      .expect(200);

    expect(res.body.blocked).toBe(true);
  });

  test('high similarity match blocked (>80%)', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add cryptocurrency payments to the app',
            rejectReason: 'Against our values',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Add+cryptocurrency+payments+to+the+application')
      .expect(200);

    expect(res.body.blocked).toBe(true);
  });

  test('low similarity passes', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add cryptocurrency payments',
            rejectReason: 'Against our values',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Add+dark+mode+to+profile')
      .expect(200);

    expect(res.body.blocked).toBe(false);
  });

  test('returns rejection reason from original', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add cryptocurrency payments',
            rejectReason: 'Against our values and policies',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Add+cryptocurrency+payments')
      .expect(200);

    expect(res.body.blocked).toBe(true);
    expect(res.body).toHaveProperty('rejectReason', 'Against our values and policies');
  });

  test('returns link to original rejected suggestion', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add cryptocurrency payments',
            rejectReason: 'Against our values',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Add+cryptocurrency+payments')
      .expect(200);

    expect(res.body.blocked).toBe(true);
    expect(res.body).toHaveProperty('originalSuggestionId', 'sug-rejected-1');
  });

  test('multiple blocked topics can match, all shown', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add crypto payments',
            rejectReason: 'Against policy',
            originalSuggestionId: 'sug-rejected-1',
          }),
        },
        {
          id: 'bt2',
          data: () => ({
            title: 'Add cryptocurrency wallet',
            rejectReason: 'Not feasible',
            originalSuggestionId: 'sug-rejected-2',
          }),
        },
        {
          id: 'bt3',
          data: () => ({
            title: 'Cryptocurrency integration',
            rejectReason: 'Legal concerns',
            originalSuggestionId: 'sug-rejected-3',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Add+cryptocurrency+payments')
      .expect(200);

    expect(res.body.blocked).toBe(true);
    expect(res.body).toHaveProperty('matches');
    expect(Array.isArray(res.body.matches)).toBe(true);
    expect(res.body.matches.length).toBeGreaterThanOrEqual(2);
    // Each match should include reason and link
    res.body.matches.forEach((match) => {
      expect(match).toHaveProperty('rejectReason');
      expect(match).toHaveProperty('originalSuggestionId');
    });
  });
});
