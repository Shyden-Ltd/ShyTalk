package com.shyden.shytalk.data.remote

import kotlinx.coroutines.flow.Flow

interface PresenceService {
    fun setPresence(
        roomId: String,
        userId: String,
    )

    fun removePresence()

    fun observeRoomPresence(roomId: String): Flow<Set<String>>

    /** One-shot check if a user is currently present in a room. */
    suspend fun isUserPresent(
        roomId: String,
        userId: String,
    ): Boolean

    /** Room events observed via Firebase RTDB listeners. */
    val roomEvents: Flow<RoomEvent>

    /**
     * Arm the RTDB owner-left signal for [roomId]. The owner client writes its
     * Firebase Auth uid to `ownerLeft/{roomId}` and registers an onDisconnect
     * to re-write the same value when the connection drops. The server-side
     * owner-left listener consumes the signal and decides whether to close
     * or transition the room (see express-api/src/utils/owner-left-*.js).
     *
     * **[ownerFirebaseUid] must be the Firebase Auth uid (`auth.currentUser.uid`),
     * NOT the Firestore uniqueId.** The RTDB security rule on `ownerLeft/{roomId}`
     * enforces `newData.val() === auth.uid`, and the server-side orchestrator
     * compares the signal value against `room.ownerFirebaseUid` (denormalised
     * via PR #1001 / cron-elim A0). Passing the uniqueId here would cause the
     * rule-layer write to fail silently and the feature to never trigger.
     *
     * Idempotent on replace: calling with a new [roomId] cancels any prior arm
     * before installing the new one. Safe to call from the room-entry path on
     * every setPresence — non-owners' calls are gated by the caller via an
     * `if (room.ownerId == userId)` check.
     */
    fun armOwnerLeftSignal(
        roomId: String,
        ownerFirebaseUid: String,
    )

    /**
     * Cancel any armed RTDB owner-left signal. Called from
     * [removePresence] automatically (so all room-exit paths get cancel for
     * free), and explicitly from the disconnect-from-room flow. No-op if no
     * signal is currently armed.
     */
    fun cancelOwnerLeftSignal()
}
