/**
 * Admin alert for a newly submitted suggestion — SHY-0258.
 *
 * Kept out of routes/suggestions.js so the fan-out can be tested directly
 * rather than only through a route, and so the "who is an admin" question has
 * exactly one answer (utils/admin-directory.js) instead of being re-derived at
 * each call site.
 */

const { listAdminUniqueIds } = require('./admin-directory');
const { isLiveAdmin } = require('../middleware/auth');
const { dispatchNotificationInline } = require('./notification-channels');
const log = require('./log');

/** Longest submitter summary we will put in a notification body. */
const SUMMARY_TITLE_CAP = 80;

/**
 * A one-line description of who submitted, for the admin's inbox.
 *
 * Deliberately just the submitter's uniqueId and the suggestion title. An
 * admin needs enough to decide whether to look, and no more: this row lands in
 * a notification store with a 90-day retention and no access controls beyond
 * the recipient, so it is the wrong place to copy personal details into.
 */
function submitterSummary(title, submitterUniqueId) {
  const trimmed = String(title ?? '').slice(0, SUMMARY_TITLE_CAP);
  return `New suggestion from user ${submitterUniqueId}: "${trimmed}"`;
}

/**
 * Notify every current admin that a suggestion is awaiting review.
 *
 * Never throws — this runs fire-and-forget behind a 201 that has already been
 * decided. Returns the number of admins notified so callers and tests can
 * assert the work happened rather than trusting a silent resolve.
 */
async function notifyAdminsOfNewSuggestion({ id, title, submitterUniqueId }) {
  try {
    const adminUniqueIds = await listAdminUniqueIds(isLiveAdmin);
    if (adminUniqueIds.length === 0) return 0;

    const body = submitterSummary(title, submitterUniqueId);
    const results = await Promise.allSettled(
      adminUniqueIds
        // An admin who submits a suggestion does not need to be told about it.
        .filter((uid) => String(uid) !== String(submitterUniqueId))
        .map((uid) =>
          dispatchNotificationInline({
            type: 'admin_new_suggestion',
            uid,
            title: 'Suggestion awaiting review',
            body,
            relatedId: id,
            // In-app only. An admin alert is a queue indicator, not something
            // worth an email or a push at 3am for every submission.
            channels: { inApp: true, email: false, push: false, systemMessage: false },
            email: null,
            pushToken: null,
          }),
        ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    if (sent !== results.length) {
      log.error('admin-suggestion-notify', 'Some admin notifications failed', {
        id,
        attempted: results.length,
        sent,
      });
    }
    return sent;
  } catch (err) {
    log.error('admin-suggestion-notify', 'Admin fan-out failed', { id, error: err.message });
    return 0;
  }
}

module.exports = { notifyAdminsOfNewSuggestion, submitterSummary, SUMMARY_TITLE_CAP };
