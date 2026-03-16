/**
 * Cron: Close rooms in OWNER_AWAY state for >10 minutes.
 *
 * Queries rooms with state=='OWNER_AWAY', filters by ownerLeftAt < 10min ago,
 * updates state to CLOSED, clears seats and participantIds,
 * and clears users' currentRoomId.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

function hasNonOwnerSeated(room) {
  if (!room.seats) return false;
  return Object.values(room.seats).some(
    (seat) => seat.userId && seat.userId !== room.ownerId && seat.state === 'OCCUPIED',
  );
}

async function staleRooms() {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

  const snapshot = await db.collection('rooms').where('state', '==', 'OWNER_AWAY').limit(100).get();

  if (snapshot.empty) return;

  // Close immediately if no non-owner seats occupied; otherwise wait 10 minutes
  const toClose = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => {
      if (!r.ownerLeftAt) return false;
      if (!hasNonOwnerSeated(r)) return true;
      return r.ownerLeftAt < tenMinutesAgo;
    });

  if (toClose.length === 0) return;

  const timestamp = Date.now();
  const emptySeat = { userId: null, state: 'EMPTY', isMuted: false };
  const emptySeats = {};
  for (let i = 0; i < 8; i++) emptySeats[String(i)] = { ...emptySeat };

  // Collect all writes (room updates + participant currentRoomId clears)
  const writes = [];

  for (const room of toClose) {
    writes.push({
      ref: db.doc(`rooms/${room.id}`),
      data: {
        state: 'CLOSED',
        closedAt: timestamp,
        ownerLeftAt: null,
        seats: emptySeats,
        participantIds: [],
      },
    });

    // Clear currentRoomId for all participants
    const pids = room.participantIds || [];
    for (const pid of pids) {
      writes.push({
        ref: db.doc(`users/${pid}`),
        data: { currentRoomId: null },
      });
    }
  }

  // Batch write in chunks of 500
  for (let i = 0; i < writes.length; i += 500) {
    const batch = db.batch();
    const chunk = writes.slice(i, i + 500);
    for (const w of chunk) {
      batch.set(w.ref, w.data, { merge: true });
    }
    await batch.commit();
  }

  log.info('cron', 'staleRooms: closed stale OWNER_AWAY rooms', { count: toClose.length });
}

module.exports = staleRooms;
