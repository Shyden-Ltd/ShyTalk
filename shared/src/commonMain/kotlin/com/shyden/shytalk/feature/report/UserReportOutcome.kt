package com.shyden.shytalk.feature.report

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.StorageRepository

/**
 * Outcome of [submitUserReport]. Callers map each case to their own UI state
 * shape — VMs that use plain-String errors translate the same way VMs that
 * use UiText do. The shared helper just collapses the evidence-upload +
 * reportRepository.reportUser call sequence that was previously duplicated
 * across RoomViewModel.reportUser and ProfileViewModel.reportUser (caught
 * by the SonarCloud 3% new-duplicated-lines gate on PR #652).
 */
internal sealed class UserReportOutcome {
    object Success : UserReportOutcome()

    object EvidenceUploadFailed : UserReportOutcome()

    object ReportSubmitFailed : UserReportOutcome()
}

/**
 * Shared submit-user-report pipeline used by [com.shyden.shytalk.feature.room.RoomViewModel.reportUser]
 * and [com.shyden.shytalk.feature.profile.ProfileViewModel.reportUser].
 *
 * `reporterId` / `reportedUserId` MUST be Firebase Auth UIDs — the Express
 * server's `resolveUniqueId` middleware queries
 * `users.where('firebaseUid','==',uid).limit(1)`. Passing `User.uid`
 * (= Firestore doc key = numeric uniqueId) silently fails resolution and
 * returns "reportedUserId does not match any known user" — pre-existing bug
 * surfaced during the B3 manual-QA cycle (PR #651).
 */
@Suppress("LongParameterList")
internal suspend fun submitUserReport(
    reportRepository: ReportRepository,
    storageRepository: StorageRepository,
    currentUser: User,
    targetUser: User,
    reason: String,
    description: String,
    evidenceImages: List<Pair<ByteArray, String>>,
    conversationId: String = "",
): UserReportOutcome {
    val evidenceUrls = mutableListOf<String>()
    for ((bytes, mimeType) in evidenceImages) {
        when (
            val result =
                storageRepository.uploadImage(
                    userId = currentUser.uid,
                    path = "report_evidence",
                    imageData = bytes,
                    contentType = mimeType,
                )
        ) {
            is Resource.Success -> evidenceUrls.add(result.data)
            is Resource.Error -> return UserReportOutcome.EvidenceUploadFailed
            is Resource.Loading -> Unit
        }
    }
    return when (
        reportRepository.reportUser(
            reporterId = currentUser.firebaseUid,
            reporterName = currentUser.displayName,
            reporterUniqueId = currentUser.uniqueId,
            reportedUserId = targetUser.firebaseUid,
            reportedUserName = targetUser.displayName,
            reportedUserUniqueId = targetUser.uniqueId,
            conversationId = conversationId,
            reason = reason,
            description = description,
            evidenceUrls = evidenceUrls,
        )
    ) {
        is Resource.Success -> UserReportOutcome.Success
        is Resource.Error -> UserReportOutcome.ReportSubmitFailed
        is Resource.Loading -> UserReportOutcome.ReportSubmitFailed
    }
}
