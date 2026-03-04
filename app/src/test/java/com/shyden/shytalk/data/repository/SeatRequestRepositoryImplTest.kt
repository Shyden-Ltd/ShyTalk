package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SeatRequestRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: SeatRequestRepositoryImpl
    private lateinit var mockDocRef: DocumentReference
    private lateinit var mockDocSnapshot: DocumentSnapshot

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        mockDocSnapshot = mockk(relaxed = true)

        every { firestore.document(any()) } returns mockDocRef
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)
        every { mockDocRef.get() } returns Tasks.forResult(mockDocSnapshot)

        // Default snapshot data for approveRequest (SeatRequest.fromMap)
        every { mockDocSnapshot.data } returns mapOf(
            "userId" to "user-1",
            "userName" to "Alice",
            "seatIndex" to 2L,
            "status" to "APPROVED",
            "resolvedBy" to "owner-1",
            "resolvedAt" to 1700000000000L,
            "createdAt" to 1699999000000L
        )

        repo = SeatRequestRepositoryImpl(api, firestore)
    }

    // region createRequest — Worker API (needs FCM push)

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

    // region approveRequest — direct Firestore

    @Test
    fun `approveRequest returns Success`() = runTest {
        val result = repo.approveRequest("room-1", "req-1", "owner-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `approveRequest returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.approveRequest("room-1", "req-1", "owner-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region denyRequest — direct Firestore

    @Test
    fun `denyRequest returns Success`() = runTest {
        val result = repo.denyRequest("room-1", "req-1", "owner-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `denyRequest returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.denyRequest("room-1", "req-1", "owner-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region cancelApprovedRequest — direct Firestore

    @Test
    fun `cancelApprovedRequest returns Success`() = runTest {
        val result = repo.cancelApprovedRequest("room-1", "req-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `cancelApprovedRequest returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.cancelApprovedRequest("room-1", "req-1", "user-1")
        assertTrue(result is Resource.Error)
    }

    // endregion
}
