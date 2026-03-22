package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.DisposableEmailDomains
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.SignInResult
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
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
    val banExpiresAt: String? = null,
    val awaitingEmailLink: Boolean = false,
    val emailForLink: String? = null,
    val needsPinSetup: Boolean = false,
    val hasStoredCredential: Boolean = false,
    val needsLockScreen: Boolean = false,
)

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val deviceRepository: DeviceRepository,
    private val identityRepository: IdentityRepository,
    private val deviceId: String,
    private val bypassDeviceChecks: Boolean = false,
    private val appLockRepository: AppLockRepository? = null,
    private val biometricRepository: BiometricRepository? = null,
) : ViewModel() {
    companion object {
        private const val TAG = "AuthViewModel"
    }

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    /** Cached uniqueId from last successful identity resolution. */
    private var resolvedUniqueId: String? = null

    init {
        val lockRepo = appLockRepository
        if (lockRepo != null && lockRepo.hasCredential) {
            // Returning user with stored credential
            if (lockRepo.isAppLockEnabled && lockRepo.isLockRequired()) {
                logI(TAG, "Lock screen required (timeout expired)")
                _uiState.update { it.copy(hasStoredCredential = true, needsLockScreen = true) }
            } else {
                // Silent restore — Firebase SDK persists session across app restarts
                logI(TAG, "Restoring session silently (credential exists, lock not required)")
                val uniqueId = lockRepo.storedUniqueId
                if (uniqueId != null && authRepository.isAuthenticated) {
                    resolvedUniqueId = uniqueId
                    authRepository.resolvedUniqueId = uniqueId
                    _uiState.update {
                        it.copy(hasStoredCredential = true, isAuthenticated = true, hasProfile = true, hasDOB = true)
                    }
                } else {
                    // Credential exists but Firebase session expired — need lock screen
                    logI(TAG, "Firebase session expired — showing lock screen")
                    _uiState.update { it.copy(hasStoredCredential = true, needsLockScreen = true) }
                }
            }
        } else if (lockRepo != null && !lockRepo.hasCredential && authRepository.isAuthenticated) {
            // First launch after update: user has Firebase session but no PIN
            // Route through identity resolution → PIN setup (migration path)
            logI(TAG, "Migration: authenticated user without PIN — will route to PIN setup")
            viewModelScope.launch {
                val providerInfo = authRepository.getProviderInfo()
                if (providerInfo != null) {
                    resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
                }
            }
        }
        // else: no credential AND no Firebase session → sign-in screen (default state)
    }

    fun signInWithGoogle(idToken: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithGoogleIdToken(idToken)) {
                is Resource.Success -> {
                    val email = authRepository.currentUserEmail
                    if (email == null) {
                        _uiState.update {
                            it.copy(isLoading = false, error = UiText.plain("Could not retrieve email from sign-in"))
                        }
                        return@launch
                    }
                    resolveIdentityAndProceed("google", email)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun signInWithApple(
        idToken: String,
        rawNonce: String,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithAppleIdToken(idToken, rawNonce)) {
                is Resource.Success -> {
                    val providerInfo = authRepository.getProviderInfo()
                    if (providerInfo == null) {
                        _uiState.update {
                            it.copy(isLoading = false, error = UiText.plain("Could not retrieve provider info from sign-in"))
                        }
                        return@launch
                    }
                    resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun signInWithAppleViaProvider(activity: Any) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithAppleViaProvider(activity)) {
                is Resource.Success -> {
                    val providerInfo = authRepository.getProviderInfo()
                    if (providerInfo == null) {
                        _uiState.update {
                            it.copy(isLoading = false, error = UiText.plain("Could not retrieve provider info"))
                        }
                        return@launch
                    }
                    resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    /**
     * Core identity resolution flow. Resolves the provider+identifier against
     * the Express API identity map, handles device binding, ban checks, and
     * profile resolution.
     */
    private suspend fun resolveIdentityAndProceed(
        provider: String,
        identifier: String,
    ) {
        when (val result = identityRepository.resolveIdentity(provider, identifier)) {
            is Resource.Success -> {
                when (val signInResult = result.data) {
                    is SignInResult.Found -> {
                        val uniqueIdStr = signInResult.uniqueId.toString()
                        resolvedUniqueId = uniqueIdStr
                        authRepository.resolvedUniqueId = uniqueIdStr
                        logI(TAG, "Identity resolved: uniqueId=${signInResult.uniqueId}")

                        // Force token refresh to pick up custom claims
                        identityRepository.forceRefreshToken()

                        if (!bypassDeviceChecks) {
                            when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
                                is Resource.Success -> {
                                    val boundUserId = binding.data
                                    if (boundUserId != null && boundUserId != uniqueIdStr) {
                                        logW(TAG, "Device locked for uniqueId=${signInResult.uniqueId}")
                                        authRepository.signOut()
                                        _uiState.update { it.copy(isLoading = false, isBackendUnreachable = false, isDeviceLocked = true) }
                                        return
                                    }
                                    if (boundUserId == null) {
                                        deviceRepository.bindDevice(deviceId, uniqueIdStr)
                                    }
                                }
                                is Resource.Error -> { /* lenient */ }
                                is Resource.Loading -> {}
                            }
                            checkAndApplyBan()
                        } else {
                            logI(TAG, "Device checks bypassed (debug build)")
                        }
                        resolveProfileState(uniqueIdStr)
                    }

                    is SignInResult.NotFound -> {
                        logI(TAG, "Identity not found — new user")
                        if (!bypassDeviceChecks) {
                            when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
                                is Resource.Success -> {
                                    val boundUserId = binding.data
                                    if (boundUserId != null) {
                                        logW(TAG, "Device bound — blocking new account creation")
                                        authRepository.signOut()
                                        _uiState.update { it.copy(isLoading = false, isBackendUnreachable = false, isDeviceLocked = true) }
                                        return
                                    }
                                }
                                is Resource.Error -> { /* lenient */ }
                                is Resource.Loading -> {}
                            }
                            checkAndApplyBan()
                        }
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isBackendUnreachable = false,
                                isAuthenticated = true,
                                hasProfile = false,
                                hasDOB = false,
                            )
                        }
                    }

                    is SignInResult.Deactivated -> {
                        logW(TAG, "Deactivated identity: $provider:***")
                        authRepository.signOut()
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isAuthenticated = false,
                                error =
                                    UiText.plain(
                                        "This sign-in method has been deactivated. Please use a different linked account or contact support.",
                                    ),
                            )
                        }
                    }
                }
            }
            is Resource.Error -> {
                logE(TAG, "Identity resolution failed: ${result.message}")
                _uiState.update { it.copy(isLoading = false, isBackendUnreachable = true) }
            }
            is Resource.Loading -> {}
        }
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
                            banExpiresAt = ban.expiresAt,
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
                                        isBackendUnreachable = false,
                                        isSuspended = true,
                                        suspensionReason = user.suspensionReason,
                                        suspensionEndDate = user.suspensionEndDate,
                                        suspensionCanAppeal = user.suspensionCanAppeal,
                                        suspensionAppealStatus = user.suspensionAppealStatus,
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
                                    mapOf(
                                        "acceptedLegalVersion" to CURRENT_LEGAL_VERSION,
                                        "legalAcceptedAt" to currentTimeMillis(),
                                    ),
                                )
                                needsLegal = false
                            }
                            if (!needsLegal) {
                                LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                            }
                            // Check if user needs PIN setup (migration or new device)
                            val needsPin = appLockRepository?.hasCredential == false
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    isBackendUnreachable = false,
                                    isAuthenticated = true,
                                    hasProfile = true,
                                    hasDOB = user.dateOfBirth != null,
                                    needsLegalAcceptance = needsLegal,
                                    needsPinSetup = needsPin,
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
                            isBackendUnreachable = false,
                            isAuthenticated = true,
                            hasProfile = false,
                            hasDOB = false,
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

    fun signInWithEmail(email: String) {
        if (DisposableEmailDomains.isDisposable(email)) {
            logW(TAG, "Blocked disposable email domain: ${email.substringAfter("@")}")
            _uiState.update { it.copy(error = UiText.res(Res.string.error_disposable_email)) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.sendSignInLink(email)) {
                is Resource.Success -> {
                    logI(TAG, "Sign-in link sent to ***@${email.substringAfter("@")}")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            awaitingEmailLink = true,
                            emailForLink = email,
                        )
                    }
                }
                is Resource.Error -> {
                    logE(TAG, "Failed to send sign-in link: ${result.message}")
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun handleEmailLink(
        email: String,
        link: String,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null, awaitingEmailLink = false) }
            when (val result = authRepository.signInWithEmailLink(email, link)) {
                is Resource.Success -> {
                    val providerInfo = authRepository.getProviderInfo()
                    if (providerInfo == null) {
                        _uiState.update {
                            it.copy(isLoading = false, error = UiText.plain("Could not retrieve provider info from sign-in"))
                        }
                        return@launch
                    }
                    resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun retryConnection() {
        if (!authRepository.isAuthenticated) {
            // Session expired — let the user sign in again from scratch
            _uiState.update { it.copy(isBackendUnreachable = false, isLoading = false) }
            return
        }
        viewModelScope.launch {
            // Keep isBackendUnreachable = true so the retry spinner shows on that screen
            _uiState.update { it.copy(isLoading = true) }
            val providerInfo = authRepository.getProviderInfo()
            if (providerInfo != null) {
                resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
            } else {
                _uiState.update { it.copy(isLoading = false, isBackendUnreachable = true) }
            }
        }
    }

    fun submitAppeal(appealText: String) {
        val userId = resolvedUniqueId ?: authRepository.currentUserId ?: return
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

    fun clearAwaitingEmailLink() {
        _uiState.update { it.copy(awaitingEmailLink = false, emailForLink = null) }
    }

    fun signInWithCustomToken(customToken: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = authRepository.signInWithCustomToken(customToken)) {
                is Resource.Success -> {
                    val providerInfo = authRepository.getProviderInfo()
                    if (providerInfo != null) {
                        resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
                    } else {
                        // Email OTP user — use "email" provider with email address
                        val email = authRepository.currentUserEmail
                        if (email != null) {
                            resolveIdentityAndProceed("email", email)
                        } else {
                            _uiState.update { it.copy(isLoading = false, error = UiText.plain("Could not resolve identity")) }
                        }
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun signOut() {
        logI(TAG, "User signed out")
        viewModelScope.launch {
            // Revoke biometric key BEFORE clearing Firebase session (needs auth token)
            try {
                biometricRepository?.revoke(deviceId)
            } catch (e: Exception) {
                logW(TAG, "Failed to revoke biometric key: ${e.message}")
            }
            // Clear local credentials and Firebase session after revoke completes
            appLockRepository?.clearCredential()
            resolvedUniqueId = null
            authRepository.signOut()
            _uiState.value = AuthUiState()
        }
    }
}
