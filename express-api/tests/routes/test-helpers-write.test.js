const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockDocSet,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) })),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) })),
      })),
    })),
    batch: jest.fn(() => ({
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
    runTransaction: jest.fn(async (cb) => cb({ get: jest.fn(), set: jest.fn() })),
  },
}));

let mockIdCounter = 0;
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => `gen-id-${++mockIdCounter}`),
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

  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
});

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/test/write/:collection', () => {
  test('happy path: writes to an allowed collection (suspensionAppeals)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/write/suspensionAppeals')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ appealText: 'I was wrongly suspended', status: 'pending' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    expect(mockDoc).toHaveBeenCalledWith(expect.stringContaining('suspensionAppeals/'));
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        appealText: 'I was wrongly suspended',
        status: 'pending',
      }),
      { merge: true },
    );
  });

  test('rejects disallowed collection with 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/write/secretAdminData')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ data: 'evil' })
      .expect(400);

    expect(res.body.error).toBe('Collection not allowed');
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('rejects empty body with 400', async () => {
    const app = createApp();
    // Send with no body — express.json() will set req.body to undefined
    const res = await request(app)
      .post('/api/test/write/users')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .expect(400);

    expect(res.body.error).toBe('Request body must be a JSON object');
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('generates id when data.id is not provided', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/write/gifts')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ name: 'Test Gift', coinValue: 100 })
      .expect(200);

    // The generated ID should be used
    expect(res.body.id).toBe('gen-id-1');
    expect(mockDoc).toHaveBeenCalledWith('gifts/gen-id-1');
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gen-id-1', name: 'Test Gift', coinValue: 100 }),
      { merge: true },
    );
  });

  test('uses provided data.id instead of generating one', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/write/rooms')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ id: 'custom-room-id', name: 'My Room' })
      .expect(200);

    expect(res.body.id).toBe('custom-room-id');
    expect(mockDoc).toHaveBeenCalledWith('rooms/custom-room-id');
  });

  test('preserves _testRun field if provided', async () => {
    const app = createApp();
    const testRunId = 'test_abc123';
    const res = await request(app)
      .post('/api/test/write/alerts')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ message: 'Test alert', _testRun: testRunId })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ _testRun: testRunId }), {
      merge: true,
    });
  });

  test('does not add _testRun field when not provided in body', async () => {
    const app = createApp();
    await request(app)
      .post('/api/test/write/banners')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ title: 'Banner' })
      .expect(200);

    const setCallArgs = mockDocSet.mock.calls[0][0];
    // _testRun should not be present since it was not in the input
    expect(setCallArgs._testRun).toBeUndefined();
  });

  test('returns 403 without TEST_API_KEY header', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/write/users')
      .send({ name: 'Unauthorized write' })
      .expect(403);

    expect(res.body.error).toBe('Invalid test API key');
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('returns 403 with wrong TEST_API_KEY header', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/test/write/users')
      .set('X-Test-Api-Key', 'wrong-key')
      .send({ name: 'Unauthorized write' })
      .expect(403);

    expect(res.body.error).toBe('Invalid test API key');
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('writes to each allowed collection type', async () => {
    const allowedCollections = [
      'users',
      'rooms',
      'gifts',
      'conversations',
      'banners',
      'funFacts',
      'reports',
      'suspensionAppeals',
      'alerts',
      'suggestions',
      'ageVerificationSubmissions',
      'coinPackages',
    ];

    for (const collection of allowedCollections) {
      jest.clearAllMocks();
      mockDocSet.mockResolvedValue();
      const app = createApp();
      process.env.TEST_API_KEY = VALID_API_KEY;

      const res = await request(app)
        .post(`/api/test/write/${collection}`)
        .set('X-Test-Api-Key', VALID_API_KEY)
        .send({ id: `test-${collection}`, _field: 'value' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.id).toBe(`test-${collection}`);
    }
  });
});
