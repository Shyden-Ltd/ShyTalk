package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ReportRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var repo: ReportRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = ReportRepositoryImpl(api)
    }

    // --- reportMessage ---

    @Test
    fun `reportMessage posts to correct endpoint`() =
        runTest {
            coEvery { api.post("/api/reports", any()) } returns
                JSONObject().apply {
                    put("success", true)
                    put("reportId", "rpt-1")
                }

            val result =
                repo.reportMessage(
                    reporterId = "reporter-1",
                    reporterName = "ReporterName",
                    reporterUniqueId = 1001L,
                    reportedUserId = "user-1",
                    reportedUserName = "OffenderName",
                    reportedUserUniqueId = 2002L,
                    conversationId = "conv-1",
                    messageId = "msg-1",
                    messageText = "bad message",
                    reason = "Spam",
                    description = "This is spam",
                )

            assertTrue(result is Resource.Success)
            coVerify { api.post("/api/reports", any()) }
        }

    @Test
    fun `reportMessage sends correct body fields`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { api.post("/api/reports", capture(bodySlot)) } returns
                JSONObject().apply {
                    put("success", true)
                }

            repo.reportMessage(
                reporterId = "r",
                reporterName = "R",
                reporterUniqueId = 1L,
                reportedUserId = "user-1",
                reportedUserName = "User One",
                reportedUserUniqueId = 2L,
                conversationId = "conv-1",
                messageId = "msg-1",
                messageText = "bad",
                reason = "Harassment",
                description = "desc",
            )

            val body = bodySlot.captured
            assertEquals("user-1", body.getString("reportedUserId"))
            assertEquals("User One", body.getString("reportedUserName"))
            assertEquals("conv-1", body.getString("conversationId"))
            assertEquals("msg-1", body.getString("messageId"))
            assertEquals("bad", body.getString("messageText"))
            assertEquals("Harassment", body.getString("reason"))
            assertEquals("desc", body.getString("description"))
        }

    @Test
    fun `reportMessage returns Error on exception`() =
        runTest {
            coEvery { api.post("/api/reports", any()) } throws RuntimeException("Network error")

            val result =
                repo.reportMessage(
                    reporterId = "r",
                    reporterName = "R",
                    reporterUniqueId = 1L,
                    reportedUserId = "u",
                    reportedUserName = "U",
                    reportedUserUniqueId = 2L,
                    conversationId = "c",
                    messageId = "m",
                    messageText = "t",
                    reason = "Spam",
                    description = "d",
                )

            assertTrue(result is Resource.Error)
        }

    // --- reportUser ---

    @Test
    fun `reportUser posts to correct endpoint`() =
        runTest {
            coEvery { api.post("/api/reports", any()) } returns
                JSONObject().apply {
                    put("success", true)
                }

            val result =
                repo.reportUser(
                    reporterId = "reporter-1",
                    reporterName = "Reporter",
                    reporterUniqueId = 1001L,
                    reportedUserId = "user-1",
                    reportedUserName = "User",
                    reportedUserUniqueId = 2002L,
                    conversationId = "conv-1",
                    reason = "Inappropriate Content",
                    description = "Bad profile",
                )

            assertTrue(result is Resource.Success)
            coVerify { api.post("/api/reports", any()) }
        }

    @Test
    fun `reportUser includes evidenceUrls when not empty`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { api.post("/api/reports", capture(bodySlot)) } returns
                JSONObject().apply {
                    put("success", true)
                }

            repo.reportUser(
                reporterId = "r",
                reporterName = "R",
                reporterUniqueId = 1L,
                reportedUserId = "u",
                reportedUserName = "U",
                reportedUserUniqueId = 2L,
                conversationId = "c",
                reason = "Spam",
                description = "d",
                evidenceUrls = listOf("https://img.example.com/1.jpg", "https://img.example.com/2.jpg"),
            )

            val urls = bodySlot.captured.getJSONArray("evidenceUrls")
            assertEquals(2, urls.length())
            assertEquals("https://img.example.com/1.jpg", urls.getString(0))
        }

    @Test
    fun `reportUser omits evidenceUrls when empty`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { api.post("/api/reports", capture(bodySlot)) } returns
                JSONObject().apply {
                    put("success", true)
                }

            repo.reportUser(
                reporterId = "r",
                reporterName = "R",
                reporterUniqueId = 1L,
                reportedUserId = "u",
                reportedUserName = "U",
                reportedUserUniqueId = 2L,
                conversationId = "c",
                reason = "Spam",
                description = "d",
                evidenceUrls = emptyList(),
            )

            assertTrue(!bodySlot.captured.has("evidenceUrls"))
        }

    // --- resolveReport ---

    @Test
    fun `resolveReport posts to correct endpoint with action and returns empty outcome on plain success`() =
        runTest {
            val bodySlot = slot<JSONObject>()
            coEvery { api.post("/api/reports/report-1/resolve", capture(bodySlot)) } returns
                JSONObject().apply {
                    put("success", true)
                }

            val result = repo.resolveReport("report-1", "warn")

            assertTrue(result is Resource.Success)
            assertEquals("warn", bodySlot.captured.getString("action"))
            val outcome = (result as Resource.Success).data
            assertTrue(!outcome.hasAnyFailure)
        }

    @Test
    fun `resolveReport returns Error on exception`() =
        runTest {
            coEvery { api.post(any(), any()) } throws RuntimeException("Fail")

            val result = repo.resolveReport("report-1", "dismiss")

            assertTrue(result is Resource.Error)
        }

    // ─── partial-failure response surfacing (B6.12) ─────────────────
    //
    // The Express handler emits per-sub-action failure flags
    // (warning|suspension|auditLog|lockRelease + cascade + pms). The
    // Kotlin client previously dropped the body and shipped a green
    // toast. These tests pin the parsing wire so a future refactor of
    // the response body keys can't silently regress to Resource<Unit>.

    @Test
    fun `resolveReport surfaces warning failure flag`() =
        runTest {
            coEvery { api.post(any(), any()) } returns
                JSONObject().apply {
                    put("success", true)
                    put(
                        "warning",
                        JSONObject().apply {
                            put("failed", true)
                            put("error", "warning_create_failed")
                        },
                    )
                }

            val result = repo.resolveReport("report-1", "warn")

            assertTrue(result is Resource.Success)
            val outcome = (result as Resource.Success).data
            assertTrue(outcome.hasAnyFailure)
            assertEquals("warning_create_failed", outcome.warning?.error)
        }

    @Test
    fun `resolveReport surfaces suspension and cascade partial-failure flags`() =
        runTest {
            coEvery { api.post(any(), any()) } returns
                JSONObject().apply {
                    put("success", true)
                    put(
                        "suspension",
                        JSONObject().apply {
                            put("failed", true)
                            put("error", "suspension_update_failed")
                        },
                    )
                    put(
                        "cascade",
                        JSONObject().apply {
                            put("roomsClosed", 1)
                            put("roomsUpdated", 0)
                            put("partial", true)
                            put("failedRoomIds", JSONArray(listOf("room-x")))
                            put("userDocFailed", true)
                            put("rtdbEventsFailed", 1)
                            put("error", "cascade_failed")
                        },
                    )
                }

            val result = repo.resolveReport("report-1", "suspended")

            assertTrue(result is Resource.Success)
            val outcome = (result as Resource.Success).data
            assertTrue(outcome.hasAnyFailure)
            assertEquals("suspension_update_failed", outcome.suspension?.error)
            assertEquals(true, outcome.cascade?.partial)
            assertEquals("cascade_failed", outcome.cascade?.error)
            assertEquals(listOf("room-x"), outcome.cascade?.failedRoomIds)
        }

    @Test
    fun `resolveReport surfaces pms failure counters`() =
        runTest {
            coEvery { api.post(any(), any()) } returns
                JSONObject().apply {
                    put("success", true)
                    put(
                        "pms",
                        JSONObject().apply {
                            put("failed", 2)
                            put("total", 3)
                        },
                    )
                }

            val result = repo.resolveReport("report-1", "warn")

            assertTrue(result is Resource.Success)
            val outcome = (result as Resource.Success).data
            assertTrue(outcome.hasAnyFailure)
            assertEquals(2, outcome.pms?.failed)
            assertEquals(3, outcome.pms?.total)
        }

    @Test
    fun `resolveReport ignores unknown extra keys on response body`() =
        runTest {
            // Forward compatibility: a future flag (e.g. cooldown) must not
            // break older clients. Parser tolerates and ignores.
            coEvery { api.post(any(), any()) } returns
                JSONObject().apply {
                    put("success", true)
                    put(
                        "cooldown",
                        JSONObject().apply {
                            put("failed", true)
                            put("error", "cooldown_failed")
                        },
                    )
                }

            val result = repo.resolveReport("report-1", "warn")

            assertTrue(result is Resource.Success)
            val outcome = (result as Resource.Success).data
            assertTrue(!outcome.hasAnyFailure)
        }

    // --- getPendingReports ---

    @Test
    fun `getPendingReports returns Success with parsed reports`() =
        runTest {
            coEvery { api.getArray("/api/reports") } returns
                JSONArray().apply {
                    put(
                        JSONObject().apply {
                            put("id", "rpt-1")
                            put("reporterId", "reporter-1")
                            put("reporterName", "Reporter")
                            put("reporterUniqueId", 1001L)
                            put("reportedUserId", "user-1")
                            put("reportedUserName", "Offender")
                            put("reportedUserUniqueId", 2002L)
                            put("conversationId", "conv-1")
                            put("messageId", "msg-1")
                            put("messageText", "bad msg")
                            put("reason", "Spam")
                            put("description", "spamming")
                            put("type", "MESSAGE")
                            put("createdAt", 1700000000000L)
                            put("status", "pending")
                        },
                    )
                }

            val result = repo.getPendingReports()

            assertTrue(result is Resource.Success)
            val reports = (result as Resource.Success).data
            assertEquals(1, reports.size)
            assertEquals("rpt-1", reports[0].reportId)
            assertEquals("reporter-1", reports[0].reporterId)
            assertEquals("Reporter", reports[0].reporterName)
            assertEquals(1001L, reports[0].reporterUniqueId)
            assertEquals("Offender", reports[0].reportedUserName)
            assertEquals(2002L, reports[0].reportedUserUniqueId)
            assertEquals("Spam", reports[0].reason)
            assertEquals("message", reports[0].type) // lowercased
            assertEquals("pending", reports[0].status)
        }

    @Test
    fun `getPendingReports returns empty list when no reports`() =
        runTest {
            coEvery { api.getArray("/api/reports") } returns JSONArray()

            val result = repo.getPendingReports()

            assertTrue(result is Resource.Success)
            assertEquals(0, (result as Resource.Success).data.size)
        }

    @Test
    fun `getPendingReports returns Error on exception`() =
        runTest {
            coEvery { api.getArray("/api/reports") } throws RuntimeException("Fail")

            val result = repo.getPendingReports()

            assertTrue(result is Resource.Error)
        }
}
