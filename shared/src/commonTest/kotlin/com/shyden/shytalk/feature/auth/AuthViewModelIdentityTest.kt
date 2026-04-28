package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BanStatus
import com.shyden.shytalk.data.repository.CreateUserResult
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.SignInResult
import com.shyden.shytalk.data.repository.UserFlags
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelIdentityTest {
    private val testDispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        // Reset the process-level migration guard so each test starts from a known
        // state. Without this, the first test that exercises the migration path
        // sets the static flag and every subsequent test silently skips migration.
        AuthViewModel.resetMigrationGuardForTests()
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
        AuthViewModel.resetMigrationGuardForTests()
    }

    // ─── Fakes ───────────────────────────────────────────────────────

    private class FakeAuthRepository(
        private var firebaseUid: String? = null,
        override val isAuthenticated: Boolean = false,
        override val currentUserEmail: String? = null,
        private val providerInfo: Pair<String, String>? = null,
    ) : AuthRepository {
        override var resolvedUniqueId: String? = null
        override val currentUserId: String? get() = resolvedUniqueId ?: firebaseUid
        override val currentFirebaseUid: String? get() = firebaseUid
        var signInResult: Resource<String> = Resource.Success("firebase-uid-1")
        var signedOut = false

        override fun getProviderInfo(): Pair<String, String>? = providerInfo

        override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> = signInResult

        override suspend fun signInWithAppleIdToken(
            idToken: String,
            rawNonce: String,
        ): Resource<String> = signInResult

        override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> = signInResult

        override suspend fun sendSignInLink(email: String): Resource<Unit> = Resource.Success(Unit)

        override suspend fun signInWithEmailLink(
            email: String,
            link: String,
        ): Resource<String> = signInResult

        override suspend fun signInWithCustomToken(token: String): Resource<String> = signInResult

        var signOutShouldThrow = false

        override fun signOut() {
            if (signOutShouldThrow) throw RuntimeException("signOut deliberately failing in test")
            signedOut = true
            resolvedUniqueId = null
            firebaseUid = null
        }
    }

    /**
     * In-memory fake of `AppLockRepository`. Only the credential-storage hooks
     * relevant to `handleBackendError` and the migration recovery path are
     * implemented; everything else throws so a test that touches an unintended
     * surface fails loudly.
     */
    private class FakeAppLockRepository(
        override val hasCredential: Boolean = false,
    ) : AppLockRepository {
        var clearCredentialCalled = false
        var clearCredentialShouldThrow = false

        override val isAppLockEnabled: Boolean = false
        override val isBiometricEnabled: Boolean = false
        override val lockTimeoutMinutes: Int = 0
        override val storedUniqueId: String? = null
        override val storedDeviceId: String? = null
        override val localPinHash: String? = null
        override val credentialVersion: Int = 0

        override fun clearCredential() {
            clearCredentialCalled = true
            if (clearCredentialShouldThrow) {
                throw RuntimeException("clearCredential deliberately failing in test")
            }
        }

        override fun setCredential(
            uniqueId: String,
            deviceId: String,
            localPinHash: String,
        ) {
            error("setCredential should not be called in this test")
        }

        override fun setAppLockEnabled(enabled: Boolean) = error("not used")

        override fun setBiometricEnabled(enabled: Boolean) = error("not used")

        override fun setLockTimeoutMinutes(minutes: Int) = error("not used")

        override fun updateLastActiveTimestamp() = error("not used")

        override fun isLockRequired(): Boolean = error("not used")
    }

    private class FakeIdentityRepository : IdentityRepository {
        var resolveResult: Resource<SignInResult> = Resource.Success(SignInResult.NotFound)
        var createResult: Resource<CreateUserResult> = Resource.Success(CreateUserResult(10000001))
        var linkResult: Resource<Unit> = Resource.Success(Unit)
        var unlinkResult: Resource<Unit> = Resource.Success(Unit)
        var refreshResult: Resource<Unit> = Resource.Success(Unit)

        var resolvedProvider: String? = null
        var resolvedIdentifier: String? = null
        var createdProvider: String? = null
        var createdIdentifier: String? = null

        override suspend fun resolveIdentity(
            provider: String,
            identifier: String,
        ): Resource<SignInResult> {
            resolvedProvider = provider
            resolvedIdentifier = identifier
            return resolveResult
        }

        override suspend fun createUser(
            provider: String,
            identifier: String,
            displayName: String?,
            email: String?,
            profilePhotoUrl: String?,
            dateOfBirth: Long?,
            language: String,
        ): Resource<CreateUserResult> {
            createdProvider = provider
            createdIdentifier = identifier
            return createResult
        }

        override suspend fun linkProvider(
            uniqueId: Long,
            provider: String,
            identifier: String,
        ) = linkResult

        override suspend fun unlinkProvider(
            uniqueId: Long,
            provider: String,
            identifier: String,
        ) = unlinkResult

        override suspend fun forceRefreshToken() = refreshResult
    }

    private class FakeUserRepository : UserRepository {
        override val userUpdates: SharedFlow<User> = MutableSharedFlow()
        var existsResult: Resource<Boolean> = Resource.Success(false)
        var getUserResult: Resource<User> = Resource.Success(User())

        override suspend fun userExists(userId: String) = existsResult

        override suspend fun getUser(userId: String) = getUserResult

        override suspend fun createOrUpdateUser(user: User) = Resource.Success(Unit)

        override suspend fun updateDisplayName(
            userId: String,
            displayName: String,
        ) = Resource.Success(Unit)

        override suspend fun updateAvatar(
            userId: String,
            avatarUrl: String,
        ) = Resource.Success(Unit)

        override suspend fun updateLastSeen(userId: String) = Resource.Success(Unit)

        override suspend fun updateProfile(
            userId: String,
            fields: Map<String, Any?>,
        ) = Resource.Success(Unit)

        override suspend fun generateUniqueId(userId: String) = Resource.Success(0L)

        override suspend fun blockUser(
            userId: String,
            blockedUserId: String,
        ) = Resource.Success(Unit)

        override suspend fun unblockUser(
            userId: String,
            blockedUserId: String,
        ) = Resource.Success(Unit)

        override suspend fun getBlockedUserIds(userId: String) = Resource.Success(emptySet<String>())

        override suspend fun checkBlockedBy(
            userIds: List<String>,
            targetUserId: String,
        ) = Resource.Success(emptySet<String>())

        override suspend fun followUser(
            currentUserId: String,
            targetUserId: String,
        ) = Resource.Success(Unit)

        override suspend fun unfollowUser(
            currentUserId: String,
            targetUserId: String,
        ) = Resource.Success(Unit)

        override suspend fun getUsers(userIds: List<String>) = Resource.Success(emptyList<User>())

        override suspend fun removeFollower(
            userId: String,
            followerId: String,
        ) = Resource.Success(Unit)

        override suspend fun recordProfileVisit(
            profileUserId: String,
            visitorId: String,
        ) = Resource.Success(Unit)

        override suspend fun getStalkers(profileUserId: String) = Resource.Success(emptyList<ProfileVisitor>())

        override suspend fun markStalkersViewed(userId: String) = Resource.Success(Unit)

        override fun observeUsers(userIds: Set<String>): Flow<User> = emptyFlow()

        override suspend fun submitSuspensionAppeal(
            userId: String,
            appealText: String,
        ) = Resource.Success(Unit)

        override suspend fun liftExpiredSuspension(userId: String) = Resource.Success(Unit)

        override suspend fun getAliases(userId: String) = Resource.Success(emptyMap<String, String>())

        override suspend fun setAlias(
            userId: String,
            targetUserId: String,
            alias: String,
        ) = Resource.Success(Unit)

        override suspend fun removeAlias(
            userId: String,
            targetUserId: String,
        ) = Resource.Success(Unit)

        override fun observeUserFlags(userId: String): Flow<UserFlags> = emptyFlow()

        override suspend fun acknowledgeWarning(userId: String) = Resource.Success(Unit)

        override suspend fun getWarningReason(userId: String) = Resource.Success<String?>(null)

        override suspend fun requestAccountDeletion(
            userId: String,
            pin: String,
        ) = Resource.Success(0L)

        override suspend fun cancelAccountDeletion(userId: String) = Resource.Success(Unit)

        override suspend fun getAccountDeletionStatus(userId: String) = Resource.Success(UserRepository.DeletionStatus())

        override suspend fun requestDataExport(userId: String) = Resource.Success(0L)

        override suspend fun getDataExportStatus(userId: String) = Resource.Success(UserRepository.DataExportStatus())
    }

    private class FakeDeviceRepository : DeviceRepository {
        var bindingResult: Resource<String?> = Resource.Success(null)
        var banResult: Resource<BanStatus> = Resource.Success(BanStatus())

        override suspend fun getDeviceBinding(deviceId: String) = bindingResult

        override suspend fun bindDevice(
            deviceId: String,
            userId: String,
        ) = Resource.Success(Unit)

        override suspend fun checkBanStatus(deviceId: String) = banResult
    }

    // ─── Tests ───────────────────────────────────────────────────────

    @Test
    fun signInWithGoogle_existingUser_resolvesIdentityAndSetsAuthenticated() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Success(SignInResult.Found(10000005))
                }
            val userRepo =
                FakeUserRepository().apply {
                    existsResult = Resource.Success(true)
                    getUserResult =
                        Resource.Success(
                            User(
                                uid = "10000005",
                                uniqueId = 10000005,
                                displayName = "Alice",
                                acceptedLegalVersion = 999,
                            ),
                        )
                }
            // Not authenticated initially (no restart flow)
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = null,
                    isAuthenticated = false,
                    currentUserEmail = "alice@gmail.com",
                )

            val vm = AuthViewModel(authRepo, userRepo, FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            // Simulate Google sign-in
            vm.signInWithGoogle("fake-id-token")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isAuthenticated, "Should be authenticated after existing user sign-in")
            assertTrue(state.hasProfile, "Should have profile for existing user")
            assertEquals("google", identityRepo.resolvedProvider)
            assertEquals("alice@gmail.com", identityRepo.resolvedIdentifier)
        }

    @Test
    fun signInWithGoogle_newUser_showsProfileCreation() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Success(SignInResult.NotFound)
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = null,
                    isAuthenticated = false,
                    currentUserEmail = "newuser@gmail.com",
                )

            val vm =
                AuthViewModel(authRepo, FakeUserRepository(), FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            vm.signInWithGoogle("fake-id-token")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isAuthenticated, "Should be authenticated even for new user")
            assertFalse(state.hasProfile, "Should NOT have profile — needs creation")
        }

    @Test
    fun signInWithGoogle_deactivatedIdentity_showsError() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Success(SignInResult.Deactivated)
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = null,
                    isAuthenticated = false,
                    currentUserEmail = "old@work.com",
                )

            val vm =
                AuthViewModel(authRepo, FakeUserRepository(), FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            vm.signInWithGoogle("fake-id-token")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertFalse(state.isAuthenticated, "Should NOT be authenticated with deactivated identity")
            assertTrue(state.error != null, "Should show error for deactivated identity")
        }

    @Test
    fun emailProvider_signIn_resolvesIdentityViaEmailIdentifier() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Success(SignInResult.Found(10000099))
                }
            val userRepo =
                FakeUserRepository().apply {
                    existsResult = Resource.Success(true)
                    getUserResult =
                        Resource.Success(
                            User(
                                uid = "10000099",
                                uniqueId = 10000099,
                                displayName = "EmailUser",
                                acceptedLegalVersion = 999,
                            ),
                        )
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = null,
                    isAuthenticated = false,
                    currentUserEmail = "emailuser@example.com",
                    providerInfo = "email" to "emailuser@example.com",
                )

            val vm = AuthViewModel(authRepo, userRepo, FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            vm.handleEmailLink("emailuser@example.com", "https://sign-in-link")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isAuthenticated, "Should be authenticated after email provider sign-in")
            assertTrue(state.hasProfile, "Should have profile for existing email user")
            assertEquals("email", identityRepo.resolvedProvider)
            assertEquals("emailuser@example.com", identityRepo.resolvedIdentifier)
            assertEquals("10000099", authRepo.resolvedUniqueId)
        }

    @Test
    fun afterIdentityResolution_resolvedUniqueIdIsSet_soCurrentUserIdReturnsUniqueId() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Success(SignInResult.Found(10000005))
                }
            val userRepo =
                FakeUserRepository().apply {
                    existsResult = Resource.Success(true)
                    getUserResult =
                        Resource.Success(
                            User(
                                uid = "10000005",
                                uniqueId = 10000005,
                                displayName = "Alice",
                                acceptedLegalVersion = 999,
                            ),
                        )
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = null,
                    isAuthenticated = false,
                    currentUserEmail = "alice@gmail.com",
                )

            val vm = AuthViewModel(authRepo, userRepo, FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            vm.signInWithGoogle("fake-id-token")
            advanceUntilIdle()

            // After identity resolution, authRepo.resolvedUniqueId should be set
            assertEquals("10000005", authRepo.resolvedUniqueId, "resolvedUniqueId should be set after identity resolution")
            // And currentUserId should return the uniqueId, not the Firebase UID
            assertEquals("10000005", authRepo.currentUserId, "currentUserId should return uniqueId, not Firebase UID")
        }

    // ─── F-CYCLE5-01: Auth-error misclassifier tests ─────────────────

    @Test
    fun resolveIdentityFails_withAuthError_clearsSessionInsteadOfShowingUnableToConnect() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("INVALID_REFRESH_TOKEN: token has been invalidated")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "stale-firebase-uid",
                    isAuthenticated = true,
                    currentUserEmail = "user@test.com",
                    providerInfo = "email" to "user@test.com",
                )

            val vm =
                AuthViewModel(authRepo, FakeUserRepository(), FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            vm.resolveAfterExternalSignIn("email", "user@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertFalse(state.isBackendUnreachable, "Auth error should NOT show 'Unable to Connect'")
            assertFalse(state.isAuthenticated, "Stale session should be cleared")
            assertTrue(authRepo.signedOut, "signOut should be called to recover from stale session")
        }

    @Test
    fun resolveIdentityFails_withGenericError_setsBackendUnreachable() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("Network timeout reaching api.shytalk.example")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "firebase-uid",
                    isAuthenticated = true,
                    currentUserEmail = "user@test.com",
                    providerInfo = "email" to "user@test.com",
                )

            val vm =
                AuthViewModel(authRepo, FakeUserRepository(), FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()

            vm.resolveAfterExternalSignIn("email", "user@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isBackendUnreachable, "Network error should show 'Unable to Connect'")
            assertFalse(authRepo.signedOut, "Network errors should NOT trigger sign-out")
        }

    @Test
    fun userExistsFails_withUnauthenticated_clearsSession() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Success(SignInResult.Found(10000005))
                }
            val userRepo =
                FakeUserRepository().apply {
                    existsResult = Resource.Error("UNAUTHENTICATED: token expired")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val vm = AuthViewModel(authRepo, userRepo, FakeDeviceRepository(), identityRepo, "device-1", bypassDeviceChecks = true)
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertFalse(state.isBackendUnreachable, "Stale token mid-flow should not show 'Unable to Connect'")
            assertTrue(authRepo.signedOut, "signOut should be called")
        }

    @Test
    fun networkError_withIpv6PrefixContaining401_doesNotClearSession() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("Connection refused: [2401:db00::34]:8443")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val appLock = FakeAppLockRepository(hasCredential = true)
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isBackendUnreachable, "IPv6 prefix containing '2401:' must take the network-error path")
            assertFalse(authRepo.signedOut, "False-positive 401 match must NOT clear session")
            assertFalse(
                appLock.clearCredentialCalled,
                "False-positive 401 match must NOT call clearCredential — would silently nuke the user's PIN",
            )
        }

    @Test
    fun authError_withRealHttp401InMessage_clearsSession() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("HTTP 401 Unauthorized")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val appLock = FakeAppLockRepository(hasCredential = true)
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(authRepo.signedOut, "Standalone '401' as a word must trigger session clear")
            assertTrue(appLock.clearCredentialCalled, "Genuine auth error MUST clear stored credential")
            assertFalse(state.isBackendUnreachable, "Auth error must NOT show 'Unable to Connect'")
            assertFalse(state.isAuthenticated, "Auth error must clear isAuthenticated")
        }

    @Test
    fun authError_withTokenRefreshFailedSubstring_clearsSession() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("Token refresh failed: revoked")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val appLock = FakeAppLockRepository(hasCredential = true)
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(authRepo.signedOut, "'Token refresh' substring (iOS API client error) must clear session")
            assertTrue(appLock.clearCredentialCalled, "Genuine auth error MUST clear stored credential")
            assertFalse(state.isBackendUnreachable)
            assertFalse(state.isAuthenticated)
        }

    @Test
    fun authError_withNotAuthenticatedSubstring_clearsSession() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("Not authenticated")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val appLock = FakeAppLockRepository(hasCredential = true)
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(authRepo.signedOut, "'Not authenticated' (IosApiClient when no current user) must clear session")
            assertTrue(appLock.clearCredentialCalled, "Genuine auth error MUST clear stored credential")
            assertFalse(state.isBackendUnreachable)
            assertFalse(state.isAuthenticated)
        }

    // ─── SF3 hard-error UI: half-cleared local state ────────────────

    @Test
    fun handleBackendError_whenClearCredentialThrows_setsRequiresAppDataClear() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("INVALID_REFRESH_TOKEN: revoked")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val appLock = FakeAppLockRepository(hasCredential = true).apply { clearCredentialShouldThrow = true }
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.requiresAppDataClear, "clearCredential failure must set the sticky storage-corrupted flag")
            assertTrue(authRepo.signedOut, "signOut must still be attempted even after clearCredential throws")
            assertTrue(state.error != null, "User must see an error message instructing the recovery action")
        }

    @Test
    fun handleBackendError_whenSignOutThrows_resetsMigrationGuardManually() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("INVALID_REFRESH_TOKEN: revoked")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                ).apply { signOutShouldThrow = true }

            val appLock = FakeAppLockRepository(hasCredential = true)
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.requiresAppDataClear, "signOut failure must set the sticky storage-corrupted flag")
            assertTrue(appLock.clearCredentialCalled, "clearCredential must have been called before signOut threw")
        }

    @Test
    fun handleBackendError_whenBothSucceed_clearsToBareSignInWithoutStickyFlag() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("INVALID_REFRESH_TOKEN: revoked")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val appLock = FakeAppLockRepository(hasCredential = true)
            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertFalse(
                state.requiresAppDataClear,
                "Happy-path recovery must NOT set requiresAppDataClear — would lock out users from retrying sign-in",
            )
            assertTrue(authRepo.signedOut)
            assertTrue(appLock.clearCredentialCalled)
        }

    // ─── SF1 migration null-providerInfo path ───────────────────────

    @Test
    fun migrationPath_whenProviderInfoNull_signsOutAndResetsMigrationGuard() =
        runTest {
            // Setup mirrors the migration prerequisites: hasCredential=false on AppLock,
            // isAuthenticated=true on AuthRepo, and getProviderInfo()=null.
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "orphan-uid",
                    isAuthenticated = true,
                    currentUserEmail = "anon@firebase",
                    providerInfo = null, // legacy / anonymous / custom-token session
                )
            val appLock = FakeAppLockRepository(hasCredential = false)

            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    FakeIdentityRepository(),
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(authRepo.signedOut, "Migration with null providerInfo must clear the orphaned Firebase session")
            assertFalse(state.requiresAppDataClear, "Happy-path migration abort must not set the storage-corrupted flag")
        }

    @Test
    fun migrationPath_whenProviderInfoNullAndSignOutThrows_setsRequiresAppDataClear() =
        runTest {
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "orphan-uid",
                    isAuthenticated = true,
                    currentUserEmail = "anon@firebase",
                    providerInfo = null,
                ).apply { signOutShouldThrow = true }
            val appLock = FakeAppLockRepository(hasCredential = false)

            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    FakeIdentityRepository(),
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.requiresAppDataClear, "signOut failure during migration must set the sticky flag")
            assertTrue(state.error != null, "User must see the recovery instruction")
            // Migration guard must NOT be reset to false here — re-entering migration
            // with the same orphaned session would just re-fail signOut and loop.
        }

    // ─── Pass-6 backfill: Q1-CRIT clearError sticky-aware contract ──
    // The persistent recovery banner reads `uiState.error` after the
    // sticky flag is set. `clearError()` is invoked after the snackbar
    // dismisses. If clearError clears the error while the flag is set,
    // the banner blanks out and the user sees disabled buttons with
    // no on-screen reason — the exact UX dead-end pass-3 fixed.

    @Test
    fun clearError_whenRequiresAppDataClearIsTrue_preservesErrorMessageForBanner() =
        runTest {
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "orphan-uid",
                    isAuthenticated = true,
                    currentUserEmail = "anon@firebase",
                    providerInfo = null,
                ).apply { signOutShouldThrow = true }
            val appLock = FakeAppLockRepository(hasCredential = false)

            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    FakeIdentityRepository(),
                    "device-1",
                    bypassDeviceChecks = true,
                    appLockRepository = appLock,
                )
            advanceUntilIdle()

            // Pre-condition: sticky flag set + error populated
            val before = vm.uiState.value
            assertTrue(before.requiresAppDataClear)
            assertTrue(before.error != null)

            // Simulate the snackbar consume-and-clear cycle
            vm.clearError()

            val after = vm.uiState.value
            assertTrue(
                after.requiresAppDataClear,
                "Sticky flag must remain set after clearError",
            )
            assertTrue(
                after.error != null,
                "clearError() must NOT clear error when requiresAppDataClear=true — the banner needs the message",
            )
        }

    @Test
    fun clearError_whenRequiresAppDataClearIsFalse_clearsErrorAsBefore() =
        runTest {
            val identityRepo =
                FakeIdentityRepository().apply {
                    resolveResult = Resource.Error("Network timeout")
                }
            val authRepo =
                FakeAuthRepository(
                    firebaseUid = "uid",
                    isAuthenticated = true,
                    currentUserEmail = "u@test.com",
                    providerInfo = "email" to "u@test.com",
                )

            val vm =
                AuthViewModel(
                    authRepo,
                    FakeUserRepository(),
                    FakeDeviceRepository(),
                    identityRepo,
                    "device-1",
                    bypassDeviceChecks = true,
                )
            advanceUntilIdle()

            // Drive a regular network error (not the storage-corrupted path)
            vm.resolveAfterExternalSignIn("email", "u@test.com")
            advanceUntilIdle()

            val before = vm.uiState.value
            assertFalse(before.requiresAppDataClear, "Network error must NOT set sticky flag")

            vm.clearError()
            val after = vm.uiState.value
            assertEquals(null, after.error, "clearError must clear error in normal (non-sticky) state")
            assertFalse(after.requiresAppDataClear)
        }
}
