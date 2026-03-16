package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class Report(
    val reportId: String = "",
    val reporterId: String = "",
    val reporterName: String = "",
    val reporterUniqueId: Long = 0L,
    val reportedUserId: String = "",
    val reportedUserName: String = "",
    val reportedUserUniqueId: Long = 0L,
    val conversationId: String = "",
    val messageId: String = "",
    val messageText: String = "",
    val reason: String = "",
    val description: String = "",
    val type: String = "", // "message" or "user"
    val timestamp: Long = 0,
    val status: String = "pending", // pending, resolved
)

data class ReportReviewUiState(
    val reports: List<Report> = emptyList(),
    val isLoading: Boolean = true,
    val message: UiText? = null,
)

class ReportReviewViewModel(
    private val reportRepository: ReportRepository,
    private val userRepository: UserRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "ReportReviewViewModel"
    }

    private val _uiState = MutableStateFlow(ReportReviewUiState())
    val uiState: StateFlow<ReportReviewUiState> = _uiState.asStateFlow()

    init {
        logI(TAG, "Loading pending reports")
        loadReports()
    }

    private fun loadReports() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            when (val result = reportRepository.getPendingReports()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(isLoading = false, reports = result.data)
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(isLoading = false, message = UiText.plain(result.message))
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun resolveReport(
        reportId: String,
        action: String,
    ) {
        viewModelScope.launch {
            when (reportRepository.resolveReport(reportId, action)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            reports = it.reports.filter { r -> r.reportId != reportId },
                            message = UiText.res(Res.string.success_report_resolved),
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(message = UiText.res(Res.string.error_resolve_report)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
