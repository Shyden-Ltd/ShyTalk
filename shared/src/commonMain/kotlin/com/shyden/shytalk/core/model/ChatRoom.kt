package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

data class ChatRoom(
    val roomId: String = "",
    val name: String = "",
    val ownerId: String = "",
    val state: RoomState = RoomState.ACTIVE,
    val ownerLeftAt: Long? = null,
    val createdAt: Long = currentTimeMillis(),
    val closedAt: Long? = null,
    val participantIds: Set<String> = emptySet(),
    val hostIds: Set<String> = emptySet(),
    val requireApproval: Boolean = false,
    val bannedUserIds: Set<String> = emptySet(),
    val kickInfo: Map<String, Map<String, String>> = emptyMap(),
    val pendingInvites: Map<String, String> = emptyMap(),
    val seats: Map<String, Seat> = DEFAULT_SEATS,
    val voiceRoomName: String = "",
    val firstJoinTimestamps: Map<String, Long> = emptyMap(),
    val allTimeHostIds: Set<String> = emptySet(),
    val allTimeSeatUserIds: Set<String> = emptySet(),
    val lastGiftEvent: GiftEvent? = null,
) {
    fun resolveRole(userId: String): RoomRole =
        when {
            ownerId == userId -> RoomRole.OWNER
            userId in hostIds -> RoomRole.HOST
            else -> RoomRole.ATTENDEE
        }

    /** Finds the seat entry occupied by the given user, or null if not seated. */
    fun findUserSeat(userId: String): Map.Entry<String, Seat>? = seats.entries.find { it.value.isOccupiedBy(userId) }

    // ─── Moderation permission helpers ──────────────────────────────
    //
    // Pure-function mirror of the host-action gates baked into
    // ActiveRoomManager.kt. Centralising them here means UI code can ask the
    // same questions ("can this user kick that user?") without importing the
    // active-room state machine, AND lets us test the policy in isolation.

    /** True iff `actorId` is allowed to take action on `targetId`. */
    fun canKickUser(
        actorId: String,
        targetId: String,
    ): Boolean {
        // Owners can never be kicked.
        if (targetId == ownerId) return false
        return when (resolveRole(actorId)) {
            RoomRole.OWNER -> true

            // Hosts can kick attendees but not other hosts.
            RoomRole.HOST -> targetId !in hostIds

            RoomRole.ATTENDEE -> false
        }
    }

    /** True iff `actorId` can force-remove the user occupying `seatIndex`. */
    fun canRemoveFromSeat(
        actorId: String,
        seatIndex: Int,
    ): Boolean {
        // The owner seat is always 0 and cannot be vacated by force.
        if (seatIndex == 0) return false
        val occupantId = seats[seatIndex.toString()]?.userId ?: return false
        return canKickUser(actorId, occupantId)
    }

    /** True iff `actorId` can force-mute (but not unmute) the user at `seatIndex`. */
    fun canForceMute(
        actorId: String,
        seatIndex: Int,
    ): Boolean {
        val seat = seats[seatIndex.toString()] ?: return false
        val occupantId = seat.userId ?: return false
        if (occupantId == ownerId) return false
        if (seat.isMuted) return false // already muted — only the user themselves can unmute
        return when (resolveRole(actorId)) {
            RoomRole.OWNER -> true
            RoomRole.HOST -> occupantId !in hostIds
            RoomRole.ATTENDEE -> false
        }
    }

    /**
     * True iff `actorId` can take `seatIndex` directly (no approval round-trip).
     * Attendees ALWAYS need a seat-request — the route via the request workflow
     * is exposed elsewhere.
     */
    fun canTakeSeatDirectly(
        actorId: String,
        seatIndex: Int,
    ): Boolean {
        val role = resolveRole(actorId)
        // Owner can only sit in seat 0; conversely seat 0 is owner-only.
        if (role == RoomRole.OWNER && seatIndex != 0) return false
        if (seatIndex == 0 && role != RoomRole.OWNER) return false
        // Seat must actually exist + be empty.
        val seat = seats[seatIndex.toString()] ?: return false
        if (seat.state == SeatState.OCCUPIED) return false
        return when (role) {
            RoomRole.OWNER -> true

            // Hosts can take any non-owner seat unless approval is required AND
            // they are NOT bypassing the queue. Approval-required rooms force the
            // request flow even for hosts (matches ActiveRoomManager.takeSeat
            // semantics).
            RoomRole.HOST -> !requireApproval

            // Attendees can never bypass — they must create a seat request.
            RoomRole.ATTENDEE -> false
        }
    }

    /** True iff `actorId` can send a peer-invite (host invitation) without approval. */
    fun canInvite(actorId: String): Boolean =
        when (resolveRole(actorId)) {
            RoomRole.OWNER -> true
            RoomRole.HOST -> !requireApproval
            RoomRole.ATTENDEE -> false
        }

    /** True if any non-owner user is currently seated (OCCUPIED). */
    fun hasSeatedNonOwners(): Boolean =
        seats.any { (_, seat) ->
            seat.userId != null && seat.userId != ownerId && seat.state == SeatState.OCCUPIED
        }

    fun toMap(): Map<String, Any?> =
        mapOf(
            "roomId" to roomId,
            "name" to name,
            "ownerId" to ownerId,
            "state" to state.name,
            "ownerLeftAt" to ownerLeftAt,
            "createdAt" to createdAt,
            "closedAt" to closedAt,
            "participantIds" to participantIds.toList(),
            "hostIds" to hostIds.toList(),
            "requireApproval" to requireApproval,
            "bannedUserIds" to bannedUserIds.toList(),
            "kickInfo" to kickInfo,
            "pendingInvites" to pendingInvites,
            "seats" to seats.mapValues { it.value.toMap() },
            "voiceRoomName" to voiceRoomName,
            "firstJoinTimestamps" to firstJoinTimestamps,
            "allTimeHostIds" to allTimeHostIds.toList(),
            "allTimeSeatUserIds" to allTimeSeatUserIds.toList(),
            "lastGiftEvent" to
                lastGiftEvent?.let {
                    mapOf(
                        "senderId" to it.senderId,
                        "senderName" to it.senderName,
                        "recipientId" to it.recipientId,
                        "recipientName" to it.recipientName,
                        "giftId" to it.giftId,
                        "giftName" to it.giftName,
                        "coinValue" to it.coinValue,
                        "timestamp" to it.timestamp,
                    )
                },
        )

    companion object {
        val DEFAULT_SEATS: Map<String, Seat> =
            (0 until Constants.MAX_SEATS).associate { it.toString() to Seat() }

        fun fromMap(
            map: Map<String, Any?>,
            roomId: String,
        ): ChatRoom {
            val seatsRaw = (map["seats"] as? Map<*, *>) ?: emptyMap<String, Any>()
            val seats =
                (0 until Constants.MAX_SEATS).associate { i ->
                    val key = i.toString()
                    val seatMap =
                        (seatsRaw[key] as? Map<*, *>)?.let { raw ->
                            raw.entries.associate { (k, v) -> k.toString() to v }
                        } ?: emptyMap()
                    key to Seat.fromMap(seatMap)
                }

            return ChatRoom(
                roomId = roomId,
                name = map["name"] as? String ?: "",
                ownerId = map["ownerId"] as? String ?: "",
                state =
                    (map["state"] as? String)?.let {
                        try {
                            RoomState.valueOf(it)
                        } catch (_: Exception) {
                            RoomState.ACTIVE
                        }
                    } ?: RoomState.ACTIVE,
                ownerLeftAt = map["ownerLeftAt"]?.let { timestampToMillis(it) },
                createdAt = timestampToMillis(map["createdAt"]),
                closedAt = map["closedAt"]?.let { timestampToMillis(it) },
                participantIds = (map["participantIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                hostIds = (map["hostIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                requireApproval = map["requireApproval"].asBool(),
                bannedUserIds = (map["bannedUserIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                kickInfo =
                    (map["kickInfo"] as? Map<*, *>)?.entries?.associate { entry ->
                        entry.key.toString() to (
                            (entry.value as? Map<*, *>)?.entries?.associate {
                                it.key.toString() to (it.value as? String ?: "")
                            } ?: emptyMap()
                        )
                    } ?: emptyMap(),
                pendingInvites =
                    (map["pendingInvites"] as? Map<*, *>)?.entries?.associate {
                        it.key.toString() to (it.value as? String ?: "")
                    } ?: emptyMap(),
                seats = seats,
                voiceRoomName = (map["voiceRoomName"] ?: map["agoraChannelName"]) as? String ?: "",
                firstJoinTimestamps =
                    (map["firstJoinTimestamps"] as? Map<*, *>)?.entries?.associate {
                        it.key.toString() to timestampToMillis(it.value)
                    } ?: emptyMap(),
                allTimeHostIds = (map["allTimeHostIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                allTimeSeatUserIds = (map["allTimeSeatUserIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                lastGiftEvent =
                    (map["lastGiftEvent"] as? Map<*, *>)?.let { raw ->
                        val typed = raw.entries.associate { (k, v) -> k.toString() to v }
                        GiftEvent.fromMap(typed)
                    },
            )
        }
    }
}
