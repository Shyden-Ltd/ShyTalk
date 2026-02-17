package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.Transaction
import com.google.firebase.firestore.WriteBatch
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
        val transaction = mockk<Transaction>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>(relaxed = true)
        every { snapshot.data } returns mapOf(
            "ownerId" to "owner-1",
            "state" to "ACTIVE",
            "participantIds" to listOf("owner-1", "user-1")
        )
        every { snapshot.id } returns "room-1"
        every { transaction.get(docRef) } returns snapshot
        every { firestore.runTransaction(any<Transaction.Function<*>>()) } answers {
            val fn = firstArg<Transaction.Function<*>>()
            fn.apply(transaction)
            Tasks.forResult(null)
        }

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

    private fun setupMoveSeatTransaction(
        seats: Map<String, Map<String, Any?>> = mapOf(
            "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to false),
            "2" to mapOf("userId" to "user-a", "state" to "OCCUPIED", "isMuted" to true),
            "5" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
        )
    ): Pair<Transaction, MutableList<Map<String, Any>>> {
        val transaction = mockk<Transaction>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>(relaxed = true)
        every { snapshot.data } returns mapOf(
            "ownerId" to "owner-1",
            "state" to "ACTIVE",
            "participantIds" to listOf("owner-1", "user-a"),
            "seats" to seats
        )
        every { snapshot.id } returns "room-1"
        every { transaction.get(docRef) } returns snapshot
        val updateSlots = mutableListOf<Map<String, Any>>()
        every { transaction.update(docRef, capture(updateSlots)) } returns transaction
        every { firestore.runTransaction(any<Transaction.Function<*>>()) } answers {
            val fn = firstArg<Transaction.Function<*>>()
            fn.apply(transaction)
            Tasks.forResult(null)
        }
        return transaction to updateSlots
    }

    @Test
    fun `moveSeat returns Success`() = runTest {
        every { firestore.runTransaction(any<Transaction.Function<Any?>>()) } returns Tasks.forResult(null)

        val result = repo.moveSeat("room-1", 1, 3, "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `moveSeat clears user from all seats before placing in destination`() = runTest {
        val (_, updateSlots) = setupMoveSeatTransaction()

        val result = repo.moveSeat("room-1", 2, 5, "user-a")

        assertTrue(result is Resource.Success)
        val updates = updateSlots.first()
        // clearUserSeats should have set seat 2 to empty, then destination seat 5 gets the user
        assertTrue(updates.containsKey("seats.5"))
        @Suppress("UNCHECKED_CAST")
        val destSeat = updates["seats.5"] as Map<String, Any?>
        assertEquals("user-a", destSeat["userId"])
    }

    @Test
    fun `moveSeat aborts if user not in source seat`() = runTest {
        val (_, updateSlots) = setupMoveSeatTransaction()

        // Try to move "user-b" from seat 2, but seat 2 has "user-a"
        val result = repo.moveSeat("room-1", 2, 5, "user-b")

        assertTrue(result is Resource.Success) // transaction still succeeds, just no-op
        assertTrue(updateSlots.isEmpty()) // no updates were made
    }

    @Test
    fun `moveSeat swap preserves mute states`() = runTest {
        val (_, updateSlots) = setupMoveSeatTransaction(
            seats = mapOf(
                "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to false),
                "2" to mapOf("userId" to "user-a", "state" to "OCCUPIED", "isMuted" to true),
                "5" to mapOf("userId" to "user-b", "state" to "OCCUPIED", "isMuted" to false)
            )
        )

        val result = repo.moveSeat("room-1", 2, 5, "user-a")

        assertTrue(result is Resource.Success)
        val updates = updateSlots.first()
        // user-a moves to seat 5 with their original mute state (true)
        @Suppress("UNCHECKED_CAST")
        val destSeat = updates["seats.5"] as Map<String, Any?>
        assertEquals("user-a", destSeat["userId"])
        assertEquals(true, destSeat["isMuted"])
        // user-b swaps to seat 2 with their original mute state (false)
        @Suppress("UNCHECKED_CAST")
        val srcSeat = updates["seats.2"] as Map<String, Any?>
        assertEquals("user-b", srcSeat["userId"])
        assertEquals(false, srcSeat["isMuted"])
    }

    // --- kickUser ---

    private fun setupKickUserTransaction(): Pair<Transaction, MutableList<Map<String, Any>>> {
        val transaction = mockk<Transaction>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>(relaxed = true)
        every { snapshot.data } returns mapOf(
            "ownerId" to "owner-1",
            "state" to "ACTIVE",
            "participantIds" to listOf("owner-1", "bad-user"),
            "seats" to mapOf(
                "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to false),
                "2" to mapOf("userId" to "bad-user", "state" to "OCCUPIED", "isMuted" to false)
            )
        )
        every { snapshot.id } returns "room-1"
        every { transaction.get(docRef) } returns snapshot
        val updateSlots = mutableListOf<Map<String, Any>>()
        every { transaction.update(docRef, capture(updateSlots)) } returns transaction
        every { firestore.runTransaction(any<Transaction.Function<*>>()) } answers {
            val fn = firstArg<Transaction.Function<*>>()
            fn.apply(transaction)
            Tasks.forResult(null)
        }
        return transaction to updateSlots
    }

    @Test
    fun `kickUser clears all seats for user`() = runTest {
        val (_, updateSlots) = setupKickUserTransaction()

        val result = repo.kickUser("room-1", "bad-user", 2)

        assertTrue(result is Resource.Success)
        val updates = updateSlots.first()
        assertTrue(updates.containsKey("seats.2"))
    }

    @Test
    fun `kickUser without seatIndex still clears occupied seat`() = runTest {
        val (_, updateSlots) = setupKickUserTransaction()

        val result = repo.kickUser("room-1", "bad-user", null)

        assertTrue(result is Resource.Success)
        val updates = updateSlots.first()
        // clearUserSeats finds seat 2 and clears it even without explicit seatIndex
        assertTrue(updates.containsKey("seats.2"))
    }

    @Test
    fun `kickUser stores kickInfo with kicker name and reason`() = runTest {
        val (_, updateSlots) = setupKickUserTransaction()

        val result = repo.kickUser("room-1", "bad-user", 2, "Admin", "Spamming")

        assertTrue(result is Resource.Success)
        @Suppress("UNCHECKED_CAST")
        val kickInfo = updateSlots.first()["kickInfo.bad-user"] as Map<String, String>
        assertEquals("Admin", kickInfo["kickerName"])
        assertEquals("Spamming", kickInfo["reason"])
    }

    @Test
    fun `kickUser with blank reason defaults to No reason given`() = runTest {
        val (_, updateSlots) = setupKickUserTransaction()

        val result = repo.kickUser("room-1", "bad-user", 2, "Admin", "")

        assertTrue(result is Resource.Success)
        @Suppress("UNCHECKED_CAST")
        val kickInfo = updateSlots.first()["kickInfo.bad-user"] as Map<String, String>
        assertEquals("No reason given", kickInfo["reason"])
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
        every { docRef.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)

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
        every { firestore.runTransaction(any<Transaction.Function<Any?>>()) } returns Tasks.forResult(null)

        val result = repo.setOwnerAway("room-1")

        assertTrue(result is Resource.Success)
    }

    // --- setOwnerReturned ---

    @Test
    fun `setOwnerReturned returns Success`() = runTest {
        every { firestore.runTransaction(any<Transaction.Function<Any?>>()) } returns Tasks.forResult(null)

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

    // --- updateRoomName ---

    @Test
    fun `updateRoomName returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.updateRoomName("room-1", "New Name")

        assertTrue(result is Resource.Success)
        verify { docRef.update("name", "New Name") }
    }

    @Test
    fun `updateRoomName returns Error on exception`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forException(RuntimeException("fail"))

        val result = repo.updateRoomName("room-1", "New Name")

        assertTrue(result is Resource.Error)
    }

    // --- mute state preservation ---

    @Test
    fun `setOwnerAway preserves isMuted from seat 0`() = runTest {
        val transaction = mockk<Transaction>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>(relaxed = true)
        every { snapshot.data } returns mapOf(
            "ownerId" to "owner-1",
            "state" to "ACTIVE",
            "participantIds" to listOf("owner-1", "user-2"),
            "seats" to mapOf(
                "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to true),
                "1" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "2" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "3" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "4" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "5" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "6" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "7" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            )
        )
        every { snapshot.id } returns "room-1"
        every { transaction.get(docRef) } returns snapshot
        val updateSlot = slot<Map<String, Any>>()
        every { transaction.update(docRef, capture(updateSlot)) } returns transaction
        every { firestore.runTransaction(any<Transaction.Function<*>>()) } answers {
            val fn = firstArg<Transaction.Function<*>>()
            fn.apply(transaction)
            Tasks.forResult(null)
        }

        val result = repo.setOwnerAway("room-1")

        assertTrue(result is Resource.Success)
        @Suppress("UNCHECKED_CAST")
        val seatMap = updateSlot.captured["seats.0"] as Map<String, Any?>
        assertEquals(true, seatMap["isMuted"])
    }

    @Test
    fun `setOwnerReturned preserves isMuted from seat 0`() = runTest {
        val transaction = mockk<Transaction>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>(relaxed = true)
        every { snapshot.data } returns mapOf(
            "ownerId" to "owner-1",
            "state" to "OWNER_AWAY",
            "participantIds" to listOf("owner-1", "user-2"),
            "seats" to mapOf(
                "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to true),
                "1" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "2" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "3" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "4" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "5" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "6" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "7" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            )
        )
        every { snapshot.id } returns "room-1"
        every { transaction.get(docRef) } returns snapshot
        val updateSlot = slot<Map<String, Any>>()
        every { transaction.update(docRef, capture(updateSlot)) } returns transaction
        every { firestore.runTransaction(any<Transaction.Function<*>>()) } answers {
            val fn = firstArg<Transaction.Function<*>>()
            fn.apply(transaction)
            Tasks.forResult(null)
        }

        val result = repo.setOwnerReturned("room-1", "owner-1")

        assertTrue(result is Resource.Success)
        @Suppress("UNCHECKED_CAST")
        val seatMap = updateSlot.captured["seats.0"] as Map<String, Any?>
        assertEquals(true, seatMap["isMuted"])
    }

    @Test
    fun `removeDisconnectedUser preserves owner isMuted during OWNER_AWAY`() = runTest {
        val transaction = mockk<Transaction>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>(relaxed = true)
        every { snapshot.data } returns mapOf(
            "ownerId" to "owner-1",
            "state" to "ACTIVE",
            "participantIds" to listOf("owner-1", "user-2"),
            "seats" to mapOf(
                "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to true),
                "1" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "2" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "3" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "4" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "5" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "6" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false),
                "7" to mapOf("userId" to null, "state" to "EMPTY", "isMuted" to false)
            )
        )
        every { snapshot.id } returns "room-1"
        every { transaction.get(docRef) } returns snapshot
        val updateSlot = slot<Map<String, Any>>()
        every { transaction.update(docRef, capture(updateSlot)) } returns transaction
        every { firestore.runTransaction(any<Transaction.Function<*>>()) } answers {
            val fn = firstArg<Transaction.Function<*>>()
            fn.apply(transaction)
            Tasks.forResult(null)
        }

        val result = repo.removeDisconnectedUser("room-1", "owner-1")

        assertTrue(result is Resource.Success)
        @Suppress("UNCHECKED_CAST")
        val seatMap = updateSlot.captured["seats.0"] as Map<String, Any?>
        assertEquals(true, seatMap["isMuted"])
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
        val batch = mockk<WriteBatch>(relaxed = true)
        every { firestore.batch() } returns batch
        every { batch.commit() } returns Tasks.forResult(null)

        val result = repo.closeAllRoomsByOwner("owner-1")

        assertTrue(result is Resource.Success)
        verify(exactly = 2) { batch.update(any<DocumentReference>(), any<Map<String, Any>>()) }
    }
}
