package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.FieldValue
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val TAG = "RoomRepository"

class IosRoomRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
) : RoomRepository {
    @kotlin.concurrent.Volatile
    private var prefetchedRooms: List<ChatRoom>? = null

    override suspend fun prefetchActiveRooms() {
        try {
            val snapshot =
                firestore
                    .collection("rooms")
                    .where { "state" inArray listOf("ACTIVE", "OWNER_AWAY") }
                    .get()
            prefetchedRooms =
                snapshot.documents.map { doc ->
                    val data = doc.data<Map<String, Any?>>()
                    ChatRoom.fromMap(data, doc.id)
                }
        } catch (e: Exception) {
            logW(TAG, "Failed to prefetch active rooms")
        }
    }

    override fun getActiveRooms(): Flow<List<ChatRoom>> =
        firestore
            .collection("rooms")
            .where { "state" inArray listOf("ACTIVE", "OWNER_AWAY") }
            .snapshots
            .map { snapshot ->
                snapshot.documents.map { doc ->
                    val data = doc.data<Map<String, Any?>>()
                    ChatRoom.fromMap(data, doc.id)
                }
            }

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> =
        firestore
            .collection("rooms")
            .document(roomId)
            .snapshots
            .map { snapshot ->
                if (!snapshot.exists) return@map null
                val data = snapshot.data<Map<String, Any?>>()
                ChatRoom.fromMap(data, roomId)
            }

    override suspend fun getRoom(roomId: String): Resource<ChatRoom> =
        firebaseCall("Failed to get room") {
            val doc = firestore.collection("rooms").document(roomId).get()
            if (!doc.exists) throw Exception("Room not found")
            val data = doc.data<Map<String, Any?>>()
            ChatRoom.fromMap(data, roomId)
        }

    override suspend fun createRoom(
        name: String,
        ownerId: String,
    ): Resource<String> =
        firebaseCall("Failed to create room") {
            val roomId = firestore.collection("rooms").document.id
            val timestamp = currentTimeMillis()
            val emptySeat = mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            val ownerSeat = mapOf("userId" to ownerId, "state" to "OCCUPIED", "isMuted" to false)
            val seats =
                (0..7).associate { i ->
                    i.toString() to if (i == 0) ownerSeat else emptySeat
                }
            val roomData =
                mapOf(
                    "id" to roomId,
                    "name" to name,
                    "ownerId" to ownerId,
                    "state" to "ACTIVE",
                    "createdAt" to timestamp,
                    "participantIds" to listOf(ownerId),
                    "hostIds" to emptyList<String>(),
                    "bannedUserIds" to emptyList<String>(),
                    "kickInfo" to emptyMap<String, Any>(),
                    "pendingInvites" to emptyMap<String, Any>(),
                    "seats" to seats,
                    "voiceRoomName" to roomId,
                    "requireApproval" to false,
                    "firstJoinTimestamps" to emptyMap<String, Any>(),
                    "allTimeHostIds" to emptyList<String>(),
                    "allTimeSeatUserIds" to listOf(ownerId),
                )
            firestore.collection("rooms").document(roomId).set(roomData)
            firestore.collection("users").document(ownerId).updateFields { "currentRoomId" to roomId }
            roomId
        }

    override suspend fun joinRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to join room") {
            firestore.collection("rooms").document(roomId).updateFields {
                "participantIds" to FieldValue.arrayUnion(userId)
            }
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to roomId }
        }

    override suspend fun leaveRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to leave room") {
            val doc = firestore.collection("rooms").document(roomId).get()
            val data = if (doc.exists) doc.data<Map<String, Any?>>() else null
            clearUserFromRoom(roomId, userId, data)
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to null }
        }

    override suspend fun takeSeat(
        roomId: String,
        seatIndex: Int,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to take seat") {
            firestore.collection("rooms").document(roomId).updateFields {
                "seats.$seatIndex.userId" to userId
                "seats.$seatIndex.state" to "OCCUPIED"
                "seats.$seatIndex.isMuted" to false
                "allTimeSeatUserIds" to FieldValue.arrayUnion(userId)
            }
        }

    override suspend fun leaveSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to leave seat") {
            firestore.collection("rooms").document(roomId).updateFields {
                "seats.$seatIndex.userId" to null
                "seats.$seatIndex.state" to "EMPTY"
                "seats.$seatIndex.isMuted" to false
            }
        }

    override suspend fun removeFromSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> = leaveSeat(roomId, seatIndex)

    override suspend fun moveSeat(
        roomId: String,
        fromIndex: Int,
        toIndex: Int,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to move seat") {
            val roomRef = firestore.collection("rooms").document(roomId)
            firestore.runTransaction {
                val doc = get(roomRef)
                val data = doc.data<Map<String, Any?>>()
                val seatsRaw = data["seats"] as? Map<*, *> ?: throw Exception("No seats data")
                val fromSeat =
                    (seatsRaw[fromIndex.toString()] as? Map<*, *>)
                        ?.entries
                        ?.associate { (k, v) -> k.toString() to v } ?: Seat.EMPTY_MAP
                val toSeat =
                    (seatsRaw[toIndex.toString()] as? Map<*, *>)
                        ?.entries
                        ?.associate { (k, v) -> k.toString() to v } ?: Seat.EMPTY_MAP

                updateFields(roomRef) {
                    "seats.$fromIndex.userId" to toSeat["userId"]
                    "seats.$fromIndex.state" to (toSeat["state"] ?: "EMPTY")
                    "seats.$fromIndex.isMuted" to (toSeat["isMuted"] ?: false)
                    "seats.$toIndex.userId" to fromSeat["userId"]
                    "seats.$toIndex.state" to (fromSeat["state"] ?: "EMPTY")
                    "seats.$toIndex.isMuted" to (fromSeat["isMuted"] ?: false)
                }
            }
        }

    override suspend fun kickUser(
        roomId: String,
        userId: String,
        seatIndex: Int?,
        kickerName: String,
        reason: String,
    ): Resource<Unit> =
        firebaseCall("Failed to kick user") {
            val effectiveReason = reason.ifBlank { "No reason given" }
            val doc = firestore.collection("rooms").document(roomId).get()
            val data = if (doc.exists) doc.data<Map<String, Any?>>() else null

            val kickInfoValue: Map<String, String> = mapOf("kickerName" to kickerName, "reason" to effectiveReason)
            firestore.collection("rooms").document(roomId).updateFields {
                "participantIds" to FieldValue.arrayRemove(userId)
                "bannedUserIds" to FieldValue.arrayUnion(userId)
                "kickInfo.$userId" to kickInfoValue
            }

            // Clear seat
            if (seatIndex != null) {
                firestore.collection("rooms").document(roomId).updateFields {
                    "seats.$seatIndex.userId" to null
                    "seats.$seatIndex.state" to "EMPTY"
                    "seats.$seatIndex.isMuted" to false
                }
            } else if (data != null) {
                clearUserSeatOnly(roomId, userId, data)
            }
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to null }
        }

    override suspend fun toggleMute(
        roomId: String,
        seatIndex: Int,
        isMuted: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to toggle mute") {
            firestore.collection("rooms").document(roomId).updateFields {
                "seats.$seatIndex.isMuted" to isMuted
            }
        }

    override suspend fun addHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to add host") {
            firestore.collection("rooms").document(roomId).updateFields {
                "hostIds" to FieldValue.arrayUnion(userId)
                "allTimeHostIds" to FieldValue.arrayUnion(userId)
            }
        }

    override suspend fun removeHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove host") {
            firestore.collection("rooms").document(roomId).updateFields {
                "hostIds" to FieldValue.arrayRemove(userId)
            }
        }

    override suspend fun updateRoomName(
        roomId: String,
        newName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update room name") {
            firestore.collection("rooms").document(roomId).updateFields { "name" to newName }
        }

    override suspend fun setRequireApproval(
        roomId: String,
        requireApproval: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to update approval setting") {
            firestore.collection("rooms").document(roomId).updateFields {
                "requireApproval" to requireApproval
            }
        }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> =
        firebaseCall("Failed to set owner away") {
            firestore.collection("rooms").document(roomId).updateFields {
                "state" to "OWNER_AWAY"
                "ownerLeftAt" to currentTimeMillis()
            }
        }

    override suspend fun setOwnerReturned(
        roomId: String,
        ownerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to set owner returned") {
            firestore.collection("rooms").document(roomId).updateFields {
                "state" to "ACTIVE"
                "ownerLeftAt" to null
            }
        }

    override suspend fun sendInvite(
        roomId: String,
        userId: String,
        invitedBy: String,
    ): Resource<Unit> =
        firebaseCall("Failed to send invite") {
            api.post(
                "/api/rooms/$roomId/invites/send",
                JsonObject(
                    mapOf(
                        "userId" to JsonPrimitive(userId),
                        "invitedBy" to JsonPrimitive(invitedBy),
                    ),
                ),
            )
        }

    override suspend fun cancelInvite(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to cancel invite") {
            firestore.collection("rooms").document(roomId).updateFields {
                "pendingInvites.$userId" to FieldValue.delete
            }
        }

    override suspend fun acceptInvite(
        roomId: String,
        userId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to accept invite") {
            firestore.collection("rooms").document(roomId).updateFields {
                "pendingInvites.$userId" to FieldValue.delete
                "participantIds" to FieldValue.arrayUnion(userId)
                "seats.$seatIndex.userId" to userId
                "seats.$seatIndex.state" to "OCCUPIED"
                "seats.$seatIndex.isMuted" to false
                "allTimeSeatUserIds" to FieldValue.arrayUnion(userId)
            }
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to roomId }
        }

    override suspend fun closeRoom(roomId: String): Resource<Unit> =
        firebaseCall("Failed to close room") {
            val doc = firestore.collection("rooms").document(roomId).get()
            if (!doc.exists) throw Exception("Room not found")
            val data = doc.data<Map<String, Any?>>()
            val participantIds = (data["participantIds"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

            val emptySeat = mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            val emptySeats = (0..7).associate { it.toString() to emptySeat }

            firestore.collection("rooms").document(roomId).updateFields {
                "state" to "CLOSED"
                "closedAt" to currentTimeMillis()
                "participantIds" to emptyList<String>()
                "seats" to emptySeats
            }
            for (uid in participantIds) {
                try {
                    firestore.collection("users").document(uid).updateFields { "currentRoomId" to null }
                } catch (e: Exception) {
                    logW(TAG, "Failed to clear currentRoomId for $uid")
                }
            }
        }

    override suspend fun findActiveRoomByOwner(ownerId: String): String? =
        try {
            val snapshot =
                firestore
                    .collection("rooms")
                    .where {
                        all(
                            "ownerId" equalTo ownerId,
                            "state" inArray listOf("ACTIVE", "OWNER_AWAY"),
                        )
                    }.get()
            snapshot.documents.firstOrNull()?.id
        } catch (e: Exception) {
            logW(TAG, "Failed to find active room by owner")
            null
        }

    override suspend fun recordFirstJoinTimestamp(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to record first join timestamp") {
            firestore.collection("rooms").document(roomId).updateFields {
                "firstJoinTimestamps.$userId" to currentTimeMillis()
            }
        }

    override suspend fun leaveAllRooms(
        userId: String,
        exceptRoomId: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to leave all rooms") {
            val snapshot =
                firestore
                    .collection("rooms")
                    .where {
                        all(
                            "participantIds" contains userId,
                            "state" inArray listOf("ACTIVE", "OWNER_AWAY"),
                        )
                    }.get()
            for (doc in snapshot.documents) {
                if (doc.id == exceptRoomId) continue
                val data = doc.data<Map<String, Any?>>()
                try {
                    clearUserFromRoom(doc.id, userId, data)
                } catch (e: Exception) {
                    logW(TAG, "Failed to leave room ${doc.id}")
                }
            }
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to null }
        }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> =
        firebaseCall("Failed to close rooms") {
            val snapshot =
                firestore
                    .collection("rooms")
                    .where {
                        all(
                            "ownerId" equalTo ownerId,
                            "state" inArray listOf("ACTIVE", "OWNER_AWAY"),
                        )
                    }.get()

            val emptySeat = mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            val emptySeats = (0..7).associate { it.toString() to emptySeat }

            for (doc in snapshot.documents) {
                val data = doc.data<Map<String, Any?>>()
                val participantIds = (data["participantIds"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
                try {
                    firestore.collection("rooms").document(doc.id).updateFields {
                        "state" to "CLOSED"
                        "closedAt" to currentTimeMillis()
                        "participantIds" to emptyList<String>()
                        "seats" to emptySeats
                    }
                    for (uid in participantIds) {
                        try {
                            firestore.collection("users").document(uid).updateFields { "currentRoomId" to null }
                        } catch (e: Exception) {
                            logW(TAG, "Failed to clear currentRoomId for $uid")
                        }
                    }
                } catch (e: Exception) {
                    logW(TAG, "Failed to close room ${doc.id}")
                }
            }
        }

    override suspend fun removeDisconnectedUser(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove disconnected user") {
            val doc = firestore.collection("rooms").document(roomId).get()
            val data = if (doc.exists) doc.data<Map<String, Any?>>() else null
            clearUserFromRoom(roomId, userId, data)
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to null }
        }

    private suspend fun clearUserFromRoom(
        roomId: String,
        userId: String,
        data: Map<String, Any?>?,
    ) {
        firestore.collection("rooms").document(roomId).updateFields {
            "participantIds" to FieldValue.arrayRemove(userId)
        }
        if (data != null) {
            clearUserSeatOnly(roomId, userId, data)
        }
    }

    private suspend fun clearUserSeatOnly(
        roomId: String,
        userId: String,
        data: Map<String, Any?>,
    ) {
        val seatsRaw = data["seats"] as? Map<*, *> ?: return
        for ((index, seatData) in seatsRaw) {
            val seat = seatData as? Map<*, *> ?: continue
            if (seat["userId"] == userId) {
                firestore.collection("rooms").document(roomId).updateFields {
                    "seats.$index.userId" to null
                    "seats.$index.state" to "EMPTY"
                    "seats.$index.isMuted" to false
                }
            }
        }
    }
}
