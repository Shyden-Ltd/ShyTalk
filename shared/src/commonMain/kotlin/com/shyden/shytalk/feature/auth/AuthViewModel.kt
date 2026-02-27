package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
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
    val error: String? = null,
    val isAuthenticated: Boolean = false,
    val hasProfile: Boolean = false,
    val hasDOB: Boolean = false,
    val needsLegalAcceptance: Boolean = false,
    val isDeviceLocked: Boolean = false,
    val isSuspended: Boolean = false,
    val suspensionReason: String? = null,
    val suspensionEndDate: Long? = null,
    val suspensionCanAppeal: Boolean = false,
    val suspensionAppealStatus: String? = null
)

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val deviceRepository: DeviceRepository,
    private val deviceId: String
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkAuthState()
    }

    private fun checkAuthState() {
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

            resolveProfileState(userId)
        }
    }

    fun signInWithGoogle(idToken: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithGoogleIdToken(idToken)) {
                is Resource.Success -> handleSignInSuccess(result.data)
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
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
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    private suspend fun handleSignInSuccess(userId: String) {
        when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
            is Resource.Success -> {
                val boundUserId = binding.data
                if (boundUserId != null && boundUserId != userId) {
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

        resolveProfileState(userId)
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
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    isAuthenticated = true,
                                    hasProfile = true,
                                    hasDOB = user.dateOfBirth != null,
                                    needsLegalAcceptance = user.acceptedLegalVersion < CURRENT_LEGAL_VERSION
                                )
                            }
                        }
                        else -> {
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    isAuthenticated = true,
                                    hasProfile = true,
                                    hasDOB = false
                                )
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
                    it.copy(isLoading = false, isAuthenticated = true, hasProfile = false)
                }
            }
            is Resource.Loading -> {}
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
                    _uiState.update { it.copy(isLoading = false, error = "Failed to submit appeal") }
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
        authRepository.signOut()
        _uiState.value = AuthUiState()
    }
}
