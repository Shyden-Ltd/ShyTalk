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

/**
 * Every key any ticket currently carries. Read fresh — never cached.
 *
 * Also reports how many tickets LOOK like they carry something, which is what
 * makes the guard below possible: a reader that has drifted from the stored
 * shape returns an empty set from a corpus that is plainly not empty.
 */
async function referencedAttachmentKeys() {
  const snap = await db.collection(COLLECTION).get();
  const keys = new Set();
  let ticketsWithAttachments = 0;
  snap.docs.forEach((d) => {
    const data = d.data();
    if (Array.isArray(data.attachments) && data.attachments.length > 0) ticketsWithAttachments += 1;
    attachmentKeysOf(data).forEach((k) => keys.add(k));
  });
  keys.ticketsWithAttachments = ticketsWithAttachments;
  return keys;
}

/**
 * Refuse the sweep when the set of keys in use cannot be trusted.
 *
 * If tickets carry attachments and NOTHING is referenced, the reader and the
 * stored shape have drifted apart — which is exactly what happened once, when
 * `attachmentKeysOf` read `a.r2Key` against documents holding a bare list of
 * keys. Every support object past the grace window then looks abandoned,
 * including evidence on tickets that are still open.
 *
 * This does not need to know the cause. An unswept bucket costs storage; a
 * swept one costs somebody the evidence they sent while asking for help.
 */
function assertKeysInUseAreTrustworthy(keys) {
  if (keys.size === 0 && keys.ticketsWithAttachments > 0) {
    throw new Error(
      `Refusing to sweep: ${keys.ticketsWithAttachments} ticket(s) carry attachments but the ` +
        'set of keys in use came back empty, so every object would look abandoned.',
    );
  }
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
  assertKeysInUseAreTrustworthy(referenced);
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
  assertKeysInUseAreTrustworthy,
};
