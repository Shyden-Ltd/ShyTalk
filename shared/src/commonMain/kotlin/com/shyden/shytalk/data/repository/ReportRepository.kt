package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface ReportRepository {
    @Suppress("kotlin:S107")
    suspend fun reportMessage(
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
    ): Resource<Unit>

    @Suppress("kotlin:S107")
    suspend fun reportUser(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        reason: String,
        description: String,
        evidenceUrls: List<String> = emptyList(),
    ): Resource<Unit>

    suspend fun getPendingReports(): Resource<List<com.shyden.shytalk.feature.messaging.Report>>

    suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<ResolveReportOutcome>
}
