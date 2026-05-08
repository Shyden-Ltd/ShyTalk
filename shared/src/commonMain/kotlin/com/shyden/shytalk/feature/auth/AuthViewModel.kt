package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.push.consumeChatDeepLink
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
import kotlinx.coroutines.CancellationException
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
    /**
     * Set true when the user has `ageVerified = true` BUT
     * `dateOfBirth = null`. This is an inconsistent server-side state
     * — verification flow always records DOB. Block the user from
     * proceeding into the app and surface the static error code
     * `AGE_VERIF_NO_DOB_E001` so support can identify the exact
     * cause from the user's screenshot. Resolution requires admin
     * intervention (set DOB via the admin panel + re-trigger
     * verification flow if needed).
     */
    val isBlockedByVerifiedNoDob: Boolean = false,
    val blockedErrorCode: String? = null,
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
    /**
     * Set when local auth storage (Keychain / EncryptedSharedPreferences / Firebase
     * SDK persistence) is in a half-cleared state because `signOut()` or
     * `clearCredential()` threw. The bare sign-in UI cannot recover from this —
     * retrying sign-in just hits the same broken storage. UI must show a
     * non-dismissable error explaining that the user needs to force-quit AND
     * clear app data, and must disable all auth-action buttons while this is set.
     * NOT cleared by `clearError()`; survives `_uiState.value = AuthUiState()`
     * resets only by virtue of every reset point preserving it explicitly.
     */
    val requiresAppDataClear: Boolean = false,
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

        /**
         * Word-boundary match for HTTP status 401 inside otherwise-free-form error text.
         * `\b` rejects digit-runs embedded in IPv6 prefixes ("[2401:db00::34]"), epoch ms
         * timestamps ("76401"), or port numbers — those would falsely trigger the
         * destructive PIN-clearing path in `handleBackendError`.
         */
        private val AUTH_401_REGEX = Regex("\\b401\\b")

        /**
         * Process-level guard preventing the init() migration path from running more than once
         * per app process. Without this, on iOS new AuthViewModel instances (created when
         * Compose recomposes the screen tree) re-trigger the migration path, hammering the
         * Firebase Auth emulator until rate-limited.
         */
        @kotlin.concurrent.Volatile
        private var migrationCompleted: Boolean = false

        /**
         * Test-only hook to reset the process-level migration guard between test runs.
         * Production callers must not invoke this — call sites are gated by `signOut()`
         * resetting the flag at the natural lifecycle boundary.
         */
        internal fun resetMigrationGuardForTests() {
            migrationCompleted = false
        }
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
        } else if (
            lockRepo != null &&
            !lockRepo.hasCredential &&
            authRepository.isAuthenticated &&
            !migrationCompleted
        ) {
            // First launch after update: user has Firebase session but no PIN
            // Route through identity resolution → PIN setup (migration path)
            // Guarded by `migrationCompleted` so we don't loop when a new AuthViewModel
            // instance is created (e.g. iOS Compose recomposition).
            migrationCompleted = true
            logI(TAG, "Migration: authenticated user without PIN — will route to PIN setup")
            viewModelScope.launch {
                val providerInfo = authRepository.getProviderInfo()
                if (providerInfo != null) {
                    resolveIdentityAndProceed(providerInfo.first, providerInfo.second)
                } else {
                    // No recognised provider on the Firebase session (legacy account, anonymous,
                    // custom-token, or provider profile lacking email/uid). Without a provider
                    // we can't run identity resolution, so the safe path is to clear the orphaned
                    // session and let the user re-authenticate.
                    logW(TAG, "Migration aborted: no recognised provider info — clearing session")
                    var signedOut = true
                    try {
                        authRepository.signOut()
                    } catch (e: Exception) {
                        signedOut = false
                        logE(TAG, "signOut during migration abort failed: ${e.message}")
                    }
                    if (signedOut) {
                        // Reset the migration guard so a fresh sign-in re-enters this path
                        // cleanly. Only do this when signOut actually succeeded — otherwise
                        // the next ViewModel construction would re-enter migration with the
                        // same orphaned session and loop on signOut failures.
                        migrationCompleted = false
                    } else {
                        // Mirror the SF3 hard-error pattern from handleBackendError: surface
                        // the broken state via the sticky `requiresAppDataClear` flag so the
                        // UI keeps auth actions disabled. The migration guard intentionally
                        // stays `true` here — re-entering migration without successful
                        // signOut just retries the same orphaned session and loops.
                        _uiState.value =
                            AuthUiState(
                                error = UiText.plain("Could not clear stored session — please clear app data and restart"),
                                requiresAppDataClear = true,
                            )
                    }
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

                is Resource.Loading -> Unit
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

                is Resource.Loading -> Unit
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
                    // Apple's WebView OAuth on Android surfaces user
                    // cancellation as `FirebaseAuthWebException`, which
                    // `AuthRepositoryImpl` now wraps as a typed
                    // `AppleSignInCancelledException` on the
                    // `Resource.Error.exception` slot — same shape iOS has
                    // used since launch. Branch on the type so cancel is
                    // silent without depending on an English-literal
                    // `result.message` string match in SignInScreen.
                    if (result.exception is AppleSignInCancelledException) {
                        _uiState.update { it.copy(isLoading = false) }
                    } else {
                        _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
                    }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    /**
     * Core identity resolution flow. Resolves the provider+identifier against
     * the Express API identity map, handles device binding, ban checks, and
     * profile resolution.
     */
    @Suppress("kotlin:S3776")
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

                                is Resource.Loading -> Unit
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

                                is Resource.Loading -> Unit
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
                handleBackendError(result.message)
            }

            is Resource.Loading -> Unit
        }
    }

    /**
     * Routes auth-related errors to a fresh sign-in screen, network-related errors to
     * "Unable to Connect". A stale refresh token previously fell through to the
     * "Unable to Connect" path, leaving the user stuck retrying instead of re-authenticating.
     *
     * Each substring covers a specific producer:
     * - "Not authenticated"      → IosApiClient when Firebase has no current user.
     * - "Token refresh"          → IosApiClient when getIdToken(forceRefresh=true) fails.
     * - "INVALID_REFRESH_TOKEN"  → Firebase Auth REST when the refresh token is revoked.
     * - "UNAUTHENTICATED"        → gRPC error code surfaced by Firestore SDK.
     * - "\b401\b"                → raw HTTP status 401 in proxy / CDN error bodies. Word
     *                              boundaries prevent benign matches inside IPv6 prefixes
     *                              (e.g., "[2401:db00::34]"), epoch ms timestamps, or port
     *                              numbers — false positives there would destructively
     *                              clear the user's PIN.
     *
     * If a new auth-error shape surfaces, prefer migrating producers to a typed error code
     * over extending this list — substring matching on free-form text is fragile.
     */
    private suspend fun handleBackendError(errorMessage: String?) {
        val message = errorMessage.orEmpty()
        val isAuthError =
            message.contains("Not authenticated", ignoreCase = true) ||
                message.contains("Token refresh", ignoreCase = true) ||
                message.contains("INVALID_REFRESH_TOKEN", ignoreCase = true) ||
                message.contains("UNAUTHENTICATED", ignoreCase = true) ||
                AUTH_401_REGEX.containsMatchIn(message)
        if (isAuthError) {
            logW(TAG, "Auth error — clearing session and routing to sign-in: $message")
            var credentialCleared = true
            var signedOut = true
            try {
                appLockRepository?.clearCredential()
            } catch (e: Exception) {
                credentialCleared = false
                logE(TAG, "Failed to clear credential during auth-error recovery: ${e.message}")
            }
            try {
                authRepository.signOut()
            } catch (e: Exception) {
                signedOut = false
                logE(TAG, "Sign-out during auth-error recovery failed: ${e.message}")
            }
            resolvedUniqueId = null
            // signOut() resets the migration guard at its natural lifecycle boundary; if it
            // threw, do it manually so a subsequent successful sign-in can re-enter migration.
            if (!signedOut) migrationCompleted = false
            if (!credentialCleared || !signedOut) {
                // Fresh sign-in UI on top of half-cleared local state would mislead the user
                // — retrying any provider just hits the same broken storage and loops. The
                // `requiresAppDataClear` flag is sticky (not cleared by `clearError()`) so
                // the UI can keep auth actions disabled until the user actually clears app
                // data and restarts.
                _uiState.value =
                    AuthUiState(
                        error = UiText.plain("Could not clear stored session — please clear app data and restart"),
                        requiresAppDataClear = true,
                    )
            } else {
                _uiState.value = AuthUiState()
            }
        } else {
            _uiState.update { it.copy(isLoading = false, isBackendUnreachable = true) }
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

            is Resource.Loading -> Unit
        }
    }

    @Suppress("kotlin:S3776")
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
                            // Age-in auto-unlock check (PR 11). Once per
                            // user per UTC day: the server-side endpoint
                            // at `POST /api/users/:uniqueId/pm-lock-check`
                            // reads the user doc, computes whether to
                            // lift the lock, and writes if yes. Client
                            // cannot write `pmLocked` (Firestore rules
                            // deny it), so the auto-unlock has to go
                            // through Express. Failure is non-fatal —
                            // the next login or a counterparty's send
                            // will surface the current state — but we
                            // still log so a permanently-broken endpoint
                            // is visible in Sentry rather than vanishing
                            // into a silent fire-and-forget.
                            when (val r = userRepository.checkPmLockOnLogin(userId)) {
                                is Resource.Error -> logW(TAG, "PM-lock check failed (non-fatal): ${r.message}")
                                else -> Unit
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
                            // Inconsistent state guard (PR 5b 2026-05-04): a user
                            // with `ageVerified = true` AND `dateOfBirth = null`
                            // is in a state the verification flow cannot have
                            // produced — verification always records the DOB.
                            // This typically means manual Firestore tampering or
                            // a partial migration. Block sign-in and surface a
                            // static error code so support can fix the data.
                            val verifiedButNoDob = user.ageVerified && user.dateOfBirth == null
                            if (verifiedButNoDob) {
                                _uiState.update {
                                    it.copy(
                                        isLoading = false,
                                        isBackendUnreachable = false,
                                        isAuthenticated = false,
                                        isBlockedByVerifiedNoDob = true,
                                        blockedErrorCode = "AGE_VERIF_NO_DOB_E001",
                                    )
                                }
                                return
                            }
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

                        is Resource.Error -> {
                            handleBackendError(userResult.message)
                        }

                        is Resource.Loading -> Unit
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
                handleBackendError(result.message)
            }

            is Resource.Loading -> Unit
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

                is Resource.Loading -> Unit
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

                is Resource.Loading -> Unit
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

                is Resource.Loading -> Unit
            }
        }
    }

    fun clearError() {
        // Preserve the error message when the sticky storage-corrupted flag is set so
        // the persistent recovery banner can render it after the snackbar dismisses.
        // Otherwise the user would see disabled auth buttons with no on-screen reason.
        _uiState.update { if (it.requiresAppDataClear) it else it.copy(error = null) }
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

                is Resource.Loading -> Unit
            }
        }
    }

    /** Called after external sign-in (e.g. dev email/password on local builds). */
    fun resolveAfterExternalSignIn(
        provider: String,
        email: String,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            resolveIdentityAndProceed(provider, email)
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
            // Catch platform sign-out failure so the cleanup below (deep-link
            // clear + UI reset) still runs — leaving the chat deep link or an
            // authenticated UI behind on shared devices is the worse outcome.
            // CancellationException must propagate so structured concurrency
            // remains intact (e.g. config-change cancelling the launch).
            try {
                authRepository.signOut()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logE(TAG, "authRepository.signOut() failed: ${e.message}", e)
            }
            // Allow migration path to run again on next sign-in
            migrationCompleted = false
            // Clear any pending push deep link so a notification tapped just
            // before sign-out doesn't fire under the next user's session.
            // The bus is process-global; without this clear, a stale link
            // could leak metadata (target display name / photo) across
            // accounts on shared devices.
            com.shyden.shytalk.core.push
                .consumeChatDeepLink()
            _uiState.value = AuthUiState()
        }
    }
}
