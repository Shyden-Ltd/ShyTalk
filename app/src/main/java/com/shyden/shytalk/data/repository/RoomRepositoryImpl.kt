package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

private const val TAG = "RoomRepository"

class RoomRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore,
) : RoomRepository {
    @Volatile private var prefetchedRooms: List<ChatRoom>? = null

    override suspend fun prefetchActiveRooms() {
        try {
            val snapshot =
                firestore
                    .collection("rooms")
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .get()
                    .await()
            prefetchedRooms =
                snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    ChatRoom.fromMap(data, doc.id)
                }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to prefetch active rooms", e)
        }
    }

    // Real-time active rooms list from Firestore
    override fun getActiveRooms(): Flow<List<ChatRoom>> =
        callbackFlow {
            prefetchedRooms?.let {
                trySend(it)
                prefetchedRooms = null
            }
            val listener =
                firestore
                    .collection("rooms")
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val rooms =
                            snapshot.documents.mapNotNull { doc ->
                                val data = doc.data ?: return@mapNotNull null
                                ChatRoom.fromMap(data, doc.id)
                            }
                        trySend(rooms)
                    }
            awaitClose { listener.remove() }
        }

    // Real-time single room from Firestore
    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> =
        callbackFlow {
            val listener =
                firestore
                    .document("rooms/$roomId")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        if (!snapshot.exists()) {
                            trySend(null)
                            return@addSnapshotListener
                        }
                        val data = snapshot.data ?: return@addSnapshotListener
                        trySend(ChatRoom.fromMap(data, roomId))
                    }
            awaitClose { listener.remove() }
        }

    override suspend fun getRoom(roomId: String): Resource<ChatRoom> =
        firebaseCall("Failed to get room") {
            val doc = firestore.document("rooms/$roomId").get().await()
            val data = doc.data ?: throw Exception("Room not found")
            ChatRoom.fromMap(data, roomId)
        }

    override suspend fun createRoom(
        name: String,
        ownerId: String,
    ): Resource<String> =
        firebaseCall("Failed to create room") {
            val roomId = firestore.collection("rooms").document().id
            val timestamp = System.currentTimeMillis()
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
            firestore.document("rooms/$roomId").set(roomData).await()
            firestore.document("users/$ownerId").update("currentRoomId", roomId).await()
            roomId
        }

    override suspend fun joinRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to join room") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "participantIds" to FieldValue.arrayUnion(userId),
                    ),
                ).await()
            firestore.document("users/$userId").update("currentRoomId", roomId).await()
        }

    override suspend fun leaveRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to leave room") {
            // Atomic: read seats + clear-by-user in one transaction so a
            // concurrent moveSeat (also transactional) can't swap the seat
            // mid-flight, which would otherwise leave us writing the
            // pre-move user's seat clear (stale data) or missing the
            // target's actual seat. moveSeat at line 219 uses the same
            // pattern; this brings leaveRoom's read-then-write to parity.
            val roomRef = firestore.document("rooms/$roomId")
            firestore
                .runTransaction { transaction ->
                    val doc = transaction.get(roomRef)
                    val data = doc.data
                    val updates =
                        mutableMapOf<String, Any?>(
                            "participantIds" to FieldValue.arrayRemove(userId),
                        )
                    if (data != null) {
                        val seatsRaw = data["seats"] as? Map<*, *>
                        seatsRaw?.forEach { (index, seatData) ->
                            val seat = seatData as? Map<*, *>
                            if (seat?.get("userId") == userId) {
                                updates["seats.$index.userId"] = null
                                updates["seats.$index.state"] = "EMPTY"
                                updates["seats.$index.isMuted"] = false
                            }
                        }
                    }
                    transaction.update(roomRef, updates)
                }.await()
            // user-doc update is intentionally outside the transaction —
            // Firestore transactions can't span unrelated docs without a
            // multi-doc read; if the user-doc write fails, the user has a
            // stale currentRoomId but the room is correctly cleared.
            firestore.document("users/$userId").update("currentRoomId", null).await()
        }

    override suspend fun takeSeat(
        roomId: String,
        seatIndex: Int,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to take seat") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "seats.$seatIndex.userId" to userId,
                        "seats.$seatIndex.state" to "OCCUPIED",
                        "seats.$seatIndex.isMuted" to false,
                        "allTimeSeatUserIds" to FieldValue.arrayUnion(userId),
                    ),
                ).await()
        }

    override suspend fun leaveSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to leave seat") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "seats.$seatIndex.userId" to null,
                        "seats.$seatIndex.state" to "EMPTY",
                        "seats.$seatIndex.isMuted" to false,
                    ),
                ).await()
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
            val roomRef = firestore.document("rooms/$roomId")
            firestore
                .runTransaction { transaction ->
                    val doc = transaction.get(roomRef)
                    val data = doc.data ?: throw Exception("Room not found")
                    val seatsRaw = data["seats"] as? Map<*, *> ?: throw Exception("No seats data")
                    val fromSeat =
                        (seatsRaw[fromIndex.toString()] as? Map<*, *>)?.let { raw ->
                            raw.entries.associate { (k, v) -> k.toString() to v }
                        } ?: Seat.EMPTY_MAP
                    val toSeat =
                        (seatsRaw[toIndex.toString()] as? Map<*, *>)?.let { raw ->
                            raw.entries.associate { (k, v) -> k.toString() to v }
                        } ?: Seat.EMPTY_MAP

                    transaction.update(
                        roomRef,
                        mapOf(
                            "seats.$fromIndex.userId" to toSeat["userId"],
                            "seats.$fromIndex.state" to (toSeat["state"] ?: "EMPTY"),
                            "seats.$fromIndex.isMuted" to (toSeat["isMuted"] ?: false),
                            "seats.$toIndex.userId" to fromSeat["userId"],
                            "seats.$toIndex.state" to (fromSeat["state"] ?: "EMPTY"),
                            "seats.$toIndex.isMuted" to (fromSeat["isMuted"] ?: false),
                        ),
                    )
                }.await()
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
            val roomRef = firestore.document("rooms/$roomId")
            // Atomic: when seatIndex is unknown we MUST read seats inside
            // the same transaction as the clear, otherwise a concurrent
            // moveSeat can shuffle the target's seat between our read and
            // write, leaving us blanking the wrong seat.
            firestore
                .runTransaction { transaction ->
                    val updates =
                        mutableMapOf<String, Any?>(
                            "participantIds" to FieldValue.arrayRemove(userId),
                            "bannedUserIds" to FieldValue.arrayUnion(userId),
                            "kickInfo.$userId" to
                                mapOf(
                                    "kickerName" to kickerName,
                                    "reason" to effectiveReason,
                                ),
                        )
                    if (seatIndex != null) {
                        updates["seats.$seatIndex.userId"] = null
                        updates["seats.$seatIndex.state"] = "EMPTY"
                        updates["seats.$seatIndex.isMuted"] = false
                    } else {
                        val doc = transaction.get(roomRef)
                        val data = doc.data
                        val seatsRaw = data?.get("seats") as? Map<*, *>
                        seatsRaw?.forEach { (index, seatData) ->
                            val seat = seatData as? Map<*, *>
                            if (seat?.get("userId") == userId) {
                                updates["seats.$index.userId"] = null
                                updates["seats.$index.state"] = "EMPTY"
                                updates["seats.$index.isMuted"] = false
                            }
                        }
                    }
                    transaction.update(roomRef, updates)
                }.await()
            firestore.document("users/$userId").update("currentRoomId", null).await()
        }

    override suspend fun toggleMute(
        roomId: String,
        seatIndex: Int,
        isMuted: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to toggle mute") {
            firestore
                .document("rooms/$roomId")
                .update(
                    "seats.$seatIndex.isMuted",
                    isMuted,
                ).await()
        }

    override suspend fun addHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to add host") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "hostIds" to FieldValue.arrayUnion(userId),
                        "allTimeHostIds" to FieldValue.arrayUnion(userId),
                    ),
                ).await()
        }

    override suspend fun removeHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove host") {
            firestore
                .document("rooms/$roomId")
                .update(
                    "hostIds",
                    FieldValue.arrayRemove(userId),
                ).await()
        }

    override suspend fun updateRoomName(
        roomId: String,
        newName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update room name") {
            firestore.document("rooms/$roomId").update("name", newName).await()
        }

    override suspend fun setRequireApproval(
        roomId: String,
        requireApproval: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to update approval setting") {
            firestore.document("rooms/$roomId").update("requireApproval", requireApproval).await()
        }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> =
        firebaseCall("Failed to set owner away") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "state" to "OWNER_AWAY",
                        "ownerLeftAt" to System.currentTimeMillis(),
                    ),
                ).await()
        }

    override suspend fun setOwnerReturned(
        roomId: String,
        ownerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to set owner returned") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "state" to "ACTIVE",
                        "ownerLeftAt" to null,
                    ),
                ).await()
        }

    // Keep as Worker API — needs FCM push notification
    override suspend fun sendInvite(
        roomId: String,
        userId: String,
        invitedBy: String,
    ): Resource<Unit> =
        firebaseCall("Failed to send invite") {
            val body =
                JSONObject().apply {
                    put("userId", userId)
                    put("invitedBy", invitedBy)
                }
            api.post("/api/rooms/$roomId/invites/send", body)
        }

    override suspend fun cancelInvite(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to cancel invite") {
            firestore
                .document("rooms/$roomId")
                .update(
                    "pendingInvites.$userId",
                    FieldValue.delete(),
                ).await()
        }

    override suspend fun acceptInvite(
        roomId: String,
        userId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to accept invite") {
            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "pendingInvites.$userId" to FieldValue.delete(),
                        "participantIds" to FieldValue.arrayUnion(userId),
                        "seats.$seatIndex.userId" to userId,
                        "seats.$seatIndex.state" to "OCCUPIED",
                        "seats.$seatIndex.isMuted" to false,
                        "allTimeSeatUserIds" to FieldValue.arrayUnion(userId),
                    ),
                ).await()
            firestore.document("users/$userId").update("currentRoomId", roomId).await()
        }

    override suspend fun closeRoom(roomId: String): Resource<Unit> =
        firebaseCall("Failed to close room") {
            // Read current room to get participant list
            val doc = firestore.document("rooms/$roomId").get().await()
            val data = doc.data ?: throw Exception("Room not found")
            val participantIds = (data["participantIds"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

            val emptySeat = mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            val emptySeats = (0..7).associate { it.toString() to emptySeat }

            firestore
                .document("rooms/$roomId")
                .update(
                    mapOf(
                        "state" to "CLOSED",
                        "closedAt" to System.currentTimeMillis(),
                        "participantIds" to emptyList<String>(),
                        "seats" to emptySeats,
                    ),
                ).await()

            // Clear currentRoomId for all participants
            for (uid in participantIds) {
                try {
                    firestore.document("users/$uid").update("currentRoomId", null).await()
                } catch (e: Exception) {
                    Log.w(TAG, "Room operation failed", e)
                }
            }
        }

    override suspend fun findActiveRoomByOwner(ownerId: String): String? =
        try {
            val snapshot =
                firestore
                    .collection("rooms")
                    .whereEqualTo("ownerId", ownerId)
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .get()
                    .await()
            snapshot.documents.firstOrNull()?.id
        } catch (e: Exception) {
            Log.w(TAG, "Failed to find active room by owner", e)
            null
        }

    override suspend fun recordFirstJoinTimestamp(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to record first join timestamp") {
            firestore
                .document("rooms/$roomId")
                .update(
                    "firstJoinTimestamps.$userId",
                    System.currentTimeMillis(),
                ).await()
        }

    override suspend fun leaveAllRooms(
        userId: String,
        exceptRoomId: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to leave all rooms") {
            val snapshot =
                firestore
                    .collection("rooms")
                    .whereArrayContains("participantIds", userId)
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .get()
                    .await()
            for (doc in snapshot.documents) {
                if (doc.id == exceptRoomId) continue
                // Atomic per-room: read seats + clear under one transaction
                // so a concurrent moveSeat can't shuffle this user's seat
                // between our read and write. Each room is independent so
                // a per-room transaction (not multi-doc) is sufficient.
                val roomRef = firestore.document("rooms/${doc.id}")
                try {
                    firestore
                        .runTransaction { transaction ->
                            val freshDoc = transaction.get(roomRef)
                            val data = freshDoc.data ?: return@runTransaction
                            val updates =
                                mutableMapOf<String, Any?>(
                                    "participantIds" to FieldValue.arrayRemove(userId),
                                )
                            val seatsRaw = data["seats"] as? Map<*, *>
                            seatsRaw?.forEach { (index, seatData) ->
                                val seat = seatData as? Map<*, *>
                                if (seat?.get("userId") == userId) {
                                    updates["seats.$index.userId"] = null
                                    updates["seats.$index.state"] = "EMPTY"
                                    updates["seats.$index.isMuted"] = false
                                }
                            }
                            transaction.update(roomRef, updates)
                        }.await()
                } catch (e: Exception) {
                    Log.w(TAG, "Room operation failed", e)
                }
            }
            firestore.document("users/$userId").update("currentRoomId", null).await()
        }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> =
        firebaseCall("Failed to close rooms") {
            val snapshot =
                firestore
                    .collection("rooms")
                    .whereEqualTo("ownerId", ownerId)
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .get()
                    .await()
            for (doc in snapshot.documents) {
                val data = doc.data ?: continue
                val participantIds = (data["participantIds"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

                val emptySeat = mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
                val emptySeats = (0..7).associate { it.toString() to emptySeat }

                try {
                    firestore
                        .document("rooms/${doc.id}")
                        .update(
                            mapOf(
                                "state" to "CLOSED",
                                "closedAt" to System.currentTimeMillis(),
                                "participantIds" to emptyList<String>(),
                                "seats" to emptySeats,
                            ),
                        ).await()
                    for (uid in participantIds) {
                        try {
                            firestore.document("users/$uid").update("currentRoomId", null).await()
                        } catch (e: Exception) {
                            Log.w(TAG, "Room operation failed", e)
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Room operation failed", e)
                }
            }
        }

    override suspend fun removeDisconnectedUser(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove disconnected user") {
            // Same race-safety logic as leaveRoom.
            val roomRef = firestore.document("rooms/$roomId")
            firestore
                .runTransaction { transaction ->
                    val doc = transaction.get(roomRef)
                    val data = doc.data
                    val updates =
                        mutableMapOf<String, Any?>(
                            "participantIds" to FieldValue.arrayRemove(userId),
                        )
                    if (data != null) {
                        val seatsRaw = data["seats"] as? Map<*, *>
                        seatsRaw?.forEach { (index, seatData) ->
                            val seat = seatData as? Map<*, *>
                            if (seat?.get("userId") == userId) {
                                updates["seats.$index.userId"] = null
                                updates["seats.$index.state"] = "EMPTY"
                                updates["seats.$index.isMuted"] = false
                            }
                        }
                    }
                    transaction.update(roomRef, updates)
                }.await()
            firestore.document("users/$userId").update("currentRoomId", null).await()
        }
}
