package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.feature.messaging.Report
import org.json.JSONArray
import org.json.JSONObject

class ReportRepositoryImpl(
    private val api: WorkerApiClient
) : ReportRepository {

    override suspend fun reportMessage(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        messageId: String,
        messageText: String,
        reason: String,
        description: String
    ): Resource<Unit> = firebaseCall("Failed to submit report") {
        api.post("/api/reports", JSONObject().apply {
            put("reportedUserId", reportedUserId)
            put("reportedUserName", reportedUserName)
            put("reportedUserUniqueId", reportedUserUniqueId)
            put("conversationId", conversationId)
            put("messageId", messageId)
            put("messageText", messageText)
            put("reason", reason)
            put("description", description)
        })
        Unit
    }

    override suspend fun reportUser(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        reason: String,
        description: String,
        evidenceUrls: List<String>
    ): Resource<Unit> = firebaseCall("Failed to submit report") {
        api.post("/api/reports", JSONObject().apply {
            put("reportedUserId", reportedUserId)
            put("reportedUserName", reportedUserName)
            put("reportedUserUniqueId", reportedUserUniqueId)
            put("conversationId", conversationId)
            put("reason", reason)
            put("description", description)
            if (evidenceUrls.isNotEmpty()) {
                put("evidenceUrls", JSONArray(evidenceUrls))
            }
        })
        Unit
    }

    override suspend fun getPendingReports(): Resource<List<Report>> =
        firebaseCall("Failed to load reports") {
            val arr = api.getArray("/api/reports")
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Report(
                    reportId = obj.optString("id"),
                    reporterId = obj.optString("reporter_id"),
                    reporterName = obj.optString("reporter_name"),
                    reporterUniqueId = obj.optLong("reporter_unique_id", 0L),
                    reportedUserId = obj.optString("reported_user_id"),
                    reportedUserName = obj.optString("reported_user_name"),
                    reportedUserUniqueId = obj.optLong("reported_user_unique_id", 0L),
                    conversationId = obj.optString("conversation_id"),
                    messageId = obj.optString("message_id"),
                    messageText = obj.optString("message_text"),
                    reason = obj.optString("reason"),
                    description = obj.optString("description"),
                    type = obj.optString("type", "").lowercase(),
                    timestamp = obj.optLong("created_at", 0L),
                    status = obj.optString("status", "pending")
                )
            }
        }

    override suspend fun resolveReport(reportId: String, action: String): Resource<Unit> =
        firebaseCall("Failed to resolve report") {
            api.post("/api/reports/$reportId/resolve", JSONObject().apply {
                put("action", action)
            })
            Unit
        }
}
