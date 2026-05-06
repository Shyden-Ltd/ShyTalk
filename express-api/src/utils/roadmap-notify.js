/**
 * Roadmap update notification trigger.
 *
 * Queries all subscribers who opted into roadmapUpdate notifications,
 * then creates notification queue entries for dispatch via the
 * notification-dispatch cron job.
 */

const { db } = require('./firebase');
const log = require('./log');
const { now } = require('./helpers');

const BATCH_LIMIT = 400;

/**
 * Notify all roadmapUpdate subscribers about a roadmap change.
 *
 * @param {string} message - Description of what changed (shown to users)
 */
async function notifyRoadmapSubscribers(message) {
  try {
    // Server-side filter on the denormalised `roadmapUpdateOptedIn` flag
    // (Phase 2A finding #2). The previous full-collection scan was a
    // quota grenade — at 5K subs every roadmap edit cost 5K reads
    // regardless of how few opted in. The flag is maintained on every
    // PUT /subscriptions/me and backfilled by the
    // `backfillRoadmapOptedIn` cron for legacy subs.
    const snap = await db
      .collection('subscriptions')
      .where('roadmapUpdateOptedIn', '==', true)
      .get();

    if (snap.empty) return;

    let batch = db.batch();
    let batchCount = 0;
    let total = 0;

    for (const doc of snap.docs) {
      const sub = doc.data();
      const prefs = sub.channelPreferences?.roadmapUpdate;

      // Defensive double-check: if the denormalised flag drifted from
      // the actual prefs (race between PUT and notify), trust the prefs.
      // Drift recovers on the next PUT — log and skip this tick.
      if (!prefs) continue;
      const hasAnyChannel = prefs.email || prefs.push || prefs.inApp || prefs.systemMessage;
      if (!hasAnyChannel) continue;

      const notifRef = db.collection('notificationQueue').doc();
      batch.set(notifRef, {
        type: 'roadmapUpdate',
        uid: sub.uid || doc.id,
        title: 'Roadmap Update',
        body: message,
        channels: {
          email: !!prefs.email,
          push: !!prefs.push,
          inApp: !!prefs.inApp,
          systemMessage: !!prefs.systemMessage,
        },
        email: sub.email || null,
        pushToken: sub.pushToken || null,
        status: 'queued',
        createdAt: now(),
      });
      batchCount++;
      total++;

      if (batchCount === BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    if (total > 0) {
      log.info('roadmap-notify', `Queued ${total} roadmap update notifications`);
    }
  } catch (err) {
    log.error('roadmap-notify', 'Failed to notify roadmap subscribers', {
      error: err.message,
    });
  }
}

module.exports = { notifyRoadmapSubscribers };
