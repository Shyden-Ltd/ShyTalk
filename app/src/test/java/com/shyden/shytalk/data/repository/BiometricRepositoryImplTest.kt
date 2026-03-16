package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

class BiometricRepositoryImplTest {

    private lateinit var apiClient: WorkerApiClient
    private lateinit var repo: BiometricRepositoryImpl

    @Before
    fun setup() {
        apiClient = mockk(relaxed = true)
        repo = BiometricRepositoryImpl(apiClient)
    }

    // ─── register ─────────────────────────────────────────────────────

    @Test
    fun `register succeeds when API call succeeds`() = runTest {
        coEvery { apiClient.post(any(), any()) } returns JSONObject()

        val result = repo.register("cHVibGljS2V5", "device-abc")

        assertTrue(result.isSuccess)
    }

    @Test
    fun `register calls correct endpoint with publicKey and deviceId`() = runTest {
        var capturedPath: String? = null
        var capturedBody: JSONObject? = null
        coEvery { apiClient.post(any(), any()) } answers {
            capturedPath = firstArg()
            capturedBody = secondArg()
            JSONObject()
        }

        repo.register("cHVibGljS2V5", "device-abc")

        assertEquals("/api/auth/biometric/register", capturedPath)
        assertEquals("cHVibGljS2V5", capturedBody?.getString("publicKey"))
        assertEquals("device-abc", capturedBody?.getString("deviceId"))
    }

    @Test
    fun `register returns failure when API throws ApiException`() = runTest {
        coEvery { apiClient.post(any(), any()) } throws ApiException(400, "Bad request")

        val result = repo.register("badKey", "device-abc")

        assertTrue(result.isFailure)
        val exception = result.exceptionOrNull()
        assertTrue(exception is ApiException)
        assertEquals(400, (exception as ApiException).statusCode)
        assertEquals("Bad request", exception.message)
    }

    @Test
    fun `register returns failure on network error`() = runTest {
        coEvery { apiClient.post(any(), any()) } throws IOException("Connection refused")

        val result = repo.register("key", "device")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IOException)
    }

    // ─── getChallenge ─────────────────────────────────────────────────

    @Test
    fun `getChallenge returns challenge string on success`() = runTest {
        val response = JSONObject().apply {
            put("challenge", "random-nonce-abc123")
        }
        coEvery { apiClient.getPublic(any()) } returns response

        val result = repo.getChallenge("10000005", "device-abc")

        assertTrue(result.isSuccess)
        assertEquals("random-nonce-abc123", result.getOrNull())
    }

    @Test
    fun `getChallenge calls correct endpoint with URL-encoded parameters`() = runTest {
        var capturedPath: String? = null
        coEvery { apiClient.getPublic(any()) } answers {
            capturedPath = firstArg()
            JSONObject().apply { put("challenge", "nonce") }
        }

        repo.getChallenge("10000005", "device-abc")

        assertEquals(
            "/api/auth/biometric/challenge?uniqueId=10000005&deviceId=device-abc",
            capturedPath
        )
    }

    @Test
    fun `getChallenge URL-encodes special characters in parameters`() = runTest {
        var capturedPath: String? = null
        coEvery { apiClient.getPublic(any()) } answers {
            capturedPath = firstArg()
            JSONObject().apply { put("challenge", "nonce") }
        }

        repo.getChallenge("hello world", "device&id=1")

        assertEquals(
            "/api/auth/biometric/challenge?uniqueId=hello+world&deviceId=device%26id%3D1",
            capturedPath
        )
    }

    @Test
    fun `getChallenge returns failure when API throws`() = runTest {
        coEvery { apiClient.getPublic(any()) } throws ApiException(404, "Not found")

        val result = repo.getChallenge("unknown", "device-abc")

        assertTrue(result.isFailure)
        val exception = result.exceptionOrNull()
        assertTrue(exception is ApiException)
        assertEquals(404, (exception as ApiException).statusCode)
    }

    @Test
    fun `getChallenge returns failure when response missing challenge field`() = runTest {
        coEvery { apiClient.getPublic(any()) } returns JSONObject()

        val result = repo.getChallenge("10000005", "device-abc")

        assertTrue(result.isFailure)
        // JSONObject.getString throws JSONException when key is missing
    }

    @Test
    fun `getChallenge returns failure on network error`() = runTest {
        coEvery { apiClient.getPublic(any()) } throws IOException("Timeout")

        val result = repo.getChallenge("10000005", "device-abc")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IOException)
    }

    // ─── verify ───────────────────────────────────────────────────────

    @Test
    fun `verify returns customToken on success`() = runTest {
        val response = JSONObject().apply {
            put("customToken", "firebase-custom-token-xyz")
        }
        coEvery { apiClient.postPublic(any(), any()) } returns response

        val result = repo.verify("10000005", "device-abc", "c2lnbmF0dXJl")

        assertTrue(result.isSuccess)
        assertEquals("firebase-custom-token-xyz", result.getOrNull())
    }

    @Test
    fun `verify calls correct endpoint with correct payload`() = runTest {
        var capturedPath: String? = null
        var capturedBody: JSONObject? = null
        coEvery { apiClient.postPublic(any(), any()) } answers {
            capturedPath = firstArg()
            capturedBody = secondArg()
            JSONObject().apply { put("customToken", "token") }
        }

        repo.verify("10000005", "device-abc", "c2lnbmF0dXJl")

        assertEquals("/api/auth/biometric/verify", capturedPath)
        assertEquals("10000005", capturedBody?.getString("uniqueId"))
        assertEquals("device-abc", capturedBody?.getString("deviceId"))
        assertEquals("c2lnbmF0dXJl", capturedBody?.getString("signature"))
    }

    @Test
    fun `verify returns failure when API returns 401`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws
            ApiException(401, "Invalid signature")

        val result = repo.verify("10000005", "device-abc", "badSig")

        assertTrue(result.isFailure)
        val exception = result.exceptionOrNull()
        assertTrue(exception is ApiException)
        assertEquals(401, (exception as ApiException).statusCode)
        assertEquals("Invalid signature", exception.message)
    }

    @Test
    fun `verify returns failure when response missing customToken field`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject()

        val result = repo.verify("10000005", "device-abc", "sig")

        assertTrue(result.isFailure)
        // JSONObject.getString throws JSONException when key is missing
    }

    @Test
    fun `verify returns failure on network error`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } throws IOException("Connection reset")

        val result = repo.verify("10000005", "device-abc", "sig")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IOException)
    }

    // ─── revoke ───────────────────────────────────────────────────────

    @Test
    fun `revoke succeeds when API call succeeds`() = runTest {
        coEvery { apiClient.delete(any()) } returns JSONObject()

        val result = repo.revoke("device-abc")

        assertTrue(result.isSuccess)
    }

    @Test
    fun `revoke calls correct endpoint with deviceId in path`() = runTest {
        var capturedPath: String? = null
        coEvery { apiClient.delete(any()) } answers {
            capturedPath = firstArg()
            JSONObject()
        }

        repo.revoke("device-abc")

        assertEquals("/api/auth/biometric/device-abc", capturedPath)
    }

    @Test
    fun `revoke returns failure when API throws ApiException`() = runTest {
        coEvery { apiClient.delete(any()) } throws ApiException(404, "Not found")

        val result = repo.revoke("unknown-device")

        assertTrue(result.isFailure)
        val exception = result.exceptionOrNull()
        assertTrue(exception is ApiException)
        assertEquals(404, (exception as ApiException).statusCode)
        assertEquals("Not found", exception.message)
    }

    @Test
    fun `revoke returns failure on network error`() = runTest {
        coEvery { apiClient.delete(any()) } throws IOException("Socket closed")

        val result = repo.revoke("device-abc")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IOException)
    }

    @Test
    fun `revoke calls authenticated delete endpoint`() = runTest {
        coEvery { apiClient.delete(any()) } returns JSONObject()

        repo.revoke("my-device-id")

        coVerify(exactly = 1) { apiClient.delete("/api/auth/biometric/my-device-id") }
    }

    // ─── cross-cutting ───────────────────────────────────────────────

    @Test
    fun `register uses authenticated post endpoint`() = runTest {
        coEvery { apiClient.post(any(), any()) } returns JSONObject()

        repo.register("key", "device")

        coVerify(exactly = 1) { apiClient.post("/api/auth/biometric/register", any()) }
    }

    @Test
    fun `getChallenge uses public get endpoint`() = runTest {
        coEvery { apiClient.getPublic(any()) } returns JSONObject().apply {
            put("challenge", "nonce")
        }

        repo.getChallenge("uid", "did")

        coVerify(exactly = 1) { apiClient.getPublic(any()) }
    }

    @Test
    fun `verify uses public post endpoint`() = runTest {
        coEvery { apiClient.postPublic(any(), any()) } returns JSONObject().apply {
            put("customToken", "token")
        }

        repo.verify("uid", "did", "sig")

        coVerify(exactly = 1) { apiClient.postPublic("/api/auth/biometric/verify", any()) }
    }
}
