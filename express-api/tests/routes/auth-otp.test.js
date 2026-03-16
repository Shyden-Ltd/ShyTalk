const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
  },
  auth: {
    createCustomToken: jest.fn().mockResolvedValue('custom-token-abc'),
    getUserByEmail: jest.fn(),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
  },
}));

jest.mock('../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildOtpEmail: jest.fn(() => ({ subject: 'OTP', html: '<p>code</p>' })),
  buildLockoutEmail: jest.fn(() => ({ subject: 'Lockout', html: '<p>lock</p>' })),
  buildResetEmail: jest.fn(() => ({ subject: 'Reset', html: '<p>reset</p>' })),
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$hashedcode'),
  compare: jest.fn(),
}));

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
const { sendEmail } = require('../../src/utils/email');
const { auth } = require('../../src/utils/firebase');
const { buildOtpEmail } = require('../../src/utils/email-templates');

// Build mini express app with just auth routes
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', require('../../src/routes/auth'));
  return app;
}

describe('OTP Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  // ─── POST /api/auth/otp/send ──────────────────────────────────

  describe('POST /api/auth/otp/send', () => {
    it('should send OTP and return 200', async () => {
      // No existing OTP doc
      mockDocGet
        .mockResolvedValueOnce({ exists: false }) // otpCodes/{email}
        .mockResolvedValueOnce({ exists: false }); // emailMetrics/daily

      const res = await request(app).post('/api/auth/otp/send').send({ email: 'user@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'OTP sent' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(buildOtpEmail).toHaveBeenCalledWith(expect.stringMatching(/^\d{6}$/));
    });

    it('should store hashed OTP in Firestore', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce({ exists: false });

      await request(app).post('/api/auth/otp/send').send({ email: 'user@example.com' });

      expect(mockDocSet).toHaveBeenCalledWith(
        'otpCodes/user@example.com',
        expect.objectContaining({
          hashedCode: '$2b$10$hashedcode',
          attempts: 0,
        }),
      );
    });

    it('should reject missing email', async () => {
      const res = await request(app).post('/api/auth/otp/send').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('should reject invalid email format', async () => {
      const res = await request(app).post('/api/auth/otp/send').send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('should rate limit at 5 requests per email per hour', async () => {
      // Existing OTP doc with 5 requests in the last hour
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          requestCount: 5,
          firstRequestAt: Date.now() - 30 * 60 * 1000, // 30 min ago (within window)
        }),
      });

      const res = await request(app)
        .post('/api/auth/otp/send')
        .send({ email: 'spammer@example.com' });

      expect(res.status).toBe(429);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('should reset rate limit after 60 minutes', async () => {
      // Existing OTP doc with 5 requests but first request was 61 min ago
      mockDocGet
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            requestCount: 5,
            firstRequestAt: Date.now() - 61 * 60 * 1000, // 61 min ago — window expired
          }),
        })
        .mockResolvedValueOnce({ exists: false }); // emailMetrics/daily

      const res = await request(app).post('/api/auth/otp/send').send({ email: 'user@example.com' });

      expect(res.status).toBe(200);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('should enforce daily email cap of 100', async () => {
      mockDocGet
        .mockResolvedValueOnce({ exists: false }) // otpCodes
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            count: 100,
            date: new Date().toISOString().slice(0, 10), // today
          }),
        }); // emailMetrics/daily

      const res = await request(app).post('/api/auth/otp/send').send({ email: 'user@example.com' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('daily_limit');
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('should reset daily cap on new day', async () => {
      mockDocGet
        .mockResolvedValueOnce({ exists: false }) // otpCodes
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            count: 100,
            date: '2025-01-01', // old date
          }),
        }); // emailMetrics/daily

      const res = await request(app).post('/api/auth/otp/send').send({ email: 'user@example.com' });

      expect(res.status).toBe(200);
    });

    it('should accept valid email addresses', async () => {
      // Disposable email blocking is handled client-side (AuthViewModel)
      // Server accepts all valid email formats
      mockDocGet.mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce({ exists: false });

      const res = await request(app)
        .post('/api/auth/otp/send')
        .send({ email: 'user@tempmail.com' });

      expect(res.status).toBe(200);
    });
  });

  // ─── POST /api/auth/otp/verify ────────────────────────────────

  describe('POST /api/auth/otp/verify', () => {
    it('should return custom token on correct code', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      auth.getUserByEmail.mockResolvedValueOnce({ uid: 'firebase-uid-1' });

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 min from now
          attempts: 0,
        }),
      });

      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com', code: '482715' });

      expect(res.status).toBe(200);
      expect(res.body.customToken).toBe('custom-token-abc');
      expect(auth.createCustomToken).toHaveBeenCalledWith('firebase-uid-1');
    });

    it('should delete OTP doc after successful verification', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      auth.getUserByEmail.mockResolvedValueOnce({ uid: 'uid-1' });

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() + 5 * 60 * 1000,
          attempts: 0,
        }),
      });

      await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com', code: '482715' });

      expect(mockDocDelete).toHaveBeenCalledWith('otpCodes/user@example.com');
    });

    it('should return 401 on wrong code', async () => {
      bcrypt.compare.mockResolvedValueOnce(false);

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() + 5 * 60 * 1000,
          attempts: 0,
        }),
      });

      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com', code: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid|wrong/i);
    });

    it('should increment attempts on wrong code', async () => {
      bcrypt.compare.mockResolvedValueOnce(false);

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() + 5 * 60 * 1000,
          attempts: 1,
        }),
      });

      await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com', code: '000000' });

      expect(mockDocUpdate).toHaveBeenCalledWith(
        'otpCodes/user@example.com',
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('should return 410 on expired code', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() - 1000, // expired
          attempts: 0,
        }),
      });

      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com', code: '482715' });

      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/expired/i);
    });

    it('should return 429 after 3 failed attempts', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() + 5 * 60 * 1000,
          attempts: 3,
        }),
      });

      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com', code: '000000' });

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/too many attempts/i);
    });

    it('should return 404 if no OTP exists for email', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'nobody@example.com', code: '123456' });

      expect(res.status).toBe(404);
    });

    it('should reject missing email', async () => {
      const res = await request(app).post('/api/auth/otp/verify').send({ code: '123456' });

      expect(res.status).toBe(400);
    });

    it('should reject missing code', async () => {
      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'user@example.com' });

      expect(res.status).toBe(400);
    });

    it('should create Firebase user if email not yet registered', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      auth.getUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
      auth.createUser = jest.fn().mockResolvedValueOnce({ uid: 'new-uid' });

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          hashedCode: '$2b$10$hashedcode',
          expiresAt: Date.now() + 5 * 60 * 1000,
          attempts: 0,
        }),
      });

      const res = await request(app)
        .post('/api/auth/otp/verify')
        .send({ email: 'newuser@example.com', code: '482715' });

      expect(res.status).toBe(200);
      expect(auth.createUser).toHaveBeenCalledWith({ email: 'newuser@example.com' });
      expect(auth.createCustomToken).toHaveBeenCalledWith('new-uid');
    });
  });
});
