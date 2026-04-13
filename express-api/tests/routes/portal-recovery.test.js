const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionWhere = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => ({
      where: (...args) => {
        mockCollectionWhere(...args);
        return {
          limit: jest.fn(() => ({
            get: jest
              .fn()
              .mockResolvedValue(mockCollectionWhereResult || { empty: true, docs: [] }),
          })),
        };
      },
    })),
  },
  auth: {
    getUserByEmail: jest.fn(),
    revokeRefreshTokens: jest.fn().mockResolvedValue(),
  },
}));

// Variable to control collection query results
let mockCollectionWhereResult = null;

jest.mock('../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildOtpEmail: jest.fn(() => ({ subject: 'Recovery code', html: '<p>code</p>' })),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req, res, next) => next(),
  authMiddlewareStrict: (req, res, next) => next(),
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  generalLimiter: (req, res, next) => next(),
  writeLimiter: (req, res, next) => next(),
  sensitiveLimiter: (req, res, next) => next(),
  portalLimiter: (req, res, next) => next(),
  recoveryLimiter: (req, res, next) => next(),
}));

// Mock otplib — these endpoints don't use otplib directly, but portal.js imports it
jest.mock('otplib/functional', () => ({
  generateSecret: jest.fn(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
  generateURI: jest.fn(() => 'otpauth://totp/ShyTalk:test?secret=ABC'),
  verifySync: jest.fn(() => ({ valid: true, delta: 0 })),
}));

jest.mock('@otplib/plugin-crypto-noble', () => ({
  NobleCryptoPlugin: class MockNobleCryptoPlugin {},
}));

jest.mock('@otplib/plugin-base32-scure', () => ({
  ScureBase32Plugin: class MockScureBase32Plugin {},
}));

jest.mock('../../src/utils/totp-crypto', () => ({
  encryptSecret: jest.fn((s) => `encrypted:${s}`),
  decryptSecret: jest.fn((s) => s.replace('encrypted:', '')),
}));

const { auth } = require('../../src/utils/firebase');
const { sendEmail } = require('../../src/utils/email');

// ─── Helper: build a mini express app ───────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', require('../../src/routes/portal'));
  return app;
}

// ─── Tests: POST /api/portal/totp-recovery/send ────────────────

describe('POST /api/portal/totp-recovery/send', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollectionWhereResult = null;
    app = buildApp();
  });

  // ─── 1. Valid email with TOTP enrolled → 200, email sent ──────

  it('should return 200 and send recovery email when user has TOTP enrolled', async () => {
    // getUserByEmail returns a user with password provider
    auth.getUserByEmail.mockResolvedValueOnce({
      uid: 'firebase-uid-1',
      providerData: [{ providerId: 'password' }],
    });
    // Resolve uniqueId from Firebase UID
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345 }), id: '12345' }],
    };
    // TOTP doc exists
    mockDocGet.mockResolvedValueOnce({ exists: true });

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Recovery code sent');
    // Should have stored recovery code in Firestore
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.stringContaining('totpRecoveryCodes/'),
      expect.objectContaining({
        code: expect.any(String),
        expiresAt: expect.any(Number),
        attempts: 0,
      }),
    );
    // Should have sent email
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(String),
      expect.any(String),
    );
  });

  // ─── 2. Email not found → 200 same response (anti-enumeration) ─

  it('should return 200 even when email is not found (anti-enumeration)', async () => {
    auth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: 'nonexistent@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Recovery code sent');
    // Should NOT have sent any email
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // ─── 3. Email exists but no TOTP → 200 same response ──────────

  it('should return 200 without sending email when user has no TOTP', async () => {
    auth.getUserByEmail.mockResolvedValueOnce({
      uid: 'firebase-uid-2',
      providerData: [{ providerId: 'password' }],
    });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 67890 }), id: '67890' }],
    };
    // TOTP doc does NOT exist
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Recovery code sent');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // ─── 4. Missing email field → 400 ─────────────────────────────

  it('should return 400 when email is missing', async () => {
    const res = await request(app).post('/api/portal/totp-recovery/send').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should return 400 when email is empty string', async () => {
    const res = await request(app).post('/api/portal/totp-recovery/send').send({ email: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 5. Email too long (300 chars) → 400 ──────────────────────

  it('should return 400 when email exceeds 254 characters', async () => {
    const longEmail = 'a'.repeat(250) + '@b.com';

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: longEmail });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 6. Mixed-case email normalized → lookup uses lowercase ────

  it('should normalize mixed-case email to lowercase', async () => {
    auth.getUserByEmail.mockResolvedValueOnce({
      uid: 'firebase-uid-3',
      providerData: [{ providerId: 'password' }],
    });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 11111 }), id: '11111' }],
    };
    // TOTP doc exists
    mockDocGet.mockResolvedValueOnce({ exists: true });

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: '  User@Example.COM  ' });

    expect(res.status).toBe(200);
    // getUserByEmail should be called with lowercase email
    expect(auth.getUserByEmail).toHaveBeenCalledWith('user@example.com');
  });

  // ─── 7. OAuth user (no password provider) → 200, no email ─────

  it('should return 200 without sending email when user only has OAuth provider', async () => {
    auth.getUserByEmail.mockResolvedValueOnce({
      uid: 'firebase-uid-4',
      providerData: [{ providerId: 'google.com' }],
    });

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: 'oauth@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Recovery code sent');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // ─── 8. Recovery code stored with correct expiry ───────────────

  it('should store recovery code with 10-minute expiry', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    auth.getUserByEmail.mockResolvedValueOnce({
      uid: 'firebase-uid-1',
      providerData: [{ providerId: 'password' }],
    });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345 }), id: '12345' }],
    };
    mockDocGet.mockResolvedValueOnce({ exists: true });

    const res = await request(app)
      .post('/api/portal/totp-recovery/send')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      'totpRecoveryCodes/user@example.com',
      expect.objectContaining({
        expiresAt: now + 600000,
        attempts: 0,
      }),
    );

    Date.now.mockRestore();
  });
});

// ─── Tests: POST /api/portal/totp-recovery/verify ──────────────

describe('POST /api/portal/totp-recovery/verify', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollectionWhereResult = null;
    app = buildApp();
  });

  // ─── 1. Valid code → 200, TOTP deleted, sessions revoked ───────

  it('should return 200, delete TOTP, and revoke sessions for valid code', async () => {
    // Recovery code exists and is valid
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '123456',
            expiresAt: Date.now() + 300000,
            attempts: 0,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    // getUserByEmail for post-verify cleanup
    auth.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-uid-1' });

    // Resolve uniqueId from Firebase UID
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345 }), id: '12345' }],
    };

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/authenticator removed/i);

    // Recovery code should be deleted (consumed)
    expect(mockDocDelete).toHaveBeenCalledWith('totpRecoveryCodes/user@example.com');
    // TOTP doc should be deleted
    expect(mockDocDelete).toHaveBeenCalledWith('users/12345/private/totp');
    // TOTP pending doc should be deleted
    expect(mockDocDelete).toHaveBeenCalledWith('users/12345/private/totp-pending');
    // Sessions revoked
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-1');
  });

  // ─── 2. Invalid code → 401 ────────────────────────────────────

  it('should return 401 for invalid code', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '123456',
            expiresAt: Date.now() + 300000,
            attempts: 0,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '999999' });

    expect(res.status).toBe(401);
    // Attempts should be incremented
    expect(mockDocSet).toHaveBeenCalledWith(
      'totpRecoveryCodes/user@example.com',
      expect.objectContaining({ attempts: 1 }),
    );
  });

  // ─── 3. Expired code → 401 ────────────────────────────────────

  it('should return 401 for expired code', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '123456',
            expiresAt: Date.now() - 1000, // expired
            attempts: 0,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  // ─── 4. Code reuse (call verify twice) → first 200, second 401 ─

  it('should consume code on first use and reject on second use', async () => {
    let codeExists = true;

    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        if (codeExists) {
          return Promise.resolve({
            exists: true,
            data: () => ({
              code: '123456',
              expiresAt: Date.now() + 300000,
              attempts: 0,
            }),
          });
        }
        return Promise.resolve({ exists: false });
      }
      return Promise.resolve({ exists: false });
    });

    auth.getUserByEmail.mockResolvedValue({ uid: 'firebase-uid-1' });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345 }), id: '12345' }],
    };

    // Simulate code deletion on first verify
    mockDocDelete.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        codeExists = false;
      }
      return Promise.resolve();
    });

    // First verify → 200
    const res1 = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '123456' });
    expect(res1.status).toBe(200);

    // Second verify → 401 (code consumed)
    const res2 = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '123456' });
    expect(res2.status).toBe(401);
  });

  // ─── 5. Missing email → 400 ───────────────────────────────────

  it('should return 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 6. Missing code → 400 ────────────────────────────────────

  it('should return 400 when code is missing', async () => {
    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  // ─── 7. No recovery code doc exists → 401 ─────────────────────

  it('should return 401 when no recovery code doc exists', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '123456' });

    expect(res.status).toBe(401);
  });

  // ─── 8. After recovery, revokeRefreshTokens called ─────────────

  it('should call revokeRefreshTokens with the correct UID after successful recovery', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '654321',
            expiresAt: Date.now() + 300000,
            attempts: 0,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    auth.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-uid-99' });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 99999 }), id: '99999' }],
    };

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '654321' });

    expect(res.status).toBe(200);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-99');
  });

  // ─── 9. After recovery, private/totp doc deleted ───────────────

  it('should delete the TOTP doc for the correct uniqueId after successful recovery', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '111222',
            expiresAt: Date.now() + 300000,
            attempts: 0,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    auth.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-uid-42' });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 42424 }), id: '42424' }],
    };

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '111222' });

    expect(res.status).toBe(200);
    expect(mockDocDelete).toHaveBeenCalledWith('users/42424/private/totp');
    expect(mockDocDelete).toHaveBeenCalledWith('users/42424/private/totp-pending');
  });

  // ─── 10. Too many attempts (>= 3) → 429 ────────────────────────

  it('should return 429 when attempts >= 3', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '123456',
            expiresAt: Date.now() + 300000,
            attempts: 3,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: 'user@example.com', code: '123456' });

    expect(res.status).toBe(429);
  });

  // ─── 11. Email normalized to lowercase for verify ──────────────

  it('should normalize email to lowercase for verify', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'totpRecoveryCodes/user@example.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            code: '123456',
            expiresAt: Date.now() + 300000,
            attempts: 0,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    auth.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-uid-1' });
    mockCollectionWhereResult = {
      empty: false,
      docs: [{ data: () => ({ uniqueId: 12345 }), id: '12345' }],
    };

    const res = await request(app)
      .post('/api/portal/totp-recovery/verify')
      .send({ email: '  User@Example.COM  ', code: '123456' });

    expect(res.status).toBe(200);
    // Should have looked up the recovery code with lowercase email
    expect(mockDocGet).toHaveBeenCalledWith('totpRecoveryCodes/user@example.com');
  });
});
