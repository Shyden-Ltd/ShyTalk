/**
 * Cron: Expire SuperShy subscriptions.
 *
 * Queries users with isSuperShy==true and superShyExpiry <= now,
 * filters out lifetime subscribers, then batch-updates to remove SuperShy status.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

async function subscriptions() {
  const timestamp = Date.now();

  const snapshot = await db
    .collection('users')
    .where('isSuperShy', '==', true)
    .where('superShyExpiry', '<=', timestamp)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  // Filter out lifetime subscribers client-side
  const toExpire = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.superShyTier !== 'lifetime');

  if (toExpire.length === 0) return;

  // Batch update in chunks of 500
  for (let i = 0; i < toExpire.length; i += 500) {
    const batch = db.batch();
    const chunk = toExpire.slice(i, i + 500);

    for (const user of chunk) {
      batch.update(db.doc(`users/${user.id}`), {
        isSuperShy: false,
        superShyExpiry: null,
        superShyTier: null,
      });
    }

    await batch.commit();
  }

  log.info('cron', 'subscriptions: expired Super Shy subscriptions', { count: toExpire.length });
}

module.exports = subscriptions;
