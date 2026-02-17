package com.shyden.shytalk.feature.profile

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FollowListViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)

    private val currentUserId = "current-user"
    private val profileUserId = "current-user" // viewing own list

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId
        every { userRepository.userUpdates } returns MutableSharedFlow()
    }

    private fun createViewModel(
        profileUid: String = profileUserId,
        initialTab: String = "followers"
    ): FollowListViewModel {
        return FollowListViewModel(
            profileUserId = profileUid,
            initialTab = initialTab,
            authRepository = authRepository,
            userRepository = userRepository
        )
    }

    private fun setupProfileWithFollowers() {
        val followerA = TestData.createTestUser(uid = "follower-a", displayName = "Alice")
        val followerB = TestData.createTestUser(uid = "follower-b", displayName = "Bob")
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = setOf("follower-a", "follower-b"),
            followingIds = setOf("following-1")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(followerA, followerB))
    }

    // ===== Remove Follower Tests =====

    @Test
    fun `removeFollower - keeps user in list with pending state`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.followers.size)

        vm.removeFollower("follower-a")

        // User stays in list so Undo button is visible
        assertEquals(2, vm.uiState.value.followers.size)
        assertEquals("follower-a", vm.uiState.value.pendingRemoveFollowerId)
    }

    @Test
    fun `removeFollower - sets pendingRemoveFollowerId`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel()
        advanceUntilIdle()

        vm.removeFollower("follower-a")

        assertEquals("follower-a", vm.uiState.value.pendingRemoveFollowerId)
    }

    @Test
    fun `undoRemoveFollower - clears pending state`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel()
        advanceUntilIdle()

        vm.removeFollower("follower-a")
        assertEquals("follower-a", vm.uiState.value.pendingRemoveFollowerId)

        vm.undoRemoveFollower()

        assertEquals(2, vm.uiState.value.followers.size)
        assertNull(vm.uiState.value.pendingRemoveFollowerId)
    }

    @Test
    fun `removeFollower - auto-confirms after timeout`() = runTest {
        setupProfileWithFollowers()
        coEvery { userRepository.removeFollower(any(), any()) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()

        vm.removeFollower("follower-a")
        advanceTimeBy(5001L)

        assertNull(vm.uiState.value.pendingRemoveFollowerId)
        coVerify { userRepository.removeFollower(currentUserId, "follower-a") }
    }

    @Test
    fun `undoRemoveFollower - cancels auto-confirm`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel()
        advanceUntilIdle()

        vm.removeFollower("follower-a")
        vm.undoRemoveFollower()
        advanceTimeBy(5001L)

        // Should NOT have called removeFollower since we cancelled
        coVerify(exactly = 0) { userRepository.removeFollower(any(), any()) }
    }

    @Test
    fun `removeFollower - non-own list is no-op`() = runTest {
        val otherUser = "other-user"
        val profileUser = TestData.createTestUser(
            uid = otherUser,
            displayName = "Other",
            followerIds = setOf("follower-a")
        )
        coEvery { userRepository.getUser(otherUser) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId)
        )
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "follower-a", displayName = "Alice"))
        )

        val vm = createViewModel(profileUid = otherUser)
        advanceUntilIdle()

        vm.removeFollower("follower-a")

        // Should still have the follower — removeFollower is a no-op for non-own lists
        assertEquals(1, vm.uiState.value.followers.size)
    }

    // ===== Tab Selection Tests =====

    @Test
    fun `initial tab followers`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel(initialTab = "followers")
        advanceUntilIdle()

        assertEquals(FollowTab.FOLLOWERS, vm.uiState.value.selectedTab)
    }

    @Test
    fun `initial tab following`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel(initialTab = "following")
        advanceUntilIdle()

        assertEquals(FollowTab.FOLLOWING, vm.uiState.value.selectedTab)
    }

    @Test
    fun `selectTab changes tab`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectTab(FollowTab.FOLLOWING)

        assertEquals(FollowTab.FOLLOWING, vm.uiState.value.selectedTab)
    }

    // ===== toggleFollow Tests =====

    @Test
    fun `toggleFollow - follow adds to followingIds optimistically`() = runTest {
        setupProfileWithFollowers()
        coEvery { userRepository.followUser(any(), any()) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleFollow("target-user")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("target-user"))
    }

    @Test
    fun `toggleFollow - blocked user is rejected`() = runTest {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            blockedUserIds = setOf("blocked-user"),
            followerIds = setOf("follower-a")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "follower-a"))
        )
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleFollow("blocked-user")
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.followUser(any(), any()) }
    }

    @Test
    fun `clearError clears error`() = runTest {
        setupProfileWithFollowers()
        val vm = createViewModel()
        advanceUntilIdle()

        // Force an error via removeFollower failure
        coEvery { userRepository.removeFollower(any(), any()) } returns Resource.Error("fail")
        vm.removeFollower("follower-a")
        advanceTimeBy(5001L)
        assertNotNull(vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }
}
