package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GetTokenResult
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class IdentityRepositoryImplTest {
    private lateinit var workerApiClient: WorkerApiClient
    private lateinit var firebaseAuth: FirebaseAuth
    private lateinit var repo: IdentityRepositoryImpl

    @Before
    fun setup() {
        workerApiClient = mockk(relaxed = true)
        firebaseAuth = mockk(relaxed = true)
        repo = IdentityRepositoryImpl(workerApiClient, firebaseAuth)
    }

    // ─── resolveIdentity ─────────────────────────────────────────────

    @Test
    fun `resolveIdentity returns Found with uniqueId for existing identity`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("found", true)
                    put("uniqueId", 10000005)
                }
            coEvery { workerApiClient.post("/api/users/sign-in", any()) } returns response

            val result = repo.resolveIdentity("google", "alice@gmail.com")

            assertTrue(result is Resource.Success)
            val signInResult = (result as Resource.Success).data
            assertTrue(signInResult is SignInResult.Found)
            assertEquals(10000005L, (signInResult as SignInResult.Found).uniqueId)
        }

    @Test
    fun `resolveIdentity returns NotFound when identity not in system`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("found", false)
                }
            coEvery { workerApiClient.post("/api/users/sign-in", any()) } returns response

            val result = repo.resolveIdentity("google", "unknown@gmail.com")

            assertTrue(result is Resource.Success)
            assertTrue((result as Resource.Success).data is SignInResult.NotFound)
        }

    @Test
    fun `resolveIdentity returns Deactivated for unlinked identity`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("found", false)
                    put("deactivated", true)
                }
            coEvery { workerApiClient.post("/api/users/sign-in", any()) } returns response

            val result = repo.resolveIdentity("email", "old@work.com")

            assertTrue(result is Resource.Success)
            assertTrue((result as Resource.Success).data is SignInResult.Deactivated)
        }

    @Test
    fun `resolveIdentity sends correct provider and identifier in body`() =
        runTest {
            val response = JSONObject().apply { put("found", false) }
            var capturedBody: JSONObject? = null
            coEvery { workerApiClient.post("/api/users/sign-in", any()) } answers {
                capturedBody = secondArg()
                response
            }

            repo.resolveIdentity("apple", "001234.abcdef")

            assertEquals("apple", capturedBody?.getString("provider"))
            assertEquals("001234.abcdef", capturedBody?.getString("identifier"))
        }

    @Test
    fun `resolveIdentity returns Error on network failure`() =
        runTest {
            coEvery { workerApiClient.post("/api/users/sign-in", any()) } throws
                RuntimeException("Network error")

            val result = repo.resolveIdentity("google", "alice@gmail.com")

            assertTrue(result is Resource.Error)
        }

    // ─── createUser ──────────────────────────────────────────────────

    @Test
    fun `createUser returns uniqueId on success`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("success", true)
                    put("created", true)
                    put("uniqueId", 10000042)
                }
            coEvery { workerApiClient.post("/api/users", any()) } returns response

            val result =
                repo.createUser(
                    provider = "google",
                    identifier = "alice@gmail.com",
                    displayName = "Alice",
                    email = "alice@gmail.com",
                    profilePhotoUrl = null,
                    dateOfBirth = null,
                    language = "en",
                )

            assertTrue(result is Resource.Success)
            assertEquals(10000042L, (result as Resource.Success).data.uniqueId)
        }

    @Test
    fun `createUser sends all fields in request body`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("success", true)
                    put("uniqueId", 10000001)
                }
            var capturedBody: JSONObject? = null
            coEvery { workerApiClient.post("/api/users", any()) } answers {
                capturedBody = secondArg()
                response
            }

            repo.createUser("google", "alice@gmail.com", "Alice", "alice@gmail.com", "https://photo.jpg", 946684800000L, "en")

            assertEquals("google", capturedBody?.getString("provider"))
            assertEquals("alice@gmail.com", capturedBody?.getString("identifier"))
            assertEquals("Alice", capturedBody?.getString("displayName"))
            assertEquals("alice@gmail.com", capturedBody?.getString("email"))
            assertEquals("https://photo.jpg", capturedBody?.getString("profilePhotoUrl"))
            assertEquals(946684800000L, capturedBody?.getLong("dateOfBirth"))
            assertEquals("en", capturedBody?.getString("language"))
        }

    @Test
    fun `createUser returns Error on 409 conflict`() =
        runTest {
            coEvery { workerApiClient.post("/api/users", any()) } throws
                ApiException(409, "Identity already linked to an account")

            val result = repo.createUser("google", "taken@gmail.com", "Bob", null, null, null, "en")

            assertTrue(result is Resource.Error)
            assertTrue((result as Resource.Error).message.contains("already linked"))
        }

    // ─── linkProvider ────────────────────────────────────────────────

    @Test
    fun `linkProvider calls correct endpoint`() =
        runTest {
            val response = JSONObject().apply { put("success", true) }
            coEvery { workerApiClient.post(any(), any()) } returns response

            val result = repo.linkProvider(10000005, "email", "new@work.com")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `linkProvider sends provider and identifier in body`() =
        runTest {
            val response = JSONObject().apply { put("success", true) }
            var capturedPath: String? = null
            var capturedBody: JSONObject? = null
            coEvery { workerApiClient.post(any(), any()) } answers {
                capturedPath = firstArg()
                capturedBody = secondArg()
                response
            }

            repo.linkProvider(10000005, "email", "new@work.com")

            assertEquals("/api/users/10000005/link-provider", capturedPath)
            assertEquals("email", capturedBody?.getString("provider"))
            assertEquals("new@work.com", capturedBody?.getString("identifier"))
        }

    // ─── unlinkProvider ──────────────────────────────────────────────

    @Test
    fun `unlinkProvider calls correct endpoint with DELETE`() =
        runTest {
            val response = JSONObject().apply { put("success", true) }
            var capturedPath: String? = null
            var capturedBody: JSONObject? = null
            coEvery { workerApiClient.delete(any(), any<JSONObject>()) } answers {
                capturedPath = firstArg()
                capturedBody = secondArg()
                response
            }

            val result = repo.unlinkProvider(10000005, "email", "old@work.com")

            assertTrue(result is Resource.Success)
            assertEquals("/api/users/10000005/link-provider", capturedPath)
            assertEquals("email", capturedBody?.getString("provider"))
            assertEquals("old@work.com", capturedBody?.getString("identifier"))
        }

    // ─── forceRefreshToken ───────────────────────────────────────────

    @Test
    fun `forceRefreshToken clears api client token cache`() =
        runTest {
            val mockUser = mockk<FirebaseUser>(relaxed = true)
            val mockTokenResult = mockk<GetTokenResult>(relaxed = true)
            every { firebaseAuth.currentUser } returns mockUser
            every { mockUser.getIdToken(true) } returns Tasks.forResult(mockTokenResult)
            every { mockTokenResult.token } returns "refreshed-token"

            val result = repo.forceRefreshToken()

            assertTrue(result is Resource.Success)
            verify { workerApiClient.clearTokenCache() }
        }
}
