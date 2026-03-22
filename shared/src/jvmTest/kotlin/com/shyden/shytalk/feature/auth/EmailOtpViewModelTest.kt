package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.OtpRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

    // ─── Initial state ──────────────────────────────────────────

    @Test
    fun `initial state is EnterEmail`() {
        assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
    }

    @Test
    fun `initial state has empty email and code`() {
        assertEquals("", viewModel.state.value.email)
        assertEquals("", viewModel.state.value.code)
    }

    @Test
    fun `initial state has no error`() {
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `initial state is not loading`() {
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `initial state has no custom token`() {
        assertNull(viewModel.state.value.customToken)
    }

    @Test
    fun `initial state has zero cooldown`() {
        assertEquals(0, viewModel.state.value.resendCooldown)
    }

    // ─── Email input ────────────────────────────────────────────

    @Test
    fun `updateEmail updates state`() {
        viewModel.updateEmail("test@example.com")
        assertEquals("test@example.com", viewModel.state.value.email)
    }

    @Test
    fun `updateEmail clears error`() {
        viewModel.sendOtp() // triggers invalid email error
        assertNotNull(viewModel.state.value.error)

        viewModel.updateEmail("new@example.com")
        assertNull(viewModel.state.value.error)
    }

    // ─── Invalid email shows error ──────────────────────────────

    @Test
    fun `sendOtp rejects invalid email`() {
        viewModel.updateEmail("not-an-email")
        viewModel.sendOtp()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res but got $error")
        assertEquals(Res.string.email_invalid_address, error.resource)
        assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
    }

    @Test
    fun `sendOtp rejects empty email`() {
        viewModel.sendOtp()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res)
        assertEquals(Res.string.email_invalid_address, error.resource)
    }

    @Test
    fun `sendOtp rejects email without at symbol`() {
        viewModel.updateEmail("userexample.com")
        viewModel.sendOtp()
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun `sendOtp rejects email without domain`() {
        viewModel.updateEmail("user@")
        viewModel.sendOtp()
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun `sendOtp rejects email with spaces`() {
        viewModel.updateEmail("user @example.com")
        viewModel.sendOtp()
        assertNotNull(viewModel.state.value.error)
    }

    // ─── Disposable email shows error ───────────────────────────

    @Test
    fun `sendOtp rejects disposable email domain`() {
        viewModel.updateEmail("test@mailinator.com")
        viewModel.sendOtp()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res for disposable email but got $error")
        assertEquals(Res.string.email_disposable_blocked, error.resource)
    }

    @Test
    fun `sendOtp rejects guerrillamail`() {
        viewModel.updateEmail("test@guerrillamail.com")
        viewModel.sendOtp()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res)
        assertEquals(Res.string.email_disposable_blocked, error.resource)
    }

    @Test
    fun `sendOtp rejects yopmail`() {
        viewModel.updateEmail("test@yopmail.com")
        viewModel.sendOtp()
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun `sendOtp rejects tempmail`() {
        viewModel.updateEmail("test@tempmail.com")
        viewModel.sendOtp()
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun `sendOtp rejects disposable email case insensitive`() {
        viewModel.updateEmail("test@MAILINATOR.COM")
        viewModel.sendOtp()
        // Note: sendOtp lowercases the email before checking, so this triggers disposable check
        assertNotNull(viewModel.state.value.error)
    }

    // ─── Successful send → code entry state ─────────────────────

    @Test
    fun `sendOtp moves to EnterCode on success`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100) // let API call complete without full cooldown

            assertEquals(EmailOtpStep.EnterCode, viewModel.state.value.step)
        }

    @Test
    fun `sendOtp starts cooldown on success`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)

            assertTrue(viewModel.state.value.resendCooldown > 0)
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
    fun `sendOtp stores normalized email in state`() =
        runTest {
            viewModel.updateEmail("  User@EXAMPLE.COM  ")
            viewModel.sendOtp()
            advanceTimeBy(100)

            assertEquals("user@example.com", viewModel.state.value.email)
        }

    @Test
    fun `sendOtp stops loading after success`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)

            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Send failure shows error ───────────────────────────────

    @Test
    fun `sendOtp shows error on failure`() =
        runTest {
            fakeOtpRepo.sendShouldFail = true
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain, "Expected UiText.Plain for exception with message but got $error")
            assertEquals("Send failed", error.text)
        }

    @Test
    fun `sendOtp failure with null message shows resource error`() =
        runTest {
            fakeOtpRepo.sendShouldFail = true
            fakeOtpRepo.sendFailMessage = null
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "Expected UiText.Res for null-message exception but got $error")
            assertEquals(Res.string.email_send_failed, error.resource)
        }

    @Test
    fun `sendOtp failure stops loading`() =
        runTest {
            fakeOtpRepo.sendShouldFail = true
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Code input ─────────────────────────────────────────────

    @Test
    fun `updateCode accepts up to 6 digits`() {
        viewModel.updateCode("123456")
        assertEquals("123456", viewModel.state.value.code)
    }

    @Test
    fun `updateCode rejects more than 6 digits`() {
        viewModel.updateCode("1234567")
        assertEquals("", viewModel.state.value.code) // rejected, stays at initial
    }

    @Test
    fun `updateCode rejects non-digits`() {
        viewModel.updateCode("12ab")
        assertEquals("", viewModel.state.value.code)
    }

    @Test
    fun `updateCode rejects mixed alphanumeric`() {
        viewModel.updateCode("12a456")
        assertEquals("", viewModel.state.value.code)
    }

    @Test
    fun `updateCode accepts empty string`() {
        viewModel.updateCode("123")
        viewModel.updateCode("")
        assertEquals("", viewModel.state.value.code)
    }

    @Test
    fun `updateCode clears error`() =
        runTest {
            // Get to code entry step first
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)

            // Trigger code error
            viewModel.updateCode("123")
            viewModel.verifyOtp()
            assertNotNull(viewModel.state.value.error)

            // Update code should clear error
            viewModel.updateCode("4567")
            assertNull(viewModel.state.value.error)
        }

    // ─── Invalid code shows error ───────────────────────────────

    @Test
    fun `verifyOtp with short code shows error`() {
        viewModel.updateCode("123")
        viewModel.verifyOtp()
        val error = viewModel.state.value.error
        assertNotNull(error)
        assertTrue(error is UiText.Res, "Expected UiText.Res but got $error")
        assertEquals(Res.string.email_enter_code, error.resource)
    }

    @Test
    fun `verifyOtp with empty code shows error`() {
        viewModel.verifyOtp()
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun `verifyOtp with 5 digits shows error`() {
        viewModel.updateCode("12345")
        viewModel.verifyOtp()
        assertNotNull(viewModel.state.value.error)
    }

    // ─── Successful verify provides custom token ────────────────

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
    fun `verifyOtp stops loading on success`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.updateCode("482715")
            viewModel.verifyOtp()
            advanceUntilIdle()

            assertFalse(viewModel.state.value.isLoading)
        }

    @Test
    fun `verifyOtp sends correct email and code to repository`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.updateCode("482715")
            viewModel.verifyOtp()
            advanceUntilIdle()

            assertEquals("user@example.com", fakeOtpRepo.lastVerifyEmail)
            assertEquals("482715", fakeOtpRepo.lastVerifyCode)
        }

    // ─── Verify failure ─────────────────────────────────────────

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

            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Plain, "Expected UiText.Plain for verify failure but got $error")
            assertEquals("Invalid code", error.text)
            assertEquals("", viewModel.state.value.code) // cleared
            assertNull(viewModel.state.value.customToken)
        }

    @Test
    fun `verifyOtp failure with null message shows resource error`() =
        runTest {
            fakeOtpRepo.verifyShouldFail = true
            fakeOtpRepo.verifyFailMessage = null
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.updateCode("000000")
            viewModel.verifyOtp()
            advanceUntilIdle()

            val error = viewModel.state.value.error
            assertNotNull(error)
            assertTrue(error is UiText.Res, "Expected UiText.Res for null-message verify failure but got $error")
            assertEquals(Res.string.email_invalid_code, error.resource)
        }

    @Test
    fun `verifyOtp failure stops loading`() =
        runTest {
            fakeOtpRepo.verifyShouldFail = true
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.updateCode("000000")
            viewModel.verifyOtp()
            advanceUntilIdle()

            assertFalse(viewModel.state.value.isLoading)
        }

    // ─── Resend cooldown timer ──────────────────────────────────

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
    fun `resend cooldown reaches zero after 60 seconds`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)

            advanceTimeBy(60_000) // full cooldown duration
            assertEquals(0, viewModel.state.value.resendCooldown)
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
    fun `resendOtp allowed after cooldown expires`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)

            // Advance past cooldown
            advanceTimeBy(61_000)
            assertEquals(0, viewModel.state.value.resendCooldown)

            fakeOtpRepo.sendCount = 0
            viewModel.resendOtp()
            advanceTimeBy(100)

            assertEquals(1, fakeOtpRepo.sendCount)
        }

    @Test
    fun `resendOtp restarts cooldown`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)

            // Advance past cooldown
            advanceTimeBy(61_000)

            viewModel.resendOtp()
            advanceTimeBy(100)

            assertTrue(viewModel.state.value.resendCooldown > 0)
        }

    // ─── goBack ─────────────────────────────────────────────────

    @Test
    fun `goBack resets to initial state`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceUntilIdle()

            viewModel.goBack()
            assertEquals(EmailOtpStep.EnterEmail, viewModel.state.value.step)
            assertEquals("", viewModel.state.value.email)
            assertEquals("", viewModel.state.value.code)
            assertEquals(0, viewModel.state.value.resendCooldown)
            assertNull(viewModel.state.value.error)
            assertNull(viewModel.state.value.customToken)
        }

    @Test
    fun `goBack cancels cooldown`() =
        runTest {
            viewModel.updateEmail("user@example.com")
            viewModel.sendOtp()
            advanceTimeBy(100)
            assertTrue(viewModel.state.value.resendCooldown > 0)

            viewModel.goBack()
            assertEquals(0, viewModel.state.value.resendCooldown)
        }

    // ─── Fake ───────────────────────────────────

    private class FakeOtpRepository : OtpRepository {
        var lastSentEmail: String? = null
        var lastVerifyEmail: String? = null
        var lastVerifyCode: String? = null
        var sendShouldFail = false
        var sendFailMessage: String? = "Send failed"
        var verifyShouldFail = false
        var verifyFailMessage: String? = "Invalid code"
        var sendCount = 0

        override suspend fun sendOtp(email: String): Result<Unit> {
            sendCount++
            if (sendShouldFail) return Result.failure(Exception(sendFailMessage))
            lastSentEmail = email
            return Result.success(Unit)
        }

        override suspend fun verifyOtp(
            email: String,
            code: String,
        ): Result<String> {
            lastVerifyEmail = email
            lastVerifyCode = code
            if (verifyShouldFail) return Result.failure(Exception(verifyFailMessage))
            return Result.success("custom-token-abc")
        }
    }
}
