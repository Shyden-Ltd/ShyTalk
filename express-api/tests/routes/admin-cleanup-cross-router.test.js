/**
 * Regression test for PR #538 round-2: when admin-cleanup.js and
 * storage.js share the `/api` mount point, admin-cleanup's path-scoped
 * `router.use(...)` adminGuard MUST NOT intercept routes owned by
 * storage.js. Specifically `/api/storage/upload` (storage.js, non-admin)
 * must reach storage's handler instead of getting a 403 from the guard
 * in admin-cleanup.
 *
 * Mounting order mirrors src/index.js: admin-cleanup BEFORE storage.
 * Express processes routers in registration order, so a too-broad
 * `router.use('/storage', adminGuard)` in admin-cleanup short-circuits
 * the request before storage.js ever sees it.
 *
 * What this test pins:
 *   - non-admin hitting /api/storage/upload → reaches storage handler
 *     (asserted by 400 "Missing file or path", not 403)
 *   - non-admin hitting /api/storage/audit → still 403 (guard works
 *     for the route admin-cleanup actually owns)
 *   - admin hitting /api/storage/audit → reaches admin-cleanup handler
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: () => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    }),
    doc: () => ({
      get: jest.fn().mockResolvedValue({ exists: false }),
    }),
    batch: () => ({
      delete: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    }),
  },
  rtdb: { ref: jest.fn().mockReturnValue({ remove: jest.fn().mockResolvedValue() }) },
}));

jest.mock('../../src/utils/r2', () => ({
  putObject: jest.fn().mockResolvedValue('https://images.shytalk.example/test-key'),
  deleteObject: jest.fn().mockResolvedValue(),
  listObjects: jest.fn().mockResolvedValue([]),
  listObjectsWithMetadata: jest.fn().mockResolvedValue([]),
  deleteObjects: jest.fn().mockResolvedValue(),
  CDN_URL: 'https://images.shytalk.example',
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/imageCompressor', () => {
  class ImagePolicyError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ImagePolicyError';
    }
  }
  return {
    compressImage: jest.fn().mockResolvedValue({
      buffer: Buffer.from('compressed'),
      mimeType: 'image/jpeg',
      originalSize: 100,
      compressedSize: 50,
    }),
    ImagePolicyError,
  };
});

jest.mock('../../src/utils/helpers', () => ({
  getExtension: jest.fn(() => 'jpg'),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// requireAdmin returns true (and sends 403) when caller is not admin —
// matching the real implementation's contract from src/middleware/auth.js
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(async (req, res) => {
    if (!req.auth?.token?.admin) {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    }
    return false;
  }),
}));

function buildApp({ asAdmin }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: asAdmin ? 'admin-uid' : 'user-uid',
      uniqueId: asAdmin ? 99999 : 12345,
      token: asAdmin ? { admin: true } : { admin: false },
    };
    next();
  });
  // Order MUST match src/index.js: admin-cleanup (197) before storage (201).
  app.use('/api', require('../../src/routes/admin-cleanup'));
  app.use('/api', require('../../src/routes/storage'));
  return app;
}

describe('admin-cleanup adminGuard cross-router scope', () => {
  test('non-admin POST /api/storage/upload reaches storage.js handler (succeeds, NOT blocked by guard)', async () => {
    const app = buildApp({ asAdmin: false });
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'evidence')
      .attach('file', Buffer.from('fake-image-bytes'), {
        filename: 'photo.png',
        contentType: 'image/png',
      });
    // 200 + body.url proves the request reached storage.js's handler
    // (admin-cleanup's adminGuard would have returned 403 here before
    // the path-prefix tightening).
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe('string');
  });

  test('non-admin POST /api/storage/upload to disallowed path → 400 from storage.js (NOT 403 from guard)', async () => {
    const app = buildApp({ asAdmin: false });
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'definitely-not-allowed')
      .attach('file', Buffer.from('fake'), {
        filename: 'x.png',
        contentType: 'image/png',
      });
    // Storage.js own validator returns 400 "Invalid upload path".
    // 403 would mean the guard intercepted it.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid upload path/i);
  });

  test('non-admin DELETE /api/storage/delete reaches storage.js (NOT 403)', async () => {
    const app = buildApp({ asAdmin: false });
    const res = await request(app).delete('/api/storage/delete').send({ url: 'x' });
    // storage.js's delete handler validates ownership / URL — but the
    // failure mode must come from storage.js, not admin-cleanup's guard.
    expect(res.status).not.toBe(403);
  });

  test('non-admin GET /api/storage/audit IS gated (admin-cleanup owns this route)', async () => {
    const app = buildApp({ asAdmin: false });
    const res = await request(app).get('/api/storage/audit');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  test('admin GET /api/storage/audit reaches admin-cleanup handler', async () => {
    const app = buildApp({ asAdmin: true });
    const res = await request(app).get('/api/storage/audit');
    // Should NOT be 403 — admin passes the guard. The handler may
    // return 200 or 500 depending on mock completeness; what matters
    // is that the guard let the request through.
    expect(res.status).not.toBe(403);
  });

  test('non-admin POST /api/cleanup/all-reports IS still gated', async () => {
    const app = buildApp({ asAdmin: false });
    const res = await request(app).post('/api/cleanup/all-reports');
    expect(res.status).toBe(403);
  });
});
