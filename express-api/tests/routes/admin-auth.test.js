const express = require('express');
const request = require('supertest');

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const _mockCollectionWhere = jest.fn();
const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          get: mockCollectionGet,
        }),
      }),
    })),
  },
  auth: {},
  FieldValue: { increment: jest.fn((n) => `increment(${n})`) },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // allow all
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
  authMiddleware: (req, res, next) => next(),
}));
jest.mock('../../src/utils/gcs', () => ({ computeDisplayScore: () => 0 }));
jest.mock('../../src/utils/system-pm', () => ({ sendSystemPm: jest.fn() }));

const { getDoc } = require('../../src/utils/firestore-helpers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { uniqueId: 99999999, uid: 'admin-uid' };
    next();
  });
  app.use('/api', require('../../src/routes/admin-users'));
  return app;
}

describe('Admin Auth Management', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/user/:uniqueId/auth-status', () => {
    it('should return PIN and biometric status', async () => {
      getDoc.mockResolvedValueOnce({
        pinHash: '$2b$10$hash',
        pinSetAt: 1709913600000,
        pinAttempts: 2,
        pinLockedUntil: null,
        pinLockoutCount: 0,
      });
      mockCollectionGet.mockResolvedValueOnce({
        docs: [{ id: '12345678:dev-1', data: () => ({ createdAt: 1709913600000 }) }],
      });

      const res = await request(app).get('/api/user/12345678/auth-status');

      expect(res.status).toBe(200);
      expect(res.body.pinSet).toBe(true);
      expect(res.body.pinAttempts).toBe(2);
      expect(res.body.isLocked).toBe(false);
      expect(res.body.biometricKeys).toHaveLength(1);
      expect(res.body.biometricKeys[0].deviceId).toBe('dev-1');
    });

    it('should return 404 for unknown user', async () => {
      getDoc.mockResolvedValueOnce(null);

      const res = await request(app).get('/api/user/99999999/auth-status');
      expect(res.status).toBe(404);
    });

    it('should show locked state when pinLockedUntil is in the future', async () => {
      getDoc.mockResolvedValueOnce({
        pinLockedUntil: Date.now() + 10 * 60 * 1000,
        pinAttempts: 5,
        pinLockoutCount: 1,
      });
      mockCollectionGet.mockResolvedValueOnce({ docs: [] });

      const res = await request(app).get('/api/user/12345678/auth-status');

      expect(res.status).toBe(200);
      expect(res.body.isLocked).toBe(true);
    });
  });

  describe('POST /api/user/:uniqueId/reset-pin-lockout', () => {
    it('should reset lockout fields', async () => {
      const res = await request(app).post('/api/user/12345678/reset-pin-lockout');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('PIN lockout reset');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        'users/12345678',
        expect.objectContaining({ pinAttempts: 0, pinLockedUntil: null, pinLockoutCount: 0 }),
      );
    });
  });

  describe('DELETE /api/user/:uniqueId/biometric-keys/:deviceId', () => {
    it('should delete biometric key', async () => {
      const res = await request(app).delete('/api/user/12345678/biometric-keys/dev-1');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Biometric key revoked');
      expect(mockDocDelete).toHaveBeenCalledWith('biometricKeys/12345678:dev-1');
    });
  });

  describe('GET /api/metrics/otp', () => {
    it('should return OTP metrics', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ count: 42, date: '2026-03-15' }),
      });

      const res = await request(app).get('/api/metrics/otp');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(42);
      expect(res.body.date).toBe('2026-03-15');
      expect(res.body.limit).toBe(100);
    });

    it('should return zeros when no metrics exist', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const res = await request(app).get('/api/metrics/otp');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });
});
