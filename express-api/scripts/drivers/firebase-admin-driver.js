/**
 * Firebase Auth revocation checks, via the real Admin SDK.
 *
 * SHY-0259. Two corpus assertions read Firebase Auth state directly rather
 * than any product surface:
 *
 *   "Raul's Firebase Auth refreshTokens are revoked"                     (j11)
 *   "the Firebase Auth session for Adam has revokeRefreshTokens
 *    timestamp updated"                                                  (j04)
 *
 * Both are about a SECURITY control: when a user is suspended or their DOB is
 * corrected downward into the minor cohort, the existing sessions must stop
 * working. A stale refresh token that still mints ID tokens is the difference
 * between "banned" and "banned on the screen only".
 *
 * Neither had an implementation, so `ctx.firebaseAdmin` was undefined and the
 * steps reported `not configured` — 7 occurrences in the 2026-08-01 matrix.
 * That is the *safe* failure (loud), but it means the revocation path has
 * never been verified end to end.
 *
 * WHAT "REVOKED" MEANS HERE. `admin.auth().revokeRefreshTokens(uid)` sets the
 * user's `tokensValidAfterTime`. Any refresh token minted before that instant
 * is refused. So the check is a comparison against WHEN THE SESSION WAS
 * ESTABLISHED, not against "is the field set" — every user has the field, and
 * treating its mere presence as revocation would pass for every account in
 * the project including ones that were never revoked at all.
 */

/**
 * @param {object} deps
 * @param {object} deps.auth        a real firebase-admin Auth instance
 * @param {Map} deps.sessions       ctx.sessions — persona name -> {localId, ...}
 * @param {() => number} [deps.now]
 */
function createFirebaseAdminDriver({ auth, sessions, now = () => Date.now() }) {
  if (!auth) throw new Error('createFirebaseAdminDriver: auth is required');
  if (!sessions) throw new Error('createFirebaseAdminDriver: sessions map is required');

  /** Baseline per persona, captured the first time we look at them. */
  const baseline = new Map();

  function uidFor(name) {
    const session = sessions.get(name);
    // Named refusal rather than a false answer: with no session there is no
    // uid, and "not revoked" would be indistinguishable from a real result.
    if (!session) throw new Error(`no signed-in session for "${name}" — Given step missing?`);
    const uid = session.localId || session.uid;
    if (!uid) throw new Error(`session for "${name}" carries no Firebase uid`);
    return uid;
  }

  /** `tokensValidAfterTime` as epoch ms, or 0 when Auth has never set one. */
  async function validAfterMs(name) {
    const user = await auth.getUser(uidFor(name));
    const t = user && user.tokensValidAfterTime;
    if (!t) return 0;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? 0 : ms;
  }

  /**
   * The instant this persona's session began.
   *
   * `signedInAt` is stamped by every sign-in Given. Anchoring on it rather
   * than on a lazily-captured observation matters: a baseline read on FIRST
   * ASSERTION is taken after the revocation the scenario just performed, so
   * before and after are equal and a genuine revocation reports as "not
   * updated". The failure would look like a product bug in the revocation
   * path — the most misleading possible answer for a security control.
   *
   * No missing-session guard here: every caller reaches `validAfterMs` first,
   * which goes through `uidFor` and throws by name. A second check read as
   * defensive but was unreachable — mutation-tested 2026-08-01, replacing it
   * with `return 0` changed nothing, which is the definition of dead code.
   */
  function establishedAt(name) {
    const session = sessions.get(name);
    return session.signedInAt ?? baseline.get(name) ?? 0;
  }

  return {
    /** Optional explicit baseline, for a persona signed in outside a Given. */
    async captureBaseline(name) {
      if (baseline.has(name)) return baseline.get(name);
      const at = await validAfterMs(name);
      baseline.set(name, at);
      return at;
    },

    /**
     * True iff the persona's current session predates `tokensValidAfterTime`
     * — i.e. the refresh token they hold would now be refused.
     */
    async tokensAreRevoked(name) {
      const validAfter = await validAfterMs(name);
      if (!validAfter) return false;
      return validAfter > establishedAt(name);
    },

    /**
     * True iff `tokensValidAfterTime` advanced AFTER this session began.
     *
     * Distinct from tokensAreRevoked in intent: this answers "did a
     * revocation happen during this scenario", which is what j04 asserts
     * after a DOB correction. They share a comparison today because both
     * reduce to the same instant — but a project whose users were all
     * revoked long ago must satisfy neither, and a naive "is the field set"
     * check would satisfy both for every account in the project.
     */
    async revokeTimestampIsUpdated(name) {
      const after = await validAfterMs(name);
      if (!after) return false;
      return after > establishedAt(name);
    },

    /** Diagnostics — the raw instant, so a failure message can name it. */
    async tokensValidAfter(name) {
      return validAfterMs(name);
    },

    /** Present for symmetry with the other drivers; there is nothing to release. */
    async close() {},

    _now: now,
  };
}

// Canonical method surface — the runner-vocabulary methods this driver
// implements. `close()` is intentionally excluded: it is lifecycle, not a
// step binding. Pinned by tests/scripts/drivers/driver-contract.test.js.
const FIREBASE_ADMIN_METHOD_NAMES = [
  'captureBaseline',
  'revokeTimestampIsUpdated',
  'tokensAreRevoked',
  'tokensValidAfter',
];

function listMethods() {
  return [...new Set(FIREBASE_ADMIN_METHOD_NAMES)].sort();
}

module.exports = { createFirebaseAdminDriver, listMethods, FIREBASE_ADMIN_METHOD_NAMES };
