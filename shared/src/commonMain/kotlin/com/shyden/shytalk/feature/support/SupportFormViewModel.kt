package com.shyden.shytalk.feature.support

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.OpenTicketSummary
import com.shyden.shytalk.data.repository.RaiseTicketOutcome
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.data.repository.SupportRepository
import com.shyden.shytalk.resources.Res
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
     * True when [submitted] was reached by adding to a request that was already
     * open rather than by raising a new one — SHY-0396. The confirmation has to
     * say which of the two happened, or somebody who chose "it is the problem I
     * already reported" is told we have a new message and cannot tell where it
     * went.
     */
    val addedToExisting: Boolean = false,
    /**
     * The person's own requests that are still open, newest lookup wins.
     *
     * Empty is the ordinary case AND the case where the lookup failed — see
     * [SupportFormViewModel.refreshOpenTickets] for why that collapse is
     * deliberate rather than sloppy.
     */
    val openTickets: List<OpenTicketSummary> = emptyList(),
    /**
     * The three-choice screen is up: they pressed Send, they have something
     * open, and nothing has been sent yet.
     *
     * NOT an [error]. Being asked a question is not a mistake they made, and the
     * distinction is what lets "Go back" leave every word intact.
     */
    val awaitingDuplicateChoice: Boolean = false,
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

    init {
        // Fetched on OPEN rather than on Send, so the round trip happens while
        // the person is still typing and the choice screen appears instantly.
        refreshOpenTickets()
    }

    /**
     * Ask what this person still has open — SHY-0396.
     *
     * A lookup that FAILS is treated as "nothing open", which is the safe
     * collapse: the worst case is a duplicate ticket, and the alternative —
     * blocking, or asking a question with no summaries to answer it against —
     * costs somebody their report. It is logged, so "the warning never appears"
     * is a question the logs can answer.
     */
    private fun refreshOpenTickets() {
        viewModelScope.launch {
            val open = supportRepository.openTickets()
            if (open == null) {
                logW(TAG, "Could not look up open tickets; sending without the duplicate warning")
                _uiState.update { it.copy(openTickets = emptyList()) }
            } else {
                _uiState.update { it.copy(openTickets = open) }
            }
        }
    }

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
        // Read before the update, because the update erases it.
        val hadJustSent = _uiState.value.submitted
        _uiState.update {
            when {
                // A send in flight keeps its state. The page cannot be left while
                // one is running, so this is defensive rather than reachable.
                it.isSubmitting -> it

                // Already sent: start clean. Keeping the text would show somebody
                // their own sent message as though it were an unsent draft.
                //
                // `openTickets` is dropped with the rest and re-fetched below,
                // because the request they just raised is open NOW -- a stale
                // empty list would let the very next Send skip the warning.
                it.submitted -> SupportFormUiState(category = it.category)

                // Left WITHOUT sending: the words are still theirs. A back-press
                // is easy to hit by accident, and this screen is reached by people
                // who are already having a bad time -- SHY-0385's rule about never
                // losing what somebody typed applies here too, not only to a
                // failed send. Only the transient states clear.
                else -> it.copy(error = null, awaitingDuplicateChoice = false)
            }
        }
        // Only after a send. The request they just raised is open NOW, and this
        // ViewModel outlives the page -- a stale empty list would let the very
        // next Send skip the warning entirely.
        if (hadJustSent) refreshOpenTickets()
    }

    fun updateMessage(value: String) {
        // Typing clears a previous complaint: the person is already acting on it,
        // and leaving the error up reads as though it applies to the new text.
        _uiState.update { it.copy(message = value, error = null) }
    }

    /**
     * What both routes out of this form have to agree on, in one place.
     *
     * Returns the message that would be SENT, or null having already put the
     * reason on screen. Shared rather than duplicated because SHY-0396 added a
     * second and a third way to send: bounds enforced on only one of them is a
     * message the server refuses after the person thought it had gone.
     */
    private fun validatedMessage(): String? {
        val state = _uiState.value
        if (state.isSubmitting) return null // Double-tap sends once.

        val trimmed = state.message.trim()
        if (trimmed.isEmpty()) {
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_empty)) }
            return null
        }
        if (trimmed.length > SUPPORT_MESSAGE_MAX_LENGTH) {
            // Bounded, never silently truncated -- cutting somebody's message in
            // half loses the part they cared about and tells them nothing.
            //
            // Measured on `trimmed`, because `trimmed` is what gets sent and what
            // the server bounds. Measuring the raw field instead refused a message
            // that would have been accepted, purely for trailing whitespace.
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_too_long)) }
            return null
        }
        return trimmed
    }

    /**
     * Send — or, if they already have a request open, ASK first.
     *
     * SHY-0396: this used to send unconditionally and let the server answer 409.
     * That refusal meant a genuinely different problem reached nobody. The
     * question is asked here instead, before anything is sent, and it is asked
     * every time Send is pressed while something is open — "go back" is a way to
     * re-read what you wrote, never a way to skip the question.
     */
    fun submit() {
        val trimmed = validatedMessage() ?: return
        if (_uiState.value.openTickets.isNotEmpty()) {
            _uiState.update { it.copy(awaitingDuplicateChoice = true, error = null) }
            return
        }
        raise(trimmed)
    }

    /** "It is a new problem" — they have seen what is open and this is not it. */
    fun sendAsNewProblem() {
        val trimmed = validatedMessage() ?: return
        _uiState.update { it.copy(awaitingDuplicateChoice = false) }
        raise(trimmed)
    }

    /**
     * "It is the problem I already reported" — their words join that ticket.
     *
     * The alternative considered and rejected was raising a linked duplicate.
     * That is what the operator asked us to stop: a duplicate for the same
     * problem only moves them to the back of the queue.
     */
    fun addToOpenTicket(ticketId: String) {
        val trimmed = validatedMessage() ?: return

        _uiState.update { it.copy(isSubmitting = true, error = null) }
        viewModelScope.launch {
            if (supportRepository.addToTicket(ticketId, trimmed)) {
                logI(TAG, "Added to an open support ticket: $ticketId")
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        submitted = true,
                        addedToExisting = true,
                        awaitingDuplicateChoice = false,
                    )
                }
            } else {
                logW(TAG, "Could not add to open support ticket: $ticketId")
                // The choice stays up and the text stays in the field, so the
                // retry is one tap and costs them nothing.
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        error = UiText.res(Res.string.support_form_error_generic),
                    )
                }
            }
        }
    }

    /** "Go back" — nothing is sent and nothing is lost. */
    fun dismissDuplicateChoice() {
        _uiState.update { it.copy(awaitingDuplicateChoice = false) }
    }

    private fun raise(trimmed: String) {
        val state = _uiState.value
        _uiState.update { it.copy(isSubmitting = true, error = null) }

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
