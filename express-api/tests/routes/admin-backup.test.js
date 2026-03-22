const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatch = jest.fn(() => ({
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({}) });

const mockDoc = jest.fn(() => ({
  set: mockDocSet,
  update: mockDocUpdate,
  get: mockDocGet,
}));

const mockCollectionGet = jest.fn().mockResolvedValue({ docs: [] });
const mockCollection = jest.fn(() => ({
  get: mockCollectionGet,
  doc: (...args) => mockDoc(...args),
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => mockCollection(...args),
    doc: (...args) => mockDoc(...args),
    batch: (...args) => mockBatch(...args),
  },
}));

// ─── Auth middleware mock ────────────────────────────────────────

const mockRequireAdmin = jest.fn(() => false);

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: (...args) => mockRequireAdmin(...args),
}));

// ─── R2 mock ────────────────────────────────────────────────────

const mockGetObject = jest.fn();
const mockListObjectsWithMetadata = jest.fn().mockResolvedValue([]);

jest.mock('../../src/utils/r2', () => ({
  getObject: (...args) => mockGetObject(...args),
  listObjectsWithMetadata: (...args) => mockListObjectsWithMetadata(...args),
  CDN_URL: 'https://images.test.example.com',
}));

// ─── Backups cron mock ──────────────────────────────────────────

const mockBackupFn = jest.fn().mockResolvedValue({
  date: '2026-03-16',
  manifest: { collections: ['users'], totalDocs: 10 },
});

// Must expose TOP_LEVEL_COLLECTIONS and SUBCOLLECTIONS as the route requires them at import time
mockBackupFn.TOP_LEVEL_COLLECTIONS = [
  'users',
  'rooms',
  'conversations',
  'config',
  'identityMap',
  'counters',
  'deviceBindings',
  'gifts',
  'giftRankings',
  'broadcasts',
  'coinPackages',
  'funFacts',
  'banners',
  'reports',
  'reportsArchive',
  'reportLocks',
  'suspensionAppeals',
  'alerts',
  'alertConfig',
  'adminAuditLog',
  'otpCodes',
  'biometricKeys',
  'emailMetrics',
  'purchaseReceipts',
  'logConfig',
  'deviceBans',
  'networkBans',
];
mockBackupFn.SUBCOLLECTIONS = [
  ['rooms', 'messages'],
  ['rooms', 'seatRequests'],
  ['conversations', 'messages'],
  ['conversations', 'userSettings'],
  ['conversations', 'mutes'],
  ['users', 'backpack'],
  ['users', 'warnings'],
  ['users', 'giftWall'],
  ['users', 'transactions'],
  ['users', 'stalkers'],
];

jest.mock('../../src/cron/backups', () => mockBackupFn);

// ─── Log mock ───────────────────────────────────────────────────

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1709856000000),
}));

// ─── App setup ──────────────────────────────────────────────────

const adminBackupRouter = require('../../src/routes/admin-backup');

function createApp(isAdmin = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-uid', uniqueId: 'admin-1', token: { admin: isAdmin } };
    next();
  });
  app.use('/api', adminBackupRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockReturnValue(false);
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
  mockCollectionGet.mockResolvedValue({ docs: [] });
  mockBatchDelete.mockReturnValue();
  mockBatchCommit.mockResolvedValue();
  mockGetObject.mockReset();
  mockListObjectsWithMetadata.mockResolvedValue([]);
  mockBackupFn.mockResolvedValue({
    date: '2026-03-16',
    manifest: { collections: ['users'], totalDocs: 10 },
  });
});

// ─── Helper: create a readable stream from an object ────────────

function jsonBodyStream(data) {
  const { Readable } = require('stream');
  const json = JSON.stringify(data);
  const stream = new Readable();
  stream.push(json);
  stream.push(null);
  // Also make it async-iterable for readR2Json
  stream[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(json);
  };
  // Support .pipe for download endpoints
  return stream;
}

// ═════════════════════════════════════════════════════════════════
// GET /api/admin/backups — List available backups
// ═════════════════════════════════════════════════════════════════

describe('GET /api/admin/backups', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).get('/api/admin/backups').expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('returns empty list when no backups exist', async () => {
    mockListObjectsWithMetadata.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).get('/api/admin/backups').expect(200);

    expect(res.body.backups).toEqual([]);
    expect(mockListObjectsWithMetadata).toHaveBeenCalledWith('backups/full/');
  });

  test('returns backups grouped by date with manifests', async () => {
    mockListObjectsWithMetadata.mockResolvedValue([
      { key: 'backups/full/2026-03-16/users.json', size: 1024 },
      { key: 'backups/full/2026-03-16/rooms.json', size: 512 },
      { key: 'backups/full/2026-03-15/users.json', size: 2048 },
    ]);

    // readR2Json uses r2.getObject — mock manifest lookups
    const manifestData = { collections: ['users', 'rooms'], totalDocs: 50 };
    mockGetObject.mockImplementation(async (key) => {
      if (key.includes('manifest.json')) {
        return { Body: jsonBodyStream(manifestData) };
      }
      throw Object.assign(new Error('Not found'), { name: 'NoSuchKey' });
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/backups').expect(200);

    expect(res.body.backups).toHaveLength(2);
    // Sorted by date descending
    expect(res.body.backups[0].date).toBe('2026-03-16');
    expect(res.body.backups[0].totalSize).toBe(1536);
    expect(res.body.backups[0].files).toHaveLength(2);
    expect(res.body.backups[0].manifest).toEqual(manifestData);

    expect(res.body.backups[1].date).toBe('2026-03-15');
    expect(res.body.backups[1].totalSize).toBe(2048);
  });

  test('handles missing manifests gracefully', async () => {
    mockListObjectsWithMetadata.mockResolvedValue([
      { key: 'backups/full/2026-03-16/users.json', size: 100 },
    ]);

    // Manifest not found
    mockGetObject.mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups').expect(200);

    expect(res.body.backups).toHaveLength(1);
    expect(res.body.backups[0].manifest).toBeNull();
  });

  test('skips objects with invalid date format in key', async () => {
    mockListObjectsWithMetadata.mockResolvedValue([
      { key: 'backups/full/invalid-date/users.json', size: 100 },
      { key: 'backups/full/2026-03-16/users.json', size: 200 },
    ]);

    mockGetObject.mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups').expect(200);

    expect(res.body.backups).toHaveLength(1);
    expect(res.body.backups[0].date).toBe('2026-03-16');
  });

  test('returns 500 on internal error', async () => {
    mockListObjectsWithMetadata.mockRejectedValue(new Error('R2 failure'));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups').expect(500);

    expect(res.body.error).toBe('Internal server error');
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/admin/backups/trigger — Trigger immediate backup
// ═════════════════════════════════════════════════════════════════

describe('POST /api/admin/backups/trigger', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).post('/api/admin/backups/trigger').expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('triggers backup and returns result', async () => {
    const app = createApp();
    const res = await request(app).post('/api/admin/backups/trigger').expect(200);

    expect(mockBackupFn).toHaveBeenCalledTimes(1);
    expect(res.body.message).toBe('Full backup completed');
    expect(res.body.date).toBe('2026-03-16');
    expect(res.body.manifest).toEqual({ collections: ['users'], totalDocs: 10 });
  });

  test('returns 500 when backup function throws', async () => {
    mockBackupFn.mockRejectedValue(new Error('Backup failed'));

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/trigger').expect(500);

    expect(res.body.error).toBe('Internal server error');
  });
});

// ═════════════════════════════════════════════════════════════════
// GET /api/admin/backups/:date/:collection — Download collection backup
// ═════════════════════════════════════════════════════════════════

describe('GET /api/admin/backups/:date/:collection', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).get('/api/admin/backups/2026-03-16/users').expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('returns 400 for invalid date format', async () => {
    const app = createApp();

    const res = await request(app).get('/api/admin/backups/not-a-date/users').expect(400);
    expect(res.body.error).toContain('Invalid date format');
  });

  test('returns 400 for invalid collection name', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/api/admin/backups/2026-03-16/nonexistent_collection')
      .expect(400);
    expect(res.body.error).toContain('Invalid collection name');
  });

  test('downloads collection backup successfully', async () => {
    const backupData = [{ id: 'user1', name: 'Test' }];
    mockGetObject.mockResolvedValue({
      Body: jsonBodyStream(backupData),
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16/users').expect(200);

    expect(mockGetObject).toHaveBeenCalledWith('backups/full/2026-03-16/users.json');
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual(backupData);
  });

  test('allows valid subcollection backup names (e.g. rooms_messages)', async () => {
    const backupData = [{ id: 'msg1', text: 'Hello' }];
    mockGetObject.mockResolvedValue({
      Body: jsonBodyStream(backupData),
    });

    const app = createApp();
    const _res = await request(app).get('/api/admin/backups/2026-03-16/rooms_messages').expect(200);

    expect(mockGetObject).toHaveBeenCalledWith('backups/full/2026-03-16/rooms_messages.json');
  });

  test('returns 404 when backup file not found (NoSuchKey)', async () => {
    mockGetObject.mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16/users').expect(404);

    expect(res.body.error).toContain('No backup found for users on 2026-03-16');
  });

  test('returns 404 when backup file not found (404 status)', async () => {
    mockGetObject.mockRejectedValue(
      Object.assign(new Error('Not found'), { $metadata: { httpStatusCode: 404 } }),
    );

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16/users').expect(404);

    expect(res.body.error).toContain('No backup found');
  });

  test('returns 500 on unexpected R2 error', async () => {
    mockGetObject.mockRejectedValue(new Error('R2 connection failed'));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16/users').expect(500);

    expect(res.body.error).toBe('Internal server error');
  });
});

// ═════════════════════════════════════════════════════════════════
// GET /api/admin/backups/:date — Download legacy users backup
// ═════════════════════════════════════════════════════════════════

describe('GET /api/admin/backups/:date', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).get('/api/admin/backups/2026-03-16').expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('returns 400 for invalid date format', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-3-16').expect(400);
    expect(res.body.error).toContain('Invalid date format');
  });

  test('downloads legacy users backup successfully', async () => {
    const backupData = [{ id: 'user1', name: 'Legacy User' }];
    mockGetObject.mockResolvedValue({
      Body: jsonBodyStream(backupData),
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16').expect(200);

    expect(mockGetObject).toHaveBeenCalledWith('backups/users/2026-03-16.json');
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual(backupData);
  });

  test('returns 404 when legacy backup not found', async () => {
    mockGetObject.mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16').expect(404);

    expect(res.body.error).toContain('No backup found for 2026-03-16');
  });

  test('returns 404 via $metadata 404 status code', async () => {
    mockGetObject.mockRejectedValue(
      Object.assign(new Error('Not found'), { $metadata: { httpStatusCode: 404 } }),
    );

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16').expect(404);

    expect(res.body.error).toContain('No backup found');
  });

  test('returns 500 on unexpected error', async () => {
    mockGetObject.mockRejectedValue(new Error('Disk failure'));

    const app = createApp();
    const res = await request(app).get('/api/admin/backups/2026-03-16').expect(500);

    expect(res.body.error).toBe('Internal server error');
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/admin/backups/restore/:date — Restore from backup
// ═════════════════════════════════════════════════════════════════

describe('POST /api/admin/backups/restore/:date', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).post('/api/admin/backups/restore/2026-03-16').expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('returns 400 for invalid date format', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/bad-date')
      .send({ mode: 'full' })
      .expect(400);

    expect(res.body.error).toContain('Invalid date format');
  });

  test('returns 400 for invalid mode', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'invalid' })
      .expect(400);

    expect(res.body.error).toContain('Invalid mode');
  });

  test('returns 400 when mode=collection but collection not specified', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'collection' })
      .expect(400);

    expect(res.body.error).toContain('collection is required');
  });

  test('defaults to missing-only mode when no mode specified', async () => {
    // readR2Json returns backup docs via mockGetObject
    // For missing-only, each doc checks existence
    mockGetObject.mockImplementation(async (_key) => {
      return {
        Body: jsonBodyStream([{ id: 'doc1', name: 'Test' }]),
      };
    });

    // Doc does not exist -> should be restored
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({})
      .expect(200);

    expect(res.body.mode).toBe('missing-only');
    expect(res.body.message).toContain('missing-only');
    // Pre-restore backup should have been triggered
    expect(mockBackupFn).toHaveBeenCalled();
  });

  test('full mode: deletes existing docs and writes backup docs', async () => {
    const backupDocs = [
      { id: 'user1', name: 'Alice' },
      { id: 'user2', name: 'Bob' },
    ];

    mockGetObject.mockImplementation(async () => ({
      Body: jsonBodyStream(backupDocs),
    }));

    // Simulate existing docs in collections
    const mockRef1 = { id: 'existing1' };
    const mockRef2 = { id: 'existing2' };
    mockCollectionGet.mockResolvedValue({
      docs: [{ ref: mockRef1 }, { ref: mockRef2 }],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'full' })
      .expect(200);

    expect(res.body.mode).toBe('full');
    expect(res.body.date).toBe('2026-03-16');
    // Pre-restore backup triggered
    expect(mockBackupFn).toHaveBeenCalled();
    // Batch deletes + batch commits happened for each collection
    expect(mockBatch).toHaveBeenCalled();
    expect(mockBatchDelete).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();
    // Documents set from backup
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('collection mode: restores only the specified collection', async () => {
    const backupDocs = [{ id: 'room1', name: 'Room A' }];

    mockGetObject.mockImplementation(async () => ({
      Body: jsonBodyStream(backupDocs),
    }));

    mockCollectionGet.mockResolvedValue({ docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'collection', collection: 'rooms' })
      .expect(200);

    expect(res.body.mode).toBe('collection');
    // Only rooms collection should be processed
    expect(res.body.results.rooms).toBeDefined();
    expect(res.body.results.rooms.status).toBe('restored');
    expect(res.body.results.rooms.restoredCount).toBe(1);
    expect(res.body.results.rooms.totalInBackup).toBe(1);
  });

  test('missing-only mode: skips existing docs and restores missing ones', async () => {
    const backupDocs = [
      { id: 'user1', name: 'Existing' },
      { id: 'user2', name: 'Missing' },
    ];

    mockGetObject.mockImplementation(async () => ({
      Body: jsonBodyStream(backupDocs),
    }));

    // First doc exists, second doesn't
    let callCount = 0;
    mockDocGet.mockImplementation(async () => {
      callCount++;
      return { exists: callCount % 2 === 1 };
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'missing-only' })
      .expect(200);

    expect(res.body.mode).toBe('missing-only');
    // At least some collections should have been processed
    expect(Object.keys(res.body.results).length).toBeGreaterThan(0);
  });

  test('skips collections with no backup file', async () => {
    // Return null (NoSuchKey) for all readR2Json calls
    mockGetObject.mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }));

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'full' })
      .expect(200);

    // All collections should be skipped
    for (const collName of Object.keys(res.body.results)) {
      expect(res.body.results[collName].status).toBe('skipped');
      expect(res.body.results[collName].reason).toContain('no backup file found');
    }
  });

  test('skips backup docs without id field', async () => {
    const backupDocs = [
      { id: 'valid1', name: 'Valid' },
      { name: 'No ID Doc' }, // missing id
    ];

    mockGetObject.mockImplementation(async () => ({
      Body: jsonBodyStream(backupDocs),
    }));

    mockCollectionGet.mockResolvedValue({ docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'collection', collection: 'users' })
      .expect(200);

    expect(res.body.results.users.restoredCount).toBe(1);
    expect(res.body.results.users.totalInBackup).toBe(2);
  });

  test('handles batch deletion of more than 500 docs', async () => {
    const backupDocs = [{ id: 'user1', name: 'Test' }];

    mockGetObject.mockImplementation(async () => ({
      Body: jsonBodyStream(backupDocs),
    }));

    // Simulate 501 existing docs
    const manyDocs = Array.from({ length: 501 }, (_, i) => ({
      ref: { id: `doc${i}` },
    }));
    mockCollectionGet.mockResolvedValue({ docs: manyDocs });

    const app = createApp();
    const _res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'collection', collection: 'users' })
      .expect(200);

    // Should have created 2 batches (500 + 1)
    expect(mockBatch).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  test('returns 500 on internal error', async () => {
    mockBackupFn.mockRejectedValue(new Error('Pre-restore backup failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/backups/restore/2026-03-16')
      .send({ mode: 'full' })
      .expect(500);

    expect(res.body.error).toBe('Internal server error');
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/admin/backups/recover-photos — Recover photo URLs
// ═════════════════════════════════════════════════════════════════

describe('POST /api/admin/backups/recover-photos', () => {
  test('returns 403 for non-admin', async () => {
    mockRequireAdmin.mockImplementation((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const app = createApp(false);
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(403);
    expect(res.body.error).toBeDefined();
  });

  test('returns 0 recovered when no photos in R2', async () => {
    mockListObjectsWithMetadata.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(0);
    // Should have been called for both profiles/ and covers/
    expect(mockListObjectsWithMetadata).toHaveBeenCalledWith('profiles/');
    expect(mockListObjectsWithMetadata).toHaveBeenCalledWith('covers/');
  });

  test('recovers missing profile photo URLs', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'profiles/') {
        return [{ key: 'profiles/uid1/photo.jpg', lastModified: new Date('2026-03-16') }];
      }
      return [];
    });

    // User exists but has no profilePhotoUrl
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Test User', profilePhotoUrl: null }),
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(1);
    expect(mockDocUpdate).toHaveBeenCalledWith({
      profilePhotoUrl: 'https://images.test.example.com/profiles/uid1/photo.jpg',
    });
  });

  test('recovers missing cover photo URLs', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'covers/') {
        return [{ key: 'covers/uid2/cover.jpg', lastModified: new Date('2026-03-16') }];
      }
      return [];
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Test User', coverPhotoUrl: null }),
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(1);
    expect(mockDocUpdate).toHaveBeenCalledWith({
      coverPhotoUrl: 'https://images.test.example.com/covers/uid2/cover.jpg',
    });
  });

  test('skips users who already have photo URLs', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'profiles/') {
        return [{ key: 'profiles/uid1/photo.jpg', lastModified: new Date('2026-03-16') }];
      }
      return [];
    });

    // User already has a profilePhotoUrl
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'User',
        profilePhotoUrl: 'https://images.test.example.com/profiles/uid1/old.jpg',
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(0);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('skips users that do not exist in Firestore', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'profiles/') {
        return [{ key: 'profiles/deleted-uid/photo.jpg', lastModified: new Date('2026-03-16') }];
      }
      return [];
    });

    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(0);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('keeps the most recently modified photo per user', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'profiles/') {
        return [
          { key: 'profiles/uid1/old.jpg', lastModified: new Date('2026-03-01') },
          { key: 'profiles/uid1/new.jpg', lastModified: new Date('2026-03-15') },
        ];
      }
      return [];
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'User', profilePhotoUrl: null }),
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(1);
    expect(mockDocUpdate).toHaveBeenCalledWith({
      profilePhotoUrl: 'https://images.test.example.com/profiles/uid1/new.jpg',
    });
  });

  test('skips R2 objects with too few path segments', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'profiles/') {
        return [
          { key: 'profiles/orphan', lastModified: new Date('2026-03-16') }, // only 2 parts, < 3
        ];
      }
      return [];
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(0);
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  test('recovers both profile and cover photos in one call', async () => {
    mockListObjectsWithMetadata.mockImplementation(async (prefix) => {
      if (prefix === 'profiles/') {
        return [{ key: 'profiles/uid1/profile.jpg', lastModified: new Date('2026-03-16') }];
      }
      if (prefix === 'covers/') {
        return [{ key: 'covers/uid2/cover.jpg', lastModified: new Date('2026-03-16') }];
      }
      return [];
    });

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'User' }), // both fields undefined -> falsy
    });

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(200);

    expect(res.body.recovered).toBe(2);
  });

  test('returns 500 on internal error', async () => {
    mockListObjectsWithMetadata.mockRejectedValue(new Error('R2 down'));

    const app = createApp();
    const res = await request(app).post('/api/admin/backups/recover-photos').expect(500);

    expect(res.body.error).toBe('Internal server error');
  });
});
