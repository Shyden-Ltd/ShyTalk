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

                is Resource.Loading -> Unit
            }
        }
    }

    fun resolveReport(
        reportId: String,
        action: String,
    ) {
        viewModelScope.launch {
            when (val result = reportRepository.resolveReport(reportId, action)) {
                is Resource.Success -> {
                    // Always drop the report from the local list — even on
                    // partial-failure the backend marks `status:'resolved'`
                    // before any sub-action runs, so the report won't return
                    // on the next pending-reports query. Keeping it in the
                    // list would mislead the admin into thinking the resolve
                    // can be retried in-place; the retry path is per-sub-
                    // action through the targeted admin tabs (warn, suspend).
                    val outcome = result.data
                    val message =
                        if (outcome.hasAnyFailure) {
                            // Log the structured outcome so an admin reading
                            // logcat can see WHICH sub-action failed (the toast
                            // is intentionally generic — full detail belongs in
                            // the admin web panel, not a phone toast).
                            logI(
                                TAG,
                                "Report $reportId resolved with partial failure: " +
                                    "warning=${outcome.warning?.error} " +
                                    "suspension=${outcome.suspension?.error} " +
                                    "auditLog=${outcome.auditLog?.error} " +
                                    "lockRelease=${outcome.lockRelease != null} " +
                                    "cascade.partial=${outcome.cascade?.partial} " +
                                    "pms=${outcome.pms?.failed}/${outcome.pms?.total}",
                            )
                            UiText.res(Res.string.success_report_resolved_with_issues)
                        } else {
                            UiText.res(Res.string.success_report_resolved)
                        }
                    _uiState.update {
                        it.copy(
                            reports = it.reports.filter { r -> r.reportId != reportId },
                            message = message,
                        )
                    }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(message = UiText.res(Res.string.error_resolve_report)) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
