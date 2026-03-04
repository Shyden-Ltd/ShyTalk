package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RoomRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: RoomRepositoryImpl
    private lateinit var mockDocRef: DocumentReference
    private lateinit var mockCollRef: CollectionReference
    private lateinit var mockDocSnapshot: DocumentSnapshot
    private lateinit var mockQuery: Query
    private lateinit var mockQuerySnapshot: QuerySnapshot

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        mockCollRef = mockk(relaxed = true)
        mockDocSnapshot = mockk(relaxed = true)
        mockQuery = mockk(relaxed = true)
        mockQuerySnapshot = mockk(relaxed = true)

        // Firestore path resolution
        every { firestore.document(any()) } returns mockDocRef
        every { firestore.collection(any()) } returns mockCollRef
        every { mockCollRef.document() } returns mockDocRef
        every { mockCollRef.document(any<String>()) } returns mockDocRef
        every { mockDocRef.id } returns "test-room-id"

        // Task-returning document operations
        every { mockDocRef.set(any()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<String>(), any()) } returns Tasks.forResult(null)
        every { mockDocRef.delete() } returns Tasks.forResult(null)
        every { mockDocRef.get() } returns Tasks.forResult(mockDocSnapshot)

        // DocumentSnapshot defaults (for leaveRoom, kickUser, closeRoom, etc.)
        every { mockDocSnapshot.exists() } returns true
        every { mockDocSnapshot.data } returns mapOf(
            "seats" to emptyMap<String, Any>(),
            "participantIds" to emptyList<String>()
        )

        // Query chain for collection queries (leaveAllRooms, closeAllRoomsByOwner)
        every { mockCollRef.whereArrayContains(any<String>(), any()) } returns mockQuery
        every { mockCollRef.whereEqualTo(any<String>(), any()) } returns mockQuery
        every { mockCollRef.whereIn(any<String>(), any<List<Any>>()) } returns mockQuery
        every { mockQuery.whereIn(any<String>(), any<List<Any>>()) } returns mockQuery
        every { mockQuery.whereArrayContains(any<String>(), any()) } returns mockQuery
        every { mockQuery.whereEqualTo(any<String>(), any()) } returns mockQuery
        every { mockQuery.get() } returns Tasks.forResult(mockQuerySnapshot)
        every { mockQuerySnapshot.documents } returns emptyList()

        repo = RoomRepositoryImpl(api, firestore)
    }

    // region createRoom

    @Test
    fun `createRoom returns Success with roomId`() = runTest {
        val result = repo.createRoom("My Room", "owner-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `createRoom returns Error on exception`() = runTest {
        every { mockDocRef.set(any()) } returns Tasks.forException(RuntimeException("Network error"))

        val result = repo.createRoom("My Room", "owner-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region joinRoom

    @Test
    fun `joinRoom returns Success`() = runTest {
        val result = repo.joinRoom("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `joinRoom returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.joinRoom("room-1", "user-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region leaveRoom

    @Test
    fun `leaveRoom returns Success`() = runTest {
        val result = repo.leaveRoom("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `leaveRoom returns Error on exception`() = runTest {
        every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.leaveRoom("room-1", "user-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region takeSeat

    @Test
    fun `takeSeat returns Success`() = runTest {
        val result = repo.takeSeat("room-1", 2, "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `takeSeat returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("No seats"))

        val result = repo.takeSeat("room-1", 2, "user-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region leaveSeat

    @Test
    fun `leaveSeat returns Success`() = runTest {
        val result = repo.leaveSeat("room-1", 3)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region removeFromSeat

    @Test
    fun `removeFromSeat delegates to leaveSeat`() = runTest {
        val result = repo.removeFromSeat("room-1", 3)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region moveSeat

    @Test
    fun `moveSeat returns Success`() = runTest {
        val result = repo.moveSeat("room-1", 2, 5, "user-a")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `moveSeat returns Error on exception`() = runTest {
        every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.moveSeat("room-1", 2, 5, "user-a")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region kickUser

    @Test
    fun `kickUser returns Success`() = runTest {
        val result = repo.kickUser("room-1", "bad-user", 2, "Admin", "Spamming")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `kickUser returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.kickUser("room-1", "bad-user", 2)
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region toggleMute

    @Test
    fun `toggleMute returns Success`() = runTest {
        val result = repo.toggleMute("room-1", 2, true)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region addHost / removeHost

    @Test
    fun `addHost returns Success`() = runTest {
        val result = repo.addHost("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeHost returns Success`() = runTest {
        val result = repo.removeHost("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region updateRoomName

    @Test
    fun `updateRoomName returns Success`() = runTest {
        val result = repo.updateRoomName("room-1", "New Name")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `updateRoomName returns Error on exception`() = runTest {
        every { mockDocRef.update(any<String>(), any()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.updateRoomName("room-1", "New Name")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region setRequireApproval

    @Test
    fun `setRequireApproval returns Success`() = runTest {
        val result = repo.setRequireApproval("room-1", true)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region setOwnerAway / setOwnerReturned

    @Test
    fun `setOwnerAway returns Success`() = runTest {
        val result = repo.setOwnerAway("room-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `setOwnerReturned returns Success`() = runTest {
        val result = repo.setOwnerReturned("room-1", "owner-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region sendInvite / cancelInvite / acceptInvite

    @Test
    fun `sendInvite returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/invites/send", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.sendInvite("room-1", "user-1", "owner-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `cancelInvite returns Success`() = runTest {
        val result = repo.cancelInvite("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `acceptInvite returns Success`() = runTest {
        val result = repo.acceptInvite("room-1", "user-1", 2)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region closeRoom

    @Test
    fun `closeRoom returns Success`() = runTest {
        val result = repo.closeRoom("room-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeRoom returns Error on exception`() = runTest {
        every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.closeRoom("room-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region recordFirstJoinTimestamp

    @Test
    fun `recordFirstJoinTimestamp returns Success`() = runTest {
        val result = repo.recordFirstJoinTimestamp("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region leaveAllRooms

    @Test
    fun `leaveAllRooms returns Success`() = runTest {
        val result = repo.leaveAllRooms("user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `leaveAllRooms with exceptRoomId returns Success`() = runTest {
        val result = repo.leaveAllRooms("user-1", "room-keep")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region closeAllRoomsByOwner

    @Test
    fun `closeAllRoomsByOwner returns Success`() = runTest {
        val result = repo.closeAllRoomsByOwner("owner-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeAllRoomsByOwner returns Error on exception`() = runTest {
        every { mockQuery.get() } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.closeAllRoomsByOwner("owner-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region removeDisconnectedUser

    @Test
    fun `removeDisconnectedUser returns Success`() = runTest {
        val result = repo.removeDisconnectedUser("room-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeDisconnectedUser returns Error on exception`() = runTest {
        every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.removeDisconnectedUser("room-1", "user-1")
        assertTrue(result is Resource.Error)
    }

    // endregion
}
