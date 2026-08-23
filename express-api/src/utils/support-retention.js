/**
 * When a support ticket's data stops being ours to keep (SHY-0436, SHY-0435).
 *
 * Support tickets carry more personal data than almost anything else in
 * ShyTalk: free text somebody wrote while upset, screenshots of private
 * conversations, photographs and video OF OTHER PEOPLE, and account or payment
 * details they were asked to evidence. Keeping that after the reason for
 * holding it has ended is exactly what storage limitation forbids.
 *
 * Two lifecycles end up here:
 *
 * - **A closed ticket** (SHY-0436). Seven days after closure, operator's
 *   decision — long enough for somebody to say "that did not actually fix it",
 *   short enough that a resolved matter stops being a standing store of other
 *   people's images.
 *
 * - **An abandoned upload** (SHY-0435). The bytes go up the MOMENT a file is
 *   picked, before Send. Somebody who attaches evidence and then backs out
 *   never removes anything, so the object stays with no ticket carrying its
 *   key — unreferenced, and therefore unreachable by any retention rule or
 *   erasure request. Abandonment is the MORE likely path: somebody upset
 *   enough to raise a safety report is exactly who may attach and think better
 *   of it.
 *
 * Pure. Every rule below is decided here and pinned without firebase or R2,
 * because a bug in this file deletes somebody's evidence.
 */

'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Operator's number, 2026-08-22: closed tickets go seven days after closure. */
const CLOSED_TICKET_RETENTION_MS = 7 * DAY_MS;

/**
 * How long an uploaded-but-unsent attachment survives.
 *
 * The form deliberately KEEPS attachments when somebody leaves, so returning
 * to a half-written request does not cost them their evidence — that behaviour
 * is right and this must not undo it. Three days is comfortably longer than an
 * interruption and far short of forever.
 */
const ABANDONED_UPLOAD_GRACE_MS = 3 * DAY_MS;

/** Every support attachment lives under this prefix, and nothing else does. */
const SUPPORT_PREFIX = 'support-tickets/';

const RESOLVED = 'resolved';

/** A usable epoch-millis timestamp, or null. Strings and Dates included. */
function asMillis(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return Number.isFinite(value) ? value : null;
}

/**
 * Which closed tickets are past their window.
 *
 * FAILS CLOSED throughout. A resolved ticket with no `resolvedAt` is KEPT:
 * treating a missing timestamp as "closed long ago" would delete somebody's
 * data because a field was absent. An OPEN ticket is never due however old —
 * age is not the trigger, and a request somebody is still waiting on is not
 * rubbish no matter how long we have taken over it.
 */
function closedTicketsDueForDeletion(tickets, now, retentionMs = CLOSED_TICKET_RETENTION_MS) {
  return (Array.isArray(tickets) ? tickets : []).filter((t) => {
    if (!t || typeof t !== 'object') return false;
    if (t.status !== RESOLVED) return false;
    const resolvedAt = asMillis(t.resolvedAt);
    if (resolvedAt === null) return false;
    return now - resolvedAt > retentionMs;
  });
}

/**
 * The R2 keys a ticket carries.
 *
 * Collected BEFORE the document is deleted: the ticket is the ONLY record of
 * which objects belong to it, so losing it first strands them permanently —
 * the same orphan class arrived at by a third route.
 */
function attachmentKeysOf(ticket) {
  const rows = ticket && Array.isArray(ticket.attachments) ? ticket.attachments : [];
  // Plain R2 keys, which is what `POST /support-tickets` writes. This read
  // `a.r2Key` until 2026-08-24 -- a shape the product has never produced. It
  // returned [] for every real ticket, so the sweep deleted no attachment and,
  // far worse, built an EMPTY set of keys-in-use, under which every support
  // object older than the grace window looks abandoned. Caught by SHY-0438
  // needing the same keys; the sweep had not yet run anywhere.
  return rows.filter((k) => typeof k === 'string' && k.length > 0);
}

/**
 * Which stored objects are abandoned uploads past their grace window.
 *
 * @param objects  listing rows: `{ key, lastModified }`
 * @param referencedKeys a Set of every key ANY ticket carries. An object in
 *   here is somebody's live evidence and is never touched — that is the whole
 *   safety of this sweep.
 */
function abandonedUploadsDueForDeletion(
  objects,
  referencedKeys,
  now,
  graceMs = ABANDONED_UPLOAD_GRACE_MS,
) {
  const referenced = referencedKeys instanceof Set ? referencedKeys : new Set(referencedKeys || []);
  return (Array.isArray(objects) ? objects : [])
    .filter((o) => {
      if (!o || typeof o.key !== 'string') return false;
      // Belt and braces on top of the caller's prefix: a bug there must not
      // let this reach avatars or room covers.
      if (!o.key.startsWith(SUPPORT_PREFIX)) return false;
      if (referenced.has(o.key)) return false;
      const modified = asMillis(o.lastModified);
      // No age means no evidence it is abandoned.
      if (modified === null) return false;
      return now - modified > graceMs;
    })
    .map((o) => o.key);
}

module.exports = {
  DAY_MS,
  CLOSED_TICKET_RETENTION_MS,
  ABANDONED_UPLOAD_GRACE_MS,
  SUPPORT_PREFIX,
  closedTicketsDueForDeletion,
  attachmentKeysOf,
  abandonedUploadsDueForDeletion,
};
