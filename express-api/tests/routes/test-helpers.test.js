const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockDocSet,
  delete: mockDocDelete,
}));

const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatch = jest.fn(() => ({
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

const mockQueryGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockQueryGet }));
const mockWhere = jest.fn(() => ({ limit: mockLimit }));
const mockCollection = jest.fn(() => ({ where: mockWhere }));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    batch: (...args) => mockBatch(...args),
    collection: (...args) => mockCollection(...args),
  },
}));

let mockIdCounter = 0;
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => `id${++mockIdCounter}`),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const testHelpersRouter = require('../../src/routes/test-helpers');

const VALID_API_KEY = 'test-secret-key-123';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', testHelpersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdCounter = 0;
  process.env.TEST_API_KEY = VALID_API_KEY;

  // Restore default mock implementations after clearAllMocks
  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockBatchCommit.mockResolvedValue();
  mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
});

// ─── API key guard ──────────────────────────────────────────────

describe('X-Test-Api-Key guard', () => {
  const protectedEndpoints = [
    { method: 'post', path: '/api/test/setup' },
    { method: 'get', path: '/api/test/verify/users/some-id' },
    { method: 'post', path: '/api/test/teardown' },
    { method: 'post', path: '/api/test/reset' },
  ];

  test.each(protectedEndpoints)(
    'returns 403 when X-Test-Api-Key header is missing ($method $path)',
    async ({ method, path }) => {
      const app = createApp();
      const res = await request(app)[method](path).send({}).expect(403);

      expect(res.body.error).toBe('Invalid test API key');
    },
  );

  test.each(protectedEndpoints)(
    'returns 403 when X-Test-Api-Key header is wrong ($method $path)',
    async ({ method, path }) => {
      const app = createApp();
      const res = await request(app)
        [method](path)
        .set('X-Test-Api-Key', 'wrong-key')
        .send({})
        .expect(403);

      expect(res.body.error).toBe('Invalid test API key');
    },
  );

  test.each(protectedEndpoints)(
    'accepts request when X-Test-Api-Key header is correct ($method $path)',
    async ({ method, path }) => {
      const app = createApp();

      // Provide minimal valid bodies / mock returns so the endpoint doesn't 400
      if (path.includes('verify')) {
        mockDocGet.mockResolvedValue({
          exists: true,
          id: 'some-id',
          data: () => ({ name: 'test' }),
        });
      }
      if (path.includes('teardown')) {
        const res = await request(app)
          [method](path)
          .set('X-Test-Api-Key', VALID_API_KEY)
          .send({ testRunId: 'test_abc123' });
        expect(res.status).not.toBe(403);
        return;
      }

      const res = await request(app)[method](path).set('X-Test-Api-Key', VALID_API_KEY).send({});
      expect(res.status).not.toBe(403);
    },
  );
});

// ─── POST /api/test/setup ────────────────────────────────────────

describe('POST /api/test/setup', () => {
  test('returns testRunId and empty arrays when no spec provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    expect(res.body.testRunId).toMatch(/^test_/);
    expect(res.body.users).toEqual([]);
    expect(res.body.rooms).toEqual([]);
    expect(res.body.gifts).toEqual([]);
    expect(res.body.conversations).toEqual([]);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('creates test users with correct defaults and _testRun tag', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'Alice' }] })
      .expect(200);

    expect(res.body.users).toHaveLength(1);
    const user = res.body.users[0];
    expect(user.displayName).toBe('[TEST] Alice');
    expect(user.userType).toBe('MEMBER');
    expect(user.coins).toBe(1000);
    expect(user.beans).toBe(0);
    expect(user.gcs).toBe(100);
    expect(user._testRun).toBe(res.body.testRunId);
    expect(user.uid).toContain(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`users/${user.uid}`);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ uid: user.uid }));
  });

  test('creates test user with custom role and coins', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'Admin', role: 'ADMIN', coins: 5000, beans: 200 }] })
      .expect(200);

    const user = res.body.users[0];
    expect(user.userType).toBe('ADMIN');
    expect(user.coins).toBe(5000);
    expect(user.beans).toBe(200);
  });

  test('creates test user with default name when name not specified', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{}] })
      .expect(200);

    expect(res.body.users[0].displayName).toBe('[TEST] User');
  });

  test('creates test rooms with correct defaults', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'Owner' }], rooms: [{ name: 'Party' }] })
      .expect(200);

    expect(res.body.rooms).toHaveLength(1);
    const room = res.body.rooms[0];
    expect(room.name).toBe('[TEST] Party');
    expect(room.status).toBe('ACTIVE');
    expect(room.ownerId).toBe(res.body.users[0].uid);
    expect(room._testRun).toBe(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`rooms/${room.id}`);
  });

  test('creates test room with custom ownerId and status', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ rooms: [{ name: 'Room', ownerId: 'custom-owner', status: 'CLOSED' }] })
      .expect(200);

    const room = res.body.rooms[0];
    expect(room.ownerId).toBe('custom-owner');
    expect(room.status).toBe('CLOSED');
  });

  test('creates test room with testRunId as ownerId when no users created', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ rooms: [{ name: 'Orphan Room' }] })
      .expect(200);

    expect(res.body.rooms[0].ownerId).toBe(res.body.testRunId);
  });

  test('creates test gifts with correct defaults', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ gifts: [{ name: 'Rose', coinValue: 50 }] })
      .expect(200);

    expect(res.body.gifts).toHaveLength(1);
    const gift = res.body.gifts[0];
    expect(gift.name).toBe('[TEST] Rose');
    expect(gift.coinValue).toBe(50);
    expect(gift.showInStore).toBe(true);
    expect(gift.showOnWheel).toBe(true);
    expect(gift.weight).toBe(1.0);
    expect(gift.order).toBe(0);
    expect(gift.animationUrl).toBe('');
    expect(gift.soundUrl).toBe('');
    expect(gift.iconUrl).toBe('');
    expect(gift._testRun).toBe(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`gifts/${gift.id}`);
  });

  test('creates gift with default values when coinValue not specified', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ gifts: [{}] })
      .expect(200);

    const gift = res.body.gifts[0];
    expect(gift.name).toBe('[TEST] Gift');
    expect(gift.coinValue).toBe(10);
  });

  test('creates multiple entities in a single setup call', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{ name: 'A' }, { name: 'B' }],
        rooms: [{ name: 'R1' }],
        gifts: [{ name: 'G1' }, { name: 'G2' }, { name: 'G3' }],
      })
      .expect(200);

    expect(res.body.users).toHaveLength(2);
    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.gifts).toHaveLength(3);
    // 2 users + 1 room + 3 gifts = 6 Firestore writes
    expect(mockDocSet).toHaveBeenCalledTimes(6);
  });

  test('returns 500 when Firestore set throws', async () => {
    mockDocSet.mockRejectedValue(new Error('Firestore write failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'Failing' }] })
      .expect(500);

    expect(res.body.error).toBe('Firestore write failed');
  });
});

// ─── GET /api/test/verify/:collection/:id ───────────────────────

describe('GET /api/test/verify/:collection/:id', () => {
  const ALLOWED_COLLECTIONS = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];

  test.each(ALLOWED_COLLECTIONS)(
    'returns document data for allowed collection "%s"',
    async (collection) => {
      mockDocGet.mockResolvedValue({
        exists: true,
        id: 'doc-123',
        data: () => ({ name: 'test-item', _testRun: 'test_abc' }),
      });

      const app = createApp();
      const res = await request(app)
        .get(`/api/test/verify/${collection}/doc-123`)
        .set('X-Test-Api-Key', VALID_API_KEY)
        .expect(200);

      expect(res.body.id).toBe('doc-123');
      expect(res.body.name).toBe('test-item');
      expect(mockDoc).toHaveBeenCalledWith(`${collection}/doc-123`);
    },
  );

  test('returns 400 for disallowed collection', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/test/verify/secrets/doc-123')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .expect(400);

    expect(res.body.error).toBe('Collection not allowed');
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  test.each(['adminAuditLog', 'config', 'tokens', 'sessions'])(
    'returns 400 for disallowed collection "%s"',
    async (collection) => {
      const app = createApp();
      const res = await request(app)
        .get(`/api/test/verify/${collection}/doc-123`)
        .set('X-Test-Api-Key', VALID_API_KEY)
        .expect(400);

      expect(res.body.error).toBe('Collection not allowed');
    },
  );

  test('returns 404 when document does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app)
      .get('/api/test/verify/users/nonexistent')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .expect(404);

    expect(res.body.error).toBe('Document not found');
  });

  test('returns 500 when Firestore get throws', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore read error'));

    const app = createApp();
    const res = await request(app)
      .get('/api/test/verify/users/doc-123')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .expect(500);

    expect(res.body.error).toBe('Firestore read error');
  });
});

// ─── POST /api/test/teardown ────────────────────────────────────

describe('POST /api/test/teardown', () => {
  test('returns 400 when testRunId is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(400);

    expect(res.body.error).toBe('Invalid testRunId');
  });

  test('returns 400 when testRunId does not start with test_ prefix', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'invalid_prefix_123' })
      .expect(400);

    expect(res.body.error).toBe('Invalid testRunId');
  });

  test('returns 400 when testRunId is empty string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: '' })
      .expect(400);

    expect(res.body.error).toBe('Invalid testRunId');
  });

  test('deletes matching docs across all collections for given testRunId', async () => {
    const mockRef1 = { id: 'doc1' };
    const mockRef2 = { id: 'doc2' };

    // First collection (users) returns 2 docs, rest return empty
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [{ ref: mockRef1 }, { ref: mockRef2 }],
          size: 2,
        });
      }
      return Promise.resolve({ empty: true, docs: [], size: 0 });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_run123' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(2);
    expect(mockWhere).toHaveBeenCalledWith('_testRun', '==', 'test_run123');
    expect(mockBatchDelete).toHaveBeenCalledWith(mockRef1);
    expect(mockBatchDelete).toHaveBeenCalledWith(mockRef2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('queries all 6 collections during teardown', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_run456' })
      .expect(200);

    const expectedCollections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
    expect(mockCollection).toHaveBeenCalledTimes(expectedCollections.length);
    for (const col of expectedCollections) {
      expect(mockCollection).toHaveBeenCalledWith(col);
    }
  });

  test('returns deleted count of 0 when no test data found', async () => {
    mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_empty' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(0);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('returns 500 when Firestore query throws', async () => {
    mockQueryGet.mockRejectedValue(new Error('Firestore query failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_fail' })
      .expect(500);

    expect(res.body.error).toBe('Firestore query failed');
  });
});

// ─── POST /api/test/reset ───────────────────────────────────────

describe('POST /api/test/reset', () => {
  test('deletes ALL test data across all collections using range query', async () => {
    const mockRef = { id: 'test-doc' };
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [{ ref: mockRef }],
          size: 1,
        });
      }
      return Promise.resolve({ empty: true, docs: [], size: 0 });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(1);
    // Reset uses >= range query instead of == exact match
    expect(mockWhere).toHaveBeenCalledWith('_testRun', '>=', 'test_');
  });

  test('queries all 6 collections during reset', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(200);

    const expectedCollections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
    expect(mockCollection).toHaveBeenCalledTimes(expectedCollections.length);
    for (const col of expectedCollections) {
      expect(mockCollection).toHaveBeenCalledWith(col);
    }
  });

  test('limits each query to 500 documents', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(200);

    // Each of the 6 collections should call .limit(500)
    expect(mockLimit).toHaveBeenCalledTimes(6);
    for (const call of mockLimit.mock.calls) {
      expect(call[0]).toBe(500);
    }
  });

  test('returns 500 when batch commit throws', async () => {
    mockQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ ref: { id: 'doc1' } }],
      size: 1,
    });
    mockBatchCommit.mockRejectedValue(new Error('Batch commit failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(500);

    expect(res.body.error).toBe('Batch commit failed');
  });
});

// ─── deleteTestData (exported) ───────────────────────────────────

describe('deleteTestData (exported function)', () => {
  const { deleteTestData } = require('../../src/routes/test-helpers');

  test('is exported and callable', () => {
    expect(typeof deleteTestData).toBe('function');
  });

  test('uses exact match query when testRunId is provided', async () => {
    mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

    await deleteTestData('test_specific');

    expect(mockWhere).toHaveBeenCalledWith('_testRun', '==', 'test_specific');
  });

  test('uses range query when testRunId is null', async () => {
    mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

    await deleteTestData(null);

    expect(mockWhere).toHaveBeenCalledWith('_testRun', '>=', 'test_');
  });

  test('returns total deleted count across multiple collections', async () => {
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          empty: false,
          docs: [{ ref: { id: `doc${callCount}` } }, { ref: { id: `doc${callCount}b` } }],
          size: 2,
        });
      }
      return Promise.resolve({ empty: true, docs: [], size: 0 });
    });

    const result = await deleteTestData(null);

    expect(result).toBe(4); // 2 docs from 2 collections
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });
});
