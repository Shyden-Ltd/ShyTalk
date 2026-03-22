const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'banner-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // allow by default
}));

jest.mock('../../src/utils/r2', () => ({
  putObject: jest
    .fn()
    .mockResolvedValue('https://images.shytalk.shyden.co.uk/banners/banner-id_12345.jpg'),
  deleteObject: jest.fn().mockResolvedValue(),
  CDN_URL: 'https://images.shytalk.shyden.co.uk',
}));

// Mock firestore-helpers — queryDocs and getDoc return controllable values
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

const { getDoc, queryDocs } = require('../../src/utils/firestore-helpers');
const { requireAdmin } = require('../../src/middleware/auth');
const { putObject, deleteObject } = require('../../src/utils/r2');

// ─── App setup ───────────────────────────────────────────────────

const bannersRouter = require('../../src/routes/banners');

function createApp({ isAdmin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: isAdmin ? 'admin-uid' : 'user-uid', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', bannersRouter);
  return app;
}

function blockAdmin() {
  requireAdmin.mockImplementation((_req, res) => {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  queryDocs.mockResolvedValue([]);
  requireAdmin.mockReturnValue(false);
});

// ─── GET /api/banners/active ──────────────────────────────────────

describe('GET /api/banners/active', () => {
  it('returns 200 with empty array when no active banners exist', async () => {
    queryDocs.mockResolvedValueOnce([]);
    const app = createApp();
    const res = await request(app).get('/api/banners/active');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns 200 with active banners when they exist', async () => {
    const _now = 1709913600000;
    queryDocs.mockResolvedValueOnce([
      {
        id: 'b1',
        title: 'Summer Sale',
        imageUrl: 'https://images.shytalk.shyden.co.uk/banners/b1.jpg',
        isActive: true,
        sortOrder: 0,
        startDate: null,
        endDate: null,
      },
      {
        id: 'b2',
        title: 'New Feature',
        imageUrl: 'https://images.shytalk.shyden.co.uk/banners/b2.jpg',
        isActive: true,
        sortOrder: 1,
        startDate: null,
        endDate: null,
      },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/banners/active');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Summer Sale');
  });

  it('filters out banners with a future startDate', async () => {
    const now = 1709913600000;
    const futureStart = now + 86400000; // +1 day
    queryDocs.mockResolvedValueOnce([
      {
        id: 'b-future',
        title: 'Upcoming',
        imageUrl: 'img.jpg',
        isActive: true,
        sortOrder: 0,
        startDate: futureStart,
        endDate: null,
      },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/banners/active');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('filters out banners with an expired endDate', async () => {
    const now = 1709913600000;
    const pastEnd = now - 1; // already expired
    queryDocs.mockResolvedValueOnce([
      {
        id: 'b-expired',
        title: 'Old Event',
        imageUrl: 'img.jpg',
        isActive: true,
        sortOrder: 0,
        startDate: null,
        endDate: pastEnd,
      },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/banners/active');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('includes a banner whose startDate is in the past and endDate is in the future', async () => {
    const now = 1709913600000;
    queryDocs.mockResolvedValueOnce([
      {
        id: 'b-current',
        title: 'Active Campaign',
        imageUrl: 'img.jpg',
        isActive: true,
        sortOrder: 0,
        startDate: now - 86400000, // started yesterday
        endDate: now + 86400000, // ends tomorrow
      },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/banners/active');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('b-current');
  });

  it('sets Cache-Control header', async () => {
    queryDocs.mockResolvedValueOnce([]);
    const app = createApp();
    const res = await request(app).get('/api/banners/active');
    expect(res.headers['cache-control']).toMatch(/max-age=300/);
  });
});

// ─── GET /api/admin/banners ───────────────────────────────────────

describe('GET /api/admin/banners', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app).get('/api/admin/banners');
    expect(res.status).toBe(403);
  });

  it('returns 200 with all banners for admin', async () => {
    queryDocs.mockResolvedValueOnce([
      { id: 'b1', title: 'Banner 1', isActive: true, sortOrder: 0 },
      { id: 'b2', title: 'Banner 2', isActive: false, sortOrder: 1 },
    ]);

    const app = createApp({ isAdmin: true });
    const res = await request(app).get('/api/admin/banners');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('returns 200 with empty array when no banners exist', async () => {
    queryDocs.mockResolvedValueOnce([]);
    const app = createApp({ isAdmin: true });
    const res = await request(app).get('/api/admin/banners');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── POST /api/admin/banners ──────────────────────────────────────

describe('POST /api/admin/banners', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/banners')
      .send({ imageUrl: 'https://images.shytalk.shyden.co.uk/banners/x.jpg' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when imageUrl is missing', async () => {
    const app = createApp({ isAdmin: true });
    const res = await request(app).post('/api/admin/banners').send({ title: 'No image banner' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/imageUrl/i);
  });

  it('returns 200 and creates banner document with generated id', async () => {
    // queryDocs used to find the highest sortOrder — return empty so sortOrder = 0
    queryDocs.mockResolvedValueOnce([]);

    const app = createApp({ isAdmin: true });
    const res = await request(app).post('/api/admin/banners').send({
      title: 'Welcome Banner',
      imageUrl: 'https://images.shytalk.shyden.co.uk/banners/welcome.jpg',
      actionType: 'URL',
      actionValue: 'https://shytalk.shyden.co.uk',
      isActive: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('banner-id');

    expect(mockDocSet).toHaveBeenCalledWith(
      'banners/banner-id',
      expect.objectContaining({
        id: 'banner-id',
        title: 'Welcome Banner',
        imageUrl: 'https://images.shytalk.shyden.co.uk/banners/welcome.jpg',
        actionType: 'URL',
        isActive: true,
        sortOrder: 0,
      }),
      { merge: true },
    );
  });

  it('increments sortOrder based on the highest existing sortOrder', async () => {
    // Return an existing banner with sortOrder 5
    queryDocs.mockResolvedValueOnce([{ id: 'existing', sortOrder: 5 }]);

    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .post('/api/admin/banners')
      .send({ imageUrl: 'https://images.shytalk.shyden.co.uk/banners/new.jpg' });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      'banners/banner-id',
      expect.objectContaining({ sortOrder: 6 }),
      { merge: true },
    );
  });

  it('accepts snake_case image_url field', async () => {
    queryDocs.mockResolvedValueOnce([]);
    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .post('/api/admin/banners')
      .send({ image_url: 'https://images.shytalk.shyden.co.uk/banners/snake.jpg' });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      'banners/banner-id',
      expect.objectContaining({
        imageUrl: 'https://images.shytalk.shyden.co.uk/banners/snake.jpg',
      }),
      { merge: true },
    );
  });
});

// ─── PUT /api/admin/banners/reorder ──────────────────────────────

describe('PUT /api/admin/banners/reorder', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app)
      .put('/api/admin/banners/reorder')
      .send([{ id: 'b1', sort_order: 0 }]);
    expect(res.status).toBe(403);
  });

  it('returns 400 when body is not an array', async () => {
    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .put('/api/admin/banners/reorder')
      .send({ id: 'b1', sort_order: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it('returns 200 and batch-updates sortOrder for each banner', async () => {
    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .put('/api/admin/banners/reorder')
      .send([
        { id: 'b1', sort_order: 0 },
        { id: 'b2', sort_order: 1 },
        { id: 'b3', sort_order: 2 },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockBatchSet).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('accepts sortOrder as camelCase property', async () => {
    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .put('/api/admin/banners/reorder')
      .send([{ id: 'b1', sortOrder: 5 }]);

    expect(res.status).toBe(200);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(), // doc ref
      expect.objectContaining({ sortOrder: 5 }),
      { merge: true },
    );
  });
});

// ─── PUT /api/admin/banners/:id ───────────────────────────────────

describe('PUT /api/admin/banners/:id', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app).put('/api/admin/banners/b1').send({ title: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when banner does not exist', async () => {
    getDoc.mockResolvedValueOnce(null);
    const app = createApp({ isAdmin: true });
    const res = await request(app).put('/api/admin/banners/nonexistent').send({ title: 'Updated' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when no valid fields are provided', async () => {
    getDoc.mockResolvedValueOnce({ id: 'b1', title: 'Existing Banner' });
    const app = createApp({ isAdmin: true });
    const res = await request(app).put('/api/admin/banners/b1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no fields/i);
  });

  it('returns 200 and updates the banner fields', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'b1',
      title: 'Old Title',
      imageUrl: 'old.jpg',
      isActive: true,
    });
    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .put('/api/admin/banners/b1')
      .send({ title: 'New Title', isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      'banners/b1',
      expect.objectContaining({ title: 'New Title', isActive: false }),
    );
  });

  it('accepts snake_case field names', async () => {
    getDoc.mockResolvedValueOnce({ id: 'b1', title: 'Existing', isActive: true });
    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .put('/api/admin/banners/b1')
      .send({ image_url: 'https://images.shytalk.shyden.co.uk/new.jpg', action_type: 'ROOM' });

    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'banners/b1',
      expect.objectContaining({
        imageUrl: 'https://images.shytalk.shyden.co.uk/new.jpg',
        actionType: 'ROOM',
      }),
    );
  });
});

// ─── DELETE /api/admin/banners/:id ───────────────────────────────

describe('DELETE /api/admin/banners/:id', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app).delete('/api/admin/banners/b1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when banner does not exist', async () => {
    getDoc.mockResolvedValueOnce(null);
    const app = createApp({ isAdmin: true });
    const res = await request(app).delete('/api/admin/banners/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 and deletes the banner document', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'b1',
      title: 'Banner to delete',
      imageUrl: 'https://other-cdn.com/image.jpg', // not our CDN prefix — no R2 delete
    });

    const app = createApp({ isAdmin: true });
    const res = await request(app).delete('/api/admin/banners/b1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockDocDelete).toHaveBeenCalledWith('banners/b1');
    expect(deleteObject).not.toHaveBeenCalled(); // non-CDN URL → no R2 delete
  });

  it('deletes R2 object when imageUrl matches CDN prefix', async () => {
    getDoc.mockResolvedValueOnce({
      id: 'b1',
      title: 'CDN Banner',
      imageUrl: 'https://images.shytalk.shyden.co.uk/banners/photo.jpg',
    });

    const app = createApp({ isAdmin: true });
    const res = await request(app).delete('/api/admin/banners/b1');
    expect(res.status).toBe(200);

    expect(deleteObject).toHaveBeenCalledWith('banners/photo.jpg');
    expect(mockDocDelete).toHaveBeenCalledWith('banners/b1');
  });
});

// ─── POST /api/admin/banners/upload ──────────────────────────────

describe('POST /api/admin/banners/upload', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/banners/upload')
      .attach('file', Buffer.from('image data'), {
        filename: 'banner.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is uploaded', async () => {
    const app = createApp({ isAdmin: true });
    // No file attached — send empty multipart body
    const res = await request(app)
      .post('/api/admin/banners/upload')
      .field('someField', 'someValue'); // multipart without a file

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it('returns 200 with imageUrl and key after successful upload', async () => {
    putObject.mockResolvedValueOnce(
      'https://images.shytalk.shyden.co.uk/banners/banner-id_12345.jpg',
    );

    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .post('/api/admin/banners/upload')
      .attach('file', Buffer.from('fake image bytes'), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imageUrl).toMatch(/^https:\/\/images\.shytalk\.shyden\.co\.uk\/banners\//);
    expect(res.body.image_url).toBe(res.body.imageUrl); // both snake and camel returned
    expect(res.body.key).toMatch(/^banners\//);

    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^banners\/.+\.jpg$/),
      expect.any(Buffer),
      'image/jpeg',
    );
  });

  it('uses correct file extension for PNG uploads', async () => {
    putObject.mockResolvedValueOnce(
      'https://images.shytalk.shyden.co.uk/banners/banner-id_12345.png',
    );

    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .post('/api/admin/banners/upload')
      .attach('file', Buffer.from('png data'), {
        filename: 'banner.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(/\.png$/);
  });

  it('uses correct file extension for WebP uploads', async () => {
    putObject.mockResolvedValueOnce(
      'https://images.shytalk.shyden.co.uk/banners/banner-id_12345.webp',
    );

    const app = createApp({ isAdmin: true });
    const res = await request(app)
      .post('/api/admin/banners/upload')
      .attach('file', Buffer.from('webp data'), {
        filename: 'banner.webp',
        contentType: 'image/webp',
      });

    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(/\.webp$/);
  });
});
