package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewMessageViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val pmRepository = mockk<PrivateMessageRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)

    private val activeViewModels = mutableListOf<NewMessageViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns "me"
        every { pmRepository.getConversations("me") } returns flowOf(emptyList())
        coEvery { pmRepository.getOwnedGroupCount("me") } returns Resource.Success(0)
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel(): NewMessageViewModel {
        return NewMessageViewModel(pmRepository, userRepository, authRepository)
            .also { activeViewModels.add(it) }
    }

    @Test
    fun `loadAvailableUsers populates sorted user list from followers and following`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = "me",
            followerIds = setOf("alice", "bob"),
            followingIds = setOf("bob", "charlie")
        )
        coEvery { userRepository.getUser("me") } returns Resource.Success(currentUser)

        val alice = TestData.createTestUser(uid = "alice", displayName = "Alice")
        val bob = TestData.createTestUser(uid = "bob", displayName = "Bob")
        val charlie = TestData.createTestUser(uid = "charlie", displayName = "Charlie")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(alice, bob, charlie))

        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertFalse(state.isLoading)
        assertEquals(3, state.availableUsers.size)
        // Should be sorted by displayName lowercase
        assertEquals("Alice", state.availableUsers[0].displayName)
        assertEquals("Bob", state.availableUsers[1].displayName)
        assertEquals("Charlie", state.availableUsers[2].displayName)
    }

    @Test
    fun `loadAvailableUsers with no connections sets empty list`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = "me",
            followerIds = emptySet(),
            followingIds = emptySet()
        )
        coEvery { userRepository.getUser("me") } returns Resource.Success(currentUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.availableUsers.isEmpty())
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `loadAvailableUsers failure sets error`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Error("Network error")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("Failed to load user data", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `toggleSelection adds userId`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me", followerIds = setOf("u1"))
        )
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "u1"))
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleSelection("u1")
        assertTrue(vm.uiState.value.selectedIds.contains("u1"))
    }

    @Test
    fun `toggleSelection removes already-selected userId`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me", followerIds = setOf("u1"))
        )
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "u1"))
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleSelection("u1")
        assertTrue(vm.uiState.value.selectedIds.contains("u1"))

        vm.toggleSelection("u1")
        assertFalse(vm.uiState.value.selectedIds.contains("u1"))
    }

    @Test
    fun `toggleSelection at max participants shows error`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me")
        )

        val vm = createViewModel()
        advanceUntilIdle()

        // Fill to max - 1 (since max includes the current user)
        repeat(Constants.MAX_GROUP_PARTICIPANTS - 1) { i ->
            vm.toggleSelection("user-$i")
        }

        // One more should trigger error
        vm.toggleSelection("one-too-many")

        assertEquals(
            "Maximum ${Constants.MAX_GROUP_PARTICIPANTS} participants allowed",
            vm.uiState.value.error
        )
    }

    @Test
    fun `setSearchQuery updates query`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me")
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setSearchQuery("alice")
        assertEquals("alice", vm.uiState.value.searchQuery)
    }

    @Test
    fun `toggleSearchAllMode toggles mode and clears results`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me")
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.searchAllMode)

        vm.toggleSearchAllMode()
        assertTrue(vm.uiState.value.searchAllMode)
        assertTrue(vm.uiState.value.allUsersSearchResults.isEmpty())

        vm.toggleSearchAllMode()
        assertFalse(vm.uiState.value.searchAllMode)
    }

    @Test
    fun `getFilteredUsers filters by displayName`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = "me",
            followerIds = setOf("u1", "u2", "u3")
        )
        coEvery { userRepository.getUser("me") } returns Resource.Success(currentUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(
                TestData.createTestUser(uid = "u1", displayName = "Alice"),
                TestData.createTestUser(uid = "u2", displayName = "Bob"),
                TestData.createTestUser(uid = "u3", displayName = "Alicia")
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setSearchQuery("Ali")
        val filtered = vm.getFilteredUsers()
        assertEquals(2, filtered.size)
        assertTrue(filtered.all { it.displayName.contains("Ali", ignoreCase = true) })
    }

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me")
        )

        val vm = createViewModel()
        advanceUntilIdle()

        // Trigger an error via selection overflow
        repeat(Constants.MAX_GROUP_PARTICIPANTS - 1) { i ->
            vm.toggleSelection("user-$i")
        }
        vm.toggleSelection("overflow")
        assertTrue(vm.uiState.value.error != null)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ===== Search with no results =====

    @Test
    fun `getFilteredUsers with non-matching query returns empty list`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = "me",
            followerIds = setOf("u1", "u2")
        )
        coEvery { userRepository.getUser("me") } returns Resource.Success(currentUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(
                TestData.createTestUser(uid = "u1", displayName = "Alice"),
                TestData.createTestUser(uid = "u2", displayName = "Bob")
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setSearchQuery("Zzzzz")
        val filtered = vm.getFilteredUsers()
        assertTrue(filtered.isEmpty())
    }

    // ===== Search with special characters =====

    @Test
    fun `getFilteredUsers with special characters does not crash`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = "me",
            followerIds = setOf("u1")
        )
        coEvery { userRepository.getUser("me") } returns Resource.Success(currentUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "u1", displayName = "Alice"))
        )

        val vm = createViewModel()
        advanceUntilIdle()

        // Various special characters that could break regex or string matching
        vm.setSearchQuery(".*+?[]{}()")
        val filtered = vm.getFilteredUsers()
        assertTrue(filtered.isEmpty())

        vm.setSearchQuery("Ali")
        val filtered2 = vm.getFilteredUsers()
        assertEquals(1, filtered2.size)
    }

    // ===== Select user then deselect clears selection =====

    @Test
    fun `select user then deselect clears selection completely`() = runTest {
        coEvery { userRepository.getUser("me") } returns Resource.Success(
            TestData.createTestUser(uid = "me", followerIds = setOf("u1", "u2"))
        )
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(
                TestData.createTestUser(uid = "u1"),
                TestData.createTestUser(uid = "u2")
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        // Select two users
        vm.toggleSelection("u1")
        vm.toggleSelection("u2")
        assertEquals(setOf("u1", "u2"), vm.uiState.value.selectedIds)

        // Deselect both
        vm.toggleSelection("u1")
        vm.toggleSelection("u2")
        assertTrue(vm.uiState.value.selectedIds.isEmpty())
    }
}
