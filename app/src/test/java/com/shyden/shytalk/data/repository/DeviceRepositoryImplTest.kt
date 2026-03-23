package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DeviceRepositoryImplTest {
    private lateinit var firestore: FirebaseFirestore
    private lateinit var workerApiClient: WorkerApiClient
    private lateinit var repo: DeviceRepositoryImpl
    private lateinit var mockDocRef: DocumentReference

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        workerApiClient = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        every { firestore.document(any()) } returns mockDocRef
        repo = DeviceRepositoryImpl(firestore, workerApiClient)
    }

    // region bindDevice

    @Test
    fun `bindDevice returns Success`() =
        runTest {
            every { mockDocRef.set(any()) } returns Tasks.forResult(null)

            val result = repo.bindDevice("device-1", "user-123")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `bindDevice returns Error on exception`() =
        runTest {
            every { mockDocRef.set(any()) } returns Tasks.forException(RuntimeException("Write failed"))

            val result = repo.bindDevice("device-1", "user-123")

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
