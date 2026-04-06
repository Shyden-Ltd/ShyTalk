/* eslint-disable no-unused-vars */
/**
 * Tests for new identity graph routes added in PR #255.
 *
 * Covers:
 *   GET  /admin/identity-graph/:id                    — get graph nodes/edges
 *   POST /admin/identity-graph/:id/suspend-all        — suspend all nodes
 *   POST /admin/identity-graph/:id/unsuspend-all      — unsuspend all nodes
 *   POST /admin/identity-graph/:id/node/:nodeId/unsuspend — unsuspend single node
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'audit-id-1' });
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
  generateId: jest.fn(() => 'mock-audit-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ──────────────────────────────────────────────────

let identityGraphRouter;

function createAdminApp({ uniqueId = 'admin-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: true } };
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
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  identityGraphRouter = require('../../src/routes/identity-graph');
});

// ─── Helpers ────────────────────────────────────────────────────

function makeGraphWithNodes(id, nodes = []) {
  return {
    id,
    exists: true,
    data: () => ({
      nodes: nodes.length
        ? nodes
        : [
            { id: 'account-' + id, type: 'account', label: id, suspended: false },
            { id: 'device-1', type: 'device', label: 'Phone', suspended: false },
          ],
      edges: [{ from: 'account-' + id, to: 'device-1' }],
    }),
  };
}

function makeSuspendedGraphWithNodes(id) {
  return {
    id,
    exists: true,
    data: () => ({
      nodes: [
        { id: 'account-' + id, type: 'account', label: id, suspended: true },
        { id: 'device-1', type: 'device', label: 'Phone', suspended: true },
      ],
      edges: [],
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /admin/identity-graph/:id
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/identity-graph/:id', () => {
  test('returns nodes and edges for existing graph (200)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/identity-graph/user-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);
    expect(res.body.nodes.length).toBe(2);
  });

  test('returns empty graph (nodes=[], edges=[]) when no record exists (200)', async () => {
    // mockDocGet returns exists:false by default
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/identity-graph/nouser');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('nouser');
    expect(res.body.nodes).toEqual([]);
    expect(res.body.edges).toEqual([]);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app).get('/api/admin/identity-graph/user-1');

    expect(res.status).toBe(403);
  });

  test('returns nodes from graph data (not identifiers array)', async () => {
    const graphWithNoNodes = {
      id: 'user-2',
      exists: true,
      data: () => ({ nodes: [], edges: [] }),
    };
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-2')) {
        return Promise.resolve(graphWithNoNodes);
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/identity-graph/user-2');

    expect(res.status).toBe(200);
    expect(res.body.nodes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/identity-graph/:id/suspend-all
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/identity-graph/:id/suspend-all', () => {
  test('suspends all nodes when graph exists (200)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/suspend-all')
      .send({ duration: '7d', scope: 'full', reason: 'Spam' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suspended).toBe(2);
    // Verify all nodes marked suspended
    const setCall = mockDocSet.mock.calls.find((c) => c[0] === 'identityGraphs/user-1');
    expect(setCall).toBeDefined();
    const setData = setCall[1];
    expect(setData.nodes.every((n) => n.suspended)).toBe(true);
  });

  test('seeds a default graph if none exists and suspends (200)', async () => {
    // mockDocGet returns exists:false (default)
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/new-user/suspend-all')
      .send({ duration: '7d', scope: 'full', reason: 'Evasion' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suspended).toBe(1); // seeded 1 account node
  });

  test('propagates suspension to user doc (isSuspended=true)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    await request(app)
      .post('/api/admin/identity-graph/user-1/suspend-all')
      .send({ duration: '7d', scope: 'full' })
      .expect(200);

    const userSetCall = mockDocSet.mock.calls.find((c) => c[0] === 'users/user-1');
    expect(userSetCall).toBeDefined();
    expect(userSetCall[1]).toMatchObject({ isSuspended: true });
  });

  test('creates audit log entry', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    await request(app)
      .post('/api/admin/identity-graph/user-1/suspend-all')
      .send({ duration: '7d', scope: 'full', reason: 'Test' })
      .expect(200);

    // Audit entry stored as db.doc(adminAuditLog/...).set(...)
    const auditSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('adminAuditLog'),
    );
    expect(auditSetCall).toBeDefined();
    expect(auditSetCall[1]).toMatchObject({ action: 'identity_suspend', targetId: 'user-1' });
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/suspend-all')
      .send({ duration: '7d' });

    expect(res.status).toBe(403);
  });

  test('works without reason in body (200)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/suspend-all')
      .send({ duration: '30d' });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/identity-graph/:id/unsuspend-all
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/identity-graph/:id/unsuspend-all', () => {
  test('unsuspends all nodes when graph exists (200)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeSuspendedGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/identity-graph/user-1/unsuspend-all').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.unsuspended).toBe(2);
    const setCall = mockDocSet.mock.calls.find((c) => c[0] === 'identityGraphs/user-1');
    expect(setCall).toBeDefined();
    expect(setCall[1].nodes.every((n) => !n.suspended)).toBe(true);
  });

  test('handles non-existent graph (returns unsuspended=0)', async () => {
    // exists:false by default — behaves gracefully
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/identity-graph/nouser/unsuspend-all').send({});

    expect(res.status).toBe(200);
    expect(res.body.unsuspended).toBe(0);
  });

  test('propagates unsuspend to user doc (isSuspended=false)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeSuspendedGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    await request(app).post('/api/admin/identity-graph/user-1/unsuspend-all').send({}).expect(200);

    const userSetCall = mockDocSet.mock.calls.find((c) => c[0] === 'users/user-1');
    expect(userSetCall).toBeDefined();
    expect(userSetCall[1]).toMatchObject({ isSuspended: false });
  });

  test('creates audit log entry', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeSuspendedGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    await request(app).post('/api/admin/identity-graph/user-1/unsuspend-all').send({}).expect(200);

    const auditSetCall = mockDocSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('adminAuditLog'),
    );
    expect(auditSetCall).toBeDefined();
    expect(auditSetCall[1]).toMatchObject({ action: 'identity_unsuspend', targetId: 'user-1' });
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app).post('/api/admin/identity-graph/user-1/unsuspend-all').send({});

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/identity-graph/:id/node/:nodeId/unsuspend
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/identity-graph/:id/node/:nodeId/unsuspend', () => {
  test('unsuspends a specific node by id (200)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve({
          id: 'user-1',
          exists: true,
          data: () => ({
            nodes: [
              { id: 'account-user-1', type: 'account', label: 'user-1', suspended: true },
              { id: 'device-abc', type: 'device', label: 'Phone', suspended: true },
            ],
            edges: [],
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/node/device-abc/unsuspend')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const updateCall = mockDocUpdate.mock.calls.find((c) => c[0] === 'identityGraphs/user-1');
    expect(updateCall).toBeDefined();
    const updatedNodes = updateCall[1].nodes;
    const targetNode = updatedNodes.find((n) => n.id === 'device-abc');
    expect(targetNode.suspended).toBe(false);
    // Other node remains suspended
    const otherNode = updatedNodes.find((n) => n.id === 'account-user-1');
    expect(otherNode.suspended).toBe(true);
  });

  test('returns 404 when identity graph not found', async () => {
    // exists:false by default
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/nouser/node/device-abc/unsuspend')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/node/device-abc/unsuspend')
      .send({});

    expect(res.status).toBe(403);
  });

  test('node not found in graph does not error — other nodes unchanged', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve({
          id: 'user-1',
          exists: true,
          data: () => ({
            nodes: [{ id: 'account-user-1', type: 'account', suspended: true }],
            edges: [],
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/node/nonexistent-node/unsuspend')
      .send({});

    // Route still succeeds — missing nodeId just leaves nodes unchanged
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 500 on unexpected Firestore error', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.reject(new Error('Firestore unavailable'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/err-user/node/device-1/unsuspend')
      .send({});

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// 500 error paths for new routes
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/identity-graph/:id — 500 error path', () => {
  test('returns 500 on unexpected Firestore error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/identity-graph/err-user');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

describe('POST /admin/identity-graph/:id/suspend-all — error paths', () => {
  test('returns 500 on unexpected Firestore error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/err-user/suspend-all')
      .send({ duration: '7d' });

    expect(res.status).toBe(500);
  });

  test('continues (200) when user doc update fails during suspend', async () => {
    // Graph set succeeds; user doc set throws
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    // First set call (identityGraphs) succeeds; second (users) fails
    let setCallCount = 0;
    mockDocSet.mockImplementation((path) => {
      setCallCount++;
      if (typeof path === 'string' && path.startsWith('users/')) {
        return Promise.reject(new Error('User doc write failed'));
      }
      return Promise.resolve();
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/user-1/suspend-all')
      .send({ duration: '7d' });

    // User propagation failure is caught and warned, not fatal
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /admin/identity-graph/:id/unsuspend-all — error paths', () => {
  test('returns 500 on unexpected Firestore error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/identity-graph/err-user/unsuspend-all')
      .send({});

    expect(res.status).toBe(500);
  });

  test('continues (200) when user doc update fails during unsuspend', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/user-1')) {
        return Promise.resolve(makeSuspendedGraphWithNodes('user-1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockDocSet.mockImplementation((path) => {
      if (typeof path === 'string' && path.startsWith('users/')) {
        return Promise.reject(new Error('User doc write failed'));
      }
      return Promise.resolve();
    });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/identity-graph/user-1/unsuspend-all').send({});

    // User propagation failure is caught and warned, not fatal
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
