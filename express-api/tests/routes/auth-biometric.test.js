const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

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
  },
  auth: {
    createCustomToken: jest.fn().mockResolvedValue('bio-custom-token'),
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
  hash: jest.fn().mockResolvedValue('hash'),
  compare: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
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

const { auth } = require('../../src/utils/firebase');

function buildApp(authUser) {
  const app = express();
  app.use(express.json());
  if (authUser) {
    app.use((req, res, next) => {
      req.auth = authUser;
      next();
    });
  }
  app.use('/api', require('../../src/routes/auth'));
  return app;
}

describe('Biometric Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── POST /api/auth/biometric/register ────────────────────────

  describe('POST /api/auth/biometric/register', () => {
    it('should register biometric key and return 200', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app)
        .post('/api/auth/biometric/register')
        .send({ publicKey: 'base64pubkey', deviceId: 'dev-1' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Biometric registered');
      expect(mockDocSet).toHaveBeenCalledWith(
        'biometricKeys/12345678:dev-1',
        expect.objectContaining({ publicKey: 'base64pubkey' }),
      );
    });

    it('should reject missing publicKey', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app)
        .post('/api/auth/biometric/register')
        .send({ deviceId: 'dev-1' });

      expect(res.status).toBe(400);
    });

    it('should reject missing deviceId', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app)
        .post('/api/auth/biometric/register')
        .send({ publicKey: 'key' });

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const app = buildApp(null);

      const res = await request(app)
        .post('/api/auth/biometric/register')
        .send({ publicKey: 'key', deviceId: 'dev' });

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/auth/biometric/challenge ────────────────────────

  describe('GET /api/auth/biometric/challenge', () => {
    it('should return challenge nonce for registered pair', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ publicKey: 'key' }),
      });

      const app = buildApp(null);
      const res = await request(app)
        .get('/api/auth/biometric/challenge')
        .query({ uniqueId: '12345678', deviceId: 'dev-1' });

      expect(res.status).toBe(200);
      expect(res.body.challenge).toBeTruthy();
      expect(typeof res.body.challenge).toBe('string');
    });

    it('should return 404 for unregistered pair', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const app = buildApp(null);
      const res = await request(app)
        .get('/api/auth/biometric/challenge')
        .query({ uniqueId: '99999999', deviceId: 'unknown' });

      expect(res.status).toBe(404);
    });

    it('should reject missing uniqueId', async () => {
      const app = buildApp(null);
      const res = await request(app)
        .get('/api/auth/biometric/challenge')
        .query({ deviceId: 'dev-1' });

      expect(res.status).toBe(400);
    });

    it('should reject missing deviceId', async () => {
      const app = buildApp(null);
      const res = await request(app)
        .get('/api/auth/biometric/challenge')
        .query({ uniqueId: '12345678' });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/auth/biometric/verify ──────────────────────────

  describe('POST /api/auth/biometric/verify', () => {
    it('should reject when no challenge exists', async () => {
      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/biometric/verify')
        .send({ uniqueId: '99999999', deviceId: 'no-challenge-device', signature: 'sig' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/challenge/i);
    });

    it('should reject missing fields', async () => {
      const app = buildApp(null);
      const res = await request(app)
        .post('/api/auth/biometric/verify')
        .send({ uniqueId: '12345678' });

      expect(res.status).toBe(400);
    });

    it('should verify valid signature end-to-end', async () => {
      // Generate a real keypair for testing
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      // 1. Register the key
      mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ publicKey }) });

      const app = buildApp(null);

      // 2. Get challenge
      const challengeRes = await request(app)
        .get('/api/auth/biometric/challenge')
        .query({ uniqueId: '12345678', deviceId: 'dev-1' });

      expect(challengeRes.status).toBe(200);
      const { challenge } = challengeRes.body;

      // 3. Sign the challenge
      const sign = crypto.createSign('SHA256');
      sign.update(challenge);
      const signature = sign.sign(privateKey, 'base64');

      // Mock for verify: get biometric key, then get user doc
      mockDocGet
        .mockResolvedValueOnce({ exists: true, data: () => ({ publicKey }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ firebaseUid: 'fb-uid-bio' }) });

      // 4. Verify
      const verifyRes = await request(app)
        .post('/api/auth/biometric/verify')
        .send({ uniqueId: '12345678', deviceId: 'dev-1', signature });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.customToken).toBe('bio-custom-token');
      expect(auth.createCustomToken).toHaveBeenCalledWith('fb-uid-bio');
    });

    it('should reject invalid signature', async () => {
      const { publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      // Get challenge first
      mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ publicKey }) });
      const app = buildApp(null);

      const challengeRes = await request(app)
        .get('/api/auth/biometric/challenge')
        .query({ uniqueId: '12345678', deviceId: 'dev-1' });

      const { challenge: _challenge } = challengeRes.body;

      // Mock for verify
      mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ publicKey }) });

      // Submit wrong signature
      const verifyRes = await request(app)
        .post('/api/auth/biometric/verify')
        .send({
          uniqueId: '12345678',
          deviceId: 'dev-1',
          signature: Buffer.from('invalid-signature').toString('base64'),
        });

      expect(verifyRes.status).toBe(401);
    });
  });

  // ─── DELETE /api/auth/biometric/:deviceId ─────────────────────

  describe('DELETE /api/auth/biometric/:deviceId', () => {
    it('should revoke biometric key and return 200', async () => {
      const app = buildApp({ uniqueId: 12345678 });

      const res = await request(app).delete('/api/auth/biometric/dev-1');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Biometric key revoked');
      expect(mockDocDelete).toHaveBeenCalledWith('biometricKeys/12345678:dev-1');
    });

    it('should return 401 without auth', async () => {
      const app = buildApp(null);

      const res = await request(app).delete('/api/auth/biometric/dev-1');

      expect(res.status).toBe(401);
    });
  });
});
