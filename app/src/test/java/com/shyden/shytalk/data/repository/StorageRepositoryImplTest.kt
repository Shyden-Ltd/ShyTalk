package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GetTokenResult
import com.shyden.shytalk.core.util.Resource
import io.mockk.Runs
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

class StorageRepositoryImplTest {
    private lateinit var auth: FirebaseAuth
    private lateinit var user: FirebaseUser
    private lateinit var tokenResult: GetTokenResult
    private lateinit var httpClient: OkHttpClient
    private lateinit var mockCall: Call
    private lateinit var repo: StorageRepositoryImpl

    private val workerUrl = "https://api.shytalk.shyden.co.uk"

    @Before
    fun setup() {
        auth = mockk()
        user = mockk()
        tokenResult = mockk()
        httpClient = mockk()
        mockCall = mockk()

        every { auth.currentUser } returns user
        every { user.getIdToken(false) } returns Tasks.forResult(tokenResult)
        every { tokenResult.token } returns "test-id-token"
        every { httpClient.newCall(any()) } returns mockCall
        every { mockCall.cancel() } just Runs

        repo =
            StorageRepositoryImpl(
                httpClient = httpClient,
                workerUrl = workerUrl,
                auth = auth,
            )
    }

    // Helpers for building mocked responses
    private fun successEnqueue(body: String) {
        every { mockCall.enqueue(any()) } answers {
            val response = mockk<Response>(relaxed = true)
            val responseBody = mockk<ResponseBody>(relaxed = true)
            every { response.isSuccessful } returns true
            every { response.code } returns 200
            every { response.body } returns responseBody
            every { responseBody.string() } returns body
            firstArg<Callback>().onResponse(mockCall, response)
        }
    }

    private fun errorEnqueue(code: Int) {
        every { mockCall.enqueue(any()) } answers {
            val response = mockk<Response>(relaxed = true)
            val responseBody = mockk<ResponseBody>(relaxed = true)
            every { response.isSuccessful } returns false
            every { response.code } returns code
            every { response.body } returns responseBody
            every { responseBody.string() } returns """{"error":"Error $code"}"""
            firstArg<Callback>().onResponse(mockCall, response)
        }
    }

    private fun failureEnqueue(message: String = "Connection refused") {
        every { mockCall.enqueue(any()) } answers {
            firstArg<Callback>().onFailure(mockCall, IOException(message))
        }
    }

    // --- uploadImage ---

    @Test
    fun `uploadImage returns Success with URL from worker response`() =
        runTest {
            val expectedUrl = "https://images.shytalk.shyden.co.uk/profile_photos/user-1/123.jpg"
            successEnqueue("""{"url":"$expectedUrl"}""")

            val result = repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            assertTrue(result is Resource.Success)
            assertEquals(expectedUrl, (result as Resource.Success).data)
        }

    @Test
    fun `uploadImage sends Authorization header with ID token`() =
        runTest {
            val requestSlot = slot<Request>()
            every { httpClient.newCall(capture(requestSlot)) } returns mockCall
            successEnqueue("""{"url":"https://images.shytalk.shyden.co.uk/x/y.jpg"}""")

            repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            assertEquals("Bearer test-id-token", requestSlot.captured.header("Authorization"))
        }

    @Test
    fun `uploadImage sends multipart POST to worker upload endpoint`() =
        runTest {
            val requestSlot = slot<Request>()
            every { httpClient.newCall(capture(requestSlot)) } returns mockCall
            successEnqueue("""{"url":"https://images.shytalk.shyden.co.uk/x/y.jpg"}""")

            repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            val captured = requestSlot.captured
            assertEquals("POST", captured.method)
            assertTrue(
                "Expected URL to end with /api/storage/upload but was: ${captured.url}",
                captured.url.toString().endsWith("/api/storage/upload"),
            )
            assertTrue(captured.body is MultipartBody)
        }

    @Test
    fun `uploadImage returns Error when response JSON is missing url field`() =
        runTest {
            successEnqueue("""{"status":"ok"}""")

            val result = repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            assertTrue(result is Resource.Error)
            assertTrue((result as Resource.Error).message.contains("missing URL"))
        }

    @Test
    fun `uploadImage returns Error when response url is empty`() =
        runTest {
            successEnqueue("""{"url":""}""")

            val result = repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            assertTrue(result is Resource.Error)
            assertTrue((result as Resource.Error).message.contains("missing URL"))
        }

    @Test
    fun `uploadImage returns Error on HTTP error response`() =
        runTest {
            errorEnqueue(401)

            val result = repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            assertTrue(result is Resource.Error)
            assertTrue((result as Resource.Error).message.contains("401"))
        }

    @Test
    fun `uploadImage returns Error when network call fails`() =
        runTest {
            failureEnqueue()

            val result = repo.uploadImage("user-1", "profile_photos", byteArrayOf(1, 2, 3))

            assertTrue(result is Resource.Error)
        }

    // --- deleteImageByUrl ---

    @Test
    fun `deleteImageByUrl sends DELETE request with extracted key`() =
        runTest {
            val requestSlot = slot<Request>()
            every { httpClient.newCall(capture(requestSlot)) } returns mockCall
            successEnqueue("""{"ok":true}""")

            repo.deleteImageByUrl("https://images.shytalk.shyden.co.uk/profile_photos/user-1/123.jpg")

            val captured = requestSlot.captured
            assertEquals("DELETE", captured.method)
            assertTrue(
                "Expected URL to contain /api/storage/delete but was: ${captured.url}",
                captured.url.toString().contains("/api/storage/delete"),
            )
            assertTrue(captured.url.toString().contains("profile_photos"))
            assertTrue(captured.url.toString().contains("123.jpg"))
        }

    @Test
    fun `deleteImageByUrl sends Authorization header`() =
        runTest {
            val requestSlot = slot<Request>()
            every { httpClient.newCall(capture(requestSlot)) } returns mockCall
            successEnqueue("""{"ok":true}""")

            repo.deleteImageByUrl("https://images.shytalk.shyden.co.uk/profile_photos/user-1/123.jpg")

            assertEquals("Bearer test-id-token", requestSlot.captured.header("Authorization"))
        }

    @Test
    fun `deleteImageByUrl URL-encodes the key parameter`() =
        runTest {
            val requestSlot = slot<Request>()
            every { httpClient.newCall(capture(requestSlot)) } returns mockCall
            successEnqueue("""{"ok":true}""")

            // Path with spaces and special chars
            repo.deleteImageByUrl("https://images.shytalk.shyden.co.uk/messages/user 1/hello world.jpg")

            val url = requestSlot.captured.url.toString()
            // The key should be URL-encoded (spaces become + or %20)
            assertTrue(
                "Expected URL-encoded key but was: $url",
                !url.contains("user 1") && !url.contains("hello world"),
            )
        }

    @Test
    fun `deleteImageByUrl swallows exception silently`() =
        runTest {
            failureEnqueue()

            // Should not throw even on network failure
            repo.deleteImageByUrl("https://images.shytalk.shyden.co.uk/profile_photos/user-1/123.jpg")
        }

    @Test
    fun `deleteImageByUrl does nothing when auth user is null`() =
        runTest {
            every { auth.currentUser } returns null

            // Should return without making any network call
            repo.deleteImageByUrl("https://images.shytalk.shyden.co.uk/profile_photos/user-1/123.jpg")

            verify(exactly = 0) { httpClient.newCall(any()) }
        }
}
