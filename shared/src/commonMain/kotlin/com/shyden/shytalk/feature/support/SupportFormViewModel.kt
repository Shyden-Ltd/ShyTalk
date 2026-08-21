package com.shyden.shytalk.feature.support

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.RaiseTicketOutcome
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.data.repository.SupportRepository
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.support_form_error_already_open
import com.shyden.shytalk.resources.support_form_error_attachment_failed
import com.shyden.shytalk.resources.support_form_error_attachment_too_large
import com.shyden.shytalk.resources.support_form_error_attachment_too_many
import com.shyden.shytalk.resources.support_form_error_attachment_type
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

/** Mirrors `MAX_ATTACHMENTS` in `routes/support-tickets.js`. */
const val MAX_ATTACHMENTS = 10

/**
 * Checked BEFORE the bytes leave the device — SHY-0387.
 *
 * The alternative is a video that uploads for two minutes on a phone connection
 * and then fails, which costs the person their data allowance and tells them
 * nothing they could have acted on.
 */
const val MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Something the person attached and the server has accepted the bytes for.
 *
 * [displayName] is theirs — the file they picked — so the list reads as the
 * things they chose. [r2Key] is the server's, and is what travels with the
 * ticket; it is never shown.
 */
data class PendingAttachment(
    val displayName: String,
    val r2Key: String,
)

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
    /** Uploaded and ready to travel with the ticket, in the order they were added. */
    val attachments: List<PendingAttachment> = emptyList(),
    val isAttaching: Boolean = false,
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

    /**
     * Back to a blank form, keeping the entry point's category.
     *
     * This ViewModel is scoped to the SCREEN, not to the dialog — closing the
     * dialog does not destroy it. Without this, re-opening support after a
     * successful send re-attached the same instance with `submitted = true`, so
     * the person got the "we have your request" confirmation instead of a form
     * and could not raise a second ticket without leaving the screen entirely.
     *
     * Called on dismissal rather than on open: both land before the next
     * recomposition, so nobody sees a blank form flash over the confirmation.
     */
    fun selectCategory(category: SupportCategory) {
        _uiState.update { it.copy(category = category) }
    }

    /**
     * Take a file the person picked, upload it, and list it — SHY-0387.
     *
     * The size bound is checked FIRST, so an oversized video never leaves the
     * device. Everything after that can fail, and every failure path says so:
     * a file that did not upload is not added to the list, because a list entry
     * for a file the server never received is a ticket that references nothing.
     */
    fun attach(
        displayName: String,
        contentType: AttachmentType,
        bytes: ByteArray,
    ) {
        val state = _uiState.value
        if (bytes.size > MAX_ATTACHMENT_BYTES) {
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_attachment_too_large)) }
            return
        }
        if (state.attachments.size >= MAX_ATTACHMENTS) {
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_attachment_too_many)) }
            return
        }

        _uiState.update { it.copy(isAttaching = true, error = null) }

        viewModelScope.launch {
            val handle = supportRepository.requestAttachmentUpload(contentType)
            if (handle == null) {
                logW(TAG, "Attachment upload URL refused for $contentType")
                _uiState.update {
                    it.copy(isAttaching = false, error = UiText.res(Res.string.support_form_error_attachment_failed))
                }
                return@launch
            }

            val uploaded = supportRepository.uploadAttachment(handle.uploadUrl, contentType, bytes)
            if (uploaded) {
                _uiState.update {
                    it.copy(
                        isAttaching = false,
                        attachments = it.attachments + PendingAttachment(displayName, handle.r2Key),
                    )
                }
            } else {
                logW(TAG, "Attachment upload failed for $displayName")
                _uiState.update {
                    it.copy(isAttaching = false, error = UiText.res(Res.string.support_form_error_attachment_failed))
                }
            }
        }
    }

    /**
     * The person picked a file the server will not accept.
     *
     * Refused before any upload starts, so nobody spends a video's worth of
     * mobile data to be told no at the end. Separate from [attach] because
     * nothing is uploaded here — there is no in-flight state to enter.
     */
    fun refuseAttachmentType() {
        _uiState.update {
            it.copy(error = UiText.res(Res.string.support_form_error_attachment_type))
        }
    }

    /**
     * Take one back off the ticket.
     *
     * The object stays in R2 unreferenced; nothing here deletes it, because a
     * delete that races the send would strip an attachment off a ticket already
     * on its way. Unreferenced objects are the storage lifecycle's problem.
     */
    fun removeAttachment(r2Key: String) {
        _uiState.update { it.copy(attachments = it.attachments.filterNot { a -> a.r2Key == r2Key }) }
    }

    fun reset() {
        _uiState.update {
            when {
                // A send in flight keeps its state. The page cannot be left while
                // one is running, so this is defensive rather than reachable.
                it.isSubmitting -> it

                // Already sent: start clean. Keeping the text would show somebody
                // their own sent message as though it were an unsent draft.
                it.submitted -> SupportFormUiState(category = it.category)

                // Left WITHOUT sending: the words are still theirs. A back-press
                // is easy to hit by accident, and this screen is reached by people
                // who are already having a bad time -- SHY-0385's rule about never
                // losing what somebody typed applies here too, not only to a
                // failed send. Only the transient states clear.
                else -> it.copy(error = null, alreadyHasOpenTicket = false)
            }
        }
    }

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
            val outcome =
                supportRepository.raiseTicket(
                    trimmed,
                    state.category,
                    context,
                    state.attachments.map { it.r2Key },
                )
            when (outcome) {
                is RaiseTicketOutcome.Raised -> {
                    logI(TAG, "Support ticket raised: ${outcome.ticketId}")
                    _uiState.update { it.copy(isSubmitting = false, submitted = true) }
                }

                RaiseTicketOutcome.AlreadyOpen -> {
                    // Logged like the other two outcomes. Without this, "my
                    // ticket never sent" and "I already had one open" look
                    // identical in the logs — and they need different answers.
                    logI(TAG, "Support ticket refused: one is already open")
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            alreadyHasOpenTicket = true,
                            error = UiText.res(Res.string.support_form_error_already_open),
                        )
                    }
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
