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
