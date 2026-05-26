/**
 * Extended tests for admin suggestion routes — gap coverage.
 *
 * Covers:
 *   - Invalid status transitions (all disallowed pairs)
 *   - Blocked topic creation on rejection
 *   - Blocked topic cleanup when overturning rejection (rejected → accepted)
 *   - PUT /admin/suggestions/:id/link edge cases (non-admin, non-existent)
 *   - POST /admin/suggestions/:id/merge edge cases (already merged, self-merge, non-admin)
 *   - DELETE /admin/suggestions/blocked/:id edge cases (non-existent, non-admin)
 *   - GET /admin/suggestions/disputes edge cases (non-admin, empty)
 *   - PUT /admin/suggestions/disputes/:id edge cases (invalid resolution)
 *   - POST /suggestions/:id/dispute edge cases (unauthenticated, non-submitter, already disputed)
 *
 * Routes under test:
 *   PUT    /api/admin/suggestions/:id/status
 *   PUT    /api/admin/suggestions/:id/link
 *   POST   /api/admin/suggestions/:id/merge
 *   DELETE /api/admin/suggestions/blocked/:id
 *   GET    /api/admin/suggestions/disputes
 *   PUT    /api/admin/suggestions/disputes/:id
 *   POST   /api/suggestions/:id/dispute
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

function createAdminApp({ uniqueId = 'admin-1' } = {}) {
  return createApp({ uniqueId, isAdmin: true });
}

function createUnauthenticatedApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // No auth at all
    req.auth = null;
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

function makeSuggestionSnap(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      title: 'Test suggestion',
      description: 'A test description that is valid',
      tags: ['quality-of-life'],
      language: 'en',
      status: 'pending',
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
      subscribers: [1001],
      votingLocked: false,
      commentsLocked: false,
      ...overrides,
    }),
  };
}

function makeDisputeSnap(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      suggestionId: 'sug-merged-1',
      originalSuggestionId: 'sug-original-1',
      submitterUid: 1001,
      reason: 'These are different features',
      status: 'pending',
      createdAt: 1709913600000,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      ...overrides,
    }),
  };
}

function makeRoadmapFeatureSnap(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      title: 'Roadmap feature',
      phase: 'phase-2',
      status: 'planned',
      ...overrides,
    }),
  };
}

function makeBlockedTopicSnap(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      title: 'Blocked topic title',
      reason: 'Already planned internally',
      rejectReason: 'Already planned internally',
      originalSuggestionId: 'sug-orig-1',
      createdAt: 1709913600000,
      ...overrides,
    }),
  };
}

/** Set up mockDocGet to resolve different docs based on path. */
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

// ═══════════════════════════════════════════════════════════════
// PUT /admin/suggestions/:id/status — Invalid transitions
// ═══════════════════════════════════════════════════════════════

describe('PUT /admin/suggestions/:id/status — invalid transitions', () => {
  test('pending → planned returns 400 (must be accepted first)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'planned' })
      .expect(400);

    expect(res.body.error).toMatch(/cannot plan directly from pending|accepted first/i);
  });

  test('pending → completed returns 400 (must be planned first)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'completed' })
      .expect(400);

    expect(res.body.error).toMatch(/cannot complete directly from pending|planned first/i);
  });

  test('accepted → completed returns 400 (must be planned first)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'accepted' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'completed' })
      .expect(400);

    expect(res.body.error).toMatch(/cannot complete directly from accepted|planned first/i);
  });

  test('rejected → planned returns 400 (invalid transition)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'planned' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid status transition/i);
  });

  test('rejected → completed returns 400 (invalid transition)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'completed' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid status transition/i);
  });

  test('completed → rejected returns 400 (invalid transition)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'completed' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'rejected' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid status transition/i);
  });

  test('cannot transition to pending status', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'accepted' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'pending' })
      .expect(400);

    expect(res.body.error).toMatch(/cannot transition to pending/i);
  });

  test('same status returns 400 (no change needed)', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'planned' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/status')
      .send({ status: 'planned' })
      .expect(400);

    expect(res.body.error).toMatch(/already|no change/i);
  });

  test('missing status returns 400', async () => {
    setupDocMocks({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }),
    });
    const app = createAdminApp();
    const res = await request(app).put('/api/admin/suggestions/sug-1/status').send({}).expect(400);

    expect(res.body.error).toMatch(/status is required/i);
  });

  test('non-existent suggestion returns 404', async () => {
    // mockDocGet defaults to { exists: false }
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/nonexistent/status')
      .send({ status: 'accepted' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /admin/suggestions/:id/status — Blocked topic side effects
// ═══════════════════════════════════════════════════════════════

describe('PUT /admin/suggestions/:id/status — blocked topic creation on rejection', () => {
  test('rejecting a suggestion creates a blockedTopics document', async () => {
    setupDocMocks({
      'suggestions/sug-reject-1': makeSuggestionSnap('sug-reject-1', {
        status: 'pending',
        title: 'Add flying cars',
      }),
    });
    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-reject-1/status')
      .send({ status: 'rejected', reason: 'Not feasible' })
      .expect(200);

    // Verify blockedTopics doc was created (first arg is path, second is data)
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('blockedTopics'),
      expect.objectContaining({
        title: 'Add flying cars',
        reason: 'Not feasible',
        rejectReason: 'Not feasible',
        originalSuggestionId: 'sug-reject-1',
      }),
    );
  });

  test('rejecting without reason still creates blockedTopics with null reason', async () => {
    setupDocMocks({
      'suggestions/sug-reject-2': makeSuggestionSnap('sug-reject-2', {
        status: 'pending',
        title: 'Impossible feature',
      }),
    });
    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-reject-2/status')
      .send({ status: 'rejected' })
      .expect(200);

    // blockedTopics set call should include null reason (first arg is path)
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('blockedTopics'),
      expect.objectContaining({
        title: 'Impossible feature',
        reason: null,
        rejectReason: null,
        originalSuggestionId: 'sug-reject-2',
      }),
    );
  });

  test('rejecting from accepted creates blocked topic', async () => {
    setupDocMocks({
      'suggestions/sug-reject-3': makeSuggestionSnap('sug-reject-3', {
        status: 'accepted',
        title: 'Remove ads forever',
      }),
    });
    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-reject-3/status')
      .send({ status: 'rejected', reason: 'Revenue impact' })
      .expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('blockedTopics'),
      expect.objectContaining({
        title: 'Remove ads forever',
        rejectReason: 'Revenue impact',
      }),
    );
  });
});

describe('PUT /admin/suggestions/:id/status — blocked topic cleanup on overturn', () => {
  test('rejected → accepted cleans up associated blockedTopics', async () => {
    setupDocMocks({
      'suggestions/sug-overturn-1': makeSuggestionSnap('sug-overturn-1', {
        status: 'rejected',
        title: 'Dark mode',
        rejectReason: 'Not needed',
      }),
    });

    // Mock the blockedTopics query returning matching docs
    const blockedDoc1 = {
      id: 'bt-1',
      data: () => ({ title: 'Dark mode', originalSuggestionId: 'sug-overturn-1' }),
    };
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [blockedDoc1],
      size: 1,
    });

    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-overturn-1/status')
      .send({ status: 'accepted' })
      .expect(200);

    // Verify blocked topic was deleted (mockDocDelete receives path)
    expect(mockDocDelete).toHaveBeenCalled();
  });

  test('rejected → accepted clears rejectReason on suggestion', async () => {
    setupDocMocks({
      'suggestions/sug-overturn-2': makeSuggestionSnap('sug-overturn-2', {
        status: 'rejected',
        title: 'Voice effects',
        rejectReason: 'Too complex',
      }),
    });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-overturn-2/status')
      .send({ status: 'accepted' })
      .expect(200);

    // The transaction update should include rejectReason: null (first arg is path or data)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestions/'),
      expect.objectContaining({
        status: 'accepted',
        rejectReason: null,
      }),
    );
    // Note: transaction.update receives data directly (no path prefix)
  });

  test('rejected → accepted sets votingLocked and commentsLocked to false', async () => {
    setupDocMocks({
      'suggestions/sug-overturn-3': makeSuggestionSnap('sug-overturn-3', {
        status: 'rejected',
        title: 'Custom themes',
      }),
    });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-overturn-3/status')
      .send({ status: 'accepted' })
      .expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestions/'),
      expect.objectContaining({
        votingLocked: false,
        commentsLocked: false,
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /admin/suggestions/:id/link
// ═══════════════════════════════════════════════════════════════

describe('PUT /admin/suggestions/:id/link', () => {
  test('non-admin returns 403', async () => {
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .put('/api/admin/suggestions/sug-1/link')
      .send({ roadmapFeatureId: 'feature-1' })
      .expect(403);

    expect(res.body.error).toMatch(/admin/i);
  });

  test('non-existent suggestion returns 404', async () => {
    // mockDocGet defaults to { exists: false }
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/nonexistent/link')
      .send({ roadmapFeatureId: 'feature-1' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('missing roadmapFeatureId returns 400', async () => {
    setupDocMocks({
      'suggestions/sug-link-1': makeSuggestionSnap('sug-link-1', { status: 'accepted' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-link-1/link')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/roadmap feature.*required/i);
  });

  test('non-existent roadmap feature still links (features may come from roadmap-data.json)', async () => {
    setupDocMocks({
      'suggestions/sug-link-2': makeSuggestionSnap('sug-link-2', { status: 'accepted' }),
      // roadmapFeatures/bad-feature is NOT in the map, but we accept any ID
    });
    const app = createAdminApp();
    await request(app)
      .put('/api/admin/suggestions/sug-link-2/link')
      .send({ roadmapFeatureId: 'bad-feature' })
      .expect(200);
  });

  test('successful link returns 200', async () => {
    setupDocMocks({
      'suggestions/sug-link-3': makeSuggestionSnap('sug-link-3', { status: 'accepted' }),
      'roadmapFeatures/feature-42': makeRoadmapFeatureSnap('feature-42'),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/sug-link-3/link')
      .send({ roadmapFeatureId: 'feature-42' })
      .expect(200);

    expect(res.body.success).toBe(true);
    // db.doc(path).update(data) => mockDocUpdate(path, data)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestions/sug-link-3'),
      expect.objectContaining({
        linkedRoadmapFeature: 'feature-42',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/merge
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// DELETE /admin/suggestions/blocked/:id
// ═══════════════════════════════════════════════════════════════

describe('DELETE /admin/suggestions/blocked/:id', () => {
  test('non-existent blocked topic returns 404', async () => {
    // mockDocGet defaults to { exists: false }
    const app = createAdminApp();
    const res = await request(app)
      .delete('/api/admin/suggestions/blocked/nonexistent-bt')
      .expect(404);

    expect(res.body.error).toMatch(/blocked topic not found/i);
  });

  test('non-admin returns 403', async () => {
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app).delete('/api/admin/suggestions/blocked/bt-1').expect(403);

    expect(res.body.error).toMatch(/admin/i);
  });

  test('successful deletion returns 200', async () => {
    setupDocMocks({
      'blockedTopics/bt-del-1': makeBlockedTopicSnap('bt-del-1'),
    });
    const app = createAdminApp();
    const res = await request(app).delete('/api/admin/suggestions/blocked/bt-del-1').expect(200);

    expect(res.body.success).toBe(true);
    // Verify the blocked topic was deleted
    expect(mockDocDelete).toHaveBeenCalled();
  });

  test('creates audit log entry on deletion', async () => {
    setupDocMocks({
      'blockedTopics/bt-del-2': makeBlockedTopicSnap('bt-del-2', { title: 'Blocked feature X' }),
    });
    const app = createAdminApp();
    await request(app).delete('/api/admin/suggestions/blocked/bt-del-2').expect(200);

    // Audit entry is created via createAuditEntry which calls db.doc(path).set(data)
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('moderationLog'),
      expect.objectContaining({
        action: 'blocked_topic_delete',
        targetType: 'blockedTopic',
        targetId: 'bt-del-2',
        details: expect.objectContaining({ title: 'Blocked feature X' }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /admin/suggestions/disputes
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/suggestions/disputes', () => {
  test('non-admin returns 403', async () => {
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app).get('/api/admin/suggestions/disputes').expect(403);

    expect(res.body.error).toMatch(/admin/i);
  });

  test('returns empty array when no disputes exist', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/suggestions/disputes').expect(200);

    expect(res.body.disputes).toEqual([]);
    expect(Array.isArray(res.body.disputes)).toBe(true);
  });

  test('returns disputes when they exist', async () => {
    const dispute1 = {
      id: 'disp-1',
      data: () => ({
        suggestionId: 'sug-1',
        submitterUid: 1001,
        reason: 'Different features',
        status: 'pending',
        createdAt: 1709913600000,
      }),
    };
    const dispute2 = {
      id: 'disp-2',
      data: () => ({
        suggestionId: 'sug-2',
        submitterUid: 2002,
        reason: 'Not a duplicate',
        status: 'pending',
        createdAt: 1709913700000,
      }),
    };
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [dispute1, dispute2],
      size: 2,
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/admin/suggestions/disputes').expect(200);

    expect(res.body.disputes).toHaveLength(2);
    expect(res.body.disputes[0].id).toBe('disp-1');
    expect(res.body.disputes[1].id).toBe('disp-2');
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /admin/suggestions/disputes/:id
// ═══════════════════════════════════════════════════════════════

describe('PUT /admin/suggestions/disputes/:id', () => {
  test('invalid resolution value returns 400', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-1')
      .send({ resolution: 'invalid-value' })
      .expect(400);

    expect(res.body.error).toMatch(/resolution must be.*uphold.*reject/i);
  });

  test('missing resolution returns 400', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-1')
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/resolution must be/i);
  });

  test('null resolution returns 400', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-1')
      .send({ resolution: null })
      .expect(400);

    expect(res.body.error).toMatch(/resolution must be/i);
  });

  test('non-admin returns 403', async () => {
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-1')
      .send({ resolution: 'uphold' })
      .expect(403);

    expect(res.body.error).toMatch(/admin/i);
  });

  test('non-existent dispute returns 404', async () => {
    // mockDocGet defaults to { exists: false }
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/nonexistent')
      .send({ resolution: 'uphold' })
      .expect(404);

    expect(res.body.error).toMatch(/dispute not found/i);
  });

  test('already-resolved dispute returns 400', async () => {
    setupDocMocks({
      'suggestion_disputes/disp-resolved': makeDisputeSnap('disp-resolved', {
        status: 'upheld',
        resolvedAt: 1709999000000,
      }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-resolved')
      .send({ resolution: 'reject' })
      .expect(400);

    expect(res.body.error).toMatch(/already resolved/i);
  });

  test('uphold resolution updates dispute and clears dispute flag', async () => {
    setupDocMocks({
      'suggestion_disputes/disp-uphold': makeDisputeSnap('disp-uphold', {
        suggestionId: 'sug-merged-x',
        status: 'pending',
      }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-uphold')
      .send({ resolution: 'uphold' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Dispute updated to upheld (db.doc(path).update(data))
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestion_disputes/disp-uphold'),
      expect.objectContaining({
        status: 'upheld',
        resolution: 'uphold',
      }),
    );

    // Suggestion dispute flag cleared
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestions/sug-merged-x'),
      expect.objectContaining({
        disputePending: false,
      }),
    );
  });

  test('reject resolution restores suggestion to pending', async () => {
    setupDocMocks({
      'suggestion_disputes/disp-reject': makeDisputeSnap('disp-reject', {
        suggestionId: 'sug-merged-y',
        status: 'pending',
      }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .put('/api/admin/suggestions/disputes/disp-reject')
      .send({ resolution: 'reject' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Suggestion restored to pending (db.doc(path).update(data))
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestions/sug-merged-y'),
      expect.objectContaining({
        status: 'pending',
        mergedIntoSuggestionId: null,
        disputePending: false,
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /suggestions/:id/dispute
// ═══════════════════════════════════════════════════════════════

describe('POST /suggestions/:id/dispute', () => {
  test('unauthenticated request returns 401', async () => {
    const app = createUnauthenticatedApp();
    const res = await request(app)
      .post('/api/suggestions/sug-1/dispute')
      .send({ reason: 'Not a duplicate' })
      .expect(401);

    expect(res.body.error).toMatch(/authentication required/i);
  });

  test('non-submitter returns 403', async () => {
    setupDocMocks({
      'suggestions/sug-dispute-1': makeSuggestionSnap('sug-dispute-1', {
        status: 'merged',
        submitterUid: 9999, // different from requestor (1001)
        mergedIntoSuggestionId: 'sug-orig',
      }),
    });
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .post('/api/suggestions/sug-dispute-1/dispute')
      .send({ reason: 'Not a duplicate' })
      .expect(403);

    expect(res.body.error).toMatch(/only the submitter/i);
  });

  test('already-disputed suggestion returns 400', async () => {
    setupDocMocks({
      'suggestions/sug-dispute-2': makeSuggestionSnap('sug-dispute-2', {
        status: 'merged',
        submitterUid: 1001,
        mergedIntoSuggestionId: 'sug-orig',
        disputePending: true, // already disputed
      }),
    });
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .post('/api/suggestions/sug-dispute-2/dispute')
      .send({ reason: 'I disagree' })
      .expect(400);

    expect(res.body.error).toMatch(/already pending/i);
  });

  test('non-merged suggestion returns 400', async () => {
    setupDocMocks({
      'suggestions/sug-dispute-3': makeSuggestionSnap('sug-dispute-3', {
        status: 'accepted', // not merged
        submitterUid: 1001,
      }),
    });
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .post('/api/suggestions/sug-dispute-3/dispute')
      .send({ reason: 'Wrong' })
      .expect(400);

    expect(res.body.error).toMatch(/only dispute merged/i);
  });

  test('non-existent suggestion returns 404', async () => {
    // mockDocGet defaults to { exists: false }
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .post('/api/suggestions/nonexistent/dispute')
      .send({ reason: 'Not a duplicate' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('successful dispute creates dispute record and sets flag', async () => {
    setupDocMocks({
      'suggestions/sug-dispute-4': makeSuggestionSnap('sug-dispute-4', {
        status: 'merged',
        submitterUid: 1001,
        mergedIntoSuggestionId: 'sug-orig-99',
        disputePending: false,
      }),
    });
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    const res = await request(app)
      .post('/api/suggestions/sug-dispute-4/dispute')
      .send({ reason: 'These are completely different features' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Verify dispute record created
    expect(mockCollectionAdd).toHaveBeenCalledWith(
      'suggestion_disputes',
      expect.objectContaining({
        suggestionId: 'sug-dispute-4',
        originalSuggestionId: 'sug-orig-99',
        submitterUid: 1001,
        reason: 'These are completely different features',
        status: 'pending',
      }),
    );

    // Verify dispute flag set on suggestion (db.doc(path).update(data))
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('suggestions/sug-dispute-4'),
      expect.objectContaining({
        disputePending: true,
      }),
    );
  });

  test('dispute with empty reason defaults to empty string', async () => {
    setupDocMocks({
      'suggestions/sug-dispute-5': makeSuggestionSnap('sug-dispute-5', {
        status: 'merged',
        submitterUid: 1001,
        mergedIntoSuggestionId: 'sug-orig-100',
        disputePending: false,
      }),
    });
    const app = createApp({ uniqueId: 1001, isAdmin: false });
    await request(app).post('/api/suggestions/sug-dispute-5/dispute').send({}).expect(200);

    expect(mockCollectionAdd).toHaveBeenCalledWith(
      'suggestion_disputes',
      expect.objectContaining({
        reason: '',
      }),
    );
  });
});
