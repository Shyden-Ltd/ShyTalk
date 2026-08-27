/**
 * SHY-0480 — the FCM half of the rooms write routes.
 *
 * Split out of `rooms.test.js`, which is now real end to end. These tests are
 * about what the routes ASK FCM to send: the payload contents, invalid-token
 * cleanup, the display-name fallbacks, and what the route does when a send
 * fails.
 *
 * There is no local FCM emulator, so `src/utils/fcm` is the one collaborator
 * that cannot be real here. `*.unit.test.js` is the location the no-new-stubs
 * ratchet (EPIC-0003) reserves for exactly that — a genuinely isolated
 * collaborator, tested as one, rather than a route test wearing a double
 * because the real thing was inconvenient. Real push is proven in dev
 * separately, per the operator's 2026-06-17 decision for this epic.
 *
 * ─── Everything else is real ────────────────────────────────────────────────
 *
 * Firestore and RTDB are the emulators. The originals stubbed `db.doc()` with
 * `mockResolvedValueOnce` CHAINS — the invitee's tokens were "the second
 * document the route happens to fetch". Any reordering inside the route would
 * have silently handed a test the wrong document while still passing. Seeding
 * real documents removes the ordering dependency entirely: the invitee has
 * tokens because the invitee's document has tokens.
 *
 * The two induced failures at the end also live here. Real Firestore does not
 * throw on demand, and "the route survives a failing dependency" is a unit
 * question about this route's error handling, not a statement about Firestore.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const mockSendFcmToTokens = jest.fn().mockResolvedValue([]);
const mockCleanupInvalidTokens = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: (...args) => mockCleanupInvalidTokens(...args),
}));

const { db, rtdb } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const roomsRouter = require('../../src/routes/rooms');

// Per-file id range: no seeded persona, no other suite (SHY-0464).
const CALLER = 64700001;
const INVITEE = 64700002;
const OWNER = 64700003;
const ACTORS = [CALLER, INVITEE, OWNER];

const ROOM = 'shy0480-fcm-room';

const roomDoc = () => db.doc(`rooms/${ROOM}`);
const seatRequestsCol = () => db.collection(`rooms/${ROOM}/seatRequests`);
const seatRequests = async () => (await seatRequestsCol().get()).docs;

async function clearSeatRequests() {
  const snap = await seatRequestsCol().get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

function createApp(uniqueId = String(CALLER)) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `rt-uid-${uniqueId}`, uniqueId, token: { cohort: 'adult' } };
    next();
  });
  app.use('/api', roomsRouter);
  return app;
}

const sendInvite = () =>
  request(createApp())
    .post(`/api/rooms/${ROOM}/invites/send`)
    .send({ userId: String(INVITEE), invitedBy: String(CALLER) });

const requestSeat = (body = { seatIndex: 3, userName: 'Bob' }) =>
  request(createApp()).post(`/api/rooms/${ROOM}/seat-requests`).send(body);

beforeAll(assertEmulatorReachable);

beforeEach(async () => {
  jest.clearAllMocks();
  mockSendFcmToTokens.mockResolvedValue([]);
  mockCleanupInvalidTokens.mockResolvedValue();
  await clearSeatRequests();
  await Promise.all([
    roomDoc().set({ name: 'Cool Room', ownerId: String(OWNER), pendingInvites: {} }),
    db.doc(`users/${CALLER}`).set({ uniqueId: CALLER, cohort: 'adult', displayName: 'Alice' }),
    db
      .doc(`users/${INVITEE}`)
      .set({ uniqueId: INVITEE, cohort: 'adult', fcmTokens: ['token-1', 'token-2'] }),
    db.doc(`users/${OWNER}`).set({ uniqueId: OWNER, cohort: 'adult', fcmTokens: ['owner-token'] }),
  ]);
});

afterAll(async () => {
  await clearSeatRequests();
  await Promise.all([roomDoc().delete(), ...ACTORS.map((id) => db.doc(`users/${id}`).delete())]);
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════
// Invite push
// ═══════════════════════════════════════════════════════════════════

describe('invite push', () => {
  test('sends FCM to the invitee with their tokens', async () => {
    await sendInvite().expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['token-1', 'token-2'],
      expect.objectContaining({
        type: 'ROOM_INVITE',
        roomId: ROOM,
        roomName: 'Cool Room',
        invitedBy: String(CALLER),
        inviterName: 'Alice',
      }),
      { senderUniqueId: String(CALLER), recipientUniqueId: String(INVITEE) },
    );
  });

  test('cleans up the tokens FCM reports invalid', async () => {
    mockSendFcmToTokens.mockResolvedValue(['token-2']);

    await sendInvite().expect(200);

    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['token-2'], String(INVITEE));
  });

  test('skips FCM when the invitee has no tokens', async () => {
    await db.doc(`users/${INVITEE}`).set({ uniqueId: INVITEE, cohort: 'adult' });

    await sendInvite().expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('falls back to "Someone" when the inviter has no displayName', async () => {
    await db.doc(`users/${CALLER}`).set({ uniqueId: CALLER, cohort: 'adult' });

    await sendInvite().expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inviterName: 'Someone' }),
      expect.anything(),
    );
  });

  test('falls back to "Someone" when the inviter document is gone', async () => {
    // A real dangling reference: the inviter is authenticated but their user
    // document no longer exists.
    await db.doc(`users/${CALLER}`).delete();

    await sendInvite().expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inviterName: 'Someone' }),
      expect.anything(),
    );
  });

  test('falls back to "a room" when the room has no name', async () => {
    await roomDoc().set({ ownerId: String(OWNER), pendingInvites: {} });

    await sendInvite().expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomName: 'a room' }),
      expect.anything(),
    );
  });

  test('a failing push does not fail the invite', async () => {
    mockSendFcmToTokens.mockRejectedValue(new Error('FCM unavailable'));

    await sendInvite().expect(200);

    // The invite is the product of this route; the push is a courtesy. The
    // invite must still be in Firestore.
    const invites = (await roomDoc().get()).data().pendingInvites || {};
    expect(invites).toHaveProperty(String(INVITEE));
  });

  test('a blocked invitee is never pushed to', async () => {
    // Existence-hiding runs before the push. A notification would leak that the
    // person exists — the exact thing the 404 is hiding.
    await db.doc(`users/${INVITEE}`).delete();

    await sendInvite().expect(404);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Seat-request push
// ═══════════════════════════════════════════════════════════════════

describe('seat-request push', () => {
  test('sends FCM to the room owner on a new request', async () => {
    await requestSeat().expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['owner-token'],
      expect.objectContaining({
        type: 'SEAT_REQUEST',
        roomId: ROOM,
        roomName: 'Cool Room',
        requesterId: String(CALLER),
        requesterName: 'Bob',
        seatIndex: '3',
      }),
      { senderUniqueId: String(CALLER), recipientUniqueId: String(OWNER) },
    );
  });

  test('cleans up the tokens FCM reports invalid', async () => {
    mockSendFcmToTokens.mockResolvedValue(['owner-token']);

    await requestSeat().expect(200);

    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['owner-token'], String(OWNER));
  });

  test('skips FCM when the owner has no tokens', async () => {
    await db.doc(`users/${OWNER}`).set({ uniqueId: OWNER, cohort: 'adult' });

    await requestSeat().expect(200);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('falls back to "a room" when the room has no name', async () => {
    await roomDoc().set({ ownerId: String(OWNER) });

    await requestSeat().expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomName: 'a room' }),
      expect.anything(),
    );
  });

  test('requesterName is an empty string when no userName is given', async () => {
    await requestSeat({ seatIndex: 3 }).expect(200);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requesterName: '' }),
      expect.anything(),
    );
  });

  test('a failing push does not fail the seat request', async () => {
    mockSendFcmToTokens.mockRejectedValue(new Error('FCM unavailable'));

    await requestSeat().expect(200);

    // The request is the product; the push is a courtesy.
    expect(await seatRequests()).toHaveLength(1);
  });

  test.each([
    ['the room has no ownerId', async () => roomDoc().set({ name: 'Anonymous Room' })],
    ['the owner document is gone', async () => db.doc(`users/${OWNER}`).delete()],
    ['the room is gone', async () => roomDoc().delete()],
  ])('no push and no request when %s', async (_label, arrange) => {
    await arrange();

    await requestSeat().expect(404);

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
    expect(await seatRequests()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Induced failures
// ═══════════════════════════════════════════════════════════════════

/**
 * Real Firestore does not throw on demand, and real RTDB does not refuse a
 * write to order. These three ask what THIS ROUTE does when a dependency fails
 * — its own error handling — so the dependency is made to fail with a targeted,
 * restored spy rather than by replacing the module.
 *
 * `jest.restoreAllMocks()` in afterEach is what keeps the spy from leaking into
 * the real-Firestore tests above.
 */
describe('induced failures', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a failed room broadcast is logged and does NOT fail the invite', async () => {
    const errors = jest.spyOn(log, 'error').mockImplementation(() => {});
    jest.spyOn(rtdb, 'ref').mockImplementation(() => ({
      set: () => Promise.reject(new Error('RTDB write failed')),
    }));

    await sendInvite().expect(200);

    expect(errors).toHaveBeenCalledWith(
      'rooms',
      'Failed to write RTDB event',
      expect.objectContaining({ error: 'RTDB write failed' }),
    );
    // Still a real invite in real Firestore — the broadcast is non-fatal.
    const invites = (await roomDoc().get()).data().pendingInvites || {};
    expect(invites).toHaveProperty(String(INVITEE));
  });

  test('returns 500 when the room fetch throws', async () => {
    const errors = jest.spyOn(log, 'error').mockImplementation(() => {});
    jest.spyOn(db, 'doc').mockImplementation(() => ({
      get: () => Promise.reject(new Error('Firestore down')),
    }));

    const res = await sendInvite();

    expect(res.status).toBe(500);
    // The caller is told nothing about why: 'Firestore down' names our
    // infrastructure to whoever asked.
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('Firestore down');
    expect(errors).toHaveBeenCalledWith(
      'rooms',
      'Send invite failed',
      expect.objectContaining({ error: 'Firestore down' }),
    );
  });

  test('returns 500 when creating the seat request throws', async () => {
    const errors = jest.spyOn(log, 'error').mockImplementation(() => {});
    jest.spyOn(db, 'doc').mockImplementation(() => ({
      get: () => Promise.reject(new Error('Firestore down')),
    }));

    const res = await requestSeat();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(errors).toHaveBeenCalledWith(
      'rooms',
      expect.stringMatching(/seat request/i),
      expect.objectContaining({ error: 'Firestore down' }),
    );
  });
});
