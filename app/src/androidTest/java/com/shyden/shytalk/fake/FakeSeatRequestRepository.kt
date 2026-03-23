package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.SeatRequestRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

class FakeSeatRequestRepository : SeatRequestRepository {
    override fun getPendingRequests(roomId: String): Flow<List<SeatRequest>> = flowOf(emptyList())

    override fun getRequestsByUser(
        roomId: String,
        userId: String,
    ): Flow<List<SeatRequest>> = flowOf(emptyList())

    override suspend fun createRequest(
        roomId: String,
        userId: String,
        userName: String,
        seatIndex: Int,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<SeatRequest> =
        Resource.Success(SeatRequest(requestId = requestId, status = SeatRequestStatus.APPROVED, resolvedBy = resolvedBy))

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun cancelApprovedRequest(
        roomId: String,
        requestId: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)
}
