package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SeatRequestRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var roomsCollection: CollectionReference
    private lateinit var roomDoc: DocumentReference
    private lateinit var requestsCollection: CollectionReference
    private lateinit var requestDoc: DocumentReference
    private lateinit var repo: SeatRequestRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        roomsCollection = mockk(relaxed = true)
        roomDoc = mockk(relaxed = true)
        requestsCollection = mockk(relaxed = true)
        requestDoc = mockk(relaxed = true)

        every { firestore.collection("rooms") } returns roomsCollection
        every { roomsCollection.document(any<String>()) } returns roomDoc
        every { roomDoc.collection("seatRequests") } returns requestsCollection
        every { requestsCollection.document(any<String>()) } returns requestDoc

        repo = SeatRequestRepositoryImpl(firestore)
    }

    @Test
    fun `createRequest returns Success when no existing pending request`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val querySnapshot = mockk<QuerySnapshot> { every { isEmpty } returns true }
        every { requestsCollection.whereEqualTo("userId", "user-1") } returns query
        every { query.whereEqualTo("status", SeatRequestStatus.PENDING.name) } returns query
        every { query.get() } returns Tasks.forResult(querySnapshot)
        every { requestDoc.set(any()) } returns Tasks.forResult(null)

        val result = repo.createRequest("room-1", "user-1", "Alice", 2)

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `createRequest is no-op when pending request already exists`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val querySnapshot = mockk<QuerySnapshot> { every { isEmpty } returns false }
        every { requestsCollection.whereEqualTo("userId", "user-1") } returns query
        every { query.whereEqualTo("status", SeatRequestStatus.PENDING.name) } returns query
        every { query.get() } returns Tasks.forResult(querySnapshot)

        val result = repo.createRequest("room-1", "user-1", "Alice", 2)

        assertTrue(result is Resource.Success)
        // Should NOT have written a new document
        verify(exactly = 0) { requestDoc.set(any()) }
    }

    @Test
    fun `approveRequest updates status and returns request`() = runTest {
        val mapSlot = slot<Map<String, Any?>>()
        every { requestDoc.update(capture(mapSlot)) } returns Tasks.forResult(null)
        val docSnapshot = mockk<DocumentSnapshot> {
            every { id } returns "req-1"
            every { data } returns mapOf(
                "requestId" to "req-1",
                "userId" to "user-1",
                "userName" to "Alice",
                "seatIndex" to 2L,
                "status" to "APPROVED",
                "resolvedBy" to "owner-1"
            )
        }
        every { requestDoc.get() } returns Tasks.forResult(docSnapshot)

        val result = repo.approveRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Success)
        val updateData = mapSlot.captured
        assertTrue(updateData["status"] == SeatRequestStatus.APPROVED.name)
        assertTrue(updateData["resolvedBy"] == "owner-1")
    }

    @Test
    fun `denyRequest updates status to DENIED`() = runTest {
        val mapSlot = slot<Map<String, Any?>>()
        every { requestDoc.update(capture(mapSlot)) } returns Tasks.forResult(null)

        val result = repo.denyRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Success)
        val updateData = mapSlot.captured
        assertTrue(updateData["status"] == SeatRequestStatus.DENIED.name)
        assertTrue(updateData["resolvedBy"] == "owner-1")
    }

    @Test
    fun `approveRequest returns Error on exception`() = runTest {
        every { requestDoc.update(any<Map<String, Any?>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.approveRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `denyRequest returns Error on exception`() = runTest {
        every { requestDoc.update(any<Map<String, Any?>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.denyRequest("room-1", "req-1", "owner-1")

        assertTrue(result is Resource.Error)
    }
}
