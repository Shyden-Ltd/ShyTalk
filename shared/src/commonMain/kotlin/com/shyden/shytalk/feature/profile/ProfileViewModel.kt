package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProfileUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val profileSaved: Boolean = false,
    val user: User? = null,
    val isEditing: Boolean = false,
    val isUploadingPhoto: Boolean = false,
    val isOwnProfile: Boolean = true,
    val isBlockedByTarget: Boolean = false,
    val isBlockedByViewer: Boolean = false,
    val currentUserId: String = "",
    val isFollowingTarget: Boolean = false,
    val followerCount: Int = 0,
    val followingCount: Int = 0,
    val isOnline: Boolean = false,
    val hideFollowing: Boolean = false,
    val activeRoomId: String? = null,
    val stalkerCount: Int = 0,
    val newStalkerCount: Int = 0,
    val isTargetSuspended: Boolean = false,
    val isSubmittingReport: Boolean = false,
    val reportSubmitted: Boolean = false,
    val reportError: String? = null
)

class ProfileViewModel(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val storageRepository: StorageRepository,
    private val roomRepository: RoomRepository,
    private val reportRepository: ReportRepository,
    private val economyRepository: EconomyRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init {
        val currentUid = authRepository.currentUserId ?: ""
        _uiState.update { it.copy(currentUserId = currentUid) }
        observeUserUpdates()
    }

    private fun observeUserUpdates() {
        viewModelScope.launch {
            userRepository.userUpdates.collect { updatedUser ->
                val currentUser = _uiState.value.user ?: return@collect
                if (updatedUser.uid == currentUser.uid) {
                    val isOnline = !updatedUser.hideOnlineStatus &&
                        (currentTimeMillis() - updatedUser.lastSeenAt) < Constants.ONLINE_THRESHOLD_MS
                    val activeRoomId = resolveActiveRoomId(updatedUser.currentRoomId, isOnline)
                    _uiState.update { state ->
                        state.copy(
                            user = updatedUser,
                            followerCount = updatedUser.followerIds.size,
                            followingCount = updatedUser.followingIds.size,
                            isOnline = isOnline,
                            activeRoomId = activeRoomId,
                            stalkerCount = if (state.isOwnProfile) updatedUser.stalkerCount.toInt() else state.stalkerCount,
                            newStalkerCount = if (state.isOwnProfile) updatedUser.newStalkerCount.toInt() else state.newStalkerCount
                        )
                    }
                }
            }
        }
    }

    /** Returns the roomId only if the user is online AND the room is still active. */
    private suspend fun resolveActiveRoomId(currentRoomId: String?, isOnline: Boolean): String? {
        if (!isOnline || currentRoomId.isNullOrEmpty()) return null
        val room = roomRepository.getRoomFlow(currentRoomId).first()
        return if (room != null && room.state in listOf(RoomState.ACTIVE, RoomState.OWNER_AWAY)) {
            currentRoomId
        } else {
            null
        }
    }

    fun loadProfile(userId: String?) {
        val currentUid = authRepository.currentUserId ?: return
        val profileUserId = if (userId.isNullOrEmpty() || userId == currentUid) currentUid else userId
        val isOwn = profileUserId == currentUid

        _uiState.update {
            it.copy(isLoading = it.user == null, isOwnProfile = isOwn)
        }

        viewModelScope.launch {
            when (val result = userRepository.getUser(profileUserId)) {
                is Resource.Success -> {
                    val user = result.data
                    val followerCount = user.followerIds.size
                    val followingCount = user.followingIds.size
                    val isOnline = !user.hideOnlineStatus &&
                        (currentTimeMillis() - user.lastSeenAt) < Constants.ONLINE_THRESHOLD_MS

                    val activeRoomId = resolveActiveRoomId(user.currentRoomId, isOnline)

                    if (!isOwn) {
                        // Check if target user is suspended
                        if (user.isActivelySuspended) {
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    user = user,
                                    isTargetSuspended = true
                                )
                            }
                            return@launch
                        }

                        // Fetch viewer's blocked list in parallel with profile load
                        val blockedByTarget = user.blockedUserIds.contains(currentUid)
                        val viewerBlockedTarget = coroutineScope {
                            val blockedDeferred = async { userRepository.getBlockedUserIds(currentUid) }
                            when (val blockedResult = blockedDeferred.await()) {
                                is Resource.Success -> blockedResult.data.contains(profileUserId)
                                else -> false
                            }
                        }
                        val isFollowing = user.followerIds.contains(currentUid)
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                user = user,
                                isBlockedByTarget = blockedByTarget,
                                isBlockedByViewer = viewerBlockedTarget,
                                isFollowingTarget = isFollowing,
                                followerCount = followerCount,
                                followingCount = followingCount,
                                isOnline = isOnline,
                                hideFollowing = user.hideFollowing,
                                activeRoomId = activeRoomId
                            )
                        }
                        // Record profile visit (fire-and-forget)
                        if (!blockedByTarget) {
                            viewModelScope.launch {
                                userRepository.recordProfileVisit(profileUserId, currentUid)
                            }
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                user = user,
                                followerCount = followerCount,
                                followingCount = followingCount,
                                isOnline = isOnline,
                                hideFollowing = user.hideFollowing,
                                activeRoomId = activeRoomId,
                                stalkerCount = user.stalkerCount.toInt(),
                                newStalkerCount = user.newStalkerCount.toInt()
                            )
                        }
                        if (user.uniqueId == 0L) {
                            generateUniqueId(currentUid)
                        }
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun saveProfile(displayName: String, dateOfBirth: Long) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val user = User(
                uid = userId,
                displayName = displayName,
                dateOfBirth = dateOfBirth,
                email = authRepository.currentUserEmail
            )
            when (val result = userRepository.createOrUpdateUser(user)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoading = false, profileSaved = true, user = user) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    private fun generateUniqueId(userId: String) {
        viewModelScope.launch {
            when (val result = userRepository.generateUniqueId(userId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(user = it.user?.copy(uniqueId = result.data)) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = result.message ?: "Failed to generate unique ID") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateDisplayName(displayName: String) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = userRepository.updateDisplayName(userId, displayName)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(isLoading = false, user = it.user?.copy(displayName = displayName))
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun saveProfileEdits(displayName: String, description: String, nationality: String?) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val fields = mutableMapOf<String, Any?>(
                "displayName" to displayName,
                "description" to description
            )
            if (nationality != null) {
                fields["nationality"] = nationality
            }
            when (val result = userRepository.updateProfile(userId, fields)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isEditing = false,
                            user = it.user?.copy(
                                displayName = displayName,
                                description = description,
                                nationality = nationality ?: it.user?.nationality
                            )
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun uploadProfilePhoto(imageData: ByteArray) {
        val oldUrl = _uiState.value.user?.profilePhotoUrl
        uploadPhoto(imageData, "profile_photos", "profilePhotoUrl", oldUrl) { url ->
            _uiState.value.user?.copy(profilePhotoUrl = url)
        }
    }

    fun uploadCoverPhoto(imageData: ByteArray) {
        val oldUrl = _uiState.value.user?.coverPhotoUrl
        uploadPhoto(imageData, "cover_photos", "coverPhotoUrl", oldUrl) { url ->
            _uiState.value.user?.copy(coverPhotoUrl = url)
        }
    }

    private fun uploadPhoto(
        imageData: ByteArray,
        folder: String,
        profileField: String,
        oldUrl: String?,
        updateUser: (String) -> User?
    ) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isUploadingPhoto = true) }
            when (val result = storageRepository.uploadImage(userId, folder, imageData)) {
                is Resource.Success -> {
                    val url = result.data
                    when (val saveResult = userRepository.updateProfile(userId, mapOf(profileField to url))) {
                        is Resource.Success -> {
                            _uiState.update { it.copy(isUploadingPhoto = false, user = updateUser(url)) }
                            if (!oldUrl.isNullOrEmpty()) {
                                storageRepository.deleteImageByUrl(oldUrl)
                            }
                        }
                        is Resource.Error -> {
                            _uiState.update {
                                it.copy(isUploadingPhoto = false, error = saveResult.message ?: "Failed to save photo URL")
                            }
                        }
                        is Resource.Loading -> {}
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isUploadingPhoto = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleEditing() {
        _uiState.update { it.copy(isEditing = !it.isEditing) }
    }

    fun blockUser(targetUserId: String) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            when (userRepository.blockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isBlockedByViewer = true,
                            isFollowingTarget = false,
                            followerCount = if (it.isFollowingTarget) it.followerCount - 1 else it.followerCount
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to block user") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            when (userRepository.unblockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isBlockedByViewer = false) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to unblock user") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun followUser(targetUserId: String) {
        val userId = authRepository.currentUserId ?: return
        if (_uiState.value.isBlockedByViewer || _uiState.value.isBlockedByTarget) return
        _uiState.update { it.copy(isFollowingTarget = true, followerCount = it.followerCount + 1) }
        viewModelScope.launch {
            when (userRepository.followUser(userId, targetUserId)) {
                is Resource.Success -> {}
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isFollowingTarget = false,
                            followerCount = it.followerCount - 1,
                            error = "Failed to follow user"
                        )
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unfollowUser(targetUserId: String) {
        val userId = authRepository.currentUserId ?: return
        _uiState.update { it.copy(isFollowingTarget = false, followerCount = it.followerCount - 1) }
        viewModelScope.launch {
            when (userRepository.unfollowUser(userId, targetUserId)) {
                is Resource.Success -> {}
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isFollowingTarget = true,
                            followerCount = it.followerCount + 1,
                            error = "Failed to unfollow user"
                        )
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun reportUser(
        reason: String,
        description: String,
        evidenceImages: List<Pair<ByteArray, String>> = emptyList()
    ) {
        val currentUid = authRepository.currentUserId ?: return
        val targetUser = _uiState.value.user ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingReport = true, reportError = null) }

            val currentUser = when (val r = userRepository.getUser(currentUid)) {
                is Resource.Success -> r.data
                else -> {
                    _uiState.update { it.copy(isSubmittingReport = false, reportError = "Could not submit report") }
                    return@launch
                }
            }

            // Upload evidence
            val evidenceUrls = mutableListOf<String>()
            for ((bytes, mimeType) in evidenceImages) {
                when (val r = storageRepository.uploadImage(
                    currentUser.uid, "report_evidence", bytes, mimeType
                )) {
                    is Resource.Success -> evidenceUrls.add(r.data)
                    is Resource.Error -> {
                        _uiState.update { it.copy(isSubmittingReport = false, reportError = "Failed to upload evidence") }
                        return@launch
                    }
                    is Resource.Loading -> {}
                }
            }

            when (reportRepository.reportUser(
                reporterId = currentUser.uid,
                reporterName = currentUser.displayName,
                reporterUniqueId = currentUser.uniqueId,
                reportedUserId = targetUser.uid,
                reportedUserName = targetUser.displayName,
                reportedUserUniqueId = targetUser.uniqueId,
                conversationId = "",
                reason = reason,
                description = description,
                evidenceUrls = evidenceUrls
            )) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isSubmittingReport = false, reportSubmitted = true) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isSubmittingReport = false, reportError = "Failed to submit report") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearReportSubmitted() {
        _uiState.update { it.copy(reportSubmitted = false, reportError = null) }
    }

    fun validateSuperShyPurchase(productId: String, purchaseToken: String) {
        viewModelScope.launch {
            when (val result = economyRepository.purchaseSubscription(productId, purchaseToken)) {
                is Resource.Success -> {
                    // Reload profile to pick up isSuperShy change
                    loadProfile(null)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = result.message ?: "Purchase validation failed") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun claimSuperShyTrial() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            when (val result = economyRepository.claimSuperShyTrial()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            user = it.user?.copy(hasClaimedSuperShyTrial = true)
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message ?: "Failed to claim trial") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun testPurchaseSuperShy(productId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            when (val result = economyRepository.purchaseSubscription(productId, "test_token")) {
                is Resource.Success -> {
                    loadProfile(null)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message ?: "Test purchase failed") }
                }
                is Resource.Loading -> {}
            }
        }
    }
}
