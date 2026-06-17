/**
 * Real-auth test helper (EPIC-0003).
 *
 * Mints a REAL Firebase ID token via the Auth emulator and seeds the real
 * `users` doc the auth middleware resolves identity + suspension from, so
 * route tests exercise the REAL `authMiddleware` (verifyIdToken → uniqueId
 * lookup → suspension → req.auth) — never a faked `req.auth` injection or a
 * `synthetic:` bypass token. Operator directive 2026-06-17: "real now and in
 * the future" (see memory feedback-real-auth-in-integration-tests).
 *
 * The real chain (src/middleware/auth.js):
 *   verifyIdToken(idToken) -> uid
 *   users where firebaseUid == uid  -> uniqueId   (Firestore)
 *   users/{uniqueId}.isSuspended    -> suspension (Firestore)
 *   req.auth = { uid, uniqueId, token: decoded }
 * `cohort`/`admin` ride on the ID token as developer claims; `uniqueId` is a
 * Firestore lookup. So a real-auth caller needs BOTH a real token AND a seeded
 * users doc.
 *
 * Requires NODE_ENV=local (firebase.js points the Admin SDK + Auth emulator at
 * localhost). Requiring this helper AFTER firebase has configured the emulator
 * is the caller's responsibility (set NODE_ENV=local first, then require).
 */

const { auth, db } = require('../../src/utils/firebase');
const {
  clearUniqueIdCache,
  clearSuspensionCache,
  clearAdminClaimCache,
} = require('../../src/middleware/auth');

// Monotonic counter for unique synthetic uids (avoids a flagged Math.random PRNG).
let noUserDocSeq = 0;

/** Clear the auth middleware's in-memory caches — call in beforeEach for isolation. */
function clearAuthCaches() {
  clearUniqueIdCache();
  clearSuspensionCache();
  clearAdminClaimCache();
}

async function exchangeCustomTokenForIdToken(customToken) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-emulator-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Auth emulator token exchange failed: ${JSON.stringify(data.error || data)}`);
  }
  return data.idToken;
}

/**
 * Provision a real user (seed users doc) + mint a real Bearer ID token whose
 * decoded claims carry cohort/admin. Returns the token + an Authorization
 * header ready for supertest `.set(headers)`.
 *
 * @param {object} opts
 * @param {number|string} opts.uniqueId  stable uniqueId (REQUIRED) — seeded into users/{uniqueId}
 * @param {string} [opts.cohort]         'adult' | 'minor' — token developer claim
 * @param {boolean} [opts.admin=false]   admin developer claim
 * @param {boolean} [opts.isSuspended=false]
 * @param {string} [opts.uid]            Firebase uid (defaults to rt-uid-<uniqueId>)
 * @param {object} [opts.extraUserData]  extra fields merged into the users doc
 */
async function mintRealUser({
  uniqueId,
  cohort,
  admin = false,
  isSuspended = false,
  uid,
  extraUserData = {},
} = {}) {
  if (uniqueId === undefined || uniqueId === null) {
    throw new Error('mintRealUser requires a uniqueId');
  }
  const firebaseUid = uid || `rt-uid-${uniqueId}`;
  await db.doc(`users/${uniqueId}`).set({
    firebaseUid,
    uniqueId,
    isSuspended,
    ...extraUserData,
  });
  const claims = {};
  if (cohort !== undefined) claims.cohort = cohort;
  if (admin) claims.admin = true;
  const customToken = await auth.createCustomToken(firebaseUid, claims);
  const idToken = await exchangeCustomTokenForIdToken(customToken);
  return {
    uid: firebaseUid,
    uniqueId,
    idToken,
    bearer: `Bearer ${idToken}`,
    headers: { Authorization: `Bearer ${idToken}` },
  };
}

/**
 * Mint a real ID token for a Firebase user with NO users doc — so the
 * middleware's resolveUniqueId returns null (req.auth.uniqueId == null). Used
 * to exercise the "authenticated but no profile" path (e.g. livekit 403).
 */
async function mintTokenWithoutUserDoc({ cohort, admin = false, uid } = {}) {
  const firebaseUid = uid || `rt-nouser-${Date.now()}-${++noUserDocSeq}`;
  const claims = {};
  if (cohort !== undefined) claims.cohort = cohort;
  if (admin) claims.admin = true;
  const customToken = await auth.createCustomToken(firebaseUid, claims);
  const idToken = await exchangeCustomTokenForIdToken(customToken);
  return {
    uid: firebaseUid,
    idToken,
    bearer: `Bearer ${idToken}`,
    headers: { Authorization: `Bearer ${idToken}` },
  };
}

module.exports = { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches };
