package com.shyden.shytalk.data.repository

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

    @Test
    fun `saveFcmToken returns Success`() = runTest {
        coEvery { api.post("/api/notifications/token", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.saveFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/notifications/token", any()) }
    }

    @Test
    fun `saveFcmToken returns Error on exception`() = runTest {
        coEvery { api.post("/api/notifications/token", any()) } throws RuntimeException("Fail")

        val result = repo.saveFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `removeFcmToken returns Success`() = runTest {
        coEvery { api.delete("/api/notifications/token", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.removeFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeFcmToken returns Error on exception`() = runTest {
        coEvery { api.delete("/api/notifications/token", any()) } throws RuntimeException("Fail")

        val result = repo.removeFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `setPmNotificationsEnabled returns Success`() = runTest {
        coEvery { api.patch("/api/notifications/settings", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.setPmNotificationsEnabled("user-1", true)

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `getPmNotificationsEnabled returns true by default`() = runTest {
        coEvery { api.get("/api/users/user-1") } returns JSONObject()

        val result = repo.getPmNotificationsEnabled("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(true, (result as Resource.Success).data)
    }

    @Test
    fun `getPmNotificationsEnabled returns stored value`() = runTest {
        coEvery { api.get("/api/users/user-1") } returns JSONObject().apply {
            put("pm_notifications_enabled", false)
        }

        val result = repo.getPmNotificationsEnabled("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(false, (result as Resource.Success).data)
    }
}
