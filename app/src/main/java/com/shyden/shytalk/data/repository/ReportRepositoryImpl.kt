package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.feature.messaging.Report
import org.json.JSONArray
import org.json.JSONObject as OrgJsonObject

class ReportRepositoryImpl(
    private val api: WorkerApiClient,
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
        description: String,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to submit report") {
            api.post(
                "/api/reports",
                OrgJsonObject().apply {
                    put("reportedUserId", reportedUserId)
                    put("reportedUserName", reportedUserName)
                    put("reportedUserUniqueId", reportedUserUniqueId)
                    put("conversationId", conversationId)
                    put("messageId", messageId)
                    put("messageText", messageText)
                    put("reason", reason)
                    put("description", description)
                },
            )
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
        evidenceUrls: List<String>,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to submit report") {
            api.post(
                "/api/reports",
                OrgJsonObject().apply {
                    put("reportedUserId", reportedUserId)
                    put("reportedUserName", reportedUserName)
                    put("reportedUserUniqueId", reportedUserUniqueId)
                    put("conversationId", conversationId)
                    put("reason", reason)
                    put("description", description)
                    if (evidenceUrls.isNotEmpty()) {
                        put("evidenceUrls", JSONArray(evidenceUrls))
                    }
                },
            )
        }

    override suspend fun getPendingReports(): Resource<List<Report>> =
        firebaseCall("Failed to load reports") {
            val arr = api.getArray("/api/reports")
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Report(
                    reportId = obj.optString("id"),
                    reporterId = obj.optString("reporterId"),
                    reporterName = obj.optString("reporterName"),
                    reporterUniqueId = obj.optLong("reporterUniqueId", 0L),
                    reportedUserId = obj.optString("reportedUserId"),
                    reportedUserName = obj.optString("reportedUserName"),
                    reportedUserUniqueId = obj.optLong("reportedUserUniqueId", 0L),
                    conversationId = obj.optString("conversationId"),
                    messageId = obj.optString("messageId"),
                    messageText = obj.optString("messageText"),
                    reason = obj.optString("reason"),
                    description = obj.optString("description"),
                    type = obj.optString("type", "").lowercase(),
                    timestamp = obj.optLong("createdAt", 0L),
                    status = obj.optString("status", "pending"),
                )
            }
        }

    override suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<ResolveReportOutcome> =
        firebaseCall("Failed to resolve report") {
            val response =
                api.post(
                    "/api/reports/$reportId/resolve",
                    OrgJsonObject().apply {
                        put("action", action)
                    },
                )
            // String overload keeps kotlinx.serialization a shared-internal
            // dep — :app stays on org.json. Hop is paid only on resolveReport.
            parseResolveReportOutcome(response.toString())
        }
}
