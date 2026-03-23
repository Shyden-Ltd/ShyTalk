package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
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
            coEvery { reportRepository.resolveReport("r2", "dismiss") } returns Resource.Success(Unit)

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
            coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Success(Unit)

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
            coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Success(Unit)

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
            coEvery { reportRepository.resolveReport("r1", "dismiss") } returns Resource.Success(Unit)

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
            coEvery { reportRepository.resolveReport("r3", "warn") } returns Resource.Success(Unit)

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
            coEvery { reportRepository.resolveReport(any(), any()) } returns Resource.Success(Unit)

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
            coEvery { reportRepository.resolveReport("r1", "dismiss") } returns Resource.Success(Unit)

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
}
