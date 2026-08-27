/**
 * Room settings — rename and the approval toggle — against REAL Firestore
 * transactions.
 *
 * Extracted from `room-mutations.test.js` (SHY-0484), the fourth slice after
 * SHY-0481 (seats), SHY-0482 (moderation) and SHY-0483 (membership).
 *
 * Both routes are owner-only, and both carry validation that only a real write
 * can confirm:
 *
 *   * a name is TRIMMED before it is stored — `toHaveBeenCalledWith(ref,
 *     { name: 'New Name' })` recorded an intention against a stub, never a
 *     document;
 *   * `requireApproval: false` must be treated as a VALUE rather than as
 *     "missing", and a recorded `{ requireApproval: false }` looks identical
 *     whether it was applied or ignored. Reading the document back settles it.
 *
 * These routes read the ROOM and nothing else, so no user documents are needed.
 * The "500 when the transaction throws" cases live in
 * `room-settings-errors.unit.test.js`.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const router = require('../../src/routes/room-mutations');

// Per-file room id: no other suite touches it (SHY-0464).
const ROOM = 'shy0484-settings';
const MAX_NAME = 50;

const roomRef = () => db.doc(`rooms/${ROOM}`);
const eventRef = () => rtdb.ref(`rooms/${ROOM}/events/lastEvent`);
const room = async () => {
  const s = await roomRef().get();
  return s.exists ? s.data() : null;
};

function createApp(uniqueId = 1, cohort = 'adult') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: { cohort } };
    next();
  });
  app.use('/api', router);
  return app;
}

/** Default room: owner=1, host=10, attendee=99. */
function mkRoom(overrides = {}) {
  return {
    ownerId: '1',
    cohort: 'adult',
    state: 'ACTIVE',
    name: 'Original Name',
    participantIds: ['1', '10', '99'],
    hostIds: ['10'],
    requireApproval: false,
    pendingInvites: {},
    seats: { 0: { userId: '1', state: 'OCCUPIED', isMuted: false } },
    ...overrides,
  };
}

async function seed(overrides = {}) {
  const data = mkRoom(overrides);
  await roomRef().set(data);
  await eventRef()
    .remove()
    .catch(() => {});
  return data;
}

beforeAll(assertEmulatorReachable);

beforeEach(() => roomRef().delete());

afterAll(async () => {
  await roomRef().delete();
  await rtdb
    .ref(`rooms/${ROOM}`)
    .remove()
    .catch(() => {});
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════
// rename
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /api/rooms/:roomId/name', () => {
  const rename = (name, uid = 1, cohort = 'adult') =>
    request(createApp(uid, cohort))
      .patch(`/api/rooms/${ROOM}/name`)
      .send(name === undefined ? {} : { name });

  test.each([
    ['missing', undefined],
    ['blank after trim', '   '],
    ['longer than the limit', 'x'.repeat(MAX_NAME + 1)],
  ])('400 when the name is %s — the room is untouched', async (_label, name) => {
    const before = await seed();
    expect((await rename(name)).status).toBe(400);
    expect(await room()).toEqual(before);
  });

  test('a name exactly at the limit is accepted (boundary)', async () => {
    // Counted in CHARACTERS. Pinned so the limit cannot quietly become a byte
    // limit, which would reject shorter names in most of our locales.
    await seed();
    const atLimit = 'x'.repeat(MAX_NAME);
    expect((await rename(atLimit)).status).toBe(200);
    expect((await room()).name).toBe(atLimit);
  });

  test('400 when the name is a non-string type (SHY-0487)', async () => {
    // A number is not "missing" and not "blank" — it is a third thing, and the
    // guard is a typeof check rather than a truthiness one.
    const before = await seed();
    const res = await request(createApp()).patch(`/api/rooms/${ROOM}/name`).send({ name: 42 });
    expect(res.status).toBe(400);
    expect(await room()).toEqual(before);
  });

  test('404 when the room does not exist', async () => {
    expect((await rename('Hi')).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await rename('Hi', 1, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('403 when a host (non-owner) tries to rename', async () => {
    const before = await seed();
    expect((await rename('Hi', 10)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when an attendee tries to rename', async () => {
    const before = await seed();
    expect((await rename('Hi', 99)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED', async () => {
    const before = await seed({ state: 'CLOSED' });
    expect((await rename('Hi')).status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('200 the owner renames — the stored name is TRIMMED', async () => {
    await seed();

    expect((await rename('  New Name  ')).status).toBe(200);

    // Compared exactly, against whitespace on BOTH sides, so a missing trim
    // cannot pass by coincidence.
    expect((await room()).name).toBe('New Name');
    expect((await eventRef().once('value')).val()).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// require-approval
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /api/rooms/:roomId/require-approval', () => {
  const toggle = (requireApproval, uid = 1, cohort = 'adult') =>
    request(createApp(uid, cohort))
      .patch(`/api/rooms/${ROOM}/require-approval`)
      .send(requireApproval === undefined ? {} : { requireApproval });

  test.each([
    ['not a boolean', 'yes'],
    ['missing', undefined],
  ])('400 when requireApproval is %s — the room is untouched', async (_label, value) => {
    const before = await seed();
    expect((await toggle(value)).status).toBe(400);
    expect(await room()).toEqual(before);
  });

  test('404 when the room does not exist', async () => {
    expect((await toggle(true)).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await toggle(true, 1, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('403 when a host (non-owner) toggles approval', async () => {
    const before = await seed();
    expect((await toggle(true, 10)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED', async () => {
    const before = await seed({ state: 'CLOSED' });
    expect((await toggle(true)).status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('200 the owner enables approval', async () => {
    await seed({ requireApproval: false });
    expect((await toggle(true)).status).toBe(200);
    expect((await room()).requireApproval).toBe(true);
  });

  test('200 the owner disables approval — false is a VALUE, not "missing"', async () => {
    // A recorded `{ requireApproval: false }` looks identical whether it was
    // applied or ignored. Starting from `true` and reading the document back
    // is what tells them apart.
    await seed({ requireApproval: true });

    expect((await toggle(false)).status).toBe(200);

    expect((await room()).requireApproval).toBe(false);
  });
});
