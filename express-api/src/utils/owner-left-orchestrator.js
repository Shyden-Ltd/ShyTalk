/**
 * Owner-left orchestrator — composes the room read, the RTDB presence
 * re-check, and the Firestore-transactional decide+apply, returning the
 * action result so the caller (an RTDB listener wrapper) can decide whether
 * to clear the `ownerLeft/{roomId}` signal entry.
 *
 * Separation of concerns:
 *   - Pure decision: `decideOwnerLeftAction` (owner-left-handler.js)
 *   - Pure application: `applyOwnerLeftTx` (owner-left-handler.js)
 *   - Composition + transactional read: THIS module
 *   - Signal-lifecycle (RTDB add/remove): the listener wrapper
 *
 * The orchestrator THROWS on infrastructure errors (Firestore read/txn
 * failure, RTDB presence read failure via the injected presenceChecker) so
 * the caller can leave the signal in place for a retry; it returns a result
 * object on success.
 */

const {
  OWNER_LEFT_ACTION,
  decideOwnerLeftAction,
  applyOwnerLeftTx,
} = require('./owner-left-handler');

/**
 * Path-safe identifier allowlist for RTDB path components. Mirrors the
 * roomId allowlist in owner-left-listener.js so both ends of the path
 * interpolation share the same defensive shape. Defends against `ownerId`
 * values from corrupt Firestore docs containing `/`, `.`, `#`, `$`, `[`,
 * `]`, whitespace, or being missing entirely.
 *
 * Type-strict: accepts ONLY `string` and finite `number` primitives. The
 * schema stores ownerId as either (see `accountDeletion.js:148`'s
 * `String(roomDoc.data().ownerId)` normalisation pattern), but anything
 * else — boolean, object, array, function, NaN, Infinity — is corruption.
 * Without the strict typeof check, `String(true)` / `String(false)` /
 * `String(NaN)` yield strings that pass the alphanumeric regex.
 */
const MAX_OWNER_ID_LENGTH = 256;
const SAFE_OWNER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidOwnerId(ownerId) {
  const t = typeof ownerId;
  if (t !== 'string' && t !== 'number') return false;
  if (t === 'number' && !Number.isFinite(ownerId)) return false;
  const s = String(ownerId);
  if (s.length === 0 || s.length > MAX_OWNER_ID_LENGTH) return false;
  return SAFE_OWNER_ID_PATTERN.test(s);
}

/**
 * Process an owner-left signal for `roomId`.
 *
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {(roomId: string, userId: string) => Promise<boolean>} args.presenceChecker
 *   Async; resolves to true if the user is present in RTDB right now. Should
 *   THROW on read errors so the caller can decide whether to retry — do not
 *   fail-safe-to-true inside the checker for this code path.
 * @param {string} args.roomId
 * @param {string} [args.writerUid] - the uid stored in the RTDB signal entry
 *   (snap.val()) — the client that armed the onDisconnect. The RTDB rule
 *   forces this to equal `auth.uid` at write time; here we additionally
 *   verify it matches the room's authoritative ownerId. An attacker who
 *   writes `ownerLeft/{victim-room} = attacker-uid` would land at this
 *   mismatch branch and the listener clears the signal without invoking
 *   presenceChecker for the victim — preventing presence-probing as well.
 *   Omit for direct callers that don't have an attesting writer.
 * @param {number} [args.nowMs] - server time captured by caller; defaults to
 *   Date.now() once, BEFORE `runTransaction` opens. Reused across SDK retry
 *   attempts so the OWNER_AWAY timestamp is stable.
 * @returns {Promise<{action: string, reason?: string, postRoom?: object}>}
 */
async function handleOwnerLeftSignal({ db, presenceChecker, roomId, writerUid, nowMs }) {
  const roomRef = db.doc(`rooms/${roomId}`);

  // Pre-txn read to extract the authoritative ownerId. We deliberately do NOT
  // trust an ownerId passed in via the signal payload — clients write to the
  // RTDB signal path and could forge a different ownerId. The Firestore room
  // doc is the source of truth.
  const preSnap = await roomRef.get();
  if (!preSnap.exists) {
    return { action: OWNER_LEFT_ACTION.NOOP, reason: 'room-missing' };
  }
  const preRoom = preSnap.data();

  // Defense in depth: `ownerId` becomes an RTDB path segment via
  // presenceChecker(roomId, ownerId). A corrupt room doc with ownerId
  // null/undefined/empty/containing path-separators would either silently
  // produce a false-absent (wrong path → snap.exists() = false → "absent" →
  // spurious close) or open the path-traversal door. Reject early.
  if (!isValidOwnerId(preRoom.ownerId)) {
    return { action: OWNER_LEFT_ACTION.NOOP, reason: 'owner-id-missing-or-invalid' };
  }

  // Writer-attestation check: the client that armed the RTDB onDisconnect
  // signs the entry value with their own uid (enforced by the rule
  // `newData.val() === auth.uid`). Here we additionally verify the writer
  // is the room's owner — closes the "attacker writes ownerLeft for victim's
  // room" forgery. Omitted writerUid is accepted for direct (non-listener)
  // callers that don't have an attesting writer.
  if (
    writerUid !== undefined &&
    writerUid !== null &&
    String(writerUid) !== String(preRoom.ownerId)
  ) {
    return { action: OWNER_LEFT_ACTION.NOOP, reason: 'writer-not-owner' };
  }

  // TOCTOU re-check: the signal may be stale by the time we process it (owner
  // reconnected on a second device, or the same device finished a transient
  // disconnect). The checker is the authoritative gate; it throws on read
  // failure so the caller can preserve the signal for a later retry.
  //
  // NOTE on Firestore txn retries: ownerStillPresent is captured BEFORE the
  // txn opens and is REUSED across every retry attempt. That is intentional —
  // RTDB reads cannot run inside a Firestore transaction, so re-checking
  // inside the callback is not an option. An owner who reconnects DURING
  // the txn-retry window (typically sub-second on Firebase) will trigger a
  // spurious OWNER_AWAY which self-heals via /owner-returned. Matches the
  // /owner-away endpoint's documented residual TOCTOU window.
  const ownerStillPresent = await presenceChecker(roomId, preRoom.ownerId);

  const effectiveNowMs = nowMs ?? Date.now();

  return db.runTransaction(async (t) => {
    const snap = await t.get(roomRef);
    if (!snap.exists) {
      return { action: OWNER_LEFT_ACTION.NOOP, reason: 'room-missing-in-txn' };
    }
    const room = snap.data();
    const action = decideOwnerLeftAction(room, ownerStillPresent);
    const postRoom = applyOwnerLeftTx(t, roomRef, room, action, effectiveNowMs);
    return { action, postRoom };
  });
}

module.exports = {
  handleOwnerLeftSignal,
  isValidOwnerId,
};
