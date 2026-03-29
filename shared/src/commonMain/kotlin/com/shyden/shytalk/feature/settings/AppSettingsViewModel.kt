package com.shyden.shytalk.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.LinkedProvider
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.ProviderType
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed class UpdateCheckResult {
    data object UpToDate : UpdateCheckResult()

    data class UpdateAvailable(
        val versionName: String,
    ) : UpdateCheckResult()

    data class Error(
        val message: UiText,
    ) : UpdateCheckResult()
}

data class AppSettingsUiState(
    val isLoading: Boolean = true,
    val error: UiText? = null,
    val user: User? = null,
    val isUnlinkingProvider: Boolean = false,
    val blockedUsers: List<User> = emptyList(),
    val hideFollowing: Boolean = false,
    val hideOnlineStatus: Boolean = false,
    val hideAge: Boolean = false,
    val pmPrivacy: PmPrivacy = PmPrivacy.EVERYONE,
    val pmNotificationsEnabled: Boolean = true,
    val pmSoundEnabled: Boolean = true,
    val pmNotificationPreview: Boolean = true,
    val pmShowTimestamps: Boolean = true,
    val pmShowDateSeparators: Boolean = true,
    val dndEnabled: Boolean = false,
    val dndStartHour: Int = 22,
    val dndStartMinute: Int = 0,
    val dndEndHour: Int = 8,
    val dndEndMinute: Int = 0,
    val minGiftAnimationValue: Int = 0,
    val selfDestructAlertEnabled: Boolean = false,
    val cacheSizeBytes: Long = 0L,
    val cacheCleared: Boolean = false,
    val showClearCacheDialog: Boolean = false,
    val updateCheckResult: UpdateCheckResult? = null,
    val isCheckingUpdate: Boolean = false,
    val language: String = LanguagePreference.get(),
    val currentSignInProvider: String? = null,
    // Account deletion
    val isDeletionRequesting: Boolean = false,
    val deletionScheduled: Boolean = false,
    val deletionDeleteAt: Long? = null,
    val deletionError: UiText? = null,
)

class AppSettingsViewModel(
    private val appConfigService: AppConfigService,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val identityRepository: IdentityRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "AppSettingsViewModel"
    }

    private val _uiState = MutableStateFlow(AppSettingsUiState())
    val uiState: StateFlow<AppSettingsUiState> = _uiState.asStateFlow()

    private val currentUserId: String = authRepository.currentUserId ?: ""

    init {
        logI(TAG, "Loading app settings")
        loadSettings()
        loadCacheSize()
    }

    private fun loadCacheSize() {
        _uiState.update { it.copy(cacheSizeBytes = appConfigService.getCacheSizeBytes()) }
    }

    private fun loadSettings() {
        if (currentUserId.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val providerInfo = authRepository.getProviderInfo()
            when (val result = userRepository.getUser(currentUserId)) {
                is Resource.Success -> {
                    val user = result.data
                    val blockedUsers =
                        if (user.blockedUserIds.isNotEmpty()) {
                            (userRepository.getUsers(user.blockedUserIds.toList()) as? Resource.Success)?.data
                                ?: emptyList()
                        } else {
                            emptyList()
                        }

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            user = user,
                            blockedUsers = blockedUsers,
                            hideFollowing = user.hideFollowing,
                            hideOnlineStatus = user.hideOnlineStatus,
                            hideAge = user.hideAge,
                            pmPrivacy = user.pmPrivacy,
                            pmNotificationsEnabled = user.pmNotificationsEnabled,
                            pmSoundEnabled = user.pmSoundEnabled,
                            pmNotificationPreview = user.pmNotificationPreview,
                            pmShowTimestamps = user.pmShowTimestamps,
                            pmShowDateSeparators = user.pmShowDateSeparators,
                            dndEnabled = user.dndEnabled,
                            dndStartHour = user.dndStartHour,
                            dndStartMinute = user.dndStartMinute,
                            dndEndHour = user.dndEndHour,
                            dndEndMinute = user.dndEndMinute,
                            minGiftAnimationValue = user.minGiftAnimationValue,
                            selfDestructAlertEnabled = user.selfDestructAlertEnabled,
                            language = user.language,
                            currentSignInProvider = providerInfo?.first,
                            deletionScheduled = user.isPendingDeletion,
                            deletionDeleteAt = user.deletionExecuteAt,
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        viewModelScope.launch {
            when (userRepository.unblockUser(currentUserId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            blockedUsers = it.blockedUsers.filter { u -> u.uid != targetUserId },
                            user =
                                it.user?.copy(
                                    blockedUserIds = it.user.blockedUserIds - targetUserId,
                                ),
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = UiText.res(Res.string.error_unblock_user)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleHideFollowing() =
        togglePrivacySetting(
            key = "hideFollowing",
            currentValue = _uiState.value.hideFollowing,
            applyOptimistic = { value -> _uiState.update { it.copy(hideFollowing = value) } },
        )

    fun toggleHideOnlineStatus() =
        togglePrivacySetting(
            key = "hideOnlineStatus",
            currentValue = _uiState.value.hideOnlineStatus,
            applyOptimistic = { value -> _uiState.update { it.copy(hideOnlineStatus = value) } },
        )

    fun setPmPrivacy(privacy: PmPrivacy) {
        val oldValue = _uiState.value.pmPrivacy
        _uiState.update { it.copy(pmPrivacy = privacy) }
        viewModelScope.launch {
            when (userRepository.updateProfile(currentUserId, mapOf("pmPrivacy" to privacy.name))) {
                is Resource.Success -> {}
                is Resource.Error -> {
                    _uiState.update { it.copy(pmPrivacy = oldValue, error = UiText.res(Res.string.error_update_privacy)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleHideAge() =
        togglePrivacySetting(
            key = "hideAge",
            currentValue = _uiState.value.hideAge,
            applyOptimistic = { value -> _uiState.update { it.copy(hideAge = value) } },
        )

    private fun togglePrivacySetting(
        key: String,
        currentValue: Boolean,
        applyOptimistic: (Boolean) -> Unit,
    ) {
        val newValue = !currentValue
        applyOptimistic(newValue)
        viewModelScope.launch {
            when (userRepository.updateProfile(currentUserId, mapOf(key to newValue))) {
                is Resource.Success -> {}
                is Resource.Error -> {
                    applyOptimistic(currentValue)
                    _uiState.update { it.copy(error = UiText.res(Res.string.error_update_privacy)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun togglePmNotifications() =
        togglePrivacySetting(
            key = "pmNotificationsEnabled",
            currentValue = _uiState.value.pmNotificationsEnabled,
            applyOptimistic = { value -> _uiState.update { it.copy(pmNotificationsEnabled = value) } },
        )

    fun togglePmSound() =
        togglePrivacySetting(
            key = "pmSoundEnabled",
            currentValue = _uiState.value.pmSoundEnabled,
            applyOptimistic = { value -> _uiState.update { it.copy(pmSoundEnabled = value) } },
        )

    fun togglePmPreview() =
        togglePrivacySetting(
            key = "pmNotificationPreview",
            currentValue = _uiState.value.pmNotificationPreview,
            applyOptimistic = { value -> _uiState.update { it.copy(pmNotificationPreview = value) } },
        )

    fun togglePmTimestamps() =
        togglePrivacySetting(
            key = "pmShowTimestamps",
            currentValue = _uiState.value.pmShowTimestamps,
            applyOptimistic = { value -> _uiState.update { it.copy(pmShowTimestamps = value) } },
        )

    fun togglePmDateSeparators() =
        togglePrivacySetting(
            key = "pmShowDateSeparators",
            currentValue = _uiState.value.pmShowDateSeparators,
            applyOptimistic = { value -> _uiState.update { it.copy(pmShowDateSeparators = value) } },
        )

    fun toggleDnd() =
        togglePrivacySetting(
            key = "dndEnabled",
            currentValue = _uiState.value.dndEnabled,
            applyOptimistic = { value -> _uiState.update { it.copy(dndEnabled = value) } },
        )

    fun setDndStartHour(hour: Int) =
        updateNumericSetting("dndStartHour", hour) {
            _uiState.update { it.copy(dndStartHour = hour) }
        }

    fun setDndStartMinute(minute: Int) =
        updateNumericSetting("dndStartMinute", minute) {
            _uiState.update { it.copy(dndStartMinute = minute) }
        }

    fun setDndEndHour(hour: Int) =
        updateNumericSetting("dndEndHour", hour) {
            _uiState.update { it.copy(dndEndHour = hour) }
        }

    fun setDndEndMinute(minute: Int) =
        updateNumericSetting("dndEndMinute", minute) {
            _uiState.update { it.copy(dndEndMinute = minute) }
        }

    private fun updateNumericSetting(
        key: String,
        value: Int,
        applyOptimistic: () -> Unit,
    ) {
        applyOptimistic()
        viewModelScope.launch {
            userRepository.updateProfile(currentUserId, mapOf(key to value))
        }
    }

    fun toggleSelfDestructAlert() =
        togglePrivacySetting(
            key = "selfDestructAlertEnabled",
            currentValue = _uiState.value.selfDestructAlertEnabled,
            applyOptimistic = { value -> _uiState.update { it.copy(selfDestructAlertEnabled = value) } },
        )

    fun setMinGiftAnimationValue(value: Int) {
        _uiState.update { it.copy(minGiftAnimationValue = value) }
        viewModelScope.launch {
            userRepository.updateProfile(currentUserId, mapOf("minGiftAnimationValue" to value))
        }
    }

    fun setLanguage(languageCode: String) {
        _uiState.update { it.copy(language = languageCode) }
        LanguagePreference.set(languageCode)
        viewModelScope.launch {
            userRepository.updateProfile(currentUserId, mapOf("language" to languageCode))
        }
    }

    fun requestClearCache() {
        _uiState.update { it.copy(showClearCacheDialog = true) }
    }

    fun dismissClearCacheDialog() {
        _uiState.update { it.copy(showClearCacheDialog = false) }
    }

    fun clearCache() {
        appConfigService.clearAppCache()
        _uiState.update { it.copy(cacheCleared = true, showClearCacheDialog = false) }
        loadCacheSize()
    }

    fun resetCacheCleared() {
        _uiState.update { it.copy(cacheCleared = false) }
    }

    fun checkForUpdates() {
        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingUpdate = true, updateCheckResult = null) }
            when (val result = appConfigService.getLatestVersionInfo()) {
                is Resource.Success -> {
                    val (_, latestVersionCode, latestVersionName) = result.data
                    val checkResult =
                        if (appConfigService.currentVersionCode >= latestVersionCode) {
                            UpdateCheckResult.UpToDate
                        } else {
                            UpdateCheckResult.UpdateAvailable(latestVersionName)
                        }
                    _uiState.update { it.copy(isCheckingUpdate = false, updateCheckResult = checkResult) }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isCheckingUpdate = false,
                            updateCheckResult = UpdateCheckResult.Error(UiText.res(Res.string.error_check_updates)),
                        )
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun dismissUpdateResult() {
        _uiState.update { it.copy(updateCheckResult = null) }
    }

    fun unlinkProvider(
        type: ProviderType,
        identifier: String,
    ) {
        val user = _uiState.value.user ?: return
        val activeCount = user.activeProviders.size
        if (activeCount < 2) {
            _uiState.update { it.copy(error = UiText.res(Res.string.cannot_unlink_last_provider)) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isUnlinkingProvider = true) }
            when (identityRepository.unlinkProvider(user.uniqueId, type.key, identifier)) {
                is Resource.Success -> {
                    logI(TAG, "Unlinked ${type.key}:$identifier")
                    val updatedProviders =
                        user.providers.map { p ->
                            if (p.type == type && p.identifier == identifier) {
                                p.copy(active = false)
                            } else {
                                p
                            }
                        }
                    _uiState.update {
                        it.copy(
                            isUnlinkingProvider = false,
                            user = user.copy(providers = updatedProviders),
                        )
                    }
                }
                is Resource.Error -> {
                    logE(TAG, "Failed to unlink ${type.key}:$identifier")
                    _uiState.update {
                        it.copy(isUnlinkingProvider = false, error = UiText.res(Res.string.error_update_privacy))
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun linkProvider(
        type: ProviderType,
        identifier: String,
    ) {
        val user = _uiState.value.user ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isUnlinkingProvider = true) }
            when (identityRepository.linkProvider(user.uniqueId, type.key, identifier)) {
                is Resource.Success -> {
                    logI(TAG, "Linked ${type.key}:$identifier")
                    val newProvider =
                        LinkedProvider(
                            type = type,
                            identifier = identifier,
                            active = true,
                            linkedAt = currentTimeMillis(),
                        )
                    val updatedProviders = user.providers + newProvider
                    _uiState.update {
                        it.copy(
                            isUnlinkingProvider = false,
                            user = user.copy(providers = updatedProviders),
                        )
                    }
                }
                is Resource.Error -> {
                    logE(TAG, "Failed to link ${type.key}:$identifier")
                    _uiState.update {
                        it.copy(isUnlinkingProvider = false, error = UiText.plain("Failed to link account"))
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun requestAccountDeletion(pin: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isDeletionRequesting = true, deletionError = null) }
            when (val result = userRepository.requestAccountDeletion(currentUserId, pin)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isDeletionRequesting = false,
                            deletionScheduled = true,
                            deletionDeleteAt = result.data,
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isDeletionRequesting = false,
                            deletionError = UiText.Plain(result.message),
                        )
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun cancelAccountDeletion() {
        viewModelScope.launch {
            when (val result = userRepository.cancelAccountDeletion(currentUserId)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            deletionScheduled = false,
                            deletionDeleteAt = null,
                            deletionError = null,
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(deletionError = UiText.Plain(result.message))
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
