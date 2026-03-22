const express = require('express');
const request = require('supertest');

// ─── Must mock firebase/log before any route require ─────────────
jest.mock('../../src/utils/firebase', () => ({
  db: {},
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

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
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

    // Verify AccessToken was called with the authenticated user's uniqueId as a string
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
});
