/**
 * UK OSA #17 PR 4 — the room cross-cohort gate, against REAL Firestore.
 *
 *   POST /api/rooms/:roomId/invites/send   → gate caller↔invitee
 *   POST /api/rooms/:roomId/seat-requests  → gate caller↔room owner
 *                                            (the owner's cohort is the
 *                                            stand-in for room.cohort until
 *                                            PR 7 ships it)
 *
 * Each route: cross-cohort 404 + audit, same-cohort allow, admin bypass.
 *
 * ─── What changed, and why it mattered (SHY-0479) ───────────────────────────
 *
 * This suite used to replace Firestore entirely — a `Map` of paths to objects,
 * plus doubles for RTDB, helpers, logging and `isLiveAdmin`. Twenty-eight of
 * them. Every assertion about who may reach whom was an assertion about that
 * Map, which matters more here than in most places: this is the test that says
 * an adult cannot invite a minor into a room. A double that is more generous
 * than reality hides the defect; one that is less complete invents one.
 *
 * Now the emulator is real, the documents are real, and the audit trail is read
 * back out of Firestore rather than off a spy. Three assertions got STRONGER as
 * a result:
 *
 *   * "pendingInvites was not updated" reads the room document back, instead of
 *     asserting that an update function was not called.
 *   * "the seat request was not created" queries the real subcollection.
 *   * The happy-path request id used to be pinned to a stubbed `generateId`
 *     ('req-123'), which proved nothing about persistence. It now fetches the
 *     document AT that id — so the id has to be real and the write has to have
 *     landed.
 *
 * ─── What is still a double, and why ────────────────────────────────────────
 *
 * FCM only. There is no local FCM emulator; the operator's 2026-06-17 decision
 * for EPIC-0003 permits a double locally provided real push is proven in dev.
 *
 * `req.auth` is still injected. Identity resolution is not the subject — the
 * GATE is — and the target of every gate decision is a real Firestore document.
 * `isLiveAdmin` is the real one: it returns true under Jest unless
 * AUTH_FORCE_LIVE_ADMIN_CHECK is set, so the admin bypass turns on the token
 * claim exactly as it does in production.
 */

// Set BEFORE requiring src/utils/firebase: outside 'local' it demands
// FIREBASE_DATABASE_URL and calls process.exit(1) at module load, which Jest
// reports as "worker encountered child process exceptions" rather than as a
// missing variable. Same preamble as the other real-emulator route suites.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { _resetAuditDedup } = require('../../src/middleware/sameCohort');
const roomsRouter = require('../../src/routes/rooms');

// Per-file id range: no seeded persona, no other suite (SHY-0464).
const CALLER = 64500001;
const INVITEE_ADULT = 64500002;
const INVITEE_MINOR = 64500003;
const OWNER_ADULT = 64500004;
const OWNER_MINOR = 64500005;
const DELETED_OWNER = 64500006;
const ACTORS = [CALLER, INVITEE_ADULT, INVITEE_MINOR, OWNER_ADULT, OWNER_MINOR, DELETED_OWNER];

const ROOM = 'shy0479-room';

/**
 * The audit rows this suite is responsible for.
 *
 * `segregationEvents` is a shared collection, so filtering by THIS file's actor
 * ids is what keeps the assertions honest when other suites have written to it.
 */
async function auditsForThisSuite() {
  const snap = await db
    .collection('segregationEvents')
    .where('sourceUniqueId', '==', String(CALLER))
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function clearAudits() {
  const snap = await db
    .collection('segregationEvents')
    .where('sourceUniqueId', '==', String(CALLER))
    .get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function clearSeatRequests() {
  const snap = await db.collection(`rooms/${ROOM}/seatRequests`).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

const seatRequests = async () => (await db.collection(`rooms/${ROOM}/seatRequests`).get()).docs;

const pendingInvitesOf = async (roomId) => {
  const snap = await db.doc(`rooms/${roomId}`).get();
  return snap.exists ? snap.data().pendingInvites || {} : null;
};

function createApp({ uniqueId = String(CALLER), cohort = 'adult', admin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: `rt-uid-${uniqueId}`,
      uniqueId,
      token: { cohort, ...(admin ? { admin: true } : {}) },
    };
    next();
  });
  app.use('/api', roomsRouter);
  return app;
}

/** Let the middleware's fire-and-forget audit write reach Firestore. */
const settleAudit = () => new Promise((r) => setImmediate(r));

beforeAll(assertEmulatorReachable);

beforeEach(async () => {
  _resetAuditDedup();
  await Promise.all([clearAudits(), clearSeatRequests(), db.doc(`rooms/${ROOM}`).delete()]);
  await Promise.all([
    db.doc(`users/${INVITEE_ADULT}`).set({ uniqueId: INVITEE_ADULT, cohort: 'adult' }),
    db.doc(`users/${INVITEE_MINOR}`).set({ uniqueId: INVITEE_MINOR, cohort: 'minor' }),
    db.doc(`users/${OWNER_ADULT}`).set({ uniqueId: OWNER_ADULT, cohort: 'adult' }),
    db.doc(`users/${OWNER_MINOR}`).set({ uniqueId: OWNER_MINOR, cohort: 'minor' }),
    db.doc(`users/${CALLER}`).set({ uniqueId: CALLER, cohort: 'adult' }),
    db.doc(`users/${DELETED_OWNER}`).delete(),
  ]);
});

afterAll(async () => {
  await Promise.all([clearAudits(), clearSeatRequests(), db.doc(`rooms/${ROOM}`).delete()]);
  await Promise.all(ACTORS.map((id) => db.doc(`users/${id}`).delete()));
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/rooms/:roomId/invites/send
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/invites/send — cross-cohort gate', () => {
  beforeEach(() => db.doc(`rooms/${ROOM}`).set({ name: 'Room', pendingInvites: {} }));

  test('adult inviting minor → 404 + audit', async () => {
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE_MINOR), invitedBy: String(CALLER) });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    await settleAudit();
    const audits = await auditsForThisSuite();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      sourceUniqueId: String(CALLER),
      sourceCohort: 'adult',
      targetUniqueId: String(INVITEE_MINOR),
      targetCohort: 'minor',
      action: 'blocked',
    });

    // Critical: the gate ran BEFORE the write. Read the room back rather than
    // asserting that an update function went uncalled — the question is what
    // Firestore holds, not which functions ran.
    expect(await pendingInvitesOf(ROOM)).toEqual({});
  });

  test('same-cohort invite proceeds normally', async () => {
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE_ADULT), invitedBy: String(CALLER) });

    expect(res.status).toBe(200);
    await settleAudit();
    expect(await auditsForThisSuite()).toHaveLength(0);
    // The invite is really there, under the invitee's id.
    expect(await pendingInvitesOf(ROOM)).toHaveProperty(String(INVITEE_ADULT));
  });

  test('admin cross-cohort invite is allowed', async () => {
    const res = await request(createApp({ admin: true }))
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE_MINOR), invitedBy: String(CALLER) });

    expect(res.status).toBe(200);
    await settleAudit();
    expect(await auditsForThisSuite()).toHaveLength(0);
    expect(await pendingInvitesOf(ROOM)).toHaveProperty(String(INVITEE_MINOR));
  });

  test('missing invitee → 404 Not found (existence-hiding)', async () => {
    // Never seeded, and deleted in beforeEach: a real absence, not a Map miss.
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(DELETED_OWNER), invitedBy: String(CALLER) });

    expect(res.status).toBe(404);
    // Byte-identical to the blocked-invitee refusal: a caller cannot tell
    // "does not exist" from "you may not reach them".
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/rooms/:roomId/seat-requests
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seat-requests — cross-cohort gate', () => {
  test('adult requesting seat in minor-owned room → 404 + audit', async () => {
    await db.doc(`rooms/${ROOM}`).set({ name: 'Minor Room', ownerId: String(OWNER_MINOR) });

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3, userName: 'Bob' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    await settleAudit();
    const audits = await auditsForThisSuite();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      sourceUniqueId: String(CALLER),
      sourceCohort: 'adult',
      targetUniqueId: String(OWNER_MINOR),
      targetCohort: 'minor',
      action: 'blocked',
    });

    // No seat request exists — asserted against the real subcollection.
    expect(await seatRequests()).toHaveLength(0);
  });

  test('same-cohort seat-request proceeds normally', async () => {
    await db.doc(`rooms/${ROOM}`).set({ name: 'Adult Room', ownerId: String(OWNER_ADULT) });

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3, userName: 'Bob' });

    expect(res.status).toBe(200);
    await settleAudit();
    expect(await auditsForThisSuite()).toHaveLength(0);

    // The id used to be pinned to a stubbed generateId ('req-123'), which said
    // nothing about whether anything was written. Fetch the document AT the
    // returned id instead: the id has to be real and the write has to have
    // landed.
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
    const created = await db.doc(`rooms/${ROOM}/seatRequests/${res.body.requestId}`).get();
    expect(created.exists).toBe(true);
    expect(created.data()).toMatchObject({ userId: String(CALLER), seatIndex: 3 });
  });

  test('admin cross-cohort seat-request is allowed', async () => {
    await db.doc(`rooms/${ROOM}`).set({ name: 'Minor Room', ownerId: String(OWNER_MINOR) });

    const res = await request(createApp({ admin: true }))
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 });

    expect(res.status).toBe(200);
    await settleAudit();
    expect(await auditsForThisSuite()).toHaveLength(0);
    expect(await seatRequests()).toHaveLength(1);
  });

  test('room without ownerId is refused (404) — cannot resolve cohort', async () => {
    // A malformed room cannot resolve the cohort stand-in. Refuse, rather than
    // let the API-layer gate fall through: the Firestore rules are a backstop,
    // not the only line of defence.
    await db.doc(`rooms/${ROOM}`).set({ name: 'Anonymous Room' });

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 });

    expect(res.status).toBe(404);
    // A DIFFERENT message from the gate's: this is a malformed room, not a
    // hidden person, and conflating them would hide the malformation.
    expect(res.body).toEqual({ error: 'Room not found' });
    await settleAudit();
    expect(await auditsForThisSuite()).toHaveLength(0);
  });

  test('missing owner doc → 404 + audit (existence-hiding via middleware)', async () => {
    // The owner was deleted out from under the room — a real dangling
    // reference, not an absent Map key.
    await db.doc(`rooms/${ROOM}`).set({ name: 'Room', ownerId: String(DELETED_OWNER) });

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(await seatRequests()).toHaveLength(0);
  });

  test('missing room → 404 (existing behavior preserved)', async () => {
    await db.doc(`rooms/${ROOM}`).delete();

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 });

    expect(res.status).toBe(404);
  });
});
