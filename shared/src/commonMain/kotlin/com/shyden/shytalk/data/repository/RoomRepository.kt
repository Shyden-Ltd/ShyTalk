package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface RoomRepository {
    /**
     * UK OSA #17 / SHY-0102 — the rooms read rule (`firestore.rules` L192)
     * gates a collection `list` on `resource.data.cohort ==
     * request.auth.token.cohort`. Firestore evaluates a `list` rule against
     * the QUERY (with `resource.data` unbound), so the query MUST pin
     * `where('cohort','==', cohort)` or be denied — an unconstrained list
     * returns an empty Rooms screen even when rooms exist. Pass the caller's
     * own effective cohort (resolve via [UserRepository.resolveEffectiveCohort],
     * which fails closed to `"minor"`); passing the wrong cohort is rejected by
     * the rule, never leaked cross-cohort. Proven against the real rules engine
     * in `room-rules.test.js` (SHY-0129).
     */
    fun getActiveRooms(cohort: String): Flow<List<ChatRoom>>

    fun getRoomFlow(roomId: String): Flow<ChatRoom?>

    suspend fun getRoom(roomId: String): Resource<ChatRoom>

    /**
     * UK OSA #17 PR 7 — `cohort` is bound to the caller's JWT custom
     * claim by the firestore.rules layer (`request.resource.data.cohort
     * == request.auth.token.cohort`). The KMP client stamps the value
     * from the local [User.cohort] field; the rules then verify that
     * value matches the signed claim, so client-side cohort forging
     * cannot succeed without ALSO forging the JWT (impossible without
     * the service-account key).
     *
     * Must be `"adult"` or `"minor"`; any other value fails the rules
     * gate. Pass `"minor"` as the fail-closed default when the local
     * user's cohort is unknown — this avoids a regression vs the
     * pre-PR-7 behaviour where minor users could create rooms freely.
     */
    suspend fun createRoom(
        name: String,
        ownerId: String,
        ownerFirebaseUid: String,
        cohort: String,
    ): Resource<String>

    suspend fun joinRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun leaveRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun takeSeat(
        roomId: String,
        seatIndex: Int,
        userId: String,
    ): Resource<Unit>

    suspend fun leaveSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit>

    suspend fun removeFromSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit>

    suspend fun moveSeat(
        roomId: String,
        fromIndex: Int,
        toIndex: Int,
        userId: String,
    ): Resource<Unit>

    suspend fun kickUser(
        roomId: String,
        userId: String,
        seatIndex: Int?,
        kickerName: String = "",
        reason: String = "",
    ): Resource<Unit>

    suspend fun toggleMute(
        roomId: String,
        seatIndex: Int,
        isMuted: Boolean,
    ): Resource<Unit>

    suspend fun addHost(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun removeHost(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun updateRoomName(
        roomId: String,
        newName: String,
    ): Resource<Unit>

    suspend fun setRequireApproval(
        roomId: String,
        requireApproval: Boolean,
    ): Resource<Unit>

    suspend fun setOwnerAway(roomId: String): Resource<Unit>

    suspend fun setOwnerReturned(
        roomId: String,
        ownerId: String,
    ): Resource<Unit>

    suspend fun sendInvite(
        roomId: String,
        userId: String,
        invitedBy: String,
    ): Resource<Unit>

    suspend fun cancelInvite(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun acceptInvite(
        roomId: String,
        userId: String,
        seatIndex: Int,
    ): Resource<Unit>

    suspend fun closeRoom(roomId: String): Resource<Unit>

    /**
     * SHY-0102 — also a rooms collection `list`, so it carries the same
     * cohort constraint as [getActiveRooms] (an owner's room shares the
     * owner's cohort). [cohort] is the caller's effective cohort.
     */
    suspend fun findActiveRoomByOwner(
        ownerId: String,
        cohort: String,
    ): String?

    suspend fun recordFirstJoinTimestamp(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    /**
     * SHY-0102 — lists the caller's participated rooms (a rooms `list`), so it
     * pins [cohort] (the caller's effective cohort) to satisfy the read rule.
     */
    suspend fun leaveAllRooms(
        userId: String,
        cohort: String,
        exceptRoomId: String? = null,
    ): Resource<Unit>

    /**
     * SHY-0102 — lists the owner's rooms (a rooms `list`), so it pins [cohort]
     * (the owner's effective cohort, which their rooms share).
     */
    suspend fun closeAllRoomsByOwner(
        ownerId: String,
        cohort: String,
    ): Resource<Unit>

    suspend fun removeDisconnectedUser(
        roomId: String,
        userId: String,
    ): Resource<Unit>

    /**
     * SHY-0102 — prefetch feeds [getActiveRooms]; same rooms `list`, same
     * cohort constraint. [cohort] is the caller's effective cohort.
     */
    @Suppress("kotlin:S6318")
    suspend fun prefetchActiveRooms(cohort: String) {}
}
