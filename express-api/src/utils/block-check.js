/**
 * Block-list helpers — predicates for enforcing user-level block rules.
 *
 * ShyTalk stores blocks as a `blockedUserIds: number[]` field on the
 * `users/{uniqueId}` Firestore doc. Block/unblock operations are written
 * directly to Firestore by the iOS/Android clients (no Express endpoint),
 * so the source of truth is always the user doc this module is handed.
 *
 * Two predicates live here:
 *
 *   - `viewerIsBlocked(viewerId, targetUser)` — one-direction, used by
 *     read endpoints (profile-view, gift-wall) where only the target's
 *     doc is already loaded. Returns true if the target has blocked the
 *     viewer, so the read should be refused.
 *
 *   - `checkBlockRelationship(sender, recipient, senderId, recipientId)`
 *     — symmetric, used by interaction endpoints (gift-send, backpack-send)
 *     where both docs are already loaded for other reasons (balance read
 *     + recipient existence). Returns an error string or null. The
 *     symmetric form is correct for interactions: if either side has
 *     blocked the other, the interaction must fail; a one-way block
 *     would otherwise let the blocker continue to push gifts.
 */

/**
 * One-direction block check for read endpoints.
 *
 * @param {number|string} viewerId  The caller's uniqueId (from req.auth.uniqueId)
 * @param {object|null} targetUser  The target user doc (or null/undefined)
 * @returns {boolean}                True if the target has blocked the viewer
 */
function viewerIsBlocked(viewerId, targetUser) {
  if (!targetUser) return false;
  const blocked = (targetUser.blockedUserIds || []).map(String);
  return blocked.includes(String(viewerId));
}

/**
 * Symmetric block check for interaction endpoints. Returns an error
 * string suitable for `res.status(403).json({ error })`, or null when
 * neither side blocks the other.
 *
 * Kept compatible with the original gift-route helper so existing
 * call sites do not need to change.
 *
 * @param {object} sender         Sender's user doc
 * @param {object} recipient      Recipient's user doc
 * @param {number|string} senderId
 * @param {number|string} recipientId
 * @returns {string|null}         Error string, or null if OK
 */
function checkBlockRelationship(sender, recipient, senderId, recipientId) {
  const senderBlocked = (sender?.blockedUserIds || []).map(String);
  const recipientBlocked = (recipient?.blockedUserIds || []).map(String);
  if (senderBlocked.includes(String(recipientId)) || recipientBlocked.includes(String(senderId))) {
    return 'Cannot send gifts to or from blocked users';
  }
  return null;
}

module.exports = { viewerIsBlocked, checkBlockRelationship };
