package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import android.util.Log
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.tasks.await
import java.util.UUID

class RoomRepositoryImpl(
    private val firestore: FirebaseFirestore
) : RoomRepository {

    companion object {
        private const val TAG = "RoomRepositoryImpl"

        /** Cached map for resetting all 8 seats to empty — avoids re-creating on every call. */
        private val EMPTY_SEATS_UPDATE: Map<String, Any> by lazy {
            (0 until Constants.MAX_SEATS).associate { i -> "seats.$i" to Seat.EMPTY_MAP }
        }
    }

    private val roomsCollection = firestore.collection("rooms")

    override fun getActiveRooms(): Flow<List<ChatRoom>> = callbackFlow {
        val listener = roomsCollection
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .limit(Constants.ACTIVE_ROOMS_QUERY_LIMIT)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "getActiveRooms listener error (will retry on next event)", error)
                    return@addSnapshotListener
                }
                val rooms = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { ChatRoom.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(rooms)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> = callbackFlow {
        val listener = roomsCollection.document(roomId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "getRoomFlow listener error (will retry on next event)", error)
                    return@addSnapshotListener
                }
                val room = snapshot?.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                trySend(room)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override suspend fun createRoom(name: String, ownerId: String): Resource<String> = firebaseCall("Failed to create room") {
        val roomId = UUID.randomUUID().toString()
        val seats = (0 until Constants.MAX_SEATS).associate { i ->
            i.toString() to if (i == Constants.OWNER_SEAT_INDEX) {
                Seat(userId = ownerId, state = SeatState.OCCUPIED, isMuted = true)
            } else {
                Seat()
            }
        }
        val room = ChatRoom(
            roomId = roomId,
            name = name,
            ownerId = ownerId,
            state = RoomState.ACTIVE,
            createdAt = currentTimeMillis(),
            participantIds = setOf(ownerId),
            seats = seats,
            voiceRoomName = roomId,
            allTimeSeatUserIds = setOf(ownerId)
        )
        roomsCollection.document(roomId).set(room.toMap()).await()
        roomId
    }

    override suspend fun joinRoom(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to join room") {
        roomsCollection.document(roomId).update(
            "participantIds", FieldValue.arrayUnion(userId)
        ).await()
    }

    override suspend fun leaveRoom(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to leave room") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: return@runTransaction

            val remaining = room.participantIds - userId

            if (remaining.isEmpty() ||
                (remaining.singleOrNull() == room.ownerId && room.state == RoomState.OWNER_AWAY)) {
                // Room is empty — close it
                transaction.update(docRef, closeRoomUpdates())
            } else {
                transaction.update(docRef, mapOf(
                    "participantIds" to FieldValue.arrayRemove(userId)
                ))
            }
        }.await()
    }

    override suspend fun takeSeat(roomId: String, seatIndex: Int, userId: String): Resource<Unit> = firebaseCall("Failed to take seat") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")

            // User already in a seat — no-op (prevents duplicate seating)
            if (room.findUserSeat(userId) != null) return@runTransaction

            // Target seat occupied — abort
            val seat = room.seats[seatIndex.toString()]
            if (seat?.state == SeatState.OCCUPIED) return@runTransaction

            val updates = clearUserSeats(room, userId)
            updates["seats.$seatIndex"] = Seat(userId = userId, state = SeatState.OCCUPIED, isMuted = true).toMap()
            updates["allTimeSeatUserIds"] = FieldValue.arrayUnion(userId)
            transaction.update(docRef, updates)
        }.await()
    }

    override suspend fun leaveSeat(roomId: String, seatIndex: Int): Resource<Unit> = firebaseCall("Failed to leave seat") {
        roomsCollection.document(roomId).update(
            "seats.$seatIndex", Seat.EMPTY_MAP
        ).await()
    }

    override suspend fun removeFromSeat(roomId: String, seatIndex: Int): Resource<Unit> {
        return leaveSeat(roomId, seatIndex)
    }

    override suspend fun moveSeat(roomId: String, fromIndex: Int, toIndex: Int, userId: String): Resource<Unit> = firebaseCall("Failed to move seat") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")
            val fromSeat = room.seats[fromIndex.toString()]
            val toSeat = room.seats[toIndex.toString()]
            val fromMuted = fromSeat?.isMuted ?: false

            if (toSeat?.state == SeatState.OCCUPIED && toSeat.userId != null) {
                // Swap: move both users, preserving each user's mute state
                val toMuted = toSeat.isMuted
                transaction.update(docRef, mapOf(
                    "seats.$fromIndex" to Seat(userId = toSeat.userId, state = SeatState.OCCUPIED, isMuted = toMuted).toMap(),
                    "seats.$toIndex" to Seat(userId = userId, state = SeatState.OCCUPIED, isMuted = fromMuted).toMap()
                ))
            } else {
                // Move to empty seat
                transaction.update(docRef, mapOf(
                    "seats.$fromIndex" to Seat.EMPTY_MAP,
                    "seats.$toIndex" to Seat(userId = userId, state = SeatState.OCCUPIED, isMuted = fromMuted).toMap()
                ))
            }
        }.await()
    }

    override suspend fun kickUser(roomId: String, userId: String, seatIndex: Int?, kickerName: String, reason: String): Resource<Unit> = firebaseCall("Failed to kick user") {
        val updates = mutableMapOf<String, Any>(
            "participantIds" to FieldValue.arrayRemove(userId),
            "bannedUserIds" to FieldValue.arrayUnion(userId),
            "kickInfo.$userId" to mapOf(
                "kickerName" to kickerName,
                "reason" to reason.ifBlank { "No reason given" }
            )
        )
        if (seatIndex != null) {
            updates["seats.$seatIndex"] = Seat.EMPTY_MAP
        }
        roomsCollection.document(roomId).update(updates).await()
    }

    override suspend fun toggleMute(roomId: String, seatIndex: Int, isMuted: Boolean): Resource<Unit> = firebaseCall("Failed to toggle mute") {
        roomsCollection.document(roomId).update(
            "seats.$seatIndex.isMuted", isMuted
        ).await()
    }

    override suspend fun addHost(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to add host") {
        roomsCollection.document(roomId).update(
            mapOf(
                "hostIds" to FieldValue.arrayUnion(userId),
                "allTimeHostIds" to FieldValue.arrayUnion(userId)
            )
        ).await()
    }

    override suspend fun removeHost(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to remove host") {
        roomsCollection.document(roomId).update(
            "hostIds", FieldValue.arrayRemove(userId)
        ).await()
    }

    override suspend fun updateRoomName(roomId: String, newName: String): Resource<Unit> = firebaseCall("Failed to update room name") {
        roomsCollection.document(roomId).update("name", newName).await()
    }

    override suspend fun setRequireApproval(roomId: String, requireApproval: Boolean): Resource<Unit> = firebaseCall("Failed to update approval setting") {
        roomsCollection.document(roomId).update(
            "requireApproval", requireApproval
        ).await()
    }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> = firebaseCall("Failed to set owner away") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: return@runTransaction
            // Atomically set OWNER_AWAY and guarantee seat 0 stays occupied by the owner
            val currentMuted = room.seats[Constants.OWNER_SEAT_INDEX.toString()]?.isMuted ?: false
            val updates = mutableMapOf<String, Any>(
                "state" to RoomState.OWNER_AWAY.name,
                "ownerLeftAt" to Timestamp.now()
            )
            updates["seats.${Constants.OWNER_SEAT_INDEX}"] =
                Seat(userId = room.ownerId, state = SeatState.OCCUPIED, isMuted = currentMuted).toMap()
            transaction.update(docRef, updates)
        }.await()
    }

    override suspend fun setOwnerReturned(roomId: String, ownerId: String): Resource<Unit> = firebaseCall("Failed to set owner returned") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: return@runTransaction
            val currentMuted = room.seats[Constants.OWNER_SEAT_INDEX.toString()]?.isMuted ?: false
            val seat = Seat(userId = ownerId, state = SeatState.OCCUPIED, isMuted = currentMuted)
            transaction.update(docRef, mapOf(
                "state" to RoomState.ACTIVE.name,
                "ownerLeftAt" to null,
                "seats.${Constants.OWNER_SEAT_INDEX}" to seat.toMap()
            ))
        }.await()
    }

    override suspend fun sendInvite(roomId: String, userId: String, invitedBy: String): Resource<Unit> = firebaseCall("Failed to send invite") {
        roomsCollection.document(roomId).update(
            "pendingInvites.$userId", invitedBy
        ).await()
    }

    override suspend fun cancelInvite(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to cancel invite") {
        roomsCollection.document(roomId).update(
            "pendingInvites.$userId", FieldValue.delete()
        ).await()
    }

    override suspend fun acceptInvite(roomId: String, userId: String, seatIndex: Int): Resource<Unit> = firebaseCall("Failed to accept invite") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")

            val updates = clearUserSeats(room, userId)
            updates["pendingInvites.$userId"] = FieldValue.delete()

            // User already seated — just clear the invite, don't add another seat
            if (room.findUserSeat(userId) != null) {
                transaction.update(docRef, updates)
                return@runTransaction
            }

            // Find actual empty seat from transactional read (local state may be stale)
            val actualSeatIndex = if (room.seats[seatIndex.toString()]?.state != SeatState.OCCUPIED) {
                seatIndex
            } else {
                (1 until Constants.MAX_SEATS).firstOrNull { i ->
                    val s = room.seats[i.toString()]
                    s != null && s.state != SeatState.OCCUPIED
                } ?: return@runTransaction // No seats available
            }

            updates["seats.$actualSeatIndex"] = Seat(userId = userId, state = SeatState.OCCUPIED, isMuted = true).toMap()
            updates["allTimeSeatUserIds"] = FieldValue.arrayUnion(userId)
            transaction.update(docRef, updates)
        }.await()
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

    override suspend fun recordFirstJoinTimestamp(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to record first join timestamp") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val existing = (snapshot.get("firstJoinTimestamps") as? Map<*, *>)
            if (existing == null || !existing.containsKey(userId)) {
                transaction.update(docRef, "firstJoinTimestamps.$userId", Timestamp.now())
            }
        }.await()
    }

    override suspend fun leaveAllRooms(userId: String, exceptRoomId: String?): Resource<Unit> = firebaseCall("Failed to leave all rooms") {
        val snapshot = roomsCollection
            .whereArrayContains("participantIds", userId)
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .get()
            .await()
        val docsToUpdate = snapshot.documents.filter { it.id != exceptRoomId }
        if (docsToUpdate.isEmpty()) return@firebaseCall

        val batch = firestore.batch()
        for (doc in docsToUpdate) {
            val room = doc.data?.let { ChatRoom.fromMap(it, doc.id) } ?: continue
            if (room.ownerId == userId) {
                val otherParticipants = room.participantIds - userId
                val updates: MutableMap<String, Any> = if (otherParticipants.isEmpty()) {
                    // Nobody else in the room — close it
                    closeRoomUpdates().toMutableMap()
                } else {
                    // Others still present — keep owner in seat 0, mark away
                    val currentMuted = room.seats[Constants.OWNER_SEAT_INDEX.toString()]?.isMuted ?: false
                    val u = mutableMapOf<String, Any>()
                    u["participantIds"] = FieldValue.arrayRemove(userId)
                    u["state"] = RoomState.OWNER_AWAY.name
                    u["ownerLeftAt"] = Timestamp.now()
                    u["seats.${Constants.OWNER_SEAT_INDEX}"] =
                        Seat(userId = userId, state = SeatState.OCCUPIED, isMuted = currentMuted).toMap()
                    u
                }
                batch.update(roomsCollection.document(doc.id), updates)
            } else {
                val updates = clearUserSeats(room, userId)
                updates["participantIds"] = FieldValue.arrayRemove(userId)
                batch.update(roomsCollection.document(doc.id), updates)
            }
        }
        batch.commit().await()
    }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> = firebaseCall("Failed to close rooms") {
        val snapshot = roomsCollection
            .whereEqualTo("ownerId", ownerId)
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .get()
            .await()
        if (snapshot.documents.isEmpty()) return@firebaseCall
        val batch = firestore.batch()
        val closeUpdates = closeRoomUpdates()
        for (doc in snapshot.documents) {
            batch.update(roomsCollection.document(doc.id), closeUpdates)
        }
        batch.commit().await()
    }

    override suspend fun removeDisconnectedUser(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to remove disconnected user") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")

            if (userId !in room.participantIds) return@runTransaction

            val isOwner = room.ownerId == userId
            // Owner keeps seat 0 for reconnection — only clear non-owner seats
            val updates = if (isOwner) mutableMapOf() else clearUserSeats(room, userId)

            if (isOwner) {
                // Owner disconnected — mark away, keep in participants, guarantee seat 0
                val currentMuted = room.seats[Constants.OWNER_SEAT_INDEX.toString()]?.isMuted ?: false
                updates["state"] = RoomState.OWNER_AWAY.name
                updates["ownerLeftAt"] = Timestamp.now()
                updates["seats.${Constants.OWNER_SEAT_INDEX}"] =
                    Seat(userId = userId, state = SeatState.OCCUPIED, isMuted = currentMuted).toMap()
            } else {
                // Non-owner: clear seat only, keep in participantIds
                // (seat clearing already done by clearUserSeats above)
                // If no one is seated anymore and owner is away, close the room
                val seatsAfterClear = room.seats.toMutableMap()
                val userSeatKey = room.findUserSeat(userId)?.key
                if (userSeatKey != null) {
                    seatsAfterClear[userSeatKey] = Seat()
                }
                val anyoneOnMic = seatsAfterClear.any { (key, seat) ->
                    key != Constants.OWNER_SEAT_INDEX.toString() &&
                    seat.userId != null && seat.state == SeatState.OCCUPIED
                }
                if (!anyoneOnMic && room.state == RoomState.OWNER_AWAY) {
                    updates.putAll(closeRoomUpdates())
                }
            }

            if (updates.isNotEmpty()) {
                transaction.update(docRef, updates)
            }
        }.await()
    }

    override suspend fun closeRoom(roomId: String): Resource<Unit> = firebaseCall("Failed to close room") {
        roomsCollection.document(roomId).update(closeRoomUpdates()).await()
    }

    /** All fields needed to close a room: reset seats, set CLOSED state, clear participants. */
    private fun closeRoomUpdates(): Map<String, Any> = EMPTY_SEATS_UPDATE + mapOf(
        "state" to RoomState.CLOSED.name,
        "closedAt" to Timestamp.now(),
        "participantIds" to emptyList<String>()
    )

    private fun clearUserSeats(room: ChatRoom, userId: String): MutableMap<String, Any> {
        val updates = mutableMapOf<String, Any>()
        for ((key, seat) in room.seats) {
            if (seat.userId == userId && seat.state == SeatState.OCCUPIED) {
                // Owner must never be removed from seat 0
                if (key == Constants.OWNER_SEAT_INDEX.toString() && userId == room.ownerId) continue
                updates["seats.$key"] = Seat.EMPTY_MAP
            }
        }
        return updates
    }
}
