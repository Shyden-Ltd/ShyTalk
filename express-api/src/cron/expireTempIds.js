const { db } = require('../utils/firebase');
const log = require('../utils/log');

async function expireTempIds() {
  const nowMs = Date.now();
  const snap = await db.collection('users')
    .where('tempUniqueIdExpiry', '<=', nowMs)
    .where('tempUniqueIdExpiry', '>', 0)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, { tempUniqueId: null, tempUniqueIdExpiry: null });
  }
  await batch.commit();
  log.info('cron', 'expireTempIds: expired temp IDs', { count: snap.size });
}

module.exports = expireTempIds;
