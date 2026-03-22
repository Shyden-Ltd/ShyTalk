package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.PinRepository
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
class PinSetupViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var fakePinRepo: FakePinRepository
    private lateinit var appLockRepo: AppLockRepositoryImpl
    private lateinit var viewModel: PinSetupViewModel

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        fakePinRepo = FakePinRepository()
        appLockRepo = AppLockRepositoryImpl(SecureStorage())
        appLockRepo.setCredential("12345678", "dev-1", "existing-hash")
        viewModel = PinSetupViewModel(fakePinRepo, appLockRepo)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── Initial state ──────────────────────────────────────────

    @Test
    fun `initial state has default pin length of 4`() {
        assertEquals(4, viewModel.state.value.pinLength)
    }

    @Test
    fun `initial state is ChooseLength step`() {
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
    }

    @Test
    fun `initial state has no error`() {
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `initial state has empty pin input`() {
        assertEquals("", viewModel.state.value.pinInput)
    }

    @Test
    fun `initial state is not loading`() {
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `initial state is not completed`() {
        assertFalse(viewModel.state.value.completed)
    }

    @Test
    fun `initial state does not show biometric offer`() {
        assertFalse(viewModel.state.value.showBiometricOffer)
    }

    // ─── PIN length change ──────────────────────────────────────

    @Test
    fun `selectPinLength updates pin length`() {
        viewModel.selectPinLength(6)
        assertEquals(6, viewModel.state.value.pinLength)
    }

    @Test
    fun `selectPinLength moves to Enter step`() {
        viewModel.selectPinLength(6)
        assertEquals(PinSetupStep.Enter, viewModel.state.value.step)
    }

    @Test
    fun `selectPinLength clears error`() {
        // First cause an error by submitting with incomplete pin in Enter step
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.submit() // too short
        assertNotNull(viewModel.state.value.error)

        // Reset and select new length
        viewModel.reset()
        viewModel.selectPinLength(6)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `selectPinLength accepts 4`() {
        viewModel.selectPinLength(4)
        assertEquals(4, viewModel.state.value.pinLength)
        assertEquals(PinSetupStep.Enter, viewModel.state.value.step)
    }

    @Test
    fun `selectPinLength accepts 8`() {
        viewModel.selectPinLength(8)
        assertEquals(8, viewModel.state.value.pinLength)
        assertEquals(PinSetupStep.Enter, viewModel.state.value.step)
    }

    @Test
    fun `selectPinLength rejects length below 4`() {
        viewModel.selectPinLength(3)
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
        assertEquals(4, viewModel.state.value.pinLength) // unchanged from default
    }

    @Test
    fun `selectPinLength rejects length above 8`() {
        viewModel.selectPinLength(9)
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
        assertEquals(4, viewModel.state.value.pinLength) // unchanged
    }

    @Test
    fun `selectPinLength rejects zero`() {
        viewModel.selectPinLength(0)
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
    }

    @Test
    fun `selectPinLength rejects negative`() {
        viewModel.selectPinLength(-1)
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
    }

    // ─── Digit input ────────────────────────────────────────────

    @Test
    fun `onDigit appends to pinInput`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.onDigit('2')
        assertEquals("12", viewModel.state.value.pinInput)
    }

    @Test
    fun `onDigit stops at pinLength`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.onDigit('2')
        viewModel.onDigit('3')
        viewModel.onDigit('4')
        viewModel.onDigit('5') // should be ignored
        assertEquals("1234", viewModel.state.value.pinInput)
    }

    @Test
    fun `onDigit clears error`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.submit() // incomplete → error
        assertNotNull(viewModel.state.value.error)

        viewModel.onDigit('2')
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `onBackspace removes last digit`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.onDigit('2')
        viewModel.onBackspace()
        assertEquals("1", viewModel.state.value.pinInput)
    }

    @Test
    fun `onBackspace on empty input does nothing`() {
        viewModel.selectPinLength(4)
        viewModel.onBackspace()
        assertEquals("", viewModel.state.value.pinInput)
    }

    // ─── Enter → Confirm transition ─────────────────────────────

    @Test
    fun `submit with incomplete PIN shows error`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.onDigit('2')
        viewModel.submit()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res but got $error")
        assertEquals(Res.string.pin_enter_digits, error.resource)
        assertEquals(listOf(4), error.args)
    }

    @Test
    fun `submit with incomplete 6-digit PIN shows error with correct length`() {
        viewModel.selectPinLength(6)
        "123".forEach { viewModel.onDigit(it) }
        viewModel.submit()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res)
        assertEquals(listOf(6), error.args)
    }

    @Test
    fun `submit in Enter step with full PIN moves to Confirm`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit()
        assertEquals(PinSetupStep.Confirm, viewModel.state.value.step)
        assertEquals("", viewModel.state.value.pinInput) // cleared for confirm entry
        assertEquals("1234", viewModel.state.value.firstPin)
    }

    @Test
    fun `submit in Enter step clears error`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit()
        assertNull(viewModel.state.value.error)
    }

    // ─── PIN mismatch ───────────────────────────────────────────

    @Test
    fun `submit in Confirm with mismatched PIN resets to Enter`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit() // → Confirm
        "5678".forEach { viewModel.onDigit(it) }
        viewModel.submit() // mismatch

        assertEquals(PinSetupStep.Enter, viewModel.state.value.step)
    }

    @Test
    fun `submit in Confirm with mismatched PIN shows mismatch error`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit() // → Confirm
        "5678".forEach { viewModel.onDigit(it) }
        viewModel.submit() // mismatch

        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res for mismatch but got $error")
        assertEquals(Res.string.pin_mismatch, error.resource)
    }

    @Test
    fun `submit in Confirm with mismatched PIN clears pinInput and firstPin`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit() // → Confirm
        "5678".forEach { viewModel.onDigit(it) }
        viewModel.submit() // mismatch

        assertEquals("", viewModel.state.value.pinInput)
        assertEquals("", viewModel.state.value.firstPin)
    }

    // ─── Successful setup ───────────────────────────────────────

    @Test
    fun `submit in Confirm with matching PIN calls setupPin`() =
        runTest {
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit() // → Confirm
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit() // → save
            advanceUntilIdle()

            assertEquals("1234", fakePinRepo.lastSetupPin)
        }

    @Test
    fun `successful setup shows biometric offer`() =
        runTest {
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit() // → Confirm
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit() // → save
            advanceUntilIdle()

            assertTrue(viewModel.state.value.showBiometricOffer)
            assertFalse(viewModel.state.value.isLoading)
        }

    @Test
    fun `successful setup stores credential in appLockRepo`() =
        runTest {
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            assertEquals("\$2b\$10\$fakebcrypthashfortest", appLockRepo.localPinHash)
        }

    @Test
    fun `successful setup with 6-digit PIN`() =
        runTest {
            viewModel.selectPinLength(6)
            "123456".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "123456".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            assertEquals("123456", fakePinRepo.lastSetupPin)
            assertTrue(viewModel.state.value.showBiometricOffer)
        }

    @Test
    fun `successful setup with 8-digit PIN`() =
        runTest {
            viewModel.selectPinLength(8)
            "12345678".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "12345678".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            assertEquals("12345678", fakePinRepo.lastSetupPin)
            assertTrue(viewModel.state.value.showBiometricOffer)
        }

    // ─── Device not registered ──────────────────────────────────

    @Test
    fun `device not registered error when uniqueId is null`() =
        runTest {
            appLockRepo.clearCredential()
            viewModel = PinSetupViewModel(fakePinRepo, appLockRepo)

            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "Expected UiText.Res for device not registered but got $error")
            assertEquals(Res.string.pin_device_not_registered, error.resource)
            assertFalse(viewModel.state.value.showBiometricOffer)
            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Setup failure ──────────────────────────────────────────

    @Test
    fun `setupPin failure shows error`() =
        runTest {
            fakePinRepo.setupShouldFail = true
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain, "Expected UiText.Plain for exception with message but got $error")
            assertEquals("Setup failed", error.text)
            assertFalse(viewModel.state.value.showBiometricOffer)
        }

    @Test
    fun `setupPin failure with null message shows resource error`() =
        runTest {
            fakePinRepo.setupFailMessage = null
            fakePinRepo.setupShouldFail = true
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "Expected UiText.Res for null-message exception but got $error")
            assertEquals(Res.string.pin_setup_failed, error.resource)
        }

    @Test
    fun `setupPin failure stops loading`() =
        runTest {
            fakePinRepo.setupShouldFail = true
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Biometric offer ────────────────────────────────────────

    @Test
    fun `onBiometricAccepted enables biometric and completes`() =
        runTest {
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            viewModel.onBiometricAccepted()
            assertTrue(appLockRepo.isBiometricEnabled)
            assertTrue(viewModel.state.value.completed)
            assertFalse(viewModel.state.value.showBiometricOffer)
        }

    @Test
    fun `onBiometricDeclined disables biometric and completes`() =
        runTest {
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit()
            advanceUntilIdle()

            viewModel.onBiometricDeclined()
            assertFalse(appLockRepo.isBiometricEnabled)
            assertTrue(viewModel.state.value.completed)
            assertFalse(viewModel.state.value.showBiometricOffer)
        }

    // ─── Reset ──────────────────────────────────────────────────

    @Test
    fun `reset returns to initial state`() {
        viewModel.selectPinLength(6)
        viewModel.onDigit('1')
        viewModel.reset()
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
        assertEquals(4, viewModel.state.value.pinLength)
        assertEquals("", viewModel.state.value.pinInput)
        assertEquals("", viewModel.state.value.firstPin)
        assertNull(viewModel.state.value.error)
        assertFalse(viewModel.state.value.completed)
    }

    // ─── Fake ───────────────────────────────────────

    private class FakePinRepository : PinRepository {
        var lastSetupPin: String? = null
        var setupShouldFail = false
        var setupFailMessage: String? = "Setup failed"

        override suspend fun setupPin(pin: String): Result<String> {
            if (setupShouldFail) return Result.failure(Exception(setupFailMessage))
            lastSetupPin = pin
            return Result.success("\$2b\$10\$fakebcrypthashfortest")
        }

        override suspend fun verifyPin(
            uniqueId: String,
            deviceId: String,
            pin: String,
        ) = Result.success(
            com.shyden.shytalk.data.repository
                .PinVerifyResult(customToken = "token"),
        )

        override suspend fun resetPin(newPin: String) = Result.success(Unit)
    }
}
