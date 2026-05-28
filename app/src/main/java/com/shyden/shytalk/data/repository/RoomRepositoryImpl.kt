package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.CancellationException
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
        } catch (e: CancellationException) {
            throw e
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
        cohort: String,
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
                    // UK OSA #17 PR 7 — bound by firestore.rules to the
                    // caller's JWT cohort claim; immutable post-create.
                    "cohort" to cohort,
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
            api.post("/api/rooms/$roomId/join")
            // currentRoomId is the caller's own user doc (allowed by rules); stays client-side.
            firestore.document("users/$userId").update("currentRoomId", roomId).await()
        }

    override suspend fun leaveRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to leave room") {
            // Server-authoritative: participant removal + own-seat clear happen
            // transactionally inside the /leave endpoint.
            api.post("/api/rooms/$roomId/leave")
            // currentRoomId is the caller's own user doc; stays client-side.
            firestore.document("users/$userId").update("currentRoomId", null).await()
        }

    override suspend fun takeSeat(
        roomId: String,
        seatIndex: Int,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to take seat") {
            api.post("/api/rooms/$roomId/seats/$seatIndex/claim")
        }

    override suspend fun leaveSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to leave seat") {
            api.post("/api/rooms/$roomId/seats/$seatIndex/leave")
        }

    override suspend fun removeFromSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to remove from seat") {
            api.post("/api/rooms/$roomId/seats/$seatIndex/remove")
        }

    override suspend fun moveSeat(
        roomId: String,
        fromIndex: Int,
        toIndex: Int,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to move seat") {
            api.post("/api/rooms/$roomId/seats/$fromIndex/move", JSONObject().put("toIndex", toIndex))
        }

    override suspend fun kickUser(
        roomId: String,
        userId: String,
        seatIndex: Int?,
        kickerName: String,
        reason: String,
    ): Resource<Unit> =
        firebaseCall("Failed to kick user") {
            // Server derives the target's seat + clears it transactionally; the
            // kicked user self-clears their own currentRoomId on observing the ban.
            api.post(
                "/api/rooms/$roomId/kick",
                JSONObject().apply {
                    put("userId", userId)
                    put("reason", reason.ifBlank { "No reason given" })
                    put("kickerName", kickerName)
                },
            )
        }

    override suspend fun toggleMute(
        roomId: String,
        seatIndex: Int,
        isMuted: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to toggle mute") {
            api.patch("/api/rooms/$roomId/seats/$seatIndex/mute", JSONObject().put("isMuted", isMuted))
        }

    override suspend fun addHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to add host") {
            api.post("/api/rooms/$roomId/hosts", JSONObject().put("userId", userId))
        }

    override suspend fun removeHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove host") {
            api.delete("/api/rooms/$roomId/hosts/$userId")
        }

    override suspend fun updateRoomName(
        roomId: String,
        newName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update room name") {
            api.patch("/api/rooms/$roomId/name", JSONObject().put("name", newName))
        }

    override suspend fun setRequireApproval(
        roomId: String,
        requireApproval: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to update approval setting") {
            api.patch(
                "/api/rooms/$roomId/require-approval",
                JSONObject().put("requireApproval", requireApproval),
            )
        }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> =
        firebaseCall("Failed to set owner away") {
            api.post("/api/rooms/$roomId/owner-away")
        }

    override suspend fun setOwnerReturned(
        roomId: String,
        ownerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to set owner returned") {
            api.post("/api/rooms/$roomId/owner-returned")
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
            // Self-scoped on the server (deletes the caller's own pending invite).
            api.post("/api/rooms/$roomId/decline-invite")
        }

    override suspend fun acceptInvite(
        roomId: String,
        userId: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to accept invite") {
            api.post("/api/rooms/$roomId/seats/$seatIndex/accept-invite")
            // currentRoomId is the caller's own user doc; stays client-side.
            firestore.document("users/$userId").update("currentRoomId", roomId).await()
        }

    override suspend fun closeRoom(roomId: String): Resource<Unit> =
        firebaseCall("Failed to close room") {
            // Server empties the room + clears every participant's currentRoomId.
            api.post("/api/rooms/$roomId/close")
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Failed to find active room by owner", e)
            null
        }

    override suspend fun recordFirstJoinTimestamp(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to record first join timestamp") {
            api.post("/api/rooms/$roomId/first-join")
        }

    override suspend fun leaveAllRooms(
        userId: String,
        exceptRoomId: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to leave all rooms") {
            // Query stays client-side (reads allowed); each room's mutation
            // routes through the server-authoritative /leave endpoint.
            val snapshot =
                firestore
                    .collection("rooms")
                    .whereArrayContains("participantIds", userId)
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .get()
                    .await()
            for (doc in snapshot.documents) {
                if (doc.id == exceptRoomId) continue
                try {
                    api.post("/api/rooms/${doc.id}/leave")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Room operation failed", e)
                }
            }
            firestore.document("users/$userId").update("currentRoomId", null).await()
        }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> =
        firebaseCall("Failed to close rooms") {
            // Query stays client-side; each close routes through /close (which
            // also clears participants' currentRoomId server-side).
            val snapshot =
                firestore
                    .collection("rooms")
                    .whereEqualTo("ownerId", ownerId)
                    .whereIn("state", listOf("ACTIVE", "OWNER_AWAY"))
                    .get()
                    .await()
            for (doc in snapshot.documents) {
                try {
                    api.post("/api/rooms/${doc.id}/close")
                } catch (e: CancellationException) {
                    throw e
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
            // Server verifies the target is actually absent (RTDB presence) and
            // clears their seat + currentRoomId.
            api.post("/api/rooms/$roomId/disconnect-user", JSONObject().put("userId", userId))
        }
}
