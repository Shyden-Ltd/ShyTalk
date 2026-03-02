package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.SeatRequest
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

class SeatRequestRepositoryImpl(
    private val api: WorkerApiClient,
    private val presenceService: PresenceService
) : SeatRequestRepository {

    override fun getPendingRequests(roomId: String): Flow<List<SeatRequest>> = merge(
        // Slow fallback poll — WebSocket handles real-time updates
        flow { while (true) { emit(Unit); delay(120_000) } },
        // Immediate refetch on seat request events
        presenceService.roomEvents
            .filter { it is RoomEvent.SeatRequestUpdated }
            .map { }
    ).transform {
        try {
            val arr = api.getArray("/api/rooms/$roomId/seat-requests")
            val requests = (0 until arr.length()).mapNotNull { i ->
                val obj = arr.getJSONObject(i)
                SeatRequest.fromMap(obj.toMap(), obj.getString("requestId"))
            }
            emit(requests)
        } catch (_: Exception) { }
    }.distinctUntilChanged()

    override fun getRequestsByUser(roomId: String, userId: String): Flow<List<SeatRequest>> = merge(
        // Slow fallback poll — WebSocket handles real-time updates
        flow { while (true) { emit(Unit); delay(120_000) } },
        // Immediate refetch on seat request events
        presenceService.roomEvents
            .filter { it is RoomEvent.SeatRequestUpdated }
            .map { }
    ).transform {
        try {
            val arr = api.getArray("/api/rooms/$roomId/seat-requests/user/$userId")
            val requests = (0 until arr.length()).mapNotNull { i ->
                val obj = arr.getJSONObject(i)
                SeatRequest.fromMap(obj.toMap(), obj.getString("requestId"))
            }
            emit(requests)
        } catch (_: Exception) { }
    }.distinctUntilChanged()

    override suspend fun createRequest(
        roomId: String,
        userId: String,
        userName: String,
        seatIndex: Int
    ): Resource<Unit> = firebaseCall("Failed to create seat request") {
        val body = JSONObject().apply {
            put("userName", userName)
            put("seatIndex", seatIndex)
        }
        api.post("/api/rooms/$roomId/seat-requests", body)
    }

    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String
    ): Resource<SeatRequest> = firebaseCall("Failed to approve request") {
        val body = JSONObject().apply { put("resolvedBy", resolvedBy) }
        val json = api.post("/api/rooms/$roomId/seat-requests/$requestId/approve", body)
        SeatRequest.fromMap(json.toMap(), json.getString("requestId"))
    }

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String
    ): Resource<Unit> = firebaseCall("Failed to deny request") {
        val body = JSONObject().apply { put("resolvedBy", resolvedBy) }
        api.post("/api/rooms/$roomId/seat-requests/$requestId/deny", body)
    }

    override suspend fun cancelApprovedRequest(
        roomId: String,
        requestId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to cancel approved request") {
        api.post("/api/rooms/$roomId/seat-requests/$requestId/cancel")
    }
}
