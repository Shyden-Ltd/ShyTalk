package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.UUID
import javax.inject.Inject

class RoomRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : RoomRepository {

    private val roomsCollection = firestore.collection("rooms")

    override fun getActiveRooms(): Flow<List<ChatRoom>> = callbackFlow {
        val listener = roomsCollection
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val rooms = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { ChatRoom.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(rooms)
            }
        awaitClose { listener.remove() }
    }

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> = callbackFlow {
        val listener = roomsCollection.document(roomId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val room = snapshot?.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                trySend(room)
            }
        awaitClose { listener.remove() }
    }

    override suspend fun createRoom(name: String, ownerId: String): Resource<String> {
        return try {
            val roomId = UUID.randomUUID().toString()
            val seats = (0 until Constants.MAX_SEATS).associate { i ->
                i.toString() to if (i == Constants.OWNER_SEAT_INDEX) {
                    Seat(userId = ownerId, state = SeatState.OCCUPIED)
                } else {
                    Seat()
                }
            }
            val room = ChatRoom(
                roomId = roomId,
                name = name,
                ownerId = ownerId,
                state = RoomState.ACTIVE,
                createdAt = Timestamp.now(),
                participantIds = listOf(ownerId),
                seats = seats,
                agoraChannelName = roomId
            )
            roomsCollection.document(roomId).set(room.toMap()).await()
            Resource.Success(roomId)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to create room", e)
        }
    }

    override suspend fun joinRoom(roomId: String, userId: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "participantIds", FieldValue.arrayUnion(userId)
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to join room", e)
        }
    }

    override suspend fun leaveRoom(roomId: String, userId: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "participantIds", FieldValue.arrayRemove(userId)
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to leave room", e)
        }
    }

    override suspend fun takeSeat(roomId: String, seatIndex: Int, userId: String): Resource<Unit> {
        return try {
            val docRef = roomsCollection.document(roomId)
            firestore.runTransaction { transaction ->
                val snapshot = transaction.get(docRef)
                val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                    ?: throw Exception("Room not found")

                val updates = mutableMapOf<String, Any?>()

                // Clear any existing seat occupied by this user
                for ((idx, seat) in room.seats) {
                    if (seat.userId == userId && seat.state == SeatState.OCCUPIED) {
                        updates["seats.$idx"] = Seat().toMap()
                    }
                }

                // Take the new seat
                updates["seats.$seatIndex"] = Seat(userId = userId, state = SeatState.OCCUPIED).toMap()
                transaction.update(docRef, updates)
            }.await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to take seat", e)
        }
    }

    override suspend fun leaveSeat(roomId: String, seatIndex: Int): Resource<Unit> {
        return try {
            val seat = Seat()
            roomsCollection.document(roomId).update(
                "seats.$seatIndex", seat.toMap()
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to leave seat", e)
        }
    }

    override suspend fun removeFromSeat(roomId: String, seatIndex: Int): Resource<Unit> {
        return leaveSeat(roomId, seatIndex)
    }

    override suspend fun moveSeat(roomId: String, fromIndex: Int, toIndex: Int, userId: String): Resource<Unit> {
        return try {
            val emptySeat = Seat()
            val occupiedSeat = Seat(userId = userId, state = SeatState.OCCUPIED)
            roomsCollection.document(roomId).update(
                mapOf(
                    "seats.$fromIndex" to emptySeat.toMap(),
                    "seats.$toIndex" to occupiedSeat.toMap()
                )
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to move seat", e)
        }
    }

    override suspend fun kickUser(roomId: String, userId: String, seatIndex: Int?): Resource<Unit> {
        return try {
            val updates = mutableMapOf<String, Any>(
                "participantIds" to FieldValue.arrayRemove(userId),
                "bannedUserIds" to FieldValue.arrayUnion(userId)
            )
            if (seatIndex != null) {
                updates["seats.$seatIndex"] = Seat().toMap()
            }
            roomsCollection.document(roomId).update(updates).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to kick user", e)
        }
    }

    override suspend fun toggleMute(roomId: String, seatIndex: Int, isMuted: Boolean): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "seats.$seatIndex.isMuted", isMuted
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to toggle mute", e)
        }
    }

    override suspend fun addHost(roomId: String, userId: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "hostIds", FieldValue.arrayUnion(userId)
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to add host", e)
        }
    }

    override suspend fun removeHost(roomId: String, userId: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "hostIds", FieldValue.arrayRemove(userId)
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to remove host", e)
        }
    }

    override suspend fun setRequireApproval(roomId: String, requireApproval: Boolean): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "requireApproval", requireApproval
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to update approval setting", e)
        }
    }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                mapOf(
                    "state" to RoomState.OWNER_AWAY.name,
                    "ownerLeftAt" to Timestamp.now()
                )
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to set owner away", e)
        }
    }

    override suspend fun setOwnerReturned(roomId: String, ownerId: String): Resource<Unit> {
        return try {
            val seat = Seat(userId = ownerId, state = SeatState.OCCUPIED)
            roomsCollection.document(roomId).update(
                mapOf(
                    "state" to RoomState.ACTIVE.name,
                    "ownerLeftAt" to null,
                    "seats.${Constants.OWNER_SEAT_INDEX}" to seat.toMap()
                )
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to set owner returned", e)
        }
    }

    override suspend fun sendInvite(roomId: String, userId: String, invitedBy: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "pendingInvites.$userId", invitedBy
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to send invite", e)
        }
    }

    override suspend fun cancelInvite(roomId: String, userId: String): Resource<Unit> {
        return try {
            roomsCollection.document(roomId).update(
                "pendingInvites.$userId", FieldValue.delete()
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to cancel invite", e)
        }
    }

    override suspend fun acceptInvite(roomId: String, userId: String, seatIndex: Int): Resource<Unit> {
        return try {
            val docRef = roomsCollection.document(roomId)
            firestore.runTransaction { transaction ->
                val snapshot = transaction.get(docRef)
                val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                    ?: throw Exception("Room not found")

                val updates = mutableMapOf<String, Any?>(
                    "pendingInvites.$userId" to FieldValue.delete()
                )

                // Clear any existing seat occupied by this user
                for ((idx, seat) in room.seats) {
                    if (seat.userId == userId && seat.state == SeatState.OCCUPIED) {
                        updates["seats.$idx"] = Seat().toMap()
                    }
                }

                // Take the new seat
                updates["seats.$seatIndex"] = Seat(userId = userId, state = SeatState.OCCUPIED).toMap()
                transaction.update(docRef, updates)
            }.await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to accept invite", e)
        }
    }

    override suspend fun findActiveRoomByOwner(ownerId: String): String? {
        return try {
            val snapshot = roomsCollection
                .whereEqualTo("ownerId", ownerId)
                .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
                .get()
                .await()
            snapshot.documents.firstOrNull()?.id
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun recordFirstJoinTimestamp(roomId: String, userId: String): Resource<Unit> {
        return try {
            val docRef = roomsCollection.document(roomId)
            firestore.runTransaction { transaction ->
                val snapshot = transaction.get(docRef)
                val existing = (snapshot.get("firstJoinTimestamps") as? Map<*, *>)
                if (existing == null || !existing.containsKey(userId)) {
                    transaction.update(docRef, "firstJoinTimestamps.$userId", Timestamp.now())
                }
            }.await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to record first join timestamp", e)
        }
    }

    override suspend fun leaveAllRooms(userId: String, exceptRoomId: String?): Resource<Unit> {
        return try {
            val snapshot = roomsCollection
                .whereArrayContains("participantIds", userId)
                .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
                .get()
                .await()
            for (doc in snapshot.documents) {
                val otherRoomId = doc.id
                if (otherRoomId == exceptRoomId) continue
                val room = doc.data?.let { ChatRoom.fromMap(it, otherRoomId) } ?: continue

                val updates = mutableMapOf<String, Any>(
                    "participantIds" to FieldValue.arrayRemove(userId)
                )
                // Clear any seats the user occupies
                for ((idx, seat) in room.seats) {
                    if (seat.userId == userId && seat.state == SeatState.OCCUPIED) {
                        updates["seats.$idx"] = Seat().toMap()
                    }
                }
                // If user is the owner, set room to owner away
                if (room.ownerId == userId) {
                    updates["state"] = RoomState.OWNER_AWAY.name
                    updates["ownerLeftAt"] = Timestamp.now()
                }
                roomsCollection.document(otherRoomId).update(updates).await()
            }
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to leave all rooms", e)
        }
    }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> {
        return try {
            val snapshot = roomsCollection
                .whereEqualTo("ownerId", ownerId)
                .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
                .get()
                .await()
            for (doc in snapshot.documents) {
                closeRoom(doc.id)
            }
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to close rooms", e)
        }
    }

    override suspend fun closeRoom(roomId: String): Resource<Unit> {
        return try {
            val emptySeats = (0 until Constants.MAX_SEATS).associate { i ->
                "seats.$i" to Seat().toMap()
            }
            val updates = emptySeats + mapOf(
                "state" to RoomState.CLOSED.name,
                "closedAt" to Timestamp.now(),
                "participantIds" to emptyList<String>()
            )
            roomsCollection.document(roomId).update(updates).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to close room", e)
        }
    }
}
