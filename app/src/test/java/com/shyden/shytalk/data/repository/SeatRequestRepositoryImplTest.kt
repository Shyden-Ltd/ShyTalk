package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SeatRequestRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var presenceService: PresenceService
    private lateinit var repo: SeatRequestRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        presenceService = mockk(relaxed = true)
        repo = SeatRequestRepositoryImpl(api, presenceService)
    }

    // region createRequest

    @Test
    fun `createRequest returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests", any()) } returns JSONObject().apply {
            put("requestId", "req-1")
        }

        val result = repo.createRequest("room-1", "user-1", "Alice", 2)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/seat-requests", any()) }
    }

    @Test
    fun `createRequest returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests", any()) } throws RuntimeException("Fail")

        val result = repo.createRequest("room-1", "user-1", "Alice", 2)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region approveRequest

    @Test
    fun `approveRequest returns Success with parsed SeatRequest`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests/req-1/approve", any()) } returns JSONObject().apply {
            put("requestId", "req-1")
            put("userId", "user-1")
            put("userName", "Alice")
            put("seatIndex", 2)
            put("status", "APPROVED")
            put("resolvedBy", "owner-1")
            put("resolvedAt", 1700000000000L)
            put("createdAt", 1699999000000L)
        }

        val result = repo.approveRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Success)
        val approved = (result as Resource.Success).data
        assertEquals("user-1", approved.userId)
        assertEquals("Alice", approved.userName)
        assertEquals(2, approved.seatIndex)
        assertEquals(SeatRequestStatus.APPROVED, approved.status)
    }

    @Test
    fun `approveRequest returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests/req-1/approve", any()) } throws RuntimeException("Fail")

        val result = repo.approveRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region denyRequest

    @Test
    fun `denyRequest returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests/req-1/deny", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.denyRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/seat-requests/req-1/deny", any()) }
    }

    @Test
    fun `denyRequest returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests/req-1/deny", any()) } throws RuntimeException("Fail")

        val result = repo.denyRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region cancelApprovedRequest

    @Test
    fun `cancelApprovedRequest returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests/req-1/cancel", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.cancelApprovedRequest("room-1", "req-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `cancelApprovedRequest returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seat-requests/req-1/cancel", any()) } throws RuntimeException("Fail")

        val result = repo.cancelApprovedRequest("room-1", "req-1", "user-1")

        assertTrue(result is Resource.Error)
    }

    // endregion
}
