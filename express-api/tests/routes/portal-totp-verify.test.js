/* eslint-disable no-unused-vars */
const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ empty: true }),
        })),
      })),
    })),
  },
  auth: {
    verifyIdToken: jest.fn(),
    getUser: jest.fn(),
    setCustomUserClaims: jest.fn().mockResolvedValue(),
    revokeRefreshTokens: jest.fn().mockResolvedValue(),
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  generalLimiter: (req, res, next) => next(),
  writeLimiter: (req, res, next) => next(),
  sensitiveLimiter: (req, res, next) => next(),
  portalLimiter: (req, res, next) => next(),
  recoveryLimiter: (req, res, next) => next(),
}));

// Mock totp-crypto: track calls without real encryption
const mockEncryptSecret = jest.fn((s) => `encrypted:${s}`);
const mockDecryptSecret = jest.fn((s) => s.replace('encrypted:', ''));

jest.mock('../../src/utils/totp-crypto', () => ({
  encryptSecret: (...args) => mockEncryptSecret(...args),
  decryptSecret: (...args) => mockDecryptSecret(...args),
}));

// Mock otplib functional API
const mockGenerateSecret = jest.fn(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
const mockGenerateURI = jest.fn(
  ({ secret, label, issuer }) =>
    `otpauth://totp/${issuer}:${encodeURIComponent(label)}?secret=${secret}&issuer=${issuer}`,
);
const mockVerifySync = jest.fn(() => ({ valid: true, delta: 0 }));

jest.mock('otplib/functional', () => ({
  generateSecret: (...args) => mockGenerateSecret(...args),
  generateURI: (...args) => mockGenerateURI(...args),
  verifySync: (...args) => mockVerifySync(...args),
}));

jest.mock('@otplib/plugin-crypto-noble', () => ({
  NobleCryptoPlugin: class MockNobleCryptoPlugin {},
}));

jest.mock('@otplib/plugin-base32-scure', () => ({
  ScureBase32Plugin: class MockScureBase32Plugin {},
}));

const { auth } = require('../../src/utils/firebase');

// ─── Helper: build a mini express app ───────────────────────────
let mockAuth;

jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req, res, next) => next(),
  authMiddlewareStrict: (req, res, next) => {
    if (!mockAuth) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    req.auth = mockAuth;
    next();
  },
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', require('../../src/routes/portal'));
  return app;
}

// ─── Helpers ────────────────────────────────────────────────────

function setMockAuth(overrides = {}) {
  mockAuth = {
    uid: 'firebase-uid-1',
    uniqueId: 12345,
    token: {
      uid: 'firebase-uid-1',
      admin: false,
      email: 'test@example.com',
      firebase: { sign_in_provider: 'password' },
      totpVerified: false,
      totpVerifiedAt: null,
      ...overrides.token,
    },
    ...overrides,
  };
}

function makePendingDoc(overrides = {}) {
  return {
    exists: true,
    data: () => ({
      encryptedSecret: 'encrypted:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', // eslint-disable-line sonarjs/no-hardcoded-secrets -- test mock data
      expiresAt: Date.now() + 600000, // 10 minutes from now
      attempts: 0,
      ...overrides,
    }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

// ─── TOTP Verify (post-login re-verification) ──────────────────

function makeTotpDoc(overrides = {}) {
  return {
    exists: true,
    data: () => ({
      encryptedSecret: 'encrypted:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', // eslint-disable-line sonarjs/no-hardcoded-secrets -- test mock data
      createdAt: Date.now() - 86400000,
      lastUsedCode: null,
      lastUsedAt: null,
      ...overrides,
    }),
  };
}

describe('POST /api/portal/totp/verify', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    app = buildApp();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
  });

  // ─── 1. Valid code → 200, totpVerified claim set ─────────────

  it('should return 200 with success:true and set totpVerified claim for valid code', async () => {
    setMockAuth();
    // private/totp exists
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        totpVerified: true,
        totpVerifiedAt: expect.any(Number),
      }),
    );
  });

  // ─── 2. Invalid code → 401 ──────────────────────────────────

  it('should return 401 for invalid TOTP code', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    mockVerifySync.mockReturnValueOnce({ valid: false });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '999999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid code/i);
  });

  // ─── 3. OAuth user (no password provider) → 400 ─────────────

  it('should return 400 for OAuth user (google.com)', async () => {
    setMockAuth({ token: { firebase: { sign_in_provider: 'google.com' } } });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password provider required/i);
  });

  // ─── 4. User has no TOTP enrolled → 403 ─────────────────────

  it('should return 403 when user has no TOTP enrolled', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/totp not enrolled/i);
  });

  // ─── 5. No auth token → 401 ────────────────────────────────

  it('should return 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(401);
  });

  // ─── 6. Code "12345" (5 digits) → 400 ──────────────────────

  it('should return 400 for 5-digit code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 7. Code "abcdef" → 400 ────────────────────────────────

  it('should return 400 for alphabetic code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/verify').send({ code: 'abcdef' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 8. Code "" → 400 ──────────────────────────────────────

  it('should return 400 for empty string code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 9. Code null/missing → 400 ────────────────────────────

  it('should return 400 for null code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/verify').send({ code: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should return 400 when code field is missing from body', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/verify').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 10. Replay same valid code within same 30s window → 401

  it('should return 401 when replaying the same code within 30s window', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeTotpDoc({
        lastUsedCode: '123456',
        lastUsedAt: Date.now() - 5000, // 5 seconds ago
      }),
    );

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/code already used/i);
  });

  // ─── 11. Same code in next 30s window (lastUsedAt > 30s ago) → accepted

  it('should allow same code when outside 30s replay window', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeTotpDoc({
        lastUsedCode: '123456',
        lastUsedAt: Date.now() - 31000, // 31 seconds ago
      }),
    );
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── 12. otplib throws unexpected error → 503 ──────────────

  it('should return 503 when otplib throws an unexpected error', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    mockVerifySync.mockImplementationOnce(() => {
      throw new Error('otplib internal failure');
    });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(503);
  });

  // ─── 13. Admin user verifies TOTP → 200, admin:true preserved

  it('should preserve admin:true claim alongside totpVerified for admin user', async () => {
    setMockAuth({ token: { admin: true, firebase: { sign_in_provider: 'password' } } });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({ customClaims: { admin: true } });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        admin: true,
        totpVerified: true,
        totpVerifiedAt: expect.any(Number),
      }),
    );
  });

  // ─── 14. Existing custom claims preserved after setting totpVerified

  it('should preserve all existing custom claims when setting totpVerified', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({
      customClaims: { someFeatureFlag: true, role: 'moderator' },
    });

    const res = await request(app).post('/api/portal/totp/verify').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        someFeatureFlag: true,
        role: 'moderator',
        totpVerified: true,
        totpVerifiedAt: expect.any(Number),
      }),
    );
  });
});

// ─── TOTP Delete (re-enrollment) ───────────────────────────────

// ─── State Transition / Integration Tests ─────────────────────────
