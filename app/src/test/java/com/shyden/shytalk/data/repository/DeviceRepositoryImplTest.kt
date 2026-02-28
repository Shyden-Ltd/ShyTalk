package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DeviceRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var repo: DeviceRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = DeviceRepositoryImpl(api)
    }

    @Test
    fun `getDeviceBinding returns userId when binding exists`() = runTest {
        coEvery { api.get("/api/device-bindings/device-1") } returns JSONObject().put("userId", "user-123")

        val result = repo.getDeviceBinding("device-1")

        assertTrue(result is Resource.Success)
        assertEquals("user-123", (result as Resource.Success).data)
    }

    @Test
    fun `getDeviceBinding returns null when binding does not exist`() = runTest {
        coEvery { api.get("/api/device-bindings/device-1") } throws ApiException(404, "Not found")

        val result = repo.getDeviceBinding("device-1")

        assertTrue(result is Resource.Success)
        assertNull((result as Resource.Success).data)
    }

    @Test
    fun `getDeviceBinding returns Error on non-404 exception`() = runTest {
        coEvery { api.get("/api/device-bindings/device-1") } throws ApiException(500, "Server error")

        val result = repo.getDeviceBinding("device-1")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `bindDevice returns Success`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject().put("success", true)

        val result = repo.bindDevice("device-1", "user-123")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `bindDevice returns Error on exception`() = runTest {
        coEvery { api.post(any(), any()) } throws RuntimeException("Write failed")

        val result = repo.bindDevice("device-1", "user-123")

        assertTrue(result is Resource.Error)
    }
}
