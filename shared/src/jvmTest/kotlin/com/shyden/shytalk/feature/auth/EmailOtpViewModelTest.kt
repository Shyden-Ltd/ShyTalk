package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.data.repository.OtpRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class EmailOtpViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var fakeOtpRepo: FakeOtpRepository
    private lateinit var viewModel: EmailOtpViewModel

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        fakeOtpRepo = FakeOtpRepository()
        viewModel = EmailOtpViewModel(fakeOtpRepo)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state is EnterEmail`() {
        assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
    }

    @Test
    fun `updateEmail updates state`() {
        viewModel.updateEmail("test@example.com")
        assertEquals("test@example.com", viewModel.state.value.email)
    }

    @Test
    fun `sendOtp rejects invalid email`() {
        viewModel.updateEmail("not-an-email")
        viewModel.sendOtp()
        assertEquals("Enter a valid email address", viewModel.state.value.error)
        assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
    }

    @Test
    fun `sendOtp rejects empty email`() {
        viewModel.sendOtp()
        assertEquals("Enter a valid email address", viewModel.state.value.error)
    }

    @Test
    fun `sendOtp moves to EnterCode on success`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            // Advance just enough for the API call to complete, not the full cooldown
            advanceTimeBy(100)

            assertEquals(EmailOtpStep.EnterCode, viewModel.state.value.step)
            assertTrue(viewModel.state.value.resendCooldown > 0)
        }

    @Test
    fun `sendOtp shows error on failure`() =
        runTest {
            fakeOtpRepo.sendShouldFail = true
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
            assertEquals("Send failed", viewModel.state.value.error)
        }

    @Test
    fun `sendOtp lowercases and trims email`() =
        runTest {
            viewModel.updateEmail("  User@EXAMPLE.COM  ")
            viewModel.sendOtp()
            advanceUntilIdle()

            assertEquals("user@example.com", fakeOtpRepo.lastSentEmail)
        }

    @Test
    fun `updateCode accepts up to 6 digits`() {
        viewModel.updateCode("123456")
        assertEquals("123456", viewModel.state.value.code)
    }

    @Test
    fun `updateCode rejects more than 6 digits`() {
        viewModel.updateCode("1234567")
        assertEquals("", viewModel.state.value.code) // rejected
    }

    @Test
    fun `updateCode rejects non-digits`() {
        viewModel.updateCode("12ab")
        assertEquals("", viewModel.state.value.code)
    }

    @Test
    fun `verifyOtp with short code shows error`() {
        viewModel.updateCode("123")
        viewModel.verifyOtp()
        assertEquals("Enter the 6-digit code", viewModel.state.value.error)
    }

    @Test
    fun `verifyOtp returns custom token on success`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.updateCode("482715")
            viewModel.verifyOtp()
            advanceUntilIdle()

            assertEquals("custom-token-abc", viewModel.state.value.customToken)
        }

    @Test
    fun `verifyOtp shows error on failure`() =
        runTest {
            fakeOtpRepo.verifyShouldFail = true
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.updateCode("000000")
            viewModel.verifyOtp()
            advanceUntilIdle()

            assertEquals("Invalid code", viewModel.state.value.error)
            assertEquals("", viewModel.state.value.code) // cleared
            assertNull(viewModel.state.value.customToken)
        }

    @Test
    fun `resend cooldown counts down`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100) // let sendOtp complete

            val initial = viewModel.state.value.resendCooldown
            assertTrue(initial > 0, "Expected initial cooldown > 0, got $initial")

            advanceTimeBy(5000)
            val after = viewModel.state.value.resendCooldown
            assertTrue(after < initial, "Expected cooldown to decrease from $initial, got $after")
        }

    @Test
    fun `resendOtp blocked during cooldown`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100) // let sendOtp complete
            fakeOtpRepo.sendCount = 0

            viewModel.resendOtp() // should be blocked (cooldown active)
            advanceTimeBy(100)

            assertEquals(0, fakeOtpRepo.sendCount) // not called again
        }

    @Test
    fun `goBack resets to initial state`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.goBack()
            assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
            assertEquals("", viewModel.state.value.email)
            assertEquals(0, viewModel.state.value.resendCooldown)
        }

    // ─── Fake ───────────────────────────────────

    private class FakeOtpRepository : OtpRepository {
        var lastSentEmail: String? = null
        var sendShouldFail = false
        var verifyShouldFail = false
        var sendCount = 0

        override suspend fun sendOtp(email: String): Result<Unit> {
            sendCount++
            if (sendShouldFail) return Result.failure(Exception("Send failed"))
            lastSentEmail = email
            return Result.success(Unit)
        }

        override suspend fun verifyOtp(
            email: String,
            code: String,
        ): Result<String> {
            if (verifyShouldFail) return Result.failure(Exception("Invalid code"))
            return Result.success("custom-token-abc")
        }
    }
}
