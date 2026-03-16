package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.PinRepository
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

    @Test
    fun `initial state is ChooseLength`() {
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
    }

    @Test
    fun `selectPinLength moves to Enter step`() {
        viewModel.selectPinLength(6)
        assertEquals(PinSetupStep.Enter, viewModel.state.value.step)
        assertEquals(6, viewModel.state.value.pinLength)
    }

    @Test
    fun `selectPinLength rejects length below 4`() {
        viewModel.selectPinLength(3)
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
    }

    @Test
    fun `selectPinLength rejects length above 8`() {
        viewModel.selectPinLength(9)
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
    }

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
    fun `onBackspace removes last digit`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.onDigit('2')
        viewModel.onBackspace()
        assertEquals("1", viewModel.state.value.pinInput)
    }

    @Test
    fun `submit with incomplete PIN shows error`() {
        viewModel.selectPinLength(4)
        viewModel.onDigit('1')
        viewModel.onDigit('2')
        viewModel.submit()
        assertEquals("Enter 4 digits", viewModel.state.value.error)
    }

    @Test
    fun `submit in Enter step moves to Confirm`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit()
        assertEquals(PinSetupStep.Confirm, viewModel.state.value.step)
        assertEquals("", viewModel.state.value.pinInput) // cleared for confirm entry
        assertEquals("1234", viewModel.state.value.firstPin)
    }

    @Test
    fun `submit in Confirm with matching PIN calls setupPin`() =
        runTest {
            viewModel.selectPinLength(4)
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit() // -> Confirm
            "1234".forEach { viewModel.onDigit(it) }
            viewModel.submit() // -> save
            advanceUntilIdle()

            assertEquals("1234", fakePinRepo.lastSetupPin)
            assertTrue(viewModel.state.value.showBiometricOffer)
        }

    @Test
    fun `submit in Confirm with mismatched PIN resets to Enter`() {
        viewModel.selectPinLength(4)
        "1234".forEach { viewModel.onDigit(it) }
        viewModel.submit() // -> Confirm
        "5678".forEach { viewModel.onDigit(it) }
        viewModel.submit() // mismatch

        assertEquals(PinSetupStep.Enter, viewModel.state.value.step)
        assertEquals("PINs don't match. Try again.", viewModel.state.value.error)
        assertEquals("", viewModel.state.value.pinInput)
    }

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
        }

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

            assertEquals("Setup failed", viewModel.state.value.error)
            assertFalse(viewModel.state.value.showBiometricOffer)
        }

    @Test
    fun `reset returns to initial state`() {
        viewModel.selectPinLength(6)
        viewModel.onDigit('1')
        viewModel.reset()
        assertEquals(PinSetupStep.ChooseLength, viewModel.state.value.step)
        assertEquals("", viewModel.state.value.pinInput)
    }

    // ─── Fake ───────────────────────────────────

    private class FakePinRepository : PinRepository {
        var lastSetupPin: String? = null
        var setupShouldFail = false

        override suspend fun setupPin(pin: String): Result<String> {
            if (setupShouldFail) return Result.failure(Exception("Setup failed"))
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
