package com.shyden.shytalk.feature.auth

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BanStatus
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.SignInResult
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
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
class AuthViewModelBanTest {
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
    private val testDob = 946684800000L

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

    /** Sets up mocks for explicit Google sign-in that resolves identity. */
    private fun setupSignInIdentity() {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        every { authRepository.currentUserEmail } returns email
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success("firebase-uid")
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

    @Test
    fun `signInWithGoogle - device banned blocks authentication`() =
        runTest {
            setupSignInIdentity()
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { deviceRepository.checkBanStatus(deviceId) } returns
                Resource.Success(
                    BanStatus(isBanned = true, banType = "device", reason = "Spam", expiresAt = "2099-01-01T00:00:00Z"),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isDeviceBanned)
            assertFalse(vm.uiState.value.isNetworkBanned)
            assertFalse(vm.uiState.value.isAuthenticated)
            assertEquals("Spam", vm.uiState.value.banReason)
            assertEquals("2099-01-01T00:00:00Z", vm.uiState.value.banExpiresAt)
        }

    @Test
    fun `signInWithGoogle - network banned blocks authentication`() =
        runTest {
            setupSignInIdentity()
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { deviceRepository.checkBanStatus(deviceId) } returns
                Resource.Success(
                    BanStatus(isBanned = true, banType = "network_ip", reason = "VPN abuse", expiresAt = null),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isDeviceBanned)
            assertTrue(vm.uiState.value.isNetworkBanned)
            assertFalse(vm.uiState.value.isAuthenticated)
            assertEquals("VPN abuse", vm.uiState.value.banReason)
            assertNull(vm.uiState.value.banExpiresAt)
        }

    @Test
    fun `signInWithGoogle - not banned proceeds to profile resolution`() =
        runTest {
            setupSignInIdentity()
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(BanStatus())
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isDeviceBanned)
            assertFalse(vm.uiState.value.isNetworkBanned)
            assertTrue(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signInWithGoogle - ban check error is lenient`() =
        runTest {
            setupSignInIdentity()
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Error("network error")
            coEvery { userRepository.userExists(uniqueIdStr) } returns Resource.Success(true)
            coEvery { userRepository.getUser(uniqueIdStr) } returns
                Resource.Success(
                    TestData.createTestUser(uid = uniqueIdStr, dateOfBirth = testDob),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isDeviceBanned)
            assertFalse(vm.uiState.value.isNetworkBanned)
            assertTrue(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signInWithApple - network banned after sign-in`() =
        runTest {
            every { authRepository.isAuthenticated } returns false
            every { authRepository.currentUserId } returns null
            coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success("firebase-uid")
            every { authRepository.getProviderInfo() } returns ("apple" to "001234.abcdef")
            coEvery { identityRepository.resolveIdentity("apple", "001234.abcdef") } returns
                Resource.Success(SignInResult.Found(uniqueId))
            coEvery { identityRepository.forceRefreshToken() } returns Resource.Success(Unit)
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { deviceRepository.checkBanStatus(deviceId) } returns
                Resource.Success(
                    BanStatus(isBanned = true, banType = "network_asn", reason = "Datacenter IP"),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithApple("token", "nonce")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.isNetworkBanned)
            assertFalse(vm.uiState.value.isAuthenticated)
        }

    @Test
    fun `signOut clears ban state`() =
        runTest {
            setupSignInIdentity()
            coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(uniqueIdStr)
            coEvery { deviceRepository.checkBanStatus(deviceId) } returns
                Resource.Success(
                    BanStatus(isBanned = true, banType = "device", reason = "Spam"),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.signInWithGoogle("token")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.isDeviceBanned)

            vm.signOut()

            assertFalse(vm.uiState.value.isDeviceBanned)
            assertFalse(vm.uiState.value.isNetworkBanned)
            assertNull(vm.uiState.value.banReason)
        }
}
