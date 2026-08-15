package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
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

    @Test
    fun `resolveDeviceLock POSTs to the lock-check path with the deviceId in the body`() =
        runTest {
            // Pins the exact endpoint + payload — a regression to a wrong path or
            // body key would otherwise slip through the any()-matched stubs above.
            coEvery { workerApiClient.post(any(), any()) } returns JSONObject().apply { put("status", "allowed") }

            repo.resolveDeviceLock("device-xyz")

            coVerify {
                workerApiClient.post(
                    "/api/devices/lock-check",
                    match { it.getString("deviceId") == "device-xyz" },
                )
            }
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
            coEvery { workerApiClient.getPublic(any()) } returns response

            val result = repo.checkBanStatus("device-1")

            assertTrue(result is Resource.Success)
            assertFalse((result as Resource.Success).data.isBanned)
        }

    @Test
    fun `checkBanStatus calls the UNAUTHENTICATED ban endpoint, never device-info`() =
        runTest {
            // SHY-0143 C1. `/api/device-info` is auth-gated, so with no Firebase
            // session `getIdToken()` throws before the request is built and the
            // repository's catch reports "not banned" — a banned user who was
            // signed out reached the sign-in screen. The endpoint is the fix, so
            // the endpoint is what must be pinned; asserting only the parsed
            // result would stay green if this regressed to the authed POST.
            val path = slot<String>()
            coEvery { workerApiClient.getPublic(capture(path)) } returns
                JSONObject().apply {
                    put("success", true)
                    put("banStatus", JSONObject().apply { put("isBanned", false) })
                }

            repo.checkBanStatus("device-1")

            assertTrue(
                "must read the unauthenticated ban endpoint, got ${path.captured}",
                path.captured.startsWith("/api/ban-status"),
            )
            assertTrue("the deviceId must reach the server", path.captured.contains("deviceId=device-1"))
            coVerify(exactly = 0) { workerApiClient.post(any(), any()) }
        }

    @Test
    fun `checkBanStatus URL-encodes the deviceId into the query string`() {
        // The existing endpoint test uses `device-1`, which needs no encoding —
        // so deleting the encode call left it green. A `&` splits the parameter
        // and a `#` truncates at the fragment, which would make the server
        // ban-check a DIFFERENT deviceId than the caller's and still answer
        // 200. `isValidDeviceId` cannot see that, because the mangled value it
        // receives is well-formed. A silent evasion primitive.
        val path = slot<String>()
        coEvery { workerApiClient.getPublic(capture(path)) } returns
            JSONObject().apply {
                put("success", true)
                put("banStatus", JSONObject().apply { put("isBanned", false) })
            }

        runTest { repo.checkBanStatus("dev&id=x#frag +é") }

        val query = path.captured.substringAfter("deviceId=")
        assertFalse("a raw & would split the parameter: ${path.captured}", query.contains("&"))
        assertFalse("a raw # would truncate at the fragment: ${path.captured}", query.contains("#"))
        assertFalse("a raw space is not valid in a query string: ${path.captured}", query.contains(" "))
        assertTrue("the value must actually be encoded: ${path.captured}", query.contains("%"))
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
            coEvery { workerApiClient.getPublic(any()) } returns response

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
            coEvery { workerApiClient.getPublic(any()) } returns response

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
            // Was stubbing `post`, which checkBanStatus stopped calling when
            // C1 moved it to the unauthenticated GET. `workerApiClient` is
            // relaxed, so `getPublic` returned a stub object, the test went
            // down the HAPPY path and asserted "not banned" — proving nothing
            // about the fail-open catch on a brand-new unauthenticated endpoint.
            coEvery { workerApiClient.getPublic(any()) } throws RuntimeException("Network error")

            val result = repo.checkBanStatus("device-1")

            assertTrue(result is Resource.Success)
            assertFalse((result as Resource.Success).data.isBanned)
        }

    // endregion
}
