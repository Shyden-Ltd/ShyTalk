const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockDoc = jest.fn(() => ({
  set: mockDocSet,
  update: mockDocUpdate,
  delete: mockDocDelete,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
  },
}));

// ─── Auth middleware mock ────────────────────────────────────────

const mockRequireAdmin = jest.fn(() => false);

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: (...args) => mockRequireAdmin(...args),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'gift-id-new'),
  now: jest.fn(() => 1709856000000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const adminGiftsRouter = require('../../src/routes/admin-gifts');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-uid', uniqueId: 'admin-1', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', adminGiftsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockReturnValue(false);
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
});

// ─── POST /api/gifts ─────────────────────────────────────────────

describe('POST /api/gifts', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app)
      .post('/api/gifts')
      .send({ name: 'Rose', coinValue: 10 })
      .expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 400 when name is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/gifts').send({ coinValue: 10 }).expect(400);

    expect(res.body.error).toMatch(/name/i);
  });

  test('returns 400 when coinValue is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/gifts').send({ name: 'Rose' }).expect(400);

    expect(res.body.error).toMatch(/coinValue/i);
  });

  test('returns 400 when both name and coinValue are missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/gifts').send({}).expect(400);

    expect(res.body.error).toBeDefined();
  });

  test('returns 200 and creates gift with generated id', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/gifts')
      .send({ name: 'Crown', coinValue: 500 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('gift-id-new');
    expect(mockDoc).toHaveBeenCalledWith('gifts/gift-id-new');
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'gift-id-new',
        name: 'Crown',
        coinValue: 500,
      }),
    );
  });

  test('returns 200 and uses provided id if supplied', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/gifts')
      .send({ id: 'custom-gift-id', name: 'Star', coinValue: 100 })
      .expect(200);

    expect(res.body.id).toBe('custom-gift-id');
    expect(mockDoc).toHaveBeenCalledWith('gifts/custom-gift-id');
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'custom-gift-id', name: 'Star', coinValue: 100 }),
    );
  });

  test('stores default values for optional fields', async () => {
    const app = createApp();
    await request(app).post('/api/gifts').send({ name: 'Flower', coinValue: 50 }).expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        animationUrl: '',
        soundUrl: '',
        iconUrl: '',
        order: 0,
        expiresAfterDays: null,
        showInStore: true,
        showOnWheel: true,
        weight: 1.0,
      }),
    );
  });

  test('accepts snake_case aliases for URLs', async () => {
    const app = createApp();
    await request(app)
      .post('/api/gifts')
      .send({
        name: 'Gem',
        coinValue: 200,
        animation_url: 'anim.json',
        sound_url: 'sound.mp3',
        icon_url: 'icon.png',
      })
      .expect(200);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        animationUrl: 'anim.json',
        soundUrl: 'sound.mp3',
        iconUrl: 'icon.png',
      }),
    );
  });

  test('writes an audit log entry on success', async () => {
    const app = createApp();
    await request(app).post('/api/gifts').send({ name: 'Balloon', coinValue: 30 }).expect(200);

    // adminAuditLog doc should also be set
    expect(mockDoc).toHaveBeenCalledWith(expect.stringMatching(/^adminAuditLog\//));
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-uid',
        action: 'CREATE_GIFT',
      }),
    );
  });
});

// ─── PUT /api/gifts/:id ──────────────────────────────────────────

describe('PUT /api/gifts/:id', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).put('/api/gifts/gift-abc').send({ name: 'Updated' }).expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 400 when no valid fields are provided', async () => {
    const app = createApp();
    const res = await request(app).put('/api/gifts/gift-abc').send({}).expect(400);

    expect(res.body.error).toMatch(/no valid fields/i);
  });

  test('returns 200 and updates gift name', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/gifts/gift-abc')
      .send({ name: 'Renamed Gift' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('gifts/gift-abc');
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed Gift' }));
  });

  test('returns 200 and updates coinValue', async () => {
    const app = createApp();
    const res = await request(app).put('/api/gifts/gift-abc').send({ coinValue: 999 }).expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ coinValue: 999 }));
  });

  test('accepts snake_case coin_value alias', async () => {
    const app = createApp();
    await request(app).put('/api/gifts/gift-abc').send({ coin_value: 750 }).expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ coinValue: 750 }));
  });

  test('coerces showInStore and showOnWheel to boolean', async () => {
    const app = createApp();
    await request(app)
      .put('/api/gifts/gift-abc')
      .send({ showInStore: 1, showOnWheel: 0 })
      .expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ showInStore: true, showOnWheel: false }),
    );
  });

  test('returns 500 when Firestore update throws', async () => {
    mockDocUpdate.mockRejectedValue(new Error('Firestore error'));

    const app = createApp();
    const res = await request(app)
      .put('/api/gifts/gift-abc')
      .send({ name: 'Something' })
      .expect(500);

    expect(res.body.error).toBeDefined();
  });
});

// ─── DELETE /api/gifts/:id ───────────────────────────────────────

describe('DELETE /api/gifts/:id', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).delete('/api/gifts/gift-abc').expect(403);

    expect(res.body.error).toBeDefined();
  });

  test('returns 200 and deletes the gift', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/gifts/gift-abc').expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDoc).toHaveBeenCalledWith('gifts/gift-abc');
    expect(mockDocDelete).toHaveBeenCalled();
  });

  test('writes an audit log entry on delete', async () => {
    const app = createApp();
    await request(app).delete('/api/gifts/gift-abc').expect(200);

    expect(mockDoc).toHaveBeenCalledWith(expect.stringMatching(/^adminAuditLog\//));
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-uid',
        action: 'DELETE_GIFT',
        details: expect.stringContaining('gift-abc'),
      }),
    );
  });

  test('returns 500 when Firestore delete throws', async () => {
    mockDocDelete.mockRejectedValue(new Error('Firestore error'));

    const app = createApp();
    const res = await request(app).delete('/api/gifts/gift-abc').expect(500);

    expect(res.body.error).toBeDefined();
  });
});
