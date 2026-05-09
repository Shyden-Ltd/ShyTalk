package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.PmFailure
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.ResolveReportOutcome
import com.shyden.shytalk.data.repository.SubFailure
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReportReviewViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val reportRepository = mockk<ReportRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)

    private val activeViewModels = mutableListOf<ReportReviewViewModel>()

    private val sampleReports =
        listOf(
            TestData.createTestReport(reportId = "r1", reason = "Spam"),
            TestData.createTestReport(reportId = "r2", reason = "Harassment"),
            TestData.createTestReport(reportId = "r3", reason = "Inappropriate"),
        )

    private fun createViewModel(): ReportReviewViewModel =
        ReportReviewViewModel(reportRepository, userRepository)
            .also { activeViewModels.add(it) }

    @After
    fun tearDown() =
        runBlocking {
            activeViewModels.forEach {
                it.viewModelScope.coroutineContext.job
                    .cancelAndJoin()
            }
            activeViewModels.clear()
        }

    @Test
    fun `init loads pending reports`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)

            val vm = createViewModel()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(3, state.reports.size)
            assertFalse(state.isLoading)
            assertNull(state.message)
        }

    @Test
    fun `init failure sets message`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Error("Failed to load")

            val vm = createViewModel()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(UiText.Plain("Failed to load"), state.message)
            assertFalse(state.isLoading)
        }

    @Test
    fun `resolveReport success removes report from list`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r2", "dismiss") } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()

            vm.resolveReport("r2", "dismiss")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(2, state.reports.size)
            assertFalse(state.reports.any { it.reportId == "r2" })
        }

    @Test
    fun `resolveReport success sets Report resolved message`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()

            vm.resolveReport("r1", "warn")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.message is UiText.Res)
        }

    @Test
    fun `resolveReport failure sets error message`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Error("Server error")

            val vm = createViewModel()
            advanceUntilIdle()

            vm.resolveReport("r1", "warn")
            advanceUntilIdle()

            assertTrue(vm.uiState.value.message is UiText.Res)
            // Reports list unchanged
            assertEquals(3, vm.uiState.value.reports.size)
        }

    @Test
    fun `clearMessage clears message`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()

            vm.resolveReport("r1", "warn")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.message is UiText.Res)

            vm.clearMessage()
            assertNull(vm.uiState.value.message)
        }

    @Test
    fun `init with no reports sets empty list`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(emptyList())

            val vm = createViewModel()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.reports.isEmpty())
            assertFalse(state.isLoading)
        }

    @Test
    fun `resolveReport dismiss removes report from list`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r1", "dismiss") } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()
            assertEquals(3, vm.uiState.value.reports.size)

            vm.resolveReport("r1", "dismiss")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(2, state.reports.size)
            assertFalse(state.reports.any { it.reportId == "r1" })
            assertTrue(state.message is UiText.Res)
        }

    @Test
    fun `resolveReport warn removes report and shows confirmation`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r3", "warn") } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()
            assertEquals(3, vm.uiState.value.reports.size)

            vm.resolveReport("r3", "warn")
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(2, state.reports.size)
            assertFalse(state.reports.any { it.reportId == "r3" })
            assertTrue(state.message is UiText.Res)
        }

    @Test
    fun `resolveReport multiple reports sequentially reduces list correctly`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport(any(), any()) } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()
            assertEquals(3, vm.uiState.value.reports.size)

            vm.resolveReport("r1", "dismiss")
            advanceUntilIdle()
            assertEquals(2, vm.uiState.value.reports.size)

            vm.resolveReport("r2", "warn")
            advanceUntilIdle()
            assertEquals(1, vm.uiState.value.reports.size)
            assertEquals(
                "r3",
                vm.uiState.value.reports[0]
                    .reportId,
            )
        }

    @Test
    fun `resolveReport last remaining report results in empty list`() =
        runTest {
            val singleReport = listOf(TestData.createTestReport(reportId = "r1", reason = "Spam"))
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(singleReport)
            coEvery { reportRepository.resolveReport("r1", "dismiss") } returns Resource.Success(ResolveReportOutcome())

            val vm = createViewModel()
            advanceUntilIdle()
            assertEquals(1, vm.uiState.value.reports.size)

            vm.resolveReport("r1", "dismiss")
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.reports
                    .isEmpty(),
            )
            assertTrue(vm.uiState.value.message is UiText.Res)
        }

    @Test
    fun `init error sets message and stops loading`() =
        runTest {
            coEvery { reportRepository.getPendingReports() } returns Resource.Error("Connection timeout")

            val vm = createViewModel()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(UiText.Plain("Connection timeout"), state.message)
            assertFalse(state.isLoading)
            assertTrue(state.reports.isEmpty())
        }

    // ─── Partial-failure surfacing (B6.12) ──────────────────────────
    //
    // When the backend resolveReport handler partially fails (warn write
    // threw / suspension update threw / cascade partial / lock-release
    // failed / PMs failed), the ViewModel must show a DIFFERENT toast so
    // the admin doesn't get the misleading green "Report resolved" toast.
    // Pre-B6.12 the VM collapsed every Resource.Success → green toast; the
    // Web admin client (PR #355 Pass-9..12) already consumed the flags but
    // the Kotlin admin UI did not. These tests pin the wiring.
    //
    // Note: assertions compare the UiText.Res *resource identity* across
    // outcomes — JVM-test classpath does not expose `Res.string.xxx` (the
    // Compose Multiplatform resource accessors are generated for the
    // shared module, not :app), so we prove "different message per path"
    // rather than naming the specific StringResource.

    private suspend fun TestScope.resolveAndGetMessage(outcome: ResolveReportOutcome): UiText {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
        coEvery { reportRepository.resolveReport(any(), any()) } returns Resource.Success(outcome)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.resolveReport("r1", "warn")
        advanceUntilIdle()
        return vm.uiState.value.message ?: error("expected message")
    }

    @Test
    fun `resolveReport happy path emits a UiText_Res success message`() =
        runTest {
            val message = resolveAndGetMessage(ResolveReportOutcome())
            assertTrue(message is UiText.Res)
        }

    @Test
    fun `resolveReport with warning failure emits a different UiText_Res than happy path`() =
        runTest {
            val happy = resolveAndGetMessage(ResolveReportOutcome())
            val partial =
                resolveAndGetMessage(
                    ResolveReportOutcome(warning = SubFailure("warning_create_failed")),
                )
            assertTrue(happy is UiText.Res)
            assertTrue(partial is UiText.Res)
            // Different StringResource ⇒ different UiText.Res ⇒ data class
            // equality differs. Pre-B6.12 both paths shipped the same toast.
            assertTrue(
                "happy and partial messages must differ — got $happy on both",
                happy != partial,
            )
        }

    @Test
    fun `resolveReport with suspension failure emits partial-failure message`() =
        runTest {
            val happy = resolveAndGetMessage(ResolveReportOutcome())
            val partial =
                resolveAndGetMessage(
                    ResolveReportOutcome(suspension = SubFailure("suspension_update_failed")),
                )
            assertTrue(happy != partial)
        }

    @Test
    fun `resolveReport with auditLog failure emits partial-failure message`() =
        runTest {
            val happy = resolveAndGetMessage(ResolveReportOutcome())
            val partial =
                resolveAndGetMessage(
                    ResolveReportOutcome(auditLog = SubFailure("audit_write_failed")),
                )
            assertTrue(happy != partial)
        }

    @Test
    fun `resolveReport with lockRelease failure emits partial-failure message`() =
        runTest {
            val happy = resolveAndGetMessage(ResolveReportOutcome())
            val partial =
                resolveAndGetMessage(
                    ResolveReportOutcome(lockRelease = SubFailure(error = null)),
                )
            assertTrue(happy != partial)
        }

    @Test
    fun `resolveReport with PM failure emits partial-failure message`() =
        runTest {
            val happy = resolveAndGetMessage(ResolveReportOutcome())
            val partial =
                resolveAndGetMessage(
                    ResolveReportOutcome(pms = PmFailure(failed = 1, total = 2)),
                )
            assertTrue(happy != partial)
        }

    @Test
    fun `resolveReport with partial failure still drops the report from the list`() =
        runTest {
            // Backend marks status='resolved' BEFORE running side-effects, so
            // even a partial failure means the next pending-reports query
            // won't return this report. The local-list filter must mirror.
            coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
            coEvery { reportRepository.resolveReport("r2", "warn") } returns
                Resource.Success(
                    ResolveReportOutcome(warning = SubFailure("warning_create_failed")),
                )

            val vm = createViewModel()
            advanceUntilIdle()
            vm.resolveReport("r2", "warn")
            advanceUntilIdle()

            assertFalse(
                vm.uiState.value.reports
                    .any { it.reportId == "r2" },
            )
            assertEquals(2, vm.uiState.value.reports.size)
        }
}
