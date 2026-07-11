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
  clearBanCache,
} = require('../../src/middleware/auth');
const { clearBannedClaimSyncDedup } = require('../../src/utils/banned-claim');

// Monotonic counter for unique synthetic uids (avoids a flagged Math.random PRNG).
let noUserDocSeq = 0;

/** Clear the auth middleware's in-memory caches — call in beforeEach for isolation. */
function clearAuthCaches() {
  clearUniqueIdCache();
  clearSuspensionCache();
  clearAdminClaimCache();
  clearBanCache();
  clearBannedClaimSyncDedup();
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
 * @param {object} [opts.extraClaims]    additional developer claims minted onto the
 *   ID token (e.g. `{ banned: true }` for SHY-0150's stale-token divergence
 *   tests). Developer claims only shape THIS token — live customClaims on the
 *   Auth user record are set separately via setCustomUserClaims.
 */
/**
 * A namespaced Firestore project (SHY-0171's `FIRESTORE_TEST_NAMESPACE`) makes
 * every minted ID token 401, because the Auth emulator resolves tokens against
 * the project it was STARTED with. Firestore isolates per project; Auth will not.
 *
 * The two are therefore mutually exclusive WITHIN A FILE: a suite may namespace
 * its Firestore project, or it may mint Auth tokens, never both. (Across files
 * there is no hazard — jest-environment-node builds a fresh `process` per test
 * file, so `process.env` writes never reach a sibling file or the parent.)
 *
 * Fail loudly here rather than let the caller chase a mystery 401.
 */
function assertNoTestNamespace() {
  if (process.env.FIRESTORE_TEST_NAMESPACE) {
    throw new Error(
      `FIRESTORE_TEST_NAMESPACE is set to '${process.env.FIRESTORE_TEST_NAMESPACE}' while minting an ` +
        'Auth token. A Firestore-namespaced suite leaked it (restore it in afterAll). ' +
        'The Auth emulator only knows the project it was started with, so this token would 401.',
    );
  }
}

async function mintRealUser({
  uniqueId,
  cohort,
  admin = false,
  isSuspended = false,
  uid,
  extraUserData = {},
  extraClaims = {},
} = {}) {
  assertNoTestNamespace();
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
  const claims = { ...extraClaims };
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
  assertNoTestNamespace();
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

module.exports = { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches, assertNoTestNamespace };
