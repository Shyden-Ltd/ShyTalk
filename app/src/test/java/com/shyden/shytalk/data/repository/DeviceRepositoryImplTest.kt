package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit test for the Android [DeviceRepositoryImpl] — it now routes EVERYTHING
 * through the Express API (no Firestore). Doubles the [WorkerApiClient] (a
 * permitted unit-test double); the server-authoritative device-lock behaviour
 * itself is proven against the real emulator in
 * express-api/tests/routes/devices-lock-check.test.js (SHY-0170).
 */
class DeviceRepositoryImplTest {
    private lateinit var workerApiClient: WorkerApiClient
    private lateinit var repo: DeviceRepositoryImpl

    @Before
    fun setup() {
        workerApiClient = mockk(relaxed = true)
        repo = DeviceRepositoryImpl(workerApiClient)
    }

    // region resolveDeviceLock

    @Test
    fun `resolveDeviceLock maps status=locked to LOCKED`() =
        runTest {
            coEvery { workerApiClient.post(any(), any()) } returns
                JSONObject().apply {
                    put("status", "locked")
                    put("boundToOther", true)
                }

            val result = repo.resolveDeviceLock("device-1")

            assertTrue(result is Resource.Success)
            assertEquals(DeviceLockStatus.LOCKED, (result as Resource.Success).data)
        }

    @Test
    fun `resolveDeviceLock maps status=allowed to ALLOWED`() =
        runTest {
            coEvery { workerApiClient.post(any(), any()) } returns
                JSONObject().apply {
                    put("status", "allowed")
                    put("boundToOther", false)
                }

            val result = repo.resolveDeviceLock("device-1")

            assertTrue(result is Resource.Success)
            assertEquals(DeviceLockStatus.ALLOWED, (result as Resource.Success).data)
        }

    @Test
    fun `resolveDeviceLock defaults to ALLOWED when status is absent (fail-open on a malformed but successful response)`() =
        runTest {
            coEvery { workerApiClient.post(any(), any()) } returns JSONObject().apply { put("success", true) }

            val result = repo.resolveDeviceLock("device-1")

            assertTrue(result is Resource.Success)
            assertEquals(DeviceLockStatus.ALLOWED, (result as Resource.Success).data)
        }

    @Test
    fun `resolveDeviceLock returns Error on API exception (lenient — VM proceeds)`() =
        runTest {
            coEvery { workerApiClient.post(any(), any()) } throws RuntimeException("Network error")

            val result = repo.resolveDeviceLock("device-1")

            assertTrue(result is Resource.Error)
        }

    // endregion

    // region checkBanStatus

    @Test
    fun `checkBanStatus returns not banned when banStatus isBanned is false`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("success", true)
                    put(
                        "banStatus",
                        JSONObject().apply {
                            put("isBanned", false)
                            put("banType", JSONObject.NULL)
                            put("reason", JSONObject.NULL)
                            put("expiresAt", JSONObject.NULL)
                        },
                    )
                }
            coEvery { workerApiClient.post(any(), any()) } returns response

            val result = repo.checkBanStatus("device-1")

            assertTrue(result is Resource.Success)
            assertFalse((result as Resource.Success).data.isBanned)
        }

    @Test
    fun `checkBanStatus returns device ban`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("success", true)
                    put(
                        "banStatus",
                        JSONObject().apply {
                            put("isBanned", true)
                            put("banType", "device")
                            put("reason", "Spam")
                            put("expiresAt", "2099-01-01T00:00:00Z")
                        },
                    )
                }
            coEvery { workerApiClient.post(any(), any()) } returns response

            val result = repo.checkBanStatus("device-1")

            assertTrue(result is Resource.Success)
            val ban = (result as Resource.Success).data
            assertTrue(ban.isBanned)
            assertEquals("device", ban.banType)
            assertEquals("Spam", ban.reason)
            assertEquals("2099-01-01T00:00:00Z", ban.expiresAt)
        }

    @Test
    fun `checkBanStatus returns network ban`() =
        runTest {
            val response =
                JSONObject().apply {
                    put("success", true)
                    put(
                        "banStatus",
                        JSONObject().apply {
                            put("isBanned", true)
                            put("banType", "network_ip")
                            put("reason", "VPN abuse")
                            put("expiresAt", JSONObject.NULL)
                        },
                    )
                }
            coEvery { workerApiClient.post(any(), any()) } returns response

            val result = repo.checkBanStatus("device-1")

            assertTrue(result is Resource.Success)
            val ban = (result as Resource.Success).data
            assertTrue(ban.isBanned)
            assertEquals("network_ip", ban.banType)
            assertEquals("VPN abuse", ban.reason)
        }

    @Test
    fun `checkBanStatus returns not banned on API exception`() =
        runTest {
            coEvery { workerApiClient.post(any(), any()) } throws RuntimeException("Network error")

            val result = repo.checkBanStatus("device-1")

            assertTrue(result is Resource.Success)
            assertFalse((result as Resource.Success).data.isBanned)
        }

    // endregion
}
