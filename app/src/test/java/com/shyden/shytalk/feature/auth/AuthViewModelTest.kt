package com.shyden.shytalk.feature.auth

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.SignInResult
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val deviceRepository = mockk<DeviceRepository>(relaxed = true)
    private val identityRepository = mockk<IdentityRepository>(relaxed = true)
    private val deviceId = "test-device-id"

    // Identity system values
    private val email = "test@example.com"
    private val uniqueId = 10000005L
    private val uniqueIdStr = "10000005"
    private val testDob = 946684800000L // 2000-01-01

    private val activeViewModels = mutableListOf<AuthViewModel>()

    @After
    fun tearDown() =
        runBlocking {
            activeViewModels.forEach {
                it.viewModelScope.coroutineContext.job
                    .cancelAndJoin()
            }
            activeViewModels.clear()
        }

    /** Sets up mocks for explicit sign-in identity resolution. */
    private fun setupSignInIdentity() {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        every { authRepository.currentUserEmail } returns email
        coEvery { identityRepository.resolveIdentity("google", email) } returns
            Resource.Success(SignInResult.Found(uniqueId))
        coEvery { identityRepository.forceRefreshToken() } returns Resource.Success(Unit)
    }

    private fun createViewModel() =
        AuthViewModel(
            authRepository = authRepository,
            userRepository = userRepository,
            deviceRepository = deviceRepository,
            identityRepository = identityRepository,
            deviceId = deviceId,
        ).also { activeViewModels.add(it) }

    // ===== init (app launch — no auto-sign-in) =====

    @Test
    fun `init - not authenticated stays default`() =
        runTest {
            every { authRepository.isAuthenticated } returns false

            val vm = createViewModel()
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isAuthenticated)
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `init - authenticated user without appLockRepository stays default`() =
        runTest {
            // When appLockRepository is null (legacy/test), authenticated user stays on sign-in screen
            every { authRepository.isAuthenticated } returns true

            val vm = createViewModel()
            advanceUntilIdle()

            // No longer signs out — the old signOut-on-init behavior is removed
            // Without appLockRepository, the ViewModel stays in default state
            assertFalse(vm.uiState.value.isLoading)
        }

    // ===== signInWithGoogle =====

    @Test
    fun `signInWithGoogle - success with new user`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { identityRepository.resolveIdentity("google", email) } returns
                Resource.Success(SignInResult.NotFound)

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertFalse(vm.uiState.value.hasProfile)
            assertFalse(vm.uiState.value.hasDOB)
        }

    @Test
    fun `signInWithGoogle - existing user with DOB`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertTrue(vm.uiState.value.hasProfile)
            assertTrue(vm.uiState.value.hasDOB)
        }

    @Test
    fun `signInWithGoogle - existing user without DOB`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = null),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertTrue(vm.uiState.value.hasProfile)
            assertFalse(vm.uiState.value.hasDOB)
        }

    @Test
    fun `signInWithGoogle - device locked to different user`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isDeviceLocked)
        }

    @Test
    fun `signInWithGoogle - auth error sets error`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("auth failed")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertEquals(UiText.Plain("auth failed"), vm.uiState.value.error)
        }

    @Test
    fun `signInWithGoogle - no device binding binds new device`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            coVerify { deviceRepository.bindDevice(deviceId, uniqueIdStr) }
        }

    @Test
    fun `signInWithGoogle - device binding error is lenient`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Error("network")
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertFalse(vm.uiState.value.isDeviceLocked)
        }

    @Test
    fun `signInWithGoogle - identity resolution error shows backend unreachable`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            every { authRepository.currentUserEmail } returns email
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { identityRepository.resolveIdentity("google", email) } returns
                Resource.Error("Network error")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isBackendUnreachable)
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `signInWithGoogle - getUser error sets isBackendUnreachable`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns Resource.Error("fetch failed")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isBackendUnreachable)
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `signInWithGoogle - network error sets error and stops loading`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithGoogleIdToken("bad-token") } returns Resource.Error("Network unavailable")

            val vm = createViewModel()
            advanceUntilIdle()

            vm.signInWithGoogle("bad-token")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(UiText.Plain("Network unavailable"), state.error)
            assertFalse(state.isAuthenticated)
            assertFalse(state.isLoading)
        }

    @Test
    fun `signInWithGoogle - clears previous error before attempting`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithGoogleIdToken("token1") } returns Resource.Error("first error")
            coEvery { authRepository.signInWithGoogleIdToken("token2") } returns Resource.Success("firebase-uid")
            every { authRepository.currentUserEmail } returns email
            coEvery { identityRepository.resolveIdentity("google", email) } returns
                Resource.Success(SignInResult.NotFound)

            val vm = createViewModel()
            advanceUntilIdle()

            vm.signInWithGoogle("token1")
            advanceUntilIdle()
            assertEquals(UiText.Plain("first error"), vm.uiState.value.error)

            vm.signInWithGoogle("token2")
            advanceUntilIdle()
            assertNull(vm.uiState.value.error)
            assertTrue(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signInWithGoogle - userExists error sets isBackendUnreachable`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Error("Firestore down")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isBackendUnreachable)
            assertFalse(state.isLoading)
        }

    // ===== signInWithApple =====

    @Test
    fun `signInWithApple - success with new user`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success("firebase-uid")
            every { authRepository.getProviderInfo() } returns ("apple" to "001234.abcdef")
            coEvery { identityRepository.resolveIdentity("apple", "001234.abcdef") } returns
                Resource.Success(SignInResult.NotFound)

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithApple("token", "nonce")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertFalse(vm.uiState.value.hasProfile)
            assertFalse(vm.uiState.value.hasDOB)
        }

    @Test
    fun `signInWithApple - auth error sets error`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Error("apple auth failed")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithApple("token", "nonce")
            advanceUntilIdle()

            assertEquals(UiText.Plain("apple auth failed"), vm.uiState.value.error)
        }

    @Test
    fun `signInWithApple - device locked to different user`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success("firebase-uid")
            every { authRepository.getProviderInfo() } returns ("apple" to "001234.abcdef")
            coEvery { identityRepository.resolveIdentity("apple", "001234.abcdef") } returns
                Resource.Success(SignInResult.Found(uniqueId))
            coEvery { identityRepository.forceRefreshToken() } returns Resource.Success(Unit)
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithApple("token", "nonce")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isDeviceLocked)
            assertFalse(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signInWithApple - existing user with DOB sets all flags`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success("firebase-uid")
            every { authRepository.getProviderInfo() } returns ("apple" to "001234.abcdef")
            coEvery { identityRepository.resolveIdentity("apple", "001234.abcdef") } returns
                Resource.Success(SignInResult.Found(uniqueId))
            coEvery { identityRepository.forceRefreshToken() } returns Resource.Success(Unit)
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithApple("token", "nonce")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertTrue(vm.uiState.value.hasProfile)
            assertTrue(vm.uiState.value.hasDOB)
        }

    // ===== signOut =====

    @Test
    fun `signOut resets state`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.isAuthenticated)

            vm.signOut()

            assertFalse(vm.uiState.value.isAuthenticated)
            verify { authRepository.signOut() }
        }

    @Test
    fun `clearError clears error`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("err")

            val vm = createViewModel()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            vm.clearError()
            assertNull(vm.uiState.value.error)
        }

    @Test
    fun `clearDeviceLocked clears flag`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.isDeviceLocked)

            vm.clearDeviceLocked()
            assertFalse(vm.uiState.value.isDeviceLocked)
        }

    // ===== Suspension =====

    @Test
    fun `signInWithGoogle - suspended user sets isSuspended true`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = uniqueIdStr,
                        dateOfBirth = testDob,
                        isSuspended = true,
                        suspensionReason = "Spam",
                        suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                        suspensionCanAppeal = true,
                    ),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isSuspended)
            assertFalse(vm.uiState.value.isAuthenticated)
            assertEquals("Spam", vm.uiState.value.suspensionReason)
            assertTrue(vm.uiState.value.suspensionCanAppeal)
        }

    @Test
    fun `signInWithGoogle - expired suspension passes through normally`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = uniqueIdStr,
                        dateOfBirth = testDob,
                        isSuspended = true,
                        suspensionEndDate = System.currentTimeMillis() - 86_400_000L,
                    ),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isSuspended)
            assertTrue(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signInWithGoogle - permanent suspension blocks indefinitely`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = uniqueIdStr,
                        dateOfBirth = testDob,
                        isSuspended = true,
                        suspensionEndDate = null,
                        suspensionCanAppeal = false,
                    ),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isSuspended)
            assertFalse(vm.uiState.value.isAuthenticated)
            assertNull(vm.uiState.value.suspensionEndDate)
            assertFalse(vm.uiState.value.suspensionCanAppeal)
        }

    @Test
    fun `submitAppeal - success sets canAppeal to false`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            every { authRepository.currentUserId } returns "firebase-uid"
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = uniqueIdStr,
                        isSuspended = true,
                        suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                        suspensionCanAppeal = true,
                    ),
                )
            coEvery { userRepository.submitSuspensionAppeal(any(), any()) } returns Resource.Success(Unit)

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.suspensionCanAppeal)

            vm.submitAppeal("Please unsuspend me")
            advanceUntilIdle()

            assertFalse(vm.uiState.value.suspensionCanAppeal)
            assertEquals("pending", vm.uiState.value.suspensionAppealStatus)
        }

    @Test
    fun `submitAppeal - failure sets error`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            every { authRepository.currentUserId } returns "firebase-uid"
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = uniqueIdStr,
                        isSuspended = true,
                        suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                        suspensionCanAppeal = true,
                    ),
                )
            coEvery { userRepository.submitSuspensionAppeal(any(), any()) } returns Resource.Error("network error")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.suspensionCanAppeal)

            vm.submitAppeal("Please unsuspend me")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is UiText.Res)
            assertFalse(vm.uiState.value.isLoading)
            assertTrue(vm.uiState.value.suspensionCanAppeal)
        }

    // ===== signOut clears error and suspension state =====

    @Test
    fun `signOut clears error state`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("auth failed")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertEquals(UiText.Plain("auth failed"), vm.uiState.value.error)

            vm.signOut()

            assertNull(vm.uiState.value.error)
            assertFalse(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signOut clears suspension state`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = uniqueIdStr,
                        isSuspended = true,
                        suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                        suspensionCanAppeal = true,
                    ),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.isSuspended)

            vm.signOut()

            assertFalse(vm.uiState.value.isSuspended)
            assertFalse(vm.uiState.value.isAuthenticated)
            assertNull(vm.uiState.value.suspensionReason)
        }

    // ===== Email sign-in =====

    @Test
    fun `signInWithEmail rejects disposable email domains`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithEmail("test@mailinator.com")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is UiText.Res)
            assertFalse(vm.uiState.value.awaitingEmailLink)
            assertFalse(vm.uiState.value.isLoading)
            coVerify(exactly = 0) { authRepository.sendSignInLink(any()) }
        }

    @Test
    fun `signInWithEmail accepts normal email domains`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.sendSignInLink("test@gmail.com") } returns Resource.Success(Unit)

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithEmail("test@gmail.com")
            advanceUntilIdle()

            assertNull(vm.uiState.value.error)
            assertTrue(vm.uiState.value.awaitingEmailLink)
        }

    @Test
    fun `signInWithEmail sends link and sets awaitingEmailLink state`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.sendSignInLink(email) } returns Resource.Success(Unit)

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithEmail(email)
            advanceUntilIdle()

            assertTrue(vm.uiState.value.awaitingEmailLink)
            assertEquals(email, vm.uiState.value.emailForLink)
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `signInWithEmail handles send failure gracefully`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.sendSignInLink(email) } returns Resource.Error("Failed to send email")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithEmail(email)
            advanceUntilIdle()

            assertFalse(vm.uiState.value.awaitingEmailLink)
            assertEquals(UiText.Plain("Failed to send email"), vm.uiState.value.error)
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `handleEmailLink completes sign-in and resolves identity`() =
        runTest {
            setupSignInIdentity()
            coEvery { authRepository.signInWithEmailLink(email, "https://link") } returns Resource.Success("firebase-uid")
            coEvery { authRepository.getProviderInfo() } returns ("email" to email)
            coEvery { identityRepository.resolveIdentity("email", email) } returns
                Resource.Success(SignInResult.NotFound)

            val vm = createViewModel()
            advanceUntilIdle()
            vm.handleEmailLink(email, "https://link")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isAuthenticated)
            assertFalse(vm.uiState.value.awaitingEmailLink)
        }

    @Test
    fun `handleEmailLink handles invalid link error`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithEmailLink(email, "bad-link") } returns Resource.Error("Invalid link")

            val vm = createViewModel()
            advanceUntilIdle()
            vm.handleEmailLink(email, "bad-link")
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isAuthenticated)
            assertEquals(UiText.Plain("Invalid link"), vm.uiState.value.error)
        }
}
