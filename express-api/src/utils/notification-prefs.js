/**
 * Shared helpers for notification preferences. Lives in `utils/` (no
 * Firebase dependencies) so cron jobs and routes can both import without
 * triggering the firebase-admin init side-effect.
 *
 * Phase 2A finding #2 introduced the denormalised `roadmapUpdateOptedIn`
 * flag — `routes/subscriptions.js` writes it on every PUT, the
 * `backfillRoadmapOptedIn` cron migrates legacy docs, and
 * `utils/roadmap-notify.js` reads via a server-side equality filter.
 * Consolidating the computation here prevents drift between those three
 * sites.
 */

/**
 * Compute the bulk roadmap-update opt-in flag from a user's per-event
 * preference object. Returns `true` if ANY channel is enabled.
 *
 * @param {object|undefined} prefs `subscription.channelPreferences.roadmapUpdate`
 */
function computeRoadmapOptedIn(prefs) {
  if (!prefs) return false;
  return Boolean(prefs.email || prefs.push || prefs.inApp || prefs.systemMessage);
}

module.exports = { computeRoadmapOptedIn };
