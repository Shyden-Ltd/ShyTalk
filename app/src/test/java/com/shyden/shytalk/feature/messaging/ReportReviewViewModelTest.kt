package com.shyden.shytalk.feature.messaging

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
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

    private val sampleReports = listOf(
        TestData.createTestReport(reportId = "r1", reason = "Spam"),
        TestData.createTestReport(reportId = "r2", reason = "Harassment"),
        TestData.createTestReport(reportId = "r3", reason = "Inappropriate")
    )

    @Test
    fun `init loads pending reports`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(3, state.reports.size)
        assertFalse(state.isLoading)
        assertNull(state.message)
    }

    @Test
    fun `init failure sets message`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Error("Failed to load")

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("Failed to load", state.message)
        assertFalse(state.isLoading)
    }

    @Test
    fun `resolveReport success removes report from list`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
        coEvery { reportRepository.resolveReport("r2", "dismiss") } returns Resource.Success(Unit)

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        vm.resolveReport("r2", "dismiss")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(2, state.reports.size)
        assertFalse(state.reports.any { it.reportId == "r2" })
    }

    @Test
    fun `resolveReport success sets Report resolved message`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
        coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Success(Unit)

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        vm.resolveReport("r1", "warn")
        advanceUntilIdle()

        assertEquals("Report resolved", vm.uiState.value.message)
    }

    @Test
    fun `resolveReport failure sets error message`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
        coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Error("Server error")

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        vm.resolveReport("r1", "warn")
        advanceUntilIdle()

        assertEquals("Failed to resolve report", vm.uiState.value.message)
        // Reports list unchanged
        assertEquals(3, vm.uiState.value.reports.size)
    }

    @Test
    fun `clearMessage clears message`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(sampleReports)
        coEvery { reportRepository.resolveReport("r1", "warn") } returns Resource.Success(Unit)

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        vm.resolveReport("r1", "warn")
        advanceUntilIdle()
        assertEquals("Report resolved", vm.uiState.value.message)

        vm.clearMessage()
        assertNull(vm.uiState.value.message)
    }

    @Test
    fun `init with no reports sets empty list`() = runTest {
        coEvery { reportRepository.getPendingReports() } returns Resource.Success(emptyList())

        val vm = ReportReviewViewModel(reportRepository, userRepository)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.reports.isEmpty())
        assertFalse(state.isLoading)
    }
}
