/**
 * Cron: support-ticket retention (SHY-0436, SHY-0435).
 *
 * Two sweeps that must run in this ORDER, because the second depends on what
 * the first leaves behind:
 *
 *   1. Delete tickets closed longer ago than the retention window, taking
 *      their attachments with them. The ticket is the ONLY record of which
 *      objects belong to it, so the keys are collected BEFORE the document is
 *      removed — losing the document first strands its objects permanently.
 *
 *   2. Delete stored attachments that no ticket references and that are older
 *      than the grace window: bytes uploaded when a file was PICKED, by
 *      somebody who then backed out and never sent. Unreferenced, and so
 *      unreachable by any retention rule or erasure request.
 *
 * Running (2) after (1) means the objects (1) just orphaned are ALREADY gone,
 * and the reference set is read fresh in between, so nothing live is at risk
 * from the ordering.
 *
 * The decisions themselves live in utils/support-retention.js and are pinned
 * there without firebase or R2, because a bug in them deletes somebody's
 * evidence.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');
const {
  SUPPORT_PREFIX,
  closedTicketsDueForDeletion,
  attachmentKeysOf,
  abandonedUploadsDueForDeletion,
} = require('../utils/support-retention');

const COLLECTION = 'supportTickets';

/** Every key any ticket currently carries. Read fresh — never cached. */
async function referencedAttachmentKeys() {
  const snap = await db.collection(COLLECTION).get();
  const keys = new Set();
  snap.docs.forEach((d) => attachmentKeysOf(d.data()).forEach((k) => keys.add(k)));
  return keys;
}

/** Step 1: closed tickets past their window, and their attachments. */
async function deleteExpiredClosedTickets(now = Date.now()) {
  const snap = await db.collection(COLLECTION).where('status', '==', 'resolved').get();
  const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const due = closedTicketsDueForDeletion(rows, now);
  if (due.length === 0) return { tickets: 0, attachments: 0 };

  // Keys FIRST. The document is the only record of them.
  const keys = due.flatMap((t) => attachmentKeysOf(t));
  if (keys.length > 0) await r2.deleteObjects(keys);

  for (const t of due) {
    await db.doc(`${COLLECTION}/${t.id}`).delete();
  }

  log.info('support-retention', 'Deleted closed tickets past their retention window', {
    tickets: due.length,
    attachments: keys.length,
  });
  return { tickets: due.length, attachments: keys.length };
}

/** Step 2: uploads nobody ever sent, past the grace window. */
async function deleteAbandonedUploads(now = Date.now()) {
  const referenced = await referencedAttachmentKeys();
  const listed = await r2.listObjectsWithMetadata(SUPPORT_PREFIX);
  const due = abandonedUploadsDueForDeletion(listed, referenced, now);
  if (due.length === 0) return { objects: 0 };

  await r2.deleteObjects(due);
  log.info('support-retention', 'Deleted abandoned support uploads', { objects: due.length });
  return { objects: due.length };
}

/**
 * The whole sweep. Also clears the backlog: every attachment ever picked and
 * not sent, from before either ticket existed, is unreferenced and older than
 * the grace window, so the first run collects them all.
 */
async function sweepSupportRetention(now = Date.now()) {
  const closed = await deleteExpiredClosedTickets(now);
  const abandoned = await deleteAbandonedUploads(now);
  return { ...closed, abandonedObjects: abandoned.objects };
}

module.exports = {
  sweepSupportRetention,
  deleteExpiredClosedTickets,
  deleteAbandonedUploads,
  referencedAttachmentKeys,
};
