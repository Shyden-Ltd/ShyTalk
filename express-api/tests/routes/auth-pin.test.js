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
  },
  auth: {
    createCustomToken: jest.fn().mockResolvedValue('pin-custom-token'),
  },
  FieldValue: {},
}));

jest.mock('../../src/utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../../src/utils/email-templates', () => ({
  buildOtpEmail: jest.fn(() => ({ subject: 's', html: 'h' })),
  buildLockoutEmail: jest.fn(() => ({ subject: 's', html: 'h' })),
  buildResetEmail: jest.fn(() => ({ subject: 's', html: 'h' })),
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$pinhash'),
  compare: jest.fn(),
}));

// Mock authMiddleware used by authenticated routes in auth.js
jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req, res, next) => next(),
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  generalLimiter: (req, res, next) => next(),
  writeLimiter: (req, res, next) => next(),
  sensitiveLimiter: (req, res, next) => next(),
}));

const bcrypt = require('bcrypt');
const { auth } = require('../../src/utils/firebase');

function buildApp(authUser) {
  const app = express();
  app.use(express.json());
  // Simulate auth middleware for authenticated routes
  if (authUser) {
    app.use((req, res, next) => {
      req.auth = authUser;
      next();
    });
  }
  app.use('/api', require('../../src/routes/auth'));
  return app;
}

describe('PIN Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── POST /api/auth/pin/setup ─────────────────────────────────

  describe('POST /api/auth/pin/setup', () => {
    it('should set PIN and return 200', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/setup').send({ pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('PIN set');
      expect(bcrypt.hash).toHaveBeenCalledWith('1234', 10);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        'users/12345678',
        expect.objectContaining({
          pinHash: '$2b$10$pinhash',
          pinAttempts: 0,
          pinLockedUntil: null,
          pinLockoutCount: 0,
        }),
      );
    });

    it('should accept 8-digit PIN', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/setup').send({ pin: '12345678' });

      expect(res.status).toBe(200);
    });

    it('should reject PIN shorter than 4 digits', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/setup').send({ pin: '123' });

      expect(res.status).toBe(400);
    });

    it('should reject PIN longer than 8 digits', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/setup').send({ pin: '123456789' });

      expect(res.status).toBe(400);
    });

    it('should reject non-numeric PIN', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/setup').send({ pin: '12ab' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/numeric/i);
    });

    it('should reject missing PIN', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/setup').send({});

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const app = buildApp(null);

      const res = await request(app).post('/api/auth/pin/setup').send({ pin: '1234' });

      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/auth/pin/verify ────────────────────────────────

  describe('POST /api/auth/pin/verify', () => {
    const validUser = {
      pinHash: '$2b$10$existinghash',
      pinAttempts: 0,
      pinLockedUntil: null,
      pinLockoutCount: 0,
      firebaseUid: 'fb-uid-123',
    };

    it('should return custom token on correct PIN', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...validUser }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.customToken).toBe('pin-custom-token');
      expect(auth.createCustomToken).toHaveBeenCalledWith('fb-uid-123');
    });

    it('should reset attempts on successful verify', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...validUser, pinAttempts: 3 }),
      });

      const app = buildApp(null);
      await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '1234' });

      expect(mockDocUpdate).toHaveBeenCalledWith(
        'users/12345678',
        expect.objectContaining({ pinAttempts: 0, pinLockedUntil: null }),
      );
    });

    it('should return 401 on wrong PIN with attempts remaining', async () => {
      bcrypt.compare.mockResolvedValueOnce(false);
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...validUser }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '0000' });

      expect(res.status).toBe(401);
      expect(res.body.attemptsRemaining).toBe(4);
    });

    it('should return 423 after 5 failed attempts (lockout)', async () => {
      bcrypt.compare.mockResolvedValueOnce(false);
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...validUser, pinAttempts: 4 }), // 4th attempt, this will be 5th
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '0000' });

      expect(res.status).toBe(423);
      expect(res.body.locked).toBe(true);
      expect(res.body.lockedUntil).toBeGreaterThan(Date.now());
      expect(res.body.attemptsRemaining).toBe(0);
    });

    it('should return 423 while still locked', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ...validUser,
          pinLockedUntil: Date.now() + 10 * 60 * 1000, // 10 min from now
          pinAttempts: 5,
        }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '1234' });

      expect(res.status).toBe(423);
      expect(res.body.locked).toBe(true);
    });

    it('should allow attempts after lockout expires', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ...validUser,
          pinLockedUntil: Date.now() - 1000, // expired
          pinAttempts: 5,
          pinLockoutCount: 1,
        }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.customToken).toBeTruthy();
    });

    it('should set requiresReauth on second lockout', async () => {
      bcrypt.compare.mockResolvedValueOnce(false);
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ...validUser,
          pinAttempts: 4,
          pinLockoutCount: 1, // already had one lockout
        }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '0000' });

      expect(res.status).toBe(423);
      expect(res.body.requiresReauth).toBe(true);
    });

    it('should return 404 if user not found', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 99999999, deviceId: 'dev-1', pin: '1234' });

      expect(res.status).toBe(404);
    });

    it('should return 404 if no PIN set', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ firebaseUid: 'uid', pinHash: null }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/pin/verify')
        .send({ uniqueId: 12345678, deviceId: 'dev-1', pin: '1234' });

      expect(res.status).toBe(404);
    });

    it('should reject missing fields', async () => {
      const app = buildApp(null);

      const res = await request(app).post('/api/auth/pin/verify').send({ uniqueId: 12345678 });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/auth/pin/reset ─────────────────────────────────

  describe('POST /api/auth/pin/reset', () => {
    it('should reset PIN and clear lockout', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/reset').send({ pin: '5678' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('PIN reset');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        'users/12345678',
        expect.objectContaining({
          pinHash: '$2b$10$pinhash',
          pinAttempts: 0,
          pinLockedUntil: null,
          pinLockoutCount: 0,
        }),
      );
    });

    it('should reject invalid PIN on reset', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).post('/api/auth/pin/reset').send({ pin: 'abc' });

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const app = buildApp(null);

      const res = await request(app).post('/api/auth/pin/reset').send({ pin: '5678' });

      expect(res.status).toBe(401);
    });
  });
});
