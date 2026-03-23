package com.shyden.shytalk.core.room

import android.content.Context
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.VoiceConnectionState
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ActiveRoomManagerTest {
    private val testDispatcher = UnconfinedTestDispatcher()

    private lateinit var roomRepository: RoomRepository
    private lateinit var messageRepository: MessageRepository
    private lateinit var authRepository: AuthRepository
    private lateinit var userRepository: UserRepository
    private lateinit var seatRequestRepository: SeatRequestRepository
    private lateinit var voiceService: VoiceService
    private lateinit var presenceService: PresenceService
    private lateinit var context: Context
    private lateinit var manager: ActiveRoomManager

    private val currentUserId = "user-1"
    private val connectionStateFlow = MutableStateFlow(VoiceConnectionState.DISCONNECTED)
    private val presenceFlow = MutableStateFlow<Set<String>>(emptySet())

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        roomRepository = mockk(relaxed = true)
        messageRepository = mockk(relaxed = true)
        authRepository = mockk(relaxed = true)
        userRepository = mockk(relaxed = true)
        seatRequestRepository = mockk(relaxed = true)
        voiceService = mockk(relaxed = true)
        presenceService = mockk(relaxed = true)
        context = mockk(relaxed = true)

        every { voiceService.connectionState } returns connectionStateFlow
        every { presenceService.observeRoomPresence(any()) } returns presenceFlow

        every { authRepository.currentUserId } returns currentUserId
        every { userRepository.userUpdates } returns MutableSharedFlow()

        manager =
            ActiveRoomManager(
                roomRepository = roomRepository,
                messageRepository = messageRepository,
                authRepository = authRepository,
                userRepository = userRepository,
                seatRequestRepository = seatRequestRepository,
                voiceService = voiceService,
                presenceService = presenceService,
                context = context,
            )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // --- resolveRole (now on ChatRoom) ---

    @Test
    fun `resolveRole returns OWNER when userId matches ownerId`() {
        val room = TestData.createTestRoom(ownerId = currentUserId)
        assertEquals(RoomRole.OWNER, room.resolveRole(currentUserId))
    }

    @Test
    fun `resolveRole returns HOST when userId in hostIds`() {
        val room = TestData.createTestRoom(ownerId = "other", hostIds = setOf(currentUserId))
        assertEquals(RoomRole.HOST, room.resolveRole(currentUserId))
    }

    @Test
    fun `resolveRole returns ATTENDEE for regular user`() {
        val room = TestData.createTestRoom(ownerId = "other")
        assertEquals(RoomRole.ATTENDEE, room.resolveRole(currentUserId))
    }

    // --- trackRoom / untrackRoom ---

    @Test
    fun `trackRoom sets activeRoomId`() {
        manager.trackRoom("room-1")
        assertEquals("room-1", manager.activeRoomId.value)
    }

    @Test
    fun `untrackRoom clears all state`() {
        manager.trackRoom("room-1")
        manager.updateTrackedRoom(TestData.createTestRoom())
        manager.untrackRoom()

        assertNull(manager.activeRoomId.value)
        assertNull(manager.activeRoom.value)
        assertEquals(emptyList<Any>(), manager.messages.value)
        assertEquals(0L, manager.ownerAwayRemainingMs.value)
        assertFalse(manager.roomClosed.value)
    }

    @Test
    fun `isInRoom returns true when matching room tracked`() {
        manager.trackRoom("room-1")
        assertTrue(manager.isInRoom("room-1"))
        assertFalse(manager.isInRoom("room-2"))
    }

    @Test
    fun `isInAnyRoom returns true when any room tracked`() {
        assertFalse(manager.isInAnyRoom())
        manager.trackRoom("room-1")
        assertTrue(manager.isInAnyRoom())
    }

    @Test
    fun `updateTrackedRoom sets activeRoom`() {
        val room = TestData.createTestRoom()
        manager.updateTrackedRoom(room)
        assertEquals(room, manager.activeRoom.value)
    }

    // --- takeSeat ---

    @Test
    fun `takeSeat - owner takes seat 0 calls repository`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = currentUserId, seats = TestData.createDefaultSeats())
            manager.updateTrackedRoom(room)

            manager.takeSeat(Constants.OWNER_SEAT_INDEX)

            coVerify { roomRepository.takeSeat("room-1", Constants.OWNER_SEAT_INDEX, currentUserId) }
        }

    @Test
    fun `takeSeat - owner cannot take non-zero seat`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = currentUserId)
            manager.updateTrackedRoom(room)

            manager.takeSeat(3)

            coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
        }

    @Test
    fun `takeSeat - non-owner cannot take seat 0`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                )
            manager.updateTrackedRoom(room)

            manager.takeSeat(Constants.OWNER_SEAT_INDEX)

            coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
        }

    @Test
    fun `takeSeat - attendee creates request instead`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                )
            manager.updateTrackedRoom(room)

            manager.takeSeat(3)

            coVerify { seatRequestRepository.createRequest("room-1", currentUserId, any(), 3) }
            coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
        }

    @Test
    fun `takeSeat - host with requireApproval ON is blocked`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    hostIds = setOf(currentUserId),
                    requireApproval = true,
                )
            manager.updateTrackedRoom(room)

            manager.takeSeat(3)

            coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
        }

    @Test
    fun `takeSeat - occupied seat is rejected`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = "someone")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            // Owner tries seat 3 — but owner can only take seat 0
            // Use a host to test the occupied check
            every { authRepository.currentUserId } returns "host-1"
            val hostManager =
                ActiveRoomManager(
                    roomRepository,
                    messageRepository,
                    authRepository,
                    userRepository,
                    seatRequestRepository,
                    voiceService,
                    presenceService,
                    context,
                )
            hostManager.trackRoom("room-1")
            val hostRoom =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    hostIds = setOf("host-1"),
                    seats = seats,
                )
            hostManager.updateTrackedRoom(hostRoom)
            hostManager.takeSeat(3)

            coVerify(exactly = 0) { roomRepository.takeSeat(any(), eq(3), any()) }
        }

    // --- leaveSeat ---

    @Test
    fun `leaveSeat - owner cannot leave seat 0`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = currentUserId)
            manager.updateTrackedRoom(room)

            manager.leaveSeat(Constants.OWNER_SEAT_INDEX)

            coVerify(exactly = 0) { roomRepository.leaveSeat(any(), any()) }
        }

    @Test
    fun `leaveSeat - non-owner seat calls repository`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = "other-owner")
            manager.updateTrackedRoom(room)

            manager.leaveSeat(3)

            coVerify { roomRepository.leaveSeat("room-1", 3) }
        }

    // --- removeFromSeat ---

    @Test
    fun `removeFromSeat - attendee is blocked`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = "target")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId, "target"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.removeFromSeat(3)

            coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
        }

    @Test
    fun `removeFromSeat - cannot remove from owner seat`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    hostIds = setOf(currentUserId),
                )
            manager.updateTrackedRoom(room)

            manager.removeFromSeat(Constants.OWNER_SEAT_INDEX)

            coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
        }

    @Test
    fun `removeFromSeat - host cannot remove another host`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = "other-host")
            val room =
                TestData.createTestRoom(
                    ownerId = "the-owner",
                    hostIds = setOf(currentUserId, "other-host"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.removeFromSeat(3)

            coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
        }

    // --- kickUser ---

    @Test
    fun `kickUser - cannot kick owner`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = "the-owner")
            val room =
                TestData.createTestRoom(
                    ownerId = "the-owner",
                    hostIds = setOf(currentUserId),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.kickUser("the-owner", 0)

            coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
        }

    @Test
    fun `kickUser - cannot kick host`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = "a-host")
            val room =
                TestData.createTestRoom(
                    ownerId = "the-owner",
                    hostIds = setOf(currentUserId, "a-host"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.kickUser("a-host", 3)

            coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
        }

    // --- inviteUser ---

    @Test
    fun `inviteUser - attendee is blocked`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                )
            manager.updateTrackedRoom(room)

            manager.inviteUser("target", "Target Name")

            coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
        }

    @Test
    fun `inviteUser - owner can invite`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = currentUserId)
            manager.updateTrackedRoom(room)

            manager.inviteUser("target", "Target Name")

            coVerify { roomRepository.sendInvite("room-1", "target", currentUserId) }
        }

    // --- acceptInvite / declineInvite ---

    @Test
    fun `acceptInvite - finds first empty seat`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = "owner")
            seats["1"] = TestData.createTestSeat(userId = "someone")
            // Seat 2 is empty
            val room =
                TestData.createTestRoom(
                    ownerId = "owner",
                    participantIds = setOf("owner", "someone", currentUserId),
                    pendingInvites = mapOf(currentUserId to "owner"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.acceptInvite()

            coVerify { roomRepository.acceptInvite("room-1", currentUserId, 2) }
        }

    @Test
    fun `declineInvite calls cancelInvite`() =
        runTest {
            manager.trackRoom("room-1")

            manager.declineInvite()

            coVerify { roomRepository.cancelInvite("room-1", currentUserId) }
        }

    // --- sendMessage ---

    @Test
    fun `sendMessage - blank text is ignored`() =
        runTest {
            manager.trackRoom("room-1")

            manager.sendMessage("   ")

            coVerify(exactly = 0) { messageRepository.sendMessage(any(), any(), any(), any()) }
        }

    @Test
    fun `sendMessage - valid text forwards to repository`() =
        runTest {
            manager.trackRoom("room-1")

            manager.sendMessage("Hello!")

            coVerify { messageRepository.sendMessage("room-1", currentUserId, any(), "Hello!") }
        }

    // --- toggleSelfMute ---

    @Test
    fun `toggleSelfMute - only works for own seat`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = "someone-else", isMuted = false)
            val room = TestData.createTestRoom(ownerId = "owner", seats = seats)
            manager.updateTrackedRoom(room)

            manager.toggleSelfMute(3)

            coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
        }

    @Test
    fun `toggleSelfMute - toggles mute state for own seat`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId, isMuted = false)
            val room = TestData.createTestRoom(ownerId = "owner", seats = seats)
            manager.updateTrackedRoom(room)

            // Voice must be connected for unmute, but muting (isMuted=false→true) is always allowed
            manager.toggleSelfMute(3)

            coVerify { roomRepository.toggleMute("room-1", 3, true) }
            verify { voiceService.setMicrophoneEnabled(false) }
        }

    @Test
    fun `toggleSelfMute - rejects unmute when voice not connected`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId, isMuted = true)
            val room = TestData.createTestRoom(ownerId = "owner", seats = seats)
            manager.updateTrackedRoom(room)

            // connectionState starts as DISCONNECTED
            manager.toggleSelfMute(3)

            // Should NOT call toggleMute or setMicrophoneEnabled
            coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
            verify(exactly = 0) { voiceService.setMicrophoneEnabled(true) }
            assertEquals("Voice not connected yet", manager.error.value)
        }

    @Test
    fun `toggleSelfMute - allows mute when voice disconnected`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId, isMuted = false)
            val room = TestData.createTestRoom(ownerId = "owner", seats = seats)
            manager.updateTrackedRoom(room)

            // connectionState is DISCONNECTED — muting (isMuted=false→true) should still work
            manager.toggleSelfMute(3)

            coVerify { roomRepository.toggleMute("room-1", 3, true) }
            verify { voiceService.setMicrophoneEnabled(false) }
        }

    // --- forceMuteUser ---

    @Test
    fun `forceMuteUser - cannot mute owner`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = "the-owner")
            val room =
                TestData.createTestRoom(
                    ownerId = "the-owner",
                    hostIds = setOf(currentUserId),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.forceMuteUser(0)

            coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
        }

    // --- moveSeat ---

    @Test
    fun `moveSeat - cannot move from owner seat`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "owner",
                    hostIds = setOf(currentUserId),
                )
            manager.updateTrackedRoom(room)

            manager.moveSeat(Constants.OWNER_SEAT_INDEX, 3)

            coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
        }

    @Test
    fun `moveSeat - occupied destination triggers swap`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["2"] = TestData.createTestSeat(userId = "target")
            seats["3"] = TestData.createTestSeat(userId = "occupied")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "target", "occupied"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.moveSeat(2, 3)

            coVerify { roomRepository.moveSeat("room-1", 2, 3, "target") }
        }

    // --- leaveRoom ---

    @Test
    fun `leaveRoom - removes presence`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner("other-owner").toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId)
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.leaveRoom()

            coVerify { presenceService.removePresence() }
        }

    @Test
    fun `leaveRoom - vacates seats and leaves voice`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner("other-owner").toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId)
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.leaveRoom()

            coVerify { roomRepository.leaveSeat("room-1", 3) }
            coVerify { voiceService.leaveChannel() }
            coVerify { roomRepository.leaveRoom("room-1", currentUserId) }
        }

    @Test
    fun `leaveRoom - owner alone closes room`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.leaveRoom()

            // Owner is alone — room should close immediately
            coVerify(exactly = 0) { roomRepository.leaveSeat("room-1", 0) }
            coVerify { roomRepository.closeRoom("room-1") }
            coVerify(exactly = 0) { roomRepository.setOwnerAway(any()) }
        }

    @Test
    fun `leaveRoom - owner with others on mic sets owner away`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = "other-user")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "other-user"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.leaveRoom()

            // Others present — owner keeps seat 0, room goes OWNER_AWAY
            coVerify(exactly = 0) { roomRepository.leaveSeat("room-1", 0) }
            coVerify { roomRepository.setOwnerAway("room-1") }
            coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
        }

    @Test
    fun `leaveRoom - clears active state`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                )
            manager.updateTrackedRoom(room)

            manager.leaveRoom()

            assertNull(manager.activeRoomId.value)
            assertNull(manager.activeRoom.value)
            assertFalse(manager.isInAnyRoom())
        }

    @Test
    fun `leaveRoom - no-op when not in room`() =
        runTest {
            // No trackRoom called
            manager.leaveRoom()

            coVerify(exactly = 0) { presenceService.removePresence() }
            coVerify(exactly = 0) { voiceService.leaveChannel() }
        }

    // --- trackRoom starts connection monitor ---

    @Test
    fun `trackRoom - starts connection monitor without crashing`() {
        // This verifies trackRoom calls startConnectionMonitor without errors
        // The connectionState starts as DISCONNECTED but wasEverConnected=false
        // so no grace period should trigger
        manager.trackRoom("room-1")

        assertTrue(manager.isInRoom("room-1"))
    }

    // --- connection monitor: owner vs non-owner ---

    @Test
    fun `connection monitor - owner disconnect does NOT trigger leaveRoom`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner(currentUserId)
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            // Emit CONNECTED after room is set so wasEverConnected = true
            connectionStateFlow.value = VoiceConnectionState.CONNECTED

            // Simulate voice disconnect (WiFi off)
            connectionStateFlow.value = VoiceConnectionState.DISCONNECTED

            // Advance past the grace period
            testScheduler.advanceTimeBy(Constants.VOICE_DISCONNECT_GRACE_PERIOD_MS + 1000)

            // Owner should NOT have leaveRoom called — presence system on other devices handles it
            coVerify(exactly = 0) { roomRepository.setOwnerAway(any()) }
            coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
            coVerify(exactly = 0) { roomRepository.leaveSeat(any(), any()) }
            assertTrue(manager.isInRoom("room-1"))
        }

    @Test
    fun `connection monitor - non-owner disconnect removes from seat after grace period`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner("other-owner").toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId)
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            // Emit CONNECTED after room is set so wasEverConnected = true
            connectionStateFlow.value = VoiceConnectionState.CONNECTED

            // Simulate voice disconnect
            connectionStateFlow.value = VoiceConnectionState.DISCONNECTED

            // Advance past the grace period
            testScheduler.advanceTimeBy(Constants.VOICE_DISCONNECT_GRACE_PERIOD_MS + 1000)

            // Non-owner should have seat cleared but NOT full leaveRoom
            coVerify { roomRepository.leaveSeat("room-1", 3) }
            coVerify(exactly = 0) { voiceService.leaveChannel() }
            coVerify(exactly = 0) { roomRepository.leaveRoom(any(), any()) }
        }

    // --- presence monitor ---

    @Test
    fun `presence monitor - removes disconnected non-owner after timeout`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                )
            manager.updateTrackedRoom(room)

            // user-2 is absent from presence
            presenceFlow.value = setOf(currentUserId)

            // Advance past the timeout
            testScheduler.advanceTimeBy(Constants.PRESENCE_TIMEOUT_MS + 100)

            coVerify { roomRepository.removeDisconnectedUser("room-1", "user-2") }
        }

    @Test
    fun `presence monitor - does not remove user who reappears before timeout`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                )
            manager.updateTrackedRoom(room)

            // user-2 disappears
            presenceFlow.value = setOf(currentUserId)

            // Advance partway
            testScheduler.advanceTimeBy(15_000)

            // user-2 reappears
            presenceFlow.value = setOf(currentUserId, "user-2")

            // Advance past the original timeout
            testScheduler.advanceTimeBy(20_000)

            coVerify(exactly = 0) { roomRepository.removeDisconnectedUser(any(), any()) }
        }

    @Test
    fun `presence monitor - does not remove self`() =
        runTest {
            // Start with both users present so the initial flow value isn't empty
            presenceFlow.value = setOf(currentUserId, "other-owner")

            manager.trackRoom("room-1")
            // Use default seats (owner on seat 0) but make "other-owner" NOT seated
            // so the presence monitor considers them for removal
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = "other-owner") // owner is seated
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId, "unseated-participant"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            // Both disappear from presence, plus unseated-participant
            presenceFlow.value = setOf("nobody")

            testScheduler.advanceTimeBy(Constants.PRESENCE_TIMEOUT_MS + 100)

            // Should not try to remove self; owner absence triggers setOwnerAway instead of removal;
            // unseated non-owner participants are removed normally
            coVerify(exactly = 0) { roomRepository.removeDisconnectedUser("room-1", currentUserId) }
            coVerify { roomRepository.setOwnerAway("room-1") }
            coVerify(exactly = 0) { roomRepository.removeDisconnectedUser("room-1", "other-owner") }
            coVerify { roomRepository.removeDisconnectedUser("room-1", "unseated-participant") }
        }

    @Test
    fun `presence monitor - removes multiple absent users`() =
        runTest {
            presenceFlow.value = setOf(currentUserId, "user-2", "user-3")

            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2", "user-3"),
                )
            manager.updateTrackedRoom(room)

            // Both user-2 and user-3 disappear
            presenceFlow.value = setOf(currentUserId)

            testScheduler.advanceTimeBy(Constants.PRESENCE_TIMEOUT_MS + 100)

            coVerify { roomRepository.removeDisconnectedUser("room-1", "user-2") }
            coVerify { roomRepository.removeDisconnectedUser("room-1", "user-3") }
        }

    @Test
    fun `presence monitor - no-op when all participants present`() =
        runTest {
            presenceFlow.value = setOf(currentUserId, "user-2")

            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                )
            manager.updateTrackedRoom(room)

            // Everyone stays present
            presenceFlow.value = setOf(currentUserId, "user-2", "extra-user")

            testScheduler.advanceTimeBy(Constants.PRESENCE_TIMEOUT_MS + 100)

            coVerify(exactly = 0) { roomRepository.removeDisconnectedUser(any(), any()) }
        }

    // --- closeRoom ---

    @Test
    fun `closeRoom - leaves voice and closes`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = currentUserId)
            manager.updateTrackedRoom(room)

            manager.closeRoom()

            verify { voiceService.leaveChannel() }
            coVerify { roomRepository.closeRoom("room-1") }
            // cleanup() resets roomClosed and activeRoomId
            assertNull(manager.activeRoomId.value)
        }

    @Test
    fun `closeRoom - no-op when not in room`() =
        runTest {
            manager.closeRoom()

            coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
        }

    // --- ownerReturn ---

    @Test
    fun `ownerReturn - only works for owner`() =
        runTest {
            manager.trackRoom("room-1")
            val room = TestData.createTestRoom(ownerId = "other-owner")
            manager.updateTrackedRoom(room)

            manager.ownerReturn()

            coVerify(exactly = 0) { roomRepository.setOwnerReturned(any(), any()) }
        }

    @Test
    fun `ownerReturn - owner can return`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    state = RoomState.OWNER_AWAY,
                )
            manager.updateTrackedRoom(room)

            manager.ownerReturn()

            coVerify { roomRepository.setOwnerReturned("room-1", currentUserId) }
        }

    // --- ensureSingleRoom ---

    @Test
    fun `ensureSingleRoom - closes owned rooms`() =
        runTest {
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "old-room"

            manager.ensureSingleRoom()

            coVerify { roomRepository.closeRoom("old-room") }
        }

    // --- clearError ---

    @Test
    fun `clearError clears error state`() {
        manager.clearError()
        assertNull(manager.error.value)
    }

    // --- Owner can kick/force-mute hosts (v0.18 fix) ---

    @Test
    fun `kickUser - owner can kick a host`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = currentUserId)
            seats["3"] = TestData.createTestSeat(userId = "a-host")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    hostIds = setOf("a-host"),
                    participantIds = setOf(currentUserId, "a-host"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.kickUser("a-host", 3)

            coVerify { roomRepository.kickUser("room-1", "a-host", 3, any(), any()) }
        }

    @Test
    fun `kickUser - host cannot kick another host`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = "the-owner")
            seats["2"] = TestData.createTestSeat(userId = currentUserId)
            seats["3"] = TestData.createTestSeat(userId = "other-host")
            val room =
                TestData.createTestRoom(
                    ownerId = "the-owner",
                    hostIds = setOf(currentUserId, "other-host"),
                    participantIds = setOf("the-owner", currentUserId, "other-host"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.kickUser("other-host", 3)

            coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
        }

    @Test
    fun `forceMuteUser - owner can force-mute a host`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = currentUserId)
            seats["3"] = TestData.createTestSeat(userId = "a-host", isMuted = false)
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    hostIds = setOf("a-host"),
                    participantIds = setOf(currentUserId, "a-host"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.forceMuteUser(3)

            coVerify { roomRepository.toggleMute("room-1", 3, true) }
        }

    @Test
    fun `forceMuteUser - host cannot force-mute another host`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createDefaultSeats().toMutableMap()
            seats["0"] = TestData.createTestSeat(userId = "the-owner")
            seats["2"] = TestData.createTestSeat(userId = currentUserId)
            seats["3"] = TestData.createTestSeat(userId = "other-host", isMuted = false)
            val room =
                TestData.createTestRoom(
                    ownerId = "the-owner",
                    hostIds = setOf(currentUserId, "other-host"),
                    participantIds = setOf("the-owner", currentUserId, "other-host"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            manager.forceMuteUser(3)

            coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
        }

    // --- disconnectedUserIds ---

    @Test
    fun `disconnectedUserIds - initially empty`() {
        assertEquals(emptySet<String>(), manager.disconnectedUserIds.value)
    }

    @Test
    fun `disconnectedUserIds - contains absent user during grace period`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                )
            manager.updateTrackedRoom(room)

            // user-2 is absent from presence
            presenceFlow.value = setOf(currentUserId)

            // Advance 15s — within PRESENCE_TIMEOUT_MS (30s), grace timer still running
            testScheduler.advanceTimeBy(15_000)

            assertTrue(manager.disconnectedUserIds.value.contains("user-2"))
        }

    @Test
    fun `disconnectedUserIds - cleared when user reappears`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                )
            manager.updateTrackedRoom(room)

            // user-2 disappears
            presenceFlow.value = setOf(currentUserId)
            testScheduler.advanceTimeBy(15_000)
            assertTrue(manager.disconnectedUserIds.value.contains("user-2"))

            // user-2 reappears
            presenceFlow.value = setOf(currentUserId, "user-2")
            testScheduler.advanceTimeBy(1)

            assertEquals(emptySet<String>(), manager.disconnectedUserIds.value)
        }

    @Test
    fun `disconnectedUserIds - cleared on untrackRoom`() =
        runTest {
            manager.trackRoom("room-1")
            val room =
                TestData.createTestRoom(
                    ownerId = currentUserId,
                    participantIds = setOf(currentUserId, "user-2"),
                )
            manager.updateTrackedRoom(room)

            // user-2 disappears
            presenceFlow.value = setOf(currentUserId)
            testScheduler.advanceTimeBy(15_000)
            assertTrue(manager.disconnectedUserIds.value.contains("user-2"))

            manager.untrackRoom()

            assertEquals(emptySet<String>(), manager.disconnectedUserIds.value)
        }

    @Test
    fun `disconnectedUserIds - cleared on cleanup via leaveRoom`() =
        runTest {
            manager.trackRoom("room-1")
            val seats = TestData.createSeatsWithOwner("other-owner").toMutableMap()
            seats["3"] = TestData.createTestSeat(userId = currentUserId)
            val room =
                TestData.createTestRoom(
                    ownerId = "other-owner",
                    participantIds = setOf("other-owner", currentUserId, "user-2"),
                    seats = seats,
                )
            manager.updateTrackedRoom(room)

            // user-2 disappears
            presenceFlow.value = setOf(currentUserId, "other-owner")
            testScheduler.advanceTimeBy(15_000)
            assertTrue(manager.disconnectedUserIds.value.contains("user-2"))

            manager.leaveRoom()

            assertEquals(emptySet<String>(), manager.disconnectedUserIds.value)
        }
}
