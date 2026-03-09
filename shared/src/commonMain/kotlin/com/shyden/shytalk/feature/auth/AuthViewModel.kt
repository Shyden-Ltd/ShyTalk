package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: UiText? = null,
    val isAuthenticated: Boolean = false,
    val hasProfile: Boolean = false,
    val hasDOB: Boolean = false,
    val needsLegalAcceptance: Boolean = false,
    val isDeviceLocked: Boolean = false,
    val isBackendUnreachable: Boolean = false,
    val isSuspended: Boolean = false,
    val suspensionReason: String? = null,
    val suspensionEndDate: Long? = null,
    val suspensionCanAppeal: Boolean = false,
    val suspensionAppealStatus: String? = null,
    val isDeviceBanned: Boolean = false,
    val isNetworkBanned: Boolean = false,
    val banReason: String? = null,
    val banExpiresAt: String? = null
)

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val deviceRepository: DeviceRepository,
    private val deviceId: String
) : ViewModel() {

    companion object {
        private const val TAG = "AuthViewModel"
    }

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkAuthState()
    }

    private fun checkAuthState() {
        logI(TAG, "Auth state check started")
        if (!authRepository.isAuthenticated) {
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val userId = authRepository.currentUserId
            if (userId == null) {
                _uiState.update { it.copy(isLoading = false) }
                return@launch
            }

            when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
                is Resource.Success -> {
                    val boundUserId = binding.data
                    if (boundUserId != null && boundUserId != userId) {
                        authRepository.signOut()
                        _uiState.update { it.copy(isLoading = false, isDeviceLocked = true) }
                        return@launch
                    }
                    if (boundUserId == null) {
                        deviceRepository.bindDevice(deviceId, userId)
                    }
                }
                is Resource.Error -> {
                    // Lenient: let user through on network failure
                }
                is Resource.Loading -> {}
            }

            checkAndApplyBan()
            resolveProfileState(userId)
        }
    }

    fun signInWithGoogle(idToken: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithGoogleIdToken(idToken)) {
                is Resource.Success -> handleSignInSuccess(result.data)
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message?.let { msg -> UiText.plain(msg) }) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun signInWithApple(idToken: String, rawNonce: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithAppleIdToken(idToken, rawNonce)) {
                is Resource.Success -> handleSignInSuccess(result.data)
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message?.let { msg -> UiText.plain(msg) }) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    private suspend fun handleSignInSuccess(userId: String) {
        logI(TAG, "Sign-in success: userId=$userId")
        when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
            is Resource.Success -> {
                val boundUserId = binding.data
                if (boundUserId != null && boundUserId != userId) {
                    logW(TAG, "Device locked for userId=$userId")
                    authRepository.signOut()
                    _uiState.update { it.copy(isLoading = false, isDeviceLocked = true) }
                    return
                }
                if (boundUserId == null) {
                    deviceRepository.bindDevice(deviceId, userId)
                }
            }
            is Resource.Error -> {
                // Lenient: let user through on network failure
            }
            is Resource.Loading -> {}
        }

        checkAndApplyBan()
        resolveProfileState(userId)
    }

    /**
     * Checks device/network ban status via the API.
     * Stores ban info in state but does NOT block the auth flow,
     * so suspension status can also be resolved. The UI decides
     * which screen to show based on the combined state.
     */
    private suspend fun checkAndApplyBan() {
        when (val result = deviceRepository.checkBanStatus(deviceId)) {
            is Resource.Success -> {
                val ban = result.data
                if (ban.isBanned) {
                    logE(TAG, "Ban detected: type=${ban.banType}")
                    val isDevice = ban.banType == "device"
                    _uiState.update {
                        it.copy(
                            isDeviceBanned = isDevice,
                            isNetworkBanned = !isDevice,
                            banReason = ban.reason,
                            banExpiresAt = ban.expiresAt
                        )
                    }
                }
            }
            is Resource.Error -> {
                // Lenient: let user through on ban check failure
            }
            is Resource.Loading -> {}
        }
    }

    private suspend fun resolveProfileState(userId: String) {
        when (val result = userRepository.userExists(userId)) {
            is Resource.Success -> {
                val hasProfile = result.data
                if (hasProfile) {
                    when (val userResult = userRepository.getUser(userId)) {
                        is Resource.Success -> {
                            val user = userResult.data
                            if (user.isActivelySuspended) {
                                logI(TAG, "Suspension detected: reason=${user.suspensionReason}")
                                _uiState.update {
                                    it.copy(
                                        isLoading = false,
                                        isSuspended = true,
                                        suspensionReason = user.suspensionReason,
                                        suspensionEndDate = user.suspensionEndDate,
                                        suspensionCanAppeal = user.suspensionCanAppeal,
                                        suspensionAppealStatus = user.suspensionAppealStatus
                                    )
                                }
                                return
                            }
                            // Suspension expired — clear the flag in Firestore
                            if (user.isSuspended) {
                                userRepository.liftExpiredSuspension(userId)
                            }
                            var needsLegal = user.acceptedLegalVersion < CURRENT_LEGAL_VERSION
                            // If user already accepted locally (pre-sign-in screen),
                            // sync to Firestore and skip showing the legal screen again
                            if (needsLegal && LanguagePreference.getAcceptedLegalVersion() >= CURRENT_LEGAL_VERSION) {
                                userRepository.updateProfile(
                                    userId,
                                    mapOf("acceptedLegalVersion" to CURRENT_LEGAL_VERSION)
                                )
                                needsLegal = false
                            }
                            if (!needsLegal) {
                                LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                            }
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    isAuthenticated = true,
                                    hasProfile = true,
                                    hasDOB = user.dateOfBirth != null,
                                    needsLegalAcceptance = needsLegal
                                )
                            }
                        }
                        else -> {
                            _uiState.update {
                                it.copy(isLoading = false, isBackendUnreachable = true)
                            }
                        }
                    }
                } else {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isAuthenticated = true,
                            hasProfile = false,
                            hasDOB = false
                        )
                    }
                }
            }
            is Resource.Error -> {
                _uiState.update {
                    it.copy(isLoading = false, isBackendUnreachable = true)
                }
            }
            is Resource.Loading -> {}
        }
    }

    fun retryConnection() {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, isBackendUnreachable = false) }
            resolveProfileState(userId)
        }
    }

    fun submitAppeal(appealText: String) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            when (userRepository.submitSuspensionAppeal(userId, appealText)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoading = false, suspensionCanAppeal = false, suspensionAppealStatus = "pending") }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.res(Res.string.error_submit_appeal)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearDeviceLocked() {
        _uiState.update { it.copy(isDeviceLocked = false) }
    }

    fun signOut() {
        logI(TAG, "User signed out")
        authRepository.signOut()
        _uiState.value = AuthUiState()
    }
}
