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
    fun `reportMessage posts to correct endpoint`() = runTest {
        coEvery { api.post("/api/reports", any()) } returns JSONObject().apply {
            put("success", true)
            put("reportId", "rpt-1")
        }

        val result = repo.reportMessage(
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
            description = "This is spam"
        )

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/reports", any()) }
    }

    @Test
    fun `reportMessage sends correct body fields`() = runTest {
        val bodySlot = slot<JSONObject>()
        coEvery { api.post("/api/reports", capture(bodySlot)) } returns JSONObject().apply {
            put("success", true)
        }

        repo.reportMessage(
            reporterId = "r", reporterName = "R", reporterUniqueId = 1L,
            reportedUserId = "user-1", reportedUserName = "User One",
            reportedUserUniqueId = 2L, conversationId = "conv-1",
            messageId = "msg-1", messageText = "bad",
            reason = "Harassment", description = "desc"
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
    fun `reportMessage returns Error on exception`() = runTest {
        coEvery { api.post("/api/reports", any()) } throws RuntimeException("Network error")

        val result = repo.reportMessage(
            reporterId = "r", reporterName = "R", reporterUniqueId = 1L,
            reportedUserId = "u", reportedUserName = "U", reportedUserUniqueId = 2L,
            conversationId = "c", messageId = "m", messageText = "t",
            reason = "Spam", description = "d"
        )

        assertTrue(result is Resource.Error)
    }

    // --- reportUser ---

    @Test
    fun `reportUser posts to correct endpoint`() = runTest {
        coEvery { api.post("/api/reports", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.reportUser(
            reporterId = "reporter-1",
            reporterName = "Reporter",
            reporterUniqueId = 1001L,
            reportedUserId = "user-1",
            reportedUserName = "User",
            reportedUserUniqueId = 2002L,
            conversationId = "conv-1",
            reason = "Inappropriate Content",
            description = "Bad profile"
        )

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/reports", any()) }
    }

    @Test
    fun `reportUser includes evidenceUrls when not empty`() = runTest {
        val bodySlot = slot<JSONObject>()
        coEvery { api.post("/api/reports", capture(bodySlot)) } returns JSONObject().apply {
            put("success", true)
        }

        repo.reportUser(
            reporterId = "r", reporterName = "R", reporterUniqueId = 1L,
            reportedUserId = "u", reportedUserName = "U", reportedUserUniqueId = 2L,
            conversationId = "c", reason = "Spam", description = "d",
            evidenceUrls = listOf("https://img.example.com/1.jpg", "https://img.example.com/2.jpg")
        )

        val urls = bodySlot.captured.getJSONArray("evidenceUrls")
        assertEquals(2, urls.length())
        assertEquals("https://img.example.com/1.jpg", urls.getString(0))
    }

    @Test
    fun `reportUser omits evidenceUrls when empty`() = runTest {
        val bodySlot = slot<JSONObject>()
        coEvery { api.post("/api/reports", capture(bodySlot)) } returns JSONObject().apply {
            put("success", true)
        }

        repo.reportUser(
            reporterId = "r", reporterName = "R", reporterUniqueId = 1L,
            reportedUserId = "u", reportedUserName = "U", reportedUserUniqueId = 2L,
            conversationId = "c", reason = "Spam", description = "d",
            evidenceUrls = emptyList()
        )

        assertTrue(!bodySlot.captured.has("evidenceUrls"))
    }

    // --- resolveReport ---

    @Test
    fun `resolveReport posts to correct endpoint with action`() = runTest {
        val bodySlot = slot<JSONObject>()
        coEvery { api.post("/api/reports/report-1/resolve", capture(bodySlot)) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.resolveReport("report-1", "warn")

        assertTrue(result is Resource.Success)
        assertEquals("warn", bodySlot.captured.getString("action"))
    }

    @Test
    fun `resolveReport returns Error on exception`() = runTest {
        coEvery { api.post(any(), any()) } throws RuntimeException("Fail")

        val result = repo.resolveReport("report-1", "dismiss")

        assertTrue(result is Resource.Error)
    }

    // --- getPendingReports ---

    @Test
    fun `getPendingReports returns Success with parsed reports`() = runTest {
        coEvery { api.getArray("/api/reports") } returns JSONArray().apply {
            put(JSONObject().apply {
                put("id", "rpt-1")
                put("reporter_id", "reporter-1")
                put("reporter_name", "Reporter")
                put("reporter_unique_id", 1001L)
                put("reported_user_id", "user-1")
                put("reported_user_name", "Offender")
                put("reported_user_unique_id", 2002L)
                put("conversation_id", "conv-1")
                put("message_id", "msg-1")
                put("message_text", "bad msg")
                put("reason", "Spam")
                put("description", "spamming")
                put("type", "MESSAGE")
                put("created_at", 1700000000000L)
                put("status", "pending")
            })
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
    fun `getPendingReports returns empty list when no reports`() = runTest {
        coEvery { api.getArray("/api/reports") } returns JSONArray()

        val result = repo.getPendingReports()

        assertTrue(result is Resource.Success)
        assertEquals(0, (result as Resource.Success).data.size)
    }

    @Test
    fun `getPendingReports returns Error on exception`() = runTest {
        coEvery { api.getArray("/api/reports") } throws RuntimeException("Fail")

        val result = repo.getPendingReports()

        assertTrue(result is Resource.Error)
    }
}
