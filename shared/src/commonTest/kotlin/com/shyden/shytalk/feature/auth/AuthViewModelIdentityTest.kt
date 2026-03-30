package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
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
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
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

        override fun signOut() {
            signedOut = true
            resolvedUniqueId = null
            firebaseUid = null
        }
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
}
