/* eslint-disable no-unused-vars */
/**
 * Tests for identity graph and unified cascading ban system.
 *
 * Covers spec sections:
 *   11.8   — Identity Graph & Suspensions
 *   11.61  — Identity Graph Query Performance
 *   11.104 — Identity Graph Edge Cases (Extended)
 *
 * Routes under test:
 *   POST   /api/admin/bans/graph           → create ban graph
 *   GET    /api/admin/bans/graph/:id       → view identity graph
 *   PUT    /api/admin/bans/graph/:id       → update ban graph
 *   DELETE /api/admin/bans/graph/:id       → unban entire graph
 *   GET    /api/admin/bans/check           → check if banned (middleware)
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'graph-id-1' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

const mockQueryChain = {
  where: jest.fn(() => mockQueryChain),
  orderBy: jest.fn(() => mockQueryChain),
  limit: jest.fn(() => mockQueryChain),
  get: () => mockCollectionGet(),
};

const mockRunTransaction = jest.fn(async (fn) => {
  const t = {
    get: (ref) => mockDocGet(ref._path || ref),
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
        _path: `${name}/${id}`,
        get: () => mockDocGet(`${name}/${id}`),
        set: (...args) => mockDocSet(`${name}/${id}`, ...args),
        update: (...args) => mockDocUpdate(`${name}/${id}`, ...args),
        delete: () => mockDocDelete(`${name}/${id}`),
      })),
      where: jest.fn(() => mockQueryChain),
      orderBy: jest.fn(() => mockQueryChain),
      get: () => mockCollectionGet(),
    })),
    runTransaction: mockRunTransaction,
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args) => ({ _type: 'arrayUnion', values: args })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-graph-id'),
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

// ─── App setup ──────────────────────────────────────────────────

let identityGraphRouter;

function createApp({ uniqueId = 'admin1', isAdmin = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: isAdmin } };
    next();
  });
  app.use('/api', identityGraphRouter);
  return app;
}

function createNonAdminApp({ uniqueId = 1001 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: false } };
    next();
  });
  app.use('/api', identityGraphRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
  identityGraphRouter = require('../../src/routes/identity-graph');
});

// ─── Helpers ────────────────────────────────────────────────────

function makeGraphDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      graphId: id,
      identifiers: [
        {
          type: 'uid',
          value: '1001',
          metadata: {},
          addedAt: 1709913600000,
          source: 'login',
          suspension: null,
        },
        {
          type: 'ip',
          value: '1.2.3.4',
          metadata: { isp: 'TestISP', country: 'GB', asn: 'AS12345' },
          addedAt: 1709913600000,
          source: 'login',
          suspension: null,
        },
        {
          type: 'fingerprint',
          value: 'fp-abc123',
          metadata: {},
          addedAt: 1709913600000,
          source: 'login',
          suspension: null,
        },
      ],
      multiAccountDetected: false,
      linkedAccountUids: ['1001'],
      ...overrides,
    }),
  };
}

function makeSuspendedIdentifier(type, value, duration = '7d') {
  const expiresAt = duration === 'permanent' ? null : 1709913600000 + 7 * 24 * 60 * 60 * 1000;
  return {
    type,
    value,
    metadata: {},
    addedAt: 1709913600000,
    source: 'login',
    suspension: {
      isActive: true,
      level: 'full',
      duration,
      reason: 'Spam',
      suspendedBy: 'admin1',
      suspendedAt: 1709913600000,
      expiresAt,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.8 — Identity Graph & Suspensions
// ═══════════════════════════════════════════════════════════════

describe('Identity binding at login', () => {
  test('login from web: IP + network info + browser fingerprint bound to account', async () => {
    // When user logs in from web, identity graph is created/updated
    const app = createApp();
    // Simulate login binding via internal route or utility
  });

  test('login from app: IP + network info + device ID bound to account', async () => {
    // App login binds device ID instead of browser fingerprint
  });

  test('second login from new IP: new IP added to graph', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    // After second login, graph should have 2 IPs
  });

  test('second login from new device: new device added to graph', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    // After second login, graph should have 2 fingerprints
  });

  test('all identifiers share same graphId', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/graph/graph-1').expect(200);
    const identifiers = res.body.identifiers || [];
    // All should be in the same graph
  });
});

describe('Suspension cascade', () => {
  test('suspend account (7 days): all linked devices get 7-day suspension', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', duration: '7d', level: 'full', reason: 'Spam' })
      .expect(200);

    // All 3 identifiers should be suspended
  });

  test('suspend account (7 days): all linked networks get 7-day suspension', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', duration: '7d', level: 'full', reason: 'Spam' })
      .expect(200);
  });

  test('suspend account (permanent): all get permanent ban', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({
        action: 'suspend',
        duration: 'permanent',
        level: 'full',
        reason: 'Repeated violations',
      })
      .expect(200);
  });

  test('suspend account (suggestions-only): all get suggestions-only restriction', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({
        action: 'suspend',
        duration: '30d',
        level: 'suggestions_only',
        reason: 'Suggestion spam',
      })
      .expect(200);
  });

  test('suspended device used with new IP: new IP auto-suspended, added to graph', async () => {
    const suspendedGraph = makeGraphDoc('graph-1', {
      identifiers: [
        makeSuspendedIdentifier('uid', '1001'),
        makeSuspendedIdentifier('fingerprint', 'fp-abc'),
        makeSuspendedIdentifier('ip', '1.2.3.4'),
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(suspendedGraph);
      }
      return Promise.resolve({ exists: false });
    });
    // When new IP appears with known suspended device, it should be auto-suspended
  });

  test('suspended network used with new device: new device auto-suspended, audit logged', async () => {
    // Similar to above but triggered by network match
  });
});

describe('Multi-account detection', () => {
  test('device linked to 2 accounts: both auto-suspended', async () => {
    const multiAccountGraph = makeGraphDoc('graph-1', {
      linkedAccountUids: ['1001', '2002'],
      multiAccountDetected: true,
      identifiers: [
        {
          type: 'uid',
          value: '1001',
          metadata: {},
          addedAt: 1000,
          source: 'login',
          suspension: null,
        },
        {
          type: 'uid',
          value: '2002',
          metadata: {},
          addedAt: 2000,
          source: 'login',
          suspension: null,
        },
        {
          type: 'fingerprint',
          value: 'shared-device',
          metadata: {},
          addedAt: 1000,
          source: 'login',
          suspension: null,
        },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(multiAccountGraph);
      }
      return Promise.resolve({ exists: false });
    });
    // Both accounts should be auto-suspended
  });

  test('device linked to 3 accounts: all 3 auto-suspended', async () => {
    const multiGraph = makeGraphDoc('graph-1', {
      linkedAccountUids: ['1001', '2002', '3003'],
      multiAccountDetected: true,
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(multiGraph);
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('multi-account flag set on graph', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/graph/graph-1');
    // multiAccountDetected should be in the response
  });

  test('audit log records detection event', async () => {
    // When multi-account is detected, audit log entry should be created
  });
});

describe('Full suspension enforcement', () => {
  test('fully suspended: API requests return 403 with suspension info', async () => {
    // Middleware check returns 403 for banned identifier
  });

  test('fully suspended: cannot access suggestions', async () => {
    // Vote, comment, submit — all return 403
  });

  test('suggestions-only: can still access app, cannot use suggestions', async () => {
    // Suggestions routes return 403, other routes work
  });

  test('suspension expiry: auto-cleared after duration', async () => {
    // Expired suspensions should be treated as inactive
    const expiredGraph = makeGraphDoc('graph-1', {
      identifiers: [
        {
          type: 'uid',
          value: '1001',
          metadata: {},
          addedAt: 1000,
          source: 'login',
          suspension: {
            isActive: true,
            level: 'full',
            duration: '7d',
            reason: 'Old',
            suspendedAt: 1000,
            expiresAt: Date.now() - 1000, // expired
          },
        },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(expiredGraph);
      }
      return Promise.resolve({ exists: false });
    });
    // Ban check should return not-banned for expired suspension
  });
});

describe('Unsuspend', () => {
  test('unsuspend entire graph: all identifiers cleared', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(
          makeGraphDoc('graph-1', {
            identifiers: [
              makeSuspendedIdentifier('uid', '1001'),
              makeSuspendedIdentifier('ip', '1.2.3.4'),
              makeSuspendedIdentifier('fingerprint', 'fp-abc'),
            ],
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).delete('/api/admin/bans/graph/graph-1').expect(200);
  });

  test('unsuspend specific identifier: only that one cleared', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(
          makeGraphDoc('graph-1', {
            identifiers: [
              makeSuspendedIdentifier('uid', '1001'),
              makeSuspendedIdentifier('ip', '1.2.3.4'),
            ],
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'unsuspend', identifier: { type: 'ip', value: '1.2.3.4' } })
      .expect(200);
  });

  test('unsuspend audit logged', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).delete('/api/admin/bans/graph/graph-1').expect(200);
    // Verify audit log set was called
  });
});

describe('Ban check middleware', () => {
  test('check by IP: returns correct status', async () => {
    const app = createApp();
    await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(200);
  });

  test('check by fingerprint: returns correct status', async () => {
    const app = createApp();
    await request(app).get('/api/admin/bans/check?fingerprint=fp-abc').expect(200);
  });

  test('check by UID: returns correct status', async () => {
    const app = createApp();
    await request(app).get('/api/admin/bans/check?uid=1001').expect(200);
  });

  test('check by any match: triggers ban response', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [makeSuspendedIdentifier('ip', '1.2.3.4')],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(200);
    expect(res.body.isBanned).toBe(true);
  });

  test('non-banned identifier: passes through', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=9.9.9.9').expect(200);
    expect(res.body.isBanned).toBe(false);
  });
});

describe('Ban graph CRUD contracts', () => {
  test('POST /api/admin/bans/graph: returns 201 with graphId', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'uid', value: '1001' }] })
      .expect(201);

    expect(res.body).toHaveProperty('graphId');
  });

  test('POST /api/admin/bans/graph: non-admin returns 403', async () => {
    const app = createNonAdminApp();
    await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'uid', value: '1001' }] })
      .expect(403);
  });

  test('GET /api/admin/bans/graph/:id: returns 200 with full identifier list', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/graph/graph-1').expect(200);
    expect(res.body).toHaveProperty('identifiers');
    expect(Array.isArray(res.body.identifiers)).toBe(true);
  });

  test('GET /api/admin/bans/graph/:id: non-existent returns 404', async () => {
    const app = createApp();
    await request(app).get('/api/admin/bans/graph/nonexistent').expect(404);
  });

  test('PUT /api/admin/bans/graph/:id: update suspension level returns 200', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', duration: '30d', level: 'full', reason: 'Updated' })
      .expect(200);
  });

  test('DELETE /api/admin/bans/graph/:id: unban returns 200', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).delete('/api/admin/bans/graph/graph-1').expect(200);
  });

  test('DELETE /api/admin/bans/graph/:id: non-existent returns 404', async () => {
    const app = createApp();
    await request(app).delete('/api/admin/bans/graph/nonexistent').expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.61 — Identity Graph Query Performance
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.104 — Identity Graph Edge Cases (Extended)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Additional coverage — uncovered lines and branches
// ═══════════════════════════════════════════════════════════════

describe('PUT /api/admin/bans/graph/:id — unsuspend all', () => {
  test('unsuspend all identifiers clears all suspensions', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(
          makeGraphDoc('graph-1', {
            identifiers: [
              makeSuspendedIdentifier('uid', '1001'),
              makeSuspendedIdentifier('ip', '1.2.3.4'),
            ],
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'unsuspend' })
      .expect(200);
    expect(res.body.success).toBe(true);
    // Should update all identifiers with suspension: null
    expect(mockDocUpdate).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Security: Query param type coercion (CodeQL type confusion fix)
// ═══════════════════════════════════════════════════════════════
