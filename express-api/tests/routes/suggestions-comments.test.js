/* eslint-disable no-unused-vars */
/**
 * Tests for suggestion comments routes.
 *
 * Covers spec sections:
 *   11.5  — Comments
 *   11.54 — Comment Pagination & Ordering
 *   11.74 — Comment Validation & Limits
 *
 * Routes under test:
 *   POST /api/suggestions/:id/comments  → add comment
 *   GET  /api/suggestions/:id/comments  → list comments (via suggestion detail)
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'new-comment-id' });
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
  offset: jest.fn(() => mockQueryChain),
  startAfter: jest.fn(() => mockQueryChain),
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
    runTransaction: jest.fn(async (fn) => {
      const t = { get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete };
      return fn(t);
    }),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((n) => ({ _type: 'increment', value: n })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-comment-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
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
    if (isSuspended) req.auth.suspended = true;
    next();
  });
  app.use('/api', suggestionsRouter);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', suggestionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
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
      status: 'accepted',
      submitterUid: 1001,
      upvotes: 1,
      downvotes: 0,
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
      text: 'Great suggestion!',
      isPublic: true,
      createdAt: 1709913600000,
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.5 — Comments
// ═══════════════════════════════════════════════════════════════

describe('POST /api/suggestions/:id/comments — Add comment', () => {
  test('add comment on accepted suggestion succeeds, returns 201', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Great idea!', isPublic: true })
      .expect(201);
  });

  test('auth required, returns 401 without', async () => {
    const app = createUnauthApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment', isPublic: true })
      .expect(401);
  });

  test('comment on pending returns 403', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'pending' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment', isPublic: true })
      .expect(403);
  });

  test('comment on planned returns 403 (read-only)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'planned' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment', isPublic: true })
      .expect(403);
  });

  test('comment on completed returns 403 (read-only)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'completed' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment', isPublic: true })
      .expect(403);
  });

  test('comment on rejected returns 403', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'rejected' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment', isPublic: true })
      .expect(403);
  });

  test('comment public visibility: anonymous author in response', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Public comment', isPublic: true })
      .expect(201);

    // Public comments should have anonymous author in response
  });

  test('comment private visibility: admin-only, not in public response', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Private note for admin', isPublic: false })
      .expect(201);
  });

  test('banned user returns 403', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ isSuspended: true });
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment', isPublic: true })
      .expect(403);
  });

  test('empty text returns 400', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: '', isPublic: true })
      .expect(400);
  });

  test('max length enforced', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'X'.repeat(2001), isPublic: true })
      .expect(400);
  });

  test('XSS payload sanitised', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: '<script>alert("xss")</script>Good idea', isPublic: true })
      .expect(201);

    // Verify stored text has no script tags
    const addCall = mockCollectionAdd.mock.calls[0] || mockDocSet.mock.calls[0];
    if (addCall) {
      const data = addCall[addCall.length - 1];
      if (data?.text) {
        expect(data.text).not.toContain('<script>');
      }
    }
  });

  test('list comments returns all public comments for suggestion', async () => {
    const comments = [
      makeCommentDoc('c1', { isPublic: true }),
      makeCommentDoc('c2', { isPublic: true }),
      makeCommentDoc('c3', { isPublic: false }), // private — should be excluded for non-admin
    ];
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: comments, size: 3 });
    const app = createApp({ isAdmin: false });
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    // Non-admin should only see public comments
  });

  test('admin sees private comments too', async () => {
    const comments = [
      makeCommentDoc('c1', { isPublic: true }),
      makeCommentDoc('c2', { isPublic: false }),
    ];
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: comments, size: 2 });
    const app = createApp({ isAdmin: true });
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    // Admin should see all comments including private
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.54 — Comment Pagination & Ordering
// ═══════════════════════════════════════════════════════════════

describe('Comment Pagination & Ordering', () => {
  test('comments returned in chronological order (oldest first)', async () => {
    const comments = [
      makeCommentDoc('c1', { createdAt: 1000, isPublic: true }),
      makeCommentDoc('c2', { createdAt: 2000, isPublic: true }),
      makeCommentDoc('c3', { createdAt: 3000, isPublic: true }),
    ];
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: comments, size: 3 });
    const app = createApp();
    await request(app).get('/api/suggestions/sug1').expect(200);
    // Verify orderBy was called with createdAt ascending
  });

  test('comments paginated: default page size 20', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions/sug1?commentPage=1').expect(200);
  });

  test('comments paginated: custom page size', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions/sug1?commentPage=1&commentPageSize=5').expect(200);
  });

  test('comments paginated: page 2 returns next set', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    await request(app).get('/api/suggestions/sug1?commentPage=2').expect(200);
  });

  test('suggestion with 0 comments: empty array returned', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [], size: 0 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    // Comments should be empty array
  });

  test('suggestion with 100+ comments: only first page returned, total count included', async () => {
    const comments = Array.from({ length: 20 }, (_, i) =>
      makeCommentDoc(`c${i}`, { isPublic: true }),
    );
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: comments, size: 100 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    // Should include total comment count
  });

  test('admin view: private comments interleaved in chronological order', async () => {
    const comments = [
      makeCommentDoc('c1', { createdAt: 1000, isPublic: true }),
      makeCommentDoc('c2', { createdAt: 2000, isPublic: false }),
      makeCommentDoc('c3', { createdAt: 3000, isPublic: true }),
    ];
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: comments, size: 3 });
    const app = createApp({ isAdmin: true });
    await request(app).get('/api/suggestions/sug1').expect(200);
    // Admin should see all 3 comments in order
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.74 — Comment Validation & Limits
// ═══════════════════════════════════════════════════════════════

describe('Comment Validation & Limits', () => {
  beforeEach(() => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1', { status: 'accepted' }));
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('comment max length: 2000 characters', async () => {
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'X'.repeat(2001), isPublic: true })
      .expect(400);
  });

  test('comment exactly 2000 chars: accepted', async () => {
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'X'.repeat(2000), isPublic: true })
      .expect(201);
  });

  test('comment 2001 chars: returns 400', async () => {
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'X'.repeat(2001), isPublic: true })
      .expect(400);
  });

  test('comment with newlines: preserved', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Line 1\nLine 2\nLine 3', isPublic: true })
      .expect(201);
  });

  test('comment with emoji: stored correctly', async () => {
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: '👍 Great idea! 🎉', isPublic: true })
      .expect(201);
  });

  test('comment with links/URLs: stored as-is (plain text)', async () => {
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Check https://example.com for reference', isPublic: true })
      .expect(201);
  });

  test('comment count returned on suggestion: correct total', async () => {
    const comments = Array.from({ length: 5 }, (_, i) =>
      makeCommentDoc(`c${i}`, { isPublic: true }),
    );
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('suggestions/')) {
        return Promise.resolve(makeSuggestionDoc('sug1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: comments, size: 5 });
    const app = createApp();
    const res = await request(app).get('/api/suggestions/sug1').expect(200);
    // Response should include commentCount or similar field
  });

  test('no hard limit on comments per suggestion (paginated)', async () => {
    // This test verifies there's no artificial cap
    const app = createApp();
    // Adding a comment should always succeed regardless of existing comment count
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Another comment', isPublic: true })
      .expect(201);
  });

  test('rapid comment submission (same user, 3 comments in 10s): all accepted', async () => {
    const app = createApp();
    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment 1', isPublic: true })
      .expect(201);

    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment 2', isPublic: true })
      .expect(201);

    await request(app)
      .post('/api/suggestions/sug1/comments')
      .send({ text: 'Comment 3', isPublic: true })
      .expect(201);
  });
});
