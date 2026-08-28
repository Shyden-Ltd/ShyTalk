package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.push.PushIdentifier
import com.shyden.shytalk.core.push.PushIdentifierKind
import com.shyden.shytalk.core.util.Resource
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

class NotificationRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var repo: NotificationRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = NotificationRepositoryImpl(api)
    }

    private val tokenIdentifier =
        PushIdentifier("token-abc", PushIdentifierKind.REGISTRATION_TOKEN)
    private val fidIdentifier =
        PushIdentifier("fid-abc", PushIdentifierKind.INSTALLATION_ID)

    @Test
    fun `savePushIdentifier returns Success`() =
        runTest {
            coEvery { api.post("/api/notifications/token", any()) } returns
                JSONObject().apply {
                    put("success", true)
                }

            val result = repo.savePushIdentifier("user-1", tokenIdentifier)

            assertTrue(result is Resource.Success<*>)
            coVerify { api.post("/api/notifications/token", any()) }
        }

    @Test
    fun `savePushIdentifier returns Error on exception`() =
        runTest {
            coEvery { api.post("/api/notifications/token", any()) } throws RuntimeException("Fail")

            val result = repo.savePushIdentifier("user-1", tokenIdentifier)

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `removePushIdentifier returns Success`() =
        runTest {
            coEvery { api.delete("/api/notifications/token", any()) } returns
                JSONObject().apply {
                    put("success", true)
                }

            val result = repo.removePushIdentifier("user-1", tokenIdentifier)

            assertTrue(result is Resource.Success<*>)
        }

    @Test
    fun `removePushIdentifier returns Error on exception`() =
        runTest {
            coEvery { api.delete("/api/notifications/token", any()) } throws RuntimeException("Fail")

            val result = repo.removePushIdentifier("user-1", tokenIdentifier)

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `setPmNotificationsEnabled hits PATCH api and returns Success`() =
        runTest {
            coEvery { api.patch("/api/notifications/settings", any()) } returns
                JSONObject().apply { put("success", true) }
            val result = repo.setPmNotificationsEnabled("user-1", true)
            assertTrue(result is Resource.Success<*>)
            // Verify the field is included in the request body so we are not
            // silently no-oping on the server side.
            coVerify {
                api.patch(
                    "/api/notifications/settings",
                    match<JSONObject> { it.optBoolean("pmNotificationsEnabled") },
                )
            }
        }

    @Test
    fun `setPmNotificationsEnabled returns Error on api failure`() =
        runTest {
            coEvery { api.patch("/api/notifications/settings", any()) } throws RuntimeException("Fail")
            val result = repo.setPmNotificationsEnabled("user-1", true)
            assertTrue(result is Resource.Error)
        }

    // region getPmNotificationsEnabled
    //
    // This region was EMPTY, with a comment saying the getter read from
    // Firestore and was "tested via integration tests" — which is what happens
    // when the only way to exercise something is to mock a whole SDK. Going
    // through the API (EPIC-0006) makes it ordinary to test, so it is.

    @Test
    fun `getPmNotificationsEnabled reads the setting from the API`() =
        runTest {
            coEvery { api.get("/api/notifications/settings") } returns
                JSONObject().apply { put("pmNotificationsEnabled", false) }
            val result = repo.getPmNotificationsEnabled("user-1")
            assertTrue(result is Resource.Success<*>)
            assertEquals(false, (result as Resource.Success).data)
        }

    @Test
    fun `getPmNotificationsEnabled defaults to enabled when the field is absent`() =
        runTest {
            // The old Firestore path defaulted to true on a missing field.
            // Behaviour a person experiences must not change with the transport.
            coEvery { api.get("/api/notifications/settings") } returns JSONObject()
            val result = repo.getPmNotificationsEnabled("user-1")
            assertTrue(result is Resource.Success<*>)
            assertEquals(true, (result as Resource.Success).data)
        }

    @Test
    fun `getPmNotificationsEnabled returns Error when the API fails`() =
        runTest {
            coEvery { api.get("/api/notifications/settings") } throws RuntimeException("Fail")
            assertTrue(repo.getPmNotificationsEnabled("user-1") is Resource.Error)
        }

    @Test
    fun `getPmNotificationsEnabled does not send a user id`() =
        runTest {
            // The endpoint answers for the CALLER. Passing an id through would
            // let anybody read anybody's settings, so the argument this method
            // still accepts must go nowhere near the request.
            coEvery { api.get(any()) } returns JSONObject()
            repo.getPmNotificationsEnabled("somebody-else")
            coVerify { api.get("/api/notifications/settings") }
        }

    // endregion

    /**
     * SHY-0244 — the request body has to name the model.
     *
     * The backend stores tokens and installation IDs in different fields and
     * cannot tell them apart by shape, so this body is the only thing that
     * says which one it is. Posting a fid under "token" would file it in the
     * wrong store: the send then fails, the reaper deletes it, and the device
     * goes permanently dark.
     */
    @Test
    fun `an installation ID is sent as installationId, not token`() =
        runTest {
            val bodies = mutableListOf<JSONObject>()
            coEvery { api.post("/api/notifications/token", capture(bodies)) } returns
                JSONObject().apply { put("success", true) }

            repo.savePushIdentifier("user-1", fidIdentifier)

            assertEquals("fid-abc", bodies.single().optString("installationId"))
            assertTrue("must not also send a token field", !bodies.single().has("token"))
        }

    @Test
    fun `a registration token is sent as token, not installationId`() =
        runTest {
            val bodies = mutableListOf<JSONObject>()
            coEvery { api.post("/api/notifications/token", capture(bodies)) } returns
                JSONObject().apply { put("success", true) }

            repo.savePushIdentifier("user-1", tokenIdentifier)

            assertEquals("token-abc", bodies.single().optString("token"))
            assertTrue("must not also send an installationId field", !bodies.single().has("installationId"))
        }
}
