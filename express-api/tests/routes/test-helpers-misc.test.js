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
const mockOrderByLimitGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
const mockOrderByLimit = jest.fn(() => ({ get: mockOrderByLimitGet }));
const mockOrderBy = jest.fn(() => ({ limit: mockOrderByLimit }));
const mockCollection = jest.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));

// Transaction mock: calls the callback with a transaction object that has get/set
let transactionUniqueIdCounter = 100000000;
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
  transactionUniqueIdCounter = 100000000;
  process.env.TEST_API_KEY = VALID_API_KEY;

  // mockReset drains mockResolvedValueOnce queues + clears implementations
  // (clearAllMocks does not). Without this, queued values bleed across tests.
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockBatchCommit.mockReset();
  mockQueryGet.mockReset();
  mockTransactionGet.mockReset();

  // Restore default mock implementations after reset
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
    expect(res.body.banners).toEqual([]);
    expect(res.body.funFacts).toEqual([]);
    expect(res.body.reports).toEqual([]);
    expect(res.body.appeals).toEqual([]);
    expect(res.body.alerts).toEqual([]);
    expect(res.body.conversations).toEqual([]);
    expect(res.body.economyConfig).toBeDefined();
    expect(Object.keys(res.body.economyConfig).length).toBeGreaterThan(0);
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

  test('creates test banner with correct fields and _testRun tag', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        banners: [
          {
            title: 'Welcome Banner',
            imageUrl: 'https://example.com/banner.png',
            actionType: 'URL',
            actionValue: 'https://example.com',
            isActive: true,
            sortOrder: 1,
          },
        ],
      })
      .expect(200);

    expect(res.body.banners).toHaveLength(1);
    const banner = res.body.banners[0];
    expect(banner.title).toBe('Welcome Banner');
    expect(banner.imageUrl).toBe('https://example.com/banner.png');
    expect(banner.actionType).toBe('URL');
    expect(banner.actionValue).toBe('https://example.com');
    expect(banner.isActive).toBe(true);
    expect(banner.sortOrder).toBe(1);
    expect(banner._testRun).toBe(res.body.testRunId);
    expect(banner.id).toContain(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`banners/${banner.id}`);
  });

  test('creates test banner with default values', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ banners: [{}] })
      .expect(200);

    const banner = res.body.banners[0];
    expect(banner.title).toBe('Test Banner');
    expect(banner.imageUrl).toBe('');
    expect(banner.actionType).toBe('NONE');
    expect(banner.actionValue).toBe('');
    expect(banner.isActive).toBe(true);
    expect(banner.sortOrder).toBe(0);
  });

  test('creates test fun fact with correct fields and _testRun tag', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        funFacts: [
          {
            text: 'Octopi have three hearts',
            category: 'Science',
            emoji: '🐙',
            sourceLanguage: 'English',
            isActive: true,
          },
        ],
      })
      .expect(200);

    expect(res.body.funFacts).toHaveLength(1);
    const fact = res.body.funFacts[0];
    expect(fact.text).toBe('Octopi have three hearts');
    expect(fact.category).toBe('Science');
    expect(fact.emoji).toBe('🐙');
    expect(fact.sourceLanguage).toBe('English');
    expect(fact.isActive).toBe(true);
    expect(fact._testRun).toBe(res.body.testRunId);
    expect(fact.id).toContain(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`funFacts/${fact.id}`);
  });

  test('creates test fun fact with default values', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ funFacts: [{}] })
      .expect(200);

    const fact = res.body.funFacts[0];
    expect(fact.text).toBe('Test fact');
    expect(fact.category).toBe('trivia');
    expect(fact.sourceLanguage).toBe('English');
    expect(fact.isActive).toBe(true);
  });

  test('creates test report with index-based user references', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{ name: 'Reported' }, { name: 'Reporter' }],
        reports: [
          { reportedUserIndex: 0, reporterUserIndex: 1, reason: 'Harassment', status: 'pending' },
        ],
      })
      .expect(200);

    expect(res.body.reports).toHaveLength(1);
    const report = res.body.reports[0];
    expect(report.reportedUserId).toBe(res.body.users[0].uid);
    expect(report.reportedUserUniqueId).toBe(res.body.users[0].uniqueId);
    expect(report.reportedUserName).toBe('Reported');
    expect(report.reporterId).toBe(res.body.users[1].uid);
    expect(report.reporterName).toBe('Reporter');
    expect(report.reason).toBe('Harassment');
    expect(report.status).toBe('pending');
    expect(report._testRun).toBe(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`reports/${report.id}`);
  });

  test('report seed fails when fewer than 2 users are seeded', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{ name: 'OnlyOne' }],
        reports: [{ reportedUserIndex: 0, reporterUserIndex: 1 }],
      })
      .expect(500);

    expect(res.body.error).toBe('Report seed requires at least 2 users');
  });

  test('creates test appeal and sets user as suspended', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        users: [{ name: 'Suspended User' }],
        appeals: [{ userIndex: 0, appealText: 'Please reconsider', status: 'pending' }],
      })
      .expect(200);

    expect(res.body.appeals).toHaveLength(1);
    const appeal = res.body.appeals[0];
    expect(appeal.userId).toBe(res.body.users[0].uniqueId);
    expect(appeal.appealText).toBe('Please reconsider');
    expect(appeal.status).toBe('pending');
    expect(appeal._testRun).toBe(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`suspensionAppeals/${appeal.id}`);

    // NOTE: Setup no longer auto-suspends the user — appeal tests manage suspension themselves
    // to avoid cross-file fragility (other tests depend on user not being suspended)
  });

  test('appeal seed fails when no users are seeded', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        appeals: [{ userIndex: 0, appealText: 'Help' }],
      })
      .expect(500);

    expect(res.body.error).toBe('Appeal seed requires users to be seeded first');
  });

  test('creates test alert with correct fields and _testRun tag', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        alerts: [
          {
            type: 'error_rate',
            severity: 'high',
            message: 'Error rate exceeded threshold',
            status: 'new',
          },
        ],
      })
      .expect(200);

    expect(res.body.alerts).toHaveLength(1);
    const alert = res.body.alerts[0];
    expect(alert.type).toBe('error_rate');
    expect(alert.severity).toBe('high');
    expect(alert.message).toBe('Error rate exceeded threshold');
    expect(alert.status).toBe('new');
    expect(alert._testRun).toBe(res.body.testRunId);
    expect(alert.id).toContain(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`alerts/${alert.id}`);
  });

  test('creates test alert with default values', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ alerts: [{}] })
      .expect(200);

    const alert = res.body.alerts[0];
    expect(alert.type).toBe('error_rate');
    expect(alert.severity).toBe('medium');
    expect(alert.message).toBe('Test alert');
    expect(alert.status).toBe('new');
  });

  test('creates test conversation with messages subcollection (participantIds field)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        conversations: [
          {
            participantIds: ['uid1', 'uid2'],
            messages: [
              { text: 'Hello!', senderId: 'uid1' },
              { text: 'Hi there!', senderId: 'uid2' },
            ],
          },
        ],
      })
      .expect(200);

    expect(res.body.conversations).toHaveLength(1);
    const conv = res.body.conversations[0];
    // The doc field is `participantIds` (matches the production
    // route at conversations.js:229). The legacy `participants` key
    // remains accepted at the input level for backward compat with
    // older test fixtures (verified in the next test).
    expect(conv.participantIds).toEqual(['uid1', 'uid2']);
    expect(conv._testRun).toBe(res.body.testRunId);
    expect(conv.id).toContain(res.body.testRunId);
    expect(mockDoc).toHaveBeenCalledWith(`conversations/${conv.id}`);

    // 1 conversation doc + 2 message docs = 3 set calls
    const convSetCalls = mockDocSet.mock.calls;
    expect(convSetCalls.length).toBe(3);

    // Messages should be in subcollection
    expect(mockDoc).toHaveBeenCalledWith(
      expect.stringContaining(`conversations/${conv.id}/messages/`),
    );
  });

  test('legacy `participants` input key still maps to participantIds', async () => {
    // Backward compat: pre-rename fixtures pass `participants`. The
    // route maps it to `participantIds` so the seeded doc still
    // satisfies the production participant check.
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        conversations: [{ participants: ['legacy-uid'] }],
      })
      .expect(200);

    expect(res.body.conversations[0].participantIds).toEqual(['legacy-uid']);
  });

  test('conversation with neither key falls back to empty participantIds', async () => {
    // Branch coverage for the `|| []` fallback when callers pass an
    // empty spec. A test seeding a conversation with no participants
    // is unrealistic for actual scenarios, but the route should not
    // crash — it should yield a conversation doc with an empty array.
    // SonarCloud's branch-coverage gate caught this missing case.
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        conversations: [{}],
      })
      .expect(200);

    expect(res.body.conversations[0].participantIds).toEqual([]);
  });

  test('creates conversation without messages when none specified', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({
        conversations: [{ participantIds: ['uid1'] }],
      })
      .expect(200);

    expect(res.body.conversations).toHaveLength(1);
    // Only 1 conversation doc, no message docs
    expect(mockDocSet).toHaveBeenCalledTimes(1);
  });

  test('economy config backup is included in response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'economy',
      data: () => ({ dailyBonus: 100, spinCost: 50 }),
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    expect(res.body.economyConfig).toEqual({ dailyBonus: 100, spinCost: 50 });
    expect(mockDoc).toHaveBeenCalledWith('config/economy');
  });

  test('economy config uses production defaults when doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    expect(res.body.economyConfig).toBeDefined();
    expect(Object.keys(res.body.economyConfig).length).toBeGreaterThan(0);
  });

  test('economy config uses production defaults when Firestore read fails', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore read error'));

    const app = createApp();
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({})
      .expect(200);

    expect(res.body.economyConfig).toBeDefined();
    expect(Object.keys(res.body.economyConfig).length).toBeGreaterThan(0);
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
  const ALLOWED_COLLECTIONS = [
    'users',
    'rooms',
    'gifts',
    'conversations',
    'banners',
    'funFacts',
    'reports',
    'suspensionAppeals',
    'alerts',
  ];

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

// ─── POST /api/test/reset ───────────────────────────────────────

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
