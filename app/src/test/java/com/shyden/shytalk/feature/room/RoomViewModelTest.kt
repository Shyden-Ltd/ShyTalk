package com.shyden.shytalk.feature.room

import androidx.lifecycle.SavedStateHandle
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AgoraVoiceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.Date

@OptIn(ExperimentalCoroutinesApi::class)
class RoomViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val messageRepository = mockk<MessageRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val seatRequestRepository = mockk<SeatRequestRepository>(relaxed = true)
    private val agoraVoiceService = mockk<AgoraVoiceService>(relaxed = true)
    private val presenceService = mockk<PresenceService>(relaxed = true)
    private val activeRoomManager = mockk<ActiveRoomManager>(relaxed = true)

    private val roomFlow = MutableStateFlow<ChatRoom?>(null)
    private val messagesFlow = MutableStateFlow<List<Message>>(emptyList())
    private val speakingFlow = MutableStateFlow<Set<Int>>(emptySet())
    private val joinedFlow = MutableStateFlow(false)
    private val voiceErrorFlow = MutableStateFlow<String?>(null)

    private val currentUserId = "current-user"
    private val ownerId = "owner-1"

    private lateinit var viewModel: RoomViewModel

    @Before
    fun setup() {
        val mockUser = mockk<FirebaseUser> {
            every { uid } returns currentUserId
        }
        every { authRepository.currentUser } returns mockUser
        every { roomRepository.getRoomFlow(any()) } returns roomFlow
        every { messageRepository.getMessages(any()) } returns messagesFlow
        every { agoraVoiceService.speakingUsers } returns speakingFlow
        every { agoraVoiceService.isJoined } returns joinedFlow
        every { agoraVoiceService.error } returns voiceErrorFlow
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId, displayName = "Current User")
        )
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptyList())
        every { activeRoomManager.isInRoom(any()) } returns false
    }

    private fun createViewModel(): RoomViewModel {
        return RoomViewModel(
            savedStateHandle = SavedStateHandle(mapOf("roomId" to "room-1")),
            roomRepository = roomRepository,
            messageRepository = messageRepository,
            authRepository = authRepository,
            userRepository = userRepository,
            seatRequestRepository = seatRequestRepository,
            agoraVoiceService = agoraVoiceService,
            presenceService = presenceService,
            activeRoomManager = activeRoomManager
        )
    }

    private fun emitRoomAsOwner(room: ChatRoom = TestData.createTestRoom(ownerId = currentUserId)) {
        roomFlow.value = room
    }

    private fun emitRoomAsAttendee(
        room: ChatRoom = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId)
        )
    ) {
        // Mock owner user for block check
        coEvery { userRepository.getUser(ownerId) } returns Resource.Success(
            TestData.createTestUser(uid = ownerId, displayName = "Owner")
        )
        roomFlow.value = room
    }

    private fun emitRoomAsHost(
        room: ChatRoom = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId)
        )
    ) {
        coEvery { userRepository.getUser(ownerId) } returns Resource.Success(
            TestData.createTestUser(uid = ownerId, displayName = "Owner")
        )
        roomFlow.value = room
    }

    // ===== takeSeat Tests =====

    @Test
    fun `takeSeat - owner takes seat 0 succeeds`() = runTest {
        viewModel = createViewModel()
        // Seat 0 must be EMPTY for owner to take it
        val seats = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.takeSeat(0)
        advanceUntilIdle()

        coVerify { roomRepository.takeSeat("room-1", 0, currentUserId) }
    }

    @Test
    fun `takeSeat - owner cannot take non-owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    @Test
    fun `takeSeat - attendee cannot take owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.takeSeat(0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 0, any()) }
    }

    @Test
    fun `takeSeat - seat already occupied is rejected`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-user")
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    @Test
    fun `takeSeat - attendee always creates seat request`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify { seatRequestRepository.createRequest("room-1", currentUserId, any(), 3) }
        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    @Test
    fun `takeSeat - host takes seat when requireApproval is OFF`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId),
            requireApproval = false
        ))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify { roomRepository.takeSeat("room-1", 3, currentUserId) }
    }

    @Test
    fun `takeSeat - host blocked when requireApproval is ON`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId),
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    // ===== leaveSeat Tests =====

    @Test
    fun `leaveSeat - owner cannot leave seat 0`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.leaveSeat(0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.leaveSeat(any(), any()) }
    }

    @Test
    fun `leaveSeat - non-owner can leave their seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.leaveSeat(3)
        advanceUntilIdle()

        coVerify { roomRepository.leaveSeat("room-1", 3) }
    }

    // ===== removeFromSeat Tests =====

    @Test
    fun `removeFromSeat - attendee cannot remove anyone`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - cannot remove from owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.removeFromSeat(0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - host cannot remove owner`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = ownerId) // owner sitting elsewhere too
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - host cannot remove other host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId, otherHost),
            hostIds = listOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - owner removes attendee succeeds`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify { roomRepository.removeFromSeat("room-1", 3) }
    }

    @Test
    fun `removeFromSeat - empty seat is rejected`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.removeFromSeat(3) // seat 3 has no userId
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    // ===== forceMuteUser Tests =====

    @Test
    fun `forceMuteUser - attendee cannot force mute`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - cannot mute owner`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(0) // seat 0 = owner
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - cannot mute host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost)
        coEvery { userRepository.getUser(otherHost) } returns Resource.Success(
            TestData.createTestUser(uid = otherHost, displayName = "Host 2")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, otherHost),
            hostIds = listOf(otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - owner mutes attendee toggles mute`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1", isMuted = false)
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify { roomRepository.toggleMute("room-1", 3, true) }
    }

    // ===== moveSeat Tests =====

    @Test
    fun `moveSeat - attendee cannot move`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - cannot move from owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.moveSeat(0, 3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - cannot move to owner seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(3, 0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - destination occupied is rejected`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = "attendee-1")
        seats["5"] = TestData.createTestSeat(userId = "attendee-2")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - owner moves attendee succeeds`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = "attendee-1")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify { roomRepository.moveSeat("room-1", 2, 5, "attendee-1") }
    }

    @Test
    fun `moveSeat - host cannot move other host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId, otherHost),
            hostIds = listOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    // ===== kickUser Tests =====

    @Test
    fun `kickUser - attendee cannot kick`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any()) }
    }

    @Test
    fun `kickUser - cannot kick owner`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost()
        advanceUntilIdle()

        viewModel.kickUser(0) // owner seat
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any()) }
    }

    @Test
    fun `kickUser - cannot kick host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, otherHost),
            hostIds = listOf(otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any()) }
    }

    @Test
    fun `kickUser - owner kicks attendee succeeds`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        coEvery { userRepository.getUser("attendee-1") } returns Resource.Success(
            TestData.createTestUser(uid = "attendee-1", displayName = "Attendee")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify { roomRepository.kickUser("room-1", "attendee-1", 3) }
        coVerify { messageRepository.sendSystemMessage("room-1", any()) }
    }

    @Test
    fun `kickUser - empty seat is rejected`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any()) }
    }

    // ===== inviteUser Tests =====

    @Test
    fun `inviteUser - attendee cannot invite`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    @Test
    fun `inviteUser - host cannot invite when requireApproval ON`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId),
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    @Test
    fun `inviteUser - host invites when requireApproval OFF succeeds`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            hostIds = listOf(currentUserId),
            requireApproval = false
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite("room-1", "target-user", currentUserId) }
    }

    @Test
    fun `inviteUser - owner invites regardless of requireApproval`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite("room-1", "target-user", currentUserId) }
    }

    @Test
    fun `inviteUser - already seated user is rejected`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "target-user")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    // ===== acceptInvite Tests =====

    @Test
    fun `acceptInvite - finds first empty non-owner seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["1"] = TestData.createTestSeat(userId = "other") // occupied
        // seat 2 is empty
        emitRoomAsAttendee(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            pendingInvites = mapOf(currentUserId to ownerId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.acceptInvite()
        advanceUntilIdle()

        coVerify { roomRepository.acceptInvite("room-1", currentUserId, 2) }
    }

    @Test
    fun `acceptInvite - no pending invite is no-op`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.acceptInvite()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.acceptInvite(any(), any(), any()) }
    }

    @Test
    fun `acceptInvite - all seats occupied is no-op`() = runTest {
        viewModel = createViewModel()
        val seats = (0 until Constants.MAX_SEATS).associate {
            it.toString() to TestData.createTestSeat(userId = "user-$it")
        }
        emitRoomAsAttendee(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = listOf(ownerId, currentUserId),
            pendingInvites = mapOf(currentUserId to ownerId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.acceptInvite()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.acceptInvite(any(), any(), any()) }
    }

    // ===== leaveRoom Tests =====

    @Test
    fun `leaveRoom - owner with others on mic sets owner away`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-user")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        coVerify { roomRepository.setOwnerAway("room-1") }
        coVerify(exactly = 0) { roomRepository.closeRoom("room-1") }
    }

    @Test
    fun `leaveRoom - owner alone closes room`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        coVerify { roomRepository.closeRoom("room-1") }
        coVerify(exactly = 0) { roomRepository.setOwnerAway("room-1") }
    }

    @Test
    fun `leaveRoom - non-owner just leaves`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        coVerify { roomRepository.leaveRoom("room-1", currentUserId) }
        coVerify(exactly = 0) { roomRepository.setOwnerAway(any()) }
        coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
    }

    @Test
    fun `leaveRoom - leaves voice and removes presence`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        verify { agoraVoiceService.leaveChannel() }
        verify { presenceService.removePresence() }
        verify { activeRoomManager.untrackRoom() }
    }

    // ===== sendMessage Tests =====

    @Test
    fun `sendMessage - blank text is ignored`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.sendMessage("   ")

        coVerify(exactly = 0) { messageRepository.sendMessage(any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage - non-blank text sends message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.sendMessage("Hello!")
        advanceUntilIdle()

        coVerify { messageRepository.sendMessage("room-1", currentUserId, any(), "Hello!") }
    }

    // ===== blockUser / unblockUser Tests =====

    @Test
    fun `blockUser - success adds to blocked set`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.blockUser(currentUserId, "target") } returns Resource.Success(Unit)

        viewModel.blockUser("target")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.blockedUserIds.contains("target"))
    }

    @Test
    fun `blockUser - error sets error message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.blockUser(currentUserId, "target") } returns Resource.Error("fail")

        viewModel.blockUser("target")
        advanceUntilIdle()

        assertNotNull(viewModel.uiState.value.error)
    }

    @Test
    fun `unblockUser - success removes from blocked set`() = runTest {
        viewModel = createViewModel()
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(listOf("target"))
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.unblockUser(currentUserId, "target") } returns Resource.Success(Unit)

        viewModel.unblockUser("target")
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.blockedUserIds.contains("target"))
    }

    // ===== clearError Tests =====

    @Test
    fun `clearError clears error`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.blockUser(any(), any()) } returns Resource.Error("fail")
        viewModel.blockUser("x")
        advanceUntilIdle()

        viewModel.clearError()
        assertNull(viewModel.uiState.value.error)
    }

    // ===== toggleSelfMute Tests =====

    @Test
    fun `toggleSelfMute - only works on own seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-user")
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.toggleSelfMute(3) // not our seat
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `toggleSelfMute - toggles on own seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId)
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.toggleSelfMute(0)
        advanceUntilIdle()

        coVerify { roomRepository.toggleMute("room-1", 0, true) } // was false, toggled to true
    }

    // ===== confirmJoinDespiteBlock / cancelJoin Tests =====

    @Test
    fun `cancelJoin sets shouldNavigateBack`() = runTest {
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.cancelJoin()

        assertTrue(viewModel.uiState.value.shouldNavigateBack)
    }

    // ===== Room closed detection =====

    @Test
    fun `room closing sets roomClosed in state`() = runTest {
        // Pre-set room BEFORE creating VM so initial emission is not null
        roomFlow.value = TestData.createTestRoom(ownerId = currentUserId)
        viewModel = createViewModel()
        advanceUntilIdle()
        assertFalse(viewModel.uiState.value.roomClosed)

        // Emit closed room
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.CLOSED,
            closedAt = TestData.LATER_TIMESTAMP
        )
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.roomClosed)
    }

    @Test
    fun `null room emission sets roomClosed`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        roomFlow.value = null
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.roomClosed)
    }

    // ===== Voice Error Surfacing =====

    @Test
    fun `voice error from agora service surfaces in uiState`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        voiceErrorFlow.value = "Voice join failed (code -7)"
        advanceUntilIdle()

        assertEquals("Voice join failed (code -7)", viewModel.uiState.value.error)
        verify { agoraVoiceService.clearError() }
    }

    @Test
    fun `null voice error does not overwrite uiState error`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        voiceErrorFlow.value = null
        advanceUntilIdle()

        assertNull(viewModel.uiState.value.error)
    }

    // ===== Voice Channel Audience-First Tests =====

    @Test
    fun `joinRoom joins voice channel as audience`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = false) }
    }

    @Test
    fun `becoming seated switches role to broadcaster when has audio permission`() = runTest {
        viewModel = createViewModel()
        // First emit: user NOT seated (all empty seats) — triggers handleFirstJoin → joinRoom
        val emptySeats = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = emptySeats))
        advanceUntilIdle()

        // Grant audio permission
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        // Second emit: user IS seated — triggers handleNormalUpdate with currentlySeated=true, isSeated=false
        val seatedSeats = TestData.createSeatsWithOwner(currentUserId)
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seatedSeats))
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `leaving seat switches role to audience instead of leaving channel`() = runTest {
        // Pre-set room BEFORE creating VM to avoid null initial emission calling leaveChannel
        val emptySeats = TestData.createDefaultSeats()
        roomFlow.value = TestData.createTestRoom(ownerId = currentUserId, seats = emptySeats)
        viewModel = createViewModel()
        advanceUntilIdle()

        // Grant audio permission
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        // Emit with user seated — handleNormalUpdate sets isSeated = true
        val seatedSeats = TestData.createSeatsWithOwner(currentUserId)
        roomFlow.value = TestData.createTestRoom(ownerId = currentUserId, seats = seatedSeats)
        advanceUntilIdle()

        // Emit with user NOT seated — handleNormalUpdate detects isSeated→not seated
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            seats = emptySeats,
            name = "Test Room 2"  // change something so MutableStateFlow re-emits
        )
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(false) }
        // Should NOT call leaveChannel when leaving seat
        verify(exactly = 0) { agoraVoiceService.leaveChannel() }
    }

    @Test
    fun `onAudioPermissionResult granted when seated calls setRole`() = runTest {
        viewModel = createViewModel()
        // First emit with empty seats to trigger handleFirstJoin → joinRoom → hasJoined=true
        val emptySeats = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = emptySeats))
        advanceUntilIdle()

        // Second emit with user seated — handleNormalUpdate sets isSeated=true
        // but hasAudioPermission is false, so no setRole yet
        val seatedSeats = TestData.createSeatsWithOwner(currentUserId)
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seatedSeats))
        advanceUntilIdle()

        // Now grant permission — should trigger setRole(true) since isSeated=true
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `onAudioPermissionResult granted when not seated does not call setRole`() = runTest {
        viewModel = createViewModel()
        val seatsWithoutUser = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seatsWithoutUser))
        advanceUntilIdle()

        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify(exactly = 0) { agoraVoiceService.setRole(any()) }
    }

    @Test
    fun `leaveRoom still calls leaveChannel`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        verify { agoraVoiceService.leaveChannel() }
    }

    @Test
    fun `attendee joining room also joins voice as audience`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = false) }
    }

    @Test
    fun `owner already seated with permission joins voice as broadcaster directly`() = runTest {
        viewModel = createViewModel()
        // Grant audio permission BEFORE room emission
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        // Emit room with owner on seat 0 (default seats)
        emitRoomAsOwner()
        advanceUntilIdle()

        // Should join as broadcaster since already seated + has permission
        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = true) }
    }

    @Test
    fun `owner already seated without permission joins as audience then upgrades on permission grant`() = runTest {
        viewModel = createViewModel()
        // Emit room with owner on seat 0, but NO audio permission yet
        emitRoomAsOwner()
        advanceUntilIdle()

        // Should join as audience (no permission yet)
        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = false) }

        // Grant permission — should call setRole(true) since isSeated was set in joinRoom()
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `alreadyInRoom path sets isSeated and does not trigger redundant seat transition`() = runTest {
        // Simulate ViewModel recreation: activeRoomManager reports already in room
        every { activeRoomManager.isInRoom("room-1") } returns true

        // Pre-set room with owner seated BEFORE creating VM
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId)
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        // Grant permission — since isSeated is set in alreadyInRoom path, this should call setRole
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `alreadyInRoom path without seat does not set broadcaster`() = runTest {
        every { activeRoomManager.isInRoom("room-1") } returns true

        // Pre-set room with empty seats (user not seated)
        val emptySeats = TestData.createDefaultSeats()
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = listOf(currentUserId),
            seats = emptySeats
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        // Grant permission — since NOT seated, should NOT call setRole
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify(exactly = 0) { agoraVoiceService.setRole(any()) }
    }
}
