package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PinVerifyResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class LockScreenViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var fakePinRepo: FakePinRepository
    private lateinit var fakeBioRepo: FakeBiometricRepository
    private lateinit var fakeBioAuth: BiometricAuth
    private lateinit var fakeCrypto: CryptoKeyPair
    private lateinit var appLockRepo: AppLockRepositoryImpl
    private lateinit var viewModel: LockScreenViewModel

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        fakePinRepo = FakePinRepository()
        fakeBioRepo = FakeBiometricRepository()
        fakeBioAuth = BiometricAuth() // JVM stub — isAvailable() returns false
        fakeCrypto = CryptoKeyPair() // JVM stub
        appLockRepo = AppLockRepositoryImpl(SecureStorage())
        appLockRepo.setCredential("12345678", "dev-1", "\$2b\$10\$hash")
        viewModel = LockScreenViewModel(fakePinRepo, fakeBioRepo, fakeBioAuth, fakeCrypto, appLockRepo)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── PIN input ──────────────────────────────────────────────

    @Test
    fun `initial state has empty PIN and no errors`() {
        assertEquals("", viewModel.state.value.pinInput)
        assertNull(viewModel.state.value.error)
        assertFalse(viewModel.state.value.isLocked)
        assertFalse(viewModel.state.value.unlocked)
    }

    @Test
    fun `onPinDigit appends digit to input`() {
        viewModel.onPinDigit('1')
        viewModel.onPinDigit('2')
        viewModel.onPinDigit('3')
        assertEquals("123", viewModel.state.value.pinInput)
    }

    @Test
    fun `onPinBackspace removes last digit`() {
        viewModel.onPinDigit('1')
        viewModel.onPinDigit('2')
        viewModel.onPinBackspace()
        assertEquals("1", viewModel.state.value.pinInput)
    }

    @Test
    fun `onPinBackspace on empty input does nothing`() {
        viewModel.onPinBackspace()
        assertEquals("", viewModel.state.value.pinInput)
    }

    @Test
    fun `onPinClear clears input and error`() {
        viewModel.onPinDigit('1')
        viewModel.onPinDigit('2')
        viewModel.onPinClear()
        assertEquals("", viewModel.state.value.pinInput)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `submitPin with short PIN shows error`() {
        viewModel.onPinDigit('1')
        viewModel.onPinDigit('2')
        viewModel.submitPin()
        assertEquals("PIN too short", viewModel.state.value.error)
    }

    // ─── PIN verification ───────────────────────────────────────

    @Test
    fun `submitPin success sets unlocked true`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-abc"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.unlocked)
        }

    @Test
    fun `submitPin wrong PIN shows error with remaining attempts`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(attemptsRemaining = 3))
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals("Wrong PIN. 3 attempts remaining.", viewModel.state.value.error)
            assertEquals("", viewModel.state.value.pinInput) // cleared
            assertFalse(viewModel.state.value.unlocked)
        }

    @Test
    fun `submitPin lockout sets locked state`() =
        runTest {
            val lockedUntil = System.currentTimeMillis() + 15 * 60 * 1000
            fakePinRepo.verifyResult =
                Result.success(
                    PinVerifyResult(
                        locked = true,
                        lockedUntil = lockedUntil,
                        attemptsRemaining = 0,
                    ),
                )
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.isLocked)
            assertEquals(lockedUntil, viewModel.state.value.lockedUntil)
            assertEquals(0, viewModel.state.value.attemptsRemaining)
        }

    @Test
    fun `submitPin lockout calls onLockout callback`() =
        runTest {
            var lockoutCalled = false
            viewModel.onLockout = { lockoutCalled = true }

            fakePinRepo.verifyResult =
                Result.success(
                    PinVerifyResult(
                        locked = true,
                        lockedUntil = System.currentTimeMillis() + 1000,
                        attemptsRemaining = 0,
                    ),
                )
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(lockoutCalled)
        }

    @Test
    fun `submitPin lockout with requiresReauth sets flag`() =
        runTest {
            fakePinRepo.verifyResult =
                Result.success(
                    PinVerifyResult(
                        locked = true,
                        lockedUntil = System.currentTimeMillis() + 1000,
                        requiresReauth = true,
                        attemptsRemaining = 0,
                    ),
                )
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.requiresReauth)
        }

    @Test
    fun `submitPin network failure shows error`() =
        runTest {
            fakePinRepo.verifyResult = Result.failure(Exception("Network error"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals("Network error", viewModel.state.value.error)
            assertFalse(viewModel.state.value.unlocked)
        }

    @Test
    fun `submitPin with no stored uniqueId does nothing`() =
        runTest {
            appLockRepo.clearCredential()
            viewModel = LockScreenViewModel(fakePinRepo, fakeBioRepo, fakeBioAuth, fakeCrypto, appLockRepo)
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertFalse(viewModel.state.value.unlocked)
            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Biometric ──────────────────────────────────────────────

    @Test
    fun `biometricAvailable is false on JVM`() {
        assertFalse(viewModel.state.value.biometricAvailable)
    }

    // ─── Fakes ──────────────────────────────────────────────────

    private class FakePinRepository : PinRepository {
        var verifyResult: Result<PinVerifyResult> = Result.success(PinVerifyResult(customToken = "token"))

        override suspend fun setupPin(pin: String): Result<String> = Result.success("\$2b\$10\$hash")

        override suspend fun verifyPin(
            uniqueId: String,
            deviceId: String,
            pin: String,
        ) = verifyResult

        override suspend fun resetPin(newPin: String) = Result.success(Unit)
    }

    private class FakeBiometricRepository : BiometricRepository {
        override suspend fun register(
            publicKeyBase64: String,
            deviceId: String,
        ) = Result.success(Unit)

        override suspend fun getChallenge(
            uniqueId: String,
            deviceId: String,
        ) = Result.success("nonce")

        override suspend fun verify(
            uniqueId: String,
            deviceId: String,
            signatureBase64: String,
        ) = Result.success("token")

        override suspend fun revoke(deviceId: String) = Result.success(Unit)
    }
}
