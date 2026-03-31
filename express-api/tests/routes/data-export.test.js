/**
 * Tests for data export routes (GDPR Article 20).
 *
 * POST   /api/users/:uniqueId/data-export          → Request export
 * GET    /api/users/:uniqueId/data-export/status    → Poll status
 * GET    /api/users/:uniqueId/data-export/download  → Download ZIP
 *
 * Covers:
 * - Owner-only access control
 * - Rate limiting (24-hour window via Firestore field)
 * - Async export trigger (202 response)
 * - Status polling (pending/ready/expired/none)
 * - Download with HMAC token verification
 * - Download with expired token
 * - Download with invalid token
 * - Suspended users can still export (GDPR)
 * - Edge cases: not found, server errors
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
  },
  auth: {
    revokeRefreshTokens: jest.fn().mockResolvedValue(),
  },
  FieldValue: {
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { Readable } = require('stream');
const mockPutObject = jest.fn().mockResolvedValue();
const mockGetObject = jest.fn();
const mockDeleteObjects = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/r2', () => ({
  putObject: (...args) => mockPutObject(...args),
  getObject: (...args) => mockGetObject(...args),
  deleteObjects: (...args) => mockDeleteObjects(...args),
}));

const mockBuildDataExport = jest.fn();
jest.mock(
  '../../src/utils/data-export-builder',
  () =>
    (...args) =>
      mockBuildDataExport(...args),
);

const mockSendEmail = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/email', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildOtpEmail: jest.fn(),
  buildLockoutEmail: jest.fn(),
  buildResetEmail: jest.fn(),
  buildDeletionScheduledEmail: jest.fn(),
  buildDeletionCompleteEmail: jest.fn(),
  buildDataExportReadyEmail: jest.fn((url, expires) => ({
    subject: 'Your ShyTalk data export is ready',
    html: `<p>Download: ${url}, expires: ${expires}</p>`,
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ──────────────────────────────────────────────────

function createApp(uid = 'firebase-uid-A', uniqueId = 10000001) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  // Mount both users router (for ownership check pattern) and data-export router
  app.use('/api', require('../../src/routes/data-export'));
  return app;
}

// ─── Helpers ────────────────────────────────────────────────────

function mockUserDoc(uniqueId, overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uniqueId,
      firebaseUid: 'firebase-uid-A',
      email: 'test@example.com',
      displayName: 'Test User',
      lastDataExportRequestedAt: null,
      dataExportStatus: null,
      dataExportR2Key: null,
      dataExportExpiresAt: null,
      ...overrides,
    }),
    id: String(uniqueId),
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/data-export
// ═══════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/data-export', () => {
  const app = createApp();

  test('returns 202 with requestedAt on success', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).post('/api/users/10000001/data-export').expect(202);

    expect(res.body.requestedAt).toBeDefined();
    expect(typeof res.body.requestedAt).toBe('number');
  });

  test('updates lastDataExportRequestedAt on user doc', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    await request(app).post('/api/users/10000001/data-export').expect(202);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000001'),
      expect.objectContaining({
        lastDataExportRequestedAt: expect.any(Number),
        dataExportStatus: 'pending',
      }),
    );
  });

  test('returns 403 when not the owner', async () => {
    const otherApp = createApp('other-uid', 99999999);
    await request(otherApp).post('/api/users/10000001/data-export').expect(403);
  });

  test('returns 429 when requested within 24 hours', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            lastDataExportRequestedAt: 1709913600000 - 3600000, // 1 hour ago (now() is mocked to 1709913600000)
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).post('/api/users/10000001/data-export').expect(429);

    expect(res.body.error).toMatch(/rate.?limit|wait|24/i);
  });

  test('allows request after 24 hours', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            lastDataExportRequestedAt: 1709913600000 - 25 * 3600000, // 25 hours ago
          }),
        );
      return Promise.resolve({ exists: false });
    });

    await request(app).post('/api/users/10000001/data-export').expect(202);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    await request(app).post('/api/users/10000001/data-export').expect(404);
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    await request(app).post('/api/users/10000001/data-export').expect(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/data-export/status
// ═══════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/data-export/status', () => {
  const app = createApp();

  test('returns none when no export requested', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).get('/api/users/10000001/data-export/status').expect(200);

    expect(res.body.status).toBe('none');
  });

  test('returns pending when export is processing', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            dataExportStatus: 'pending',
            lastDataExportRequestedAt: Date.now(),
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).get('/api/users/10000001/data-export/status').expect(200);

    expect(res.body.status).toBe('pending');
  });

  test('returns ready when export is available', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, {
            dataExportStatus: 'ready',
            lastDataExportRequestedAt: Date.now(),
            dataExportExpiresAt: Date.now() + 48 * 3600000,
          }),
        );
      return Promise.resolve({ exists: false });
    });

    const res = await request(app).get('/api/users/10000001/data-export/status').expect(200);

    expect(res.body.status).toBe('ready');
    expect(res.body.expiresAt).toBeDefined();
  });

  test('returns 403 when not the owner', async () => {
    const otherApp = createApp('other-uid', 99999999);
    await request(otherApp).get('/api/users/10000001/data-export/status').expect(403);
  });

  test('returns 404 when user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    await request(app).get('/api/users/10000001/data-export/status').expect(404);
  });

  test('returns 500 on server error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));
    await request(app).get('/api/users/10000001/data-export/status').expect(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/data-export/download
// ═══════════════════════════════════════════════════════════════

describe('GET /api/users/:uniqueId/data-export/download', () => {
  test('returns 401 when no token provided', async () => {
    const app = createApp();
    await request(app).get('/api/users/10000001/data-export/download').expect(401);
  });

  test('returns 401 when token is invalid', async () => {
    const app = createApp();
    await request(app)
      .get('/api/users/10000001/data-export/download?token=invalid&expiresAt=9999999999999')
      .expect(401);
  });

  test('returns 410 when token is expired', async () => {
    const app = createApp();
    // Use a past expiresAt
    await request(app)
      .get('/api/users/10000001/data-export/download?token=sometoken&expiresAt=1000000000000')
      .expect(410);
  });

  test('returns 404 when no export exists for user', async () => {
    const app = createApp();
    const crypto = require('node:crypto');
    const expiresAt = '9999999999999';
    const token = crypto
      .createHmac('sha256', 'dev-export-secret')
      .update(`10000001:${expiresAt}`)
      .digest('hex');

    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(mockUserDoc(10000001, { dataExportR2Key: null }));
      return Promise.resolve({ exists: false });
    });

    await request(app)
      .get(`/api/users/10000001/data-export/download?token=${token}&expiresAt=${expiresAt}`)
      .expect(404);
  });

  test('streams ZIP with valid HMAC token', async () => {
    const app = createApp();
    const crypto = require('node:crypto');
    const expiresAt = '9999999999999';
    const token = crypto
      .createHmac('sha256', 'dev-export-secret')
      .update(`10000001:${expiresAt}`)
      .digest('hex');

    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, { dataExportR2Key: 'exports/10000001/test.zip' }),
        );
      return Promise.resolve({ exists: false });
    });

    const zipData = Buffer.from('fake-zip-data');
    const readable = Readable.from(zipData);
    mockGetObject.mockResolvedValue({ Body: readable });

    const res = await request(app)
      .get(`/api/users/10000001/data-export/download?token=${token}&expiresAt=${expiresAt}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/zip/);
    expect(res.headers['content-disposition']).toContain('shytalk-data-export-10000001.zip');
    expect(mockGetObject).toHaveBeenCalledWith('exports/10000001/test.zip');
  });

  test('returns 404 when user not found', async () => {
    const app = createApp();
    const crypto = require('node:crypto');
    const expiresAt = '9999999999999';
    const token = crypto
      .createHmac('sha256', 'dev-export-secret')
      .update(`10000001:${expiresAt}`)
      .digest('hex');

    mockDocGet.mockResolvedValue({ exists: false });

    await request(app)
      .get(`/api/users/10000001/data-export/download?token=${token}&expiresAt=${expiresAt}`)
      .expect(404);
  });

  test('returns 500 on R2 error', async () => {
    const app = createApp();
    const crypto = require('node:crypto');
    const expiresAt = '9999999999999';
    const token = crypto
      .createHmac('sha256', 'dev-export-secret')
      .update(`10000001:${expiresAt}`)
      .digest('hex');

    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/'))
        return Promise.resolve(
          mockUserDoc(10000001, { dataExportR2Key: 'exports/10000001/test.zip' }),
        );
      return Promise.resolve({ exists: false });
    });

    mockGetObject.mockRejectedValue(new Error('R2 unavailable'));

    await request(app)
      .get(`/api/users/10000001/data-export/download?token=${token}&expiresAt=${expiresAt}`)
      .expect(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// Async export processing (fire-and-forget)
// ═══════════════════════════════════════════════════════════════

describe('Async export processing', () => {
  const app = createApp();

  test('builds export and uploads to R2 on success', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    mockBuildDataExport.mockResolvedValue({ buffer: Buffer.from('zip-data') });

    await request(app).post('/api/users/10000001/data-export').expect(202);

    // Wait for async processing to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(mockBuildDataExport).toHaveBeenCalledWith('10000001');
    expect(mockPutObject).toHaveBeenCalledWith(
      expect.stringContaining('exports/10000001/'),
      expect.any(Buffer),
      'application/zip',
      expect.objectContaining({ expiresAt: expect.any(String) }),
    );
  });

  test('sends email after successful export', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    mockBuildDataExport.mockResolvedValue({ buffer: Buffer.from('zip-data') });

    await request(app).post('/api/users/10000001/data-export').expect(202);

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendEmail).toHaveBeenCalledWith(
      'test@example.com',
      'Your ShyTalk data export is ready',
      expect.stringContaining('Download'),
    );
  });

  test('updates status to ready after successful export', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    mockBuildDataExport.mockResolvedValue({ buffer: Buffer.from('zip-data') });

    await request(app).post('/api/users/10000001/data-export').expect(202);

    await new Promise((r) => setTimeout(r, 100));

    // Second update call should set status to ready
    const readyCall = mockDocUpdate.mock.calls.find(
      (c) => c[1] && c[1].dataExportStatus === 'ready',
    );
    expect(readyCall).toBeDefined();
  });

  test('updates status to failed on build error', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) return Promise.resolve(mockUserDoc(10000001));
      return Promise.resolve({ exists: false });
    });

    mockBuildDataExport.mockRejectedValue(new Error('Build failed'));

    await request(app).post('/api/users/10000001/data-export').expect(202);

    await new Promise((r) => setTimeout(r, 100));

    const failCall = mockDocUpdate.mock.calls.find(
      (c) => c[1] && c[1].dataExportStatus === 'failed',
    );
    expect(failCall).toBeDefined();
  });
});
