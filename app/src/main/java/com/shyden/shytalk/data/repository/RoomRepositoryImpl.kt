package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.RoomEvent
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.transform
import org.json.JSONObject

class RoomRepositoryImpl(
    private val api: WorkerApiClient,
    private val presenceService: PresenceService
) : RoomRepository {

    // Active rooms list is not tied to a specific room's DO — keep polling
    override fun getActiveRooms(): Flow<List<ChatRoom>> = flow {
        while (true) {
            try {
                val arr = api.getArray("/api/rooms/active")
                val rooms = (0 until arr.length()).mapNotNull { i ->
                    val obj = arr.getJSONObject(i)
                    ChatRoom.fromMap(obj.toMap(), obj.getString("roomId"))
                }
                emit(rooms)
            } catch (_: Exception) { }
            delay(3_000)
        }
    }.distinctUntilChanged()

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> = merge(
        // Slow fallback poll (10s)
        flow { while (true) { emit(Unit); delay(10_000) } },
        // Immediate refetch on room events
        presenceService.roomEvents
            .filter { it is RoomEvent.RoomUpdated || it is RoomEvent.RoomClosed }
            .map { }
    ).transform {
        try {
            val json = api.get("/api/rooms/$roomId")
            emit(ChatRoom.fromMap(json.toMap(), json.getString("roomId")))
        } catch (_: Exception) { }
    }.distinctUntilChanged()

    override suspend fun createRoom(name: String, ownerId: String): Resource<String> = firebaseCall("Failed to create room") {
        val body = JSONObject().apply { put("name", name) }
        val json = api.post("/api/rooms", body)
        json.getString("roomId")
    }

    override suspend fun joinRoom(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to join room") {
        api.post("/api/rooms/$roomId/join")
    }

    override suspend fun leaveRoom(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to leave room") {
        api.post("/api/rooms/$roomId/leave")
    }

    override suspend fun takeSeat(roomId: String, seatIndex: Int, userId: String): Resource<Unit> = firebaseCall("Failed to take seat") {
        api.post("/api/rooms/$roomId/seats/$seatIndex/take")
    }

    override suspend fun leaveSeat(roomId: String, seatIndex: Int): Resource<Unit> = firebaseCall("Failed to leave seat") {
        api.post("/api/rooms/$roomId/seats/$seatIndex/leave")
    }

    override suspend fun removeFromSeat(roomId: String, seatIndex: Int): Resource<Unit> {
        return leaveSeat(roomId, seatIndex)
    }

    override suspend fun moveSeat(roomId: String, fromIndex: Int, toIndex: Int, userId: String): Resource<Unit> = firebaseCall("Failed to move seat") {
        val body = JSONObject().apply {
            put("fromIndex", fromIndex)
            put("toIndex", toIndex)
            put("userId", userId)
        }
        api.post("/api/rooms/$roomId/seats/move", body)
    }

    override suspend fun kickUser(roomId: String, userId: String, seatIndex: Int?, kickerName: String, reason: String): Resource<Unit> = firebaseCall("Failed to kick user") {
        val body = JSONObject().apply {
            put("userId", userId)
            put("kickerName", kickerName)
            put("reason", reason.ifBlank { "No reason given" })
        }
        api.post("/api/rooms/$roomId/kick", body)
    }

    override suspend fun toggleMute(roomId: String, seatIndex: Int, isMuted: Boolean): Resource<Unit> = firebaseCall("Failed to toggle mute") {
        val body = JSONObject().apply { put("isMuted", isMuted) }
        api.patch("/api/rooms/$roomId/seats/$seatIndex/mute", body)
    }

    override suspend fun addHost(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to add host") {
        val body = JSONObject().apply { put("userId", userId) }
        api.post("/api/rooms/$roomId/hosts/add", body)
    }

    override suspend fun removeHost(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to remove host") {
        val body = JSONObject().apply { put("userId", userId) }
        api.post("/api/rooms/$roomId/hosts/remove", body)
    }

    override suspend fun updateRoomName(roomId: String, newName: String): Resource<Unit> = firebaseCall("Failed to update room name") {
        val body = JSONObject().apply { put("name", newName) }
        api.patch("/api/rooms/$roomId", body)
    }

    override suspend fun setRequireApproval(roomId: String, requireApproval: Boolean): Resource<Unit> = firebaseCall("Failed to update approval setting") {
        val body = JSONObject().apply { put("requireApproval", requireApproval) }
        api.patch("/api/rooms/$roomId", body)
    }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> = firebaseCall("Failed to set owner away") {
        api.post("/api/rooms/$roomId/owner-away")
    }

    override suspend fun setOwnerReturned(roomId: String, ownerId: String): Resource<Unit> = firebaseCall("Failed to set owner returned") {
        api.post("/api/rooms/$roomId/owner-return")
    }

    override suspend fun sendInvite(roomId: String, userId: String, invitedBy: String): Resource<Unit> = firebaseCall("Failed to send invite") {
        val body = JSONObject().apply {
            put("userId", userId)
            put("invitedBy", invitedBy)
        }
        api.post("/api/rooms/$roomId/invites/send", body)
    }

    override suspend fun cancelInvite(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to cancel invite") {
        val body = JSONObject().apply { put("userId", userId) }
        api.post("/api/rooms/$roomId/invites/cancel", body)
    }

    override suspend fun acceptInvite(roomId: String, userId: String, seatIndex: Int): Resource<Unit> = firebaseCall("Failed to accept invite") {
        val body = JSONObject().apply { put("seatIndex", seatIndex) }
        api.post("/api/rooms/$roomId/invites/accept", body)
    }

    override suspend fun closeRoom(roomId: String): Resource<Unit> = firebaseCall("Failed to close room") {
        api.post("/api/rooms/$roomId/close")
    }

    override suspend fun findActiveRoomByOwner(ownerId: String): String? {
        return try {
            val json = api.get("/api/rooms/by-owner/$ownerId")
            if (json.isNull("roomId")) null else json.getString("roomId")
        } catch (_: Exception) {
            null
        }
    }

    override suspend fun recordFirstJoinTimestamp(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to record first join timestamp") {
        api.post("/api/rooms/$roomId/first-join")
    }

    override suspend fun leaveAllRooms(userId: String, exceptRoomId: String?): Resource<Unit> = firebaseCall("Failed to leave all rooms") {
        val body = JSONObject().apply {
            if (exceptRoomId != null) put("exceptRoomId", exceptRoomId)
        }
        api.post("/api/rooms/leave-all", body)
    }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> = firebaseCall("Failed to close rooms") {
        api.post("/api/rooms/close-all")
    }

    override suspend fun removeDisconnectedUser(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to remove disconnected user") {
        val body = JSONObject().apply { put("userId", userId) }
        api.post("/api/rooms/$roomId/remove-disconnected", body)
    }
}
