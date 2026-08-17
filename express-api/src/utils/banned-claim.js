/**
 * `banned` custom-claim sync — the SHY-0150 chokepoint (EPIC-0005).
 *
 * The Firestore rules layer denies user writes when the caller's token
 * carries `banned: true` (see the `isBanned()` helper in firestore.rules).
 * This module is the ONLY writer of that claim. Callers:
 *
 *   - the admin ban routes (admin-bans.js) — after every ban/unban mutation,
 *   - the suspend/unsuspend auto-ban helpers (admin-users.js),
 *   - authMiddleware / authMiddlewareStrict — LAZILY, when the per-request
 *     ban verdict disagrees with the decoded token's `banned` claim. The
 *     lazy path is what covers standings no route ever mutates directly:
 *     lazy ban expiry, binding mint/unbind flips, and the UNLINKED network
 *     ban (no enumerable target at ban time — the live IP-match verdict is
 *     the only evidence it applies to this caller).
 *
 * Directional asymmetry, on purpose (both directions fail toward "banned"):
 *   - SET rides EITHER authority: an explicit recompute OR the live request
 *     verdict (`verdictBanned: true`) — evidence in hand is enough to mint.
 *   - CLEAR rides ONLY the full user-attributable recompute
 *     (computeUserBanStanding). The per-request verdict must never clear:
 *     it is IP-scoped, so a user with a LINKED network ban calling from a
 *     clean IP passes the API gate while their ban standing still holds.
 *
 * Setting the claim also revokes refresh tokens (prompt effect: the session
 * cannot outlive the current ID token, ≤1h). Clearing NEVER revokes — an
 * unban must not sign the restored user out; their stale banned:true token
 * simply ages out (or the app force-refreshes), exactly the story's
 * "block lifts after refresh" contract.
 *
 * Failure posture: NEVER throws. The ban/unban mutation this rides on has
 * already committed, and the middleware's outer catch turns exceptions into
 * 401s — a claim-sync failure must change neither. Failures are logged loud
 * (`banned-claim` tag) and the lazy path self-heals on a later request.
 */

const { auth, db } = require('./firebase');
const { computeUserBanStanding } = require('./bans');
const { mintClaimsMerging } = require('./firebase-claims');
const log = require('./log');

// Lazy-path dedup: a banned caller's stale token mismatches the verdict on
// EVERY request for up to ~1h; without a guard each one would re-read the
// live claims. Same idiom as middleware/auth.js's adminClaimCache (60s TTL,
// bounded, oldest-out). Route callers bypass this — a fresh mutation must
// always sync.
const SYNC_DEDUP_TTL = 60 * 1000;
const MAX_DEDUP_SIZE = 500;
const syncDedup = new Map(); // String(uniqueId) → expiresAt

/** Test-isolation helper — mirrors clearBanCache/clearAuthCaches. */
function clearBannedClaimSyncDedup() {
  syncDedup.clear();
}

/**
 * Reconcile the `banned` custom claim with the user's actual ban standing.
 *
 * @param {string|number} uniqueId  the target user's stable id
 * @param {object} [opts]
 * @param {string}  [opts.uid]           Firebase uid when the caller already
 *   has it (middleware) — skips the users-doc lookup.
 * @param {boolean} [opts.verdictBanned] pass `true` when a live request
 *   verdict says banned — mints WITHOUT a recompute (the unlinked-network
 *   case has nothing to recompute). Never used to clear.
 * @param {boolean} [opts.dedupe]        lazy-path callers only: skip when
 *   this uniqueId was synced within SYNC_DEDUP_TTL.
 * @returns {Promise<{synced: boolean, changed?: boolean, banned?: boolean,
 *   reason?: string}>} outcome report — informational; callers do not branch
 *   on it for control flow.
 */
async function syncBannedClaim(
  uniqueId,
  { uid = null, verdictBanned = false, dedupe = false } = {},
) {
  const key = String(uniqueId);
  try {
    if (uniqueId === null || uniqueId === undefined) {
      return { synced: false, reason: 'no-uniqueId' };
    }
    if (dedupe) {
      const until = syncDedup.get(key);
      if (until && Date.now() < until) return { synced: false, reason: 'dedup' };
      // Mark BEFORE the async work so a hammering stale-token caller cannot
      // stack N parallel syncs while the first is in flight.
      syncDedup.set(key, Date.now() + SYNC_DEDUP_TTL);
      if (syncDedup.size > MAX_DEDUP_SIZE) {
        syncDedup.delete(syncDedup.keys().next().value);
      }
    }

    const target = verdictBanned === true ? true : await computeUserBanStanding(uniqueId);

    let firebaseUid = uid;
    if (!firebaseUid) {
      const snap = await db.doc(`users/${uniqueId}`).get();
      firebaseUid = snap.exists ? snap.data().firebaseUid || null : null;
    }
    if (!firebaseUid) {
      // No Auth identity to carry the claim (user doc missing/legacy). The
      // API gate (SHY-0149) still enforces per-request; nothing to mint.
      log.warn('banned-claim', 'no firebaseUid resolvable — claim not synced', {
        uniqueId: key,
      });
      return { synced: false, reason: 'no-uid' };
    }

    const record = await auth.getUser(firebaseUid);
    const live = record.customClaims?.banned === true;
    if (live === target) {
      return { synced: true, changed: false, banned: target };
    }

    // Merge-mint (never replace): cohort/admin/uniqueId claims survive.
    await mintClaimsMerging(firebaseUid, { banned: target });
    if (target) {
      // Prompt effect on ban: the session cannot outlive the current ID
      // token. Clearing deliberately skips this — see module docblock.
      await auth.revokeRefreshTokens(firebaseUid);
    }
    // Observability AC: the claim lifecycle is auditable from server logs.
    log.info(
      'banned-claim',
      target ? 'banned claim SET + refresh tokens revoked' : 'banned claim CLEARED (recompute)',
      { uniqueId: key, uid: firebaseUid, verdictDriven: verdictBanned === true },
    );
    return { synced: true, changed: true, banned: target };
  } catch (err) {
    log.error('banned-claim', 'claim sync failed — will self-heal on a later request', {
      uniqueId: key,
      error: err.message,
    });
    return { synced: false, reason: 'error' };
  }
}

module.exports = { syncBannedClaim, clearBannedClaimSyncDedup, SYNC_DEDUP_TTL };
