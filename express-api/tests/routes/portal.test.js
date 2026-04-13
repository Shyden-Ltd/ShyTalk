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

// Mock TOTP dependencies (portal.js imports these for TOTP setup endpoints)
const mockDecryptSecret = jest.fn((s) => s.replace('encrypted:', ''));

jest.mock('../../src/utils/totp-crypto', () => ({
  encryptSecret: jest.fn((s) => `encrypted:${s}`),
  decryptSecret: (...args) => mockDecryptSecret(...args),
}));

const mockVerifySync = jest.fn(() => ({ valid: true }));

jest.mock('otplib/functional', () => ({
  generateSecret: jest.fn(() => 'MOCKSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/mock'),
  verifySync: (...args) => mockVerifySync(...args),
}));

jest.mock('@otplib/plugin-crypto-noble', () => ({
  NobleCryptoPlugin: class MockNobleCryptoPlugin {},
}));

jest.mock('@otplib/plugin-base32-scure', () => ({
  ScureBase32Plugin: class MockScureBase32Plugin {},
}));

const { auth } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');

// ─── Helper: build a mini express app ───────────────────────────
// We mock authMiddlewareStrict inline so we can control req.auth per test
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

// Trusted CDN host — also valid on localhost for local dev
const TRUSTED_CDN = ['https://images', 'shytalk', 'shyden', 'co', 'uk'].join('.');
const TRUSTED_AVATAR = `${TRUSTED_CDN}/avatars/12345.jpg`;

function makeUserDoc(overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uniqueId: 12345,
      displayName: 'TestUser',
      avatarUrl: TRUSTED_AVATAR,
      userType: 'MEMBER',
      isSuspended: false,
      suspensionReason: null,
      suspensionEndDate: null,
      ...overrides,
    }),
  };
}

function makeTotpDoc(exists = false) {
  return { exists };
}

function setMockAuth(overrides = {}) {
  mockAuth = {
    uid: 'firebase-uid-1',
    uniqueId: 12345,
    token: {
      uid: 'firebase-uid-1',
      admin: false,
      firebase: { sign_in_provider: 'password' },
      totpVerified: false,
      totpVerifiedAt: null,
      ...overrides.token,
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('GET /api/portal/me', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    app = buildApp();
  });

  // ─── 1. Valid MEMBER user → 200, correct fields and types ─────

  it('should return 200 with correct fields for a valid MEMBER user', async () => {
    setMockAuth();
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc()) // users/12345
      .mockResolvedValueOnce(makeTotpDoc(false)); // users/12345/private/totp

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      uniqueId: 12345,
      displayName: 'TestUser',
      avatarUrl: TRUSTED_AVATAR,
      userType: 'MEMBER',
      isAdmin: false,
      isSuspended: false,
      suspensionReason: null,
      suspensionEndDate: null,
      totpEnrolled: false,
    });
  });

  // ─── 2. Valid admin user → 200, isAdmin: true ─────────────────

  it('should return 200 with isAdmin: true for admin user', async () => {
    setMockAuth({ token: { admin: true } });
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc()) // users/12345
      .mockResolvedValueOnce(makeTotpDoc(false)); // totp

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  // ─── 3. Each UserType → 200, correct userType ────────────────

  const userTypes = ['MEMBER', 'MC_SINGER', 'MC_EVENT_HOST', 'TEACHER', 'SHYTALK_OFFICIAL'];
  userTypes.forEach((userType) => {
    it(`should return userType: "${userType}" for ${userType} user`, async () => {
      setMockAuth();
      mockDocGet
        .mockResolvedValueOnce(makeUserDoc({ userType }))
        .mockResolvedValueOnce(makeTotpDoc(false));

      const res = await request(app).get('/api/portal/me');

      expect(res.status).toBe(200);
      expect(res.body.userType).toBe(userType);
    });
  });

  // ─── 4. Suspended user → 200, isSuspended: true ──────────────

  it('should return 200 with suspension data for suspended user', async () => {
    setMockAuth();
    const endDate = new Date('2026-05-01T00:00:00.000Z');
    mockDocGet.mockResolvedValueOnce(
      makeUserDoc({
        isSuspended: true,
        suspensionReason: 'Harassment',
        suspensionEndDate: { toDate: () => endDate, _seconds: endDate.getTime() / 1000 },
      }),
    );
    // No TOTP doc read expected for suspended users

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.isSuspended).toBe(true);
    expect(res.body.suspensionReason).toBe('Harassment');
    expect(res.body.suspensionEndDate).toBe('2026-05-01T00:00:00.000Z');
  });

  // ─── 5. No Firestore user doc → 404 ──────────────────────────

  it('should return 404 when user doc does not exist', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  // ─── 6. No auth token → 401 ──────────────────────────────────

  it('should return 401 when no auth token is provided', async () => {
    // mockAuth is null — middleware returns 401
    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(401);
  });

  // ─── 7. Password provider, TOTP enrolled, no totpVerified → 403 ──

  it('should return 403 "MFA required" for password user with TOTP enrolled but no totpVerified', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: false,
      },
    });
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc()) // user doc
      .mockResolvedValueOnce(makeTotpDoc(true)); // totp doc exists

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/MFA required/i);
  });

  // ─── 8. Password provider, TOTP enrolled, fresh totpVerified → 200 ─

  it('should return 200 for password user with fresh TOTP verification', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
        totpVerifiedAt: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago (fresh)
      },
    });
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(true));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.totpEnrolled).toBe(true);
  });

  // ─── 9. Password provider, TOTP NOT enrolled → 200 ───────────

  it('should return 200 with totpEnrolled: false when TOTP not enrolled', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
      },
    });
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(false));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.totpEnrolled).toBe(false);
  });

  // ─── 10. OAuth provider → 200 (no TOTP enforcement) ──────────

  it('should return 200 for OAuth provider regardless of TOTP state', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'google.com' },
        totpVerified: false,
      },
    });
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(true)); // enrolled but not enforced

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.totpEnrolled).toBe(true);
  });

  // ─── 11. avatarUrl on untrusted domain → null ─────────────────

  it('should return avatarUrl: null for untrusted domain avatar', async () => {
    setMockAuth();
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc({ avatarUrl: 'https://evil.com/avatar.jpg' }))
      .mockResolvedValueOnce(makeTotpDoc(false));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
  });

  // ─── 12. avatarUrl on trusted domain → full URL ───────────────

  it('should return full avatarUrl for trusted domain', async () => {
    setMockAuth();
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc({ avatarUrl: TRUSTED_AVATAR }))
      .mockResolvedValueOnce(makeTotpDoc(false));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(TRUSTED_AVATAR);
  });

  // ─── 13. suspensionReason not in allowlist → null ─────────────

  it('should return suspensionReason: null for reason not in allowlist', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeUserDoc({
        isSuspended: true,
        suspensionReason: 'Custom admin note: being rude',
      }),
    );

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.isSuspended).toBe(true);
    expect(res.body.suspensionReason).toBeNull();
  });

  // ─── 14. suspensionEndDate as Firestore Timestamp → ISO string ─

  it('should convert Firestore Timestamp suspensionEndDate to ISO string', async () => {
    setMockAuth();
    const endDate = new Date('2026-12-31T23:59:59.000Z');
    mockDocGet.mockResolvedValueOnce(
      makeUserDoc({
        isSuspended: true,
        suspensionReason: 'Spamming',
        suspensionEndDate: { toDate: () => endDate, _seconds: endDate.getTime() / 1000 },
      }),
    );

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.suspensionEndDate).toBe('2026-12-31T23:59:59.000Z');
  });

  // ─── 15. Response types: uniqueId number, isAdmin boolean, totpEnrolled boolean ─

  it('should return correct types for key fields', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(false));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(typeof res.body.uniqueId).toBe('number');
    expect(typeof res.body.isAdmin).toBe('boolean');
    expect(typeof res.body.totpEnrolled).toBe('boolean');
    expect(typeof res.body.isSuspended).toBe('boolean');
    expect(typeof res.body.displayName).toBe('string');
    expect(typeof res.body.userType).toBe('string');
  });

  // ─── 16. Password provider, totpVerified:true but totpVerifiedAt > 24h → 403 ─

  it('should return 403 when totpVerified is true but totpVerifiedAt > 24h', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
        totpVerifiedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      },
    });
    auth.getUser.mockResolvedValueOnce({
      customClaims: { totpVerified: true, totpVerifiedAt: Date.now() - 25 * 60 * 60 * 1000 },
    });
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(true));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/re-verify/i);
    // Should have attempted to clear claims
    expect(auth.setCustomUserClaims).toHaveBeenCalled();
  });

  // ─── 17. Password provider, totpVerified:true but no totpVerifiedAt → 403 ─

  it('should return 403 when totpVerified is true but totpVerifiedAt is missing', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
        // totpVerifiedAt is not set (undefined)
      },
    });
    auth.getUser.mockResolvedValueOnce({
      customClaims: { totpVerified: true },
    });
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(true));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/re-verify/i);
    expect(auth.setCustomUserClaims).toHaveBeenCalled();
  });

  // ─── 18. Expired claim, setCustomUserClaims fails → still 403 ─

  it('should still return 403 when setCustomUserClaims fails for expired TOTP', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
        totpVerifiedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      },
    });
    auth.getUser.mockResolvedValueOnce({
      customClaims: { totpVerified: true, totpVerifiedAt: Date.now() - 25 * 60 * 60 * 1000 },
    });
    auth.setCustomUserClaims.mockRejectedValueOnce(new Error('Firebase unavailable'));
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(true));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/re-verify/i);
    // Should have logged the error
    expect(log.error).toHaveBeenCalled();
  });

  // ─── Additional edge cases ────────────────────────────────────

  it('should return avatarUrl: null when avatarUrl is undefined in user doc', async () => {
    setMockAuth();
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc({ avatarUrl: undefined }))
      .mockResolvedValueOnce(makeTotpDoc(false));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
  });

  it('should allow all valid suspension reasons through', async () => {
    const validReasons = [
      'Spamming',
      'Harassment',
      'Inappropriate content',
      'Ban evasion',
      'Terms violation',
      'Other',
    ];

    for (const reason of validReasons) {
      jest.clearAllMocks();
      setMockAuth();
      mockDocGet.mockResolvedValueOnce(
        makeUserDoc({ isSuspended: true, suspensionReason: reason }),
      );

      const res = await request(app).get('/api/portal/me');

      expect(res.status).toBe(200);
      expect(res.body.suspensionReason).toBe(reason);
    }
  });

  it('should return suspensionEndDate: null when not set', async () => {
    setMockAuth();
    mockDocGet.mockResolvedValueOnce(
      makeUserDoc({ isSuspended: true, suspensionReason: 'Spamming' }),
    );

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.suspensionEndDate).toBeNull();
  });

  it('should handle suspensionEndDate as a plain Date object', async () => {
    setMockAuth();
    const endDate = new Date('2026-06-15T12:00:00.000Z');
    // Some Firestore docs might have a Date instead of Timestamp
    mockDocGet.mockResolvedValueOnce(
      makeUserDoc({
        isSuspended: true,
        suspensionReason: 'Spamming',
        suspensionEndDate: endDate,
      }),
    );

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.suspensionEndDate).toBe('2026-06-15T12:00:00.000Z');
  });

  it('should skip TOTP check for suspended user (suspension takes precedence)', async () => {
    // Suspended + password + TOTP enrolled + not verified — should still return 200 with suspension
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: false,
      },
    });
    mockDocGet.mockResolvedValueOnce(
      makeUserDoc({
        isSuspended: true,
        suspensionReason: 'Harassment',
      }),
    );
    // TOTP doc should NOT be read for suspended users

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.isSuspended).toBe(true);
    // mockDocGet should only have been called once (user doc, not totp doc)
    expect(mockDocGet).toHaveBeenCalledTimes(1);
  });

  it('should allow localhost avatar URLs (local development)', async () => {
    setMockAuth();
    const localUrl = 'http://localhost:9002/shytalk-media/avatars/12345.jpg';
    mockDocGet
      .mockResolvedValueOnce(makeUserDoc({ avatarUrl: localUrl }))
      .mockResolvedValueOnce(makeTotpDoc(false));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(localUrl);
  });

  it('should handle Apple sign-in provider same as other OAuth providers', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'apple.com' },
        totpVerified: false,
      },
    });
    mockDocGet.mockResolvedValueOnce(makeUserDoc()).mockResolvedValueOnce(makeTotpDoc(true));

    const res = await request(app).get('/api/portal/me');

    expect(res.status).toBe(200);
    expect(res.body.totpEnrolled).toBe(true);
  });
});

// ─── POST /api/portal/sign-out ─────────────────────────────────

describe('POST /api/portal/sign-out', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    mockVerifySync.mockReturnValue({ valid: true });
    app = buildApp();
  });

  // ─── 1. Valid sign-out → 200, totpVerified cleared, revokeRefreshTokens called

  it('should return 200, clear totpVerified claim, and revoke refresh tokens on valid sign-out', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
        totpVerifiedAt: Date.now() - 1000,
      },
    });
    auth.getUser.mockResolvedValueOnce({
      customClaims: { totpVerified: true, totpVerifiedAt: 12345 },
    });

    const res = await request(app).post('/api/portal/sign-out').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-1',
      expect.objectContaining({
        totpVerified: false,
        totpVerifiedAt: null,
      }),
    );
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');
  });

  // ─── 2. No auth token → 401

  it('should return 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/portal/sign-out').send({});

    expect(res.status).toBe(401);
  });

  // ─── 3. Double sign-out (second call with revoked token) → 401
  //        Simulated by mockAuth being null (auth middleware rejects revoked tokens)

  it('should return 401 on double sign-out (simulated revoked token)', async () => {
    // First sign-out
    setMockAuth();
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const firstRes = await request(app).post('/api/portal/sign-out').send({});
    expect(firstRes.status).toBe(200);

    // Second sign-out — middleware rejects because token is revoked (no mockAuth)
    mockAuth = null;
    const secondRes = await request(app).post('/api/portal/sign-out').send({});
    expect(secondRes.status).toBe(401);
  });

  // ─── 4. Admin user signs out → 200, admin:true claim preserved

  it('should preserve admin:true claim when admin user signs out', async () => {
    setMockAuth({
      token: {
        admin: true,
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
      },
    });
    auth.getUser.mockResolvedValueOnce({ customClaims: { admin: true, totpVerified: true } });

    const res = await request(app).post('/api/portal/sign-out').send({});

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

  // ─── 5. OAuth user (no totpVerified claim) signs out → 200, no error from missing claim

  it('should return 200 for OAuth user with no totpVerified claim without error', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'google.com' },
        // no totpVerified claim
      },
    });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/sign-out').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');
  });
});

// ─── POST /api/portal/revoke-all-sessions ──────────────────────

describe('POST /api/portal/revoke-all-sessions', () => {
  let app;

  function makeTotpDocFull(overrides = {}) {
    return {
      exists: true,
      data: () => ({
        encryptedSecret: 'encrypted:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', // eslint-disable-line sonarjs/no-hardcoded-secrets -- test mock data
        lastUsedCode: null,
        lastUsedAt: null,
        createdAt: Date.now() - 10000,
        ...overrides,
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = null;
    mockVerifySync.mockReturnValue({ valid: true });
    app = buildApp();
  });

  // ─── 1. Valid with TOTP code (password user) → 200, all sessions revoked

  it('should return 200 and revoke all sessions for password user with valid TOTP code', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
        totpVerified: true,
        totpVerifiedAt: Date.now() - 1000,
      },
    });
    mockDocGet.mockResolvedValueOnce(makeTotpDocFull());
    auth.getUser.mockResolvedValueOnce({ customClaims: { totpVerified: true } });

    const res = await request(app)
      .post('/api/portal/revoke-all-sessions')
      .send({ totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');
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
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
      },
    });
    mockDocGet.mockResolvedValueOnce(makeTotpDocFull());
    mockVerifySync.mockReturnValueOnce({ valid: false });

    const res = await request(app)
      .post('/api/portal/revoke-all-sessions')
      .send({ totpCode: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid code/i);
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  // ─── 3. OAuth user (no TOTP needed) → 200

  it('should return 200 for OAuth user without requiring TOTP code', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'google.com' },
      },
    });
    auth.getUser.mockResolvedValueOnce({ customClaims: {} });

    const res = await request(app).post('/api/portal/revoke-all-sessions').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');
  });

  // ─── 4. No auth token → 401

  it('should return 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/portal/revoke-all-sessions').send({});

    expect(res.status).toBe(401);
  });

  // ─── 5. Password user, malformed totpCode → 400

  it('should return 400 for malformed totpCode (password user)', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
      },
    });

    const res = await request(app)
      .post('/api/portal/revoke-all-sessions')
      .send({ totpCode: 'abc123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  // ─── 6. Password user, not enrolled in TOTP → 403

  it('should return 403 for password user not enrolled in TOTP', async () => {
    setMockAuth({
      token: {
        firebase: { sign_in_provider: 'password' },
      },
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app)
      .post('/api/portal/revoke-all-sessions')
      .send({ totpCode: '123456' });

    expect(res.status).toBe(403);
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
