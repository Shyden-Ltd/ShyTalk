/**
 * Shared Firestore helper functions.
 *
 * Extracted from users.js, reports.js, banners.js, config.js, etc. to
 * eliminate duplication.
 *
 * Spread-order invariant (`getDoc` and `queryDocs`): the payload is spread
 * BEFORE the trusted `id` so a legacy or adversarially-shaped `id` field on
 * the doc body cannot override the storage-layer key. See the "spread-order
 * safety" tests in firestore-helpers.test.js for the failing-without-the-fix
 * proof.
 */

const { db } = require('./firebase');

async function getDoc(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

async function queryDocs(ref) {
  const snap = await ref.get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

module.exports = { getDoc, queryDocs };
