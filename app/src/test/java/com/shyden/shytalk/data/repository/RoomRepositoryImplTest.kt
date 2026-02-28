package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RoomRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var presenceService: PresenceService
    private lateinit var repo: RoomRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        presenceService = mockk(relaxed = true)
        repo = RoomRepositoryImpl(api, presenceService)
    }

    // region createRoom

    @Test
    fun `createRoom returns Success with roomId`() = runTest {
        coEvery { api.post("/api/rooms", any()) } returns JSONObject().apply {
            put("roomId", "room-abc")
            put("voiceRoomName", "room-abc")
        }

        val result = repo.createRoom("My Room", "owner-1")

        assertTrue(result is Resource.Success)
        assertEquals("room-abc", (result as Resource.Success).data)
    }

    @Test
    fun `createRoom returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms", any()) } throws RuntimeException("Network error")

        val result = repo.createRoom("My Room", "owner-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region joinRoom

    @Test
    fun `joinRoom returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/join", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.joinRoom("room-1", "user-1")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/join", any()) }
    }

    @Test
    fun `joinRoom returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/join", any()) } throws RuntimeException("Fail")

        val result = repo.joinRoom("room-1", "user-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region leaveRoom

    @Test
    fun `leaveRoom returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/leave", any()) } returns JSONObject().apply {
            put("success", true)
            put("roomClosed", false)
        }

        val result = repo.leaveRoom("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `leaveRoom returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/leave", any()) } throws RuntimeException("Fail")

        val result = repo.leaveRoom("room-1", "user-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region takeSeat

    @Test
    fun `takeSeat returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seats/2/take", any()) } returns JSONObject().apply {
            put("success", true)
            put("seatIndex", 2)
        }

        val result = repo.takeSeat("room-1", 2, "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `takeSeat returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seats/2/take", any()) } throws RuntimeException("No seats")

        val result = repo.takeSeat("room-1", 2, "user-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region leaveSeat

    @Test
    fun `leaveSeat returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seats/3/leave", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.leaveSeat("room-1", 3)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region removeFromSeat delegates to leaveSeat

    @Test
    fun `removeFromSeat delegates to leaveSeat`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seats/3/leave", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.removeFromSeat("room-1", 3)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/seats/3/leave", any()) }
    }

    // endregion

    // region moveSeat

    @Test
    fun `moveSeat returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seats/move", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.moveSeat("room-1", 2, 5, "user-a")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/seats/move", any()) }
    }

    @Test
    fun `moveSeat returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/seats/move", any()) } throws RuntimeException("Fail")

        val result = repo.moveSeat("room-1", 2, 5, "user-a")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region kickUser

    @Test
    fun `kickUser returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/kick", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.kickUser("room-1", "bad-user", 2, "Admin", "Spamming")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/kick", any()) }
    }

    @Test
    fun `kickUser returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/kick", any()) } throws RuntimeException("Fail")

        val result = repo.kickUser("room-1", "bad-user", 2)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region toggleMute

    @Test
    fun `toggleMute returns Success`() = runTest {
        coEvery { api.patch("/api/rooms/room-1/seats/2/mute", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.toggleMute("room-1", 2, true)

        assertTrue(result is Resource.Success)
        coVerify { api.patch("/api/rooms/room-1/seats/2/mute", any()) }
    }

    // endregion

    // region addHost / removeHost

    @Test
    fun `addHost returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/hosts/add", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.addHost("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeHost returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/hosts/remove", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.removeHost("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region updateRoomName

    @Test
    fun `updateRoomName returns Success`() = runTest {
        coEvery { api.patch("/api/rooms/room-1", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.updateRoomName("room-1", "New Name")

        assertTrue(result is Resource.Success)
        coVerify { api.patch("/api/rooms/room-1", any()) }
    }

    @Test
    fun `updateRoomName returns Error on exception`() = runTest {
        coEvery { api.patch("/api/rooms/room-1", any()) } throws RuntimeException("Fail")

        val result = repo.updateRoomName("room-1", "New Name")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region setRequireApproval

    @Test
    fun `setRequireApproval returns Success`() = runTest {
        coEvery { api.patch("/api/rooms/room-1", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.setRequireApproval("room-1", true)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region setOwnerAway / setOwnerReturned

    @Test
    fun `setOwnerAway returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/owner-away", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.setOwnerAway("room-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `setOwnerReturned returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/owner-return", any()) } returns JSONObject().apply {
            put("success", true)
        }

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
        coEvery { api.post("/api/rooms/room-1/invites/cancel", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.cancelInvite("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `acceptInvite returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/invites/accept", any()) } returns JSONObject().apply {
            put("success", true)
            put("seatIndex", 2)
        }

        val result = repo.acceptInvite("room-1", "user-1", 2)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region closeRoom

    @Test
    fun `closeRoom returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/close", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.closeRoom("room-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeRoom returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/close", any()) } throws RuntimeException("Fail")

        val result = repo.closeRoom("room-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region findActiveRoomByOwner

    @Test
    fun `findActiveRoomByOwner returns roomId when found`() = runTest {
        coEvery { api.get("/api/rooms/by-owner/owner-1") } returns JSONObject().apply {
            put("roomId", "room-42")
        }

        val result = repo.findActiveRoomByOwner("owner-1")

        assertEquals("room-42", result)
    }

    @Test
    fun `findActiveRoomByOwner returns null when not found`() = runTest {
        coEvery { api.get("/api/rooms/by-owner/owner-1") } returns JSONObject().apply {
            put("roomId", JSONObject.NULL)
        }

        val result = repo.findActiveRoomByOwner("owner-1")

        assertNull(result)
    }

    @Test
    fun `findActiveRoomByOwner returns null on exception`() = runTest {
        coEvery { api.get("/api/rooms/by-owner/owner-1") } throws RuntimeException("Fail")

        val result = repo.findActiveRoomByOwner("owner-1")

        assertNull(result)
    }

    // endregion

    // region recordFirstJoinTimestamp

    @Test
    fun `recordFirstJoinTimestamp returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/first-join", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.recordFirstJoinTimestamp("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region leaveAllRooms

    @Test
    fun `leaveAllRooms returns Success`() = runTest {
        coEvery { api.post("/api/rooms/leave-all", any()) } returns JSONObject().apply {
            put("success", true)
            put("roomsLeft", 2)
        }

        val result = repo.leaveAllRooms("user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `leaveAllRooms with exceptRoomId calls correct endpoint`() = runTest {
        coEvery { api.post("/api/rooms/leave-all", any()) } returns JSONObject().apply {
            put("success", true)
            put("roomsLeft", 1)
        }

        val result = repo.leaveAllRooms("user-1", "room-keep")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/leave-all", any()) }
    }

    // endregion

    // region closeAllRoomsByOwner

    @Test
    fun `closeAllRoomsByOwner returns Success`() = runTest {
        coEvery { api.post("/api/rooms/close-all", any()) } returns JSONObject().apply {
            put("success", true)
            put("roomsClosed", 2)
        }

        val result = repo.closeAllRoomsByOwner("owner-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeAllRoomsByOwner returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/close-all", any()) } throws RuntimeException("Fail")

        val result = repo.closeAllRoomsByOwner("owner-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region removeDisconnectedUser

    @Test
    fun `removeDisconnectedUser returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/remove-disconnected", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.removeDisconnectedUser("room-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeDisconnectedUser returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/remove-disconnected", any()) } throws RuntimeException("Fail")

        val result = repo.removeDisconnectedUser("room-1", "user-1")

        assertTrue(result is Resource.Error)
    }

    // endregion
}
