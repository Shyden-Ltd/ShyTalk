package com.shyden.shytalk.feature.support

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.RaiseTicketOutcome
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.data.repository.SupportRepository
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.support_form_error_already_open
import com.shyden.shytalk.resources.support_form_error_empty
import com.shyden.shytalk.resources.support_form_error_generic
import com.shyden.shytalk.resources.support_form_error_too_long
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val TAG = "SupportForm"

/** Mirrors the server's bound in `routes/support-tickets.js`. */
const val SUPPORT_MESSAGE_MAX_LENGTH = 2000

data class SupportFormUiState(
    val message: String = "",
    /**
     * Never absent. Every entry point knows why somebody is there — the age gate
     * on Lucky Spin, the age gate on private messages, or the general route from
     * settings — so nobody is asked to categorise their own problem.
     */
    val category: SupportCategory = SupportCategory.Other,
    val isSubmitting: Boolean = false,
    val submitted: Boolean = false,
    /**
     * Distinct from [error] because it is not a failure the person can fix by
     * retrying — they already have a request open, and telling them so is the
     * whole point.
     */
    val alreadyHasOpenTicket: Boolean = false,
    val error: UiText? = null,
)

/**
 * The in-app support form — SHY-0385.
 *
 * The behaviour that matters here is what happens when sending FAILS. Somebody
 * raising a support ticket is already having a bad time; losing what they wrote
 * to a dropped connection is the worst thing this screen can do. So the message
 * is never cleared on failure, and a retry re-sends what is still on screen.
 */
class SupportFormViewModel(
    private val supportRepository: SupportRepository,
    initialCategory: SupportCategory,
    private val context: Map<String, String>,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SupportFormUiState(category = initialCategory))
    val uiState: StateFlow<SupportFormUiState> = _uiState.asStateFlow()

    fun updateMessage(value: String) {
        // Typing clears a previous complaint: the person is already acting on it,
        // and leaving the error up reads as though it applies to the new text.
        _uiState.update { it.copy(message = value, error = null, alreadyHasOpenTicket = false) }
    }

    fun submit() {
        val state = _uiState.value
        if (state.isSubmitting) return // Double-tap sends once.

        val trimmed = state.message.trim()
        if (trimmed.isEmpty()) {
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_empty)) }
            return
        }
        if (trimmed.length > SUPPORT_MESSAGE_MAX_LENGTH) {
            // Bounded, never silently truncated -- cutting somebody's message in
            // half loses the part they cared about and tells them nothing.
            //
            // Measured on `trimmed`, because `trimmed` is what gets sent and what
            // the server bounds. Measuring the raw field instead refused a message
            // that would have been accepted, purely for trailing whitespace.
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_too_long)) }
            return
        }

        _uiState.update { it.copy(isSubmitting = true, error = null, alreadyHasOpenTicket = false) }

        viewModelScope.launch {
            when (val outcome = supportRepository.raiseTicket(trimmed, state.category, context)) {
                is RaiseTicketOutcome.Raised -> {
                    logI(TAG, "Support ticket raised: ${outcome.ticketId}")
                    _uiState.update { it.copy(isSubmitting = false, submitted = true) }
                }

                RaiseTicketOutcome.AlreadyOpen ->
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            alreadyHasOpenTicket = true,
                            error = UiText.res(Res.string.support_form_error_already_open),
                        )
                    }

                is RaiseTicketOutcome.Failed -> {
                    // The person sees one plain sentence — the server's wording is
                    // English and would be unreadable to most of the people who hit
                    // this. It still has to reach the log, or "support tickets are
                    // not sending" is a report with no evidence behind it.
                    logW(TAG, "Support ticket failed: ${outcome.message}")
                    // The typed message is deliberately left in place so a retry
                    // costs nothing. `it.copy` keeps it; clearing it here is the bug.
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            error = UiText.res(Res.string.support_form_error_generic),
                        )
                    }
                }
            }
        }
    }
}
