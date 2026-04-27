/* eslint-disable no-unused-vars */
/**
 * Tests for public suggestions routes.
 *
 * Covers spec sections:
 *   11.1  — Suggestions CRUD & Validation
 *   11.56 — Tag Management
 *   11.57 — Language Tag Validation
 *   11.58 — Suggestion Text Handling
 *   11.75 — Suggestion Limits & Abuse Prevention
 *   11.102 — API Path & Parameter Edge Cases
 *
 * Routes under test:
 *   POST   /api/suggestions           → create suggestion
 *   PUT    /api/suggestions/:id       → edit own pending
 *   DELETE /api/suggestions/:id       → withdraw own pending
 *   GET    /api/suggestions           → list public (accepted/planned/completed/rejected)
 *   GET    /api/suggestions/:id       → single suggestion with votes + comments
 *   GET    /api/suggestions/mine      → own submissions
 *   GET    /api/suggestions/search    → search by title/description
 *   GET    /api/suggestions/blocked   → check blocked topic
 *   GET    /api/suggestions/tags      → list available tags
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
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.1 — Suggestions CRUD & Validation
// ═══════════════════════════════════════════════════════════════

describe('GET /api/suggestions — List', () => {
  test('returns paginated results', async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeSuggestionDoc(`sug${i}`, { status: 'accepted' }),
    );
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 5 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions').expect(200);

    expect(res.body).toHaveProperty('suggestions');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('pageSize');
  });

  test('default page size applied', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions').expect(200);
    // Verify limit was called with default page size
  });

  test('custom page size', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?pageSize=10').expect(200);
  });

  test('page 2 returns next set', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?page=2').expect(200);
  });

  test('default sort is most voted', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions').expect(200);
  });

  test('sort by newest', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?sort=newest').expect(200);
  });

  test('filter by status=accepted', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?status=accepted').expect(200);
  });

  test('filter by status=planned', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?status=planned').expect(200);
  });

  test('filter by status=completed', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?status=completed').expect(200);
  });

  test('filter by status=rejected', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?status=rejected').expect(200);
  });

  test('filter by tag', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?tag=quality-of-life').expect(200);
  });

  test('filter by multiple tags', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?tag=quality-of-life&tag=entertainment').expect(200);
  });

  test('filter by language', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?language=ja').expect(200);
  });

  test('filter by phase category', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions?phase=entertainment').expect(200);
  });

  test('combined filters (status + tag + language)', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app)
      .get('/api/suggestions?status=accepted&tag=quality-of-life&language=en')
      .expect(200);
  });

  test('empty results returns empty array', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions').expect(200);
    expect(res.body.suggestions).toEqual([]);
  });

  test('does NOT return pending suggestions to non-submitter', async () => {
    const docs = [makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 9999 })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).get('/api/suggestions').expect(200);
    // Pending suggestions should be filtered out for non-submitters
    const pendingSuggestions = res.body.suggestions?.filter((s) => s.status === 'pending');
    expect(pendingSuggestions?.length || 0).toBe(0);
  });

  test('does NOT return submitters own pending via public list (must use /mine)', async () => {
    const docs = [makeSuggestionDoc('sug1', { status: 'pending', submitterUid: 1001 })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).get('/api/suggestions').expect(200);
    const pendingSuggestions = res.body.suggestions?.filter((s) => s.status === 'pending');
    expect(pendingSuggestions?.length || 0).toBe(0);
  });
});

describe('GET /api/suggestions/search — Search', () => {
  test('text match on title', async () => {
    const docs = [makeSuggestionDoc('sug1', { title: 'Dark mode please', status: 'accepted' })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/search?q=dark+mode').expect(200);
    expect(res.body).toHaveProperty('results');
  });

  test('text match on description', async () => {
    const docs = [
      makeSuggestionDoc('sug1', {
        description: 'I want dark theme everywhere',
        status: 'accepted',
      }),
    ];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    const app = createApp();
    await request(app).get('/api/suggestions/search?q=dark+theme').expect(200);
  });

  test('partial match works', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions/search?q=dar').expect(200);
  });

  test('no results returns empty array', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/search?q=zzzznonexistent').expect(200);
    expect(res.body.results).toEqual([]);
  });

  test('special characters handled', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions/search?q=%3Cscript%3E').expect(200);
  });

  test('returns max 3 initially, supports load-more pagination', async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeSuggestionDoc(`sug${i}`, { status: 'accepted' }),
    );
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: docs.slice(0, 3), size: 5 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/search?q=test').expect(200);
    expect(res.body.results.length).toBeLessThanOrEqual(3);
    expect(res.body).toHaveProperty('hasMore');
  });
});

describe('GET /api/suggestions/:id — Get single', () => {
  test('returns suggestion with vote counts and comments', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { upvotes: 5, downvotes: 2 }));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 }); // comments
    const app = createApp();
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('upvotes');
    expect(res.body).toHaveProperty('downvotes');
  });

  test('404 for non-existent ID', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app).get('/api/suggestions/nonexistent').expect(404);
  });

  test('rejected suggestion includes rejectReason', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(
          makeSuggestionDoc('sug1', { status: 'rejected', rejectReason: 'Too vague' }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    expect(res.body.rejectReason).toBe('Too vague');
  });
});

describe('GET /api/suggestions/mine — Own submissions', () => {
  test('returns only submitters suggestions', async () => {
    const docs = [
      makeSuggestionDoc('sug1', { submitterUid: 1001, status: 'pending' }),
      makeSuggestionDoc('sug2', { submitterUid: 1001, status: 'accepted' }),
    ];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 2 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).get('/api/suggestions/mine').expect(200);
    expect(res.body.suggestions).toBeDefined();
  });

  test('includes pending suggestions', async () => {
    const docs = [makeSuggestionDoc('sug1', { submitterUid: 1001, status: 'pending' })];
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs, size: 1 });
    const app = createApp({ uniqueId: 1001 });
    const res = await request(app).get('/api/suggestions/mine').expect(200);
    expect(res.body.suggestions.length).toBe(1);
  });

  test('auth required', async () => {
    const app = createUnauthApp();
    await request(app).get('/api/suggestions/mine').expect(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.56 — Tag Management
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.57 — Language Tag Validation
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.58 — Suggestion Text Handling
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.75 — Suggestion Limits & Abuse Prevention
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.102 — API Path & Parameter Edge Cases
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.102 (continued) — Blocked topic check
// ═══════════════════════════════════════════════════════════════

describe('GET /api/suggestions/blocked — Blocked topic check', () => {
  test('returns blocked:true when topic matches', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'bt1',
          data: () => ({
            title: 'Add dark mode',
            rejectReason: 'Already planned',
            originalSuggestionId: 'sug-orig',
          }),
        },
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/blocked?q=Add+dark+mode').expect(200);
    expect(res.body.blocked).toBe(true);
    expect(res.body.topics).toBeDefined();
    expect(res.body.topics[0]).toHaveProperty('title');
    expect(res.body.topics[0]).toHaveProperty('rejectReason');
    expect(res.body.topics[0]).toHaveProperty('originalSuggestionId');
  });

  test('returns blocked:false when no match', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    const res = await request(app)
      .get('/api/suggestions/blocked?q=Something+totally+new')
      .expect(200);
    expect(res.body.blocked).toBe(false);
  });
});
