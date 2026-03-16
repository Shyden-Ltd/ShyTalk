/**
 * Cron: Delete expired backpack items.
 *
 * Uses a collection group query on 'backpack' to find all expired items
 * in a single Firestore read instead of N+1 queries.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

async function backpackCleanup() {
  const timestamp = Date.now();

  // Single collection group query instead of reading all users + their backpacks
  const snapshot = await db
    .collectionGroup('backpack')
    .where('expiresAt', '<=', timestamp)
    .limit(500)
    .get();

  if (snapshot.empty) {
    log.info('cron', 'backpackCleanup: no expired items');
    return;
  }

  // Batch delete expired items
  for (let i = 0; i < snapshot.docs.length; i += 500) {
    const batch = db.batch();
    const chunk = snapshot.docs.slice(i, i + 500);
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  log.info('cron', 'backpackCleanup: cleaned expired items', { count: snapshot.docs.length });
}

module.exports = backpackCleanup;
