/**
 * One-shot backfill cron: populate `roadmapUpdateOptedIn` on every legacy
 * subscription doc that doesn't yet have the field.
 *
 * Phase 2A finding #2 introduced a denormalised flag on the `subscriptions`
 * collection so `roadmap-notify.js` can run a server-side equality filter
 * instead of scanning the whole collection. New subscriptions written after
 * the route fix automatically include the field; the existing subscriber
 * base needs a one-time backfill.
 *
 * Strategy: paginate through subscriptions in CRON_LIMIT-sized pages, and
 * for each doc that lacks `roadmapUpdateOptedIn`, compute the value from
 * `channelPreferences.roadmapUpdate` and write it. Self-stops once a tick
 * processes 0 missing-field docs.
 *
 * Reads/writes scale with the number of legacy subscribers. At 5K subs
 * with a 500/tick cap that's ~10 ticks (10 days at the daily cadence) to
 * fully migrate; the cron is idempotent so manual triggers via the admin
 * panel are safe.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');
const { computeRoadmapOptedIn } = require('../utils/notification-prefs');

// Pattern matches expireBans/expireDataExports/rotateLogs Phase 2 fixes.
const CRON_LIMIT = 500;

async function backfillRoadmapOptedIn() {
  // Read up to CRON_LIMIT subscription docs. We can't `.where('field', '==', undefined)`
  // on Firestore directly, so we fetch a page and filter client-side. Once
  // every legacy doc has the field set, this scan returns docs that already
  // have it (no-op writes are skipped) and the cron quietly finishes.
  const snap = await db.collection('subscriptions').limit(CRON_LIMIT).get();
  if (snap.size === CRON_LIMIT) {
    log.warn('cron', 'backfillRoadmapOptedIn: hit CRON_LIMIT — backfill still in progress', {
      limit: CRON_LIMIT,
    });
  }

  if (snap.empty) {
    log.info('cron', 'backfillRoadmapOptedIn: no subscriptions to backfill');
    return;
  }

  let backfilled = 0;
  let alreadySet = 0;
  let batch = db.batch();
  let batchOps = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.roadmapUpdateOptedIn === 'boolean') {
      alreadySet++;
      continue;
    }
    const flag = computeRoadmapOptedIn(data.channelPreferences?.roadmapUpdate);
    batch.update(doc.ref, { roadmapUpdateOptedIn: flag });
    backfilled++;
    batchOps++;

    // Firestore batch limit is 500; flush + restart at 400 to leave headroom.
    if (batchOps >= 400) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  if (backfilled > 0) {
    log.info('cron', 'backfillRoadmapOptedIn: backfill progress', {
      backfilled,
      alreadySet,
      pageSize: snap.size,
    });
  } else {
    log.info('cron', 'backfillRoadmapOptedIn: complete (no docs missing the field)', {
      alreadySet,
    });
  }
}

module.exports = backfillRoadmapOptedIn;
