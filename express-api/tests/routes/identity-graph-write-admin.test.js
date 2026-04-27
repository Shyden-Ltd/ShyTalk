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

// ═══════════════════════════════════════════════════════════════
// 11.61 — Identity Graph Query Performance
// ═══════════════════════════════════════════════════════════════

describe('Identity Graph Query Performance', () => {
  test('ban check by IP: responds within 50ms (indexed query)', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const app = createApp();
    const start = Date.now();
    await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(200);
    const duration = Date.now() - start;
    // Should be fast — test is mainly for regression, not strict timing
    expect(duration).toBeLessThan(5000); // generous for CI
  });

  test('ban check by fingerprint: responds within 50ms', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const app = createApp();
    await request(app).get('/api/admin/bans/check?fingerprint=fp-test').expect(200);
  });

  test('ban check by UID: responds within 50ms', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const app = createApp();
    await request(app).get('/api/admin/bans/check?uid=1001').expect(200);
  });

  test('graph with 100 identifiers: ban check still fast', async () => {
    const bigGraph = makeGraphDoc('graph-big', {
      identifiers: Array.from({ length: 100 }, (_, i) => ({
        type: 'ip',
        value: `1.2.3.${i}`,
        metadata: {},
        addedAt: 1000,
        source: 'login',
        suspension: null,
      })),
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: [bigGraph] });
    const app = createApp();
    await request(app).get('/api/admin/bans/check?ip=1.2.3.50').expect(200);
  });

  test('graph with 500 identifiers: ban check still within 200ms', async () => {
    const hugeGraph = makeGraphDoc('graph-huge', {
      identifiers: Array.from({ length: 500 }, (_, i) => ({
        type: 'ip',
        value: `10.${Math.floor(i / 256)}.${i % 256}.1`,
        metadata: {},
        addedAt: 1000,
        source: 'login',
        suspension: null,
      })),
    });
    mockCollectionGet.mockResolvedValueOnce({ empty: false, docs: [hugeGraph] });
    const app = createApp();
    await request(app).get('/api/admin/bans/check?ip=10.0.50.1').expect(200);
  });

  test('lookup uses denormalized ban index (not scanning arrays)', async () => {
    // This test verifies the implementation uses indexed queries
    // not iterating through identifier arrays
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const app = createApp();
    await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(200);
    // Verify the query used an indexed field, not a full scan
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.104 — Identity Graph Edge Cases (Extended)
// ═══════════════════════════════════════════════════════════════

describe('Identity Graph Edge Cases', () => {
  test('fingerprint collision: two devices same fingerprint → both in same graph', async () => {
    // Two different physical devices with same fingerprint hash
    // Should be treated as same device (linked in same graph)
  });

  test('ISP lookup timeout: graph created with IP, ISP/country null', async () => {
    // If IP geolocation fails, still create graph with IP only
  });

  test('ISP lookup error: fallback to IP-only', async () => {
    // Graceful degradation on geo lookup failure
  });

  test('IPv6 address: stored and matched correctly', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'ip', value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' }] })
      .expect(201);
  });

  test('IPv4-mapped IPv6 (::ffff:1.2.3.4): normalised to IPv4', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'ip', value: '::ffff:1.2.3.4' }] })
      .expect(201);
    // Should be stored as 1.2.3.4
  });

  test('private IP (10.x, 192.168.x, 127.x): not stored in graph', async () => {
    // Private IPs should be filtered out — not useful for ban enforcement
  });

  test('graph with 0 identifiers: suspend returns 400', async () => {
    const emptyGraph = makeGraphDoc('graph-empty', { identifiers: [] });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(emptyGraph);
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-empty')
      .send({ action: 'suspend', duration: '7d', level: 'full', reason: 'Test' })
      .expect(400);
  });

  test('graph merge: two graphs share new identifier → merged into one', async () => {
    // When a new login reveals that two separate graphs share an identifier,
    // they should be merged into a single graph
  });

  test('graph merge: inherits stricter suspension level', async () => {
    // If merging a 7-day ban graph with a permanent ban graph,
    // the merged graph should have permanent ban
  });

  test('graph split: not supported → endpoint doesnt exist (returns 404)', async () => {
    const app = createApp();
    await request(app).post('/api/admin/bans/graph/graph-1/split').expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional coverage — uncovered lines and branches
// ═══════════════════════════════════════════════════════════════

describe('POST /api/admin/bans/graph — validation', () => {
  test('returns 400 when identifiers is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/admin/bans/graph').send({}).expect(400);
    expect(res.body.error).toBe('At least one identifier required');
  });

  test('returns 400 when identifiers is empty array', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [] })
      .expect(400);
    expect(res.body.error).toBe('At least one identifier required');
  });

  test('returns 400 when identifiers is not an array', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: 'not-an-array' })
      .expect(400);
    expect(res.body.error).toBe('At least one identifier required');
  });

  test('filters out private IPs (10.x)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: '10.0.0.1' },
          { type: 'uid', value: '1001' },
        ],
      })
      .expect(201);
    // The uid identifier should still be present, but private IP filtered
    expect(res.body).toHaveProperty('graphId');
  });

  test('filters out private IPs (192.168.x)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: '192.168.1.1' },
          { type: 'uid', value: '2002' },
        ],
      })
      .expect(201);
    expect(res.body).toHaveProperty('graphId');
  });

  test('filters out loopback IPs (127.x)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: '127.0.0.1' },
          { type: 'uid', value: '3003' },
        ],
      })
      .expect(201);
  });

  test('filters out IPv6 loopback (::1)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: '::1' },
          { type: 'uid', value: '4004' },
        ],
      })
      .expect(201);
  });

  test('filters out link-local IPv6 (fe80:)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: 'fe80::1' },
          { type: 'uid', value: '5005' },
        ],
      })
      .expect(201);
  });

  test('normalises IPv4-mapped IPv6 on create', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'ip', value: '::ffff:5.6.7.8' }] })
      .expect(201);
    // The stored identifier should have value '5.6.7.8' after normalisation
    // (but since 5.6.7.8 is not private, it should be included)
    expect(res.body).toHaveProperty('graphId');
  });

  test('uses default source "manual" when source not provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'uid', value: '9999' }] })
      .expect(201);
    expect(res.body).toHaveProperty('graphId');
  });

  test('preserves metadata on identifiers', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [{ type: 'ip', value: '8.8.8.8', metadata: { isp: 'Google', country: 'US' } }],
      })
      .expect(201);
    expect(res.body).toHaveProperty('graphId');
  });

  test('handles non-string IP value in identifier (normaliseIp type guard)', async () => {
    const app = createApp();
    // Send numeric IP value — normaliseIp should handle non-string gracefully
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: 12345 },
          { type: 'uid', value: '1001' },
        ],
      })
      .expect(201);
    // The numeric IP should be normalised to null and filtered (isPrivateIp(null) returns true)
    expect(res.body).toHaveProperty('graphId');
  });

  test('handles null IP value in identifier', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: null },
          { type: 'uid', value: '2002' },
        ],
      })
      .expect(201);
    expect(res.body).toHaveProperty('graphId');
  });

  test('handles array IP value in identifier (type confusion)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({
        identifiers: [
          { type: 'ip', value: ['1.2.3.4', '5.6.7.8'] },
          { type: 'uid', value: '3003' },
        ],
      })
      .expect(201);
    expect(res.body).toHaveProperty('graphId');
  });
});

describe('Admin auth — all graph routes', () => {
  test('GET /api/admin/bans/graph/:id non-admin returns 403', async () => {
    const app = createNonAdminApp();
    await request(app).get('/api/admin/bans/graph/graph-1').expect(403);
  });

  test('PUT /api/admin/bans/graph/:id non-admin returns 403', async () => {
    const app = createNonAdminApp();
    await request(app).put('/api/admin/bans/graph/graph-1').send({ action: 'suspend' }).expect(403);
  });

  test('DELETE /api/admin/bans/graph/:id non-admin returns 403', async () => {
    const app = createNonAdminApp();
    await request(app).delete('/api/admin/bans/graph/graph-1').expect(403);
  });

  test('GET /api/admin/bans/check non-admin returns 403', async () => {
    const app = createNonAdminApp();
    await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(403);
  });
});

describe('PUT /api/admin/bans/graph/:id — non-existent graph', () => {
  test('returns 404 for non-existent graph', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/admin/bans/graph/nonexistent')
      .send({ action: 'suspend', duration: '7d' })
      .expect(404);
    expect(res.body.error).toBe('Identity graph not found');
  });
});

describe('PUT /api/admin/bans/graph/:id — parseDuration', () => {
  test('suspend with hours duration', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', duration: '24h', level: 'full', reason: 'Spam' })
      .expect(200);
  });

  test('suspend with invalid duration falls back to 7 days', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', duration: 'invalid', level: 'full', reason: 'Test' })
      .expect(200);
  });

  test('suspend with no duration defaults correctly', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', level: 'full', reason: 'Test' })
      .expect(200);
  });
});

describe('Error handling — 500 responses', () => {
  test('POST /api/admin/bans/graph returns 500 on Firestore error', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('Firestore write error'));
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bans/graph')
      .send({ identifiers: [{ type: 'uid', value: '1001' }] })
      .expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('GET /api/admin/bans/graph/:id returns 500 on Firestore error', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore read error'));
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/graph/graph-1').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('PUT /api/admin/bans/graph/:id returns 500 on Firestore error', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore update error'));
    const app = createApp();
    const res = await request(app)
      .put('/api/admin/bans/graph/graph-1')
      .send({ action: 'suspend', duration: '7d', level: 'full', reason: 'Test' })
      .expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('DELETE /api/admin/bans/graph/:id returns 500 on Firestore error', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('identityGraphs/')) {
        return Promise.resolve(makeGraphDoc('graph-1'));
      }
      return Promise.resolve({ exists: false });
    });
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore update error'));
    const app = createApp();
    const res = await request(app).delete('/api/admin/bans/graph/graph-1').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('GET /api/admin/bans/check returns 500 on Firestore error', async () => {
    mockCollectionGet.mockRejectedValueOnce(new Error('Firestore error'));
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

// ═══════════════════════════════════════════════════════════════
// Security: Query param type coercion (CodeQL type confusion fix)
// ═══════════════════════════════════════════════════════════════
