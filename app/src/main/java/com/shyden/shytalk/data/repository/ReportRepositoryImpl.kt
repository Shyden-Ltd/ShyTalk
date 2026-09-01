package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
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
}
