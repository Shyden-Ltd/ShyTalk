package com.shyden.shytalk.data.remote

import com.google.firebase.auth.FirebaseAuth
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Verifies that WorkerApiClient sends X-Device-Id header on all request paths.
 * Uses an OkHttp interceptor to capture outgoing requests instead of MockWebServer.
 */
class WorkerApiClientDeviceIdTest {
    /**
     * Interceptor that records all requests and returns a canned response.
     */
    private class RecordingInterceptor(
        private val responseBody: String = "{}",
        private val responseCode: Int = 200,
    ) : Interceptor {
        val requests = mutableListOf<okhttp3.Request>()

        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            requests.add(request)
            return Response
                .Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(responseCode)
                .message("OK")
                .body(responseBody.toResponseBody("application/json".toMediaType()))
                .build()
        }
    }

    private fun createClient(
        deviceId: String,
        interceptor: RecordingInterceptor,
    ): WorkerApiClient {
        val okHttpClient =
            OkHttpClient
                .Builder()
                .addInterceptor(interceptor)
                .build()
        val mockAuth = mockk<FirebaseAuth>(relaxed = true)
        return WorkerApiClient(okHttpClient, "http://localhost", mockAuth, deviceId)
    }

    @Test
    fun `X-Device-Id header is present on getPublic requests`() =
        runTest {
            val interceptor = RecordingInterceptor()
            val client = createClient("test-device-123", interceptor)

            client.getPublic("/api/health")

            assertEquals(1, interceptor.requests.size)
            assertEquals("test-device-123", interceptor.requests[0].header("X-Device-Id"))
        }

    @Test
    fun `X-Device-Id header is present on postPublic requests`() =
        runTest {
            val interceptor = RecordingInterceptor()
            val client = createClient("test-device-123", interceptor)

            client.postPublic("/api/auth/verify", JSONObject())

            assertEquals(1, interceptor.requests.size)
            assertEquals("test-device-123", interceptor.requests[0].header("X-Device-Id"))
        }

    @Test
    fun `X-Device-Id value is consistent across multiple public calls`() =
        runTest {
            val interceptor = RecordingInterceptor()
            val client = createClient("consistent-device-id", interceptor)

            client.getPublic("/api/health")
            client.getPublic("/api/config/startingScreens")

            assertEquals(2, interceptor.requests.size)
            assertEquals("consistent-device-id", interceptor.requests[0].header("X-Device-Id"))
            assertEquals("consistent-device-id", interceptor.requests[1].header("X-Device-Id"))
        }

    @Test
    fun `X-Device-Id header value matches provided deviceId`() =
        runTest {
            val interceptor = RecordingInterceptor()
            val client = createClient("unique-android-id-abc", interceptor)

            client.getPublic("/api/health")

            assertEquals("unique-android-id-abc", interceptor.requests[0].header("X-Device-Id"))
        }

    @Test
    fun `X-Device-Id header is present with empty device id`() =
        runTest {
            val interceptor = RecordingInterceptor()
            val client = createClient("", interceptor)

            client.getPublic("/api/health")

            // Header should still be set (empty string)
            assertNotNull(interceptor.requests[0].header("X-Device-Id"))
            assertEquals("", interceptor.requests[0].header("X-Device-Id"))
        }

    @Test
    fun `X-Device-Id header is present on postPublic with body`() =
        runTest {
            val interceptor = RecordingInterceptor()
            val client = createClient("device-with-body", interceptor)

            val body = JSONObject().apply { put("key", "value") }
            client.postPublic("/api/auth/otp", body)

            assertEquals("device-with-body", interceptor.requests[0].header("X-Device-Id"))
        }

    @Test
    fun `different clients with different device IDs send correct headers`() =
        runTest {
            val interceptor1 = RecordingInterceptor()
            val interceptor2 = RecordingInterceptor()
            val client1 = createClient("device-A", interceptor1)
            val client2 = createClient("device-B", interceptor2)

            client1.getPublic("/api/health")
            client2.getPublic("/api/health")

            assertEquals("device-A", interceptor1.requests[0].header("X-Device-Id"))
            assertEquals("device-B", interceptor2.requests[0].header("X-Device-Id"))
        }
}
