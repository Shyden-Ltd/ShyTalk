/**
 * Shared helpers for notification preferences. Lives in `utils/` (no
 * Firebase dependencies) so cron jobs and routes can both import without
 * triggering the firebase-admin init side-effect.
 *
 * Phase 2A finding #2 introduced the denormalised `roadmapUpdateOptedIn`
 * flag — `routes/subscriptions.js` writes it on every PUT and
 * `utils/roadmap-notify.js` reads via a server-side equality filter.
 * Legacy docs were one-time-migrated by a self-stopping cron (removed
 * 2026-06 after every doc had the field). Consolidating the
 * computation here prevents drift between the write and read sites.
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
