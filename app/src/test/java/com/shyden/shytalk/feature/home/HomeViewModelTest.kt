package com.shyden.shytalk.feature.home

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val bannerRepository = mockk<BannerRepository>(relaxed = true)

    private val roomsFlow = MutableSharedFlow<List<ChatRoom>>()
    private val currentUserId = "current-user"

    private val activeViewModels = mutableListOf<HomeViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId
        every { roomRepository.getActiveRooms() } returns roomsFlow
        every { userRepository.userUpdates } returns MutableSharedFlow()
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { roomRepository.findActiveRoomByOwner(any()) } returns null
    }

    @After
    fun tearDown() =
        runBlocking {
            activeViewModels.forEach {
                it.viewModelScope.coroutineContext.job
                    .cancelAndJoin()
            }
            activeViewModels.clear()
        }

    private fun createViewModel() =
        HomeViewModel(
            roomRepository = roomRepository,
            authRepository = authRepository,
            userRepository = userRepository,
            bannerRepository = bannerRepository,
        ).also { activeViewModels.add(it) }

    @Test
    fun `room owned by blocked user is excluded`() =
        runTest {
            coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("blocked-owner"))
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "blocked-owner")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "blocked-owner")))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
        }

    @Test
    fun `room whose owner blocked current user is excluded`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "hostile-owner", blockedUserIds = setOf(currentUserId))),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "hostile-owner")))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
        }

    @Test
    fun `normal room is included`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "good-owner")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "good-owner")))
            advanceUntilIdle()

            assertEquals(1, vm.uiState.value.rooms.size)
        }

    @Test
    fun `createRoom with no existing room creates directly`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room-id")

            vm.createRoom("My Room")
            advanceUntilIdle()

            coVerify(exactly = 0) { roomRepository.closeAllRoomsByOwner(any()) }
            coVerify { roomRepository.createRoom("My Room", currentUserId) }
            assertEquals("new-room-id", vm.uiState.value.createdRoomId)
        }

    @Test
    fun `createRoom error sets error`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("failed")

            vm.createRoom("My Room")
            advanceUntilIdle()

            assertNotNull(vm.uiState.value.error)
            assertNull(vm.uiState.value.createdRoomId)
        }

    @Test
    fun `onRoomNavigated clears createdRoomId`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room")
            vm.createRoom("Room")
            advanceUntilIdle()

            vm.onRoomNavigated()

            assertNull(vm.uiState.value.createdRoomId)
        }

    @Test
    fun `clearError clears error`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("err")
            vm.createRoom("Room")
            advanceUntilIdle()

            vm.clearError()

            assertNull(vm.uiState.value.error)
        }

    @Test
    fun `signOut calls auth signOut`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            vm.signOut()

            coVerify { authRepository.signOut() }
        }

    /**
     * `AuthRepositorySignOutContractTest` proves platform sign-out can throw.
     * `HomeViewModel.signOut` is fire-and-forget — an uncaught exception would
     * be swallowed by `viewModelScope`'s default handler and leak into
     * `Thread.UncaughtExceptionHandler` on Android, surfacing as an error log
     * with no diagnostic context. Catch + log explicitly here.
     */
    @Test
    fun `signOut does not crash when authRepository throws`() =
        runTest {
            coEvery { authRepository.signOut() } throws IllegalStateException("platform sign-out failure")

            val vm = createViewModel()
            advanceUntilIdle()

            vm.signOut()
            advanceUntilIdle()

            coVerify { authRepository.signOut() }
        }

    @Test
    fun `isLoading becomes false after rooms emit`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isLoading)
        }

    // ===== refreshRooms =====

    @Test
    fun `refreshRooms reloads blocked users and re-filters`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-1")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-1")))
            advanceUntilIdle()
            assertEquals(1, vm.uiState.value.rooms.size)

            // Now block the owner
            coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("owner-1"))

            vm.refreshRooms()
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
            assertFalse(vm.uiState.value.isRefreshing)
        }

    @Test
    fun `refreshRooms sets isRefreshing false after completion`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            vm.refreshRooms()
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isRefreshing)
        }

    @Test
    fun `createRoom stores lastRoomName in state`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room-id")

            vm.createRoom("My Cool Room")
            advanceUntilIdle()

            assertEquals("My Cool Room", vm.uiState.value.lastRoomName)
        }

    @Test
    fun `lastRoomName defaults to empty`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals("", vm.uiState.value.lastRoomName)
        }

    @Test
    fun `rooms the user participates in are sorted first`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "owner-a"),
                        TestData.createTestUser(uid = "owner-b"),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val roomA =
                TestData.createTestRoom(
                    roomId = "room-a",
                    ownerId = "owner-a",
                    participantIds = setOf("owner-a"), // user NOT participating
                )
            val roomB =
                TestData.createTestRoom(
                    roomId = "room-b",
                    ownerId = "owner-b",
                    participantIds = setOf("owner-b", currentUserId), // user participating
                )
            roomsFlow.emit(listOf(roomA, roomB))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(2, rooms.size)
            assertEquals("room-b", rooms[0].roomId) // user's room sorted first
            assertEquals("room-a", rooms[1].roomId)
        }

    @Test
    fun `empty rooms list shows empty state`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `multiple rooms with mixed blocked and normal owners`() =
        runTest {
            coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("blocked-owner"))
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "good-owner"),
                        TestData.createTestUser(uid = "blocked-owner"),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val goodRoom = TestData.createTestRoom(roomId = "room-1", ownerId = "good-owner")
            val blockedRoom = TestData.createTestRoom(roomId = "room-2", ownerId = "blocked-owner")
            roomsFlow.emit(listOf(goodRoom, blockedRoom))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(1, rooms.size)
            assertEquals("room-1", rooms[0].roomId)
        }

    @Test
    fun `own room is sorted first`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "other-owner"),
                        TestData.createTestUser(uid = currentUserId),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val otherRoom = TestData.createTestRoom(roomId = "room-other", ownerId = "other-owner")
            val myRoom = TestData.createTestRoom(roomId = "room-mine", ownerId = currentUserId)
            roomsFlow.emit(listOf(otherRoom, myRoom))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(2, rooms.size)
            assertEquals("room-mine", rooms[0].roomId) // own room first
        }

    @Test
    fun `setActive starts periodic refresh`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            vm.setActive(true)
            advanceTimeBy(HomeViewModel.REFRESH_INTERVAL_MS + 1)
            runCurrent()

            // Blocked users should be re-fetched (initial + periodic)
            coVerify(atLeast = 2) { userRepository.getBlockedUserIds(currentUserId) }

            vm.setActive(false)
        }

    // ===== createRoom - auth guard =====

    @Test
    fun `createRoom with null auth user does nothing`() =
        runTest {
            every { authRepository.currentUserId } returns null
            val vm = createViewModel()
            advanceUntilIdle()

            vm.createRoom("My Room")
            advanceUntilIdle()

            coVerify(exactly = 0) { roomRepository.createRoom(any(), any()) }
        }

    // ===== createRoom - persists lastRoomName via updateProfile =====

    @Test
    fun `createRoom persists lastRoomName via updateProfile`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-id")

            vm.createRoom("Persisted Room")
            advanceUntilIdle()

            coVerify { userRepository.updateProfile(currentUserId, match { it["lastRoomName"] == "Persisted Room" }) }
        }

    // ===== seatUsers populated for occupied seats =====

    @Test
    fun `seatUsers map is populated for occupied seats in visible rooms`() =
        runTest {
            val seatedUser = TestData.createTestUser(uid = "seated-user")
            val owner = TestData.createTestUser(uid = "room-owner")
            coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(owner, seatedUser))

            val seats = TestData.createSeatsWithOwner("room-owner").toMutableMap()
            seats["1"] = TestData.createTestSeat(userId = "seated-user")
            val room =
                TestData.createTestRoom(
                    ownerId = "room-owner",
                    seats = seats,
                    participantIds = setOf("room-owner", "seated-user"),
                )

            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(room))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.seatUsers
                    .containsKey("seated-user"),
            )
            assertEquals(seatedUser, vm.uiState.value.seatUsers["seated-user"])
        }

    // ===== setActive(false) stops refresh =====

    @Test
    fun `setActive false stops periodic refresh`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            vm.setActive(true)
            vm.setActive(false)

            advanceTimeBy(HomeViewModel.REFRESH_INTERVAL_MS * 2)
            runCurrent()

            // Should only have initial load call, no new periodic calls after deactivation
            coVerify(atMost = 2) { userRepository.getBlockedUserIds(currentUserId) }
        }

    // ===== refreshRooms clears cache so users are re-fetched =====

    @Test
    fun `refreshRooms clears user cache and re-fetches users`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-x")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-x")))
            advanceUntilIdle()

            // First emission fetched users
            coVerify(exactly = 1) { userRepository.getUsers(any()) }

            vm.refreshRooms()
            advanceUntilIdle()

            // After refresh, cache cleared so users re-fetched
            coVerify(exactly = 2) { userRepository.getUsers(any()) }
        }

    // ===== observeRooms error =====

    @Test
    fun `observeRooms flow error sets error state`() =
        runTest {
            val errorFlow =
                kotlinx.coroutines.flow.flow<List<ChatRoom>> {
                    throw RuntimeException("stream failed")
                }
            every { roomRepository.getActiveRooms() } returns errorFlow

            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals("stream failed", vm.uiState.value.error)
            assertFalse(vm.uiState.value.isLoading)
        }

    // ===== loadLastRoomName populates state from user =====

    @Test
    fun `init loads lastRoomName from user profile`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(
                    TestData.createTestUser(uid = currentUserId).copy(lastRoomName = "Saved Room"),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals("Saved Room", vm.uiState.value.lastRoomName)
        }

    // ===== signOut with null user =====

    @Test
    fun `signOut calls authRepository even without rooms`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            vm.signOut()

            coVerify { authRepository.signOut() }
        }

    // ===== createRoom sets isLoading during operation =====

    // ===== CLOSED rooms filtered =====

    @Test
    fun `closed room is excluded from list`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-1")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val closedRoom =
                TestData.createTestRoom(
                    roomId = "room-closed",
                    ownerId = "owner-1",
                    state = RoomState.CLOSED,
                )
            val activeRoom =
                TestData.createTestRoom(
                    roomId = "room-active",
                    ownerId = "owner-1",
                    state = RoomState.ACTIVE,
                )
            roomsFlow.emit(listOf(closedRoom, activeRoom))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(1, rooms.size)
            assertEquals("room-active", rooms[0].roomId)
        }

    @Test
    fun `createRoom clears previous error before starting`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("first error")
            vm.createRoom("Room1")
            advanceUntilIdle()
            assertNotNull(vm.uiState.value.error)

            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("room-2")
            vm.createRoom("Room2")
            advanceUntilIdle()

            assertNull(vm.uiState.value.error)
            assertEquals("room-2", vm.uiState.value.createdRoomId)
        }

    // ===== createRoom - duplicate room prevention =====

    @Test
    fun `createRoom shows confirmation when user has active room`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "existing-room-id"

            vm.createRoom("New Room")
            advanceUntilIdle()

            // Should show confirmation instead of creating or showing error
            assertTrue(vm.uiState.value.showReplaceRoomConfirmation)
            assertEquals("New Room", vm.uiState.value.pendingRoomName)
            coVerify(exactly = 0) { roomRepository.createRoom(any(), any()) }
        }

    @Test
    fun `createRoom proceeds when no active room exists after close`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns null
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room-id")

            vm.createRoom("New Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("New Room", currentUserId) }
            assertEquals("new-room-id", vm.uiState.value.createdRoomId)
        }

    @Test
    fun `confirmReplaceRoom closes old rooms then creates new`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "existing-room-id"
            coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-id")

            // First, createRoom shows confirmation
            vm.createRoom("New Room")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.showReplaceRoomConfirmation)

            // Reset findActiveRoomByOwner so doCreateRoom doesn't loop
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns null

            // User confirms — closes old and creates new
            vm.confirmReplaceRoom()
            advanceUntilIdle()

            coVerifyOrder {
                roomRepository.closeAllRoomsByOwner(currentUserId)
                roomRepository.createRoom("New Room", currentUserId)
            }
            assertFalse(vm.uiState.value.showReplaceRoomConfirmation)
            assertEquals("new-id", vm.uiState.value.createdRoomId)
        }

    @Test
    fun `cancelReplaceRoom dismisses confirmation`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "existing-room-id"

            vm.createRoom("New Room")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.showReplaceRoomConfirmation)

            vm.cancelReplaceRoom()

            assertFalse(vm.uiState.value.showReplaceRoomConfirmation)
            assertNull(vm.uiState.value.pendingRoomName)
        }
}
