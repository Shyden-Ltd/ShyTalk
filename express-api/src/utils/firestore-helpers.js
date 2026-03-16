/**
 * Shared Firestore helper functions.
 *
 * Extracted from users.js, reports.js, banners.js, config.js, etc. to eliminate duplication.
 */

const { db } = require('./firebase');

/**
 * Get a single Firestore document by path.
 * Returns { id, ...data } or null if the document doesn't exist.
 */
async function getDoc(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Execute a Firestore query reference and return all matching documents
 * as an array of { id, ...data } objects.
 */
async function queryDocs(ref) {
  const snap = await ref.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = { getDoc, queryDocs };
