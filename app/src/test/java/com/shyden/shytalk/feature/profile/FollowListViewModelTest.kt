package com.shyden.shytalk.feature.profile

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ProfileVisitor
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
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
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
class FollowListViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)

    private val currentUserId = "current-user"
    private val profileUserId = "current-user" // viewing own list

    private val activeViewModels = mutableListOf<FollowListViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId
        every { userRepository.userUpdates } returns MutableSharedFlow()
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
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
        ).also { activeViewModels.add(it) }
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

    // ===== Empty List Tests =====

    @Test
    fun `load followers - empty list shows empty state`() = runTest {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = emptySet(),
            followingIds = setOf("following-1")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "following-1", displayName = "Following 1"))
        )

        val vm = createViewModel(initialTab = "followers")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.followers.isEmpty())
        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `load following - empty list shows empty state`() = runTest {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = setOf("follower-a"),
            followingIds = emptySet()
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "follower-a", displayName = "Alice"))
        )

        val vm = createViewModel(initialTab = "following")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.following.isEmpty())
        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.error)
    }

    // ===== Error Loading List Tests =====

    @Test
    fun `error loading list shows error message`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("Network error")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("Network error", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
        assertTrue(vm.uiState.value.followers.isEmpty())
        assertTrue(vm.uiState.value.following.isEmpty())
    }

    // ===== Follow/Unfollow from List Tests =====

    @Test
    fun `follow user from followers list updates state`() = runTest {
        setupProfileWithFollowers()
        coEvery { userRepository.followUser(any(), any()) } returns Resource.Success(Unit)
        val vm = createViewModel(initialTab = "followers")
        advanceUntilIdle()

        // follower-a is in the followers list but current user is not following them
        assertFalse(vm.uiState.value.currentUserFollowingIds.contains("follower-a"))

        vm.toggleFollow("follower-a")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("follower-a"))
        coVerify { userRepository.followUser(currentUserId, "follower-a") }
    }

    @Test
    fun `unfollow user from following list updates state`() = runTest {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = emptySet(),
            followingIds = setOf("following-1")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "following-1", displayName = "Following 1"))
        )
        coEvery { userRepository.unfollowUser(any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel(initialTab = "following")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("following-1"))

        vm.toggleFollow("following-1")
        advanceUntilIdle()

        assertFalse(vm.uiState.value.currentUserFollowingIds.contains("following-1"))
        coVerify { userRepository.unfollowUser(currentUserId, "following-1") }
    }

    // ===== Load Followers for Other User Tests =====

    @Test
    fun `load followers for other user - not own list`() = runTest {
        val otherUser = "other-user"
        val followerA = TestData.createTestUser(uid = "follower-a", displayName = "Alice")
        val followerB = TestData.createTestUser(uid = "follower-b", displayName = "Bob")
        val profileUser = TestData.createTestUser(
            uid = otherUser,
            displayName = "Other User",
            followerIds = setOf("follower-a", "follower-b"),
            followingIds = setOf("following-1")
        )
        val currentUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followingIds = setOf("follower-a")
        )
        coEvery { userRepository.getUser(otherUser) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(followerA, followerB, TestData.createTestUser(uid = "following-1", displayName = "F1"))
        )

        val vm = createViewModel(profileUid = otherUser, initialTab = "followers")
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOwnList)
        assertEquals(2, vm.uiState.value.followers.size)
        assertFalse(vm.uiState.value.isLoading)
        // Current user's follow state should be loaded for button rendering
        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("follower-a"))
    }

    @Test
    fun `load followers for other user with hidden following`() = runTest {
        val otherUser = "other-user"
        val profileUser = TestData.createTestUser(
            uid = otherUser,
            displayName = "Other User",
            followerIds = setOf("follower-a"),
            followingIds = setOf("following-1"),
            hideFollowing = true
        )
        val currentUser = TestData.createTestUser(uid = currentUserId, displayName = "Current User")
        coEvery { userRepository.getUser(otherUser) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(TestData.createTestUser(uid = "follower-a", displayName = "Alice"))
        )

        val vm = createViewModel(profileUid = otherUser, initialTab = "following")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.followingHidden)
        assertTrue(vm.uiState.value.following.isEmpty())
        assertEquals(1, vm.uiState.value.followers.size)
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

    // ===== Stalkers Tab Tests =====

    private fun setupProfileWithStalkers() {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = setOf("follower-a"),
            followingIds = setOf("following-1"),
            stalkersLastViewedAt = 1_500_000_000L
        )
        val stalkerA = TestData.createTestProfileVisitor(
            visitorId = "stalker-a",
            visitCount = 3,
            lastVisitedAt = 2_000_000_000L
        )
        val stalkerB = TestData.createTestProfileVisitor(
            visitorId = "stalker-b",
            visitCount = 1,
            lastVisitedAt = 1_800_000_000L
        )
        val stalkerUserA = TestData.createTestUser(uid = "stalker-a", displayName = "Stalker A")
        val stalkerUserB = TestData.createTestUser(uid = "stalker-b", displayName = "Stalker B")

        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(match { it.containsAll(listOf("follower-a", "following-1")) }) } returns
            Resource.Success(listOf(
                TestData.createTestUser(uid = "follower-a", displayName = "Follower A"),
                TestData.createTestUser(uid = "following-1", displayName = "Following 1")
            ))
        coEvery { userRepository.getStalkers(currentUserId) } returns Resource.Success(listOf(stalkerA, stalkerB))
        coEvery { userRepository.getUsers(match { it.containsAll(listOf("stalker-a", "stalker-b")) }) } returns
            Resource.Success(listOf(stalkerUserA, stalkerUserB))
        coEvery { userRepository.markStalkersViewed(currentUserId) } returns Resource.Success(Unit)
    }

    @Test
    fun `initial tab stalkers`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        assertEquals(FollowTab.STALKERS, vm.uiState.value.selectedTab)
    }

    @Test
    fun `stalkers loaded for own list`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.stalkers.size)
        assertEquals("stalker-a", vm.uiState.value.stalkers[0].visitorId)
        assertEquals(3L, vm.uiState.value.stalkers[0].visitCount)
    }

    @Test
    fun `stalker users resolved`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        assertEquals("Stalker A", vm.uiState.value.stalkerUsers["stalker-a"]?.displayName)
        assertEquals("Stalker B", vm.uiState.value.stalkerUsers["stalker-b"]?.displayName)
    }

    @Test
    fun `stalkersLastViewedAt set from profile user`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        assertEquals(1_500_000_000L, vm.uiState.value.stalkersLastViewedAt)
    }

    @Test
    fun `selectTab STALKERS calls markStalkersViewed for own list`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "followers")
        advanceUntilIdle()

        vm.selectTab(FollowTab.STALKERS)
        advanceUntilIdle()

        coVerify { userRepository.markStalkersViewed(currentUserId) }
    }

    @Test
    fun `selectTab FOLLOWERS does NOT call markStalkersViewed`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        // Reset verify counts
        vm.selectTab(FollowTab.FOLLOWERS)
        advanceUntilIdle()

        // markStalkersViewed may have been called once for initial stalkers tab, but not for FOLLOWERS
        coVerify(atMost = 1) { userRepository.markStalkersViewed(any()) }
    }

    @Test
    fun `stalkers not loaded for other users list`() = runTest {
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

        assertTrue(vm.uiState.value.stalkers.isEmpty())
        assertFalse(vm.uiState.value.isOwnList)
        coVerify(exactly = 0) { userRepository.getStalkers(any()) }
    }

    @Test
    fun `selectTab STALKERS on other user list does NOT call markStalkersViewed`() = runTest {
        val otherUser = "other-user"
        val profileUser = TestData.createTestUser(uid = otherUser, displayName = "Other")
        coEvery { userRepository.getUser(otherUser) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId)
        )
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(emptyList())

        val vm = createViewModel(profileUid = otherUser)
        advanceUntilIdle()

        vm.selectTab(FollowTab.STALKERS)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.markStalkersViewed(any()) }
    }

    @Test
    fun `initial stalkers tab calls markStalkersViewed`() = runTest {
        setupProfileWithStalkers()
        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        coVerify { userRepository.markStalkersViewed(currentUserId) }
    }

    @Test
    fun `getStalkers error keeps empty list`() = runTest {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User"
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(emptyList())
        coEvery { userRepository.getStalkers(currentUserId) } returns Resource.Error("network error")

        val vm = createViewModel(initialTab = "stalkers")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.stalkers.isEmpty())
        assertTrue(vm.uiState.value.stalkerUsers.isEmpty())
    }

    // ===== toggleFollow — unfollow path =====

    @Test
    fun `toggleFollow - unfollow removes from followingIds`() = runTest {
        // Setup: current user is already following target-user
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = setOf("follower-a"),
            followingIds = setOf("target-user")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(
                TestData.createTestUser(uid = "follower-a", displayName = "Follower A"),
                TestData.createTestUser(uid = "target-user", displayName = "Target User")
            )
        )
        coEvery { userRepository.unfollowUser(any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("target-user"))

        vm.toggleFollow("target-user")
        advanceUntilIdle()

        assertFalse(vm.uiState.value.currentUserFollowingIds.contains("target-user"))
        coVerify { userRepository.unfollowUser(currentUserId, "target-user") }
    }

    @Test
    fun `toggleFollow - unfollow error reverts state`() = runTest {
        val profileUser = TestData.createTestUser(
            uid = currentUserId,
            displayName = "Current User",
            followerIds = setOf("follower-a"),
            followingIds = setOf("target-user")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(profileUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(
            listOf(
                TestData.createTestUser(uid = "follower-a", displayName = "Follower A"),
                TestData.createTestUser(uid = "target-user", displayName = "Target User")
            )
        )
        coEvery { userRepository.unfollowUser(any(), any()) } returns Resource.Error("network fail")

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("target-user"))

        vm.toggleFollow("target-user")
        advanceUntilIdle()

        // State should revert back to following
        assertTrue(vm.uiState.value.currentUserFollowingIds.contains("target-user"))
        assertEquals("network fail", vm.uiState.value.error)
    }

    // ===== toggleFollow — follow error revert =====

    @Test
    fun `toggleFollow - follow error reverts state`() = runTest {
        setupProfileWithFollowers()
        coEvery { userRepository.followUser(any(), any()) } returns Resource.Error("follow failed")

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.currentUserFollowingIds.contains("new-target"))

        vm.toggleFollow("new-target")
        advanceUntilIdle()

        // State should revert back to not-following
        assertFalse(vm.uiState.value.currentUserFollowingIds.contains("new-target"))
        assertEquals("follow failed", vm.uiState.value.error)
    }
}
