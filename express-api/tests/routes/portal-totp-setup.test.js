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

describe('POST /api/portal/totp/setup', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    app = buildApp();
  });

  // ─── 1. Valid password user, no TOTP → 200 ─────────────────────

  it('should return 200 with secret and qrCodeUrl for valid password user', async () => {
    setMockAuth();
    // private/totp does not exist
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(200);
    expect(res.body.secret).toBeDefined();
    expect(res.body.qrCodeUrl).toBeDefined();
    expect(typeof res.body.secret).toBe('string');
    expect(typeof res.body.qrCodeUrl).toBe('string');
  });

  // ─── 2. qrCodeUrl contains secret param matching response secret ──

  it('should return qrCodeUrl containing secret param matching response secret', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(200);
    expect(res.body.qrCodeUrl).toContain(`secret=${res.body.secret}`);
  });

  // ─── 3. qrCodeUrl contains issuer=ShyTalk ─────────────────────

  it('should return qrCodeUrl containing issuer=ShyTalk', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(200);
    expect(res.body.qrCodeUrl).toContain('issuer=ShyTalk');
  });

  // ─── 4. OAuth user → 400 ──────────────────────────────────────

  it('should return 400 for OAuth user (google.com)', async () => {
    setMockAuth({ token: { firebase: { sign_in_provider: 'google.com' } } });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password provider required/i);
  });

  it('should return 400 for OAuth user (apple.com)', async () => {
    setMockAuth({ token: { firebase: { sign_in_provider: 'apple.com' } } });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password provider required/i);
  });

  // ─── 5. User already has TOTP → 409 ──────────────────────────

  it('should return 409 when user already has TOTP enrolled', async () => {
    setMockAuth();
    // private/totp exists
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ encryptedSecret: 'enc' }) });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already enrolled/i);
  });

  // ─── 6. User refreshed mid-enrollment → 200, new secret ──────

  it('should return 200 with new secret when totp-pending already exists (page refresh)', async () => {
    setMockAuth();
    // private/totp does not exist
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(200);
    expect(res.body.secret).toBeDefined();
    // mockDocSet should have been called to overwrite totp-pending
    expect(mockDocSet).toHaveBeenCalled();
  });

  // ─── 7. Generated secret length ≥ 32 BASE32 chars ────────────

  it('should generate a secret of at least 32 BASE32 characters', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(200);
    expect(res.body.secret.length).toBeGreaterThanOrEqual(32);
  });

  // ─── 8. No auth → 401 ─────────────────────────────────────────

  it('should return 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/portal/totp/setup');

    expect(res.status).toBe(401);
  });

  // ─── Additional: encrypts secret before storing ───────────────

  it('should encrypt the secret before storing in totp-pending', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await request(app).post('/api/portal/totp/setup');

    expect(mockEncryptSecret).toHaveBeenCalledWith('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    // Verify totp-pending doc was stored with encrypted secret
    const setPendingCall = mockDocSet.mock.calls.find((call) =>
      call[0]?.includes?.('totp-pending'),
    );
    // The set call is on db.doc(path).set(data), so the first arg to mockDocSet is the path
    expect(setPendingCall).toBeDefined();
  });

  // ─── Additional: stores correct pending doc fields ────────────

  it('should store totp-pending with encryptedSecret, expiresAt, and attempts', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const beforeTime = Date.now();
    await request(app).post('/api/portal/totp/setup');
    const afterTime = Date.now();

    // Find the set call for totp-pending
    const setPendingCall = mockDocSet.mock.calls.find((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(setPendingCall).toBeDefined();

    const data = setPendingCall[1] || setPendingCall[0];
    // Data should have encryptedSecret, expiresAt, attempts
    expect(data.encryptedSecret).toBe('encrypted:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    expect(data.attempts).toBe(0);
    // expiresAt should be ~10 minutes from now
    expect(data.expiresAt).toBeGreaterThanOrEqual(beforeTime + 600000 - 100);
    expect(data.expiresAt).toBeLessThanOrEqual(afterTime + 600000 + 100);
  });
});

describe('POST /api/portal/totp/confirm-setup', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    app = buildApp();
    // Default: verifySync returns valid
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
  });

  // ─── 1. Valid code → 200 ──────────────────────────────────────

  it('should return 200 with success:true for valid code', async () => {
    setMockAuth();
    // totp-pending exists with valid data
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    // totp doc read for replay check (doesn't exist yet)
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should create private/totp doc on valid confirmation', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    // Verify totp doc was created
    const setTotpCall = mockDocSet.mock.calls.find(
      (call) => String(call[0]).includes('/private/totp') && !String(call[0]).includes('pending'),
    );
    expect(setTotpCall).toBeDefined();
  });

  it('should delete totp-pending doc on valid confirmation', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    // Verify totp-pending was deleted
    const deleteCall = mockDocDelete.mock.calls.find((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(deleteCall).toBeDefined();
  });

  it('should set totpVerified claims on valid confirmation', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: { someExisting: true } });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        someExisting: true,
        totpVerified: true,
        totpVerifiedAt: expect.any(Number),
      }),
    );
  });

  it('should call revokeRefreshTokens on valid confirmation', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');
  });

  // ─── 2. Invalid code → 401 ───────────────────────────────────

  it('should return 401 for invalid TOTP code', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockVerifySync.mockReturnValueOnce({ valid: false });

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '999999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid code/i);
  });

  // ─── 3. No pending session → 400 ─────────────────────────────

  it('should return 400 when no pending setup session exists', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no pending setup session/i);
  });

  // ─── 4. Expired session → 400 ────────────────────────────────

  it('should return 400 when setup session has expired', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc({ expiresAt: Date.now() - 1000 }));

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setup session expired/i);
  });

  // ─── 5. 6th attempt → 429 ────────────────────────────────────

  it('should return 429 when attempts counter is already at 5', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc({ attempts: 5 }));

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });

  // ─── 6. No auth → 401 ─────────────────────────────────────────

  it('should return 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(401);
  });

  // ─── 7. Code "12345" (5 digits) → 400 ────────────────────────

  it('should return 400 for 5-digit code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 8. Code "abcdef" → 400 ──────────────────────────────────

  it('should return 400 for alphabetic code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: 'abcdef' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 9. Code "" → 400 ────────────────────────────────────────

  it('should return 400 for empty string code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 10. Code null → 400 ─────────────────────────────────────

  it('should return 400 for null code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 11. Replay same code in same 30s window → 401 ───────────

  it('should return 401 when replaying the same code within 30s window', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    // totp doc exists with lastUsedCode matching
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        lastUsedCode: '123456',
        lastUsedAt: Date.now() - 5000, // 5 seconds ago (within 30s window)
      }),
    });

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/code already used/i);
  });

  // ─── Additional: increments attempts on invalid code ──────────

  it('should increment attempts counter on invalid code', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc({ attempts: 2 }));
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockVerifySync.mockReturnValueOnce({ valid: false });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '999999' });

    // Verify the pending doc was updated with incremented attempts
    const setCall = mockDocSet.mock.calls.find((call) => String(call[0]).includes('totp-pending'));
    expect(setCall).toBeDefined();
    const data = setCall[1] || setCall[0];
    expect(data.attempts).toBe(3);
  });

  // ─── Additional: code missing from body → 400 ────────────────

  it('should return 400 when code field is missing from body', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── Additional: 7-digit code → 400 ──────────────────────────

  it('should return 400 for 7-digit code', async () => {
    setMockAuth();

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '1234567' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── Additional: attempts at 4 should still work ─────────────

  it('should allow verification when attempts counter is at 4', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc({ attempts: 4 }));
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── Additional: replay outside 30s window → allowed ──────────

  it('should allow same code when outside 30s replay window', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    // totp doc exists with lastUsedCode matching but > 30s ago
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        lastUsedCode: '123456',
        lastUsedAt: Date.now() - 31000, // 31 seconds ago (outside window)
      }),
    });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── Additional: decrypts secret before verification ──────────

  it('should decrypt the secret from the pending doc for verification', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makePendingDoc({ encryptedSecret: 'encrypted:MYSECRETKEY123456789012345678901' }),
    );
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    expect(mockDecryptSecret).toHaveBeenCalledWith('encrypted:MYSECRETKEY123456789012345678901');
  });

  // ─── Additional: re-encrypts secret with fresh IV for permanent storage ─

  it('should re-encrypt the secret with fresh IV when storing permanent totp doc', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).post('/api/portal/totp/confirm-setup').send({ code: '123456' });

    // encryptSecret should be called for the permanent doc
    expect(mockEncryptSecret).toHaveBeenCalledWith('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  });
});

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

// ─── TOTP Delete (re-enrollment) ───────────────────────────────

// ─── State Transition / Integration Tests ─────────────────────────
