/**
 * Expire data exports cron — runs daily at 04:00 UTC.
 *
 * Deletes R2 objects for expired exports and marks them as expired
 * in Firestore.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');

// Cap per-tick reads to keep Spark-tier quota bounded. Daily cron;
// any backlog beyond CRON_LIMIT processes on the next day's tick.
// Pattern matches subscriptions.js / expireBans.js cron caps.
const CRON_LIMIT = 500;

async function expireDataExports() {
  const expiredSnap = await db
    .collection('users')
    .where('dataExportStatus', '==', 'ready')
    .where('dataExportExpiresAt', '>', 0)
    .limit(CRON_LIMIT)
    .get();
  if (expiredSnap.size === CRON_LIMIT) {
    log.warn('cron', 'expireDataExports: hit CRON_LIMIT — possible truncation', {
      limit: CRON_LIMIT,
    });
  }

  let expired = 0;
  for (const doc of expiredSnap.docs) {
    const data = doc.data();
    if (data.dataExportExpiresAt > Date.now()) continue; // Not yet expired

    try {
      if (data.dataExportR2Key) {
        await r2.deleteObjects([data.dataExportR2Key]);
      }
      await db.doc(`users/${doc.id}`).update({
        dataExportStatus: 'expired',
        dataExportR2Key: null,
      });
      expired++;
    } catch (err) {
      log.error('cron', 'Failed to expire data export', {
        uniqueId: doc.id,
        error: err.message,
      });
    }
  }

  if (expired > 0) {
    log.info('cron', `Expired ${expired} data exports`);
  }
}

module.exports = expireDataExports;
