package com.shyden.shytalk.feature.home

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
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

    private val roomsFlow = MutableSharedFlow<List<ChatRoom>>()
    private val currentUserId = "current-user"

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId
        every { roomRepository.getActiveRooms() } returns roomsFlow
        every { userRepository.userUpdates } returns MutableSharedFlow()
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
    }

    private fun createViewModel() = HomeViewModel(
        roomRepository = roomRepository,
        authRepository = authRepository,
        userRepository = userRepository
    )

    @Test
    fun `room owned by blocked user is excluded`() = runTest {
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("blocked-owner"))
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "blocked-owner"))
        )
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "blocked-owner")))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.rooms.isEmpty())
    }

    @Test
    fun `room whose owner blocked current user is excluded`() = runTest {
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "hostile-owner", blockedUserIds = setOf(currentUserId)))
        )
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "hostile-owner")))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.rooms.isEmpty())
    }

    @Test
    fun `normal room is included`() = runTest {
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "good-owner"))
        )
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "good-owner")))
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.rooms.size)
    }

    @Test
    fun `createRoom closes existing rooms first`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room-id")

        vm.createRoom("My Room")
        advanceUntilIdle()

        coVerify { roomRepository.closeAllRoomsByOwner(currentUserId) }
        coVerify { roomRepository.createRoom("My Room", currentUserId) }
        assertEquals("new-room-id", vm.uiState.value.createdRoomId)
    }

    @Test
    fun `createRoom error sets error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("failed")

        vm.createRoom("My Room")
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertNull(vm.uiState.value.createdRoomId)
    }

    @Test
    fun `onRoomNavigated clears createdRoomId`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room")
        vm.createRoom("Room")
        advanceUntilIdle()

        vm.onRoomNavigated()

        assertNull(vm.uiState.value.createdRoomId)
    }

    @Test
    fun `clearError clears error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("err")
        vm.createRoom("Room")
        advanceUntilIdle()

        vm.clearError()

        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `signOut calls auth signOut`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.signOut()

        verify { authRepository.signOut() }
    }

    @Test
    fun `isLoading becomes false after rooms emit`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(emptyList())
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
    }

    // ===== refreshRooms =====

    @Test
    fun `refreshRooms reloads blocked users and re-filters`() = runTest {
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "owner-1"))
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

        assertTrue(vm.uiState.value.rooms.isEmpty())
        assertFalse(vm.uiState.value.isRefreshing)
    }

    @Test
    fun `refreshRooms sets isRefreshing false after completion`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        roomsFlow.emit(emptyList())
        advanceUntilIdle()

        vm.refreshRooms()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isRefreshing)
    }

    @Test
    fun `createRoom stores lastRoomName in state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room-id")

        vm.createRoom("My Cool Room")
        advanceUntilIdle()

        assertEquals("My Cool Room", vm.uiState.value.lastRoomName)
    }

    @Test
    fun `lastRoomName defaults to empty`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("", vm.uiState.value.lastRoomName)
    }

    @Test
    fun `setActive starts periodic refresh`() = runTest {
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
}
