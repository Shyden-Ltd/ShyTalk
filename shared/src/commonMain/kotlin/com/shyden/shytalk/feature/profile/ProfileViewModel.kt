package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.compressImage
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.report.UserReportOutcome
import com.shyden.shytalk.feature.report.submitUserReport
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProfileUiState(
    val isLoading: Boolean = false,
    val error: UiText? = null,
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
    val lastActiveText: UiText? = null,
    val hideFollowing: Boolean = false,
    val activeRoomId: String? = null,
    val stalkerCount: Int = 0,
    val newStalkerCount: Int = 0,
    val isTargetSuspended: Boolean = false,
    val isSubmittingReport: Boolean = false,
    val reportSubmitted: Boolean = false,
    val reportError: UiText? = null,
    val isPurchasingSuperShy: Boolean = false,
    val isRefreshing: Boolean = false,
)

class ProfileViewModel(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val storageRepository: StorageRepository,
    private val roomRepository: RoomRepository,
    private val reportRepository: ReportRepository,
    private val economyRepository: EconomyRepository,
    private val identityRepository: IdentityRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "ProfileViewModel"
    }

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init {
        val currentUid = authRepository.currentUserId ?: ""
        _uiState.update { it.copy(currentUserId = currentUid) }
        observeUserUpdates()
    }

    /**
     * Returns a localized "last active" text, or null if the user is online
     * or has hidden their online status.
     */
    private fun computeLastActiveText(user: com.shyden.shytalk.core.model.User): UiText? {
        if (user.hideOnlineStatus) return null
        val elapsed = currentTimeMillis() - user.lastSeenAt
        if (elapsed < Constants.ONLINE_THRESHOLD_MS) return null // currently online
        val minutes = elapsed / 60_000L
        val hours = minutes / 60
        val days = hours / 24
        return when {
            days > 30 -> UiText.res(Res.string.active_long_ago)
            days >= 1 -> UiText.res(Res.string.active_days_ago, days.toInt())
            hours >= 1 -> UiText.res(Res.string.active_hours_ago, hours.toInt())
            minutes >= 1 -> UiText.res(Res.string.active_minutes_ago, minutes.toInt())
            else -> UiText.res(Res.string.active_just_now)
        }
    }

    private fun observeUserUpdates() {
        viewModelScope.launch {
            userRepository.userUpdates.collect { updatedUser ->
                val currentUser = _uiState.value.user ?: return@collect
                if (updatedUser.uid == currentUser.uid) {
                    val isOnline =
                        !updatedUser.hideOnlineStatus &&
                            (currentTimeMillis() - updatedUser.lastSeenAt) < Constants.ONLINE_THRESHOLD_MS
                    val activeRoomId = resolveActiveRoomId(updatedUser.currentRoomId, isOnline)
                    _uiState.update { state ->
                        state.copy(
                            user = updatedUser,
                            followerCount = updatedUser.followerIds.size,
                            followingCount = updatedUser.followingIds.size,
                            isOnline = isOnline,
                            lastActiveText = computeLastActiveText(updatedUser),
                            activeRoomId = activeRoomId,
                            stalkerCount = if (state.isOwnProfile) updatedUser.stalkerCount.toInt() else state.stalkerCount,
                            newStalkerCount = if (state.isOwnProfile) updatedUser.newStalkerCount.toInt() else state.newStalkerCount,
                        )
                    }
                }
            }
        }
    }

    /** Returns the roomId only if the user is online AND the room is still active. */
    private suspend fun resolveActiveRoomId(
        currentRoomId: String?,
        isOnline: Boolean,
    ): String? {
        if (!isOnline || currentRoomId.isNullOrEmpty()) return null
        val room = roomRepository.getRoomFlow(currentRoomId).firstOrNull()
        return if (room != null && room.state in listOf(RoomState.ACTIVE, RoomState.OWNER_AWAY)) {
            currentRoomId
        } else {
            null
        }
    }

    @Suppress("kotlin:S3776")
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
                    val isOnline =
                        !user.hideOnlineStatus &&
                            (currentTimeMillis() - user.lastSeenAt) < Constants.ONLINE_THRESHOLD_MS

                    val activeRoomId = resolveActiveRoomId(user.currentRoomId, isOnline)

                    if (!isOwn) {
                        // Check if target user is suspended
                        if (user.isActivelySuspended) {
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    user = user,
                                    isTargetSuspended = true,
                                )
                            }
                            return@launch
                        }

                        // Fetch viewer's blocked list in parallel with profile load
                        val blockedByTarget = user.blockedUserIds.contains(currentUid)
                        val viewerBlockedTarget =
                            coroutineScope {
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
                                lastActiveText = computeLastActiveText(user),
                                hideFollowing = user.hideFollowing,
                                activeRoomId = activeRoomId,
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
                                lastActiveText = computeLastActiveText(user),
                                hideFollowing = user.hideFollowing,
                                activeRoomId = activeRoomId,
                                stalkerCount = user.stalkerCount.toInt(),
                                newStalkerCount = user.newStalkerCount.toInt(),
                            )
                        }
                        if (user.uniqueId == 0L) {
                            generateUniqueId(currentUid)
                        }
                    }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun refreshProfile() {
        val userId = _uiState.value.user?.uid ?: authRepository.currentUserId ?: return
        val targetId = if (_uiState.value.isOwnProfile) null else userId
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            loadProfile(targetId)
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    fun saveProfile(
        displayName: String,
        dateOfBirth: Long,
    ) {
        logI(TAG, "Creating new user profile")
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val providerInfo = authRepository.getProviderInfo()
            if (providerInfo == null) {
                _uiState.update { it.copy(isLoading = false, error = UiText.plain("No provider info available")) }
                return@launch
            }
            val (provider, identifier) = providerInfo

            when (
                val result =
                    identityRepository.createUser(
                        provider = provider,
                        identifier = identifier,
                        displayName = displayName,
                        email = authRepository.currentUserEmail,
                        profilePhotoUrl = null,
                        dateOfBirth = dateOfBirth,
                        language = LanguagePreference.get(),
                    )
            ) {
                is Resource.Success -> {
                    val uniqueId = result.data.uniqueId
                    logI(TAG, "User created with uniqueId=$uniqueId")
                    // Set resolvedUniqueId so currentUserId returns the new uniqueId
                    authRepository.resolvedUniqueId = uniqueId.toString()
                    // Refresh token to pick up custom claims (uniqueId)
                    identityRepository.forceRefreshToken()
                    val user =
                        User(
                            uid = uniqueId.toString(),
                            uniqueId = uniqueId,
                            displayName = displayName,
                            dateOfBirth = dateOfBirth,
                            email = authRepository.currentUserEmail,
                        )
                    _uiState.update { it.copy(isLoading = false, profileSaved = true, user = user) }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
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
                    _uiState.update { it.copy(error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
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
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun saveProfileEdits(
        displayName: String,
        description: String,
        nationality: String?,
    ) {
        val userId = authRepository.currentUserId ?: return
        logI(TAG, "Updating profile for userId=$userId")
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val fields =
                mutableMapOf<String, Any?>(
                    "displayName" to displayName,
                    "description" to description,
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
                            user =
                                it.user?.copy(
                                    displayName = displayName,
                                    description = description,
                                    nationality = nationality ?: it.user.nationality,
                                ),
                        )
                    }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun uploadProfilePhoto(imageData: ByteArray) {
        val oldUrl = _uiState.value.user?.profilePhotoUrl
        uploadPhoto(imageData, "profiles", "profilePhotoUrl", oldUrl) { url ->
            _uiState.value.user?.copy(profilePhotoUrl = url)
        }
    }

    fun uploadCoverPhoto(imageData: ByteArray) {
        val oldUrl = _uiState.value.user?.coverPhotoUrl
        uploadPhoto(imageData, "covers", "coverPhotoUrl", oldUrl) { url ->
            _uiState.value.user?.copy(coverPhotoUrl = url)
        }
    }

    private fun uploadPhoto(
        imageData: ByteArray,
        folder: String,
        profileField: String,
        oldUrl: String?,
        updateUser: (String) -> User?,
    ) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isUploadingPhoto = true) }
            val compressed = compressImage(imageData)
            when (val result = storageRepository.uploadImage(userId, folder, compressed)) {
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
                                it.copy(isUploadingPhoto = false, error = UiText.plain(saveResult.message))
                            }
                        }

                        is Resource.Loading -> Unit
                    }
                }

                is Resource.Error -> {
                    logE(TAG, "Photo upload failed: ${result.message}")
                    _uiState.update { it.copy(isUploadingPhoto = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
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
                            followerCount = if (it.isFollowingTarget) it.followerCount - 1 else it.followerCount,
                        )
                    }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = UiText.res(Res.string.error_block_user)) }
                }

                is Resource.Loading -> Unit
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
                    _uiState.update { it.copy(error = UiText.res(Res.string.error_unblock_user)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun followUser(targetUserId: String) {
        val userId = authRepository.currentUserId ?: return
        if (_uiState.value.isBlockedByViewer || _uiState.value.isBlockedByTarget) return
        _uiState.update { it.copy(isFollowingTarget = true, followerCount = it.followerCount + 1) }
        viewModelScope.launch {
            when (userRepository.followUser(userId, targetUserId)) {
                is Resource.Success -> Unit

                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isFollowingTarget = false,
                            followerCount = it.followerCount - 1,
                            error = UiText.res(Res.string.error_follow_user),
                        )
                    }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun unfollowUser(targetUserId: String) {
        val userId = authRepository.currentUserId ?: return
        _uiState.update { it.copy(isFollowingTarget = false, followerCount = it.followerCount - 1) }
        viewModelScope.launch {
            when (userRepository.unfollowUser(userId, targetUserId)) {
                is Resource.Success -> Unit

                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isFollowingTarget = true,
                            followerCount = it.followerCount + 1,
                            error = UiText.res(Res.string.error_unfollow_user),
                        )
                    }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun reportUser(
        reason: String,
        description: String,
        evidenceImages: List<Pair<ByteArray, String>> = emptyList(),
    ) {
        val currentUid = authRepository.currentUserId ?: return
        val targetUser = _uiState.value.user ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingReport = true, reportError = null) }

            val currentUser =
                when (val result = userRepository.getUser(currentUid)) {
                    is Resource.Success -> result.data

                    else -> {
                        _uiState.update {
                            it.copy(
                                isSubmittingReport = false,
                                reportError = UiText.res(Res.string.error_could_not_submit_report),
                            )
                        }
                        return@launch
                    }
                }

            when (
                submitUserReport(
                    reportRepository = reportRepository,
                    storageRepository = storageRepository,
                    currentUser = currentUser,
                    targetUser = targetUser,
                    reason = reason,
                    description = description,
                    evidenceImages = evidenceImages,
                )
            ) {
                UserReportOutcome.Success ->
                    _uiState.update { it.copy(isSubmittingReport = false, reportSubmitted = true) }

                UserReportOutcome.EvidenceUploadFailed ->
                    _uiState.update {
                        it.copy(
                            isSubmittingReport = false,
                            reportError = UiText.res(Res.string.error_upload_evidence),
                        )
                    }

                UserReportOutcome.ReportSubmitFailed ->
                    _uiState.update {
                        it.copy(
                            isSubmittingReport = false,
                            reportError = UiText.res(Res.string.error_submit_report),
                        )
                    }
            }
        }
    }

    fun clearReportSubmitted() {
        _uiState.update { it.copy(reportSubmitted = false, reportError = null) }
    }

    fun validateSuperShyPurchase(
        productId: String,
        purchaseToken: String,
    ) {
        viewModelScope.launch {
            when (val result = economyRepository.purchaseSubscription(productId, purchaseToken)) {
                is Resource.Success -> {
                    // Reload profile to pick up isSuperShy change
                    loadProfile(null)
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun claimSuperShyTrial() {
        viewModelScope.launch {
            when (val result = economyRepository.claimSuperShyTrial()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(user = it.user?.copy(hasClaimedSuperShyTrial = true))
                    }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun testPurchaseSuperShy(productId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isPurchasingSuperShy = true) }
            when (val result = economyRepository.purchaseSubscription(productId, "test_token")) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isPurchasingSuperShy = false) }
                    loadProfile(null)
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(isPurchasingSuperShy = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }
}
