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

describe('DELETE /api/portal/totp', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    app = buildApp();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
  });

  // ─── 1. Valid TOTP code → 200, private/totp deleted, sessions revoked, totpVerified cleared

  it('should return 200, delete private/totp, revoke sessions, and clear totpVerified on valid code', async () => {
    setMockAuth();
    // private/totp exists
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({
      customClaims: { totpVerified: true, totpVerifiedAt: 1234 },
    });

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // private/totp should be deleted
    const deleteTotpCall = mockDocDelete.mock.calls.find(
      (call) => String(call[0]).includes('/private/totp') && !String(call[0]).includes('pending'),
    );
    expect(deleteTotpCall).toBeDefined();

    // sessions revoked
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');

    // totpVerified cleared
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        totpVerified: false,
        totpVerifiedAt: null,
      }),
    );
  });

  // ─── 2. Invalid TOTP code → 401

  it('should return 401 for invalid TOTP code', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    mockVerifySync.mockReturnValueOnce({ valid: false });

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '999999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid code/i);
  });

  // ─── 3. No TOTP enrolled → 403

  it('should return 403 when user has no TOTP enrolled', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/totp not enrolled/i);
  });

  // ─── 4. No auth token → 401

  it('should return 401 when no auth token is provided', async () => {
    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(res.status).toBe(401);
  });

  // ─── 5. Code "12345" (5 digits) → 400

  it('should return 400 for 5-digit totpCode', async () => {
    setMockAuth();

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 6. Code "abcdef" → 400

  it('should return 400 for alphabetic totpCode', async () => {
    setMockAuth();

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: 'abcdef' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 7. Code "" → 400

  it('should return 400 for empty string totpCode', async () => {
    setMockAuth();

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 8. totpCode null/missing → 400

  it('should return 400 for null totpCode', async () => {
    setMockAuth();

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should return 400 when totpCode field is missing from body', async () => {
    setMockAuth();

    const res = await request(app).delete('/api/portal/totp').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 9. Replay same code in same 30s window → 401

  it('should return 401 when replaying the same code within 30s window', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeTotpDoc({
        lastUsedCode: '123456',
        lastUsedAt: Date.now() - 5000, // 5 seconds ago (within 30s window)
      }),
    );

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/code already used/i);
  });

  // ─── 10. Admin user: admin claim preserved after TOTP deletion

  it('should preserve admin claim after TOTP deletion for admin user', async () => {
    setMockAuth({ token: { admin: true, firebase: { sign_in_provider: 'password' } } });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({ customClaims: { admin: true, totpVerified: true } });

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        admin: true,
        totpVerified: false,
        totpVerifiedAt: null,
      }),
    );
  });

  // ─── Additional: totp-pending also deleted if it exists

  it('should also delete totp-pending doc during cleanup', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    // Both totp and totp-pending should be deleted
    const deletePendingCall = mockDocDelete.mock.calls.find((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(deletePendingCall).toBeDefined();
  });

  // ─── Additional: replay outside 30s window → allowed (then deletes)

  it('should allow deletion when same code is outside 30s replay window', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeTotpDoc({
        lastUsedCode: '123456',
        lastUsedAt: Date.now() - 31000, // 31 seconds ago (outside window)
      }),
    );
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── Additional: decrypts secret for verification

  it('should decrypt the stored secret before verifying the code', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeTotpDoc({ encryptedSecret: 'encrypted:MYSECRETKEY123456789012345678901' }),
    );
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(mockDecryptSecret).toHaveBeenCalledWith('encrypted:MYSECRETKEY123456789012345678901');
  });
});

// ─── State Transition / Integration Tests ─────────────────────────
describe('TOTP State Transitions', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    app = buildApp();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
  });

  // ─── 1. Full lifecycle: setup → confirm → verify ──────────────

  it('should complete full lifecycle: setup → confirm-setup → verify', async () => {
    // Step 1: Setup — no existing TOTP
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false }); // private/totp does not exist

    const setupRes = await request(app).post('/api/portal/totp/setup');

    expect(setupRes.status).toBe(200);
    expect(setupRes.body.secret).toBeDefined();
    expect(setupRes.body.qrCodeUrl).toBeDefined();

    // Verify the pending doc was stored via mockDocSet
    const pendingSetCall = mockDocSet.mock.calls.find((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(pendingSetCall).toBeDefined();

    // Step 2: Confirm — pending doc exists, totp doc does not
    mockDocGet.mockResolvedValueOnce(makePendingDoc()); // totp-pending exists
    mockDocGet.mockResolvedValueOnce({ exists: false }); // totp doc for replay check
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: '123456' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);

    // Verify permanent totp doc was created
    const setTotpCall = mockDocSet.mock.calls.find(
      (call) => String(call[0]).includes('/private/totp') && !String(call[0]).includes('pending'),
    );
    expect(setTotpCall).toBeDefined();

    // Verify pending doc was cleaned up
    const deletePendingCall = mockDocDelete.mock.calls.find((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(deletePendingCall).toBeDefined();

    // Verify totpVerified claim was set
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({ totpVerified: true, totpVerifiedAt: expect.any(Number) }),
    );

    // Step 3: Verify — totp doc now exists
    jest.clearAllMocks();
    setMockAuth();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc()); // private/totp exists
    auth.getUser.mockResolvedValueOnce({ customClaims: { totpVerified: true } });

    const verifyRes = await request(app).post('/api/portal/totp/verify').send({ code: '654321' });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({ totpVerified: true, totpVerifiedAt: expect.any(Number) }),
    );
  });

  // ─── 2. Re-enrollment: delete → setup → confirm ──────────────

  it('should allow re-enrollment: delete → setup → confirm with new secret', async () => {
    // Step 1: Delete existing TOTP
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeTotpDoc()); // private/totp exists
    auth.getUser.mockResolvedValueOnce({
      customClaims: { totpVerified: true, totpVerifiedAt: 1234 },
    });

    const deleteRes = await request(app).delete('/api/portal/totp').send({ totpCode: '123456' });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify TOTP doc was deleted
    const deleteTotpCall = mockDocDelete.mock.calls.find(
      (call) => String(call[0]).includes('/private/totp') && !String(call[0]).includes('pending'),
    );
    expect(deleteTotpCall).toBeDefined();

    // Verify claims were cleared
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({ totpVerified: false, totpVerifiedAt: null }),
    );

    // Step 2: Setup a new TOTP
    jest.clearAllMocks();
    setMockAuth();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });

    // Return a different secret for the new enrollment
    const newSecret = 'NEWSECRETNEWSECRETNEWSECRET23456';
    mockGenerateSecret.mockReturnValueOnce(newSecret);
    mockDocGet.mockResolvedValueOnce({ exists: false }); // no existing totp doc

    const setupRes = await request(app).post('/api/portal/totp/setup');

    expect(setupRes.status).toBe(200);
    expect(setupRes.body.secret).toBe(newSecret);

    // Step 3: Confirm with the new secret
    mockDocGet.mockResolvedValueOnce(makePendingDoc({ encryptedSecret: `encrypted:${newSecret}` }));
    mockDocGet.mockResolvedValueOnce({ exists: false }); // no replay
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: '789012' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);

    // The new secret should have been decrypted and re-encrypted
    expect(mockDecryptSecret).toHaveBeenCalledWith(`encrypted:${newSecret}`);
    expect(mockEncryptSecret).toHaveBeenCalledWith(newSecret);
  });

  // ─── 3. Cross-endpoint replay prevention ──────────────────────

  it('should prevent cross-endpoint replay: code used on confirm-setup cannot be reused on verify', async () => {
    const replayCode = '123456';

    // Step 1: Confirm setup with the code
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc()); // totp-pending
    mockDocGet.mockResolvedValueOnce({ exists: false }); // replay check — no prior use
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: replayCode });

    expect(confirmRes.status).toBe(200);

    // Step 2: Try to reuse the same code on verify
    // The permanent totp doc now has the lastUsedCode from confirm
    jest.clearAllMocks();
    setMockAuth();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(
      makeTotpDoc({
        lastUsedCode: replayCode,
        lastUsedAt: Date.now() - 5000, // within 30s window
      }),
    );

    const verifyRes = await request(app).post('/api/portal/totp/verify').send({ code: replayCode });

    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body.error).toMatch(/code already used/i);
  });

  // ─── 4. Expired setup session ─────────────────────────────────

  it('should reject confirm-setup when setup session has expired (mocked time)', async () => {
    // Step 1: Setup — creates pending doc
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const setupRes = await request(app).post('/api/portal/totp/setup');

    expect(setupRes.status).toBe(200);

    // Step 2: Try to confirm after session has expired
    // The pending doc's expiresAt is in the past
    mockDocGet.mockResolvedValueOnce(
      makePendingDoc({ expiresAt: Date.now() - 1 }), // already expired
    );

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: '123456' });

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.error).toMatch(/setup session expired/i);
  });

  it('should reject confirm-setup when Date.now has advanced past expiry', async () => {
    // Use a fixed initial time
    const originalNow = Date.now;
    const baseTime = 1700000000000;

    try {
      // Step 1: Setup at baseTime
      Date.now = jest.fn(() => baseTime);
      setMockAuth();
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const setupRes = await request(app).post('/api/portal/totp/setup');
      expect(setupRes.status).toBe(200);

      // Step 2: Advance time past expiry (10 min = 600000ms + 1ms)
      Date.now = jest.fn(() => baseTime + 600001);

      // The pending doc was created with expiresAt = baseTime + 600000
      mockDocGet.mockResolvedValueOnce(makePendingDoc({ expiresAt: baseTime + 600000 }));

      const confirmRes = await request(app)
        .post('/api/portal/totp/confirm-setup')
        .send({ code: '123456' });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.error).toMatch(/setup session expired/i);
    } finally {
      Date.now = originalNow;
    }
  });

  // ─── 5. Concurrent setup attempts ────────────────────────────

  it('should handle concurrent setup calls: second setup overwrites pending session', async () => {
    // First setup
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false }); // no existing totp

    const firstSecret = 'FIRSTSECRETFIRSTSECRETFIRSTSECR';
    mockGenerateSecret.mockReturnValueOnce(firstSecret);

    const setup1Res = await request(app).post('/api/portal/totp/setup');
    expect(setup1Res.status).toBe(200);
    expect(setup1Res.body.secret).toBe(firstSecret);

    // Capture the first pending doc set call
    const firstSetCall = mockDocSet.mock.calls.find((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(firstSetCall).toBeDefined();

    // Second setup — should overwrite the pending doc
    const secondSecret = 'SECONDSECRETSECONDSECRETSECONDSE';
    mockGenerateSecret.mockReturnValueOnce(secondSecret);
    mockDocGet.mockResolvedValueOnce({ exists: false }); // no existing totp

    const setup2Res = await request(app).post('/api/portal/totp/setup');
    expect(setup2Res.status).toBe(200);
    expect(setup2Res.body.secret).toBe(secondSecret);

    // Both calls should have written to the totp-pending path
    const pendingSetCalls = mockDocSet.mock.calls.filter((call) =>
      String(call[0]).includes('totp-pending'),
    );
    expect(pendingSetCalls.length).toBe(2);

    // The second call should have the second secret (encrypted)
    expect(mockEncryptSecret).toHaveBeenCalledWith(secondSecret);
  });

  it('should only accept code from the latest setup after concurrent attempts', async () => {
    // After two setups, confirming with the second secret should work
    setMockAuth();

    // Simulate: second setup's pending doc is the one stored
    const secondSecret = 'SECONDSECRETSECONDSECRETSECONDSE';
    mockDocGet.mockResolvedValueOnce(
      makePendingDoc({ encryptedSecret: `encrypted:${secondSecret}` }),
    );
    mockDocGet.mockResolvedValueOnce({ exists: false }); // replay check
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: '123456' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);

    // The decrypted secret should be the second one
    expect(mockDecryptSecret).toHaveBeenCalledWith(`encrypted:${secondSecret}`);
  });

  // ─── 6. Claims persistence through lifecycle ─────────────────

  it('should preserve admin claim through setup → confirm → verify → delete', async () => {
    const existingClaims = { admin: true, role: 'superadmin', featureFlag: 'beta' };

    // Step 1: Setup (claims not modified during setup)
    setMockAuth({ token: { admin: true, firebase: { sign_in_provider: 'password' } } });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const setupRes = await request(app).post('/api/portal/totp/setup');
    expect(setupRes.status).toBe(200);
    // Setup should not call setCustomUserClaims
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();

    // Step 2: Confirm — claims should be preserved
    jest.clearAllMocks();
    setMockAuth({ token: { admin: true, firebase: { sign_in_provider: 'password' } } });
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false }); // replay check
    auth.getUser.mockResolvedValueOnce({ customClaims: { ...existingClaims } });

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: '111111' });

    expect(confirmRes.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        admin: true,
        role: 'superadmin',
        featureFlag: 'beta',
        totpVerified: true,
        totpVerifiedAt: expect.any(Number),
      }),
    );

    // Step 3: Verify — claims still preserved
    jest.clearAllMocks();
    setMockAuth({ token: { admin: true, firebase: { sign_in_provider: 'password' } } });
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({
      customClaims: { ...existingClaims, totpVerified: true, totpVerifiedAt: 1234 },
    });

    const verifyRes = await request(app).post('/api/portal/totp/verify').send({ code: '222222' });

    expect(verifyRes.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        admin: true,
        role: 'superadmin',
        featureFlag: 'beta',
        totpVerified: true,
        totpVerifiedAt: expect.any(Number),
      }),
    );

    // Step 4: Delete — admin and other claims preserved, only totpVerified cleared
    jest.clearAllMocks();
    setMockAuth({ token: { admin: true, firebase: { sign_in_provider: 'password' } } });
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({
      customClaims: { ...existingClaims, totpVerified: true, totpVerifiedAt: 1234 },
    });

    const deleteRes = await request(app).delete('/api/portal/totp').send({ totpCode: '333333' });

    expect(deleteRes.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        admin: true,
        role: 'superadmin',
        featureFlag: 'beta',
        totpVerified: false,
        totpVerifiedAt: null,
      }),
    );
  });

  it('should preserve custom claims with no admin role through full lifecycle', async () => {
    const existingClaims = { role: 'moderator', locale: 'fr' };

    // Confirm
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makePendingDoc());
    mockDocGet.mockResolvedValueOnce({ exists: false });
    auth.getUser.mockResolvedValueOnce({ customClaims: { ...existingClaims } });

    const confirmRes = await request(app)
      .post('/api/portal/totp/confirm-setup')
      .send({ code: '123456' });

    expect(confirmRes.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        role: 'moderator',
        locale: 'fr',
        totpVerified: true,
      }),
    );

    // Verify
    jest.clearAllMocks();
    setMockAuth();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({
      customClaims: { ...existingClaims, totpVerified: true, totpVerifiedAt: 9999 },
    });

    const verifyRes = await request(app).post('/api/portal/totp/verify').send({ code: '654321' });

    expect(verifyRes.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        role: 'moderator',
        locale: 'fr',
        totpVerified: true,
      }),
    );

    // Delete
    jest.clearAllMocks();
    setMockAuth();
    mockVerifySync.mockReturnValue({ valid: true, delta: 0 });
    mockDocGet.mockResolvedValueOnce(makeTotpDoc());
    auth.getUser.mockResolvedValueOnce({
      customClaims: { ...existingClaims, totpVerified: true, totpVerifiedAt: 9999 },
    });

    const deleteRes = await request(app).delete('/api/portal/totp').send({ totpCode: '111111' });

    expect(deleteRes.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        role: 'moderator',
        locale: 'fr',
        totpVerified: false,
        totpVerifiedAt: null,
      }),
    );
  });
});
