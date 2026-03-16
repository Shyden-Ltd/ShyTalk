const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn().mockResolvedValue({ exists: false });
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
  set: mockDocSet,
  update: mockDocUpdate,
  delete: mockDocDelete,
}));

// queryDocs-level mock: collection().where().get() and collection().orderBy().get()
const mockQueryGet = jest.fn().mockResolvedValue({ docs: [] });

const mockOrderBy = jest.fn(() => ({ get: mockQueryGet }));
const mockWhere = jest.fn(() => ({ get: mockQueryGet }));

const mockCollection = jest.fn(() => ({
  where: (...args) => {
    mockWhere(...args);
    return { get: mockQueryGet };
  },
  orderBy: (...args) => {
    mockOrderBy(...args);
    return { get: mockQueryGet };
  },
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
  },
}));

// ─── firestore-helpers mock ──────────────────────────────────────
// queryDocs is used directly; we mock the whole module so we can control results
const mockQueryDocs = jest.fn().mockResolvedValue([]);

jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: (...args) => mockQueryDocs(...args),
}));

// ─── Auth middleware mock ────────────────────────────────────────
const mockRequireAdmin = jest.fn(() => false);

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: (...args) => mockRequireAdmin(...args),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'fact-id-123'),
  now: jest.fn(() => 1709856000000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const funFactsRouter = require('../../src/routes/fun-facts');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'uid-1', uniqueId: 'user-1', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', funFactsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockReturnValue(false);
  mockQueryDocs.mockResolvedValue([]);
  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
});

// ─── GET /api/fun-facts ──────────────────────────────────────────

describe('GET /api/fun-facts', () => {
  test('returns 200 with array of active facts', async () => {
    mockQueryDocs.mockResolvedValue([
      { id: 'fact1', text: 'Hello is said in 100+ languages', isActive: true },
      { id: 'fact2', text: 'Bonjour is French for hello', isActive: true },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/fun-facts').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('text');
  });

  test('returns 200 with empty array when no active facts exist', async () => {
    mockQueryDocs.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).get('/api/fun-facts').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('sets Cache-Control header on 200 response', async () => {
    mockQueryDocs.mockResolvedValue([{ id: 'fact1', text: 'Fun fact', isActive: true }]);

    const app = createApp();
    const res = await request(app).get('/api/fun-facts').expect(200);

    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });

  test('returns 500 when Firestore throws', async () => {
    mockQueryDocs.mockRejectedValue(new Error('Firestore down'));

    const app = createApp();
    const res = await request(app).get('/api/fun-facts').expect(500);

    expect(res.body.error).toBeDefined();
  });
});

// ─── GET /api/admin/fun-facts ────────────────────────────────────

describe('GET /api/admin/fun-facts', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).get('/api/admin/fun-facts').expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 200 with all facts for admin', async () => {
    mockQueryDocs.mockResolvedValue([
      { id: 'fact1', text: 'Active fact', isActive: true },
      { id: 'fact2', text: 'Inactive fact', isActive: false },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/admin/fun-facts').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  test('returns 200 with empty array when collection is empty', async () => {
    mockQueryDocs.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).get('/api/admin/fun-facts').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

// ─── POST /api/admin/fun-facts ───────────────────────────────────

describe('POST /api/admin/fun-facts', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app)
      .post('/api/admin/fun-facts')
      .send({ text: 'Some fact' })
      .expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 400 when text is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/fun-facts')
      .send({ category: 'trivia' })
      .expect(400);

    expect(res.body.error).toMatch(/text/i);
  });

  test('returns 200 and creates fact with defaults', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/fun-facts')
      .send({ text: 'Did you know coffee is the second most traded commodity?' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('fact-id-123');
    expect(mockDoc).toHaveBeenCalledWith('funFacts/fact-id-123');
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fact-id-123',
        text: 'Did you know coffee is the second most traded commodity?',
        category: 'trivia',
        emoji: '',
        isActive: true,
      }),
    );
  });

  test('returns 200 and honours all optional fields', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/fun-facts')
      .send({
        text: 'Fact text',
        category: 'language',
        emoji: '🌍',
        sourceLanguage: 'en',
        isActive: false,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'language',
        emoji: '🌍',
        sourceLanguage: 'en',
        isActive: false,
      }),
    );
  });

  test('accepts snake_case field aliases', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/fun-facts')
      .send({ text: 'Another fact', source_language: 'ja', is_active: false })
      .expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: 'ja', isActive: false }),
    );
  });
});

// ─── PUT /api/admin/fun-facts/:id ────────────────────────────────

describe('PUT /api/admin/fun-facts/:id', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app)
      .put('/api/admin/fun-facts/fact1')
      .send({ text: 'Updated' })
      .expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 404 when fact does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app)
      .put('/api/admin/fun-facts/nonexistent')
      .send({ text: 'Updated text' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 200 and updates fact when it exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'fact1', text: 'Old text', isActive: true }),
    });

    const app = createApp();
    const res = await request(app)
      .put('/api/admin/fun-facts/fact1')
      .send({ text: 'Updated text', isActive: false })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Updated text', isActive: false }),
    );
  });

  test('returns 400 when no updatable fields are provided', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'fact1', text: 'Some text' }),
    });

    const app = createApp();
    const res = await request(app).put('/api/admin/fun-facts/fact1').send({}).expect(400);

    expect(res.body.error).toMatch(/no fields/i);
  });

  test('accepts snake_case aliases on update', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'fact1', text: 'Some text' }),
    });

    const app = createApp();
    await request(app)
      .put('/api/admin/fun-facts/fact1')
      .send({ source_language: 'ko', is_active: false })
      .expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: 'ko', isActive: false }),
    );
  });
});

// ─── DELETE /api/admin/fun-facts/:id ─────────────────────────────

describe('DELETE /api/admin/fun-facts/:id', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).delete('/api/admin/fun-facts/fact1').expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 404 when fact does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).delete('/api/admin/fun-facts/nonexistent').expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 200 and deletes fact when it exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: 'fact1', text: 'Some fact' }),
    });

    const app = createApp();
    const res = await request(app).delete('/api/admin/fun-facts/fact1').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('funFacts/fact1');
    expect(mockDocDelete).toHaveBeenCalled();
  });
});
