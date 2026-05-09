package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.ResolveReportOutcome
import com.shyden.shytalk.feature.messaging.Report

class FakeReportRepository : ReportRepository {
    val reports = mutableListOf<Report>()

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
    ): Resource<Unit> = Resource.Success(Unit)

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
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getPendingReports(): Resource<List<Report>> = Resource.Success(reports)

    override suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<ResolveReportOutcome> = Resource.Success(ResolveReportOutcome())
}
