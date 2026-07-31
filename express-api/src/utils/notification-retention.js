/**
 * Notification deduplication + retention — SHY-0258.
 *
 * The inbox had no lifecycle at all: every dispatch appended a row, nothing
 * was ever removed, and a repeated event produced a repeated notification. A
 * user who watched a busy suggestion accumulated duplicates indefinitely, and
 * the inbox query paid for every one of them forever.
 *
 * Three rules, all enforced here so the policy lives in ONE place rather than
 * being re-derived at each call site:
 *
 *  1. DEDUP — the same event for the same person inside a short window
 *     produces one notification. "Same event" is a `dedupeKey` derived from
 *     the recipient, the notification type and the thing it is about; two
 *     genuinely different events (an approval and a later reversal) differ in
 *     type and are therefore both delivered.
 *  2. CAP — at most MAX_NOTIFICATIONS_PER_USER rows per person; the oldest
 *     are removed once the cap is exceeded.
 *  3. TTL — rows older than NOTIFICATION_TTL_MS are removed.
 *
 * TTL and cap are enforced LAZILY at write time, not by a scheduled job. That
 * is the house architecture (see the cron-elimination note in CLAUDE.md):
 * crons cost free-tier quota, and this work is only ever needed for a user who
 * is actively receiving notifications — precisely the moment we are already
 * writing to their inbox.
 *
 * Reads deliberately avoid `orderBy('createdAt')`. A Firestore `orderBy`
 * silently EXCLUDES documents that lack the ordered field, so ordering the
 * query would make legacy rows written without `createdAt` invisible to the
 * reaper — they would be immortal, and the cap would be enforced against a
 * miscounted total. Rows are fetched under a bounded cap and ordered in
 * memory, where a missing timestamp can be handled explicitly instead of
 * disappearing.
 */

const log = require('./log');

/** Maximum notifications retained per recipient. */
const MAX_NOTIFICATIONS_PER_USER = 200;

/** Notifications older than this are reaped. */
const NOTIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** Two identical events inside this window collapse into one notification. */
const DEDUP_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * How many rows the reaper will read in one pass. Comfortably above the cap so
 * a backlog is drained rather than nibbled, but bounded — an unbounded read
 * against an inbox that has grown pathologically is exactly how a "cleanup"
 * turns into an outage.
 */
const RETENTION_SCAN_CAP = 500;

/**
 * Identity of an event for deduplication purposes.
 *
 * Includes `type`, so an approval followed by a reversal remains two
 * notifications; includes `relatedId`, so updates about two different
 * suggestions never collapse into one.
 */
function dedupeKeyFor({ uid, type, relatedId }) {
  return [String(uid ?? ''), String(type ?? ''), String(relatedId ?? '')].join('|');
}

/**
 * Timestamp of a notification, or 0 when it carries none.
 *
 * 0 sorts oldest, so an undated legacy row is reaped ahead of dated ones
 * rather than being treated as brand new and pinned at the top of the inbox
 * forever.
 */
function notificationTime(data) {
  const t = data?.createdAt;
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}

/**
 * Has an identical notification already been written for this recipient inside
 * the dedup window?
 *
 * Equality-only query (no range, no ordering) so it needs no composite index
 * and cannot silently drop rows; the window is applied in memory.
 *
 * Fails OPEN — a read error resolves to `false` (not a duplicate). Losing a
 * notification because the dedup check was unavailable is worse than showing
 * one twice: the duplicate is visible and self-correcting, the omission is
 * neither.
 */
async function isDuplicateNotification(db, notif, nowMs, windowMs = DEDUP_WINDOW_MS) {
  const { uid } = notif || {};
  if (!uid) return false;
  const key = dedupeKeyFor(notif);
  try {
    const snap = await db
      .collection('notifications')
      .where('uid', '==', uid)
      .where('dedupeKey', '==', key)
      .limit(RETENTION_SCAN_CAP)
      .get();
    if (snap.empty) return false;
    return snap.docs.some((d) => nowMs - notificationTime(d.data()) < windowMs);
  } catch (err) {
    log.error('notification-retention', 'Dedup check failed — treating as not duplicate', {
      uid,
      error: err.message,
    });
    return false;
  }
}

/**
 * Reap expired notifications and trim the recipient's inbox to the cap.
 *
 * Returns a summary of what was removed so callers (and tests) can assert the
 * work actually happened rather than inferring it from a silent resolve.
 *
 * Never throws: retention is housekeeping attached to a delivery, and a
 * failure to tidy up must not fail the notification the user is waiting for.
 */
async function enforceRetention(db, uid, nowMs, options = {}) {
  const max = options.max ?? MAX_NOTIFICATIONS_PER_USER;
  const ttlMs = options.ttlMs ?? NOTIFICATION_TTL_MS;
  const summary = { expired: 0, trimmed: 0, remaining: 0 };
  if (!uid) return summary;

  try {
    const snap = await db
      .collection('notifications')
      .where('uid', '==', uid)
      .limit(RETENTION_SCAN_CAP)
      .get();
    if (snap.empty) return summary;

    const rows = snap.docs.map((d) => ({ ref: d.ref, at: notificationTime(d.data()) }));
    const cutoff = nowMs - ttlMs;

    const expired = rows.filter((r) => r.at < cutoff);
    const live = rows.filter((r) => r.at >= cutoff);

    // Newest first, so everything beyond the cap is the oldest tail.
    live.sort((a, b) => b.at - a.at);
    const overflow = live.slice(max);

    const doomed = [...expired, ...overflow];
    if (doomed.length === 0) {
      summary.remaining = live.length;
      return summary;
    }

    await Promise.all(doomed.map((r) => r.ref.delete()));

    summary.expired = expired.length;
    summary.trimmed = overflow.length;
    summary.remaining = live.length - overflow.length;
    return summary;
  } catch (err) {
    log.error('notification-retention', 'Retention pass failed', { uid, error: err.message });
    return summary;
  }
}

module.exports = {
  MAX_NOTIFICATIONS_PER_USER,
  NOTIFICATION_TTL_MS,
  DEDUP_WINDOW_MS,
  RETENTION_SCAN_CAP,
  dedupeKeyFor,
  notificationTime,
  isDuplicateNotification,
  enforceRetention,
};
