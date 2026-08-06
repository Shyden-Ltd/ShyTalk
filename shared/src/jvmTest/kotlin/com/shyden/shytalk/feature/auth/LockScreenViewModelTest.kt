package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.BiometricResult
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PinVerifyResult
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class LockScreenViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var fakePinRepo: FakePinRepository
    private lateinit var fakeBioRepo: FakeBiometricRepository
    private lateinit var fakeBioAuth: BiometricAuth
    private lateinit var fakeCrypto: CryptoKeyPair
    private lateinit var storage: SecureStorage
    private lateinit var appLockRepo: AppLockRepositoryImpl
    private lateinit var fakeAuthRepo: FakeAuthRepository
    private lateinit var viewModel: LockScreenViewModel

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        fakePinRepo = FakePinRepository()
        fakeBioRepo = FakeBiometricRepository()
        fakeBioAuth = BiometricAuth() // JVM stub — isAvailable() returns false
        fakeCrypto = CryptoKeyPair() // JVM stub
        storage = SecureStorage()
        appLockRepo = AppLockRepositoryImpl(storage)
        appLockRepo.setCredential("12345678", "dev-1", "\$2b\$10\$hash")
        fakeAuthRepo = FakeAuthRepository()
        viewModel = LockScreenViewModel(fakePinRepo, fakeBioRepo, fakeBioAuth, fakeCrypto, appLockRepo, fakeAuthRepo)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── Initial state ───────────────────────────────────────────

    @Test
    fun `initial state has unlocked false and loading false`() {
        val state = viewModel.state.value
        assertFalse(state.unlocked)
        assertFalse(state.isLoading)
        assertEquals("", state.pinInput)
        assertNull(state.error)
        assertFalse(state.isLocked)
        assertEquals(5, state.attemptsRemaining)
    }

    // ─── PIN input ──────────────────────────────────────────────

    @Test
    fun `onPinDigit appends digit to input`() {
        viewModel.onPinDigit('1')
        viewModel.onPinDigit('2')
        viewModel.onPinDigit('3')
        assertEquals("123", viewModel.state.value.pinInput)
    }

    @Test
    fun `onPinDigit clears previous error`() {
        // Force an error via short PIN submit
        viewModel.onPinDigit('1')
        viewModel.submitPin()
        assertNotNull(viewModel.state.value.error)

        viewModel.onPinDigit('2')
        assertNull(viewModel.state.value.error)
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

    // ─── PIN too short ──────────────────────────────────────────

    @Test
    fun `submitPin with short PIN shows error`() {
        viewModel.onPinDigit('1')
        viewModel.onPinDigit('2')
        viewModel.submitPin()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res but got $error")
        assertEquals(Res.string.pin_too_short, error.resource)
    }

    @Test
    fun `submitPin with 3 digits shows error`() {
        "123".forEach { viewModel.onPinDigit(it) }
        viewModel.submitPin()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res)
    }

    @Test
    fun `submitPin with empty input shows error`() {
        viewModel.submitPin()
        assertNotNull(viewModel.state.value.error)
    }

    // ─── Session expired (no stored uniqueId/deviceId) ──────────

    @Test
    fun `submitPin with no stored uniqueId shows session expired error`() {
        appLockRepo.clearCredential()
        viewModel = LockScreenViewModel(fakePinRepo, fakeBioRepo, fakeBioAuth, fakeCrypto, appLockRepo, fakeAuthRepo)
        "1234".forEach { viewModel.onPinDigit(it) }
        viewModel.submitPin()

        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res but got $error")
        assertEquals(Res.string.pin_session_expired, error.resource)
        assertTrue(viewModel.state.value.requiresReauth)
    }

    @Test
    fun `submitPin with cleared credential does not call verifyPin`() =
        runTest {
            appLockRepo.clearCredential()
            viewModel = LockScreenViewModel(fakePinRepo, fakeBioRepo, fakeBioAuth, fakeCrypto, appLockRepo, fakeAuthRepo)
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertFalse(viewModel.state.value.unlocked)
            assertFalse(viewModel.state.value.isLoading)
            assertEquals(0, fakePinRepo.verifyCallCount)
        }

    // ─── Correct PIN → unlocked ─────────────────────────────────

    @Test
    fun `submitPin success sets unlocked true`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-abc"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.unlocked)
            assertFalse(viewModel.state.value.isLoading)
            assertEquals("", viewModel.state.value.pinInput) // cleared
        }

    @Test
    fun `submitPin success clears any previous error`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-abc"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertNull(viewModel.state.value.error)
        }

    // ─── Wrong PIN → decrements attempts ────────────────────────

    @Test
    fun `submitPin wrong PIN decrements attempts remaining`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(attemptsRemaining = 3))
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals(3, viewModel.state.value.attemptsRemaining)
            assertFalse(viewModel.state.value.unlocked)
        }

    @Test
    fun `submitPin wrong PIN shows error with attempts remaining`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(attemptsRemaining = 3))
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "Expected UiText.Res but got $error")
            assertEquals(Res.string.pin_wrong_attempts, error.resource)
            assertEquals(listOf(3), error.args)
        }

    @Test
    fun `submitPin wrong PIN clears pinInput`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(attemptsRemaining = 2))
            "0000".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals("", viewModel.state.value.pinInput)
        }

    @Test
    fun `submitPin wrong PIN with 1 attempt remaining`() =
        runTest {
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(attemptsRemaining = 1))
            "9999".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals(1, viewModel.state.value.attemptsRemaining)
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res)
            assertEquals(listOf(1), error.args)
        }

    // ─── Account locked after max attempts ──────────────────────

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
    fun `submitPin lockout clears pin input and error`() =
        runTest {
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
            assertEquals("", viewModel.state.value.pinInput)
            assertNull(viewModel.state.value.error)
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
    fun `submitPin lockout without onLockout callback does not throw`() =
        runTest {
            viewModel.onLockout = null
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
            assertTrue(viewModel.state.value.isLocked)
        }

    // ─── Network/API failure ────────────────────────────────────

    @Test
    fun `submitPin network failure shows plain error`() =
        runTest {
            fakePinRepo.verifyResult = Result.failure(Exception("Network error"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain, "Expected UiText.Plain but got $error")
            assertEquals("Network error", error.text)
            assertFalse(viewModel.state.value.unlocked)
        }

    @Test
    fun `submitPin failure with null message shows resource error`() =
        runTest {
            fakePinRepo.verifyResult = Result.failure(Exception())
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "Expected UiText.Res for null-message exception but got $error")
            assertEquals(Res.string.pin_verify_failed, error.resource)
        }

    @Test
    fun `submitPin failure stops loading`() =
        runTest {
            fakePinRepo.verifyResult = Result.failure(Exception("Error"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Error state is UiText (not null) ───────────────────────

    @Test
    fun `error state is UiText Res for pin too short`() {
        viewModel.onPinDigit('1')
        viewModel.submitPin()
        val error = viewModel.state.value.error
        assertNotNull(error, "Error should not be null for short PIN")
        assertTrue(error is UiText.Res, "Short PIN error should be UiText.Res, got ${error::class.simpleName}")
    }

    @Test
    fun `error state is UiText Plain for API exception with message`() =
        runTest {
            fakePinRepo.verifyResult = Result.failure(Exception("Server timeout"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error, "Error should not be null for API failure")
            assertTrue(error is UiText.Plain, "API exception error should be UiText.Plain, got ${error::class.simpleName}")
        }

    // ─── Biometric ──────────────────────────────────────────────

    @Test
    fun `biometricAvailable is false on JVM`() {
        assertFalse(viewModel.state.value.biometricAvailable)
    }

    // ─── Fakes ──────────────────────────────────────────────────

    // ─── SHY-0187: unlock must restore a dead Firebase session ───

    @Test
    fun `correct PIN with a dead session restores it via the custom token before unlocking`() =
        runTest {
            fakeAuthRepo.fakeAuthenticated = false
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-restore"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals(listOf("token-restore"), fakeAuthRepo.customTokenSignIns)
            assertTrue(viewModel.state.value.unlocked)
            assertFalse(viewModel.state.value.requiresReauth)
        }

    @Test
    fun `correct PIN with a dead session and a failing restore routes to reauth not unlock`() =
        runTest {
            fakeAuthRepo.fakeAuthenticated = false
            fakeAuthRepo.customTokenResult = Resource.Error("restore failed")
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-dead"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals(listOf("token-dead"), fakeAuthRepo.customTokenSignIns)
            assertFalse(viewModel.state.value.unlocked)
            assertTrue(viewModel.state.value.requiresReauth)
        }

    @Test
    fun `correct PIN with a live session does not re-sign-in`() =
        runTest {
            fakeAuthRepo.fakeAuthenticated = true
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-live"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertEquals(emptyList(), fakeAuthRepo.customTokenSignIns)
            assertTrue(viewModel.state.value.unlocked)
        }

    // ─── SHY-0187: unlock resets the lock-timeout clock ──────────

    @Test
    fun `successful unlock refreshes the lock timestamp so the next resume does not immediately re-lock`() =
        runTest {
            appLockRepo.setAppLockEnabled(true)
            appLockRepo.setLockTimeoutMinutes(1)
            storage.putLong("lastActiveTimestamp", 1L) // ancient → lock due
            assertTrue(appLockRepo.isLockRequired(), "precondition: the lock must be due before unlock")
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-abc"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.unlocked)
            assertFalse(
                appLockRepo.isLockRequired(),
                "unlock must refresh the timestamp — a stale one re-locks on the very next resume/rotation",
            )
        }

    @Test
    fun `failed restore does not refresh the lock timestamp`() =
        runTest {
            appLockRepo.setAppLockEnabled(true)
            appLockRepo.setLockTimeoutMinutes(1)
            storage.putLong("lastActiveTimestamp", 1L)
            fakeAuthRepo.fakeAuthenticated = false
            fakeAuthRepo.customTokenResult = Resource.Error("restore failed")
            fakePinRepo.verifyResult = Result.success(PinVerifyResult(customToken = "token-dead"))
            "1234".forEach { viewModel.onPinDigit(it) }
            viewModel.submitPin()
            advanceUntilIdle()
            assertTrue(appLockRepo.isLockRequired(), "a failed unlock must leave the lock due (fail-closed)")
        }

    // ─── SHY-0187 R2: the BIOMETRIC path must thread the token too ───
    // The JVM BiometricAuth/CryptoKeyPair stubs default to unavailable/
    // null-sign; arming their test seams lets the REAL flow execute:
    // authenticate → challenge → sign → verify → restoreSessionAndUnlock.

    /** Arms the platform-stub seams so the real biometric flow can run. */
    private fun armBiometricSeams() {
        fakeBioAuth.availableForTest = true
        fakeBioAuth.authenticateResultForTest = BiometricResult.Success
        fakeCrypto.signResultForTest = byteArrayOf(1, 2, 3) // Base64 "AQID"
    }

    @Test
    fun `biometric success with a dead session restores it via the verify token before unlocking`() =
        runTest {
            armBiometricSeams()
            fakeAuthRepo.fakeAuthenticated = false
            fakeBioRepo.verifyResult = Result.success("bio-token")
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            assertEquals(listOf("AQID"), fakeBioRepo.verifiedSignatures, "the signed nonce must reach verify as base64")
            assertEquals(listOf("bio-token"), fakeAuthRepo.customTokenSignIns)
            assertTrue(viewModel.state.value.unlocked)
            assertFalse(viewModel.state.value.requiresReauth)
        }

    @Test
    fun `biometric success with a dead session and a failing restore routes to reauth not unlock`() =
        runTest {
            armBiometricSeams()
            fakeAuthRepo.fakeAuthenticated = false
            fakeAuthRepo.customTokenResult = Resource.Error("restore failed")
            fakeBioRepo.verifyResult = Result.success("bio-dead")
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            assertEquals(listOf("bio-dead"), fakeAuthRepo.customTokenSignIns)
            assertFalse(viewModel.state.value.unlocked)
            assertTrue(viewModel.state.value.requiresReauth)
        }

    @Test
    fun `biometric success with a live session does not re-sign-in`() =
        runTest {
            armBiometricSeams()
            fakeAuthRepo.fakeAuthenticated = true
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            assertEquals(emptyList(), fakeAuthRepo.customTokenSignIns)
            assertTrue(viewModel.state.value.unlocked)
        }

    @Test
    fun `successful biometric unlock refreshes the lock timestamp`() =
        runTest {
            armBiometricSeams()
            appLockRepo.setAppLockEnabled(true)
            appLockRepo.setLockTimeoutMinutes(1)
            storage.putLong("lastActiveTimestamp", 1L)
            assertTrue(appLockRepo.isLockRequired(), "precondition: the lock must be due before unlock")
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            assertTrue(viewModel.state.value.unlocked)
            assertFalse(appLockRepo.isLockRequired(), "biometric unlock must refresh the timestamp like the PIN path")
        }

    @Test
    fun `biometric verify failure surfaces the error and never unlocks`() =
        runTest {
            armBiometricSeams()
            fakeAuthRepo.fakeAuthenticated = false
            fakeBioRepo.verifyResult = Result.failure(Exception("verify rejected"))
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain, "expected the server message, got $error")
            assertEquals("verify rejected", error.text)
            assertFalse(viewModel.state.value.unlocked)
            assertEquals(emptyList(), fakeAuthRepo.customTokenSignIns, "a failed verify must never mint a session")
        }

    @Test
    fun `biometric challenge failure surfaces the error and never unlocks`() =
        runTest {
            armBiometricSeams()
            fakeBioRepo.challengeResult = Result.failure(Exception("challenge down"))
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain)
            assertEquals("challenge down", error.text)
            assertFalse(viewModel.state.value.unlocked)
            assertEquals(emptyList(), fakeBioRepo.verifiedSignatures, "no signature may be sent without a challenge")
        }

    @Test
    fun `null keystore signature surfaces sign-failed and never unlocks`() =
        runTest {
            armBiometricSeams()
            fakeCrypto.signResultForTest = null // keystore failure mode
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "expected the sign-failed resource, got $error")
            assertEquals(Res.string.biometric_sign_failed, error.resource)
            assertFalse(viewModel.state.value.unlocked)
            assertEquals(emptyList(), fakeBioRepo.verifiedSignatures)
        }

    @Test
    fun `biometric fallback stops loading without error or unlock`() =
        runTest {
            armBiometricSeams()
            fakeBioAuth.authenticateResultForTest = BiometricResult.Fallback
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            assertFalse(viewModel.state.value.isLoading)
            assertNull(viewModel.state.value.error)
            assertFalse(viewModel.state.value.unlocked)
        }

    @Test
    fun `biometric hardware error surfaces its message and never unlocks`() =
        runTest {
            armBiometricSeams()
            fakeBioAuth.authenticateResultForTest = BiometricResult.Error("sensor unavailable")
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain)
            assertEquals("sensor unavailable", error.text)
            assertFalse(viewModel.state.value.unlocked)
        }

    @Test
    fun `biometric success with missing stored credential routes to reauth`() =
        runTest {
            armBiometricSeams()
            appLockRepo.clearCredential()
            viewModel.authenticateWithBiometric("Unlock", "Confirm identity")
            advanceUntilIdle()
            assertTrue(viewModel.state.value.requiresReauth)
            assertFalse(viewModel.state.value.unlocked)
            assertEquals(emptyList(), fakeBioRepo.verifiedSignatures, "no challenge round-trip without stored ids")
        }

    private class FakeAuthRepository : AuthRepository {
        var fakeAuthenticated: Boolean = true
        var customTokenResult: Resource<String> = Resource.Success("uid-1")
        val customTokenSignIns = mutableListOf<String>()

        override val currentUserId: String? get() = if (fakeAuthenticated) "user-1" else null
        override val isAuthenticated: Boolean get() = fakeAuthenticated
        override val currentUserEmail: String? = null
        override val currentFirebaseUid: String? get() = if (fakeAuthenticated) "fb-uid-1" else null
        override var resolvedUniqueId: String? = null
        override var resolvedDisplayName: String? = null
        override var resolvedCohort: String? = null

        override fun getProviderInfo(): Pair<String, String>? = null

        override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> = error("not used")

        override suspend fun signInWithAppleIdToken(
            idToken: String,
            rawNonce: String,
        ): Resource<String> = error("not used")

        override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> = error("not used")

        override suspend fun sendSignInLink(email: String): Resource<Unit> = error("not used")

        override suspend fun signInWithEmailLink(
            email: String,
            link: String,
        ): Resource<String> = error("not used")

        override suspend fun signInWithCustomToken(token: String): Resource<String> {
            customTokenSignIns += token
            if (customTokenResult is Resource.Success) fakeAuthenticated = true
            return customTokenResult
        }

        override suspend fun signOut() {
            fakeAuthenticated = false
        }

        override suspend fun refreshIdToken(): Resource<Unit> = Resource.Success(Unit)
    }

    private class FakePinRepository : PinRepository {
        var verifyResult: Result<PinVerifyResult> = Result.success(PinVerifyResult(customToken = "token"))
        var verifyCallCount = 0

        override suspend fun setupPin(pin: String): Result<String> = Result.success("\$2b\$10\$hash")

        override suspend fun verifyPin(
            uniqueId: String,
            deviceId: String,
            pin: String,
        ): Result<PinVerifyResult> {
            verifyCallCount++
            return verifyResult
        }
    }

    private class FakeBiometricRepository : BiometricRepository {
        var challengeResult: Result<String> = Result.success("nonce")
        var verifyResult: Result<String> = Result.success("token")
        val verifiedSignatures = mutableListOf<String>()

        override suspend fun register(
            publicKeyBase64: String,
            deviceId: String,
        ) = Result.success(Unit)

        override suspend fun getChallenge(
            uniqueId: String,
            deviceId: String,
        ) = challengeResult

        override suspend fun verify(
            uniqueId: String,
            deviceId: String,
            signatureBase64: String,
        ): Result<String> {
            verifiedSignatures += signatureBase64
            return verifyResult
        }

        override suspend fun revoke(deviceId: String) = Result.success(Unit)
    }
}
