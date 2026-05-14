/**
 * Tests for the LiveKit token-mint cohort gate (UK OSA #17 PR 7).
 *
 * The `/api/livekit/token` route is the only Express choke-point
 * between a client and a LiveKit room — rooms are written
 * direct-to-Firestore, so the rules layer carries the read/write
 * gates, but the LiveKit grant only happens here. Without this
 * gate, a cross-cohort caller who somehow learns a roomId (off-band,
 * leak, or pre-PR-3 cached id) could obtain a participant grant and
 * speak inside a room of the wrong cohort.
 *
 * Contract pinned by these tests:
 *   1. Same-cohort caller → 200 + token (control)
 *   2. Cross-cohort caller → 404 with body `{ error: 'Not found' }`
 *      (byte-identical to "room missing" — existence-hiding parity
 *      with `requireSameCohort`).
 *   3. Admin caller → 200 even cross-cohort (moderation needs entry).
 *   4. Room doc missing → 404 with the same body. No leak between
 *      "wrong cohort" and "no such room".
 *   5. Room doc missing `cohort` field → defaults to 'minor'
 *      (fail-closed; matches `cohortFromClaim` and the rules helper).
 *   6. Cross-cohort attempt writes a `segregationEvents` audit row
 *      with `action: 'blocked'` and `surface` set to the LiveKit
 *      route — same schema as the user-to-user gate's audit, so
 *      moderators can aggregate across surfaces.
 *   7. Audit-write failure does NOT leak via the 404 response.
 *   8. Self-targeting check is irrelevant here (LiveKit targets a
 *      room, not a user); the room-cohort comparison stands.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase + log mocks ────────────────────────────────────────

const mockRoomGet = jest.fn();
const mockDoc = jest.fn();
const mockAdd = jest.fn();
const mockCollection = jest.fn();

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

// ─── Region routing mock ─────────────────────────────────────────

jest.mock('../../src/utils/livekit-region', () => ({
  getRegion: jest.fn().mockReturnValue('asia'),
  getRegionConfig: jest.fn().mockReturnValue({
    url: 'wss://livekit.test.com',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  }),
}));

const log = require('../../src/utils/log');
const { AccessToken } = require('livekit-server-sdk');

// ─── Helpers ─────────────────────────────────────────────────────

function withRoomDoc(roomData) {
  mockDoc.mockImplementation((path) => {
    if (path === `rooms/${roomData?._roomId ?? 'test-room'}`) {
      return { get: mockRoomGet };
    }
    return { get: jest.fn().mockResolvedValue({ exists: false }) };
  });
  mockRoomGet.mockResolvedValue({
    exists: roomData !== null && roomData !== undefined,
    data: () => roomData,
  });
}

// `cohort: undefined` triggers the destructuring default, which would
// shadow the test intent ("no claim"). Use a sentinel to distinguish
// "caller omitted the option" from "caller explicitly set null".
const COHORT_UNSET = Symbol('cohort-unset');

function createApp({ uniqueId = 12345, cohort = COHORT_UNSET, admin = false } = {}) {
  const livekitRouter = require('../../src/routes/livekit');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = { admin };
    if (cohort !== COHORT_UNSET && cohort !== null) {
      token.cohort = cohort;
    }
    req.auth = {
      uid: 'firebase-uid',
      uniqueId,
      token,
    };
    next();
  });
  app.use('/api', livekitRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdd.mockReset();
  mockAdd.mockResolvedValue({ id: 'evt_abc' });
  mockCollection.mockReturnValue({ add: mockAdd });
  mockToJwt.mockResolvedValue('mock-jwt-token');
});

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/livekit/token — cohort gate', () => {
  test('200 + token when caller cohort matches room cohort (adult/adult)', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'adult' });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(200);

    expect(res.body.token).toBe('mock-jwt-token');
    expect(AccessToken).toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('404 + Not found body when caller is adult and room is minor', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'minor' });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    expect(AccessToken).not.toHaveBeenCalled();
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockCollection).toHaveBeenCalledWith('segregationEvents');
  });

  test('404 + Not found body when caller is minor and room is adult', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'adult' });

    const app = createApp({ cohort: 'minor', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    expect(AccessToken).not.toHaveBeenCalled();
  });

  test('admin bypass — 200 even cross-cohort', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'minor' });

    const app = createApp({ cohort: 'adult', admin: true, uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(200);

    expect(res.body.token).toBe('mock-jwt-token');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('404 + Not found body when room doc does not exist', async () => {
    mockDoc.mockReturnValue({ get: mockRoomGet });
    mockRoomGet.mockResolvedValue({ exists: false, data: () => null });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'ghost-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    expect(AccessToken).not.toHaveBeenCalled();
    // Room-missing branch does NOT write a segregationEvents row —
    // that branch fires only on a cohort MISMATCH where both sides
    // exist; a missing room is a regular 404 cause, not a gate hit.
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('room without cohort field defaults to minor (fail-closed)', async () => {
    // Pre-PR-7 rooms have no cohort field. The default of 'minor' means
    // an adult-claim caller cannot mint a token for a legacy room until
    // the migration tags it — surfacing the migration gap rather than
    // silently allowing through.
    withRoomDoc({ _roomId: 'legacy-room' /* no cohort */ });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'legacy-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });

    // A minor caller on a legacy (no-cohort) room SUCCEEDS — both
    // resolve to 'minor'. This is the rollout-safety knob: legacy
    // rooms behave as minor-only until migrated.
    const minorApp = createApp({ cohort: 'minor', uniqueId: 99002 });
    await request(minorApp)
      .post('/api/livekit/token')
      .send({ roomName: 'legacy-room' })
      .expect(200);
  });

  test('audit row captures both cohorts + surface + action + targetRoomId', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'minor' });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    await request(app).post('/api/livekit/token').send({ roomName: 'test-room' }).expect(404);

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const auditDoc = mockAdd.mock.calls[0][0];
    expect(auditDoc).toMatchObject({
      sourceUniqueId: '99001',
      sourceCohort: 'adult',
      targetUniqueId: 'test-room',
      targetRoomId: 'test-room',
      targetCohort: 'minor',
      surface: expect.stringContaining('livekit'),
      action: 'blocked',
    });
    expect(typeof auditDoc.timestamp).toBe('number');
  });

  test('SECURITY: malformed roomName (path-traversal probe) returns opaque 404 — same body as missing-room', async () => {
    // `r/messages/m` would make db.doc() throw (invalid path-segment
    // count) which would 500 — letting a probe distinguish path
    // shapes from "no such room". The pre-Firestore shape check
    // forces these to the same 404 + Not found body.
    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'r/messages/m' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockDoc).not.toHaveBeenCalled(); // Never hits Firestore
  });

  test('SECURITY: roomName with special chars returns opaque 404', async () => {
    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const tries = ['../etc/passwd', 'room name with spaces', 'room$%^', 'a'.repeat(200)];
    for (const bad of tries) {
      const res = await request(app).post('/api/livekit/token').send({ roomName: bad }).expect(404);
      expect(res.body).toEqual({ error: 'Not found' });
    }
    expect(mockDoc).not.toHaveBeenCalled();
  });

  test('cohort gate fires BEFORE credentials check (operator-error does not leak room existence)', async () => {
    // If a future refactor moved the regionConfig validation above
    // the cohort gate, a cross-cohort caller hitting an unconfigured
    // region would get 503 (revealing the room exists) instead of
    // 404. Pin the ordering.
    withRoomDoc({ _roomId: 'test-room', cohort: 'minor' });
    const { getRegionConfig } = require('../../src/utils/livekit-region');
    getRegionConfig.mockReturnValueOnce({
      url: 'wss://broken.test',
      apiKey: undefined,
      apiSecret: undefined,
    });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('audit-write failure does NOT leak via response', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'minor' });
    mockAdd.mockRejectedValueOnce(new Error('firestore unavailable'));

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    // log.error fires fire-and-forget for the failed audit; the wait
    // for it is racy under supertest. We just assert the response
    // shape is the same as a successful-audit cross-cohort 404.
  });

  test('stripped cohort claim treated as minor (defensive)', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'adult' });

    // No cohort claim — caller defaults to 'minor'; room is 'adult'.
    const app = createApp({ cohort: undefined, uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('roomName-missing 400 still wins over cohort gate', async () => {
    // Don't even reach Firestore — bad-request shape takes precedence
    // so callers debugging integrations see the schema error first.
    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    await request(app).post('/api/livekit/token').send({}).expect(400);
    expect(mockDoc).not.toHaveBeenCalled();
  });

  test('audit failure logs the error', async () => {
    withRoomDoc({ _roomId: 'test-room', cohort: 'minor' });
    const err = new Error('quota exhausted');
    mockAdd.mockRejectedValueOnce(err);

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    await request(app).post('/api/livekit/token').send({ roomName: 'test-room' }).expect(404);

    // Wait a tick for the fire-and-forget promise to reject.
    await new Promise((r) => setImmediate(r));
    expect(log.error).toHaveBeenCalledWith(
      'segregationEvents',
      'write failed',
      expect.objectContaining({ error: 'quota exhausted' }),
    );
  });

  test('Firestore lookup failure → 500 (not silent 200)', async () => {
    // A throw inside the room-doc lookup must surface, not silently
    // fall through to the grant. The gate is the load-bearing op
    // for cohort isolation — failing closed is mandatory.
    mockDoc.mockReturnValue({ get: jest.fn().mockRejectedValue(new Error('rpc timeout')) });

    const app = createApp({ cohort: 'adult', uniqueId: 99001 });
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(500);

    expect(res.body.error).toBe('Internal server error');
    expect(AccessToken).not.toHaveBeenCalled();
  });
});
