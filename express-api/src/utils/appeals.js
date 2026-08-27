/**
 * Suspension appeals — one schema, written in one place (SHY-0463).
 *
 * Two routes accept an appeal: `POST /api/users/:uniqueId/appeal`, which the
 * app calls, and `POST /api/appeals`, which the web and admin tooling call.
 * They used to write the SAME collection with different shapes and disagree
 * about what "already pending" meant, and both halves of that disagreement
 * cost a suspended person the right to answer an accusation:
 *
 *   - the app's route wrote `uniqueId` (a String from the route param) where
 *     every reader looks for `userId` (a Number), so an appeal from the phone
 *     reached the moderation queue with no user attached to it; and
 *   - it decided "already pending" from a flag on the user document that only
 *     one of the three suspension-ending writers clears, so after a single
 *     appeal every LATER suspension was refused 409 for ever.
 *
 * The schema and the duplicate check therefore live here rather than in either
 * route. Two routes stating the same fact is how they came to disagree.
 */

const { db } = require('./firebase');
const { generateId, now } = require('./helpers');
const { queryDocs } = require('./firestore-helpers');

/** The collection both routes write. */
const APPEALS_COLLECTION = 'suspensionAppeals';

/**
 * Normalise an owner id to the type every reader compares against.
 *
 * `req.auth.uniqueId` is a Number and `req.params.uniqueId` is a String, so
 * the two callers arrive with different types for the same person. Firestore
 * equality is typed: a String owner id matches nothing, while still looking
 * present in the admin console.
 */
function toOwnerId(uniqueId) {
  const id = Number(uniqueId);
  if (!Number.isInteger(id)) {
    // Explicit, for the reason `requireOwner` gives (Audit L1): `Number()` on a
    // non-numeric value yields NaN silently, and `userId: NaN` would land in
    // Firestore as a row that looks present in the admin console and matches
    // no query ever again — the precise failure this ticket exists to end.
    throw new Error(`appeal owner id must be an integer, received: ${uniqueId}`);
  }
  return id;
}

/**
 * The pending appeal for this person, or null.
 *
 * Read from the appeals collection, never from a flag on the user document:
 * an appeal that has been resolved or deleted stops blocking the next one,
 * which is the behaviour "already pending" is supposed to describe.
 */
async function findPendingAppeal(uniqueId) {
  // `queryDocs` rather than a raw `.get()`: it is how the rest of these routes
  // read Firestore, and it is the seam the existing suites already stand on.
  const rows = await queryDocs(
    db
      .collection(APPEALS_COLLECTION)
      .where('userId', '==', toOwnerId(uniqueId))
      .where('status', '==', 'pending')
      .limit(1),
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Record an appeal and mark the user doc as having one pending.
 *
 * `suspensionAppealStatus` is still written — the app renders it and the admin
 * review route updates it — but nothing GATES on it any more. It is a display
 * mirror of the collection, not a second source of truth.
 */
async function createAppeal({ uniqueId, appealText }) {
  const userId = toOwnerId(uniqueId);
  const appealId = generateId();
  await Promise.all([
    db.doc(`${APPEALS_COLLECTION}/${appealId}`).set(
      {
        userId,
        appealText,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now(),
      },
      { merge: true },
    ),
    db.doc(`users/${userId}`).update({ suspensionAppealStatus: 'pending' }),
  ]);
  return appealId;
}

module.exports = { APPEALS_COLLECTION, toOwnerId, findPendingAppeal, createAppeal };
