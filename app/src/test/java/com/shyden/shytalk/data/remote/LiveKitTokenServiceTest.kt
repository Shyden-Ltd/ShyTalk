package com.shyden.shytalk.data.remote

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class LiveKitTokenServiceTest {
    private lateinit var api: WorkerApiClient
    private lateinit var service: LiveKitTokenService

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        service = LiveKitTokenService(api)
    }

    @Test
    fun `fetchToken returns token from successful response`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } returns
                JSONObject().apply {
                    put("token", "test-jwt-token")
                }

            val result = service.fetchToken("room-1")

            assertEquals("test-jwt-token", result.token)
            assertNull(result.url)
            coVerify { api.post("/api/livekit/token", any()) }
        }

    @Test
    fun `fetchToken returns url when present in response`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } returns
                JSONObject().apply {
                    put("token", "test-jwt-token")
                    put("url", "wss://livekit.test.com")
                }

            val result = service.fetchToken("room-1")

            assertEquals("test-jwt-token", result.token)
            assertEquals("wss://livekit.test.com", result.url)
        }

    @Test(expected = IllegalStateException::class)
    fun `fetchToken throws when response missing token field`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } returns
                JSONObject().apply {
                    put("error", "no token")
                }

            service.fetchToken("room-1")
        }

    @Test(expected = RuntimeException::class)
    fun `fetchToken propagates exception from API`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } throws RuntimeException("Network error")

            service.fetchToken("room-1")
        }
}
