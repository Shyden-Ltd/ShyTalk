package com.shyden.shytalk.feature.auth

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
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
    private val deviceId = "test-device-id"
    private val userId = "user-1"

    private val testDob = 946684800000L // 2000-01-01

    private val activeViewModels = mutableListOf<AuthViewModel>()

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel() = AuthViewModel(
        authRepository = authRepository,
        userRepository = userRepository,
        deviceRepository = deviceRepository,
        deviceId = deviceId
    ).also { activeViewModels.add(it) }

    @Test
    fun `init - not authenticated stays default`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `init - authenticated with profile and DOB sets all flags`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertTrue(vm.uiState.value.hasProfile)
        assertTrue(vm.uiState.value.hasDOB)
    }

    @Test
    fun `init - authenticated with profile but no DOB sets hasDOB false`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = null)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertTrue(vm.uiState.value.hasProfile)
        assertFalse(vm.uiState.value.hasDOB)
    }

    @Test
    fun `init - device bound to different user locks device`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceLocked)
        verify { authRepository.signOut() }
    }

    @Test
    fun `init - no device binding binds new device`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        coVerify { deviceRepository.bindDevice(deviceId, userId) }
    }

    @Test
    fun `init - device binding network error is lenient`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Error("network")
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.isDeviceLocked)
    }

    @Test
    fun `signInWithGoogle - success with new user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(false)

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.hasProfile)
        assertFalse(vm.uiState.value.hasDOB)
        coVerify { deviceRepository.bindDevice(deviceId, userId) }
    }

    @Test
    fun `signInWithGoogle - existing user with DOB`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
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
    fun `signInWithGoogle - existing user without DOB`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = null)
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
    fun `signInWithGoogle - device locked to different user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceLocked)
    }

    @Test
    fun `signInWithGoogle - auth error sets error`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("auth failed")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertEquals("auth failed", vm.uiState.value.error)
    }

    // ===== signInWithApple =====

    @Test
    fun `signInWithApple - success with new user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(false)

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithApple("token", "nonce")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.hasProfile)
        assertFalse(vm.uiState.value.hasDOB)
        coVerify { deviceRepository.bindDevice(deviceId, userId) }
    }

    @Test
    fun `signInWithApple - auth error sets error`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Error("apple auth failed")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithApple("token", "nonce")
        advanceUntilIdle()

        assertEquals("apple auth failed", vm.uiState.value.error)
    }

    @Test
    fun `signOut resets state`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isAuthenticated)

        vm.signOut()

        assertFalse(vm.uiState.value.isAuthenticated)
        verify { authRepository.signOut() }
    }

    @Test
    fun `clearError clears error`() = runTest {
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
    fun `clearDeviceLocked clears flag`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isDeviceLocked)

        vm.clearDeviceLocked()
        assertFalse(vm.uiState.value.isDeviceLocked)
    }

    @Test
    fun `init - getUser error sets isBackendUnreachable`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Error("fetch failed")

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBackendUnreachable)
        assertFalse(vm.uiState.value.isLoading)
    }

    // ===== Suspension =====

    @Test
    fun `init - suspended user sets isSuspended true and isAuthenticated false`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(
                uid = userId,
                dateOfBirth = testDob,
                isSuspended = true,
                suspensionReason = "Spam",
                suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                suspensionCanAppeal = true
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isSuspended)
        assertFalse(vm.uiState.value.isAuthenticated)
        assertEquals("Spam", vm.uiState.value.suspensionReason)
        assertTrue(vm.uiState.value.suspensionCanAppeal)
    }

    @Test
    fun `init - expired suspension passes through normally`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(
                uid = userId,
                dateOfBirth = testDob,
                isSuspended = true,
                suspensionEndDate = System.currentTimeMillis() - 86_400_000L
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isSuspended)
        assertTrue(vm.uiState.value.isAuthenticated)
    }

    @Test
    fun `init - permanent suspension blocks indefinitely`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(
                uid = userId,
                dateOfBirth = testDob,
                isSuspended = true,
                suspensionEndDate = null,
                suspensionCanAppeal = false
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isSuspended)
        assertFalse(vm.uiState.value.isAuthenticated)
        assertNull(vm.uiState.value.suspensionEndDate)
        assertFalse(vm.uiState.value.suspensionCanAppeal)
    }

    @Test
    fun `submitAppeal - success sets canAppeal to false`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(
                uid = userId,
                isSuspended = true,
                suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                suspensionCanAppeal = true
            )
        )
        coEvery { userRepository.submitSuspensionAppeal(userId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.suspensionCanAppeal)

        vm.submitAppeal("Please unsuspend me")
        advanceUntilIdle()

        assertFalse(vm.uiState.value.suspensionCanAppeal)
        assertEquals("pending", vm.uiState.value.suspensionAppealStatus)
    }

    @Test
    fun `submitAppeal - failure sets error`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(
                uid = userId,
                isSuspended = true,
                suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                suspensionCanAppeal = true
            )
        )
        coEvery { userRepository.submitSuspensionAppeal(userId, any()) } returns Resource.Error("network error")

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.suspensionCanAppeal)

        vm.submitAppeal("Please unsuspend me")
        advanceUntilIdle()

        assertEquals("Failed to submit appeal", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
        // suspensionCanAppeal should still be true since appeal failed
        assertTrue(vm.uiState.value.suspensionCanAppeal)
    }

    // ===== Additional Google sign-in error scenarios =====

    @Test
    fun `signInWithGoogle - network error sets error and stops loading`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("bad-token") } returns Resource.Error("Network unavailable")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.signInWithGoogle("bad-token")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("Network unavailable", state.error)
        assertFalse(state.isAuthenticated)
        assertFalse(state.isLoading)
    }

    @Test
    fun `signInWithGoogle - clears previous error before attempting`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token1") } returns Resource.Error("first error")
        coEvery { authRepository.signInWithGoogleIdToken("token2") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(false)

        val vm = createViewModel()
        advanceUntilIdle()

        vm.signInWithGoogle("token1")
        advanceUntilIdle()
        assertEquals("first error", vm.uiState.value.error)

        vm.signInWithGoogle("token2")
        advanceUntilIdle()
        assertNull(vm.uiState.value.error)
        assertTrue(vm.uiState.value.isAuthenticated)
    }

    // ===== Apple sign-in device lock =====

    @Test
    fun `signInWithApple - device locked to different user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithApple("token", "nonce")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceLocked)
        assertFalse(vm.uiState.value.isAuthenticated)
    }

    // ===== signOut clears error and suspension state =====

    @Test
    fun `signOut clears error state`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("auth failed")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()
        assertEquals("auth failed", vm.uiState.value.error)

        vm.signOut()

        assertNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.isAuthenticated)
    }

    @Test
    fun `signOut clears suspension state`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(
                uid = userId,
                isSuspended = true,
                suspensionEndDate = System.currentTimeMillis() + 86_400_000L,
                suspensionCanAppeal = true
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isSuspended)

        vm.signOut()

        assertFalse(vm.uiState.value.isSuspended)
        assertFalse(vm.uiState.value.isAuthenticated)
        assertNull(vm.uiState.value.suspensionReason)
    }

    // ===== userExists error =====

    @Test
    fun `signInWithGoogle - userExists error sets isBackendUnreachable`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Error("Firestore down")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.isBackendUnreachable)
        assertFalse(state.isLoading)
    }

    // ===== init with currentUserId null =====

    @Test
    fun `init - authenticated but currentUserId null stops loading`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.isLoading)
    }

    // ===== Apple sign-in with existing user and DOB =====

    @Test
    fun `signInWithApple - existing user with DOB sets all flags`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithApple("token", "nonce")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertTrue(vm.uiState.value.hasProfile)
        assertTrue(vm.uiState.value.hasDOB)
    }
}
