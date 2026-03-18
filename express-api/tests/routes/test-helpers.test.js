const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockDocSet,
  update: mockDocUpdate,
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

// Transaction mock: calls the callback with a transaction object that has get/set
let transactionUniqueIdCounter = 10000000;
const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();
const mockRunTransaction = jest.fn(async (callback) => {
  const transaction = {
    get: mockTransactionGet,
    set: mockTransactionSet,
  };
  return callback(transaction);
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    batch: (...args) => mockBatch(...args),
    collection: (...args) => mockCollection(...args),
    runTransaction: (...args) => mockRunTransaction(...args),
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
  transactionUniqueIdCounter = 10000000;
  process.env.TEST_API_KEY = VALID_API_KEY;

  // Restore default mock implementations after clearAllMocks
  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockBatchCommit.mockResolvedValue();
  mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });

  // Transaction mock: simulate atomic counter increment
  mockTransactionGet.mockImplementation(() => {
    const current = transactionUniqueIdCounter;
    return Promise.resolve({
      exists: current > 10000000,
      data: () => ({ value: current }),
    });
  });
  mockTransactionSet.mockImplementation((ref, data) => {
    // Simulate the counter being incremented so next call gets the new value
    if (data && data.value) {
      transactionUniqueIdCounter = data.value;
    }
  });
  mockRunTransaction.mockImplementation(async (callback) => {
    const transaction = {
      get: mockTransactionGet,
      set: mockTransactionSet,
    };
    return callback(transaction);
  });
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
    expect(user.displayName).toBe('Alice');
    expect(user.userType).toBe('MEMBER');
    expect(user.shyCoins).toBe(0);
    expect(user.shyBeans).toBe(0);
    expect(user.gcsScore).toBe(100);
    expect(user._testRun).toBe(res.body.testRunId);
    expect(user.uid).toContain(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`users/${user.uniqueId}`);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ uid: user.uid }));
  });

  test('creates test user with custom role and shyCoins', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'Admin', role: 'ADMIN', shyCoins: 5000, shyBeans: 200 }] })
      .expect(200);

    const user = res.body.users[0];
    expect(user.userType).toBe('ADMIN');
    expect(user.shyCoins).toBe(5000);
    expect(user.shyBeans).toBe(200);
  });

  test('creates test user with default name when name not specified', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{}] })
      .expect(200);

    expect(res.body.users[0].displayName).toMatch(/^Test User \d+$/);
  });

  test('uniqueId allocation — assigns numeric uniqueId and uses production field names', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'test-uid-alloc', shyCoins: 100, shyBeans: 50 }] })
      .expect(200);

    expect(res.body.users).toHaveLength(1);
    const user = res.body.users[0];

    // uniqueId must be a number > 0
    expect(typeof user.uniqueId).toBe('number');
    expect(user.uniqueId).toBeGreaterThan(0);

    // uid must be present
    expect(user.uid).toBeTruthy();

    // firebaseUid must match uid
    expect(user.firebaseUid).toBe(user.uid);

    // Production field names (not coins/beans/gcs)
    expect(user.shyCoins).toBe(100);
    expect(user.shyBeans).toBe(50);
    expect(user.gcsScore).toBe(100);
    expect(user.warningCount).toBe(0);
    expect(user.hasActiveWarning).toBe(false);
    expect(user.luckScore).toBe(0);
    expect(user.pityCounter).toBe(0);
    expect(user.isSuspended).toBe(false);

    // Old field names must NOT be present
    expect(user.coins).toBeUndefined();
    expect(user.beans).toBeUndefined();
    expect(user.gcs).toBeUndefined();

    // Firestore doc stored at users/{uniqueId}
    expect(mockDoc).toHaveBeenCalledWith(`users/${user.uniqueId}`);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uniqueId: user.uniqueId,
        uid: user.uid,
        firebaseUid: user.uid,
        shyCoins: 100,
        shyBeans: 50,
        gcsScore: 100,
      }),
    );

    // Transaction was used for atomic counter
    expect(mockRunTransaction).toHaveBeenCalled();
    expect(mockTransactionGet).toHaveBeenCalled();
    expect(mockTransactionSet).toHaveBeenCalled();
  });

  test('uniqueId allocation — multiple users get sequential uniqueIds', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'User1' }, { name: 'User2' }] })
      .expect(200);

    expect(res.body.users).toHaveLength(2);
    const [u1, u2] = res.body.users;
    expect(typeof u1.uniqueId).toBe('number');
    expect(typeof u2.uniqueId).toBe('number');
    // Each should have a different uniqueId
    expect(u1.uniqueId).not.toBe(u2.uniqueId);
  });

  test('creates deviceBinding doc when user.deviceInfo is provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{
          name: 'e2e-chromium-user',
          shyCoins: 1000,
          shyBeans: 500,
          deviceInfo: {
            deviceId: 'e2e-chromium-device-1',
            manufacturer: 'Google',
            model: 'Pixel 6',
            lastIp: '203.0.113.1',
            isp: 'Test ISP',
          },
        }],
      })
      .expect(200);

    const user = res.body.users[0];

    // deviceBindings/{deviceId} doc should be created
    expect(mockDoc).toHaveBeenCalledWith('deviceBindings/e2e-chromium-device-1');
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'e2e-chromium-device-1',
        uniqueId: user.uniqueId,
        manufacturer: 'Google',
        model: 'Pixel 6',
        lastIp: '203.0.113.1',
        isp: 'Test ISP',
        _testRun: res.body.testRunId,
      }),
    );

    // uniqueId in binding doc must be a number (Firestore type-sensitive)
    const bindingSetCall = mockDocSet.mock.calls.find(
      (call) => call[0] && call[0].deviceId === 'e2e-chromium-device-1',
    );
    expect(bindingSetCall).toBeTruthy();
    expect(typeof bindingSetCall[0].uniqueId).toBe('number');

    // boundAt should be a number (timestamp)
    expect(typeof bindingSetCall[0].boundAt).toBe('number');
    expect(bindingSetCall[0].boundAt).toBeGreaterThan(0);
  });

  test('sets lastIp on user doc when deviceInfo.lastIp is provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{
          name: 'ip-test-user',
          deviceInfo: {
            deviceId: 'ip-test-device',
            lastIp: '203.0.113.99',
          },
        }],
      })
      .expect(200);

    const user = res.body.users[0];

    // user doc should be updated with lastIp
    expect(mockDoc).toHaveBeenCalledWith(`users/${user.uniqueId}`);
    expect(mockDocUpdate).toHaveBeenCalledWith({ lastIp: '203.0.113.99' });
  });

  test('does not call update on user doc when lastIp is not provided', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{
          name: 'no-ip-user',
          deviceInfo: {
            deviceId: 'no-ip-device',
            manufacturer: 'Samsung',
            model: 'Galaxy S21',
          },
        }],
      })
      .expect(200);

    // update should NOT be called since lastIp was not provided
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('deviceBinding uses default values for missing manufacturer/model', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{
          name: 'minimal-device-user',
          deviceInfo: {
            deviceId: 'minimal-device',
          },
        }],
      })
      .expect(200);

    // Should use 'Unknown' defaults for manufacturer and model
    const bindingSetCall = mockDocSet.mock.calls.find(
      (call) => call[0] && call[0].deviceId === 'minimal-device',
    );
    expect(bindingSetCall).toBeTruthy();
    expect(bindingSetCall[0].manufacturer).toBe('Unknown');
    expect(bindingSetCall[0].model).toBe('Unknown');
    expect(bindingSetCall[0].lastIp).toBeNull();
    expect(bindingSetCall[0].isp).toBeNull();
  });

  test('does not create deviceBinding when deviceInfo is not provided', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ users: [{ name: 'no-device-user' }] })
      .expect(200);

    // Only user doc should be set, no deviceBindings
    expect(mockDoc).not.toHaveBeenCalledWith(
      expect.stringContaining('deviceBindings/'),
    );
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
