/**
 * Admin directory — SHY-0258.
 *
 * "Notify every admin when a suggestion is submitted" needs a set of admins,
 * and there wasn't one: admin status lives ONLY as a Firebase Auth custom
 * claim, granted outside the API (local/seed.js, or by hand in prod). Nothing
 * in Firestore records who the admins are, and enumerating them per submission
 * would mean paginating `auth.listUsers()` over the whole user base — a cost
 * that grows with the product's success, on a free tier.
 *
 * So the directory is built from traffic instead of from a scan: every time
 * the auth middleware verifies a LIVE admin claim, that admin is recorded here.
 * No backfill script, nothing to run against production, and it self-heals — an
 * admin who uses the panel is, by definition, in the directory before they
 * could expect a notification from it.
 *
 * The directory is a CANDIDATE list, never an authority. A demotion is a claim
 * change that this module cannot observe (we deliberately do not issue a delete
 * on every non-admin request — that would be a write per request), so
 * `listAdminUniqueIds` re-verifies each candidate against the live claim before
 * returning it. Stale rows are therefore harmless: they cost one verification
 * and are then dropped. Getting this backwards — trusting the directory and
 * skipping the check — would keep notifying someone whose admin rights were
 * revoked, which is exactly the failure mode the live-claim check elsewhere in
 * this codebase exists to prevent.
 */

const { db } = require('./firebase');
const log = require('./log');

const ADMIN_COLLECTION = 'admins';

/**
 * Bound on how many candidates are considered. Admin populations are tiny; a
 * number far above the plausible count keeps a corrupt collection from turning
 * one suggestion into an unbounded fan-out.
 */
const MAX_ADMIN_CANDIDATES = 200;

/**
 * Record a verified admin.
 *
 * Fire-and-forget by contract: this runs on the authentication path, and a
 * bookkeeping write must never be able to fail a request or slow it down.
 * Returns a boolean so tests can assert the write happened rather than
 * inferring it.
 */
async function recordAdmin(uid, uniqueId) {
  if (!uid) return false;
  try {
    await db
      .collection(ADMIN_COLLECTION)
      .doc(String(uid))
      .set(
        { uid: String(uid), uniqueId: uniqueId ?? null, lastSeenAt: Date.now() },
        { merge: true },
      );
    return true;
  } catch (err) {
    log.error('admin-directory', 'Failed to record admin', { uid, error: err.message });
    return false;
  }
}

/** Drop a candidate — used when a re-verification shows they are no longer an admin. */
async function forgetAdmin(uid) {
  if (!uid) return false;
  try {
    await db.collection(ADMIN_COLLECTION).doc(String(uid)).delete();
    return true;
  } catch (err) {
    log.error('admin-directory', 'Failed to forget admin', { uid, error: err.message });
    return false;
  }
}

/**
 * Current admins, as the uniqueIds the notification inbox is keyed by.
 *
 * @param {(uid: string) => Promise<boolean>} verifyIsAdmin - live claim check;
 *   injected rather than imported to avoid a cycle with the auth middleware,
 *   which is what populates this directory in the first place.
 */
async function listAdminUniqueIds(verifyIsAdmin) {
  try {
    const snap = await db.collection(ADMIN_COLLECTION).limit(MAX_ADMIN_CANDIDATES).get();
    if (snap.empty) return [];

    const confirmed = [];
    for (const doc of snap.docs) {
      const { uid, uniqueId } = doc.data() || {};
      if (!uid || uniqueId === null || uniqueId === undefined) continue;

      // The live claim decides. A candidate who has since been demoted is
      // dropped from the directory here, so the stale row costs one check once
      // rather than notifications forever.
      let stillAdmin = true;
      if (typeof verifyIsAdmin === 'function') {
        try {
          stillAdmin = await verifyIsAdmin(uid);
        } catch (err) {
          // A verification outage must not silently widen the audience.
          log.error('admin-directory', 'Admin re-verification failed — skipping candidate', {
            uid,
            error: err.message,
          });
          stillAdmin = false;
        }
      }

      if (stillAdmin) confirmed.push(uniqueId);
      else await forgetAdmin(uid);
    }
    return confirmed;
  } catch (err) {
    log.error('admin-directory', 'Failed to list admins', { error: err.message });
    return [];
  }
}

module.exports = {
  ADMIN_COLLECTION,
  MAX_ADMIN_CANDIDATES,
  recordAdmin,
  forgetAdmin,
  listAdminUniqueIds,
};
