/**
 * closedRooms.test.js — EPIC-0003 / SHY-0120 slice 3.
 *
 * MIGRATED off the firebase + log Jest mocks (the prior tests asserted
 * `batch.delete`/`roomDoc.delete toHaveBeenCalledTimes` and could not catch the
 * cron deleting the WRONG rooms) onto the REAL Firestore emulator. Each test
 * seeds real CLOSED/active rooms (+ real message/seatRequest subcollection
 * docs), runs the real cron, and reads back to assert the real outcome — the
 * >7-day-closed rooms and their subcollections gone, the recent/active/
 * no-closedAt rooms retained. The real `log` runs unmocked (exercised, not
 * asserted).
 *
 * Isolation: the cron queries the whole `rooms` collection + deletes the
 * `messages`/`seatRequests` collection groups, so all three are cleared in
 * beforeEach for a clean slate. See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const closedRooms = require('../../src/cron/closedRooms');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');

const DAY_MS = 24 * 60 * 60 * 1000;
const eightDaysAgo = () => Date.now() - 8 * DAY_MS;
const oneDayAgo = () => Date.now() - DAY_MS;

const seedRoom = (id, fields) => db.doc(`rooms/${id}`).set(fields);
const roomExists = async (id) => (await db.doc(`rooms/${id}`).get()).exists;
const subSize = async (roomId, sub) => (await db.collection(`rooms/${roomId}/${sub}`).get()).size;

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearCollection(db, 'rooms');
  await clearCollectionGroup(db, 'messages');
  await clearCollectionGroup(db, 'seatRequests');
});

afterAll(async () => {
  await clearCollection(db, 'rooms');
  await clearCollectionGroup(db, 'messages');
  await clearCollectionGroup(db, 'seatRequests');
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('closedRooms cron (real Firestore emulator)', () => {
  test('an empty rooms collection is a clean no-op', async () => {
    await expect(closedRooms()).resolves.toBeUndefined();
  });

  test('retains a CLOSED room closed less than 7 days ago', async () => {
    await seedRoom('recent', { state: 'CLOSED', closedAt: oneDayAgo() });

    await closedRooms();

    expect(await roomExists('recent')).toBe(true);
  });

  test('deletes a >7-day-old CLOSED room AND its messages + seatRequests subcollections', async () => {
    await seedRoom('old', { state: 'CLOSED', closedAt: eightDaysAgo() });
    await db.doc('rooms/old/messages/m1').set({ text: 'hi' });
    await db.doc('rooms/old/messages/m2').set({ text: 'bye' });
    await db.doc('rooms/old/seatRequests/s1').set({ userId: 'u1' });

    await closedRooms();

    expect(await roomExists('old')).toBe(false);
    expect(await subSize('old', 'messages')).toBe(0);
    expect(await subSize('old', 'seatRequests')).toBe(0);
  });

  test('deletes an old CLOSED room that has no subcollections without error', async () => {
    await seedRoom('bare', { state: 'CLOSED', closedAt: eightDaysAgo() });

    await expect(closedRooms()).resolves.toBeUndefined();
    expect(await roomExists('bare')).toBe(false);
  });

  test('paginates and deletes a room with exactly 500 messages (the do/while boundary)', async () => {
    await seedRoom('big', { state: 'CLOSED', closedAt: eightDaysAgo() });
    // One batched write seeds all 500 (Firestore batch cap) — cheap setup that
    // still forces the cron's `do … while (size === 500)` loop to run twice
    // (full page → then an empty page → break).
    const batch = db.batch();
    for (let i = 0; i < 500; i++) {
      batch.set(db.doc(`rooms/big/messages/m${i}`), { text: `m${i}` });
    }
    await batch.commit();

    await closedRooms();

    expect(await roomExists('big')).toBe(false);
    expect(await subSize('big', 'messages')).toBe(0);
  });

  test('skips a CLOSED room with no closedAt timestamp', async () => {
    await seedRoom('no-ts', { state: 'CLOSED' }); // no closedAt

    await closedRooms();

    expect(await roomExists('no-ts')).toBe(true);
  });

  test('never deletes a non-CLOSED room even if old (state scoping)', async () => {
    await seedRoom('active-old', { state: 'ACTIVE', closedAt: eightDaysAgo() });

    await closedRooms();

    expect(await roomExists('active-old')).toBe(true);
  });

  test('deletes multiple old CLOSED rooms in one run (loop continues across rooms)', async () => {
    await seedRoom('old-a', { state: 'CLOSED', closedAt: eightDaysAgo() });
    await seedRoom('old-b', { state: 'CLOSED', closedAt: eightDaysAgo() });

    await closedRooms();

    expect(await roomExists('old-a')).toBe(false);
    expect(await roomExists('old-b')).toBe(false);
  });

  test('deletes at most 20 rooms per run — a 21st old CLOSED room survives this run', async () => {
    const batch = db.batch();
    for (let i = 0; i < 21; i++) {
      batch.set(db.doc(`rooms/old-${i}`), { state: 'CLOSED', closedAt: eightDaysAgo() });
    }
    await batch.commit();

    await closedRooms();

    // 21 eligible, cap 20 → exactly one CLOSED room remains (cleared next run).
    const remaining = await db.collection('rooms').where('state', '==', 'CLOSED').get();
    expect(remaining.size).toBe(1);
  });
});
