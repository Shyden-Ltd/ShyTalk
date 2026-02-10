package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.Transaction
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RoomRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var roomsCollection: CollectionReference
    private lateinit var docRef: DocumentReference
    private lateinit var repo: RoomRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        roomsCollection = mockk(relaxed = true)
        docRef = mockk(relaxed = true)
        every { firestore.collection("rooms") } returns roomsCollection
        every { roomsCollection.document(any<String>()) } returns docRef
        repo = RoomRepositoryImpl(firestore)
    }

    // --- createRoom ---

    @Test
    fun `createRoom returns Success with roomId`() = runTest {
        every { docRef.set(any()) } returns Tasks.forResult(null)

        val result = repo.createRoom("My Room", "owner-1")

        assertTrue(result is Resource.Success)
        assertNotNull((result as Resource.Success).data)
    }

    @Test
    fun `createRoom returns Error on exception`() = runTest {
        every { docRef.set(any()) } returns Tasks.forException(RuntimeException("Firestore error"))

        val result = repo.createRoom("My Room", "owner-1")

        assertTrue(result is Resource.Error)
    }

    // --- joinRoom ---

    @Test
    fun `joinRoom returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.joinRoom("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `joinRoom returns Error on exception`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.joinRoom("room-1", "user-1")

        assertTrue(result is Resource.Error)
    }

    // --- leaveRoom ---

    @Test
    fun `leaveRoom returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.leaveRoom("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // --- leaveSeat ---

    @Test
    fun `leaveSeat returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.leaveSeat("room-1", 3)

        assertTrue(result is Resource.Success)
    }

    // --- removeFromSeat delegates to leaveSeat ---

    @Test
    fun `removeFromSeat delegates to leaveSeat`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.removeFromSeat("room-1", 3)

        assertTrue(result is Resource.Success)
    }

    // --- moveSeat ---

    @Test
    fun `moveSeat returns Success`() = runTest {
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val result = repo.moveSeat("room-1", 1, 3, "user-1")

        assertTrue(result is Resource.Success)
    }

    // --- kickUser ---

    @Test
    fun `kickUser with seatIndex clears seat`() = runTest {
        val mapSlot = slot<Map<String, Any>>()
        every { docRef.update(capture(mapSlot)) } returns Tasks.forResult(null)

        val result = repo.kickUser("room-1", "bad-user", 2)

        assertTrue(result is Resource.Success)
        assertTrue(mapSlot.captured.containsKey("seats.2"))
    }

    @Test
    fun `kickUser without seatIndex does not clear seat`() = runTest {
        val mapSlot = slot<Map<String, Any>>()
        every { docRef.update(capture(mapSlot)) } returns Tasks.forResult(null)

        val result = repo.kickUser("room-1", "bad-user", null)

        assertTrue(result is Resource.Success)
        assertTrue(mapSlot.captured.keys.none { it.startsWith("seats.") })
    }

    // --- toggleMute ---

    @Test
    fun `toggleMute returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.toggleMute("room-1", 2, true)

        assertTrue(result is Resource.Success)
        verify { docRef.update("seats.2.isMuted", true) }
    }

    // --- addHost / removeHost ---

    @Test
    fun `addHost returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.addHost("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeHost returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.removeHost("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // --- setRequireApproval ---

    @Test
    fun `setRequireApproval returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.setRequireApproval("room-1", true)

        assertTrue(result is Resource.Success)
        verify { docRef.update("requireApproval", true) }
    }

    // --- setOwnerAway ---

    @Test
    fun `setOwnerAway returns Success`() = runTest {
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val result = repo.setOwnerAway("room-1")

        assertTrue(result is Resource.Success)
    }

    // --- setOwnerReturned ---

    @Test
    fun `setOwnerReturned returns Success`() = runTest {
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val result = repo.setOwnerReturned("room-1", "owner-1")

        assertTrue(result is Resource.Success)
    }

    // --- sendInvite / cancelInvite ---

    @Test
    fun `sendInvite returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.sendInvite("room-1", "user-1", "owner-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `cancelInvite returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.cancelInvite("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // --- findActiveRoomByOwner ---

    @Test
    fun `findActiveRoomByOwner returns roomId when found`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val doc = mockk<DocumentSnapshot> { every { id } returns "room-42" }
        val querySnapshot = mockk<QuerySnapshot> { every { documents } returns listOf(doc) }
        every { roomsCollection.whereEqualTo("ownerId", "owner-1") } returns query
        every { query.whereIn("state", any()) } returns query
        every { query.get() } returns Tasks.forResult(querySnapshot)

        val result = repo.findActiveRoomByOwner("owner-1")

        assertEquals("room-42", result)
    }

    @Test
    fun `findActiveRoomByOwner returns null when not found`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val querySnapshot = mockk<QuerySnapshot> { every { documents } returns emptyList() }
        every { roomsCollection.whereEqualTo("ownerId", "owner-1") } returns query
        every { query.whereIn("state", any()) } returns query
        every { query.get() } returns Tasks.forResult(querySnapshot)

        val result = repo.findActiveRoomByOwner("owner-1")

        assertNull(result)
    }

    @Test
    fun `findActiveRoomByOwner returns null on exception`() = runTest {
        val query = mockk<Query>(relaxed = true)
        every { roomsCollection.whereEqualTo("ownerId", "owner-1") } returns query
        every { query.whereIn("state", any()) } returns query
        every { query.get() } returns Tasks.forException(RuntimeException("fail"))

        val result = repo.findActiveRoomByOwner("owner-1")

        assertNull(result)
    }

    // --- closeRoom ---

    @Test
    fun `closeRoom returns Success`() = runTest {
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val result = repo.closeRoom("room-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeRoom returns Error on exception`() = runTest {
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forException(RuntimeException("fail"))

        val result = repo.closeRoom("room-1")

        assertTrue(result is Resource.Error)
    }

    // --- closeAllRoomsByOwner ---

    @Test
    fun `closeAllRoomsByOwner closes all matching rooms`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val doc1 = mockk<DocumentSnapshot> { every { id } returns "room-1" }
        val doc2 = mockk<DocumentSnapshot> { every { id } returns "room-2" }
        val querySnapshot = mockk<QuerySnapshot> { every { documents } returns listOf(doc1, doc2) }
        every { roomsCollection.whereEqualTo("ownerId", "owner-1") } returns query
        every { query.whereIn("state", any()) } returns query
        every { query.get() } returns Tasks.forResult(querySnapshot)
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val result = repo.closeAllRoomsByOwner("owner-1")

        assertTrue(result is Resource.Success)
    }
}
