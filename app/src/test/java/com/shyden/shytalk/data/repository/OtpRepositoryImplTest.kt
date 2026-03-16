package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OtpRepositoryImplTest {

    private lateinit var apiClient: WorkerApiClient
    private lateinit var repo: OtpRepositoryImpl

    @Before
    fun setup() {
        apiClient = mockk(relaxed = true)
        repo = OtpRepositoryImpl(apiClient)
    }

    // ─── sendOtp ──────────────────────────────────────────────────────

    @Test
    fun `sendOtp returns success when API succeeds`() = runTest {
        coEvery { apiClient.postPublic("/api/auth/otp/send", any()) } returns JSONObject()

        val result = repo.sendOtp("user@example.com")

        assertTrue(result.isSuccess)
    }

    @Test
    fun `sendOtp returns failure when API throws`() = runTest {
        coEvery { apiClient.postPublic("/api/auth/otp/send", any()) } throws
            ApiException(429, "Too many requests")

        val result = repo.sendOtp("user@example.com")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is ApiException)
        assertEquals("Too many requests", result.exceptionOrNull()!!.message)
    }

    @Test
    fun `sendOtp returns failure on network error`() = runTest {
        coEvery { apiClient.postPublic("/api/auth/otp/send", any()) } throws
            RuntimeException("Network error")

        val result = repo.sendOtp("user@example.com")

        assertTrue(result.isFailure)
        assertEquals("Network error", result.exceptionOrNull()!!.message)
    }

    @Test
    fun `sendOtp calls correct endpoint with email in body`() = runTest {
        var capturedPath: String? = null
        var capturedBody: JSONObject? = null
        coEvery { apiClient.postPublic(any(), any()) } answers {
            capturedPath = firstArg()
            capturedBody = secondArg()
            JSONObject()
        }

        repo.sendOtp("alice@gmail.com")

        assertEquals("/api/auth/otp/send", capturedPath)
        assertEquals("alice@gmail.com", capturedBody?.getString("email"))
    }

    // ─── verifyOtp ────────────────────────────────────────────────────

    @Test
    fun `verifyOtp returns customToken on success`() = runTest {
        val response = JSONObject().apply {
            put("customToken", "firebase-custom-token-123")
        }
        coEvery { apiClient.postPublic("/api/auth/otp/verify", any()) } returns response

        val result = repo.verifyOtp("user@example.com", "123456")

        assertTrue(result.isSuccess)
        assertEquals("firebase-custom-token-123", result.getOrThrow())
    }

    @Test
    fun `verifyOtp returns failure when API throws`() = runTest {
        coEvery { apiClient.postPublic("/api/auth/otp/verify", any()) } throws
            ApiException(400, "Invalid or expired OTP")

        val result = repo.verifyOtp("user@example.com", "000000")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is ApiException)
        assertEquals("Invalid or expired OTP", result.exceptionOrNull()!!.message)
    }

    @Test
    fun `verifyOtp returns failure on network error`() = runTest {
        coEvery { apiClient.postPublic("/api/auth/otp/verify", any()) } throws
            RuntimeException("Connection refused")

        val result = repo.verifyOtp("user@example.com", "123456")

        assertTrue(result.isFailure)
        assertEquals("Connection refused", result.exceptionOrNull()!!.message)
    }

    @Test
    fun `verifyOtp returns failure when response missing customToken`() = runTest {
        val response = JSONObject() // no "customToken" key
        coEvery { apiClient.postPublic("/api/auth/otp/verify", any()) } returns response

        val result = repo.verifyOtp("user@example.com", "123456")

        assertTrue(result.isFailure)
    }

    @Test
    fun `verifyOtp calls correct endpoint with email and code in body`() = runTest {
        val response = JSONObject().apply { put("customToken", "token") }
        var capturedPath: String? = null
        var capturedBody: JSONObject? = null
        coEvery { apiClient.postPublic(any(), any()) } answers {
            capturedPath = firstArg()
            capturedBody = secondArg()
            response
        }

        repo.verifyOtp("alice@gmail.com", "654321")

        assertEquals("/api/auth/otp/verify", capturedPath)
        assertEquals("alice@gmail.com", capturedBody?.getString("email"))
        assertEquals("654321", capturedBody?.getString("code"))
    }
}
