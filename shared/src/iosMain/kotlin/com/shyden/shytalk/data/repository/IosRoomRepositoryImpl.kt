package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.CancellationException
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
                    val data = doc.dataMap()
                    ChatRoom.fromMap(data, doc.id)
                }
        } catch (e: CancellationException) {
            throw e
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
                    val data = doc.dataMap()
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
                val data = snapshot.dataMap()
                ChatRoom.fromMap(data, roomId)
            }

    override suspend fun getRoom(roomId: String): Resource<ChatRoom> =
        firebaseCall("Failed to get room") {
            val doc = firestore.collection("rooms").document(roomId).get()
            if (!doc.exists) throw Exception("Room not found")
            val data = doc.dataMap()
            ChatRoom.fromMap(data, roomId)
        }

    override suspend fun createRoom(
        name: String,
        ownerId: String,
        ownerFirebaseUid: String,
        cohort: String,
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
                    // Cron-elim PR A0 — denormalised Firebase Auth uid of
                    // the room owner. Bound to request.auth.uid by the
                    // firestore.rules rooms-create rule and read by the
                    // owner-left RTDB listener to attest signals. Two
                    // identity namespaces exist for every user; ownerId is
                    // the Firestore uniqueId, this is the Firebase Auth uid.
                    "ownerFirebaseUid" to ownerFirebaseUid,
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
            firestore.collection("rooms").document(roomId).set(roomData)
            firestore.collection("users").document(ownerId).updateFields { "currentRoomId" to roomId }
            roomId
        }

    override suspend fun joinRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to join room") {
            api.post("/api/rooms/$roomId/join")
            // currentRoomId is the caller's own user doc (allowed by rules); stays client-side.
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to roomId }
        }

    override suspend fun leaveRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to leave room") {
            // Server-authoritative: participant removal + own-seat clear happen
            // transactionally inside the /leave endpoint.
            api.post("/api/rooms/$roomId/leave")
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to null }
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
            api.post(
                "/api/rooms/$roomId/seats/$fromIndex/move",
                JsonObject(mapOf("toIndex" to JsonPrimitive(toIndex))),
            )
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
                JsonObject(
                    mapOf(
                        "userId" to JsonPrimitive(userId),
                        "reason" to JsonPrimitive(reason.ifBlank { "No reason given" }),
                        "kickerName" to JsonPrimitive(kickerName),
                    ),
                ),
            )
        }

    override suspend fun toggleMute(
        roomId: String,
        seatIndex: Int,
        isMuted: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to toggle mute") {
            api.patch(
                "/api/rooms/$roomId/seats/$seatIndex/mute",
                JsonObject(mapOf("isMuted" to JsonPrimitive(isMuted))),
            )
        }

    override suspend fun addHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to add host") {
            api.post("/api/rooms/$roomId/hosts", JsonObject(mapOf("userId" to JsonPrimitive(userId))))
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
            api.patch("/api/rooms/$roomId/name", JsonObject(mapOf("name" to JsonPrimitive(newName))))
        }

    override suspend fun setRequireApproval(
        roomId: String,
        requireApproval: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to update approval setting") {
            api.patch(
                "/api/rooms/$roomId/require-approval",
                JsonObject(mapOf("requireApproval" to JsonPrimitive(requireApproval))),
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
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to roomId }
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
                    .where {
                        all(
                            "ownerId" equalTo ownerId,
                            "state" inArray listOf("ACTIVE", "OWNER_AWAY"),
                        )
                    }.get()
            snapshot.documents.firstOrNull()?.id
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG, "Failed to find active room by owner")
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
                try {
                    api.post("/api/rooms/${doc.id}/leave")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    logW(TAG, "Failed to leave room ${doc.id}")
                }
            }
            firestore.collection("users").document(userId).updateFields { "currentRoomId" to null }
        }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> =
        firebaseCall("Failed to close rooms") {
            // Query stays client-side; each close routes through /close (which
            // also clears participants' currentRoomId server-side).
            val snapshot =
                firestore
                    .collection("rooms")
                    .where {
                        all(
                            "ownerId" equalTo ownerId,
                            "state" inArray listOf("ACTIVE", "OWNER_AWAY"),
                        )
                    }.get()
            for (doc in snapshot.documents) {
                try {
                    api.post("/api/rooms/${doc.id}/close")
                } catch (e: CancellationException) {
                    throw e
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
            // Server verifies the target is actually absent (RTDB presence) and
            // clears their seat + currentRoomId.
            api.post(
                "/api/rooms/$roomId/disconnect-user",
                JsonObject(mapOf("userId" to JsonPrimitive(userId))),
            )
        }
}
