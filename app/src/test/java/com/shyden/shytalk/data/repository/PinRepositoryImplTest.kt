package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PinRepositoryImplTest {
    private lateinit var apiClient: WorkerApiClient
    private lateinit var repo: PinRepositoryImpl

    @Before
    fun setup() {
        apiClient = mockk(relaxed = true)
        repo = PinRepositoryImpl(apiClient)
    }

    // ===== setupPin =====

    @Test
    fun `setupPin returns pinHash on success`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("pinHash", "\$2b\$10\$hashedvalue")
                }
            coEvery { apiClient.post("/api/auth/pin/setup", any()) } returns response

            val result = repo.setupPin("123456")

            assertTrue(result.isSuccess)
            assertEquals("\$2b\$10\$hashedvalue", result.getOrThrow())
        }

    @Test
    fun `setupPin sends correct endpoint and payload`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { apiClient.post("/api/auth/pin/setup", capture(bodySlot)) } returns
                JSONObject().apply {
                    put("pinHash", "hash")
                }

            repo.setupPin("987654")

            coVerify { apiClient.post("/api/auth/pin/setup", any()) }
            assertEquals("987654", bodySlot.captured.getString("pin"))
        }

    @Test
    fun `setupPin returns failure on network error`() =
        runTest {
            coEvery { apiClient.post("/api/auth/pin/setup", any()) } throws RuntimeException("Network error")

            val result = repo.setupPin("123456")

            assertTrue(result.isFailure)
            assertEquals("Network error", result.exceptionOrNull()?.message)
        }

    @Test
    fun `setupPin returns failure on API error`() =
        runTest {
            coEvery { apiClient.post("/api/auth/pin/setup", any()) } throws ApiException(500, "Internal server error")

            val result = repo.setupPin("123456")

            assertTrue(result.isFailure)
            assertTrue(result.exceptionOrNull() is ApiException)
            assertEquals(500, (result.exceptionOrNull() as ApiException).statusCode)
        }

    // ===== verifyPin =====

    @Test
    fun `verifyPin returns customToken on success`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("customToken", "firebase-custom-token-abc")
                }
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } returns response

            val result = repo.verifyPin("10000001", "device-123", "123456")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertEquals("firebase-custom-token-abc", pinResult.customToken)
            assertFalse(pinResult.locked)
            assertNull(pinResult.lockedUntil)
            assertFalse(pinResult.requiresReauth)
        }

    @Test
    fun `verifyPin sends correct endpoint and payload`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { apiClient.postPublic("/api/auth/pin/verify", capture(bodySlot)) } returns
                JSONObject().apply {
                    put("customToken", "token")
                }

            repo.verifyPin("10000005", "device-xyz", "000000")

            coVerify { apiClient.postPublic("/api/auth/pin/verify", any()) }
            val captured = bodySlot.captured
            assertEquals("10000005", captured.getString("uniqueId"))
            assertEquals("device-xyz", captured.getString("deviceId"))
            assertEquals("000000", captured.getString("pin"))
        }

    @Test
    fun `verifyPin returns attemptsRemaining on 401 wrong PIN`() =
        runTest {
            val errorBody =
                JSONObject().apply {
                    put("attemptsRemaining", 3)
                }
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(401, errorBody.toString())

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertNull(pinResult.customToken)
            assertEquals(3, pinResult.attemptsRemaining)
            assertFalse(pinResult.locked)
        }

    @Test
    fun `verifyPin returns 0 attemptsRemaining when 401 body is not valid JSON`() =
        runTest {
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(401, "not-json")

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertNull(pinResult.customToken)
            assertEquals(0, pinResult.attemptsRemaining)
        }

    @Test
    fun `verifyPin returns 0 attemptsRemaining when 401 message is null`() =
        runTest {
            // ApiException with null-like message — the code handles e.message ?: "{}"
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(401, "{}")

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertNull(pinResult.customToken)
            // optInt("attemptsRemaining", 0) returns 0 when key is absent
            assertEquals(0, pinResult.attemptsRemaining)
        }

    @Test
    fun `verifyPin returns lockout info on 423`() =
        runTest {
            val errorBody =
                JSONObject().apply {
                    put("lockedUntil", 1710600000000L)
                    put("requiresReauth", true)
                }
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(423, errorBody.toString())

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertNull(pinResult.customToken)
            assertTrue(pinResult.locked)
            assertEquals(1710600000000L, pinResult.lockedUntil)
            assertTrue(pinResult.requiresReauth)
            assertEquals(0, pinResult.attemptsRemaining)
        }

    @Test
    fun `verifyPin 423 defaults requiresReauth to true when missing from body`() =
        runTest {
            val errorBody =
                JSONObject().apply {
                    put("lockedUntil", 1710600000000L)
                    // requiresReauth intentionally omitted
                }
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(423, errorBody.toString())

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertTrue(pinResult.locked)
            assertTrue(pinResult.requiresReauth) // defaults to true (fail-secure)
        }

    @Test
    fun `verifyPin 423 with requiresReauth false`() =
        runTest {
            val errorBody =
                JSONObject().apply {
                    put("lockedUntil", 1710600000000L)
                    put("requiresReauth", false)
                }
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(423, errorBody.toString())

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertTrue(pinResult.locked)
            assertFalse(pinResult.requiresReauth)
        }

    @Test
    fun `verifyPin 423 with invalid JSON body uses safe defaults`() =
        runTest {
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(423, "not-json-at-all")

            val result = repo.verifyPin("10000001", "device-123", "wrong-pin")

            assertTrue(result.isSuccess)
            val pinResult = result.getOrThrow()
            assertTrue(pinResult.locked)
            assertEquals(0L, pinResult.lockedUntil)
            assertTrue(pinResult.requiresReauth) // fail-secure default
            assertEquals(0, pinResult.attemptsRemaining)
        }

    @Test
    fun `verifyPin returns failure on unexpected ApiException status code`() =
        runTest {
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(500, "Internal server error")

            val result = repo.verifyPin("10000001", "device-123", "123456")

            assertTrue(result.isFailure)
            val exception = result.exceptionOrNull()
            assertTrue(exception is ApiException)
            assertEquals(500, (exception as ApiException).statusCode)
        }

    @Test
    fun `verifyPin returns failure on unexpected ApiException 404`() =
        runTest {
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                ApiException(404, "User not found")

            val result = repo.verifyPin("10000001", "device-123", "123456")

            assertTrue(result.isFailure)
            assertTrue(result.exceptionOrNull() is ApiException)
            assertEquals(404, (result.exceptionOrNull() as ApiException).statusCode)
        }

    @Test
    fun `verifyPin returns failure on non-API exception`() =
        runTest {
            coEvery { apiClient.postPublic("/api/auth/pin/verify", any()) } throws
                RuntimeException("Network timeout")

            val result = repo.verifyPin("10000001", "device-123", "123456")

            assertTrue(result.isFailure)
            assertTrue(result.exceptionOrNull() is RuntimeException)
            assertEquals("Network timeout", result.exceptionOrNull()?.message)
        }

    // ===== resetPin =====

    @Test
    fun `resetPin returns success`() =
        runTest {
            coEvery { apiClient.post("/api/auth/pin/reset", any()) } returns JSONObject()

            val result = repo.resetPin("654321")

            assertTrue(result.isSuccess)
        }

    @Test
    fun `resetPin sends correct endpoint and payload`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { apiClient.post("/api/auth/pin/reset", capture(bodySlot)) } returns JSONObject()

            repo.resetPin("654321")

            coVerify { apiClient.post("/api/auth/pin/reset", any()) }
            assertEquals("654321", bodySlot.captured.getString("pin"))
        }

    @Test
    fun `resetPin returns failure on network error`() =
        runTest {
            coEvery { apiClient.post("/api/auth/pin/reset", any()) } throws RuntimeException("Connection refused")

            val result = repo.resetPin("654321")

            assertTrue(result.isFailure)
            assertEquals("Connection refused", result.exceptionOrNull()?.message)
        }

    @Test
    fun `resetPin returns failure on API error`() =
        runTest {
            coEvery { apiClient.post("/api/auth/pin/reset", any()) } throws ApiException(403, "Forbidden")

            val result = repo.resetPin("654321")

            assertTrue(result.isFailure)
            assertTrue(result.exceptionOrNull() is ApiException)
            assertEquals(403, (result.exceptionOrNull() as ApiException).statusCode)
        }
}
