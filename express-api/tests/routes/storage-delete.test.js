const express = require('express');
const request = require('supertest');

// ─── Mocks ───────────────────────────────────────────────────────

const mockDeleteObject = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/r2', () => ({
  putObject: jest.fn().mockResolvedValue('https://images.shytalk.shyden.co.uk/test-key'),
  deleteObject: mockDeleteObject,
}));

jest.mock('../../src/utils/helpers', () => ({
  getExtension: jest.fn((mime) => {
    const map = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif',
    };
    return map[mime] || 'bin';
  }),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const storageRouter = require('../../src/routes/storage');

/**
 * Build a test app with a given uniqueId injected into req.auth.
 * The key ownership check is: keyParts[1] === String(req.auth.uniqueId)
 */
function createApp(uniqueId = 'user-abc') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid-' + uniqueId, uniqueId };
    next();
  });
  app.use('/api', storageRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('DELETE /api/storage/delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteObject.mockResolvedValue();
  });

  it('returns 400 when key query param is missing', async () => {
    const app = createApp('user-abc');
    const res = await request(app).delete('/api/storage/delete');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing key/i);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('returns 403 when key does not contain the caller uniqueId', async () => {
    // Key format: "{path}/{uniqueId}/{filename}"
    // Authenticated as 'user-abc' but key belongs to 'other-user'
    const app = createApp('user-abc');
    const res = await request(app)
      .delete('/api/storage/delete')
      .query({ key: 'profiles/other-user/1234567890-photo.jpg' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/i);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('returns 200 and calls deleteObject when key matches the caller uniqueId', async () => {
    const app = createApp('user-abc');
    const key = 'profiles/user-abc/1700000000000-abcdef.jpg';
    const res = await request(app).delete('/api/storage/delete').query({ key });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDeleteObject).toHaveBeenCalledWith(key);
  });
});
