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
const mockWhere = jest.fn(() => ({ get: mockQueryGet }));
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
  // Start at 0 so the first call exercises the exists:false / cold-start branch
  transactionUniqueIdCounter = 0;
  mockTransactionGet.mockImplementation(() => {
    const current = transactionUniqueIdCounter;
    return Promise.resolve({
      exists: current > 0,
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
        users: [
          {
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
          },
        ],
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
        users: [
          {
            name: 'ip-test-user',
            deviceInfo: {
              deviceId: 'ip-test-device',
              lastIp: '203.0.113.99',
            },
          },
        ],
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
        users: [
          {
            name: 'no-ip-user',
            deviceInfo: {
              deviceId: 'no-ip-device',
              manufacturer: 'Samsung',
              model: 'Galaxy S21',
            },
          },
        ],
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
        users: [
          {
            name: 'minimal-device-user',
            deviceInfo: {
              deviceId: 'minimal-device',
            },
          },
        ],
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
    expect(mockDoc).not.toHaveBeenCalledWith(expect.stringContaining('deviceBindings/'));
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

  test('deletes matching user docs with subcollections for given testRunId', async () => {
    // User doc refs need .collection() for subcollection traversal + .delete() + .data()
    const userRef1 = {
      id: 'user1',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };
    const userRef2 = {
      id: 'user2',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };

    // First query (users) returns 2 docs, rest return empty
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [
            { ref: userRef1, data: () => ({ uniqueId: 1001, _testRun: 'test_run123' }) },
            { ref: userRef2, data: () => ({ uniqueId: 1002, _testRun: 'test_run123' }) },
          ],
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
    expect(res.body.deleted).toBe(2); // 2 user docs
    expect(mockWhere).toHaveBeenCalledWith('_testRun', '==', 'test_run123');
    // User docs themselves should be deleted via deleteDocWithSubcollections
    expect(userRef1.delete).toHaveBeenCalled();
    expect(userRef2.delete).toHaveBeenCalled();
    // Subcollections should be traversed
    expect(userRef1.collection).toHaveBeenCalledWith('warnings');
    expect(userRef1.collection).toHaveBeenCalledWith('transactions');
    expect(userRef1.collection).toHaveBeenCalledWith('backpack');
  });

  test('queries all expected collections during teardown', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_run456' })
      .expect(200);

    // New implementation queries: users, deviceBindings, deviceBans (0 users so no ban queries),
    // then gifts, rooms, banners, funFacts, conversations = 7 collections total
    const expectedCollections = [
      'users',
      'deviceBindings',
      'gifts',
      'rooms',
      'banners',
      'funFacts',
      'conversations',
    ];
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
    const userRef = {
      id: 'test-user',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };
    let callCount = 0;
    mockQueryGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First query is users
        return Promise.resolve({
          empty: false,
          docs: [{ ref: userRef, data: () => ({ uniqueId: 9999, _testRun: 'test_old' }) }],
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

  test('queries all expected collections during reset', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(200);

    const expectedCollections = [
      'users',
      'deviceBindings',
      'gifts',
      'rooms',
      'banners',
      'funFacts',
      'conversations',
    ];
    for (const col of expectedCollections) {
      expect(mockCollection).toHaveBeenCalledWith(col);
    }
  });

  test('returns 500 when Firestore query throws during reset', async () => {
    mockQueryGet.mockRejectedValue(new Error('Firestore query failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/reset')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send()
      .expect(500);

    expect(res.body.error).toBe('Firestore query failed');
  });
});

// ─── deleteTestData (exported) ───────────────────────────────────

describe('deleteTestData (exported function)', () => {
  const { deleteTestData } = require('../../src/routes/test-helpers');

  test('is exported and callable', () => {
    expect(typeof deleteTestData).toBe('function');
  });

  test('deletes user subcollections, device bindings, device bans, and network bans', async () => {
    // --- Arrange ---
    const testRunId = 'test_recursive_teardown';
    const userUniqueId = 10000042;

    // Mock subcollection doc refs for deletion tracking
    const warningRef = { id: 'w1' };
    const transactionRef = { id: 't1' };
    const backpackRef = { id: 'g1' };
    const deviceBanRef = { id: 'deviceBan1', delete: jest.fn().mockResolvedValue() };
    const networkBanRef = { id: 'networkBan1', delete: jest.fn().mockResolvedValue() };

    // Subcollection snapshots returned by docRef.collection(sub).get()
    const subcollectionSnapshots = {
      warnings: { docs: [{ ref: warningRef }], size: 1 },
      transactions: { docs: [{ ref: transactionRef }], size: 1 },
      backpack: { docs: [{ ref: backpackRef }], size: 1 },
    };

    // User doc ref needs .collection() for subcollection traversal + .delete()
    const userDocRef = {
      id: String(userUniqueId),
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn((sub) => ({
        get: jest.fn().mockResolvedValue(subcollectionSnapshots[sub] || { docs: [], size: 0 }),
      })),
    };

    // Track which collections are queried and return appropriate data
    const collectionQueryResults = {
      users: {
        docs: [
          {
            ref: userDocRef,
            data: () => ({ uniqueId: userUniqueId, _testRun: testRunId }),
          },
        ],
        size: 1,
        empty: false,
      },
      deviceBindings: {
        docs: [{ ref: { id: 'binding1' } }],
        size: 1,
        empty: false,
      },
      deviceBans: {
        docs: [{ ref: deviceBanRef }],
        size: 1,
        empty: false,
      },
      networkBans: {
        docs: [{ ref: networkBanRef }],
        size: 1,
        empty: false,
      },
    };

    // Override mockCollection to track which collection is queried and with which where clause
    mockCollection.mockImplementation((colName) => ({
      where: jest.fn((field, op, value) => {
        // For ban collections, match on linkedUniqueId
        if (colName === 'deviceBans' || colName === 'networkBans') {
          if (field === 'linkedUniqueId' && value === userUniqueId) {
            return { get: jest.fn().mockResolvedValue(collectionQueryResults[colName]) };
          }
          // String variant query — return empty
          return { get: jest.fn().mockResolvedValue({ docs: [], size: 0, empty: true }) };
        }
        // For _testRun queries
        const result = collectionQueryResults[colName] || { docs: [], size: 0, empty: true };
        return {
          get: jest.fn().mockResolvedValue(result),
          limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue(result) })),
        };
      }),
    }));

    // --- Act ---
    const deleted = await deleteTestData(testRunId);

    // --- Assert ---

    // 1. User subcollections were queried and deleted via batch
    expect(userDocRef.collection).toHaveBeenCalledWith('warnings');
    expect(userDocRef.collection).toHaveBeenCalledWith('transactions');
    expect(userDocRef.collection).toHaveBeenCalledWith('backpack');

    // Subcollection docs deleted via batch
    expect(mockBatchDelete).toHaveBeenCalledWith(warningRef);
    expect(mockBatchDelete).toHaveBeenCalledWith(transactionRef);
    expect(mockBatchDelete).toHaveBeenCalledWith(backpackRef);

    // User doc itself was deleted
    expect(userDocRef.delete).toHaveBeenCalled();

    // 2. Device bans and network bans were deleted
    expect(deviceBanRef.delete).toHaveBeenCalled();
    expect(networkBanRef.delete).toHaveBeenCalled();

    // 3. Total deleted count includes: 1 user + 1 binding + 1 device ban + 1 network ban + other collections (0)
    // The exact count depends on implementation but should be > 0
    expect(deleted).toBeGreaterThanOrEqual(4);
  });

  test('handles teardown with no subcollection data', async () => {
    const testRunId = 'test_no_subcollections';

    const userDocRef = {
      id: '999',
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };

    mockCollection.mockImplementation((colName) => ({
      where: jest.fn(() => {
        if (colName === 'users') {
          return {
            get: jest.fn().mockResolvedValue({
              docs: [{ ref: userDocRef, data: () => ({ uniqueId: 999, _testRun: testRunId }) }],
              size: 1,
              empty: false,
            }),
          };
        }
        return {
          get: jest.fn().mockResolvedValue({ docs: [], size: 0, empty: true }),
        };
      }),
    }));

    const deleted = await deleteTestData(testRunId);

    // User doc deleted, subcollections empty — still deletes the user doc
    expect(userDocRef.delete).toHaveBeenCalled();
    expect(deleted).toBeGreaterThanOrEqual(1);
  });

  test('queries both number and string variants for ban linkedUniqueId', async () => {
    const testRunId = 'test_uid_variants';
    const userUniqueId = 42;
    const queriedLinkedUniqueIds = [];

    const userDocRef = {
      id: String(userUniqueId),
      delete: jest.fn().mockResolvedValue(),
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
      })),
    };

    mockCollection.mockImplementation((colName) => ({
      where: jest.fn((field, op, value) => {
        if (field === 'linkedUniqueId') {
          queriedLinkedUniqueIds.push({ collection: colName, value });
        }
        if (colName === 'users') {
          return {
            get: jest.fn().mockResolvedValue({
              docs: [
                { ref: userDocRef, data: () => ({ uniqueId: userUniqueId, _testRun: testRunId }) },
              ],
              size: 1,
              empty: false,
            }),
          };
        }
        return {
          get: jest.fn().mockResolvedValue({ docs: [], size: 0, empty: true }),
        };
      }),
    }));

    await deleteTestData(testRunId);

    // Should query deviceBans and networkBans with BOTH number and string variants
    const deviceBanQueries = queriedLinkedUniqueIds.filter((q) => q.collection === 'deviceBans');
    const networkBanQueries = queriedLinkedUniqueIds.filter((q) => q.collection === 'networkBans');

    expect(deviceBanQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: userUniqueId }),
        expect.objectContaining({ value: String(userUniqueId) }),
      ]),
    );
    expect(networkBanQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: userUniqueId }),
        expect.objectContaining({ value: String(userUniqueId) }),
      ]),
    );
  });
});
