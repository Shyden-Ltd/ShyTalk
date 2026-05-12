package com.shyden.shytalk.feature.report

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.feature.messaging.Report
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Exhaustive branch coverage for [submitUserReport]. Pins the contract so a
 * future caller (a third report surface, an admin re-submit flow) sees the
 * exact same outcome shape, and so a regression in the evidence-upload or
 * Resource-mapping logic is caught without touching the VM layer.
 *
 * The helper exists to break the 33-line SonarCloud duplication block
 * between RoomViewModel.reportUser and ProfileViewModel.reportUser, but the
 * tests treat it as a first-class production contract — every Resource
 * branch + every early-return branch + every evidence-upload count gets
 * a row.
 */
class UserReportSubmissionTest {
    @Test
    fun `happy path with no evidence returns Success and posts to API`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage = RecordingStorageRepository()
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Spam",
                    description = "Promotional links",
                    evidenceImages = emptyList(),
                )
            assertEquals(UserReportOutcome.Success, outcome)
            assertEquals(0, storage.uploadCalls.size)
            assertEquals(1, report.reportUserCalls.size)
            val call = report.reportUserCalls.first()
            assertEquals(REPORTER.firebaseUid, call.reporterId)
            assertEquals(TARGET.firebaseUid, call.reportedUserId)
            assertEquals(REPORTER.uniqueId, call.reporterUniqueId)
            assertEquals(TARGET.uniqueId, call.reportedUserUniqueId)
            assertEquals("Spam", call.reason)
            assertEquals("Promotional links", call.description)
            assertEquals("", call.conversationId)
            assertTrue(call.evidenceUrls.isEmpty())
        }

    @Test
    fun `happy path with one evidence image uploads then reports`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage =
                RecordingStorageRepository(
                    uploadResults = listOf(Resource.Success("https://cdn/evidence-1.jpg")),
                )
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Harassment",
                    description = "Screenshot attached",
                    evidenceImages = listOf(byteArrayOf(1, 2, 3) to "image/png"),
                )
            assertEquals(UserReportOutcome.Success, outcome)
            assertEquals(1, storage.uploadCalls.size)
            assertEquals(REPORTER.uid, storage.uploadCalls.first().userId)
            assertEquals("report_evidence", storage.uploadCalls.first().path)
            assertEquals("image/png", storage.uploadCalls.first().contentType)
            assertEquals(
                listOf("https://cdn/evidence-1.jpg"),
                report.reportUserCalls.first().evidenceUrls,
            )
        }

    @Test
    fun `happy path with two evidence images posts both URLs in order`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage =
                RecordingStorageRepository(
                    uploadResults =
                        listOf(
                            Resource.Success("https://cdn/a.jpg"),
                            Resource.Success("https://cdn/b.jpg"),
                        ),
                )
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Inappropriate Content",
                    description = "",
                    evidenceImages =
                        listOf(
                            byteArrayOf(1) to "image/jpeg",
                            byteArrayOf(2) to "image/jpeg",
                        ),
                )
            assertEquals(UserReportOutcome.Success, outcome)
            assertEquals(2, storage.uploadCalls.size)
            assertEquals(
                listOf("https://cdn/a.jpg", "https://cdn/b.jpg"),
                report.reportUserCalls.first().evidenceUrls,
            )
        }

    @Test
    fun `evidence upload Error on first image short-circuits to EvidenceUploadFailed`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage =
                RecordingStorageRepository(
                    uploadResults = listOf(Resource.Error("R2 timeout")),
                )
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Other",
                    description = "",
                    evidenceImages =
                        listOf(
                            byteArrayOf(1) to "image/jpeg",
                            byteArrayOf(2) to "image/jpeg",
                        ),
                )
            assertEquals(UserReportOutcome.EvidenceUploadFailed, outcome)
            // Second image MUST NOT be attempted after the first one fails.
            assertEquals(1, storage.uploadCalls.size)
            // Report endpoint MUST NOT be called when evidence upload failed.
            assertEquals(0, report.reportUserCalls.size)
        }

    @Test
    fun `evidence upload Error on second image still short-circuits`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage =
                RecordingStorageRepository(
                    uploadResults =
                        listOf(
                            Resource.Success("https://cdn/a.jpg"),
                            Resource.Error("R2 timeout"),
                        ),
                )
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Other",
                    description = "",
                    evidenceImages =
                        listOf(
                            byteArrayOf(1) to "image/jpeg",
                            byteArrayOf(2) to "image/jpeg",
                        ),
                )
            assertEquals(UserReportOutcome.EvidenceUploadFailed, outcome)
            assertEquals(2, storage.uploadCalls.size)
            assertEquals(0, report.reportUserCalls.size)
        }

    @Test
    fun `evidence upload Loading is skipped without adding to URLs`() =
        runTest {
            // Resource.Loading is the "in-flight" sentinel and should be ignored
            // by the helper (Unit branch). The image just isn't included in the
            // evidence URL list; submission still proceeds.
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage =
                RecordingStorageRepository(
                    uploadResults =
                        listOf(
                            Resource.Loading,
                            Resource.Success("https://cdn/b.jpg"),
                        ),
                )
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Other",
                    description = "",
                    evidenceImages =
                        listOf(
                            byteArrayOf(1) to "image/jpeg",
                            byteArrayOf(2) to "image/jpeg",
                        ),
                )
            assertEquals(UserReportOutcome.Success, outcome)
            assertEquals(
                listOf("https://cdn/b.jpg"),
                report.reportUserCalls.first().evidenceUrls,
            )
        }

    @Test
    fun `reportUser Resource Error maps to ReportSubmitFailed`() =
        runTest {
            val report =
                RecordingReportRepository(reportUser = Resource.Error("HTTP 500"))
            val storage = RecordingStorageRepository()
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Spam",
                    description = "",
                    evidenceImages = emptyList(),
                )
            assertEquals(UserReportOutcome.ReportSubmitFailed, outcome)
        }

    @Test
    fun `reportUser Resource Loading maps to ReportSubmitFailed`() =
        runTest {
            // Loading from a suspend call is unusual — Resource.Loading is normally
            // emitted from a Flow, not returned from a `suspend fun`. We still pin
            // the mapping so a future repository that does return Loading from
            // reportUser surfaces as a failed submission rather than a silent
            // "report sent" toast.
            val report = RecordingReportRepository(reportUser = Resource.Loading)
            val storage = RecordingStorageRepository()
            val outcome =
                submitUserReport(
                    reportRepository = report,
                    storageRepository = storage,
                    currentUser = REPORTER,
                    targetUser = TARGET,
                    reason = "Spam",
                    description = "",
                    evidenceImages = emptyList(),
                )
            assertEquals(UserReportOutcome.ReportSubmitFailed, outcome)
        }

    @Test
    fun `conversationId default is empty string`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage = RecordingStorageRepository()
            submitUserReport(
                reportRepository = report,
                storageRepository = storage,
                currentUser = REPORTER,
                targetUser = TARGET,
                reason = "Spam",
                description = "",
                evidenceImages = emptyList(),
            )
            assertEquals("", report.reportUserCalls.first().conversationId)
        }

    @Test
    fun `conversationId override propagates to the API call`() =
        runTest {
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage = RecordingStorageRepository()
            submitUserReport(
                reportRepository = report,
                storageRepository = storage,
                currentUser = REPORTER,
                targetUser = TARGET,
                reason = "Spam",
                description = "",
                evidenceImages = emptyList(),
                conversationId = "room-xyz",
            )
            assertEquals("room-xyz", report.reportUserCalls.first().conversationId)
        }

    @Test
    fun `firebaseUid not uid is used as reporterId and reportedUserId`() =
        runTest {
            // Pinpoint regression test for the pre-existing bug: helpers MUST send
            // currentUser.firebaseUid (not .uid). User.uid in this codebase equals
            // the Firestore doc key (= numeric uniqueId as String), which the
            // server's resolveUniqueId middleware cannot resolve back to a user.
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage = RecordingStorageRepository()
            val reporterWithDistinctIds =
                User(uid = "100000001", firebaseUid = "firebase-abc-123", uniqueId = 100000001L)
            val targetWithDistinctIds =
                User(uid = "100000002", firebaseUid = "firebase-def-456", uniqueId = 100000002L)
            submitUserReport(
                reportRepository = report,
                storageRepository = storage,
                currentUser = reporterWithDistinctIds,
                targetUser = targetWithDistinctIds,
                reason = "Spam",
                description = "",
                evidenceImages = emptyList(),
            )
            val call = report.reportUserCalls.first()
            assertEquals("firebase-abc-123", call.reporterId)
            assertEquals("firebase-def-456", call.reportedUserId)
            // ...not "100000001" / "100000002" — that would be the bug.
        }

    @Test
    fun `evidence upload uses currentUser uid as the userId arg`() =
        runTest {
            // Evidence files are stored under the *reporter's* user folder in R2
            // (R2_BUCKET/<reporterUid>/report_evidence/<filename>). Pin this so a
            // future refactor doesn't accidentally store evidence under the
            // reported user's folder (privacy violation — the reported user
            // could later download evidence against themselves).
            val report = RecordingReportRepository(reportUser = Resource.Success(Unit))
            val storage =
                RecordingStorageRepository(
                    uploadResults = listOf(Resource.Success("https://cdn/x.jpg")),
                )
            submitUserReport(
                reportRepository = report,
                storageRepository = storage,
                currentUser = REPORTER,
                targetUser = TARGET,
                reason = "Spam",
                description = "",
                evidenceImages = listOf(byteArrayOf(9) to "image/jpeg"),
            )
            assertEquals(REPORTER.uid, storage.uploadCalls.first().userId)
        }

    companion object {
        private val REPORTER =
            User(
                uid = "doc-reporter",
                firebaseUid = "fb-reporter",
                uniqueId = 100000001L,
                displayName = "Alice",
            )
        private val TARGET =
            User(
                uid = "doc-target",
                firebaseUid = "fb-target",
                uniqueId = 100000002L,
                displayName = "Bob",
            )
    }
}

private data class ReportUserCall(
    val reporterId: String,
    val reporterName: String,
    val reporterUniqueId: Long,
    val reportedUserId: String,
    val reportedUserName: String,
    val reportedUserUniqueId: Long,
    val conversationId: String,
    val reason: String,
    val description: String,
    val evidenceUrls: List<String>,
)

private data class UploadImageCall(
    val userId: String,
    val path: String,
    val contentType: String,
)

private class RecordingReportRepository(
    private val reportUser: Resource<Unit> = Resource.Success(Unit),
) : ReportRepository {
    val reportUserCalls = mutableListOf<ReportUserCall>()

    @Suppress("LongParameterList")
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
    ): Resource<Unit> {
        reportUserCalls.add(
            ReportUserCall(
                reporterId,
                reporterName,
                reporterUniqueId,
                reportedUserId,
                reportedUserName,
                reportedUserUniqueId,
                conversationId,
                reason,
                description,
                evidenceUrls.toList(),
            ),
        )
        return reportUser
    }

    @Suppress("LongParameterList")
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

    override suspend fun getPendingReports(): Resource<List<Report>> = Resource.Success(emptyList())

    override suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<com.shyden.shytalk.data.repository.ResolveReportOutcome> =
        Resource.Success(
            com.shyden.shytalk.data.repository
                .ResolveReportOutcome(),
        )
}

private class RecordingStorageRepository(
    private val uploadResults: List<Resource<String>> = emptyList(),
) : StorageRepository {
    val uploadCalls = mutableListOf<UploadImageCall>()

    override suspend fun uploadImage(
        userId: String,
        path: String,
        imageData: ByteArray,
        contentType: String,
    ): Resource<String> {
        val idx = uploadCalls.size
        uploadCalls.add(UploadImageCall(userId, path, contentType))
        return uploadResults.getOrElse(idx) { Resource.Success("https://cdn/default-$idx.jpg") }
    }

    override suspend fun deleteImageByUrl(url: String) = Unit
}
