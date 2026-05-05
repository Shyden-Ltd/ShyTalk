/**
 * Cron: Expire SuperShy subscriptions.
 *
 * Queries users with isSuperShy==true and superShyExpiry <= now,
 * filters out lifetime subscribers, then batch-updates to remove SuperShy status.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

// Cap matches Firestore batch limit (500) AND keeps Spark-tier read
// budget bounded per cron run. If more than CRON_LIMIT subscriptions
// expire on the same day, the cron loops on subsequent invocations
// until cleared. This is correct for daily cron cadence: the worst-
// case lag is 24h × ceil(N / CRON_LIMIT). At 1000 expirations / day
// = 2-day clear time, well within tolerance.
const CRON_LIMIT = 500;

async function subscriptions() {
  const timestamp = Date.now();

  const snapshot = await db
    .collection('users')
    .where('isSuperShy', '==', true)
    .where('superShyExpiry', '<=', timestamp)
    .limit(CRON_LIMIT)
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

  // Truncation warning: when toExpire.length === CRON_LIMIT we may
  // have missed expirations beyond the limit. Pre-fix the cron silently
  // ran another day before catching them, leaving 501+ users with
  // wrongly-active SuperShy status for an extra 24h. Audit M2
  // (Phase 2A): operator now sees the warning and can investigate.
  //
  // Note: we compare against `snapshot.size` (the raw query result)
  // rather than `toExpire.length` because the lifetime-tier filter is
  // post-query. If 500 lifetime users expired on the same day, the
  // query hit the limit but toExpire would be 0 — still worth warning.
  if (snapshot.size === CRON_LIMIT) {
    log.warn('cron', 'subscriptions: query hit CRON_LIMIT — possible truncation', {
      limit: CRON_LIMIT,
      processed: toExpire.length,
      lifetimeFiltered: snapshot.size - toExpire.length,
    });
  }

  log.info('cron', 'subscriptions: expired Super Shy subscriptions', { count: toExpire.length });
}

module.exports = subscriptions;
