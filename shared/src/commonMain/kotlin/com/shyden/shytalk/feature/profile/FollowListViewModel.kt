package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.filterSameCohortAs
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FollowListUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val profileUserId: String = "",
    val currentUserId: String = "",
    val isOwnList: Boolean = false,
    val isSuperShy: Boolean = false,
    val selectedTab: FollowTab = FollowTab.FOLLOWERS,
    val followers: List<User> = emptyList(),
    val following: List<User> = emptyList(),
    val currentUserFollowingIds: Set<String> = emptySet(),
    val currentUserFollowerIds: Set<String> = emptySet(),
    val currentUserBlockedIds: Set<String> = emptySet(),
    val followingHidden: Boolean = false,
    val pendingRemoveFollowerId: String? = null,
    val stalkers: List<ProfileVisitor> = emptyList(),
    val stalkerUsers: Map<String, User> = emptyMap(),
    val stalkersLastViewedAt: Long = 0,
    val aliases: Map<String, String> = emptyMap(),
)

enum class FollowTab { FOLLOWING, FOLLOWERS, STALKERS }

class FollowListViewModel(
    private val profileUserId: String,
    initialTab: String,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(FollowListUiState())
    val uiState: StateFlow<FollowListUiState> = _uiState.asStateFlow()

    /**
     * UK OSA #17 PR 12 — cached viewer for the [observeUserUpdates]
     * re-filter path. A mid-session cohort flip pushed through the
     * userUpdates flow must immediately drop the user from the
     * follower / following / stalker lists; we need the viewer's
     * effective cohort at that point but no longer have access to it
     * via the load path. Set by [loadData].
     */
    private var viewer: User? = null

    init {
        val currentUid = authRepository.currentUserId ?: ""
        val tab =
            when (initialTab) {
                "following" -> FollowTab.FOLLOWING
                "stalkers" -> FollowTab.STALKERS
                else -> FollowTab.FOLLOWERS
            }
        _uiState.value =
            FollowListUiState(
                profileUserId = profileUserId,
                currentUserId = currentUid,
                isOwnList = profileUserId == currentUid,
                selectedTab = tab,
            )
        logI(TAG, "Initializing for profile=$profileUserId, tab=$tab, isOwn=${profileUserId == currentUid}")
        loadData()
        observeUserUpdates()
        loadAliases(currentUid)
    }

    private fun loadAliases(userId: String) {
        viewModelScope.launch {
            when (val result = userRepository.getAliases(userId)) {
                is Resource.Success -> _uiState.update { it.copy(aliases = result.data) }
                else -> Unit
            }
        }
    }

    private fun observeUserUpdates() {
        viewModelScope.launch {
            userRepository.userUpdates.collect { updatedUser ->
                _uiState.update { state ->
                    // Apply the user-update in place, then re-filter
                    // through the cohort gate so a mid-session cohort
                    // flip (admin override / age-up) immediately drops
                    // the user from both lists. UK OSA #17 PR 12 — the
                    // observer path must not undo the load-time filter.
                    val nextFollowers =
                        state.followers.map { if (it.uid == updatedUser.uid) updatedUser else it }
                    val nextFollowing =
                        state.following.map { if (it.uid == updatedUser.uid) updatedUser else it }
                    val nextStalkerUsers =
                        if (updatedUser.uid in state.stalkerUsers) {
                            state.stalkerUsers + (updatedUser.uid to updatedUser)
                        } else {
                            state.stalkerUsers
                        }
                    val v = viewer
                    if (v != null) {
                        val filteredFollowers = nextFollowers.filterSameCohortAs(v)
                        val filteredFollowing = nextFollowing.filterSameCohortAs(v)
                        val filteredStalkerUsers =
                            nextStalkerUsers.values
                                .toList()
                                .filterSameCohortAs(v)
                                .associateBy { it.uid }
                        val filteredStalkers = state.stalkers.filter { it.visitorId in filteredStalkerUsers.keys }
                        state.copy(
                            followers = filteredFollowers,
                            following = filteredFollowing,
                            stalkers = filteredStalkers,
                            stalkerUsers = filteredStalkerUsers,
                        )
                    } else {
                        state.copy(
                            followers = nextFollowers,
                            following = nextFollowing,
                            stalkerUsers = nextStalkerUsers,
                        )
                    }
                }
            }
        }
    }

    fun selectTab(tab: FollowTab) {
        logI(TAG, "Selected tab: $tab")
        _uiState.update { it.copy(selectedTab = tab) }
        if (tab == FollowTab.STALKERS && _uiState.value.isOwnList) {
            viewModelScope.launch {
                userRepository.markStalkersViewed(_uiState.value.profileUserId)
            }
        }
    }

    @Suppress("kotlin:S3776")
    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val profileResult = userRepository.getUser(profileUserId)
            if (profileResult !is Resource.Success) {
                val msg = (profileResult as? Resource.Error)?.message ?: "Failed to load profile"
                logE(TAG, "Failed to load profile: $msg")
                _uiState.update { it.copy(isLoading = false, error = msg) }
                return@launch
            }
            val profileUser = profileResult.data
            val followerIdsList = profileUser.followerIds.toList()
            val isFollowingHidden = !_uiState.value.isOwnList && profileUser.hideFollowing
            val followingIdsList = if (isFollowingHidden) emptyList() else profileUser.followingIds.toList()

            // Load current user's follow data for button states. We also
            // capture the viewer's full User doc — UK OSA #17 PR 12 needs
            // their `cohort` / `cohortOverride` to drive the client-side
            // defence-in-depth filter that drops cross-cohort users from
            // the follower / following / stalker lists.
            val currentUid = _uiState.value.currentUserId
            var myFollowingIds: Set<String> = emptySet()
            var myFollowerIds: Set<String> = emptySet()
            var myBlockedIds: Set<String> = emptySet()
            var loadedViewer: User? = null
            if (_uiState.value.isOwnList) {
                myFollowingIds = profileUser.followingIds
                myFollowerIds = profileUser.followerIds
                myBlockedIds = profileUser.blockedUserIds
                loadedViewer = profileUser
            } else if (currentUid.isNotEmpty()) {
                val myResult = userRepository.getUser(currentUid)
                if (myResult is Resource.Success) {
                    myFollowingIds = myResult.data.followingIds
                    myFollowerIds = myResult.data.followerIds
                    myBlockedIds = myResult.data.blockedUserIds
                    loadedViewer = myResult.data
                }
            }
            // Cache for observer-path re-filtering.
            viewer = loadedViewer

            // Batch-fetch all user objects
            val allIds = (followerIdsList + followingIdsList).distinct()
            val allUsers =
                if (allIds.isNotEmpty()) {
                    when (val result = userRepository.getUsers(allIds)) {
                        is Resource.Success -> result.data.associateBy { it.uid }
                        else -> emptyMap()
                    }
                } else {
                    emptyMap()
                }

            logI(TAG, "Loaded ${followerIdsList.size} followers, ${followingIdsList.size} following")

            // Load stalkers if viewing own list
            var stalkerList: List<ProfileVisitor> = emptyList()
            var stalkerUserMap: Map<String, User> = emptyMap()
            var stalkersLastViewed = 0L
            if (_uiState.value.isOwnList) {
                stalkersLastViewed = profileUser.stalkersLastViewedAt
                when (val stalkersResult = userRepository.getStalkers(profileUserId)) {
                    is Resource.Success -> {
                        stalkerList = stalkersResult.data
                        val visitorIds = stalkerList.map { it.visitorId }
                        if (visitorIds.isNotEmpty()) {
                            when (val usersResult = userRepository.getUsers(visitorIds)) {
                                is Resource.Success -> {
                                    stalkerUserMap = usersResult.data.associateBy { it.uid }
                                }

                                else -> Unit
                            }
                        }
                    }

                    else -> Unit
                }
            }

            // UK OSA #17 PR 12 — client-side defence-in-depth: drop
            // cross-cohort users from each list. HIDE policy (not
            // PLACEHOLDER) because anonymous placeholder rows in a
            // follower list would leak cross-cohort follower counts to
            // fingerprinting observers and present creepy UX.
            // Fail-closed: when the viewer's User cannot be resolved,
            // drop EVERY list entry rather than leaking cross-cohort
            // identities through a half-built session.
            val rawFollowers = followerIdsList.mapNotNull { id -> allUsers[id] }
            val rawFollowing = followingIdsList.mapNotNull { id -> allUsers[id] }
            val filteredFollowers = loadedViewer?.let { rawFollowers.filterSameCohortAs(it) } ?: emptyList()
            val filteredFollowing = loadedViewer?.let { rawFollowing.filterSameCohortAs(it) } ?: emptyList()
            val filteredStalkerUsers =
                loadedViewer?.let { v ->
                    stalkerUserMap.values
                        .toList()
                        .filterSameCohortAs(v)
                        .associateBy { it.uid }
                } ?: emptyMap()
            val filteredStalkers = stalkerList.filter { it.visitorId in filteredStalkerUsers.keys }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    isSuperShy = profileUser.isSuperShy,
                    followers = filteredFollowers,
                    following = filteredFollowing,
                    currentUserFollowingIds = myFollowingIds,
                    currentUserFollowerIds = myFollowerIds,
                    currentUserBlockedIds = myBlockedIds,
                    followingHidden = isFollowingHidden,
                    stalkers = filteredStalkers,
                    stalkerUsers = filteredStalkerUsers,
                    stalkersLastViewedAt = stalkersLastViewed,
                )
            }

            // If initial tab is stalkers, mark as viewed immediately
            if (_uiState.value.selectedTab == FollowTab.STALKERS && _uiState.value.isOwnList) {
                userRepository.markStalkersViewed(profileUserId)
            }
        }
    }

    fun toggleFollow(targetUserId: String) {
        val currentUid = _uiState.value.currentUserId
        if (currentUid.isEmpty()) return
        if (targetUserId in _uiState.value.currentUserBlockedIds) return

        val isCurrentlyFollowing = targetUserId in _uiState.value.currentUserFollowingIds
        logI(TAG, "${if (isCurrentlyFollowing) "Unfollowing" else "Following"} user=$targetUserId")

        // Optimistic update
        val newFollowingIds =
            if (isCurrentlyFollowing) {
                _uiState.value.currentUserFollowingIds - targetUserId
            } else {
                _uiState.value.currentUserFollowingIds + targetUserId
            }
        _uiState.update { it.copy(currentUserFollowingIds = newFollowingIds) }

        viewModelScope.launch {
            val result =
                if (isCurrentlyFollowing) {
                    userRepository.unfollowUser(currentUid, targetUserId)
                } else {
                    userRepository.followUser(currentUid, targetUserId)
                }
            if (result is Resource.Error) {
                logE(TAG, "Follow/unfollow failed for user=$targetUserId: ${result.message}")
                _uiState.update {
                    val revertedIds =
                        if (isCurrentlyFollowing) {
                            it.currentUserFollowingIds + targetUserId
                        } else {
                            it.currentUserFollowingIds - targetUserId
                        }
                    it.copy(currentUserFollowingIds = revertedIds, error = result.message)
                }
            }
        }
    }

    private var removeFollowerJob: Job? = null
    private var pendingRemoveUser: User? = null

    fun removeFollower(followerId: String) {
        val currentUid = _uiState.value.profileUserId
        if (!_uiState.value.isOwnList) return
        logI(TAG, "Removing follower=$followerId")

        // Mark as pending remove — keep in list so Undo button is visible
        pendingRemoveUser = _uiState.value.followers.find { it.uid == followerId }
        _uiState.update { it.copy(pendingRemoveFollowerId = followerId) }

        // Auto-confirm after delay
        removeFollowerJob?.cancel()
        removeFollowerJob =
            viewModelScope.launch {
                delay(UNDO_TIMEOUT_MS)
                confirmRemoveFollower(followerId, currentUid)
            }
    }

    fun undoRemoveFollower() {
        removeFollowerJob?.cancel()
        pendingRemoveUser = null
        _uiState.update { it.copy(pendingRemoveFollowerId = null) }
    }

    private fun confirmRemoveFollower(
        followerId: String,
        userId: String,
    ) {
        pendingRemoveUser = null
        _uiState.update {
            it.copy(
                followers = it.followers.filter { u -> u.uid != followerId },
                pendingRemoveFollowerId = null,
            )
        }
        viewModelScope.launch {
            val result = userRepository.removeFollower(userId, followerId)
            if (result is Resource.Error) {
                _uiState.update { it.copy(error = result.message) }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    companion object {
        private const val TAG = "FollowListViewModel"
        private const val UNDO_TIMEOUT_MS = 5000L
    }
}
