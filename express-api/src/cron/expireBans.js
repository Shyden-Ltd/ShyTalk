/**
 * Cron job: expire bans whose expiresAt has passed.
 *
 * Queries deviceBans and networkBans for docs with a non-null expiresAt
 * that is in the past, deletes them via batch writes, and optionally
 * notifies admin via FCM using the shared utility.
 */

const { db } = require('../utils/firebase');
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');
const log = require('../utils/log');

async function expireBans() {
  const nowIso = new Date().toISOString();

  // Query expired device bans
  const deviceSnap = await db.collection('deviceBans').where('expiresAt', '!=', null).get();

  const expiredDeviceDocs = deviceSnap.docs.filter((d) => {
    const expiresAt = d.data().expiresAt;
    return expiresAt && expiresAt < nowIso;
  });

  // Query expired network bans
  const networkSnap = await db.collection('networkBans').where('expiresAt', '!=', null).get();

  const expiredNetworkDocs = networkSnap.docs.filter((d) => {
    const expiresAt = d.data().expiresAt;
    return expiresAt && expiresAt < nowIso;
  });

  const allExpired = [...expiredDeviceDocs, ...expiredNetworkDocs];

  if (allExpired.length === 0) {
    log.info('cron', 'expireBans: no expired bans');
    return;
  }

  // Batch delete expired bans (max 500 per batch)
  for (let i = 0; i < allExpired.length; i += 500) {
    const batch = db.batch();
    const chunk = allExpired.slice(i, i + 500);
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  const removed = allExpired.length;
  log.info('cron', 'expireBans: removed expired bans', { count: removed });

  // Notify admin users via FCM
  try {
    const configSnap = await db.doc('alertConfig/settings').get();
    if (!configSnap.exists) return;

    const config = configSnap.data();
    const recipientUserIds = config.fcmRecipientUserIds || [];
    if (recipientUserIds.length === 0) return;

    for (const userId of recipientUserIds) {
      const userSnap = await db.doc(`users/${userId}`).get();
      if (!userSnap.exists) continue;
      const userData = userSnap.data();
      const fcmTokens = userData.fcmTokens || [];
      if (fcmTokens.length === 0) continue;

      const invalidTokens = await sendFcmToTokens(fcmTokens, {
        type: 'admin_notification',
        title: 'Bans Expired',
        body: `${removed} ban(s) have expired and been removed.`,
      });
      await cleanupInvalidTokens(invalidTokens, userId);
    }
  } catch (err) {
    log.error('cron', 'expireBans notification error', { error: err.message });
  }
}

module.exports = expireBans;
