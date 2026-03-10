/**
 * Cron: Delete closed rooms older than 7 days.
 *
 * Queries up to 200 rooms with state=='CLOSED', filters by closedAt > 7 days ago,
 * then deletes up to 20 per run (room doc + subcollections: messages, seatRequests).
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

async function closedRooms() {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const snapshot = await db.collection('rooms')
    .where('state', '==', 'CLOSED')
    .limit(200)
    .get();

  if (snapshot.empty) return;

  // Only delete rooms closed more than 7 days ago — cap at 20 per run
  const old = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => r.closedAt && r.closedAt < sevenDaysAgo)
    .slice(0, 20);

  if (old.length === 0) return;

  let deleted = 0;
  for (const room of old) {
    try {
      // Delete all messages (paginated to handle rooms with 500+ messages)
      const messagesRef = db.collection(`rooms/${room.id}/messages`);
      let msgSnap;
      do {
        msgSnap = await messagesRef.limit(500).get();
        if (msgSnap.empty) break;
        const batch = db.batch();
        msgSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      } while (msgSnap.size === 500);

      // Delete all seat requests (paginated)
      const seatsRef = db.collection(`rooms/${room.id}/seatRequests`);
      let seatSnap;
      do {
        seatSnap = await seatsRef.limit(500).get();
        if (seatSnap.empty) break;
        const batch = db.batch();
        seatSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      } while (seatSnap.size === 500);

      // Delete the room doc itself
      await db.doc(`rooms/${room.id}`).delete();
      deleted++;
    } catch (err) {
      log.error('cron', 'closedRooms: failed to delete room', { roomId: room.id, error: err.message });
    }
  }

  log.info('cron', 'closedRooms: cleaned up old closed rooms', { deleted, total: old.length });
}

module.exports = closedRooms;
