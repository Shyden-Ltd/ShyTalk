const express = require('express');
const request = require('supertest');

// ─── Must mock firebase/log before any route require ─────────────
// Default room doc: cohort 'adult' so tests that don't override get
// a same-cohort match (default identity is adult uniqueId 12345 +
// adult cohort claim — see `createApp`). Tests that need different
// scenarios re-stub `mockRoomGet` per-test. UK OSA #17 PR 7 wired
// in the room-lookup + cohort gate inside `/api/livekit/token`.
const mockRoomGet = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockRoomGet }));
const mockAdd = jest.fn();
const mockCollection = jest.fn(() => ({ add: mockAdd }));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
  },
  admin: { firestore: () => ({}) },
}));
jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── LiveKit SDK mock ────────────────────────────────────────────

const mockToJwt = jest.fn().mockResolvedValue('mock-jwt-token');
const mockAddGrant = jest.fn();

jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: mockAddGrant,
    toJwt: mockToJwt,
  })),
}));

const { AccessToken } = require('livekit-server-sdk');

// ─── Region routing mock ─────────────────────────────────────────

jest.mock('../../src/utils/livekit-region', () => ({
  getRegion: jest.fn().mockReturnValue('asia'),
  getRegionConfig: jest.fn().mockReturnValue({
    url: 'wss://livekit.test.com',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  }),
}));
const { getRegion, getRegionConfig } = require('../../src/utils/livekit-region');

beforeEach(() => {
  jest.clearAllMocks();
  // Reset region mock to default (asia) after clearAllMocks resets return values
  getRegion.mockReturnValue('asia');
  getRegionConfig.mockReturnValue({
    url: 'wss://livekit.test.com',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  });
  mockToJwt.mockResolvedValue('mock-jwt-token');
  // Default room doc: cohort 'minor'. `createApp` doesn't set a
  // cohort claim on req.auth.token, so `cohortFromClaim` defaults
  // the caller to 'minor' — match that with a 'minor' room so the
  // gate passes by default. Cohort-mismatch scenarios live in
  // `livekit-cohort.test.js`; this file pins the pre-PR-7 token
  // contract (granted, region, identity, etc.) plus a baseline of
  // continued-to-work cases after PR 7's gate is wired in.
  mockRoomGet.mockResolvedValue({
    exists: true,
    data: () => ({ cohort: 'minor' }),
  });
});

// ─── App setup ───────────────────────────────────────────────────

const livekitRouter = require('../../src/routes/livekit');

function createApp(uniqueId = 12345) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId };
    next();
  });
  app.use('/api', livekitRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/livekit/token', () => {
  test('returns 400 when roomName is missing', async () => {
    const app = createApp();
    await request(app).post('/api/livekit/token').send({}).expect(400);
  });

  test('returns 400 when roomName is numeric (non-string)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/livekit/token').send({ roomName: 123 }).expect(400);

    expect(res.body.error).toBe('roomName is required');
  });

  test('generates token with authenticated uniqueId as identity', async () => {
    const app = createApp(99001);
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(200);

    expect(res.body.token).toBe('mock-jwt-token');
    expect(res.body.url).toBe('wss://livekit.test.com');

    // Verify AccessToken was called with region config keys and the authenticated user's uniqueId
    expect(AccessToken).toHaveBeenCalledWith(
      'test-key',
      'test-secret',
      expect.objectContaining({ identity: '99001' }),
    );
  });

  test('ignores identity from request body (prevents impersonation)', async () => {
    const app = createApp(99001);
    const _res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room', identity: 'impersonated-user' })
      .expect(200);

    // Should use the authenticated user's uniqueId, not the body identity
    expect(AccessToken).toHaveBeenCalledWith(
      'test-key',
      'test-secret',
      expect.objectContaining({ identity: '99001' }),
    );
  });

  test('grants correct room permissions', async () => {
    const app = createApp();
    await request(app).post('/api/livekit/token').send({ roomName: 'my-room' }).expect(200);

    expect(mockAddGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        roomJoin: true,
        room: 'my-room',
        canPublish: true,
        canSubscribe: true,
      }),
    );
  });

  test('returns url field from region config', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(200);

    expect(res.body.token).toBe('mock-jwt-token');
    expect(res.body.url).toBe('wss://livekit.test.com');
  });

  test('uses EU region config when getRegion returns eu', async () => {
    getRegion.mockReturnValue('eu');
    getRegionConfig.mockReturnValue({
      url: 'wss://livekit-eu.test.com',
      apiKey: 'eu-key',
      apiSecret: 'eu-secret',
    });

    const app = createApp(77001);
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'eu-room' })
      .expect(200);

    expect(res.body.url).toBe('wss://livekit-eu.test.com');
    expect(AccessToken).toHaveBeenCalledWith(
      'eu-key',
      'eu-secret',
      expect.objectContaining({ identity: '77001' }),
    );
    expect(getRegionConfig).toHaveBeenCalledWith('eu');
  });

  test('omits url field in local mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'local';

    try {
      const app = createApp();
      const res = await request(app)
        .post('/api/livekit/token')
        .send({ roomName: 'test-room' })
        .expect(200);

      expect(res.body.token).toBe('mock-jwt-token');
      expect(res.body.url).toBeUndefined();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('returns 500 when token generation fails', async () => {
    mockToJwt.mockRejectedValueOnce(new Error('signing failed'));
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(500);

    expect(res.body.error).toBe('Internal server error');
  });

  test('returns 503 when region credentials are not configured', async () => {
    getRegionConfig.mockReturnValue({
      url: 'wss://livekit.test.com',
      apiKey: undefined,
      apiSecret: undefined,
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(503);

    expect(res.body.error).toBe('Voice service not available');
  });

  test('returns 503 when only apiKey is missing', async () => {
    getRegionConfig.mockReturnValue({
      url: 'wss://livekit.test.com',
      apiKey: undefined,
      apiSecret: 'test-secret',
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(503);

    expect(res.body.error).toBe('Voice service not available');
  });

  test('returns 403 when uniqueId is null (user has no profile)', async () => {
    const app = createApp(null);
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(403);

    expect(res.body.error).toBe('User profile not found');
  });
});
