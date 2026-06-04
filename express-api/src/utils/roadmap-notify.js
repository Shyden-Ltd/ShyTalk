/**
 * Roadmap update notification trigger.
 *
 * Queries all subscribers who opted into roadmapUpdate notifications,
 * then dispatches notifications INLINE per subscriber via
 * `dispatchNotificationInline`. No persistent queue, no cron.
 *
 * Fire-and-forget at the route layer (callers in routes/suggestions.js
 * already use `.catch(...)` and don't await this function), so the
 * admin HTTP response returns immediately while dispatch fans out.
 */

const { db } = require('./firebase');
const { dispatchNotificationInline } = require('./notification-channels');
const log = require('./log');

/**
 * Notify all roadmapUpdate subscribers about a roadmap change.
 *
 * @param {string} message - Description of what changed (shown to users)
 */
async function notifyRoadmapSubscribers(message) {
  try {
    // Server-side filter on the denormalised `roadmapUpdateOptedIn` flag.
    // A full-collection scan would cost a read per subscriber every
    // roadmap edit; the flag is maintained on every PUT /subscriptions/me.
    const snap = await db
      .collection('subscriptions')
      .where('roadmapUpdateOptedIn', '==', true)
      .get();

    if (snap.empty) return;

    // Dispatch in parallel per subscriber. Each dispatch is wrapped in
    // its own try/catch inside `dispatchNotificationInline`, so a
    // per-subscriber failure is contained — Promise.allSettled prevents
    // one rejected promise from cancelling the whole fan-out.
    const dispatches = [];
    for (const doc of snap.docs) {
      const sub = doc.data();
      const prefs = sub.channelPreferences?.roadmapUpdate;

      // Defensive double-check: if the denormalised flag drifted from
      // the actual prefs (race between PUT and notify), trust the prefs.
      if (!prefs) continue;
      const hasAnyChannel = prefs.email || prefs.push || prefs.inApp || prefs.systemMessage;
      if (!hasAnyChannel) continue;

      dispatches.push(
        dispatchNotificationInline({
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
        }),
      );
    }

    if (dispatches.length === 0) return;

    const settled = await Promise.allSettled(dispatches);
    const sent = settled.filter((r) => r.status === 'fulfilled').length;
    const failed = settled.length - sent;
    log.info('roadmap-notify', `Dispatched ${sent} roadmap notifications inline (${failed} threw)`);
  } catch (err) {
    log.error('roadmap-notify', 'Failed to notify roadmap subscribers', {
      error: err.message,
    });
  }
}

module.exports = { notifyRoadmapSubscribers };
